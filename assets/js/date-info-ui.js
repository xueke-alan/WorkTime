(function (g) {
  "use strict";
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
    area = document.createElement("div"),
    panel = document.createElement("section");
  area.className = "date-info-area";
  notices.before(area);
  area.append(notices, panel);
  panel.id = "dateInfoPanel";
  panel.className = "date-info-panel";
  panel.hidden = true;
  panel.setAttribute("role", "tabpanel");
  panel.tabIndex = 0;
  notices.setAttribute("role", "tabpanel");
  notices.setAttribute("aria-labelledby", "date-tab-notifications");
  bar.replaceChildren();
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "日期资讯");
  g.DateInfo?.register({
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
  function fitAlmanac() {
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
      const items = [...list.children],
        remainder = best.layouts[i].remainder;
      items.forEach((item) => item.style.removeProperty("translate"));
      if (!remainder) return;
      const sizes = getComputedStyle(list)
          .gridTemplateColumns.split(" ")
          .map(parseFloat),
        rowWidth =
          sizes.slice(0, remainder).reduce((sum, size) => sum + size, 0) +
          metrics[i].gap * (remainder - 1),
        offset = (list.clientWidth - rowWidth) / 2;
      items
        .slice(-remainder)
        .forEach((item) => (item.style.translate = offset + "px 0"));
    });
  }
  const almanacResize = new ResizeObserver(fitAlmanac);
  almanacResize.observe(panel);
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
  badgeObserver.observe(notices, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  let renderedView = null,
    countdownNodes = null,
    timer = null,
    disposed = false;
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
    const content = g.DateInfo?.getContent(active, date);
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
      box.append(message, time, end);
      panel.replaceChildren(box);
      countdownNodes = { box, message, time, end };
    }
    const { message, time, end } = countdownNodes;
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
      g.WorkMotion?.play(active === "notifications" ? notices : panel);
    renderedView = view;
    for (const b of bar.children) {
      const on = b.dataset.tab === active;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    notices.hidden = active !== "notifications";
    panel.hidden = active === "notifications";
    area.classList.toggle("has-date-info", active !== "notifications");
    g.WorkWeather?.setVisible(active === "weather");
    if (active === "notifications") return;
    panel.setAttribute("aria-labelledby", "date-tab-" + active);
    panel.classList.toggle("countdown-panel", active === "countdown");
    panel.classList.toggle("almanac-panel", active === "almanac");
    panel.classList.toggle("festivals-panel", active === "festivals");
    panel.classList.toggle("weather-panel", active === "weather");
    const c = g.DateInfo?.getContent(active, date) || {
      ok: false,
      title: "日期资讯",
      message: "本地资讯模块未能加载",
    };
    if (c.ok && c.weather) {
      countdownNodes = null;
      g.WorkWeatherUI?.render(panel, c.weather);
      return;
    }
    if (c.ok && c.countdown) {
      renderCountdown(c.countdown);
      return;
    }
    countdownNodes = null;
    panel.replaceChildren();
    if (active !== "countdown" && active !== "almanac")
      panel.append(node("p", c.date || date, "date-info-date"));
    if (!c.ok) {
      panel.append(node("p", c.message, "date-info-empty"));
      return;
    }
    if (c.events) {
      if (!c.events.length) panel.append(node("p", c.empty, "date-info-empty"));
      for (const e of c.events) {
        const article = node("article", undefined, "history-event");
        const entry = link("", e.sourceUrl);
        entry.className = "history-event-link";
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
      header.append(
        head,
        node("p", values["干支"] + " · 属" + values["生肖"], "almanac-cycle"),
      );
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
  function refreshTabs() {
    const current = active;
    bar.replaceChildren();
    const providers = g.DateInfo?.list() || [
      { id: "notifications", label: "通知", icon: "notifications" },
    ];
    providers.sort((a, b) =>
      a.id === "notifications" ? -1 : b.id === "notifications" ? 1 : 0,
    );
    for (const p of providers) {
      const b = node("button", undefined, "notification-tab");
      b.type = "button";
      b.id = "date-tab-" + p.id;
      b.dataset.tab = p.id;
      b.title = p.label;
      b.setAttribute("aria-label", p.label);
      b.setAttribute("role", "tab");
      b.setAttribute(
        "aria-controls",
        p.id === "notifications" ? "editorInfo" : "dateInfoPanel",
      );
      b.innerHTML =
        '<svg class="ui-icon" aria-hidden="true"><use href="#ms-' +
        (icons[p.icon] || icons.calendar) +
        '"></use></svg>';
      b.onclick = () => {
        active = p.id;
        rememberTab();
        render();
      };
      b.onkeydown = (e) => {
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
      };
      bar.append(b);
    }
    active = providers.some((p) => p.id === current)
      ? current
      : "notifications";
    if (date) render();
    updateNotificationBadge();
  }
  function onVisibility() {
    if (active === "countdown" && !document.hidden) render();
    else synchronizeTimer();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    synchronizeTimer();
    badgeObserver.disconnect();
    almanacResize.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("worktime:failed", dispose);
    g.removeEventListener("pagehide", dispose);
    document.removeEventListener("worktime:weather", onWeather);
  }
  document.addEventListener("visibilitychange", onVisibility);
  function onWeather() {
    if (active === "weather") {
      const scroll = panel.scrollTop;
      const focused =
        panel.contains(document.activeElement) &&
        document.activeElement.tagName === "BUTTON";
      render();
      panel.scrollTop = scroll;
      if (focused)
        panel.querySelector("button")?.focus({ preventScroll: true });
    }
  }
  document.addEventListener("worktime:weather", onWeather);
  document.addEventListener("worktime:failed", dispose);
  g.addEventListener("pagehide", dispose);
  refreshTabs();
  g.DateInfoUI = {
    setDate(value) {
      date = value;
      render();
    },
    refreshTabs,
    dispose,
  };
})(window);
