"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const server = process.argv.includes("--http")
    ? await runtimeServer(root)
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [2560, 1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://github.com/**", (route) => route.abort());
      await page.addInitScript(() =>
        localStorage.setItem(
          "worktime.vocabulary.audio-settings",
          JSON.stringify({ enabled: false }),
        ),
      );
      await page.goto(
        server?.url || pathToFileURL(path.join(root, "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveMotionMode("full");
        await WorkTimeApp.ui.vocabulary.preload?.();
        const storage = WorkTimeApp.services.vocabularyStorage;
        const data = structuredClone(storage.read());
        data.settings.autoRead = false;
        await storage.save(data);
      });
      // Complete the optional settings-controller warmup before timing transitions.
      await page.locator("#pageSettingsOpen").click();
      await page.locator("#settingsPane").waitFor();
      await page.locator("#pageSettingsOpen").click();
      const check = async (selector, action) => {
        const state = await page.evaluate(
          async ({ selector, action }) => {
            const motion = WorkTimeApp.ui.motion;
            for (const animation of document
              .querySelector(".editor")
              .getAnimations({ subtree: true }))
              animation.finish();
            await Promise.resolve();
            if (action === "vocabulary") WorkTimeApp.ui.vocabulary.open();
            else document.querySelector(action).click();
            await Promise.resolve();
            const heading = document.querySelector(selector);
            for (let attempt = 0; attempt < 100; attempt++) {
              if (
                heading.getClientRects().length &&
                getComputedStyle(heading).visibility === "visible" &&
                heading.getAnimations().length
              )
                break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const animation = heading.getAnimations()[0];
            const frames = animation?.effect.getKeyframes();
            const timing = animation?.effect.getTiming();
            const ancestors = [];
            for (
              let node = heading.parentElement;
              node && !node.matches(".editor");
              node = node.parentElement
            )
              ancestors.push(node);
            const cleanAncestors = ancestors.every(
              (node) =>
                !node
                  .getAnimations()
                  .some((effect) =>
                    effect.effect
                      .getKeyframes()
                      .some(
                        (frame) =>
                          frame.opacity !== undefined ||
                          frame.transform !== undefined ||
                          frame.translate !== undefined,
                      ),
                  ),
            );
            const settingsOpen =
              !document.getElementById("settingsPane").hidden;
            const body = document.querySelector(
              settingsOpen ? "#pageSettingsPane" : "#dayForm",
            );
            const bodyFrames = body?.getAnimations()[0]?.effect.getKeyframes();
            return {
              action,
              frames,
              timing,
              settingsBodyDirection:
                action === "#pageSettingsOpen"
                  ? bodyFrames?.[0]?.transform
                  : null,
              text: heading.textContent,
              visible:
                heading.getClientRects().length > 0 &&
                getComputedStyle(heading).visibility === "visible",
              same:
                !!frames &&
                frames[0].opacity === String(motion.title.enterFrom.opacity) &&
                parseFloat(frames[0].translate) ===
                  parseFloat(motion.title.enterFrom.translate) &&
                frames.at(-1).opacity === "1" &&
                timing.duration === motion.title.duration &&
                timing.easing === motion.title.easing,
              cleanAncestors,
              snapshots: document.querySelectorAll(
                ".vocabulary-drawer-snapshot :is(.editor-date,h2)",
              ).length,
            };
          },
          { selector, action },
        );
        assert.equal(state.visible, true, JSON.stringify(state));
        assert.equal(state.same, true, JSON.stringify(state));
        assert.equal(state.cleanAncestors, true, JSON.stringify(state));
        assert.equal(state.snapshots, 0, JSON.stringify(state));
        if (
          action === "#pageSettingsOpen" &&
          (selector === "#editorDate" || selector === "#pageSettingsTitle")
        )
          assert.equal(
            state.settingsBodyDirection,
            "translateX(6px)",
            JSON.stringify(state),
          );
        await page.waitForTimeout(
          ["#monthTitle", "#nextMonth", "#agendaMode"].includes(action)
            ? 600
            : 260,
        );
      };
      await check(".batch-editor-header h2", "#batchToggle");
      await check("#editorDate", "#batchCancel");
      await check("#pageSettingsTitle", "#pageSettingsOpen");
      await check("#editorDate", "#pageSettingsOpen");
      await check("#editorDate", "#nextMonth");
      await check("#yearAnalysisTitle", "#monthTitle");
      await check("#editorDate", "#monthTitle");
      await check("#agendaDate", "#agendaMode");
      await check("#editorDate", "#agendaMode");
      await check(".vocabulary-header h2", "vocabulary");
      await page
        .locator(
          "#vocabularyContent .vocabulary-pronunciation-play:not(:disabled), #vocabularyContent .vocabulary-answer:not(:disabled)",
        )
        .waitFor();
      for (const view of ["books", "analysis", "preferences", "learning"])
        await check(
          ".vocabulary-header h2",
          `.vocabulary-nav-item[data-page="${view}"]`,
        );
      await check("#pageSettingsTitle", "#pageSettingsOpen");
      await check(".vocabulary-header h2", ".vocabulary-mini-expand");
      await check("#editorDate", "#nextMonth");
      await check(".vocabulary-header h2", ".vocabulary-mini-expand");
      const stable = await page.evaluate(() => {
        const title = document.querySelector(".vocabulary-header h2");
        const before = title.getAnimations()[0];
        WorkTimeApp.ui.vocabulary.refresh();
        WorkTimeApp.ui.motion.refreshEditorTitle();
        return title.getAnimations()[0] === before;
      });
      assert.equal(
        stable,
        true,
        "Ordinary renders do not restart title motion",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveMotionMode("reduce");
        document.getElementById("pageSettingsOpen").click();
      });
      assert.equal(
        await page
          .locator("#pageSettingsTitle")
          .evaluate((element) => element.getAnimations().length),
        0,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Unified editor title motion passed at 2560/1440/390px: date, batch, settings, vocabulary views, direct return, stable rerenders and reduced motion.",
    );
  } finally {
    await browser.close();
    await server?.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
