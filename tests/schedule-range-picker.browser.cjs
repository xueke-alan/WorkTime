"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [1600, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      timezoneId: "Asia/Shanghai",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (r) => r.abort());
    await page.clock.install({ time: new Date("2026-10-04T12:00:00+08:00") });
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#settingsOpen").click();
    await page.locator("#scheduleApplyOpen").click();
    const trigger = page.locator("#scheduleRangeTrigger"),
      list = page.locator("#scheduleRangeOptions");
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert.equal(
      await page
        .locator('#scheduleRangeOptions [aria-selected="true"]')
        .innerText(),
      "从今天起",
    );
    const fits = await list.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight
      );
    });
    assert(fits, "Range popup fits the viewport");
    assert.notEqual(
      await list.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
      "Popup has an opaque surface above the dialog content",
    );
    assert.equal(
      await page
        .locator("#scheduleRangeOptions > button")
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
      "0px",
      "Options use the theme menu surface without individual button borders",
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#scheduleRangeChoice").inputValue(),
      "week",
    );
    assert.match(
      await page.locator("#scheduleRangeDescription").innerText(),
      /2026-10-04 至 2026-10-10/,
    );
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(await list.isVisible(), false);
    assert.equal(await page.locator("#scheduleRangeDialog").isVisible(), true);
    await trigger.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#scheduleCustomDates").isVisible(), true);
    await page.locator("#scheduleNoEnd").check();
    assert.equal(await page.locator("#scheduleRangeEnd").isDisabled(), true);
    assert.match(
      await page.locator("#scheduleRangeDescription").innerText(),
      /持续生效/,
    );
    await trigger.click();
    await page.locator("#scheduleDraftSummary").click();
    assert.equal(
      await list.isVisible(),
      false,
      "Outside click dismisses only the picker",
    );
    await page.locator("#scheduleRangeForm button[type=submit]").click();
    assert.equal(await page.locator("#scheduleRangeDialog").isVisible(), false);
    const remount = await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      const $ = (id) => document.getElementById(id);
      const controller = WorkTimeApp.ui.createScheduleRangeController({
        element: $,
        rangeForChoice: WorkTimeApp.domain.schedule.scheduleRangeForChoice,
        today: () => "2026-10-04",
      });
      const results = [];
      for (let i = 0; i < 3; i++) {
        controller.bind();
        controller.bind();
        controller.open({ editingDate: "2026-10-04" });
        $("scheduleRangeTrigger").click();
        results.push({
          options: $("scheduleRangeOptions").children.length,
          opened: !$("scheduleRangeOptions").hidden,
          range: controller.read(),
        });
        controller.dispose();
        controller.dispose();
        $("scheduleRangeTrigger").click();
        results.push({
          released: $("scheduleRangeOptions").hidden,
          handler: $("scheduleRangeTrigger").onclick,
        });
      }
      return results;
    });
    assert.deepEqual(
      remount,
      Array.from({ length: 3 }, () => [
        { options: 5, opened: true, range: { start: "2026-10-04", end: null } },
        { released: true, handler: null },
      ]).flat(),
      "Repeated binding preserves five options and disposal removes interaction",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Schedule range picker: mouse, keyboard, Escape, custom dates, indefinite range, application, responsive popup and repeated disposal/remount passed.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
