"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading") &&
      document.fonts.status === "loaded",
  );
  assert.equal(await page.locator(".notification-tabs [role=tab]").count(), 4);
  for (const [from, key, to] of [
    ["notifications", "ArrowRight", "countdown"],
    ["countdown", "ArrowRight", "weather"],
    ["weather", "ArrowRight", "history"],
    ["history", "ArrowRight", "notifications"],
    ["notifications", "ArrowLeft", "history"],
    ["history", "Home", "notifications"],
    ["notifications", "End", "history"],
  ]) {
    await page.locator("#date-tab-" + from).focus();
    await page.keyboard.press(key);
    assert.equal(
      await page.locator("#date-tab-" + to).getAttribute("aria-selected"),
      "true",
      `${from} ${key} selects ${to}`,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "date-tab-" + to,
    );
  }
  await page.locator("#date-tab-history").click();
  for (const width of [2250, 1398, 390]) {
    await page.setViewportSize({ width, height: width === 1398 ? 764 : 1244 });
    for (const view of ["history", "festivals", "almanac"]) {
      await page.locator("#date-context-" + view).click();
      assert.equal(
        await page.locator("#date-tab-history").getAttribute("aria-selected"),
        "true",
      );
      const layout = await page.locator(".date-info-area").evaluate((area) => {
        const panel = area.querySelector("#dateInfoPanel"),
          header = area.querySelector(".date-context-header");
        return {
          overflow:
            header.scrollWidth > header.clientWidth ||
            panel.scrollWidth > panel.clientWidth,
          vertical: panel.scrollHeight - panel.clientHeight,
          headerAbove:
            header.getBoundingClientRect().bottom <=
            panel.getBoundingClientRect().top + 1,
        };
      });
      assert.ok(!layout.overflow && layout.headerAbove);
      if (view === "almanac") assert.ok(layout.vertical <= 1);
    }
  }
  await page.locator("#date-context-almanac").press("ArrowRight");
  assert.equal(
    await page.locator("#date-context-history").getAttribute("aria-selected"),
    "true",
  );
  await page.locator("#date-context-festivals").click();
  await page.locator("#date-tab-weather").click();
  assert.equal(await page.locator(".date-context-header").isVisible(), false);
  await page.locator("#date-tab-history").click();
  assert.equal(
    await page.locator("#date-context-festivals").getAttribute("aria-selected"),
    "true",
  );
  await page.setViewportSize({ width: 1398, height: 764 });
  const date = await page
    .locator("#calendar .day[data-date]")
    .first()
    .getAttribute("data-date");
  await page.locator('#calendar .day[data-date="' + date + '"]').click();
  assert.equal(await page.locator(".date-context-date").textContent(), date);
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(
    await page.locator("#date-context-festivals").getAttribute("aria-selected"),
    "true",
  );
  console.log(
    "Date context: grouped tabs, responsive layouts, keyboard, date synchronization and remembered subview passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());
