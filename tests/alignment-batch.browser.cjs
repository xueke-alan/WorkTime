"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage();
  await page.setContent(`<style>.ui-aligned-text{display:inline-block;line-height:1.3;transform:translateY(var(--ui-ink-offset,0px))}</style>
    <div class="workspace"><section class="calendar"><div class="day-date"><span class="daynum-text">12</span></div></section>
    <section class="summary-sidebar"><div class="metric"><span data-number-ink>123</span></div><div class="target-value"><span data-number-ink>456</span></div></section></div>`);
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/namespace.js"),
  });
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/ui-alignment.js"),
  });
  const trace = await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const events = [];
    const append = Element.prototype.appendChild,
      remove = Element.prototype.remove,
      rect = Element.prototype.getBoundingClientRect;
    const isProbe = (el) =>
      el.tagName === "I" && el.getAttribute("aria-hidden") === "true";
    Element.prototype.appendChild = function (node) {
      if (isProbe(node)) events.push("append");
      return append.call(this, node);
    };
    Element.prototype.remove = function () {
      if (isProbe(this)) events.push("remove");
      return remove.call(this);
    };
    Element.prototype.getBoundingClientRect = function () {
      if (isProbe(this) || this.classList.contains("ui-aligned-text"))
        events.push("read");
      return rect.call(this);
    };
    WorkTimeApp.ui.alignment.refresh();
    Element.prototype.appendChild = append;
    Element.prototype.remove = remove;
    Element.prototype.getBoundingClientRect = rect;
    const probes = document.querySelectorAll(
      '.ui-aligned-text > i[aria-hidden="true"]',
    ).length;
    WorkTimeApp.ui.alignment.dispose();
    return { events, probes };
  });
  assert(
    trace.events.filter((v) => v === "append").length >= 3,
    "Multiple text targets are measured",
  );
  const first = trace.events.indexOf("read"),
    last = trace.events.lastIndexOf("read");
  assert(
    trace.events.slice(0, first).every((v) => v === "append"),
    "All probes are written before geometry reads",
  );
  assert(
    trace.events.slice(first, last + 1).every((v) => v === "read"),
    "Geometry reads are contiguous without probe writes",
  );
  assert(
    trace.events.slice(last + 1).every((v) => v === "remove"),
    "Probe cleanup follows all geometry reads",
  );
  assert.equal(trace.probes, 0, "No probe remains after refresh");
  console.log("Batched alignment passed:", trace);
  const focusedPage = await browser.newPage({
    viewport: { width: 390, height: 900 },
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await focusedPage.clock.install({
    time: new Date("2026-10-02T12:00:00+08:00"),
  });
  await focusedPage.addInitScript(() => {
    let seed = 123;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  });
  await focusedPage.goto(
    pathToFileURL(path.resolve(__dirname, "../index.html")).href,
  );
  await focusedPage.locator("#batchToggle").waitFor({ state: "visible" });
  await focusedPage.locator("#addTimeTemplate").click();
  await focusedPage.locator("#timeTemplateName").fill("较长的中文模板名称");
  await focusedPage.evaluate(() => document.fonts.ready);
  const scroll = await focusedPage.evaluate(() => {
    const before = [scrollX, scrollY];
    WorkTimeApp.ui.alignment.refresh();
    return { before, after: [scrollX, scrollY] };
  });
  assert.deepEqual(
    scroll.after,
    scroll.before,
    "Focused mobile refresh retains its viewport",
  );
  await focusedPage.clock.fastForward(5000);
  assert.deepEqual(
    await focusedPage.evaluate(() => [scrollX, scrollY]),
    scroll.before,
    "Viewport remains stable after scheduled work",
  );
  console.log("Focused mobile batch refresh passed:", scroll);
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
