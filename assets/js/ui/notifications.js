"use strict";
/** Notifications and transient feedback. Owns display only; save decisions remain in the app. */
WorkTimeApp.ui.createNotifications = function (options) {
  const {
    core: C,
    element: $,
    escape: esc,
    getState,
    getView,
    getRange: monthBounds,
    icon,
    timeAnomaly,
    document,
  } = options;
  const timers = new Set(),
    feedback = new Set();
  let mounted = true;
  function later(action, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (mounted) action();
    }, delay);
    timers.add(timer);
  }
  function mount() {
    mounted = true;
  }
  function dispose() {
    mounted = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const item of feedback) item.remove();
    feedback.clear();
    updateNotificationEmptyState();
  }
  function notificationIcon(type) {
    const graphic =
      type === "countdown"
        ? '<svg class="countdown-icon" viewBox="0 0 24 24"><circle class="ring-track" cx="12" cy="12" r="9.5"/><circle class="ring-progress" cx="12" cy="12" r="9.5"/><text class="ring-count" x="12" y="12">3</text></svg>'
        : icon(type);
    return (
      '<span class="notification-icon" aria-hidden="true">' +
      graphic +
      "</span>"
    );
  }
  function decorateStaticNotices() {
    for (const [id, type] of [
      ["storageNotice", "error"],
      ["timeAnomalyNotice", "error"],
      ["oaStaleNotice", "warning"],
      ["setupNotice", "warning"],
      ["yearNotice", "warning"],
    ]) {
      const item = $(id),
        body = document.createElement("div");
      if (item.querySelector(".notification-body")) continue;
      body.className = "notification-body";
      while (item.firstChild) body.append(item.firstChild);
      item.classList.add("info-notification", "tone-" + type);
      item.insertAdjacentHTML("afterbegin", notificationIcon(type));
      item.append(body);
    }
  }
  function updateNotificationEmptyState() {
    const hasFeedback = $("feedbackList").childElementCount > 0;
    const hasStatic = [
      "storageNotice",
      "timeAnomalyNotice",
      "oaStaleNotice",
      "setupNotice",
      "yearNotice",
    ].some((id) => !$(id).classList.contains("hidden"));
    $("notificationEmpty").classList.toggle("hidden", hasFeedback || hasStatic);
  }
  function toast(message, tone = "countdown") {
    if (!mounted) return;
    const item = document.createElement("div");
    item.className =
      "info-notification tone-countdown feedback-notice" +
      (tone === "error" ? " tone-error" : "");
    item.innerHTML =
      notificationIcon("countdown") + '<div class="notification-body"></div>';
    item.querySelector(".notification-body").textContent = message;
    $("feedbackList").prepend(item);
    feedback.add(item);
    const count = item.querySelector(".ring-count");
    later(() => {
      if (item.isConnected) count.textContent = "2";
    }, 1000);
    later(() => {
      if (item.isConnected) count.textContent = "1";
    }, 2000);
    later(() => {
      if (item.isConnected) item.classList.add("motion-leaving");
    }, 2820);
    later(() => {
      item.remove();
      feedback.delete(item);
      updateNotificationEmptyState();
    }, 3000);
    updateNotificationEmptyState();
  }
  function renderTimeAnomalyNotice() {
    const state = getState();
    const { selected } = getView();

    const [first, last] = monthBounds(),
      issues = Object.entries(state.days)
        .filter(([k]) => k >= first && k <= last)
        .map(([k, day]) => ({ date: k, detail: timeAnomaly(day) }))
        .filter((issue) => issue.detail)
        .sort((a, b) => a.date.localeCompare(b.date)),
      notice = $("timeAnomalyNotice"),
      body = notice.querySelector(".notification-body");
    notice.classList.toggle("hidden", !issues.length);
    body.innerHTML = issues.length
      ? "<strong>发现 " +
        issues.length +
        ' 处时间异常</strong><ul class="anomaly-list">' +
        issues
          .map(
            ({ date, detail }) =>
              '<li><span class="anomaly-date">' +
              esc(date) +
              "</span> · " +
              esc(detail.start) +
              " → " +
              esc(detail.end) +
              "</li>",
          )
          .join("") +
        '</ul><div class="anomaly-hint">跨午夜请开启“次日下班”。</div>'
      : "";
    $("dayEnd").setAttribute(
      "aria-invalid",
      String(!!timeAnomaly(state.days[selected] || {})),
    );
  }
  function renderOAStaleNotice() {
    const state = getState();

    const status = C.oaStaleness(state),
      notice = $("oaStaleNotice");
    notice.classList.toggle("hidden", !status || !status.stale);
    notice.title = status && status.stale ? "最新 OA 工时：" + status.date : "";
    notice.querySelector(".notification-body").textContent =
      status && status.stale
        ? "OA 工时已 " + status.days + " 天未更新，请导入"
        : "";
  }
  return {
    mount,
    dispose,
    decorateStaticNotices,
    updateNotificationEmptyState,
    toast,
    renderTimeAnomalyNotice,
    renderOAStaleNotice,
  };
};
