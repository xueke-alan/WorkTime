"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({ timezoneId: "America/Los_Angeles" });
  await page.route(/^https?:/, (r) => r.abort());
  await page.clock.install({ time: new Date("2026-10-04T03:45:00+08:00") });
  await page.goto(pathToFileURL(path.resolve("index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  const render = async (rows) =>
    page.evaluate((rows) => {
      const panel = document.querySelector("#dateInfoPanel");
      WorkTimeApp.ui.weather.render(panel, {
        city: { name: "东莞" },
        record: {
          current: {},
          validAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          daily: [],
          hourly: rows.map(([time, temperature]) => ({
            time,
            temperature,
            precipitationProbability: 70,
          })),
        },
      });
      return [...panel.querySelectorAll(".weather-hour")].map((el) => ({
        time: el.querySelector("time").textContent,
        datetime: el.querySelector("time").dateTime,
        temperature: el.querySelector("strong").textContent,
      }));
    }, rows);
  let cards = await render([
    ["2026-10-04T01:00:00+08:00", 21],
    ["2026-10-04T03:00:00+08:00", 23],
    ["2026-10-04T05:00:00+08:00", 25],
    ["2026-10-04T15:00:00+08:00", 35],
  ]);
  assert.deepEqual(
    cards.map((c) => c.time),
    Array.from(
      { length: 12 },
      (_, i) => String(i + 3).padStart(2, "0") + ":00",
    ),
  );
  assert.equal(cards[0].temperature, "23°");
  assert.equal(cards[1].temperature, "暂无");
  assert.equal(cards[2].temperature, "25°");
  cards = await render([]);
  assert.equal(cards.length, 12);
  assert.equal(cards[0].time, "03:00");
  assert(cards.every((c) => c.temperature === "暂无"));
  await page.clock.setFixedTime(new Date("2026-10-04T23:45:00+08:00"));
  cards = await render([["2026-10-05T00:00:00+08:00", 24]]);
  assert.equal(cards[0].time, "23:00");
  assert.equal(cards[1].time, "00:00");
  assert.equal(cards[1].temperature, "24°");
  assert.equal(cards[11].time, "10:00");
  assert.equal(cards[1].datetime, "2026-10-04T16:00:00.000Z");
  await browser.close();
  console.log(
    "Hourly weather window: current Beijing hour, gaps, missing forecasts, stale hours, timezone independence and midnight passed.",
  );
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
