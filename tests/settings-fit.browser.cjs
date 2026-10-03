"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [width, height] of [
    [2560, 1440],
    [2048, 1152],
    [1707, 960],
    [2250, 1244],
    [1600, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https:\/\/.+\.github\.io\//, (route) => {
      const file = path.basename(new URL(route.request().url()).pathname);
      const local = path.resolve(__dirname, "../assets/data/weather", file);
      return fs.existsSync(local)
        ? route.fulfill({
            contentType: "application/json",
            body: fs.readFileSync(local),
          })
        : route.abort();
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.locator("#settingsOpen").click();
    await page.locator("#employmentDate").fill("20241014");
    await page.locator("#workCity").fill("北京");
    for (const [i, value] of ["1.0", "1.5", "1.5", "2.0", "2.0"].entries())
      await page.locator("#overtimeRequirement" + i).fill(value);
    await page.locator("#date-tab-weather").click();
    await page.waitForFunction(
      () =>
        !window.WorkWeather.snapshot().loading &&
        !!window.WorkWeather.snapshot().record,
    );
    const geometry = await page.evaluate(() => {
      const settings = document.querySelector("#settingsForm .dialog-body");
      const area = settings.getBoundingClientRect();
      const inputs = [...settings.querySelectorAll("input,button")].filter(
        (e) => e.getClientRects().length,
      );
      const panel = document
        .querySelector(".date-info-area")
        .getBoundingClientRect();
      const tabs = document
        .querySelector(".notification-tabs")
        .getBoundingClientRect();
      return {
        scroll: settings.scrollHeight - settings.clientHeight,
        allVisible: inputs.every((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= area.top - 1 && r.bottom <= area.bottom + 1;
        }),
        panelHeight: panel.height,
        tabsVisible: tabs.bottom <= innerHeight && tabs.top >= panel.bottom - 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(
      geometry.scroll <= 1 && geometry.allVisible,
      JSON.stringify({ width, height, geometry }),
    );
    assert(geometry.panelHeight >= 140 && geometry.tabsVisible);
    assert.equal(geometry.horizontalOverflow, false);
    assert.deepEqual(errors, []);
    if (width === 1707)
      await page
        .locator(".workspace > .editor")
        .screenshot({
          path: path.resolve(__dirname, "../docs/settings-fit-2k-150.png"),
        });
    console.log(width, height, geometry);
    await page.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
