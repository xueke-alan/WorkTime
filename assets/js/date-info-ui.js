(function (g) {
  "use strict";
  const icons = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    notifications:
      '<path d="M18 8a6 6 0 0 0-12 0v4c0 2-1 3-2 4h16c-1-1-2-2-2-4V8Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    history: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v6l4 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
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
    if (active === "notifications") return;
    panel.setAttribute("aria-labelledby", "date-tab-" + active);
    panel.classList.toggle("countdown-panel", active === "countdown");
    panel.classList.toggle("almanac-panel", active === "almanac");
    panel.classList.toggle("festivals-panel", active === "festivals");
    const c = g.DateInfo?.getContent(active, date) || {
      ok: false,
      title: "日期资讯",
      message: "本地资讯模块未能加载",
    };
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
        head = node("div", undefined, "almanac-heading");
      head.append(
        node("span", c.almanac.month, "almanac-date-text"),
        node("span", c.almanac.day, "almanac-date-text"),
      );
      sheet.append(
        head,
        node("p", values["干支"] + " · 属" + values["生肖"], "almanac-cycle"),
      );
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
          activities.append(node("span", text));
        column.append(watermark, activities);
        grid.append(column);
      }
      sheet.append(grid, node("p", "冲" + values["冲煞"], "almanac-clash"));
      const details = node("div", undefined, "almanac-details");
      for (const [label, value] of c.almanac.details || [])
        details.append(node("span", label + " " + value));
      sheet.append(details);
      panel.append(sheet);
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
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (icons[p.icon] || icons.calendar) +
        "</svg>";
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
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("worktime:failed", dispose);
    g.removeEventListener("pagehide", dispose);
  }
  document.addEventListener("visibilitychange", onVisibility);
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
