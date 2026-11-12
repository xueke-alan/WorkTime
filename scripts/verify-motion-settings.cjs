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
        process.env.WORKTIME_ENTRY ||
        path.resolve(
          process.argv[2] || path.join(__dirname, ".."),
          "index.html",
        );
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
      const preferenceBoxes = await page
        .locator(".settings-select-row .language-trigger")
        .evaluateAll((controls) =>
          controls.map((control) => {
            const { left, top } = control.getBoundingClientRect();
            const labelLeft = control
              .querySelector(".button-label")
              .getBoundingClientRect().left;
            return { id: control.id, left, top, textInset: labelLeft - left };
          }),
        );
      assert.deepEqual(
        preferenceBoxes.map((box) => box.id),
        ["languageTrigger", "motionTrigger", "weatherTrigger"],
      );
      assert.ok(
        preferenceBoxes.every(
          (box, index) =>
            Math.abs(box.top - preferenceBoxes[0].top) < 1 &&
            Math.abs(box.textInset - preferenceBoxes[0].textInset) < 1 &&
            (index === 0 || box.left > preferenceBoxes[index - 1].left),
        ),
        "language, motion and weather must share a row with equal text insets",
      );
      assert.equal(await page.locator("#weatherLabel").textContent(), "天气");
      const folderBox = await page
        .locator(".auto-backup-folder-control")
        .boundingBox();
      const autoBackupBox = await page
        .locator("#autoBackupTrigger")
        .boundingBox();
      if (mobile && process.env.WORKTIME_SHOT)
        await page
          .locator("#pageSettingsPane .page-settings-body")
          .screenshot({ path: process.env.WORKTIME_SHOT });
      const backupRowBox = await page
        .locator(".auto-backup-settings")
        .boundingBox();
      const installBox = await page.locator("#appInstallButton").boundingBox();
      const weatherBox = await page.locator("#weatherTrigger").boundingBox();
      assert.ok(
        Math.abs(weatherBox.width - installBox.width) < 1 &&
          Math.abs(weatherBox.x - installBox.x) < 1,
        "weather and install must align and have the same width",
      );
      assert.ok(
        Math.abs(installBox.width - backupRowBox.width * 0.25) < 1,
        "install action must fill one quarter of the settings row",
      );
      assert.ok(
        folderBox.x + folderBox.width < autoBackupBox.x &&
          autoBackupBox.x + autoBackupBox.width < installBox.x &&
          Math.abs(folderBox.width - autoBackupBox.width) < 1 &&
          Math.abs(autoBackupBox.y - folderBox.y) < 1 &&
          Math.abs(installBox.y - folderBox.y) < 1,
        "folder and backup must share the remaining width to the left of install",
      );
      assert.equal(await page.locator("#motionHelp").count(), 0);
      assert.equal(
        await page.locator("#motionMode option").nth(1).textContent(),
        "始终动画",
      );
      assert.equal(
        await page.locator("#pageSettingsPane .language-settings svg").count(),
        0,
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
      assert.equal(await page.locator("#motionMode").inputValue(), "full");
      assert.equal((await state()).reduced, false);
      await choose("system");
      await page.reload();
      await ready();
      await clickSettingsControl(page, "#pageSettingsOpen");
      assert.equal(await page.locator("#motionMode").inputValue(), "system");
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
      assert.equal(
        await page
          .locator("#particleBg")
          .evaluate((canvas) => canvas.width > 0 && canvas.height > 0),
        true,
        "full motion restores the decorative canvas buffer",
      );
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
      assert.deepEqual(
        await page
          .locator("#particleBg")
          .evaluate((canvas) => [canvas.width, canvas.height]),
        [0, 0],
        "reduced motion releases the decorative canvas buffer",
      );
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
