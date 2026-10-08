"use strict";
const assert = require("node:assert/strict"),
  {
    businessTime,
    fixBusinessDate,
  } = require("../scripts/lib/fixed-business-date.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.nativeTiming = {
      now: performance.now,
      measure: performance.measure,
      timer: setTimeout,
      frame: requestAnimationFrame,
    };
  });
  await fixBusinessDate(page);
  await page.goto("about:blank");
  const result = await page.evaluate(async () => {
    const start = performance.now();
    const wall = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await new Promise(requestAnimationFrame);
    performance.measure("native-clock-proof", {
      start,
      end: performance.now(),
    });
    return {
      wall,
      after: Date.now(),
      iso: new Date().toISOString(),
      called: Date(),
      explicit: new Date("2024-02-29T00:00:00Z").toISOString(),
      instance: new Date() instanceof Date,
      utc: Date.UTC(2024, 1, 29),
      elapsed: performance.now() - start,
      measure: performance.getEntriesByName("native-clock-proof")[0]?.duration,
      native:
        performance.now === window.nativeTiming.now &&
        performance.measure === window.nativeTiming.measure &&
        setTimeout === window.nativeTiming.timer &&
        requestAnimationFrame === window.nativeTiming.frame,
    };
  });
  assert.equal(result.wall, Date.parse(businessTime));
  assert.equal(result.after, result.wall);
  assert.equal(result.iso, "2026-10-02T04:00:00.000Z");
  assert.equal(result.explicit, "2024-02-29T00:00:00.000Z");
  assert.equal(result.instance, true);
  assert.equal(result.utc, Date.parse(result.explicit));
  assert.equal(Date.parse(result.called), result.wall);
  assert.equal(result.native, true);
  assert(result.elapsed >= 25 && result.measure >= 25);
  await browser.close();
  console.log(
    "Performance clock passed: fixed business Date, native timers/RAF/performance methods and recorded User Timing.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
