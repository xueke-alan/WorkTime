"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1244 },
      reducedMotion: "reduce",
      timezoneId: "Asia/Shanghai",
    });
    await page.clock.install({ time: new Date("2026-10-03T12:00:00+08:00") });
    const state = buildPerformanceFixture(1).state;
    const log = state.imports.find((item) => item.id === "perf-2026-09");
    state.imports.push({
      ...log,
      id: "newer-unaccepted",
      records: [],
      at: "2026-10-03T00:50:00+08:00",
      count: 0,
    });
    // A current record without an explicit association chooses accepted history before raw-only occurrences.
    if (width === 390) delete state.days["2026-09-24"].oa.importId;
    await page.addInitScript(
      (state) =>
        localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
      state,
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#prevMonth").click();
    await page.locator('[data-date="2026-09-24"]').click();
    await page.locator("#sourceOpen").click();
    assert(await page.locator("#sourceDialog").isVisible());
    assert(
      await page
        .locator("#sourceDialog")
        .evaluate((element) =>
          element.classList.contains("import-detail-view"),
        ),
    );
    assert.equal(
      await page
        .locator("#sourceBody .source-record-text, #sourceBody details")
        .count(),
      0,
    );
    const snapshot = () =>
      page.locator("#sourceDialog").evaluate((element) => ({
        title: element.querySelector("h2").textContent,
        raw: element.querySelector("textarea").value,
        readonly: element.querySelector("textarea").readOnly,
        dates: [
          ...element.querySelectorAll(".import-parsed-list article strong"),
        ].map((item) => item.textContent),
        pagination: element.querySelector(".dialog-foot").textContent,
      }));
    const fromDay = await snapshot();
    assert(fromDay.readonly);
    assert.equal(
      fromDay.raw,
      log.sources.map((source) => source.raw).join("\n\n"),
    );
    assert(fromDay.dates.includes("2026/09/24"));
    await page.locator("#importOpen").click();
    await page.locator("#importOpen").click();
    await page.locator('[data-view-import="perf-2026-09"]').click();
    assert.deepEqual(await snapshot(), fromDay);
    await page.locator('[data-detail-step="-1"]').click();
    assert.notEqual((await snapshot()).title, fromDay.title);
    console.log(
      width +
        "px: source entry and import history reuse identical preview, correct import selection and pagination.",
    );
    await page.close();
  }
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
