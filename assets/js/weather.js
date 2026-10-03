(function (g) {
  "use strict";
  const cities = g.WorkWeatherCities?.cities || [];
  const config = g.WorkWeatherConfig;
  let selected = "",
    city = null,
    record = null,
    loading = false,
    message = "",
    generation = 0;
  let controller = null,
    attemptedAt = 0,
    disposed = false,
    visible = false,
    timer = null;
  const cacheKey = "worktime.weather.v1.";
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
      value.units?.wind === "m/s" &&
      typeof value.current?.temperature === "number" &&
      Number.isFinite(value.current.temperature) &&
      Array.isArray(value.hourly) &&
      value.hourly.length === 24 &&
      value.hourly.every((row) => Number.isFinite(Date.parse(row.time))) &&
      Array.isArray(value.daily) &&
      value.daily.length === 7 &&
      value.daily.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    );
  }
  function cached(id) {
    try {
      const value = JSON.parse(localStorage.getItem(cacheKey + id));
      return validRecord(value, id) ? value : null;
    } catch {
      return null;
    }
  }
  function notify() {
    document.dispatchEvent(new Event("worktime:weather"));
  }
  function baseUrl() {
    const base = new URL(config.pagesBaseUrl);
    if (
      base.protocol !== "https:" ||
      !base.hostname.endsWith(".github.io") ||
      base.search ||
      base.hash
    )
      throw Error("天气数据地址须为 HTTPS github.io 地址");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return new URL(config.dataPath, base);
  }
  async function json(url, signal) {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw Error("天气文件暂时无法读取");
    // Redirects must not silently introduce another network dependency.
    if (response.url && !new URL(response.url).hostname.endsWith(".github.io"))
      throw Error("天气数据地址发生异常跳转");
    return response.json();
  }
  async function refresh(force = false) {
    if (disposed || !city || (loading && !force)) return;
    if (
      !force &&
      attemptedAt &&
      Date.now() - attemptedAt < config.refreshAfterMs
    )
      return;
    const target = city;
    const token = ++generation;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 20000);
    attemptedAt = Date.now();
    loading = true;
    message = "";
    notify();
    try {
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        const base = baseUrl();
        const index = await json(
          new URL("index.json", base),
          requestController.signal,
        );
        const file = index.provinces?.[target.provinceId];
        if (
          index.schemaVersion !== 1 ||
          typeof index.version !== "string" ||
          file !== target.provinceId + ".json"
        )
          throw Error("尚无该城市天气数据");
        const url = new URL(file, base);
        url.searchParams.set("v", index.version);
        const province = await json(url, requestController.signal);
        if (province.version !== index.version) continue;
        result = province.cities?.[target.id];
        if (province.schemaVersion !== 1 || !validRecord(result, target.id))
          throw Error("城市天气数据不完整");
        break;
      }
      if (!result) throw Error("天气数据正在更新，请稍后刷新");
      if (disposed || token !== generation) return;
      record = result;
      try {
        localStorage.setItem(cacheKey + target.id, JSON.stringify(record));
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
      if (!disposed && token === generation) {
        loading = false;
        controller = null;
        notify();
      }
    }
  }
  function setCity(value) {
    const text = String(value || "").trim();
    if (text === selected) return;
    selected = text;
    ++generation;
    controller?.abort();
    controller = null;
    city = resolveCity(text);
    record = city ? cached(city.id) : null;
    loading = false;
    message = "";
    attemptedAt = 0;
    notify();
    if (visible) void refresh();
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!disposed && visible && !document.hidden)
      timer = setTimeout(() => {
        notify();
        void refresh();
        schedule();
      }, 60000);
  }
  function setVisible(value) {
    if (visible === value) return;
    visible = value;
    schedule();
    if (visible) void refresh();
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
        Date.now() -
          Math.min(Date.parse(record.fetchedAt), Date.parse(record.validAt)) >
          config.staleAfterMs,
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
    if (visible && !document.hidden) {
      notify();
      void refresh();
    }
  }
  function dispose() {
    disposed = true;
    ++generation;
    controller?.abort();
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("worktime:failed", dispose);
    g.removeEventListener("pagehide", dispose);
  }
  g.WorkWeather = {
    resolveCity,
    validRecord,
    setCity,
    setVisible,
    snapshot,
    refresh,
    weatherText,
    dispose,
  };
  g.DateInfo?.register({
    id: "weather",
    label: "天气",
    icon: "cloud",
    getContent: () => ({ title: "天气", weather: snapshot() }),
  });
  const input = document.getElementById("workCity");
  if (
    input &&
    input.tagName === "INPUT" &&
    input.getAttribute("role") !== "combobox"
  ) {
    const list = document.createElement("datalist");
    list.id = "weatherCityOptions";
    for (const c of cities) {
      const option = document.createElement("option");
      option.value = c.name;
      option.label = c.label;
      list.append(option);
    }
    input.setAttribute("list", list.id);
    input.after(list);
  }
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("worktime:failed", dispose);
  g.addEventListener("pagehide", dispose);
})(window);
