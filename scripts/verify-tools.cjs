"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root,
);
(async () => {
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("worktime.dateInfo.activeTab", "typing");
    });
    await page.goto(
      server?.url || pathToFileURL(path.join(site, "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert(
      await page.locator(".tools-cards").isVisible(),
      "Old tool tab restores chooser",
    );
    assert.equal(
      await page.locator("#date-tab-tools").getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page
        .locator(
          ".notification-tabs #readerOpen,.notification-tabs #typingOpen,.notification-tabs #vocabularyOpen",
        )
        .count(),
      0,
    );
    assert.equal(await page.locator(".tool-card").count(), 5);
    assert.equal(
      await page.locator("#typingDialog").count(),
      0,
      "Chooser does not load typing runtime",
    );
    assert.equal(
      await page.evaluate(() => !!WorkTimeApp.services.vocabularySpeech),
      false,
      "Chooser does not load speech",
    );
    async function assertDevelopment(visible) {
      await page.locator("#vocabularyOpen").waitFor({ state: "visible" });
      for (const id of ["readerOpen", "typingOpen"])
        assert.equal(await page.locator("#" + id).isVisible(), visible);
      for (const id of ["vocabularyOpen", "gamesToolOpen", "musicToolOpen"])
        assert(await page.locator("#" + id).isVisible(), id + " stays visible");
    }
    async function setHash(hash) {
      await page.evaluate((value) => (location.hash = value), hash);
      await page.waitForFunction(
        (visible) => document.getElementById("typingOpen").hidden !== visible,
        hash === "#dev",
      );
    }
    await page.waitForTimeout(700);
    await page.locator("#pageSettingsOpen").click();
    await page.locator("#settingsPane").waitFor({ state: "visible" });
    await page.locator("#date-tab-tools").click();
    assert.equal(await page.locator("#settingsPane").isVisible(), false);
    await assertDevelopment(false);
    await page.evaluate(async () => {
      WorkTimeApp.ui.reader.open();
      await WorkTimeApp.ui.typing.open();
    });
    assert.equal(await page.locator("#readerPanel").isVisible(), false);
    assert.equal(await page.locator("#typingDialog").count(), 0);
    for (const hash of ["#device", "#DEV", "#dev/typing", "#other"])
      await setHash(hash);
    await assertDevelopment(false);
    await setHash("#dev");
    await assertDevelopment(true);
    await page.goBack();
    await page.waitForFunction(
      () => document.getElementById("typingOpen").hidden,
    );
    await assertDevelopment(false);
    await page.goForward();
    await page.waitForFunction(
      () => !document.getElementById("typingOpen").hidden,
    );
    await assertDevelopment(true);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForTimeout(700);
    await page.locator("#date-tab-tools").click();
    await assertDevelopment(true);
    await page.waitForTimeout(700);
    await page.locator("#date-tab-tools").click();
    await page.locator("#gamesToolOpen").click();
    assert.equal(
      await page.locator("#date-tab-games").getAttribute("aria-selected"),
      "true",
    );
    assert(await page.locator("#gamesPanel").isVisible());
    assert.equal(await page.locator(".tools-cards").isVisible(), false);
    await page.locator("#date-tab-tools").click();
    await page.locator("#musicToolOpen").focus();
    await page.keyboard.press("Enter");
    await page.locator('#musicDialog[data-state="open"]').waitFor();
    await page.evaluate(() => WorkTimeApp.ui.music.close());
    await page.locator("#musicDialog").waitFor({ state: "hidden" });
    await page.locator("#musicOpen").click();
    await page.locator('#musicDialog[data-state="open"]').waitFor();
    await page.evaluate(() => WorkTimeApp.ui.music.close());
    await page.locator("#musicDialog").waitFor({ state: "hidden" });
    await page.locator("#date-tab-tools").click();
    await page.locator("#readerOpen").focus();
    await page.keyboard.press("Enter");
    await page.locator(".reader-placeholder").waitFor();
    await setHash("");
    assert.equal(await page.locator("#readerPanel").isVisible(), false);
    await assertDevelopment(false);
    await setHash("#dev");
    await page.locator("#readerOpen").click();
    assert.equal(await page.locator("#readerOpen").getAttribute("role"), null);
    await page.locator(".tools-back").click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "readerOpen",
    );
    await page.evaluate(() => {
      const assets = WorkTimeApp.services.assets;
      const original = assets.script;
      assets.script = function (url, ...args) {
        if (url.includes("typing-runtime")) {
          assets.script = original;
          return Promise.reject(new Error("Simulated resource load failure"));
        }
        return original.call(this, url, ...args);
      };
    });
    await page.locator("#typingOpen").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#typingOpen span")?.textContent ===
        WorkTimeApp.i18n.t("typing.loadFailed"),
    );
    assert(
      await page.locator(".tools-cards").isVisible(),
      "Apps remains visible on loading failure",
    );
    assert.equal(await page.locator("#typingPanel").isVisible(), false);
    assert.equal(await page.locator("#typingPanel button").count(), 0);
    await page.evaluate(() => {
      const assets = WorkTimeApp.services.assets,
        original = assets.script;
      assets.script = async function (url, ...args) {
        if (url.includes("typing-runtime")) {
          assets.script = original;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return original.call(this, url, ...args);
      };
    });
    await page.locator("#typingOpen").focus();
    await page.keyboard.press("Space");
    await page.locator('#typingOpen[aria-busy="true"]').waitFor();
    assert(
      await page.locator(".tools-cards").isVisible(),
      "Loading keeps Apps visible",
    );
    assert.equal(
      await page.locator("#typingPanel").isVisible(),
      false,
      "No intermediate mini workspace",
    );
    await setHash("");
    await page.waitForFunction(
      () => !document.getElementById("typingOpen").hasAttribute("aria-busy"),
    );
    assert.equal(await page.locator("#typingDialog").isVisible(), false);
    await page.evaluate(() => WorkTimeApp.ui.typing.open());
    assert.equal(await page.locator("#typingDialog").isVisible(), false);
    await setHash("#dev");
    await page.locator("#typingOpen").click();
    await page.locator('#typingDialog[data-state="open"]').waitFor();
    await page.locator("#typingExitButton").click();
    await page.locator("#typingDialog").waitFor({ state: "hidden" });
    assert(await page.locator(".tools-cards").isVisible());
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "typingOpen",
    );
    const savedTyping = await page.evaluate(() =>
      JSON.stringify(WorkTimeApp.services.typingStorage.read()),
    );
    await page.locator("#typingOpen").click();
    await page.locator('#typingDialog[data-state="open"]').waitFor();
    await setHash("");
    await page.locator("#typingDialog").waitFor({ state: "hidden" });
    await assertDevelopment(false);
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(WorkTimeApp.services.typingStorage.read()),
      ),
      savedTyping,
      "Leaving development mode preserves typing data",
    );
    await setHash("#dev");
    await page.locator("#pageSettingsOpen").click();
    await page.locator("#settingsPane").waitFor({ state: "visible" });
    await page.locator("#settingsWorkTab").click();
    await page.locator("#standardStart").fill("09:13");
    await page.evaluate(() =>
      document.getElementById("vocabularyOpen").click(),
    );
    await page.locator("#scheduleDraftDialog[open]").waitFor();
    await page.locator("#scheduleDraftContinue").click();
    assert(await page.locator("#settingsPane").isVisible());
    assert.equal(await page.locator("#vocabularyContent").isVisible(), false);
    await page.evaluate(() =>
      document.getElementById("vocabularyOpen").click(),
    );
    await page.locator("#scheduleDraftDialog[open]").waitFor();
    await page.locator("#scheduleDraftDiscard").click();
    await page.locator("#vocabularyContent").waitFor();
    assert.equal(await page.locator("#settingsPane").isVisible(), false);
    assert.equal(
      await page.locator("#date-tab-tools").getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await page.locator(".tools-back").isVisible(), false);
    const headerHeights = await page.evaluate(() => [
      document.querySelector(".vocabulary-header").getBoundingClientRect()
        .height,
      document
        .querySelector(".workspace > section.panel > .panel-head")
        .getBoundingClientRect().height,
    ]);
    assert(
      Math.abs(headerHeights[0] - headerHeights[1]) < 1,
      "Vocabulary uses the shared column header height",
    );
    await page.locator("#date-tab-tools").click();
    assert(await page.locator(".tools-cards").isVisible());
    await page.locator("#date-tab-tools").focus();
    await page.keyboard.press("ArrowRight");
    assert.notEqual(
      await page.evaluate(() => document.activeElement.id),
      "date-tab-tools",
    );
    await page.locator("#date-tab-tools").click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 1440) {
        const positions = await page
          .locator(".tool-card")
          .evaluateAll((cards) =>
            cards.map((card) => {
              const box = card.getBoundingClientRect();
              return { top: box.top, left: box.left };
            }),
          );
        assert(
          positions.slice(0, 4).every((box) => box.top === positions[0].top),
          "Desktop chooser displays four apps in the first row",
        );
        assert(positions[4].top > positions[0].top);
      }
      const fits = await page
        .locator("#toolsPanel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      assert(fits, "Chooser fits information area");
      if (process.argv.includes("--screenshot"))
        await page
          .locator("#toolsPanel")
          .screenshot({ path: path.join(root, `tools-${width}-preview.png`) });
    }
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert(
        !(await page.locator("#toolsPanel").innerText()).includes("tools."),
        "Translated chooser copy",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "Tool grouping, navigation, lazy loading, focus, legacy state, languages and responsive layout verified.",
    );
  } finally {
    await browser.close();
    await server?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
