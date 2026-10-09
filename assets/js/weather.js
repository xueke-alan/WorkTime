(function (g) {
  "use strict";
  const cities = WorkTimeApp.data.weatherCities?.cities || [];
  const config = WorkTimeApp.services.weatherConfig;
  let selected = "",
    city = null,
    record = null,
    loading = false,
    message = "",
    generation = 0;
  let controller = null,
    attemptedAt = 0,
    disposed = true,
    timer = null,
    requestTimeout = null;
  const subscribers = new Set(),
    demands = new Set();
  function beijingDate(value = Date.now()) {
    return new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function resolveCity(value) {
    const text = String(value || "").trim();
    const exact = cities.filter(
      (c) =>
        c.id === text ||
        c.label === text ||
        c.name === text ||
        c.name + "市" === text,
    );
    return exact.length === 1 ? exact[0] : null;
  }
  function validRecord(value, id) {
    return (
      value?.cityId === id &&
      Number.isFinite(Date.parse(value.fetchedAt)) &&
      Number.isFinite(Date.parse(value.validAt)) &&
      value.timezone === "Asia/Shanghai" &&
      value.units?.temperature === "°C" &&
      value.source === "百度天气" &&
      typeof value.current?.temperature === "number" &&
      Number.isFinite(value.current.temperature) &&
      Array.isArray(value.hourly) &&
      value.hourly.length <= 24 &&
      value.hourly.every((row) => Number.isFinite(Date.parse(row.time))) &&
      Array.isArray(value.daily) &&
      value.daily.length >= 1 &&
      value.daily.length <= 14 &&
      value.daily.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    );
  }
  const number = (v) =>
    typeof v === "number" && Number.isFinite(v) && v !== 999999 ? v : null;
  function conditionCode(text) {
    if (typeof text !== "string") return null;
    if (text.includes("雷")) return 95;
    if (text.includes("雪")) return 71;
    if (/雨|冰雹/.test(text)) return 61;
    if (/雾|霾|沙|尘/.test(text)) return 45;
    if (text.includes("阴")) return 3;
    if (text.includes("云")) return 2;
    if (text.includes("晴")) return 0;
    return null;
  }
  function beijingTime(value) {
    if (typeof value !== "string") return "";
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value))
      return value.replace(" ", "T") + "+08:00";
    if (!/^\d{14}$/.test(value)) return "";
    return (
      value.slice(0, 4) +
      "-" +
      value.slice(4, 6) +
      "-" +
      value.slice(6, 8) +
      "T" +
      value.slice(8, 10) +
      ":" +
      value.slice(10, 12) +
      ":" +
      value.slice(12, 14) +
      "+08:00"
    );
  }
  function normalize(snapshot, target) {
    const { weatherKey: key, districtId } = target;
    const entry = snapshot?.cities?.[key];
    const raw = entry?.result;
    const location = raw?.location || raw?.address;
    if (
      snapshot?.schemaVersion !== 1 ||
      entry?.districtId !== districtId ||
      String(location?.id) !== districtId ||
      !raw?.now ||
      !Array.isArray(raw.forecasts)
    )
      throw Error("城市天气数据不完整");
    const value = {
      cityId: target.id,
      name: target.label,
      source: "百度天气",
      fetchedAt: snapshot.updatedAt,
      validAt: beijingTime(raw.now.uptime),
      timezone: "Asia/Shanghai",
      units: { temperature: "°C", wind: "级" },
      current: {
        temperature: number(raw.now.temp),
        apparentTemperature: number(raw.now.feels_like),
        humidity: number(raw.now.rh),
        weatherCode: conditionCode(raw.now.text),
        text: raw.now.text,
        windClass: raw.now.wind_class,
        windDirectionText: raw.now.wind_dir,
      },
      hourly: (Array.isArray(raw.forecast_hours) ? raw.forecast_hours : [])
        .map((row) => ({
          time: beijingTime(row.data_time),
          temperature: number(row.temp_fc),
          precipitationProbability: number(row.pop),
        }))
        .filter((row) => Number.isFinite(Date.parse(row.time)))
        .slice(0, 24),
      daily: raw.forecasts.map((row) => ({
        date: row.date,
        weatherCode: conditionCode(row.text_day),
        text: row.text_day,
        high: number(row.high),
        low: number(row.low),
        uvIndex: number(row.uvi) !== null && row.uvi >= 0 ? row.uvi : null,
        precipitationProbability: null,
      })),
    };
    if (!validRecord(value, target.id)) throw Error("城市天气数据不完整");
    return value;
  }
  async function cached(id) {
    try {
      const value = await WorkTimeApp.services.archiveCache?.get(
        "weather:" + id,
      );
      return validRecord(value, id) ? value : null;
    } catch {
      return null;
    }
  }
  function notify() {
    const value = snapshot();
    for (const subscriber of subscribers) subscriber(value);
  }
  function baseUrl() {
    const url = new URL(config.snapshotUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "raw.githubusercontent.com" ||
      url.pathname !== "/xueke-alan/WorkTime/main/data/weather.json" ||
      url.search ||
      url.hash
    )
      throw Error("天气数据地址配置无效");
    return url;
  }
  async function json(url, signal) {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw Error("天气文件暂时无法读取");
    // Redirects must not silently introduce another network dependency.
    if (
      response.url &&
      new URL(response.url).hostname !== "raw.githubusercontent.com"
    )
      throw Error("天气数据地址发生异常跳转");
    return response.json();
  }
  async function refresh(force = false) {
    if (disposed || !city || (loading && !force)) return;
    if (
      !force &&
      attemptedAt &&
      beijingDate(attemptedAt) === beijingDate() &&
      Date.now() - attemptedAt < config.refreshAfterMs
    )
      return;
    const target = city;
    const token = ++generation;
    cancelRequest();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 20000);
    requestTimeout = timeout;
    attemptedAt = Date.now();
    loading = true;
    message = "";
    notify();
    try {
      const snapshot = await json(baseUrl(), requestController.signal);
      const result = normalize(snapshot, target);
      if (disposed || token !== generation) return;
      record = result;
      try {
        await WorkTimeApp.services.archiveCache?.set(
          "weather:" + target.id,
          record,
        );
      } catch {}
    } catch (error) {
      if (disposed || token !== generation) return;
      message = record
        ? "刷新失败，显示最近缓存"
        : error.name === "AbortError"
          ? "天气加载超时，请重试"
          : error.message;
    } finally {
      clearTimeout(timeout);
      if (requestTimeout === timeout) requestTimeout = null;
      if (!disposed && token === generation) {
        loading = false;
        controller = null;
        notify();
      }
    }
  }
  function setCity(value) {
    if (disposed) return;
    const text = String(value || "").trim();
    if (text === selected) return;
    selected = text;
    ++generation;
    cancelRequest();
    city = resolveCity(text);
    record = null;
    const target = city;
    if (target)
      void cached(target.id).then((value) => {
        if (!disposed && city?.id === target.id && !record && value) {
          record = value;
          if (message) message = "刷新失败，显示最近缓存";
          notify();
        }
      });
    loading = false;
    message = "";
    attemptedAt = 0;
    notify();
    if (demands.size) void refresh();
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!disposed && demands.size && !document.hidden)
      timer = setTimeout(() => {
        notify();
        void refresh();
        schedule();
      }, 60000);
  }
  function setDemand(consumer, enabled) {
    if (disposed) return;
    if (demands.has(consumer) === enabled) return;
    if (enabled) demands.add(consumer);
    else demands.delete(consumer);
    if (!demands.size && controller) {
      ++generation;
      cancelRequest();
      loading = false;
      attemptedAt = 0;
      notify();
    }
    schedule();
    if (enabled) void refresh();
  }
  function subscribe(listener) {
    if (disposed) return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }
  function snapshot() {
    return {
      city,
      record,
      loading,
      message: !selected
        ? "请在设置中选择工作城市"
        : !city
          ? "该城市尚未收录，请在设置中选择已支持的城市"
          : message,
      stale:
        !!record &&
        (beijingDate(Date.parse(record.validAt)) < beijingDate() ||
          Date.now() -
            Math.min(Date.parse(record.fetchedAt), Date.parse(record.validAt)) >
            config.staleAfterMs),
    };
  }
  function weatherText(code) {
    if (code === null || code === undefined) return "天气未知";
    if (code === 0) return "晴";
    if (code === 1) return "少云";
    if (code === 2) return "多云";
    if (code === 3) return "阴";
    if ([45, 48].includes(code)) return "雾";
    if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
    if ([61, 63, 65, 66, 67].includes(code)) return "雨";
    if ([71, 73, 75, 77].includes(code)) return "雪";
    if ([80, 81, 82].includes(code)) return "阵雨";
    if ([85, 86].includes(code)) return "阵雪";
    if ([95, 96, 99].includes(code)) return "雷雨";
    return "天气未知";
  }
  function onVisibility() {
    schedule();
    if (demands.size && !document.hidden) {
      notify();
      void refresh();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    ++generation;
    if (controller) attemptedAt = 0;
    cancelRequest();
    loading = false;
    clearTimeout(timer);
    timer = null;
    subscribers.clear();
    demands.clear();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("worktime:failed", dispose);
    g.removeEventListener("pagehide", dispose);
  }
  function cancelRequest() {
    controller?.abort();
    controller = null;
    if (requestTimeout !== null) clearTimeout(requestTimeout);
    requestTimeout = null;
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("worktime:failed", dispose);
    g.addEventListener("pagehide", dispose);
  }
  WorkTimeApp.services.weather = {
    normalize,
    resolveCity,
    validRecord,
    setCity,
    setDemand,
    subscribe,
    snapshot,
    refresh,
    weatherText,
    mount,
    dispose,
  };
  WorkTimeApp.services.dateInfo?.register({
    id: "weather",
    label: "天气",
    icon: "cloud",
    getContent: () => ({ title: "天气", weather: snapshot() }),
  });
  mount();
})(window);
