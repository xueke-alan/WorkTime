"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage();
  await page.setContent(
    '<div id="editorInfo"><div id="feedbackList"></div><div id="notificationEmpty"></div>' +
      [
        "storageNotice",
        "timeAnomalyNotice",
        "oaStaleNotice",
        "setupNotice",
        "yearNotice",
      ]
        .map((id) => `<div id="${id}" class="hidden">notice</div>`)
        .join("") +
      "</div>",
  );
  await page.evaluate(() => {
    const Original = window.MutationObserver;
    window.observerCount = 0;
    window.MutationObserver = class extends Original {
      observe(...args) {
        if (args[0].id === "editorInfo" && !this.active) {
          window.observerCount++;
          this.active = true;
        }
        return super.observe(...args);
      }
      disconnect() {
        if (this.active) window.observerCount--;
        this.active = false;
        return super.disconnect();
      }
    };
  });
  for (const file of [
    "namespace.js",
    "ui/notifications.js",
    "animation-compat.js",
    "notification-motion.js",
  ])
    await page.addScriptTag({
      path: path.resolve(__dirname, "../assets/js", file),
    });
  const result = await page.evaluate(async () => {
    const timers = new Set(),
      nativeSet = window.setTimeout,
      nativeClear = window.clearTimeout;
    window.setTimeout = (callback, delay) => {
      const id = nativeSet(() => {
        timers.delete(id);
        callback();
      }, delay);
      timers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      timers.delete(id);
      nativeClear(id);
    };
    const view = WorkTimeApp.ui.createNotifications({
        document,
        element: (id) => document.getElementById(id),
        icon: () => "",
      }),
      motion = WorkTimeApp.ui.notificationMotion;
    for (let cycle = 0; cycle < 3; cycle++) {
      view.mount();
      view.mount();
      motion.mount();
      motion.mount();
      if (window.observerCount !== 1) throw Error("Duplicate observer");
      view.decorateStaticNotices();
      view.decorateStaticNotices();
      if (
        document.querySelectorAll("#storageNotice .notification-body")
          .length !== 1
      )
        throw Error("Nested static decoration");
      for (let index = 0; index < 5; index++) view.toast("feedback");
      if (timers.size !== 20) throw Error("Unexpected feedback timers");
      const notice = document.getElementById("storageNotice");
      notice.classList.remove("hidden");
      await Promise.resolve();
      await Promise.resolve();
      motion.reveal();
      if (
        !document.getElementById("editorInfo").getAnimations({ subtree: true })
          .length
      )
        throw Error("Visible notice did not animate");
      motion.dispose();
      motion.dispose();
      view.dispose();
      view.dispose();
      view.toast("ignored after disposal");
      motion.reveal();
      if (
        window.observerCount !== 0 ||
        timers.size !== 0 ||
        document.querySelectorAll(".feedback-notice").length !== 0
      )
        throw Error("Disposed notification retained effects");
      if (
        document.getElementById("editorInfo").getAnimations({ subtree: true })
          .length
      )
        throw Error("Disposed animation still running");
      notice.classList.add("hidden");
    }
    window.setTimeout = nativeSet;
    window.clearTimeout = nativeClear;
    return { observers: window.observerCount, timers: timers.size };
  });
  assert.deepEqual(result, { observers: 0, timers: 0 });
  await browser.close();
  console.log(
    "Notification lifetime passed: repeated mount/dispose, idempotent decoration, timers and animations canceled.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
