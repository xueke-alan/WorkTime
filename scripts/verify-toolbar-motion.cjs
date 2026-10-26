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
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const settle = () =>
      page.waitForFunction(
        () =>
          !document
            .querySelector(".agenda-toolbar-region:not(.agenda-modes-region)")
            .getAnimations({ subtree: true }).length &&
          !document.querySelector(".agenda-toolbar-outgoing") &&
          !document.querySelector("#panelContent").inert,
      );
    const click = (id) =>
      page.evaluate((id) => document.getElementById(id).click(), id);
    for (const width of [1480, 1000, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await settle();
      for (const forward of [true, false]) {
        const frames = await page.evaluate(async (forward) => {
          const region = document.querySelector(
            ".agenda-toolbar-region:not(.agenda-modes-region)",
          );
          const backup = document.querySelector("#backup");
          const incoming = document.querySelector(
            forward ? "#agendaViewToggle" : "#batchToggle",
          );
          const baseline = backup.getBoundingClientRect().x;
          document.querySelector("#agendaMode").click();
          const ghost = region.querySelector(".agenda-toolbar-outgoing");
          const exit = ghost.getAnimations()[0].effect;
          const enter = incoming.getAnimations()[0].effect;
          // Inspect the painted exit, not only the declared keyframes.
          ghost.getAnimations()[0].currentTime = 80;
          const exitStyle = getComputedStyle(ghost);
          const incomingAnimation = incoming.getAnimations()[0];
          incomingAnimation.currentTime = 159;
          const opacityBeforeExit = Number(getComputedStyle(incoming).opacity);
          incomingAnimation.currentTime = 200;
          const opacityDuringPause = Number(getComputedStyle(incoming).opacity);
          ghost.getAnimations()[0].currentTime = 200;
          const outgoingDuringPause = Number(getComputedStyle(ghost).opacity);
          ghost.getAnimations()[0].currentTime = 80;
          incomingAnimation.currentTime = 320;
          const entryStyle = getComputedStyle(incoming);
          const opacityAfterExit = Number(entryStyle.opacity);
          const entryOffset = new DOMMatrixReadOnly(entryStyle.transform).m41;
          incomingAnimation.currentTime = 0;
          const detail = {
            opacityBeforeExit,
            opacityDuringPause,
            outgoingDuringPause,
            opacityAfterExit,
            entryOffset,
            exitOpacity: Number(exitStyle.opacity),
            exitOffset: new DOMMatrixReadOnly(exitStyle.transform).m41,
            exitDuration: exit.getTiming().duration,
            enterDuration: enter.getTiming().duration,
            enterDelay: enter.getTiming().delay,
            exitTransform: exit.getKeyframes().at(-1).transform,
            enterTransform: enter.getKeyframes()[0].transform,
            ghostInert:
              ghost.inert &&
              ghost.getAttribute("aria-hidden") === "true" &&
              !ghost.id,
            maxBackupShift: 0,
            maxGhosts: 0,
          };
          const start = performance.now();
          while (performance.now() - start < 480) {
            detail.maxBackupShift = Math.max(
              detail.maxBackupShift,
              Math.abs(backup.getBoundingClientRect().x - baseline),
            );
            detail.maxGhosts = Math.max(
              detail.maxGhosts,
              region.querySelectorAll(".agenda-toolbar-outgoing").length,
            );
            await new Promise(requestAnimationFrame);
          }
          return detail;
        }, forward);
        assert.ok(frames.exitOpacity > 0.5, "The sliding exit remains visible");
        assert.ok(
          frames.exitOffset > 2,
          "The old button visibly moves before fading",
        );
        assert.equal(frames.exitDuration, 160);
        assert.equal(frames.enterDuration, 200);
        assert.equal(frames.enterDelay, 240);
        assert.equal(
          frames.opacityDuringPause,
          0,
          "New button waits during the empty beat",
        );
        assert.equal(
          frames.outgoingDuringPause,
          0,
          "Old button has fully disappeared during the empty beat",
        );
        assert.equal(frames.exitTransform, "translateX(8px)");
        assert.equal(frames.enterTransform, "translateX(8px)");
        assert.equal(
          frames.opacityBeforeExit,
          0,
          "Replacement stays invisible until exit finishes",
        );
        assert.ok(
          frames.opacityAfterExit > 0 &&
            frames.entryOffset > 0 &&
            frames.entryOffset < 8,
          "Replacement slides left from the right after exit",
        );
        assert.equal(frames.ghostInert, true);
        assert.ok(frames.maxBackupShift < 1, JSON.stringify({ width, frames }));
        assert.equal(frames.maxGhosts, 1);
        await settle();
      }
      await click("agendaMode");
      await settle();
      for (const view of ["week", "fortnight", "threeweek", "month"]) {
        const transition = await page.evaluate(async () => {
          const button = document.querySelector("#agendaViewToggle");
          const region = document.querySelector(
            ".agenda-toolbar-region:not(.agenda-modes-region)",
          );
          const backup = document.querySelector("#backup");
          const baseline = button.getBoundingClientRect();
          const backupX = backup.getBoundingClientRect().x;
          const before = button.querySelector("use").getAttribute("href");
          button.click();
          const animation = button.querySelector("svg").getAnimations()[0];
          const result = {
            before,
            incoming: button.querySelector("use").getAttribute("href"),
            view: button.dataset.view,
            iconAnimating: !!animation,
            buttonAnimations: button.getAnimations().length,
            regionAnimations: region.getAnimations().length,
            ghosts: region.querySelectorAll(".agenda-toolbar-outgoing").length,
            maxShift: 0,
            minOpacity: 1,
          };
          const start = performance.now();
          while (performance.now() - start < 240) {
            const rect = button.getBoundingClientRect();
            result.maxShift = Math.max(
              result.maxShift,
              Math.abs(rect.x - baseline.x),
              Math.abs(rect.width - baseline.width),
              Math.abs(backup.getBoundingClientRect().x - backupX),
            );
            result.minOpacity = Math.min(
              result.minOpacity,
              Number(getComputedStyle(button).opacity),
            );
            await new Promise(requestAnimationFrame);
          }
          return result;
        });
        assert.equal(transition.view, view);
        assert.equal(
          transition.iconAnimating,
          transition.incoming !== transition.before,
        );
        assert.equal(transition.buttonAnimations, 0);
        assert.equal(transition.regionAnimations, 0);
        assert.equal(transition.ghosts, 0);
        assert.equal(transition.minOpacity, 1);
        assert.ok(
          transition.maxShift < 1,
          JSON.stringify({ width, transition }),
        );
        await settle();
      }
      await click("agendaMode");
      await settle();
      // Reverse during both the exit and entry phases and retain the painted state.
      for (const delay of [30, 130, 200, 300]) {
        const continuity = await page.evaluate(async (delay) => {
          document.querySelector("#agendaMode").click();
          await new Promise((resolve) => setTimeout(resolve, delay));
          const region = document.querySelector(
            ".agenda-toolbar-region:not(.agenda-modes-region)",
          );
          const nodes = [...region.querySelectorAll("button")].filter(
            (node) => !node.hidden,
          );
          const before = Object.fromEntries(
            nodes.map((node) => [
              node.dataset.toolbarSource || node.id,
              getComputedStyle(node).opacity,
            ]),
          );
          document.querySelector("#agendaMode").click();
          return [...region.querySelectorAll("button")]
            .filter((node) => !node.hidden)
            .map((node) => ({
              source: node.dataset.toolbarSource || node.id,
              before: Number(
                before[node.dataset.toolbarSource || node.id] || 0,
              ),
              after: Number(getComputedStyle(node).opacity),
            }));
        }, delay);
        for (const sample of continuity)
          assert.ok(
            Math.abs(sample.before - sample.after) < 0.08,
            JSON.stringify(sample),
          );
        await settle();
        assert.equal(await page.locator("#batchToggle").isVisible(), true);
      }
      for (const agenda of [false, true]) {
        if (agenda) {
          await click("agendaMode");
          await settle();
        }
        const collapse = await page.evaluate(async () => {
          const region = document.querySelector(
            ".agenda-toolbar-region:not(.agenda-modes-region)",
          );
          const backup = document.querySelector("#backup");
          const initial = region.getBoundingClientRect().width;
          const baseline = backup.getBoundingClientRect().x;
          document.querySelector("#analysisToggle").click();
          while (
            document
              .querySelector("#analysisToggle")
              .getAttribute("aria-pressed") !== "true"
          )
            await new Promise(requestAnimationFrame);
          const samples = [];
          const start = performance.now();
          while (performance.now() - start < 420) {
            samples.push({
              width: region.getBoundingClientRect().width,
              shift: Math.abs(backup.getBoundingClientRect().x - baseline),
            });
            await new Promise(requestAnimationFrame);
          }
          return { initial, samples, hidden: region.hidden };
        });
        assert.ok(
          collapse.samples.some(
            (sample) => sample.width > 0 && sample.width < collapse.initial - 1,
          ),
        );
        assert.ok(
          collapse.samples.every((sample) => sample.shift < 1),
          JSON.stringify({ width, collapse }),
        );
        assert.equal(
          collapse.hidden,
          true,
          JSON.stringify({ width, collapse }),
        );
        await settle();
        await click(agenda ? "agendaMode" : "analysisToggle");
        await settle();
        assert.equal(
          await page
            .locator(agenda ? "#agendaViewToggle" : "#batchToggle")
            .isVisible(),
          true,
        );
        if (agenda) {
          await click("agendaMode");
          await settle();
        }
      }
    }
    // Batch mode also animates its mode group. Interruptions settle that group
    // immediately, including while its collapse is still in the delay phase.
    for (const interruption of ["motion", "resize", "visibility"]) {
      await click("batchToggle");
      if (interruption === "motion")
        await page.emulateMedia({ reducedMotion: "reduce" });
      else
        await page.evaluate((kind) => {
          if (kind === "resize") window.dispatchEvent(new Event("resize"));
          else {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }
        }, interruption);
      const modes = await page
        .locator(".agenda-modes-region")
        .evaluate((node) => ({
          hidden: node.hidden,
          animations: node.getAnimations({ subtree: true }).length,
          width: node.style.width,
        }));
      assert.deepEqual(modes, { hidden: true, animations: 0, width: "" });
      await click("batchCancel");
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await settle();
    }
    await page.evaluate(() => {
      document.querySelector("#batchToggle").focus();
      document.querySelector("#agendaMode").click();
    });
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "agendaMode",
    );
    await settle();
    // Preference changes during an animation settle it immediately.
    await click("agendaMode");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await settle();
    await click("agendaMode");
    assert.equal(await page.locator(".agenda-toolbar-outgoing").count(), 0);
    await click("analysisToggle");
    await settle();
    assert.equal(
      await page
        .locator(".agenda-toolbar-region:not(.agenda-modes-region)")
        .isVisible(),
      false,
    );
    await click("analysisToggle");
    await settle();
    await click("agendaMode");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    assert.equal(await page.locator(".agenda-toolbar-outgoing").count(), 0);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Element.prototype.animate = undefined;
    });
    await click("agendaMode");
    await settle();
    assert.equal(await page.locator("#batchToggle").isVisible(), true);
    await click("analysisToggle");
    await settle();
    assert.equal(
      await page
        .locator(".agenda-toolbar-region:not(.agenda-modes-region)")
        .isVisible(),
      false,
    );
    await click("analysisToggle");
    await settle();
    // Longer month slots must leave the shared mode buttons inside the panel.
    for (const language of ["en", "ja"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      for (const width of [320, 390, 540]) {
        await page.setViewportSize({ width, height: 1000 });
        const fits = await page.locator("#agendaMode").evaluate((node) => {
          const button = node.getBoundingClientRect();
          const panel = node.closest(".panel").getBoundingClientRect();
          return button.left >= panel.left && button.right <= panel.right;
        });
        assert.equal(fits, true, language + " mode controls at " + width);
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "Toolbar directions, timing, rapid reversal, analysis collapse, stable actions, narrow layouts, focus, reduced motion and missing animation API verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
