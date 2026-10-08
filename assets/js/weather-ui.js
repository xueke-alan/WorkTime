(function (g) {
  "use strict";
  function node(tag, text, className) {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  }
  const number = (v, unit = "") =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.round(v * 10) / 10 + unit
      : "暂无";
  // Global UV Index categories: <3, <6, <8, <11 and 11+.
  function uvLevel(value) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value === 999999
    )
      return "暂无";
    if (value < 3) return "弱";
    if (value < 6) return "中等";
    if (value < 8) return "强";
    if (value < 11) return "很强";
    return "极强";
  }
  function time(value) {
    return new Date(value).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    });
  }
  const forecastState = new WeakMap();
  let resumeFrame = 0;
  let resumeCount = 0;
  let mountedRoot = null;
  let mounted = false;
  let viewEvents = null;
  function resumeImages(root) {
    if (!root || g.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const revision = Date.now() + "-" + ++resumeCount;
    for (const image of root.querySelectorAll(
      ".calendar-weather-icon img, .weather-day-icon img",
    )) {
      const src = image.getAttribute("src")?.split("?")[0];
      if (src?.startsWith("assets/icons/meteocons/svg/"))
        image.src = src + "?resume=" + revision;
    }
  }
  function onVisibility() {
    cancelAnimationFrame(resumeFrame);
    resumeFrame = 0;
    if (
      document.hidden ||
      g.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    resumeFrame = requestAnimationFrame(() => {
      resumeFrame = 0;
      if (document.hidden) return;
      // A fresh SVG image resource restarts SMIL after background-tab suspension.
      resumeImages(mountedRoot);
    });
  }
  function releaseView() {
    viewEvents?.abort();
    viewEvents = null;
    mountedRoot
      ?.querySelectorAll(".weather-hourly,.weather-daily")
      .forEach((view) => WorkTimeApp.ui.motion?.stop(view));
  }
  function dispose() {
    cancelAnimationFrame(resumeFrame);
    resumeFrame = 0;
    releaseView();
    mounted = false;
    mountedRoot = null;
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("worktime:failed", dispose);
    g.removeEventListener("pagehide", dispose);
  }
  function mount(root = mountedRoot) {
    if (mountedRoot !== root) releaseView();
    mountedRoot = root;
    if (mounted) return;
    mounted = true;
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("worktime:failed", dispose);
    g.addEventListener("pagehide", dispose);
  }
  function iconFor(code) {
    if (code === 0) return "clear-day";
    if (code === 1 || code === 2) return "partly-cloudy-day";
    if (code === 3) return "cloudy";
    if (code === 45 || code === 48) return "fog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
      return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([95, 96, 99].includes(code)) return "thunderstorms";
    return null;
  }
  function weatherIcon(code) {
    const icon = iconFor(code);
    const description = WorkTimeApp.services.weather.weatherText(code);
    if (!icon) {
      const empty = node("span", "—", "weather-day-icon");
      empty.setAttribute("aria-label", description);
      return empty;
    }
    const picture = node("picture", undefined, "weather-day-icon");
    picture.title = description;
    const still = node("source");
    still.media = "(prefers-reduced-motion: reduce)";
    still.srcset = "assets/icons/meteocons/svg-static/" + icon + ".svg";
    const image = node("img");
    image.alt = description;
    image.draggable = false;
    image.src = "assets/icons/meteocons/svg/" + icon + ".svg";
    picture.append(still, image);
    return picture;
  }
  function render(panel, value) {
    releaseView();
    mount(panel);
    viewEvents = new AbortController();
    const signal = viewEvents.signal;
    const saved = forecastState.get(panel) || {
      mode: "hourly",
      hourly: 0,
      daily: 0,
    };
    forecastState.set(panel, saved);
    panel.replaceChildren();
    const head = node("div", undefined, "weather-heading");
    head.append(node("strong", value.city?.name || "天气"));
    panel.append(head);
    if (value.message)
      panel.append(node("p", value.message, "date-info-empty"));
    if (!value.record) {
      if (value.loading)
        panel.append(node("p", "正在加载天气…", "date-info-empty"));
      return;
    }
    const r = value.record;
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const dailyRows = r.daily.filter((row) => row.date >= today);
    const now = r.current;
    const overview = node("div", undefined, "weather-current");
    const temperature = node(
      "strong",
      number(now.temperature, "°C"),
      "weather-temperature",
    );
    temperature.dataset.tone = temperatureTone(now.temperature);
    const condition = weatherIcon(now.weatherCode);
    condition.classList.add("weather-condition");
    overview.append(temperature);
    head.append(overview);
    panel.append(condition);
    const dl = node("dl", undefined, "weather-details");
    for (const [label, text] of [
      ["体感", number(now.apparentTemperature, "°C")],
      ["湿度", number(now.humidity, "%")],
      ["风力", now.windClass || "暂无"],
      ["风向", now.windDirectionText || "暂无"],
    ]) {
      const item = node("div", undefined, "weather-detail");
      item.append(node("dt", label), node("dd", text));
      dl.append(item);
    }
    panel.append(dl);
    const age = node(
      "p",
      new Date(r.validAt).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      "date-info-source weather-time",
    );
    age.title =
      "百度地图天气 · 北京时间" +
      "\n天气时间 " +
      time(r.validAt) +
      " · 获取 " +
      time(r.fetchedAt);
    age.setAttribute(
      "aria-label",
      (value.stale ? "旧数据 · " : "") + age.title,
    );
    if (value.stale) age.classList.add("weather-stale");
    const forecast = node("div", undefined, "weather-forecast");
    const tabs = node("div", undefined, "weather-forecast-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "预报范围");
    const hourly = node("div", undefined, "weather-hourly");
    const hourMs = 60 * 60 * 1000;
    const firstHour = Math.floor(Date.now() / hourMs) * hourMs;
    const hourlyByTime = new Map(
      r.hourly.map((row) => [
        Math.floor(Date.parse(row.time) / hourMs) * hourMs,
        row,
      ]),
    );
    for (let index = 0; index < 12; index++) {
      const timestamp = firstHour + index * hourMs;
      const row = hourlyByTime.get(timestamp) || {
        temperature: null,
        precipitationProbability: null,
      };
      const hour = new Date(timestamp).toISOString();
      const card = node("div", undefined, "weather-hour");
      const hourTime = node(
        "time",
        new Date(hour).toLocaleTimeString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
      hourTime.dateTime = hour;
      card.title = time(hour);
      card.append(
        hourTime,
        node("strong", number(row.temperature, "°")),
        node("span", number(row.precipitationProbability, "%")),
      );
      card.lastElementChild.setAttribute(
        "aria-label",
        "降水概率 " + number(row.precipitationProbability, "%"),
      );
      hourly.append(card);
    }
    function dailyView() {
      const daily = node("div", undefined, "weather-daily");
      for (const row of dailyRows.slice(0, 5)) {
        const line = node("div", undefined, "weather-day");
        const temperatures = node("div", undefined, "weather-day-temperatures");
        const high = node("strong", number(row.high, "°"));
        const low = node("span", number(row.low, "°"), "weather-day-low");
        high.setAttribute(
          "aria-label",
          "最高温度 " + number(row.high, "摄氏度"),
        );
        low.setAttribute("aria-label", "最低温度 " + number(row.low, "摄氏度"));
        temperatures.append(high, low);
        const uv = node("span", "UV ", "weather-day-uv");
        const uvValue = node(
          "span",
          uvLevel(row.uvIndex) === "暂无" ? "—" : number(row.uvIndex),
          "weather-uv-value",
        );
        uvValue.dataset.level = uvLevel(row.uvIndex);
        uv.append(uvValue);
        uv.title =
          "紫外线等级 " +
          uvLevel(row.uvIndex) +
          " · 指数 " +
          number(row.uvIndex);
        uv.setAttribute("aria-label", uv.title);
        line.append(
          node("time", row.date.slice(5)),
          weatherIcon(row.weatherCode),
          temperatures,
          uv,
        );
        daily.append(line);
      }
      if (!dailyRows.length)
        daily.append(node("p", "暂无最新预报", "date-info-empty"));
      return daily;
    }
    const daily = dailyView();
    const views = { hourly, daily };
    const buttons = {};
    function select(mode, animate = true) {
      const changed = saved.mode !== mode;
      if (changed) {
        for (const view of Object.values(views))
          WorkTimeApp.ui.motion?.stop(view);
      }
      saved.mode = mode;
      for (const [key, view] of Object.entries(views)) {
        view.hidden = key !== mode;
        buttons[key].setAttribute("aria-selected", String(key === mode));
        buttons[key].tabIndex = key === mode ? 0 : -1;
      }
      views[mode].scrollLeft = saved[mode];
      if (changed && animate)
        WorkTimeApp.ui.motion?.play(
          views[mode],
          mode === "daily" ? "motion-sidebar-forward" : "motion-sidebar-back",
        );
    }
    for (const [mode, label] of [
      ["hourly", "12h"],
      [
        "daily",
        dailyRows.length ? Math.min(5, dailyRows.length) + "d" : "暂无预报",
      ],
    ]) {
      const button = node("button");
      button.append(node("span", label, "button-label"));
      button.className = "ui-text-action";
      button.type = "button";
      button.setAttribute(
        "aria-label",
        mode === "hourly" ? "未来12小时" : "未来5天",
      );
      button.id = "weather-forecast-tab-" + mode;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "weather-forecast-" + mode);
      button.addEventListener("click", () => select(mode), { signal });
      button.addEventListener(
        "keydown",
        (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const modes = Object.keys(views);
          const next =
            event.key === "Home"
              ? "hourly"
              : event.key === "End"
                ? "daily"
                : modes[
                    (modes.indexOf(mode) +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      modes.length) %
                      modes.length
                  ];
          select(next);
          buttons[next].focus();
        },
        { signal },
      );
      buttons[mode] = button;
      tabs.append(button);
      const view = views[mode];
      view.id = "weather-forecast-" + mode;
      view.setAttribute("role", "tabpanel");
      view.setAttribute("aria-labelledby", button.id);
      view.tabIndex = 0;
      view.addEventListener(
        "scroll",
        () => {
          if (!view.hidden && view.isConnected) saved[mode] = view.scrollLeft;
        },
        { signal },
      );
      view.addEventListener(
        "wheel",
        (event) => {
          if (event.ctrlKey || view.scrollWidth <= view.clientWidth) return;
          const delta =
            Math.abs(event.deltaX) > Math.abs(event.deltaY)
              ? event.deltaX
              : event.deltaY;
          if (!delta) return;
          event.preventDefault();
          const scale =
            event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? view.clientWidth
                : 1;
          view.scrollLeft += delta * scale;
          saved[mode] = view.scrollLeft;
        },
        { passive: false, signal },
      );
    }
    forecast.append(hourly, daily);
    const footer = node("div", undefined, "weather-footer");
    footer.append(tabs, age);
    panel.append(forecast, footer);
    select(saved.mode in views ? saved.mode : "daily", false);
  }
  function temperatureTone(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
    return value >= 35 ? "hot" : value >= 30 ? "warm" : "comfortable";
  }
  WorkTimeApp.ui.weather = {
    render,
    temperatureTone,
    iconFor,
    resumeImages,
    mount,
    dispose,
  };
  mount();
})(window);
