"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const errors = [];
  for (const width of [1600, 390]) {
    for (const [date, name] of [
      ["2027-01-01", "元旦节"],
      ["2027-02-06", "春节"],
      ["2027-04-05", "清明节"],
      ["2027-05-01", "劳动节"],
      ["2027-06-09", "端午节"],
      ["2027-09-15", "中秋节"],
      ["2027-10-01", "国庆节"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.install({ time: new Date(date + "T12:00:00+08:00") });
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const card = page.locator(`[data-date="${date}"]`);
      assert((await card.locator(".daykind").textContent()).includes(name));
      assert.equal(
        await card.getAttribute("data-holiday"),
        name === "春节" || name === "劳动节" ? name : name.slice(0, -1),
      );
      assert.notEqual(
        await card.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--holiday-art").trim(),
        ),
        "",
      );
      assert.equal(await card.getAttribute("data-festival"), name);
      assert.equal(
        await card
          .locator(".daykind")
          .evaluate((el) => getComputedStyle(el).color),
        "rgb(170, 98, 76)",
      );
      assert.equal(
        await card
          .locator(".daykind")
          .evaluate((el) => getComputedStyle(el).fontWeight),
        "700",
      );
      const check = await page.evaluate((date) => {
        const C = WorkTimeApp.domain.calendar;
        const info = C.calendarInfo(date);
        return {
          work: info.work,
          known: C.calendarKnown(date),
          weekend: [0, 6].includes(
            WorkTimeApp.domain.time.localDate(date).getDay(),
          ),
        };
      }, date);
      assert.equal(check.known, false);
      assert.equal(check.work, false);
      assert.equal(
        await card.evaluate((el) => el.classList.contains("restday")),
        true,
      );
      await page.locator("#monthTitle").click();
      assert(
        (
          await page
            .locator(`[data-year-date="${date}"]`)
            .getAttribute("aria-label")
        ).includes(name),
      );
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Festival labels passed: seven provisional festival holidays with backgrounds, offline desktop/mobile month and year views.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
