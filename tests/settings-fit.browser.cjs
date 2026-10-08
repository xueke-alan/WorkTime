"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { snapshot } = require("./helpers/baidu-weather.cjs");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
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
    await page.route(/^https:\/\/raw\.githubusercontent\.com\//, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(snapshot()),
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const lowerBefore = await page.locator(".date-info-area").boundingBox();
    await page.locator("#pageSettingsOpen").click();
    await page.locator("#employmentDate").fill("20241014");
    await page.locator("#workCity").focus();
    await page.locator('#workCityOptions [data-city="北京"]').click();
    await page.locator("#settingsOpen").click();
    for (const [i, value] of ["1.0", "1.5", "1.5", "2.0", "2.0"].entries())
      await page.locator("#overtimeRequirement" + i).fill(value);
    await page.locator("#date-tab-weather").click();
    await page.waitForFunction(
      () =>
        !WorkTimeApp.services.weather.snapshot().loading &&
        !!WorkTimeApp.services.weather.snapshot().record,
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
    const lowerAfter = await page.locator(".date-info-area").boundingBox();
    assert.ok(Math.abs(lowerAfter.y - lowerBefore.y) <= 1);
    assert.ok(Math.abs(lowerAfter.height - lowerBefore.height) <= 1);
    await page.locator("#settingsForm .dialog-body").evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    const employmentVisible = await page
      .locator("#standardStart")
      .evaluate((input) => {
        const rect = input.getBoundingClientRect();
        const body = input.closest(".dialog-body").getBoundingClientRect();
        return rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;
      });
    assert.ok(
      employmentVisible,
      "Settings controls remain reachable by scrolling",
    );
    assert(geometry.panelHeight >= 140 && geometry.tabsVisible);
    assert.equal(geometry.horizontalOverflow, false);
    assert.deepEqual(errors, []);
    if (width === 1707)
      await page.locator(".workspace > .editor").screenshot({
        path: path.resolve(
          __dirname,
          "../test-results/settings-fit-2k-150.png",
        ),
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
