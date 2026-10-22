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
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForTimeout(1000);
    const counterStable = await page.evaluate(() => {
      const counter = document.createElement("strong");
      WorkTimeApp.games.paintCounter(counter, 42);
      const text = counter.firstChild;
      WorkTimeApp.games.paintCounter(counter, 42);
      return text === counter.firstChild;
    });
    await page.evaluate(() => {
      window.editorDateNode = document.querySelector("#editorDate").firstChild;
    });
    await page.locator("#dayStart").fill("08:15");
    await page.locator("#dayStart").press("Tab");
    await page.waitForTimeout(300);
    const dateStable = await page.evaluate(
      () =>
        window.editorDateNode ===
        document.querySelector("#editorDate").firstChild,
    );
    await page.locator("#date-tab-games").click();
    await page.locator('#gamesPanel [data-game="game-jump"]').click();
    await page
      .locator('#gamesPanel [data-game="game-jump"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
    await page.locator('[data-jump-action="start"]').click();
    await page.waitForTimeout(1000);
    await page.locator(".jump-stage").focus();
    await page.evaluate(() => {
      window.inkMeasurements = 0;
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (...args) {
        if (this.matches(".ui-aligned-text")) window.inkMeasurements++;
        return original.apply(this, args);
      };
    });
    await page.keyboard.down("Space");
    // The initial phase/status change may align text once. Sustained charging
    // only changes the meter transform and must cause no further measurements.
    await page.waitForTimeout(100);
    await page.evaluate(() => (window.inkMeasurements = 0));
    await page.waitForTimeout(400);
    const measurements = await page.evaluate(() => window.inkMeasurements);
    await page.keyboard.up("Space");
    await page.waitForTimeout(500);
    const boardMeasurements = await page.evaluate(async () => {
      const probe = document.createElement("span");
      document.querySelector(".jump-stage").append(probe);
      await new Promise((resolve) => setTimeout(resolve, 100));
      window.inkMeasurements = 0;
      for (let frame = 0; frame < 8; frame++) {
        probe.style.transform = `translateX(${frame}px)`;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const count = window.inkMeasurements;
      probe.remove();
      return count;
    });
    const titleMeasurements = await page.evaluate(async () => {
      window.inkMeasurements = 0;
      document.querySelector("#gameTitle").textContent += " test";
      await new Promise((resolve) => setTimeout(resolve, 100));
      return window.inkMeasurements;
    });
    console.log({
      counterStable,
      dateStable,
      chargeInkMeasurements: measurements,
      boardInkMeasurements: boardMeasurements,
      titleInkMeasurements: titleMeasurements,
    });
    assert.ok(counterStable, "unchanged counters retain their text node");
    assert.ok(dateStable, "ordinary renders retain aligned editor date nodes");
    assert.equal(measurements, 0, "charging must not remeasure aligned text");
    assert.equal(
      boardMeasurements,
      0,
      "board-only changes must not remeasure unrelated text",
    );
    assert.ok(
      titleMeasurements > 0,
      "toolbar text changes must still be aligned",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Stable DOM updates and layout-free charge animation verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
