"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

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
        hasTouch: mobile,
        locale: "zh-CN",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(() => {
        document.startViewTransition = () => {
          throw Error("Theme must not capture snapshots");
        };
      });
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#pageSettingsOpen").click();
      const card = (id) =>
        page.locator(`.theme-card:has(input[value="${id}"])`);
      const assertTheme = async (id) => {
        assert.equal(await page.locator("html").getAttribute("data-theme"), id);
        assert.equal(
          await page
            .locator(`input[name="pageTheme"][value="${id}"]`)
            .isChecked(),
          true,
        );
        assert.equal(await page.locator(".theme-reveal-edge").count(), 0);
      };
      if (mobile) await card("blue").tap();
      else await card("blue").click();
      await assertTheme("blue");
      const transition = await page
        .locator(".panel")
        .first()
        .evaluate((panel) => {
          const style = getComputedStyle(panel);
          return {
            properties: style.transitionProperty,
            duration: style.transitionDuration,
          };
        });
      assert.ok(transition.properties.includes("color"));
      assert.ok(transition.properties.includes("background-color"));
      assert.ok(
        transition.duration
          .split(",")
          .every((value) => value.trim() === "0.18s"),
      );
      await page.locator('input[value="blue"]').focus();
      await page.keyboard.press("ArrowRight");
      await assertTheme("purple");
      await page.evaluate(() => {
        for (const id of ["green", "mint", "orange"]) {
          const input = document.querySelector(
            `input[name="pageTheme"][value="${id}"]`,
          );
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await assertTheme("orange");
      await page.waitForFunction(
        () => !WorkTimeApp.services.preferences.page.dirty,
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "orange",
      );
      await page.locator("#pageSettingsOpen").click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await card("red").click();
      await assertTheme("red");
      assert.equal(
        await page
          .locator(".panel")
          .first()
          .evaluate((panel) => getComputedStyle(panel).transitionDuration),
        "0s",
      );
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
      await card("brown").click();
      await assertTheme("brown");
      await page.waitForFunction(
        () =>
          document.querySelector(".theme-save-notice").textContent.length > 0,
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Native theme color transitions, touch/keyboard, rapid switching, persistence, reduced motion and save failures verified offline without snapshots.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
