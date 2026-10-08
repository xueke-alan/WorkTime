"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { snapshot } = require("./helpers/baidu-weather.cjs");
const locations = require("../assets/data/weather-locations.json");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  let offline = false,
    invalid = false,
    hourly = true,
    release,
    hold = false;
  const requests = [],
    errors = [];
  await context.route(/^https?:/, async (route) => {
    const url = route.request().url();
    requests.push(url);
    assert.equal(new URL(url).hostname, "raw.githubusercontent.com");
    assert(url.endsWith("/data/weather.json"));
    if (offline) return route.abort();
    if (hold) {
      hold = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    const value = snapshot(hourly);
    if (invalid) value.schemaVersion = 0;
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(value),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-03T04:17:00Z") });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#pageSettingsOpen").click();
  await page.locator("#workCity").focus();
  assert.deepEqual(
    await page.locator("#workCityOptions .work-city-name").allTextContents(),
    locations.map((city) => city.name + "市"),
  );
  await page.locator("#workCity").press("Escape");
  await page.locator("#date-tab-weather").click();
  for (const { name, id } of locations) {
    await page.evaluate(
      (name) => WorkTimeApp.services.weather.setCity(name),
      name,
    );
    await page.waitForFunction(
      (id) =>
        WorkTimeApp.services.weather.snapshot().record?.cityId === id &&
        !WorkTimeApp.services.weather.snapshot().loading,
      id,
    );
    const text = await page.locator("#dateInfoPanel").textContent();
    assert(
      text.includes(name) &&
        text.includes("23°C") &&
        text.includes("东北风") &&
        text.includes("3级") &&
        text.includes("暂无"),
    );
  }
  assert.equal(await page.locator(".weather-day").count(), 5);
  assert.deepEqual(await page.locator(".weather-day-uv").allTextContents(), [
    "UV 2",
    "UV 5",
    "UV 7",
    "UV 10",
    "UV 11",
  ]);
  assert.deepEqual(
    await page
      .locator(".weather-uv-value")
      .evaluateAll((values) => values.map((el) => getComputedStyle(el).color)),
    [
      "rgb(62, 167, 45)",
      "rgb(255, 243, 0)",
      "rgb(241, 139, 0)",
      "rgb(229, 50, 16)",
      "rgb(181, 103, 164)",
    ],
  );
  assert.equal(
    await page.locator(".weather-day-uv").nth(2).getAttribute("aria-label"),
    "紫外线等级 强 · 指数 7",
  );
  for (const id of [
    "weather-forecast-tab-daily",
    "weather-forecast-daily",
    "weather-forecast-tab-hourly",
    "weather-forecast-hourly",
  ]) {
    const mode = id.endsWith("daily") ? "daily" : "hourly";
    await page.locator("#weather-forecast-tab-" + mode).click();
    await page.locator("#" + id).focus();
    await page.evaluate(() => WorkTimeApp.services.weather.refresh(true));
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      id,
      "Weather refresh preserves the focused forecast tab or panel",
    );
  }
  for (const mode of ["daily", "hourly"]) {
    await page.locator("#weather-forecast-tab-" + mode).click();
    await page.locator("#date-tab-notifications").click();
    await page.locator("#date-tab-weather").click();
    assert.equal(
      await page
        .locator("#weather-forecast-tab-" + mode)
        .getAttribute("aria-selected"),
      "true",
      "Reopening weather preserves the selected forecast",
    );
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.weather.setCity("苏州"));
    await page.waitForFunction(
      () =>
        !!WorkTimeApp.services.weather.snapshot().record &&
        !WorkTimeApp.services.weather.snapshot().loading,
    );
    assert.equal(
      await page
        .locator("#weather-forecast-tab-" + mode)
        .getAttribute("aria-selected"),
      "true",
      "Reloading the page restores the selected forecast",
    );
  }
  hourly = false;
  await page.evaluate(() => WorkTimeApp.services.weather.refresh(true));
  assert.equal(await page.locator(".weather-hour").count(), 12);
  assert(
    (await page.locator(".weather-hour").first().textContent()).includes(
      "暂无",
    ),
  );
  assert(
    (
      await page
        .locator("#dateInfoPanel")
        .evaluate(
          (el) =>
            el.textContent +
            [...el.querySelectorAll("[title]")]
              .map((node) => node.title)
              .join(" "),
        )
    ).includes("百度"),
  );
  hold = true;
  await page.evaluate(() => WorkTimeApp.services.weather.setCity("上海"));
  for (let i = 0; i < 30 && !release; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(release);
  await page.evaluate(() => WorkTimeApp.services.weather.setCity("北京"));
  release();
  await page.waitForFunction(
    () => !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert.equal(
    await page.evaluate(
      () => WorkTimeApp.services.weather.snapshot().record.cityId,
    ),
    "101010100",
  );
  for (const mode of ["offline", "invalid"]) {
    offline = mode === "offline";
    invalid = mode === "invalid";
    await page.locator("#weather-forecast-tab-daily").click();
    await page.evaluate(() => WorkTimeApp.services.weather.refresh(true));
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "weather-forecast-tab-daily",
      "Failed refresh keeps focus on the selected forecast tab",
    );
    assert(
      (await page.locator("#dateInfoPanel").textContent()).includes("最近缓存"),
    );
  }
  offline = true;
  await page.clock.fastForward(3 * 3600000);
  assert(await page.locator(".weather-stale").count());
  if (await page.locator("#settingsDialog").evaluate((el) => el.open))
    await page.locator("#settingsOpen").click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.evaluate(() => WorkTimeApp.services.weather.setCity("未知城市"));
  assert.equal(await page.locator(".weather-temperature").count(), 0);
  assert(requests.length >= 10);
  assert.deepEqual(errors, []);
  await context.close();
  const emptyContext = await browser.newContext();
  await emptyContext.route(/^https?:/, (route) => route.abort());
  const empty = await emptyContext.newPage();
  await empty.goto(
    pathToFileURL(path.resolve(__dirname, "../index.html")).href,
  );
  await empty.locator("#date-tab-weather").click();
  await empty.evaluate(() => WorkTimeApp.services.weather.setCity("上海"));
  await empty.waitForFunction(
    () => !WorkTimeApp.services.weather.snapshot().loading,
  );
  assert.equal(await empty.locator(".weather-temperature").count(), 0);
  await emptyContext.close();
  console.log(
    "Baidu browser: ten cities, selector labels, optional hourly, cache, race, stale and mobile passed",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
