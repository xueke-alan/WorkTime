"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { clickSettingsControl } = require("./settings-test-helpers.cjs");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 740 }
          : { width: 1365, height: 900 },
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      await context.addInitScript(() => {
        const original = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = function () {
          if (this.id !== "onboardingDialog") return original.call(this);
        };
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      const entry =
        process.env.WORKTIME_ENTRY || path.resolve(__dirname, "../index.html");
      await page.goto(pathToFileURL(entry).href);
      const ready = async () => {
        await page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await page.evaluate(() =>
          document.querySelector("#onboardingDialog[open]")?.close(),
        );
      };
      await ready();
      await clickSettingsControl(page, "#pageSettingsOpen");
      const boxes = await page
        .locator(
          ".settings-select-row:not(.motion-settings-row) > .field > .language-trigger",
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const r = element.getBoundingClientRect();
            return { y: r.y, width: r.width };
          }),
        );
      if (mobile && process.env.WORKTIME_SHOT)
        await page
          .locator("#pageSettingsPane .page-settings-body")
          .screenshot({ path: process.env.WORKTIME_SHOT });
      assert.equal(boxes.length, 2);
      const motionBox = await page.locator("#motionTrigger").boundingBox();
      assert.ok(Math.abs(motionBox.width - boxes[0].width) < 1);
      assert.ok(motionBox.y < boxes[0].y);
      assert.equal(await page.locator("#motionHelp").count(), 0);
      assert.ok(
        boxes.every(
          (box) =>
            Math.abs(box.y - boxes[0].y) < 1 &&
            Math.abs(box.width - boxes[0].width) < 1,
        ),
      );
      const choose = async (mode, persist = true) => {
        await page.locator("#motionTrigger").click();
        await page.locator(`#motionOptions [data-value="${mode}"]`).click();
        if (persist)
          await page.waitForFunction(
            () => !WorkTimeApp.services.preferences.page.dirty,
          );
      };
      const state = () =>
        page.evaluate(() => ({
          reduced: WorkTimeApp.ui.animationCompat.preference().matches,
          duration: getComputedStyle(document.querySelector(".panel"))
            .transitionDuration,
          source: WorkTimeApp.ui.animationCompat.sourceMedia(),
        }));
      assert.deepEqual(await state(), {
        reduced: true,
        duration: "0s",
        source: "all",
      });
      assert.match(
        await page.locator("#motionTrigger").getAttribute("title"),
        /减少动画/,
      );
      await choose("full");
      const full = await state();
      assert.equal(full.reduced, false);
      assert.ok(full.duration.includes("0.18s"));
      assert.equal(full.source, "not all");
      // Inspect a real JS animation while the OS still requests reduced motion.
      assert.equal(
        await page.evaluate(() => {
          const element = document.createElement("div");
          document.body.append(element);
          WorkTimeApp.ui.motion.play(element);
          const active = element.getAnimations().length;
          WorkTimeApp.ui.motion.stop(element);
          element.remove();
          return active;
        }),
        1,
      );
      await page.reload();
      await ready();
      assert.equal((await state()).reduced, false);
      await clickSettingsControl(page, "#pageSettingsOpen");
      assert.equal(await page.locator("#motionMode").inputValue(), "full");
      await choose("system");
      assert.equal((await state()).reduced, true);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(
        () => document.documentElement.dataset.reducedMotion === "false",
      );
      assert.match(
        await page.locator("#motionTrigger").getAttribute("title"),
        /允许/,
      );
      await choose("reduce");
      assert.deepEqual(await state(), {
        reduced: true,
        duration: "0s",
        source: "all",
      });
      await page.evaluate(() => {
        const preferences = WorkTimeApp.services.preferences.page;
        preferences.attach({
          state: preferences.state,
          save: async () => ({
            persisted: false,
            error: Error("Test write failure"),
          }),
        });
      });
      await choose("full", false);
      assert.equal((await state()).reduced, false);
      await page.waitForFunction(
        () =>
          document
            .querySelector("#motionTrigger")
            .closest(".field")
            .querySelector(".theme-save-notice").textContent.length > 0,
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Motion settings: OS override, CSS/JS animation, live system changes, persistence, write failure and desktop/mobile offline use verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
