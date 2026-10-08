"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const timezoneId of [
    "Asia/Shanghai",
    "America/Los_Angeles",
    "Pacific/Auckland",
  ]) {
    const context = await browser.newContext({
      timezoneId,
      viewport: { width: 1600, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-12-31T23:59:59+08:00") });
    await page.goto(url);
    await page.locator("#todayButton").waitFor({ state: "visible" });
    assert.match(await page.locator("#editorDate").textContent(), /2026-12-31/);
    await page.locator("#dayStart").fill("bad");
    await page.clock.fastForward(2000);
    assert.equal(
      await page.locator("#dayStart").inputValue(),
      "bad",
      "midnight preserves invalid edit",
    );
    assert.match(
      await page.locator("#editorDate").textContent(),
      /2026-12-31/,
      "midnight preserves selection",
    );
    assert.equal(
      await page.locator('[data-date="2026-12-31"].today').count(),
      0,
    );
    await page.locator("#todayButton").click();
    assert.match(await page.locator("#editorDate").textContent(), /2027-01-01/);
    assert.equal(
      await page.locator('[data-date="2027-01-01"].today').count(),
      1,
    );
    assert.equal(
      await page
        .locator("#yearNotice")
        .evaluate((e) => e.classList.contains("hidden")),
      false,
    );
    await page.locator("#prevMonth").click();
    assert.equal(
      await page
        .locator("#yearNotice")
        .evaluate((e) => e.classList.contains("hidden")),
      true,
      "2026 has calendar data",
    );
    const expected = await page.evaluate(() => {
      const s = WorkTimeApp.domain.state.defaultState();
      return (
        WorkTimeApp.domain.statistics.targetPace(
          s,
          "2026-12-01",
          "2026-12-31",
          "2027-01-01",
          s.overtimeRequirements[0],
        ).difference / 60
      );
    });
    assert.equal(
      await page.locator("#targetTotalLabel").textContent(),
      "记录内差额",
    );
    assert.equal(
      Number(
        await page
          .locator("#targetMetric .summary-number-accessible")
          .textContent(),
      ),
      expected,
    );
    assert.equal(await page.locator("#targetResult").textContent(), "");
    assert.equal(
      (
        await page
          .locator("#targetDailyMetric .summary-number-accessible")
          .textContent()
      ).trim(),
      "0.0",
    );
    if (timezoneId === "Asia/Shanghai") {
      await page.locator(".target-panel").screenshot({
        path: path.resolve(
          __dirname,
          "../test-results/refactor-historical-target-missing-data.png",
        ),
      });
      await page.locator("#monthTitle").click();
      for (let year = 2026; year >= 2020; year--) {
        assert.equal(
          await page
            .locator("#yearNotice")
            .evaluate((e) => e.classList.contains("hidden")),
          true,
          `${year} calendar is covered`,
        );
        await page.locator("#prevMonth").click();
      }
      assert.equal(
        await page
          .locator("#yearNotice")
          .evaluate((e) => e.classList.contains("hidden")),
        false,
        "2019 calendar is not covered",
      );
      await page.locator('[data-year-date="2019-01-01"]').click();
      assert.equal(
        await page
          .locator("#yearNotice")
          .evaluate((e) => e.classList.contains("hidden")),
        false,
        "month view uses same coverage",
      );
    }
    await page.clock.setSystemTime(new Date("2030-01-01T12:00:00+08:00"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator("#todayButton").click();
    assert.match(
      await page.locator("#editorDate").textContent(),
      /2030-01-01/,
      "resume skips multiple dates",
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  await browser.close();
  console.log(
    "Date browser passed in three host time zones: China year boundary, invalid draft/selection retained, fresh Today, real historical shortfall, calendar coverage and multi-day resume.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
