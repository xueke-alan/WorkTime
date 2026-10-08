"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { snapshot } = require("./helpers/baidu-weather.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({ reducedMotion: "reduce" });
  let requests = 0;
  let latest = false;
  let offline = false;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => {
    requests++;
    if (offline) return route.abort();
    const value = snapshot(false);
    value.updatedAt = latest ? "2026-10-03T16:03:00Z" : "2026-10-03T15:57:00Z";
    for (const city of Object.values(value.cities))
      city.result.now.uptime = latest ? "20261004000200" : "20261003235500";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.clock.install({ time: new Date("2026-10-03T15:58:00Z") });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#date-tab-weather").click();
  await page.evaluate(() => WorkTimeApp.services.weather.setCity("东莞"));
  await page.waitForFunction(
    () =>
      WorkTimeApp.services.weather.snapshot().record &&
      !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert.equal(
    await page.locator(".weather-day time").first().textContent(),
    "10-03",
  );
  const beforeMidnight = requests;
  await page.clock.fastForward(3 * 60000);
  await page.waitForFunction(
    () => !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert(requests > beforeMidnight, "跨日应刷新，不受五分钟间隔限制");
  assert.equal(
    await page.locator(".weather-day time").first().textContent(),
    "10-04",
  );
  assert.equal(await page.locator(".weather-day").count(), 4);
  assert.equal(await page.locator(".weather-time.weather-stale").count(), 1);
  assert.equal(
    (await page.locator(".weather-time").textContent()).includes("旧数据"),
    false,
  );
  latest = true;
  const beforeSync = requests;
  await page.clock.fastForward(5 * 60000);
  await page.waitForFunction(
    () =>
      WorkTimeApp.services.weather.snapshot().record.validAt ===
        "2026-10-04T00:02:00+08:00" &&
      !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert(requests > beforeSync, "新快照应在五分钟内同步");
  assert(
    !(await page.locator(".weather-time").textContent()).includes("旧数据"),
  );
  offline = true;
  await page.evaluate(() => WorkTimeApp.services.weather.refresh(true));
  assert.equal(
    await page.locator(".weather-temperature").textContent(),
    "23°C",
  );
  assert(
    (await page.locator("#dateInfoPanel").textContent()).includes("最近缓存"),
  );
  assert.deepEqual(errors, []);
  offline = false;
  await page.locator("#date-tab-notifications").click();
  const calendarRequests = requests;
  await page.clock.fastForward(6 * 60000);
  await page.waitForFunction(
    () => !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert(
    requests > calendarRequests,
    "Calendar demand refreshes weather with the detail tab closed",
  );
  const exitRequests = requests;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    void WorkTimeApp.services.weather.refresh(true);
  });
  await page.clock.fastForward(6 * 60000);
  assert.equal(
    requests,
    exitRequests,
    "Disposed subscriptions and requests remain stopped",
  );
  console.log(
    "Weather freshness: midnight refresh, five-minute sync, expired forecast filtering and offline cache passed",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
