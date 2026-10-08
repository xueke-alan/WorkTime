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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/CanvasFontStretch|not a valid enum/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "fontStretch",
    );
    window.stretchAssignments = [];
    if (descriptor)
      Object.defineProperty(prototype, "fontStretch", {
        ...descriptor,
        set(value) {
          window.stretchAssignments.push(value);
          // Reject invalid values even on engines that only print a warning.
          if (
            !/^(ultra-condensed|extra-condensed|condensed|semi-condensed|normal|semi-expanded|expanded|extra-expanded|ultra-expanded)$/.test(
              value,
            )
          )
            throw Error("Invalid CanvasFontStretch: " + value);
          descriptor.set.call(this, value);
        },
      });
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => document.fonts.ready);
  const values = [
    ["50%", "ultra-condensed"],
    ["62.5%", "extra-condensed"],
    ["75%", "condensed"],
    ["87.5%", "semi-condensed"],
    ["100%", "normal"],
    ["112.5%", "semi-expanded"],
    ["125%", "expanded"],
    ["150%", "extra-expanded"],
    ["200%", "ultra-expanded"],
    ["condensed", "condensed"],
    ["103%", "normal"],
  ];
  for (const [css, expected] of values) {
    const result = await page.evaluate((css) => {
      const target = document.querySelector(".day-date .daynum-text");
      target.style.fontStretch = css;
      window.stretchAssignments.length = 0;
      WorkTimeApp.ui.alignment.refresh([target]);
      return {
        assignments: window.stretchAssignments.slice(),
        offset: target.style.getPropertyValue("--ui-ink-offset"),
      };
    }, css);
    assert(
      result.assignments.length > 0,
      "Canvas stretch API is available on the test browser",
    );
    assert(
      result.assignments.every((value) => value === expected),
      css,
    );
    assert(Number.isFinite(parseFloat(result.offset)));
  }
  await page.evaluate(() => {
    document.querySelector(".day-date .daynum-text").style.fontStretch = "100%";
    for (let i = 0; i < 5; i++) WorkTimeApp.ui.alignment.refresh();
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Canvas stretch passed: CSS percentage/keyword conversion, safe fallback, finite alignment and repeated full refresh without enum warnings.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
