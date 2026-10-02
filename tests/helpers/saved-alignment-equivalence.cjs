"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  {
    buildPerformanceFixture,
  } = require("../../scripts/performance-fixtures.cjs");
module.exports = async function compareSavedAlignment(browser) {
  const results = [];
  for (const width of [390, 850, 1600, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-09-30T12:00:00+08:00") });
    await page.addInitScript(
      (state) =>
        localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
      buildPerformanceFixture(1).state,
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../../index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const settle = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      await settle();
      const retained = document.querySelector('[data-date="2026-09-30"]');
      retained.focus();
      document.getElementById("dayStart").value = "08:00";
      document.getElementById("dayEnd").value = "20:00";
      for (const id of ["dayStart", "dayEnd"])
        document
          .getElementById(id)
          .dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
      const capture = () =>
        [
          ...document.querySelectorAll(
            ".daynum-text,.summary-sidebar .ui-aligned-text,#calendarFoot",
          ),
        ].map((element) => {
          const box = element.getBoundingClientRect();
          return {
            text: element.textContent,
            offset: element.style.getPropertyValue("--ui-ink-offset"),
            dateHeight: element
              .closest(".day-date")
              ?.style.getPropertyValue("--date-ink-height"),
            rect: [box.x, box.y, box.width, box.height],
          };
        });
      const local = capture();
      const beforeScroll = [scrollX, scrollY];
      UIAlignment.refresh();
      const full = capture();
      return {
        local,
        full,
        focused: document.activeElement === retained,
        beforeScroll,
        afterScroll: [scrollX, scrollY],
      };
    });
    assert.deepEqual(
      result.local,
      result.full,
      `${width}: saved local geometry equals full refresh`,
    );
    assert.deepEqual(
      result.afterScroll,
      result.beforeScroll,
      `${width}: full comparison preserves scroll`,
    );
    assert(result.focused, `${width}: retained date keeps focus`);
    assert.deepEqual(errors, []);
    results.push({
      width,
      comparedNodes: result.local.length,
      exactGeometry: true,
      focused: result.focused,
    });
    await context.close();
  }
  return results;
};
