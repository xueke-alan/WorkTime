"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(() => {
        const start = window.setInterval,
          stop = window.clearInterval;
        window.noteTimers = new Set();
        window.setInterval = (callback, delay, ...args) => {
          const id = start(callback, delay, ...args);
          if (delay === 2600) window.noteTimers.add(id);
          return id;
        };
        window.clearInterval = (id) => {
          window.noteTimers.delete(id);
          stop(id);
        };
      });
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#monthTitle").click();
      await page.locator("#yearViewToggle").waitFor();
      assert.equal(await page.locator(".year-month").count(), 12);
      assert.equal(
        await page.evaluate(() => window.noteTimers.size),
        0,
        "heatmap has no invisible text ticker",
      );
      await page.locator("#yearViewToggle").click();
      assert.equal(
        await page.evaluate(() => window.noteTimers.size),
        0,
        "reduced motion has no ticker",
      );
      await page.evaluate(() => {
        window.firstYearDay = document.querySelector("[data-year-date]");
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => window.noteTimers.size === 1);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.evaluate(() => window.noteTimers.size), 0);
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => window.noteTimers.size === 1);
      await page.locator("#yearViewToggle").click();
      assert.equal(await page.evaluate(() => window.noteTimers.size), 0);
      assert.equal(
        await page.evaluate(
          () =>
            window.firstYearDay === document.querySelector("[data-year-date]"),
        ),
        true,
        "display changes preserve day nodes",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      const month = page.locator("[data-year-month-switch]").first();
      const key = await month.getAttribute("data-year-month-switch");
      await month.click();
      assert.equal(await month.getAttribute("aria-pressed"), "true");
      assert.equal(
        await page.locator("#sidebarYearMonthText").getAttribute("data-month"),
        key,
      );
      const overflow = await page
        .locator("#calendar")
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, "year view fits viewport");
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Year display switching, stable day nodes, month consistency, responsive layout, visibility and motion-aware ticker verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
