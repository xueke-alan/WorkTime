"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  // Isolate the service: the application intentionally reloads on bfcache restore.
  await page.setContent('<div class="sidebar-brand"><h1>文字测量</h1></div>');
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/ui-alignment.js"),
  });
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const tick = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    await tick();
    let reads = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (this.matches(".ui-aligned-text, .ui-aligned-text > i")) reads++;
      return original.apply(this, args);
    };
    const title = document.querySelector(".sidebar-brand h1");
    window.dispatchEvent(new Event("resize"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    title.textContent = "隐藏期间内容变化";
    UIAlignment.refresh();
    await tick();
    const hidden = reads;
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    const visible = reads;
    reads = 0;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    title.textContent = "页面暂停后的新内容";
    UIAlignment.refresh();
    await tick();
    const paused = reads;
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    await tick();
    const resumed = reads;
    reads = 0;
    UIAlignment.dispose();
    UIAlignment.dispose();
    title.textContent = "销毁后不再测量";
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    document.fonts.dispatchEvent(new Event("loadingdone"));
    UIAlignment.refresh();
    await tick();
    Element.prototype.getBoundingClientRect = original;
    return { hidden, visible, paused, resumed, disposed: reads };
  });
  assert.equal(
    result.paused,
    0,
    "Pagehide cancels queued work and stops mutations/manual refresh",
  );
  assert(result.resumed > 0, "Pageshow remeasures updated content");
  assert.equal(
    result.disposed,
    0,
    "Dispose is idempotent and removes all scheduling paths",
  );
  assert.equal(
    result.hidden,
    0,
    "Hidden documents stop scheduled and manual work",
  );
  assert(result.visible > 0, "Visible documents remeasure updated content");
  console.log("Alignment lifecycle passed:", result);
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
