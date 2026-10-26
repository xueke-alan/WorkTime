"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const width of [1480, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.install({ time: new Date("2026-12-31T12:00:00+08:00") });
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      const ready = () =>
        page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
      await ready();
      await page.locator("#agendaMode").click();
      for (const view of ["week", "fortnight", "threeweek"]) {
        await page.locator("#agendaViewToggle").click();
        assert.equal(
          await page.locator("#agendaViewToggle").getAttribute("data-view"),
          view,
        );
      }
      const dates = () =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll("#calendar > .day[data-agenda-week]"),
          ].map((card) => card.dataset.date || card.dataset.previewDate),
        );
      const original = await dates();
      assert.equal(original.length, 21);
      assert.equal(original[0], "2026-12-28");
      assert.equal(original[20], "2027-01-17");
      assert.equal(
        await page.locator("#calendar").getAttribute("data-agenda-rows"),
        "3",
      );
      const rows = await page
        .locator("#calendar")
        .evaluate((node) =>
          getComputedStyle(node).gridTemplateRows.split(" ").map(parseFloat),
        );
      assert.equal(rows.length, 3);
      assert.ok(rows.every((height) => height > 0));
      const title = await page.locator("#monthTitle").textContent();
      await page
        .locator('[data-preview-date="2027-01-17"] .day-select')
        .click({ position: { x: 8, y: 8 } });
      assert.deepEqual(await dates(), original);
      assert.equal(await page.locator("#monthTitle").textContent(), title);
      await page.locator("#nextMonth").click();
      assert.equal((await dates())[0], "2027-01-04");
      await page.locator("#prevMonth").click();
      assert.deepEqual(await dates(), original);
      await page.reload();
      await ready();
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("data-view"),
        "threeweek",
      );
      assert.equal((await dates()).length, 21);
      await page.locator("#agendaViewToggle").click();
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("data-view"),
        "month",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Three-week cycling, 21 dates across years, selection, weekly navigation, persistence and desktop/mobile rows verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
