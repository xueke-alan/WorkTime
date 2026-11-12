"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verify() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const root = path.resolve(process.argv[2] || ".");
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        locale: "zh-CN",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      const ready = () =>
        page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const selected = async (id) =>
        assert.equal(
          await page.locator(id).getAttribute("aria-selected"),
          "true",
        );
      const open = () => page.locator("#pageSettingsOpen").click();
      const tab = (id) => page.locator(id).click();
      assert.equal(
        await page.locator("#settingsOpen, #personalSettingsOpen").count(),
        0,
      );
      await open();
      await selected("#settingsGeneralTab");
      await page.screenshot({
        path: path.join(root, "settings-general-" + width + ".png"),
        fullPage: true,
      });
      assert.equal(
        await page.locator("#pageSettingsOpen use").getAttribute("href"),
        "#ms-close",
      );
      await page.locator("#languageTrigger").click();
      await tab("#settingsWorkTab");
      assert.equal(await page.locator("#languageOptions").isVisible(), false);
      const initial = await page.locator("#standardStart").inputValue();
      const draft = initial === "09:13" ? "09:14" : "09:13";
      await page.locator("#standardStart").fill("25:00");
      await tab("#settingsGeneralTab");
      await open();
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftApply").click();
      await selected("#settingsWorkTab");
      assert.equal(await page.locator("#settingsError").isVisible(), true);
      assert.ok((await page.locator("#settingsError").textContent()).trim());
      assert.equal(await page.locator("#standardStart").inputValue(), "25:00");
      await page.locator("#standardStart").fill(draft);
      await tab("#settingsPersonalTab");
      await page.locator("#employmentDate").fill("2020-09-09");
      await page.locator("#employmentDate").press("Tab");
      await page.locator("#workCity").click();
      assert.equal(await page.locator("#workCityOptions").isVisible(), true);
      await tab("#settingsGeneralTab");
      assert.equal(await page.locator("#workCityOptions").isVisible(), false);
      await tab("#settingsWorkTab");
      assert.equal(await page.locator("#standardStart").inputValue(), draft);
      await tab("#settingsGeneralTab");
      await open();
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftContinue").click();
      await selected("#settingsGeneralTab");
      await tab("#settingsWorkTab");
      assert.equal(await page.locator("#standardStart").inputValue(), draft);
      await tab("#settingsGeneralTab");
      await page.locator("#nextMonth").click();
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftContinue").click();
      // Applying from a different tab must still apply the retained schedule.
      await open();
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftApply").click();
      await page.waitForSelector("#scheduleRangeDialog[open]");
      await page.locator("#scheduleRangeDialog [data-close]").first().click();
      await open();
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftDiscard").click();
      await page.waitForFunction(
        () => document.getElementById("settingsPane").hidden,
      );
      assert.equal(
        await page.locator("#pageSettingsOpen use").getAttribute("href"),
        "#ms-settings",
      );
      await open();
      await selected("#settingsGeneralTab");
      await tab("#settingsPersonalTab");
      await page.locator("#personalSettingsCancel").click();
      await open();
      await selected("#settingsPersonalTab");
      await page.locator("#settingsPersonalTab").press("Home");
      await selected("#settingsGeneralTab");
      await page.locator("#settingsGeneralTab").press("ArrowRight");
      await selected("#settingsWorkTab");
      await page.locator("#settingsWorkTab").press("End");
      await selected("#settingsPersonalTab");
      await tab("#settingsWorkTab");
      assert.equal(await page.locator("#standardStart").inputValue(), initial);
      await page.locator("#standardStart").fill(draft);
      await page.locator("#scheduleApplyOpen").click();
      await page.locator('#scheduleRangeForm button[type="submit"]').click();
      await page.waitForFunction(
        () => !document.getElementById("scheduleRangeDialog").open,
      );
      await page.locator("#personalSettingsCancel").click();
      assert.equal(await page.locator("#settingsPane").isVisible(), false);
      await open();
      await selected("#settingsWorkTab");
      assert.equal(await page.locator("#standardStart").inputValue(), draft);
      await page.locator("#personalSettingsCancel").click();
      const agendaMode = page.locator("#agendaMode");
      const settings = page.locator("#settingsPane");
      await open();
      await page.locator("#nextMonth").click();
      assert.equal(await settings.isVisible(), true);
      await page.locator("#standardStart").fill("09:21");
      await agendaMode.press("Enter");
      await page.waitForSelector("#scheduleDraftDialog[open]");
      await page.locator("#scheduleDraftContinue").click();
      assert.equal(await agendaMode.getAttribute("aria-pressed"), "false");
      assert.equal(await settings.isVisible(), true);
      assert.equal(await page.locator("#standardStart").inputValue(), "09:21");
      await agendaMode.click();
      await page.locator("#scheduleDraftDiscard").click();
      assert.equal(await agendaMode.getAttribute("aria-pressed"), "true");
      assert.equal(await settings.isVisible(), false);
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill("Settings navigation");
      await page.locator("#agendaSave").click();
      const event = page.locator("#calendar .agenda-chip").first();
      await event.waitFor();
      await open();
      await event.click();
      assert.equal(await settings.isVisible(), false);
      assert.equal(
        await page.locator("#agendaTitle").inputValue(),
        "Settings navigation",
      );
      await page.locator("#agendaCancel").click();
      await open();
      await agendaMode.click();
      assert.equal(await agendaMode.getAttribute("aria-pressed"), "false");
      assert.equal(await settings.isVisible(), false);
      // A refresh resets tab memory. Settings remain usable in English.
      await page.reload();
      await ready();
      await open();
      await selected("#settingsGeneralTab");
      await page.locator("#languageSelect").selectOption("en");
      await page.waitForFunction(() => WorkTimeApp.i18n.language === "en");
      for (const id of [
        "#settingsGeneralTab",
        "#settingsWorkTab",
        "#settingsPersonalTab",
      ]) {
        await tab(id);
        const bounds = await page.locator(id).boundingBox();
        assert.ok(
          bounds.width > 20 &&
            bounds.x >= 0 &&
            bounds.x + bounds.width <= width + 1,
        );
        assert.equal(
          await page.locator('#settingsPane [role="tabpanel"]:visible').count(),
          1,
        );
      }
      await page.screenshot({
        path: path.join(root, "settings-tabs-" + width + ".png"),
        fullPage: true,
      });
      await page.locator("#personalSettingsCancel").click();
      // Opening/closing and grouping animate content while the sidebar frame stays still.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const animatedClick = async (selector, surface = "#settingsPane") => {
        const animated = await page.evaluate(
          ({ target, surface }) => {
            document.querySelector(target).click();
            return document
              .querySelector(surface)
              .getAnimations()
              .some((animation) => animation.playState === "running");
          },
          { target: selector, surface },
        );
        assert.equal(animated, true, "Expected surface animates: " + selector);
        assert.deepEqual(
          await page.locator(".workspace > .editor").evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              animations: element.getAnimations().length,
              transform: style.transform,
              opacity: style.opacity,
            };
          }),
          { animations: 0, transform: "none", opacity: "1" },
          "Sidebar frame stays fixed",
        );
      };
      await animatedClick("#pageSettingsOpen");
      assert.ok(
        (await page.locator(".settings-tabs").boundingBox()).height <= 38,
        "Compact settings tab row",
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#settingsPane").getAnimations().length === 0,
      );
      await animatedClick("#settingsGeneralTab", "#pageSettingsPane");
      await animatedClick("#settingsWorkTab", "#settingsDialog");
      assert.equal(
        await page
          .locator(".workspace > .editor")
          .evaluate((element) => element.getAnimations().length),
        0,
        "Grouping keeps the sidebar frame still",
      );
      assert.equal(
        await page
          .locator(".settings-tabs")
          .evaluate((element) => element.getAnimations().length),
        0,
      );
      await page.locator("#date-tab-countdown").click();
      await animatedClick("#pageSettingsOpen", ".editor-content");
      await page.evaluate(() => {
        for (const selector of [
          "#pageSettingsOpen",
          "#settingsPersonalTab",
          "#settingsGeneralTab",
          "#pageSettingsOpen",
          "#pageSettingsOpen",
          "#settingsWorkTab",
        ])
          document.querySelector(selector).click();
      });
      await selected("#settingsWorkTab");
      assert.equal(await page.locator("#settingsPane").isVisible(), true);
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".workspace > .editor")
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.effect.getTiming().iterations !== Infinity,
            ),
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() =>
        document.getElementById("settingsPersonalTab").click(),
      );
      assert.equal(
        await page
          .locator(".workspace > .editor")
          .evaluate((element) => element.getAnimations().length),
        0,
      );
      await page.locator("#personalSettingsCancel").click();
      // Settings use plain text tabs and keep the lower tools docked in agenda mode.
      await page.locator("#agendaMode").click();
      await open();
      const assertDocked = async () => {
        assert.equal(await page.locator(".date-info-area").isVisible(), true);
        assert.deepEqual(
          await page.evaluate(() => {
            const area = document.querySelector(".date-info-area");
            const bounds = area.getBoundingClientRect();
            const settings = document
              .getElementById("settingsPane")
              .getBoundingClientRect();
            const tabs = document
              .querySelector(".editor > .notification-tabs")
              .getBoundingClientRect();
            const style = getComputedStyle(area);
            return {
              static: style.position === "static",
              clear:
                settings.bottom <= bounds.top + 1 &&
                bounds.bottom <= tabs.top + 1,
              height: bounds.height > 200,
              transform: style.transform,
            };
          }),
          { static: true, clear: true, height: true, transform: "none" },
        );
      };
      await assertDocked();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await animatedClick("#pageSettingsOpen", "#agendaEditor");
      await animatedClick("#pageSettingsOpen");
      await page.waitForFunction(
        () =>
          document.querySelector("#settingsPane").getAnimations().length === 0,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await assertDocked();
      for (const id of [
        "#date-tab-history",
        "#date-tab-countdown",
        "#date-tab-weather",
        "#date-tab-games",
        "#date-tab-notifications",
        "#date-tab-notifications",
      ]) {
        await page.locator(id).click();
        await assertDocked();
      }
      for (const id of [
        "#settingsGeneralTab",
        "#settingsWorkTab",
        "#settingsPersonalTab",
      ]) {
        await tab(id);
        await assertDocked();
        assert.deepEqual(
          await page.locator(id).evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              background: style.backgroundColor,
              border: style.borderTopWidth,
              radius: style.borderTopLeftRadius,
              shadow: style.boxShadow,
            };
          }),
          {
            background: "rgba(0, 0, 0, 0)",
            border: "0px",
            radius: "0px",
            shadow: "none",
          },
        );
      }
      await page.screenshot({
        path: path.join(root, "settings-agenda-" + width + ".png"),
        fullPage: true,
      });
      await page.locator("#personalSettingsCancel").click();
      assert.equal(await page.locator(".date-info-area").isVisible(), false);
      await page.locator("#date-tab-notifications").click();
      assert.equal(await page.locator(".date-info-area").isVisible(), true);
      await page.locator("#agendaDrawerGrip").click();
      await page.locator(".date-info-area").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      const guideState = await page.evaluate(() => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.settings.configured = false;
        return state;
      });
      await context.close();
      const guideContext = await browser.newContext({
        viewport: { width, height: 900 },
        locale: "zh-CN",
      });
      try {
        await guideContext.addInitScript(
          (state) =>
            localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
          guideState,
        );
        const guide = await guideContext.newPage();
        guide.setDefaultTimeout(15000);
        await guide.route(/^https?:/, (route) => route.abort());
        await guide.goto(pathToFileURL(path.join(root, "index.html")).href);
        await guide.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await guide.locator("#date-tab-notifications").click();
        await guide.locator("#setupButton").click();
        await guide.locator("#settingsPane").waitFor({ state: "visible" });
        assert.equal(
          await guide.locator("#settingsWorkTab").getAttribute("aria-selected"),
          "true",
        );
      } finally {
        await guideContext.close();
      }
    }
    console.log(
      "Unified settings tabs, retained drafts, close/date guards, applying schedules, keyboard, language and offline startup verified: " +
        root,
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
