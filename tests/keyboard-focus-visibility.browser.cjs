"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [390, 1600]) {
    for (const theme of [
      "green",
      "blue",
      "purple",
      "orange",
      "rose",
      "slate",
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await require("../scripts/lib/fixed-business-date.cjs").fixBusinessDate(
        page,
      );
      await page.addInitScript((theme) => {
        localStorage.setItem("worktime.pageTheme", theme);
      }, theme);
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading") &&
          document.fonts.status === "loaded",
      );
      await page.locator('.calendar .day[data-date="2026-10-08"]').click();
      async function tabTo(element, label) {
        for (let step = 0; step < 100; step++) {
          await page.keyboard.press("Tab");
          if (await element.evaluate((e) => e === document.activeElement))
            return;
        }
        throw Error("Control unreachable through keyboard Tab: " + label);
      }
      for (const selector of [
        "#prevMonth",
        "#importOpen",
        "#settingsOpen",
        "#dayLeaveToggle",
        "#monthTitle",
        ".calendar .day[data-date]",
        "#date-tab-notifications",
      ]) {
        const element = page.locator(selector).first();
        const before = await element.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return {
            box: [r.width, r.height],
            shadow: getComputedStyle(e).boxShadow,
          };
        });
        await tabTo(element, selector);
        const focused = await element.evaluate((e) => {
          const s = getComputedStyle(e),
            r = e.getBoundingClientRect();
          return {
            active: e === document.activeElement,
            visible: e.matches(":focus-visible"),
            shadow: s.boxShadow,
            outline: s.outlineWidth,
            box: [r.width, r.height],
          };
        });
        assert(
          focused.active && focused.visible,
          `${theme} ${selector}: keyboard modality`,
        );
        assert(
          focused.shadow.includes("inset"),
          `${theme} ${selector}: inner focus stripe`,
        );
        assert.notEqual(
          focused.shadow,
          before.shadow,
          `${theme} ${selector}: focus distinguishable`,
        );
        assert.equal(focused.outline, "0px", "No outer focus outline restored");
        assert.deepEqual(
          focused.box,
          before.box,
          "Focus does not change hit area",
        );
      }
      await page.locator("#monthTitle").press("Enter");
      const yearDate = page.locator(".year-day").first();
      await tabTo(yearDate, "year date");
      assert(
        await yearDate.evaluate(
          (e) =>
            e.matches(":focus-visible") &&
            getComputedStyle(e).boxShadow.includes("inset"),
        ),
        "Year keyboard date has visible inner focus",
      );
      await context.close();
    }
  }
  console.log(
    "Keyboard focus visible: six themes/two widths, buttons/tabs/month/year dates, unchanged hit areas and no outer outlines.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
