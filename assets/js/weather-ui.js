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
      ? WorkTimeApp.i18n.number(Math.round(v * 10) / 10, {
          useGrouping: false,
          maximumFractionDigits: 1,
        }) + unit
      : WorkTimeApp.i18n.t("copy.5dbd015496");
  // Missing values occupy numeric slots, not prose columns. Keep their meaning
  // localized for assistive technology and hover without crowding adjacent hours.
  function valueNode(tag, text, className) {
    const missing = text === WorkTimeApp.i18n.t("copy.5dbd015496");
    const element = node(tag, missing ? "—" : text, className);
    if (missing) {
      element.title = text;
      element.setAttribute("aria-label", text);
    }
    return element;
  }
  // Global UV Index categories: <3, <6, <8, <11 and 11+.
  function uvLevel(value) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value === 999999
    )
      return WorkTimeApp.i18n.t("copy.5dbd015496");
    if (value < 3) return WorkTimeApp.i18n.t("copy.d47963399c");
    if (value < 6) return WorkTimeApp.i18n.t("copy.839de24a0c");
    if (value < 8) return WorkTimeApp.i18n.t("copy.2756809b4d");
    if (value < 11) return WorkTimeApp.i18n.t("copy.34989e860e");
    return WorkTimeApp.i18n.t("copy.bf92a75326");
  }
  function time(value) {
    return new Date(value).toLocaleString(WorkTimeApp.i18n.locale, {
      timeZone: "Asia/Shanghai",
      hour12: false,
    });
  }
  const forecastState = new WeakMap();
  function readForecastMode() {
    return WorkTimeApp.services.preferences.page.state.forecastMode === "daily"
      ? "daily"
      : "hourly";
  }
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
    const description = WorkTimeApp.i18n.message(
      WorkTimeApp.services.weather.weatherText(code),
    );
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
      mode: readForecastMode(),
      hourly: 0,
      daily: 0,
    };
    forecastState.set(panel, saved);
    panel.replaceChildren();
    const head = node("div", undefined, "weather-heading");
    const cityName = node(
      "strong",
      value.city
        ? WorkTimeApp.i18n.city(value.city.name)
        : WorkTimeApp.i18n.t("copy.6055fe4b90"),
    );
    cityName.title = cityName.textContent;
    head.append(cityName);
    panel.append(head);
    if (value.message)
      panel.append(
        node("p", WorkTimeApp.i18n.message(value.message), "date-info-empty"),
      );
    if (!value.record) {
      if (value.loading)
        panel.append(
          node("p", WorkTimeApp.i18n.t("copy.d0148374a9"), "date-info-empty"),
        );
      return;
    }
    const r = value.record;
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const dailyRows = r.daily.filter((row) => row.date >= today);
    const now = r.current;
    const overview = node("div", undefined, "weather-current");
    const temperature = valueNode(
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
    for (const [label, text, fullLabel = label] of [
      [
        WorkTimeApp.i18n.t("copy.0e4b9c6d11"),
        number(now.apparentTemperature, "°C"),
      ],
      [WorkTimeApp.i18n.t("copy.dee19da50f"), number(now.humidity, "%")],
      [
        WorkTimeApp.i18n.t("weather.wind.label"),
        String(now.windClass || "").replaceAll(
          "级",
          WorkTimeApp.i18n.t("copy.27e4026a54"),
        ) || WorkTimeApp.i18n.t("copy.5dbd015496"),
        WorkTimeApp.i18n.t("copy.c56fd6a049"),
      ],
      [
        WorkTimeApp.i18n.t("weather.direction.label"),
        WorkTimeApp.i18n.message(now.windDirectionText) ||
          WorkTimeApp.i18n.t("copy.5dbd015496"),
        WorkTimeApp.i18n.t("copy.b24c63c80a"),
      ],
    ]) {
      const item = node("div", undefined, "weather-detail");
      const term = node("dt", label);
      term.title = fullLabel;
      term.setAttribute("aria-label", fullLabel);
      item.append(term, valueNode("dd", text));
      dl.append(item);
    }
    panel.append(dl);
    const age = node(
      "p",
      new Date(r.validAt).toLocaleString(WorkTimeApp.i18n.locale, {
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
      WorkTimeApp.i18n.t("copy.35024cc449") +
      WorkTimeApp.i18n.t("copy.504862fd0c") +
      time(r.validAt) +
      WorkTimeApp.i18n.t("copy.2868f768f7") +
      time(r.fetchedAt);
    age.setAttribute(
      "aria-label",
      (value.stale ? WorkTimeApp.i18n.t("copy.00c4c43cec") : "") + age.title,
    );
    if (value.stale) age.classList.add("weather-stale");
    const forecast = node("div", undefined, "weather-forecast");
    const tabs = node("div", undefined, "weather-forecast-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", WorkTimeApp.i18n.t("copy.21d226ca4b"));
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
        new Date(hour).toLocaleTimeString(WorkTimeApp.i18n.locale, {
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
        valueNode("strong", number(row.temperature, "°")),
        valueNode("span", number(row.precipitationProbability, "%")),
      );
      card.lastElementChild.setAttribute(
        "aria-label",
        WorkTimeApp.i18n.t("copy.27c5f1167d") +
          number(row.precipitationProbability, "%"),
      );
      hourly.append(card);
    }
    function dailyView() {
      const daily = node("div", undefined, "weather-daily");
      for (const row of dailyRows.slice(0, 5)) {
        const line = node("div", undefined, "weather-day");
        const temperatures = node("div", undefined, "weather-day-temperatures");
        const high = valueNode("strong", number(row.high, "°"));
        const low = valueNode("span", number(row.low, "°"), "weather-day-low");
        high.setAttribute(
          "aria-label",
          WorkTimeApp.i18n.t("copy.d787b8fad4") +
            number(row.high, WorkTimeApp.i18n.t("copy.b3a2ab7764")),
        );
        low.setAttribute(
          "aria-label",
          WorkTimeApp.i18n.t("copy.b438c0f1cd") +
            number(row.low, WorkTimeApp.i18n.t("copy.b3a2ab7764")),
        );
        temperatures.append(high, low);
        const uv = node("span", "UVI ", "weather-day-uv");
        const uvValue = node(
          "span",
          uvLevel(row.uvIndex) === WorkTimeApp.i18n.t("copy.5dbd015496")
            ? "—"
            : number(row.uvIndex),
          "weather-uv-value",
        );
        uvValue.dataset.level =
          typeof row.uvIndex === "number" &&
          row.uvIndex >= 0 &&
          row.uvIndex !== 999999
            ? ["low", "moderate", "high", "very-high", "extreme"][
                [3, 6, 8, 11, Infinity].findIndex(
                  (limit) => row.uvIndex < limit,
                )
              ]
            : "unknown";
        uv.append(uvValue);
        uv.title =
          WorkTimeApp.i18n.t("copy.7cf9e381d1") +
          uvLevel(row.uvIndex) +
          WorkTimeApp.i18n.t("copy.fdedbc09b8") +
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
        daily.append(
          node("p", WorkTimeApp.i18n.t("copy.a2face0835"), "date-info-empty"),
        );
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
      if (animate) {
        void WorkTimeApp.services.preferences.page.saveForecastMode(mode);
      }
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
        dailyRows.length
          ? Math.min(5, dailyRows.length) + "d"
          : WorkTimeApp.i18n.t("copy.d852f0593c"),
      ],
    ]) {
      const button = node("button");
      button.append(node("span", label, "button-label"));
      button.className = "ui-text-action";
      button.type = "button";
      button.setAttribute(
        "aria-label",
        mode === "hourly"
          ? WorkTimeApp.i18n.t("copy.c3651dbfc9")
          : WorkTimeApp.i18n.t("copy.29c372da5d"),
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
