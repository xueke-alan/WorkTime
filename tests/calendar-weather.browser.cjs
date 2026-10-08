"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 2250, height: 1244 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.clock.install({ time: new Date("2026-10-28T12:00:00+08:00") });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => {
    const dates = [
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ];
    const codes = [0, 0, 2, 61, 71, 45, 95, 3, 0];
    window.testWeather = {
      city: { name: "北京" },
      record: {
        daily: dates.map((date, i) => ({ date, weatherCode: codes[i] })),
      },
    };
    WorkTimeApp.services.weather.snapshot = () => window.testWeather;
    WorkTimeApp.ui.calendarWeather.refresh();
  });
  assert.equal(await page.locator(".calendar-weather-icon").count(), 5);
  const icons = await page
    .locator(".calendar-weather-icon")
    .evaluateAll((nodes) =>
      nodes.map((svg) => ({
        date:
          svg.parentElement.dataset.date ||
          svg.parentElement.dataset.previewDate,
        href: svg.querySelector("img").getAttribute("src"),
        label: svg.title,
        opacity: Number(getComputedStyle(svg).opacity),
        pointerEvents: getComputedStyle(svg).pointerEvents,
      })),
    );
  assert.deepEqual(
    icons.map((row) => row.date),
    ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
  );
  assert.deepEqual(
    icons.map((row) => row.href),
    [
      "assets/icons/meteocons/svg/clear-day.svg",
      "assets/icons/meteocons/svg/partly-cloudy-day.svg",
      "assets/icons/meteocons/svg/rain.svg",
      "assets/icons/meteocons/svg/snow.svg",
      "assets/icons/meteocons/svg/fog.svg",
    ],
  );
  assert(
    icons.every((row) => row.opacity === 0.5 && row.pointerEvents === "none"),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".calendar-weather-icon img")].every(
      (image) =>
        image.complete &&
        image.naturalWidth > 0 &&
        image.currentSrc.includes("svg-static/"),
    ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('.day[data-date="2026-10-31"]').click();
  await page.evaluate(() => {
    window.retainedWeather = [
      ...document.querySelectorAll(".calendar-weather-icon"),
    ];
  });
  await page.locator("#plannedOvertimeToggle").click();
  await page.locator("#dayStart").fill("09:00");
  await page.locator("#dayEnd").fill("18:00");
  assert.ok(
    await page.evaluate(() =>
      window.retainedWeather.every(
        (picture) =>
          picture.isConnected &&
          picture.parentElement.querySelector(".calendar-weather-icon") ===
            picture &&
          getComputedStyle(picture).opacity === "0.5" &&
          picture.getAnimations().length === 0,
      ),
    ),
    "Attendance edits keep weather nodes attached without restarting their fade",
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".calendar-weather-icon img")].every(
      (image) =>
        image.complete &&
        image.naturalWidth > 0 &&
        image.currentSrc.includes("/svg/"),
    ),
  );
  // Returning to the page reloads animated SVG resources, without refresh undoing it.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(
    await page.locator('.calendar-weather-icon img[src*="?resume="]').count(),
    0,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(32);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".calendar-weather-icon img")].every(
      (image) =>
        image.complete &&
        image.naturalWidth > 0 &&
        image.currentSrc.includes("?resume="),
    ),
  );
  const resumed = await page
    .locator(".calendar-weather-icon img")
    .first()
    .getAttribute("src");
  await page.evaluate(() => WorkTimeApp.ui.calendarWeather.refresh());
  assert.equal(
    await page
      .locator(".calendar-weather-icon img")
      .first()
      .getAttribute("src"),
    resumed,
  );
  const animatedIcon = page.locator(
    '.day[data-date="2026-10-30"] .calendar-weather-icon',
  );
  const firstFrame = await animatedIcon.screenshot();
  await page.waitForTimeout(400);
  assert.notDeepEqual(
    await animatedIcon.screenshot(),
    firstFrame,
    "rain animates after resume",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page.clock.runFor(32);
  assert.equal(
    await page
      .locator(".calendar-weather-icon img")
      .first()
      .getAttribute("src"),
    resumed,
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fs = require("node:fs");
  for (const name of [
    "clear-day",
    "partly-cloudy-day",
    "cloudy",
    "rain",
    "snow",
    "fog",
    "thunderstorms",
  ]) {
    const asset = fs.readFileSync(
      path.resolve(__dirname, "../assets/icons/meteocons/svg", name + ".svg"),
      "utf8",
    );
    assert(/<animate(?:Transform)?\b/.test(asset), name + " must animate");
    assert(
      !/<script\b|(?:href|src)=["']https?:/i.test(asset),
      name + " must be self-contained",
    );
  }
  await page.locator('.day[data-date="2026-10-29"]').click();
  assert.equal(
    await page
      .locator('.day[data-date="2026-10-29"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator(".calendar-weather-icon").count(), 5);
  await page.locator("#calendar").screenshot({
    path: path.resolve(__dirname, "../test-results/calendar-weather.png"),
  });
  await page.evaluate(() => {
    window.testWeather.city.name = "上海";
    WorkTimeApp.ui.calendarWeather.refresh();
  });
  assert(
    (
      await page.locator(".calendar-weather-icon").first().getAttribute("title")
    ).startsWith("上海"),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const outgoing = await page.evaluate(() => {
    window.testWeather.city.name = "广州";
    window.testWeather.record.daily.forEach((row) => {
      row.weatherCode = 0;
    });
    WorkTimeApp.ui.calendarWeather.refresh();
    return document.querySelectorAll(".calendar-weather-outgoing").length;
  });
  assert.equal(outgoing, 5, "Previous weather icons fade out on city change");
  assert.ok(
    await page
      .locator(".calendar-weather-icon")
      .evaluateAll((nodes) =>
        nodes.every((el) => getComputedStyle(el).opacity === "0"),
      ),
    "New icons wait for the outgoing fade",
  );
  assert.ok(
    await page
      .locator(".calendar-weather-outgoing")
      .evaluateAll((nodes) =>
        nodes.every((el) => getComputedStyle(el).transform === "none"),
      ),
    "Outgoing icons do not move",
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".calendar-weather-icon")].some(
      (el) => el.getAnimations().length > 0,
    ),
  );
  await page.evaluate(() => {
    window.testWeather.city.name = "深圳";
    WorkTimeApp.ui.calendarWeather.refresh();
    window.testWeather.city.name = "杭州";
    WorkTimeApp.ui.calendarWeather.refresh();
  });
  assert.ok(
    (await page.locator(".calendar-weather-outgoing").count()) <= 5,
    "Rapid switches retain at most one outgoing layer per cell",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".calendar-weather-outgoing").length === 0,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".calendar-weather-icon")].every(
      (el) => el.getAnimations().length === 0,
    ),
  );
  assert.ok(
    (
      await page.locator(".calendar-weather-icon").first().getAttribute("title")
    ).startsWith("杭州"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#nextMonth").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".calendar-weather-icon").length === 5,
  );
  assert.deepEqual(
    await page
      .locator(".calendar-weather-icon")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.parentElement.dataset.date ||
            node.parentElement.dataset.previewDate,
        ),
      ),
    ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
    "The five-day window includes today and excludes later days across month navigation",
  );
  assert.equal(
    await page
      .locator(
        '[data-date="2026-11-02"] .calendar-weather-icon, [data-date="2026-11-03"] .calendar-weather-icon',
      )
      .count(),
    0,
  );
  await page.evaluate(() => {
    window.testWeather = { city: null, record: null };
    WorkTimeApp.ui.calendarWeather.refresh();
  });
  assert.equal(await page.locator(".calendar-weather-icon").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Calendar weather: today plus four days, cross-month boundary exclusions, all icon types, city changes, missing data and day selection passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
