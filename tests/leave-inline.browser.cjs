"use strict";
const assert = require("node:assert/strict");

const { pathToFileURL } = require("node:url");
const path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width, height: 1244 },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (r) => r.abort());
      await page.clock.install({ time: new Date("2026-09-08T12:00:00+08:00") });
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.locator('[data-date="2026-09-08"]').click();
      const stored = () =>
        page.evaluate(() => localStorage.getItem(WorkTimeApp.domain.state.KEY));
      const leaveMinutes = async () =>
        JSON.parse(await stored()).days["2026-09-08"].leaveMinutes;
      const closed = () =>
        page.locator("#dayLeavePanel").waitFor({ state: "hidden" });
      const before = await stored();
      assert.equal(
        await page.locator("#dayLeaveLabel").innerText(),
        "计划请假",
      );
      const reset = await page.locator("#clearManual").boundingBox();
      const source = await page.locator("#sourceOpen").boundingBox();
      const toggle = await page.locator("#dayLeaveToggle").boundingBox();
      const label = await page.locator("#dayLeaveLabel").boundingBox();
      const icon = await page
        .locator("#dayLeaveToggle > .ui-icon")
        .boundingBox();
      assert(
        label.x >= icon.x + icon.width,
        "Leave text must not overlap its icon",
      );
      await page.locator("#dayLeaveToggle").click();
      assert(Math.abs(toggle.width - reset.width * 2) < 1);
      assert(Math.abs(reset.width - source.width) < 1);
      assert.equal(
        await page
          .locator("#dayLeaveToggle")
          .evaluate((el) => el.getAnimations().length),
        0,
      );
      await page.locator("#dayLeave").fill("2");
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".day-action-row")
            .classList.contains("is-leave-animating"),
      );
      assert.equal(await stored(), before, "Typing remains a draft");
      const full = await page.locator("#dayLeaveFull").boundingBox();
      const done = await page.locator("#dayLeaveDone").boundingBox();
      const input = await page.locator(".leave-input-wrap").boundingBox();
      assert(
        Math.abs(full.x - reset.x) < 1 && Math.abs(done.x - source.x) < 1,
        "The two action buttons keep their slots",
      );
      assert(
        Math.abs(input.x - toggle.x) < 1 &&
          Math.abs(input.width - toggle.width) < 1,
        "Input directly replaces the leave button in the same slot",
      );
      assert(
        Math.abs(input.height - full.height) < 1 &&
          Math.abs(input.height - done.height) < 1,
      );
      assert.equal(await page.locator("#dayLeaveFull").innerText(), "全天");
      assert.equal(await page.locator("#dayLeaveDone").innerText(), "提交");
      assert.equal(
        await page
          .locator("#dayLeaveDone")
          .evaluate(
            (el) =>
              getComputedStyle(el).backgroundColor ===
              getComputedStyle(el).color,
          ),
        false,
      );
      assert.equal(
        await page.locator("#dayLeaveFull use").getAttribute("href"),
        "#ms-event-busy",
      );
      assert.equal(
        await page.locator("#dayLeaveDone use").getAttribute("href"),
        "#ms-check",
      );
      const expandedButton = await page
        .locator("#dayLeaveToggle")
        .boundingBox();
      assert(Math.abs(expandedButton.width - input.width) < 1);
      assert.equal(
        await page
          .locator("#dayLeaveToggle > .ui-icon")
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      assert.equal(await page.locator("#dayLeaveCancel").count(), 0);
      await page.locator("#dayStart").click();
      await closed();
      assert.equal(
        await stored(),
        before,
        "Blur discards the unsubmitted hours",
      );
      assert.equal(await page.locator("#dayLeave").inputValue(), "0");
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeave").fill("2.5");
      await page.locator("#dayLeaveDone").click();
      await closed();
      assert.equal(
        await leaveMinutes(),
        150,
        "Confirm submits rather than cancelling on blur",
      );
      assert.equal(
        await page.locator("#dayLeaveLabel").innerText(),
        "请假2.5h",
      );
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeave").fill("-1");
      await page.locator("#dayLeaveDone").click();
      assert.match(
        await page.locator("#dayLeaveError").innerText(),
        /请假时长/,
      );
      assert.equal(
        await page
          .locator("#dayLeave")
          .evaluate((el) => document.activeElement === el),
        true,
      );
      await page.locator("#dayLeave").press("Escape");
      await closed();
      assert.equal(await page.locator("#dayLeave").inputValue(), "2.5");
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeaveFull").click();
      await closed();
      assert.equal(
        await leaveMinutes(),
        480,
        "Full day saves standard hours of leave",
      );
      assert.equal(
        await page.locator("#dayLeaveLabel").innerText(),
        "全天休假",
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("#dayLeaveToggle"))
            .backgroundColor === "rgb(251, 238, 234)",
      );
      assert.deepEqual(
        await page.locator("#dayLeaveToggle").evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.borderTopColor];
        }),
        ["rgb(251, 238, 234)", "rgb(230, 184, 178)"],
        "Saved leave uses the red background and border",
      );
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeave").fill("1.5");
      await page.locator("#dayLeave").press("Enter");
      await closed();
      assert.equal(await leaveMinutes(), 90);
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeave").press("Tab");
      assert.equal(
        await page.locator("#dayLeavePanel").isVisible(),
        true,
        "Keyboard users can reach the actions",
      );
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await closed();
      assert.equal(await leaveMinutes(), 90);
      await page.locator("#dayLeaveToggle").click();
      await page.locator("#dayLeave").blur();
      await closed();
      assert.equal(
        await page.locator("#dayLeaveToggle").getAttribute("aria-expanded"),
        "false",
      );
      assert.equal(
        await page.locator("#clearManual").evaluate((el) => el.inert),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    "Inline leave passed: expansion, fixed action slots, blur rollback, confirmation, full day, validation, keyboard and reduced motion.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
