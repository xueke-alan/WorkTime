(function (g) {
  "use strict";
  const events = WorkTimeApp.ui.createEventScope(),
    tabEvents = WorkTimeApp.ui.createEventScope();
  const icons = {
    clock: "clock",
    notifications: "notifications",
    history: "history",
    sun: "sun",
    cloud: "cloud",
    calendar: "calendar",
  };
  const tabStorageKey = "worktime.dateInfo.activeTab";
  let date = "",
    active = "notifications";
  try {
    active = localStorage.getItem(tabStorageKey) || active;
  } catch {}
  function rememberTab() {
    try {
      localStorage.setItem(tabStorageKey, active);
    } catch {}
  }
  const notices = document.getElementById("editorInfo"),
    bar = document.querySelector(".editor>.notification-tabs"),
    area = document.querySelector(".date-info-area"),
    panel = document.getElementById("dateInfoPanel");
  bar.replaceChildren();
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "日期资讯");
  WorkTimeApp.services.dateInfo.register({
    id: "notifications",
    label: "通知",
    icon: "notifications",
    getContent: () => ({ title: "通知" }),
  });
  function node(tag, text, cls) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  const dateViews = ["history", "festivals", "almanac"];
  let selectedDateView = dateViews.includes(active) ? active : "history";
  const dateHeader = node("div", undefined, "date-context-header");
  const dateHeading = node("time", "", "date-context-date");
  const dateSwitch = node("div", undefined, "date-context-switch");
  dateSwitch.setAttribute("role", "tablist");
  dateSwitch.setAttribute("aria-label", "日期资讯内容");
  for (const [id, label] of [
    ["history", "历史"],
    ["festivals", "节气"],
    ["almanac", "农历"],
  ]) {
    const button = node("button", undefined, "ui-text-action");
    button.append(node("span", label, "button-label"));
    button.type = "button";
    button.id = "date-context-" + id;
    button.dataset.view = id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "dateInfoPanel");
    dateSwitch.append(button);
  }
  dateHeader.append(dateHeading, dateSwitch);
  dateHeader.hidden = true;
  panel.before(dateHeader);
  function fitAlmanac() {
    if (disposed) return;
    const grid = panel.querySelector(".almanac-guidance");
    if (!grid || panel.hidden || !grid.clientWidth) return;
    const lists = [...grid.querySelectorAll(".almanac-activities")],
      width = grid.clientWidth,
      canvas = document.createElement("canvas"),
      context = canvas.getContext("2d"),
      metrics = lists.map((list) => {
        const style = getComputedStyle(list),
          columnStyle = getComputedStyle(list.parentElement);
        context.font = style.font;
        return {
          count: list.children.length,
          items: [...list.children].map((item) =>
            Math.ceil(context.measureText(item.textContent).width),
          ),
          wide: [...list.children].map((item) =>
            item.classList.contains("almanac-activity-wide"),
          ),
          gap: parseFloat(style.columnGap),
          inset:
            parseFloat(columnStyle.paddingLeft) +
            parseFloat(columnStyle.paddingRight) +
            1,
          rows: Math.max(
            1,
            Math.floor(
              (grid.clientHeight -
                2 -
                parseFloat(columnStyle.paddingTop) -
                parseFloat(columnStyle.paddingBottom) +
                parseFloat(style.rowGap)) /
                (parseFloat(style.lineHeight) + parseFloat(style.rowGap)),
            ),
          ),
        };
      });
    let best = null;
    for (const columns of [
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
      [5, 3],
      [3, 5],
      [5, 4],
      [4, 5],
      [5, 5],
    ]) {
      const layouts = metrics.map((m, i) => {
        const sizes = Array(columns[i]).fill(0);
        let cursor = 0,
          rows = 0,
          wideWidth = 0;
        m.items.forEach((size, j) => {
          if (m.wide[j]) {
            if (cursor) rows++;
            rows++;
            cursor = 0;
            wideWidth = Math.max(wideWidth, size);
            return;
          }
          sizes[cursor] = Math.max(sizes[cursor], size);
          if (++cursor === columns[i]) {
            rows++;
            cursor = 0;
          }
        });
        return {
          sizes,
          rows: rows + (cursor ? 1 : 0),
          remainder: cursor,
          wideWidth,
        };
      });
      const tracks = layouts.map((layout) => layout.sizes);
      const minimum = metrics.map(
        (m, i) =>
          Math.max(
            layouts[i].wideWidth,
            tracks[i].reduce((sum, size) => sum + size, 0) +
              m.gap * (columns[i] - 1),
          ) + m.inset,
      );
      if (minimum[0] + minimum[1] > width) continue;
      const left = Math.max(
          minimum[0],
          Math.min(
            width - minimum[1],
            (width * columns[0]) / (columns[0] + columns[1]),
          ),
        ),
        overflow = metrics.reduce(
          (sum, m, i) => sum + Math.max(0, layouts[i].rows - m.rows),
          0,
        ),
        score =
          overflow * 1000 +
          columns[0] +
          columns[1] -
          6 +
          Math.abs(left / width - 0.5);
      if (!best || score < best.score) best = { tracks, layouts, left, score };
    }
    if (!best) return;
    grid.style.gridTemplateColumns = best.left + "px minmax(0, 1fr)";
    lists.forEach(
      (list, i) =>
        (list.style.gridTemplateColumns = best.tracks[i]
          .map((size) => "minmax(" + size + "px, 1fr)")
          .join(" ")),
    );
    lists.forEach((list, i) => {
      const items = [...list.children];
      items.forEach((item) => item.style.removeProperty("translate"));
      const sizes = getComputedStyle(list)
        .gridTemplateColumns.split(" ")
        .map(parseFloat);
      let row = [];
      function centerRow() {
        if (row.length && row.length < sizes.length) {
          const rowWidth =
            sizes.slice(0, row.length).reduce((sum, size) => sum + size, 0) +
            metrics[i].gap * (row.length - 1);
          const offset = (list.clientWidth - rowWidth) / 2;
          row.forEach((item) => (item.style.translate = offset + "px 0"));
        }
        row = [];
      }
      for (const item of items) {
        if (item.classList.contains("almanac-activity-wide")) centerRow();
        else {
          row.push(item);
          if (row.length === sizes.length) centerRow();
        }
      }
      centerRow();
    });
  }
  const almanacResize = new ResizeObserver(fitAlmanac);
  function link(text, url) {
    const e = node("a", text);
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return node("span", text);
      if (u.hostname === "zh.wikipedia.org") {
        u.pathname = u.pathname.replace("/wiki/", "/zh-cn/");
        u.searchParams.set("variant", "zh-cn");
      }
      e.href = u.href;
      e.target = "_blank";
      e.rel = "noreferrer";
      return e;
    } catch {
      return node("span", text);
    }
  }
  let visibleNotifications = new Map();
  function updateNotificationBadge() {
    const button = document.getElementById("date-tab-notifications");
    if (!button) return;
    const items = [...notices.querySelectorAll(".info-notification")].filter(
      (item) => {
        for (let e = item; e && e !== notices; e = e.parentElement) {
          if (e.hidden || e.classList.contains("hidden")) return false;
        }
        return true;
      },
    );
    const currentNotifications = new Map(
      items.map((item) => [
        item,
        (item.querySelector(".notification-body")?.textContent || "").trim(),
      ]),
    );
    const hasNewNotification = [...currentNotifications].some(
      ([item, text]) => visibleNotifications.get(item) !== text,
    );
    visibleNotifications = currentNotifications;
    if (hasNewNotification && active !== "notifications") {
      active = "notifications";
      render();
      notices.scrollTop = 0;
    }
    const tone = items.some((e) => e.classList.contains("tone-error"))
      ? "error"
      : items.some((e) => e.classList.contains("tone-warning"))
        ? "warning"
        : "";
    let badge = button.querySelector(".notification-badge");
    if (tone) {
      if (!badge) {
        badge = node("span", undefined, "notification-badge");
        badge.setAttribute("aria-hidden", "true");
        button.append(badge);
      }
      badge.dataset.tone = tone;
    } else badge?.remove();
    button.setAttribute(
      "aria-label",
      tone ? "通知（有" + (tone === "error" ? "错误" : "提醒") + "）" : "通知",
    );
  }
  const badgeObserver = new MutationObserver(updateNotificationBadge);
  let renderedView = null,
    countdownNodes = null,
    timer = null,
    disposed = true,
    unsubscribeWeather = null;
  function synchronizeTimer() {
    clearTimeout(timer);
    timer = null;
    if (!disposed && date && active === "countdown" && !document.hidden)
      timer = setTimeout(tickCountdown, 1000);
  }
  function tickCountdown() {
    if (disposed || document.hidden || active !== "countdown") {
      synchronizeTimer();
      return;
    }
    const content = WorkTimeApp.services.dateInfo.getContent(active, date);
    if (content?.ok && content.countdown) {
      renderCountdown(content.countdown);
      synchronizeTimer();
    } else render();
  }
  function renderCountdown(value) {
    if (!countdownNodes || countdownNodes.box.parentElement !== panel) {
      const box = node("div", undefined, "work-countdown"),
        message = node("p", undefined, "countdown-message"),
        time = node("strong", undefined, "countdown-time"),
        end = node("p", undefined, "countdown-end");
      const restIcon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      restIcon.classList.add("countdown-rest-icon");
      restIcon.setAttribute("viewBox", "0 0 96 96");
      restIcon.setAttribute("aria-hidden", "true");
      restIcon.setAttribute("focusable", "false");
      restIcon.innerHTML =
        '<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M70 44h7a11 11 0 0 1 0 22H67"/><path d="M22 43h48l-3 23a18 18 0 0 1-18 16h-6a18 18 0 0 1-18-16Z" fill="currentColor" fill-opacity=".2"/><ellipse cx="46" cy="43" rx="24" ry="5"/><path d="M15 86h63"/><g class="countdown-rest-steam"><path d="M34 30c-10-10 10-13 0-24M48 28c-10-10 10-13 0-24M62 30c-10-10 10-13 0-24"/></g></g>';
      box.append(restIcon);
      box.append(message, time, end);
      panel.replaceChildren(box);
      countdownNodes = { box, message, time, end };
    }
    const { box, message, time, end } = countdownNodes;
    box.classList.toggle("is-rest", value.status === "rest");
    for (const [element, text] of [
      [message, value.message],
      [time, value.time || ""],
      [end, value.time ? value.end + " 下班" : ""],
    ]) {
      if (element.textContent !== text) element.textContent = text;
    }
    for (const element of [time, end]) {
      if (element.hidden !== !value.time) element.hidden = !value.time;
      if (element.classList.contains("hidden") !== !value.time)
        element.classList.toggle("hidden", !value.time);
    }
  }
  function render() {
    if (disposed) return;
    synchronizeTimer();
    const view = active;
    if (renderedView !== null && renderedView !== view)
      WorkTimeApp.ui.motion?.play(active === "notifications" ? notices : panel);
    renderedView = view;
    for (const b of bar.children) {
      const on =
        b.dataset.tab === active ||
        (b.dataset.tab === "history" && dateViews.includes(active));
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    notices.hidden = active !== "notifications";
    panel.hidden = active === "notifications";
    const grouped = dateViews.includes(active);
    dateHeader.hidden = !grouped;
    area.classList.toggle("has-date-context", grouped);
    dateHeading.textContent = date;
    dateHeading.dateTime = date;
    for (const button of dateSwitch.children) {
      const on = button.dataset.view === active;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    area.classList.toggle("has-date-info", active !== "notifications");
    WorkTimeApp.services.weather?.setDemand("details", active === "weather");
    if (active === "notifications") return;
    panel.setAttribute(
      "aria-labelledby",
      (grouped ? "date-context-" : "date-tab-") + active,
    );
    panel.classList.toggle("countdown-panel", active === "countdown");
    panel.classList.toggle("almanac-panel", active === "almanac");
    panel.classList.toggle("festivals-panel", active === "festivals");
    panel.classList.toggle("weather-panel", active === "weather");
    const c = WorkTimeApp.services.dateInfo.getContent(active, date) || {
      ok: false,
      title: "日期资讯",
      message: "本地资讯模块未能加载",
    };
    if (c.ok && c.weather) {
      countdownNodes = null;
      WorkTimeApp.ui.weather?.render(panel, c.weather);
      return;
    }
    if (c.ok && c.countdown) {
      renderCountdown(c.countdown);
      return;
    }
    countdownNodes = null;
    panel.replaceChildren();
    if (!grouped && active !== "countdown")
      panel.append(node("p", c.date || date, "date-info-date"));
    if (!c.ok) {
      panel.append(node("p", c.message, "date-info-empty"));
      return;
    }
    if (c.events) {
      if (!c.events.length) panel.append(node("p", c.empty, "date-info-empty"));
      for (const e of c.events) {
        const article = node("article", undefined, "history-event");
        const entry = node("div", undefined, "history-event-content");
        entry.append(
          node(
            "strong",
            (e.year < 0 ? "公元前" + Math.abs(e.year) : e.year) + "年",
          ),
          node("p", e.text),
        );
        article.append(entry);
        panel.append(article);
      }
    }
    if (c.almanac) {
      const values = Object.fromEntries(c.rows),
        sheet = node("div", undefined, "almanac-sheet"),
        head = node("div", undefined, "almanac-heading"),
        header = node("div", undefined, "almanac-header");
      head.append(
        node("span", c.almanac.month, "almanac-date-text"),
        node("span", c.almanac.day, "almanac-date-text"),
      );
      const cycle = node("p", undefined, "almanac-cycle"),
        cycleParts = values["干支"].trim().split(/\s+/);
      cycle.append(
        node("span", cycleParts.slice(0, 2).join(" ")),
        node("span", cycleParts.slice(2).join(" ") + " · 属" + values["生肖"]),
      );
      header.append(head, cycle);
      sheet.append(header);
      const grid = node("div", undefined, "almanac-guidance");
      for (const key of ["宜", "忌"]) {
        const column = node(
          "section",
          undefined,
          "almanac-column " + (key === "宜" ? "auspicious" : "avoid"),
        );
        column.setAttribute("aria-label", key);
        const watermark = node("span", undefined, "almanac-watermark");
        watermark.append(node("span", key, "almanac-watermark-text"));
        watermark.setAttribute("aria-hidden", "true");
        const activities = node("p", undefined, "almanac-activities");
        for (const text of values[key].split("、"))
          activities.append(
            node(
              "span",
              text,
              text.length >= 4 ? "almanac-activity-wide" : undefined,
            ),
          );
        column.append(watermark, activities);
        grid.append(column);
      }
      const footer = node("div", undefined, "almanac-footer");
      footer.append(node("p", "冲" + values["冲煞"], "almanac-clash"));
      const details = node("div", undefined, "almanac-details");
      for (const [label, value] of c.almanac.details || [])
        details.append(node("span", label + " " + value));
      footer.append(details);
      sheet.append(grid, footer);
      panel.append(sheet);
      fitAlmanac();
    } else if (c.sections) {
      for (const section of c.sections) {
        const block = node("section", undefined, "festival-section");
        block.setAttribute("aria-label", section.label);
        if (section.kind) block.classList.add("festival-" + section.kind);
        if (section.text) block.append(node("p", section.text));
        if (section.rows) {
          const dl = node("dl", undefined, "date-info-rows");
          for (const [label, value] of section.rows)
            dl.append(node("dt", label), node("dd", value));
          block.append(dl);
        }
        if (section.links) {
          const list = node("p", undefined, "festival-links");
          if (!section.links.length) list.textContent = section.empty;
          for (const item of section.links) {
            list.append(link(item.text, item.url));
          }
          block.append(list);
        }
        panel.append(block);
      }
    } else if (c.rows) {
      const dl = node("dl", undefined, "date-info-rows");
      for (const [label, value] of c.rows)
        dl.append(node("dt", label), node("dd", value));
      panel.append(dl);
    }
    if (c.events) {
      const source = node("p", "更多历史上的今天：", "date-info-source");
      const parts = date.split("-").map(Number);
      source.append(
        link(
          "中文维基百科",
          "https://zh.wikipedia.org/zh-cn/" +
            encodeURIComponent(parts[1] + "月" + parts[2] + "日"),
        ),
        document.createTextNode(" · CC BY-SA 4.0"),
      );
      panel.append(source);
    } else if (c.source && !c.almanac)
      panel.append(
        c.sourceUrl
          ? link(c.source, c.sourceUrl)
          : node("p", c.source, "date-info-source"),
      );
    panel.scrollTop = 0;
  }
  function updateWeatherTabIcon() {
    const use = document.querySelector("#date-tab-weather use");
    if (!use) return;
    const record = WorkTimeApp.services.weather?.snapshot().record;
    const beijingDate = (time) =>
      new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    const today = beijingDate(Date.now());
    let code = record?.daily.find((row) => row.date === today)?.weatherCode;
    if (
      record &&
      Number.isFinite(Date.parse(record.validAt)) &&
      beijingDate(Date.parse(record.validAt)) === today
    )
      code = record.current.weatherCode ?? code;
    const symbols = {
      "clear-day": "sun",
      "partly-cloudy-day": "cloud",
      cloudy: "cloud",
      rain: "weather-rain",
      snow: "weather-snow",
      fog: "weather-fog",
      thunderstorms: "weather-thunder",
    };
    const icon = symbols[WorkTimeApp.ui.weather?.iconFor(code)] || "cloud";
    use.setAttribute("href", "#ms-" + icon);
  }
  function refreshTabs() {
    if (disposed) return;
    tabEvents.dispose();
    const current = active;
    bar.replaceChildren();
    const providers = WorkTimeApp.services.dateInfo.list() || [
      { id: "notifications", label: "通知", icon: "notifications" },
    ];
    const independentTabs = ["notifications", "countdown", "weather"];
    const tabOrder = (provider) => {
      const index = independentTabs.indexOf(provider.id);
      return index < 0 ? independentTabs.length : index;
    };
    providers.sort((a, b) => tabOrder(a) - tabOrder(b));
    let firstDateTab = true;
    for (const p of providers) {
      if (p.id === "festivals" || p.id === "almanac") continue;
      const b = node("button", undefined, "notification-tab");
      b.type = "button";
      b.id = "date-tab-" + p.id;
      b.dataset.tab = p.id;
      if (!independentTabs.includes(p.id) && firstDateTab) {
        b.classList.add("date-tab-group-start");
        firstDateTab = false;
      }
      b.title = p.id === "history" ? "日期资讯：历史、节气、农历" : p.label;
      b.setAttribute("aria-label", b.title);
      b.setAttribute("role", "tab");
      b.setAttribute(
        "aria-controls",
        p.id === "notifications" ? "editorInfo" : "dateInfoPanel",
      );
      b.innerHTML =
        '<svg class="ui-icon" aria-hidden="true"><use href="#ms-' +
        (p.id === "history"
          ? icons.calendar
          : icons[p.icon] || icons.calendar) +
        '"></use></svg>';
      tabEvents.handler(b, "onclick", () => {
        active = p.id === "history" ? selectedDateView : p.id;
        rememberTab();
        render();
      });
      tabEvents.handler(b, "onkeydown", (e) => {
        const buttons = [...bar.children],
          i = buttons.indexOf(b);
        let next;
        if (e.key === "ArrowRight") next = (i + 1) % buttons.length;
        if (e.key === "ArrowLeft")
          next = (i - 1 + buttons.length) % buttons.length;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = buttons.length - 1;
        if (next !== undefined) {
          e.preventDefault();
          buttons[next].click();
          buttons[next].focus();
        }
      });
      bar.append(b);
    }
    active = providers.some((p) => p.id === current)
      ? current
      : "notifications";
    if (date) render();
    updateNotificationBadge();
    updateWeatherTabIcon();
  }
  function onVisibility() {
    if (!document.hidden) updateWeatherTabIcon();
    if (active === "countdown" && !document.hidden) render();
    else synchronizeTimer();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    events.dispose();
    tabEvents.dispose();
    synchronizeTimer();
    badgeObserver.disconnect();
    almanacResize.disconnect();
    unsubscribeWeather?.();
    unsubscribeWeather = null;
    WorkTimeApp.services.weather.setDemand("details", false);
  }
  function onWeather() {
    if (disposed) return;
    updateWeatherTabIcon();
    if (active === "weather") {
      const scroll = panel.scrollTop;
      const focusedId = panel.contains(document.activeElement)
        ? document.activeElement.id
        : "";
      render();
      panel.scrollTop = scroll;
      const focused = focusedId && document.getElementById(focusedId);
      if (focused && panel.contains(focused))
        focused.focus({ preventScroll: true });
    }
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    renderedView = null;
    for (const button of dateSwitch.children) {
      const id = button.dataset.view;
      events.handler(button, "onclick", () => {
        active = selectedDateView = id;
        rememberTab();
        render();
        panel.scrollTop = 0;
      });
      events.handler(button, "onkeydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : (dateViews.indexOf(id) + (event.key === "ArrowRight" ? 1 : 2)) %
                3;
        dateSwitch.children[index].click();
        dateSwitch.children[index].focus();
      });
    }
    badgeObserver.observe(notices, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    almanacResize.observe(panel);
    events.listen(document, "visibilitychange", onVisibility);
    events.listen(document, "worktime:failed", dispose);
    events.listen(g, "pagehide", dispose);
    unsubscribeWeather = WorkTimeApp.services.weather.subscribe(onWeather);
    refreshTabs();
  }
  WorkTimeApp.ui.dateInfo = {
    setDate(value) {
      date = value;
      // These panels use live application data rather than the selected date.
      if (
        renderedView === active &&
        ["weather", "countdown", "notifications"].includes(active)
      )
        return;
      render();
    },
    refreshTabs,
    mount,
    dispose,
  };
  mount();
})(window);
