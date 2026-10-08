"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.measureText;
    window.metricCalls = 0;
    window.metricTexts = [];
    CanvasRenderingContext2D.prototype.measureText = function (...args) {
      window.metricCalls++;
      window.metricTexts.push([this.font, args[0]]);
      return original.apply(this, args);
    };
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    WorkTimeApp.ui.alignment.refresh();
    // Initial label wrapping can change line count; warm the settled geometry.
    WorkTimeApp.ui.alignment.refresh();
    window.metricCalls = 0;
    WorkTimeApp.ui.alignment.refresh();
    const warm = window.metricCalls;
    const warmTexts = warm ? window.metricTexts.slice(-warm) : [];
    document.fonts.dispatchEvent(new Event("loadingdone"));
    await new Promise(requestAnimationFrame);
    const invalidated = window.metricCalls;
    window.metricCalls = 0;
    WorkTimeApp.ui.alignment.refresh();
    const rewarmed = window.metricCalls;
    const title = document.querySelector(".sidebar-brand h1");
    const original = title.textContent;
    title.textContent = "新的字体测量内容";
    WorkTimeApp.ui.alignment.refresh();
    const changedText = window.metricCalls;
    title.textContent = original;
    WorkTimeApp.ui.alignment.refresh();
    for (let i = 0; i < 520; i++) {
      title.textContent = `缓存边界内容${i}`;
      WorkTimeApp.ui.alignment.refresh();
    }
    window.metricCalls = 0;
    title.textContent = original;
    WorkTimeApp.ui.alignment.refresh();
    const evicted = window.metricCalls;
    return { warm, warmTexts, invalidated, rewarmed, changedText, evicted };
  });
  console.log("Alignment cache measurements:", result);
  assert.equal(result.warm, 0, "Repeated refresh reuses font metrics");
  assert(result.invalidated > 0, "Font loading invalidates stale metrics");
  assert.equal(result.rewarmed, 0, "Loaded font metrics are reusable");
  assert(result.changedText > 0, "Changed text uses new metrics");
  assert(result.evicted > 0, "Old entries are evicted after the cache limit");
  console.log("Alignment metric cache passed:", result);
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
