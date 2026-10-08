"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("worktime.dateInfo.activeTab", "countdown");
    document.addEventListener("DOMContentLoaded", () => {
      const notice = document.createElement("div");
      notice.className = "info-notification tone-warning";
      notice.innerHTML = '<div class="notification-body">首屏已有通知</div>';
      document.getElementById("feedbackList").prepend(notice);
    });
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
  assert.equal(
    await page.locator("#date-tab-countdown").getAttribute("aria-selected"),
    "true",
    "首屏已有通知不应替换上次选择的窗口",
  );
  await page.locator("#date-tab-countdown").click();
  await page.evaluate(() => {
    const notice = document.createElement("div");
    notice.id = "testNotification";
    notice.className = "info-notification tone-warning";
    notice.innerHTML =
      '<span class="ring-count">3</span><div class="notification-body">新的通知</div>';
    document.getElementById("feedbackList").prepend(notice);
  });
  await page.waitForFunction(
    () => !document.getElementById("editorInfo").hidden,
  );
  assert.equal(
    await page.locator("#date-tab-notifications").getAttribute("aria-selected"),
    "true",
  );
  await page.locator("#date-tab-countdown").click();
  await page.evaluate(() => {
    const notice = document.getElementById("testNotification");
    notice.querySelector(".ring-count").textContent = "2";
    notice.querySelector(".notification-body").textContent = "新的通知";
  });
  assert.equal(
    await page.locator("#date-tab-countdown").getAttribute("aria-selected"),
    "true",
    "倒计时与相同内容刷新不应切回通知",
  );
  await page.evaluate(
    () =>
      (document.querySelector(
        "#testNotification .notification-body",
      ).firstChild.data = "通知内容有更新"),
  );
  await page.waitForFunction(
    () => !document.getElementById("editorInfo").hidden,
  );
  await page.locator("#date-tab-countdown").click();
  await page.evaluate(() =>
    document.getElementById("testNotification").classList.add("hidden"),
  );
  assert.equal(
    await page.locator("#date-tab-countdown").getAttribute("aria-selected"),
    "true",
    "删除通知不应切换",
  );
  await page.evaluate(() =>
    document.getElementById("testNotification").classList.remove("hidden"),
  );
  await page.waitForFunction(
    () => !document.getElementById("editorInfo").hidden,
  );
  console.log(
    "Notification switch: startup preserves the saved tab; new, updated and reappearing notices switch tabs; unchanged notices and countdown updates do not",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
