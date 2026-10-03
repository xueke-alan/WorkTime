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
      : "—";
  function time(value) {
    return new Date(value).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    });
  }
  function render(panel, value) {
    panel.replaceChildren();
    const head = node("div", undefined, "weather-heading");
    head.append(node("strong", value.city?.name || "天气"));
    const refresh = node("button", value.loading ? "更新中…" : "刷新");
    refresh.type = "button";
    refresh.disabled = value.loading || !value.city;
    refresh.onclick = () => void g.WorkWeather.refresh(true);
    head.append(refresh);
    panel.append(head);
    if (value.message)
      panel.append(node("p", value.message, "date-info-empty"));
    if (!value.record) {
      if (value.loading)
        panel.append(node("p", "正在加载天气…", "date-info-empty"));
      return;
    }
    const r = value.record;
    const now = r.current;
    const overview = node("div", undefined, "weather-current");
    overview.append(
      node("strong", number(now.temperature, "°C"), "weather-temperature"),
      node("span", g.WorkWeather.weatherText(now.weatherCode)),
    );
    panel.append(overview);
    const dl = node("dl", undefined, "date-info-rows");
    for (const [label, text] of [
      ["体感", number(now.apparentTemperature, "°C")],
      ["湿度", number(now.humidity, "%")],
      ["风速", number(now.windSpeed, " m/s")],
      ["风向", number(now.windDirection, "°")],
    ])
      dl.append(node("dt", label), node("dd", text));
    panel.append(dl);
    const age = node(
      "p",
      (value.stale ? "旧数据 · " : "") +
        "天气时间 " +
        time(r.validAt) +
        " · 获取 " +
        time(r.fetchedAt),
      "date-info-source",
    );
    if (value.stale) age.classList.add("weather-stale");
    panel.append(age, node("h3", "未来24小时"));
    const hourly = node("div", undefined, "weather-hourly");
    for (const row of r.hourly) {
      const card = node("div", undefined, "weather-hour");
      card.append(
        node(
          "time",
          new Date(row.time).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            hour12: false,
          }),
        ),
        node("strong", number(row.temperature, "°C")),
        node("span", "降水 " + number(row.precipitationProbability, "%")),
      );
      hourly.append(card);
    }
    panel.append(hourly, node("h3", "7天预报"));
    const daily = node("div", undefined, "weather-daily");
    for (const row of r.daily) {
      const line = node("div", undefined, "weather-day");
      line.append(
        node("time", row.date.slice(5)),
        node("span", g.WorkWeather.weatherText(row.weatherCode)),
        node("span", number(row.low) + " / " + number(row.high, "°C")),
        node("span", "降水 " + number(row.precipitationProbability, "%")),
      );
      daily.append(line);
    }
    panel.append(
      daily,
      node(
        "p",
        "Open-Meteo · CC BY 4.0 · 预报数据经过整理 · 北京时间",
        "date-info-source",
      ),
    );
  }
  g.WorkWeatherUI = { render };
})(window);
