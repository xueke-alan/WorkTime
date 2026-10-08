"use strict";

const assert = require("node:assert/strict"),
  path = require("node:path");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.goto(url);
  await page.evaluate(() => {
    const s = WorkTimeApp.domain.state.defaultState(),
      date = "2026-09-28";
    s.days[date] = {
      oa: {
        date,
        start: "08:00",
        end: "17:30",
        nextDay: false,
        status: "complete",
        source: "old",
        raw: "",
        importId: "",
      },
    };
    localStorage.setItem(WorkTimeApp.domain.state.KEY, JSON.stringify(s));
  });
  await page.reload();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: async () => "09/28\n08:00\n20:00" },
      configurable: true,
    }),
  );
  await page.locator("[data-import-clipboard]").click();
  await page.locator("#importDialog").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
          "2026-09-28"
        ].oa.end,
    ),
    "17:30",
  );
  await page.locator('[data-conflict="0"]').selectOption("old");
  await page.locator("#commitImport").click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY))
          .imports[0].records.length,
    ),
    0,
  );
  await page.locator("[data-import-clipboard]").click();
  await page.locator("#importDialog").waitFor({ state: "visible" });
  await page.locator('[data-conflict="0"]').selectOption("new");
  await page.locator("#commitImport").click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
          "2026-09-28"
        ].oa.end,
    ),
    "20:00",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: async () => "09/29\n08:00\n17:30" },
      configurable: true,
    }),
  );
  await page.locator("[data-import-clipboard]").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
        "2026-09-29"
      ]?.oa,
  );
  assert.equal(
    await page.locator("#importDialog").evaluate((e) => e.open),
    false,
  );
  await page.clock.setFixedTime(new Date("2027-01-05T12:00:00+08:00"));
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () =>
          ["12/30", "12/31", "01/01", "01/02", "01/03", "01/04", "01/05"]
            .map((date) => date + "\n08:00\n17:30")
            .join("\n"),
      },
      configurable: true,
    }),
  );
  await page.locator("[data-import-clipboard]").click();
  await page.locator("#importDialog").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#importWarnings").textContent(),
    /2026-12-30.*跨年/,
  );
  await page.locator("#commitImport").click();
  const dates = await page.evaluate(() =>
    Object.keys(
      JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days,
    )
      .filter((date) => date.startsWith("2026-12") || date.startsWith("2027-"))
      .sort(),
  );
  assert.deepEqual(dates, [
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
    "2027-01-04",
    "2027-01-05",
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "Import browser passed: clipboard conflict preview, explicit keep/replace, rejected history empty and conflict-free quick commit.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
