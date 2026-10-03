"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const data = path.resolve(__dirname, "../assets/data/weather");
const index = JSON.parse(fs.readFileSync(path.join(data, "index.json")));
const locationIds = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../assets/data/weather-locations.json"),
  ),
);
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  let offline = false,
    holdShanghai = false,
    releaseShanghai,
    mismatch = false;
  const external = [],
    errors = [];
  await context.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    external.push(url);
    if (!url.hostname.endsWith(".github.io") || offline) return route.abort();
    const file = path.basename(url.pathname);
    if (holdShanghai && file === "2e9414ca.json")
      await new Promise((resolve) => {
        releaseShanghai = resolve;
      });
    if (!fs.existsSync(path.join(data, file)))
      return route.fulfill({ status: 404, body: "missing" });
    const value = JSON.parse(fs.readFileSync(path.join(data, file)));
    if (mismatch && file !== "index.json") value.version = "different-version";
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(value),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date(index.generatedAt) });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#date-tab-weather").click();
  await page.waitForFunction(() =>
    document
      .getElementById("dateInfoPanel")
      .textContent.includes("请在设置中选择"),
  );
  await page.locator("#settingsOpen").click();
  await page.locator("#workCity").focus();
  assert.equal(
    await page.locator("#workCityOptions [data-city]").count(),
    locationIds.length,
  );
  await page.locator("#workCity").fill("上海市");
  await page.locator("#date-tab-weather").click();
  await page.waitForFunction(
    () => window.WorkWeather.snapshot().record?.cityId === "101020100",
  );
  assert.equal(await page.locator(".weather-hour").count(), 24);
  assert.equal(await page.locator(".weather-day").count(), 7);
  assert((await page.locator("#dateInfoPanel").textContent()).includes("上海"));
  for (const [name, id] of [
    ["北京", "101010100"],
    ["深圳", "101280601"],
    ["东莞", "101281601"],
    ["成都", "101270101"],
    ["西安", "101110101"],
  ]) {
    if (!(await page.locator("#settingsDialog").evaluate((el) => el.open)))
      await page.locator("#settingsOpen").click();
    await page.locator("#workCity").fill(name);
    await page.locator("#date-tab-weather").click();
    await page.waitForFunction(
      (id) => window.WorkWeather.snapshot().record?.cityId === id,
      id,
    );
    assert.equal(
      await page.locator(".weather-heading strong").textContent(),
      name,
    );
  }
  if (await page.locator("#settingsDialog").evaluate((el) => el.open))
    await page.locator("#settingsOpen").click();
  await page.screenshot({
    path: path.resolve(__dirname, "../docs/weather-1600.png"),
  });
  // A slow response for the previous city must not replace the new city.
  holdShanghai = true;
  await page.evaluate(() => window.WorkWeather.setCity("上海"));
  await page.waitForFunction(() => window.WorkWeather.snapshot().loading);
  for (let i = 0; i < 20 && !releaseShanghai; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(releaseShanghai);
  await page.evaluate(() => window.WorkWeather.setCity("北京"));
  releaseShanghai();
  holdShanghai = false;
  await page.waitForFunction(() => !window.WorkWeather.snapshot().loading);
  assert.equal(
    await page.evaluate(() => window.WorkWeather.snapshot().record.cityId),
    "101010100",
  );
  offline = true;
  await page.evaluate(() => window.WorkWeather.refresh(true));
  assert(
    (await page.locator("#dateInfoPanel").textContent()).includes("最近缓存"),
  );
  assert.equal(
    await page.locator(".weather-heading strong").textContent(),
    "北京",
  );
  await page.clock.fastForward(4 * 3600000);
  assert(
    (await page.locator(".weather-stale").textContent()).includes("旧数据"),
  );
  await page.evaluate(() => window.WorkWeather.setCity("未知城市"));
  assert(
    (await page.locator("#dateInfoPanel").textContent()).includes("尚未收录"),
  );
  assert.equal(await page.locator(".weather-temperature").count(), 0);
  // Reload with persistent settings and no network: cached city data remains available.
  if (!(await page.locator("#settingsDialog").evaluate((el) => el.open)))
    await page.locator("#settingsOpen").click();
  await page.locator("#workCity").fill("西安");
  await page.locator("#date-tab-weather").click();
  await page.reload();
  await page.waitForFunction(() => !window.WorkWeather.snapshot().loading);
  assert.equal(
    await page.locator(".weather-heading strong").textContent(),
    "西安",
  );
  assert.equal(await page.locator(".weather-day").count(), 7);
  offline = false;
  mismatch = true;
  await page.evaluate(() => window.WorkWeather.refresh(true));
  assert(
    (await page.locator("#dateInfoPanel").textContent()).includes("最近缓存"),
  );
  mismatch = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workspace > .editor").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve(__dirname, "../docs/weather-390.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert(external.every((url) => url.hostname.endsWith(".github.io")));
  assert(external.some((url) => url.pathname.endsWith("index.json")));
  assert(
    external.every((url) =>
      /\/assets\/data\/weather\/(index|[a-f0-9]{8})\.json$/.test(url.pathname),
    ),
  );
  assert.deepEqual(errors, []);
  // First load without cache must show an error, never another city's data.
  const emptyContext = await browser.newContext();
  await emptyContext.route(/^https?:/, (route) => route.abort());
  const empty = await emptyContext.newPage();
  await empty.goto(
    pathToFileURL(path.resolve(__dirname, "../index.html")).href,
  );
  await empty.locator("#date-tab-weather").click();
  await empty.evaluate(() => window.WorkWeather.setCity("上海"));
  await empty.waitForFunction(() => !window.WorkWeather.snapshot().loading);
  assert.equal(await empty.locator(".weather-temperature").count(), 0);
  assert(
    (await empty.locator("#dateInfoPanel").textContent()).includes("上海"),
  );
  assert(await empty.locator(".date-info-empty").count());
  await emptyContext.close();
  await context.close();
  console.log(
    "weather browser: all cities, settings, race, cache, stale, missing data, versions, github.io-only and layouts passed",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
