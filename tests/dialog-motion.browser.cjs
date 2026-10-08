"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width, height: 1244 },
        reducedMotion,
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.waitForTimeout(900);
      const result = await page.evaluate(async () => {
        const tick = () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        const dialog = document.getElementById("timeTemplateDialog");
        const title = dialog.querySelector("h2");
        let probes = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records)
            probes += [...record.addedNodes].filter(
              (node) => node.nodeName === "I",
            ).length;
        });
        observer.observe(title, { childList: true });
        document.getElementById("addTimeTemplate").click();
        const immediate = {
          focused: document.activeElement.id,
          visibility: getComputedStyle(dialog).visibility,
          preparing: dialog.classList.contains("motion-dialog-preparing"),
          filter: getComputedStyle(dialog, "::backdrop").backdropFilter,
          animation: getComputedStyle(dialog).animationName,
          duration: getComputedStyle(dialog).animationDuration,
          transform: getComputedStyle(dialog).transform,
        };
        await tick();
        const openingProbes = probes;
        probes = 0;
        dialog.classList.add("motion-sidebar-forward");
        dialog.style.setProperty("--motion-delay", "1ms");
        await tick();
        dialog.classList.remove("motion-sidebar-forward");
        dialog.style.removeProperty("--motion-delay");
        await tick();
        const metadataProbes = probes;
        probes = 0;
        title.textContent += " 更新";
        await tick();
        const contentProbes = probes;
        observer.disconnect();
        dialog.close();
        await tick();
        const workspace = WorkTimeApp.ui.createWorkspace({
          document,
          window,
          element: (id) => document.getElementById(id),
          sidebarPanels: { open: () => false },
        });
        const original = WorkTimeApp.ui.alignment.refresh;
        let wasHidden = false;
        WorkTimeApp.ui.alignment.refresh = () => {
          wasHidden = getComputedStyle(dialog).visibility === "hidden";
          throw Error("alignment failure probe");
        };
        let threw = false;
        try {
          workspace.open(dialog.id);
        } catch (error) {
          threw = error.message === "alignment failure probe";
        } finally {
          WorkTimeApp.ui.alignment.refresh = original;
        }
        const cleaned = !dialog.classList.contains("motion-dialog-preparing");
        dialog.close();
        return {
          immediate,
          openingProbes,
          metadataProbes,
          contentProbes,
          wasHidden,
          threw,
          cleaned,
        };
      });
      assert.equal(result.immediate.focused, "timeTemplateName");
      assert.equal(result.immediate.visibility, "visible");
      assert.equal(result.immediate.preparing, false);
      assert.equal(result.immediate.filter, "none");
      assert.equal(result.immediate.transform, "none");
      assert.equal(
        result.immediate.animation,
        reducedMotion === "reduce" ? "none" : "motion-fade",
      );
      if (reducedMotion !== "reduce")
        assert.equal(result.immediate.duration, "0.18s");
      assert.equal(result.openingProbes, 1, "Opening aligns the title once");
      assert.equal(result.metadataProbes, 0, "Motion metadata needs no layout");
      assert.equal(result.contentProbes, 1, "Changed content is still aligned");
      assert(result.wasHidden && result.threw && result.cleaned);
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.locator("#addTimeTemplate").click();
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("#timeTemplateDialog").isVisible(),
          false,
        );
        assert.equal(
          await page
            .locator("#addTimeTemplate")
            .evaluate((el) => document.activeElement === el),
          true,
          "Native close restores the opening trigger",
        );
      }
      await page.locator("#settingsOpen").click();
      const geometry = await page.evaluate(async () => {
        document.getElementById("scheduleApplyOpen").click();
        const dialog = document.getElementById("scheduleRangeDialog");
        const control = document.getElementById("scheduleRangeTrigger");
        const samples = [];
        for (let frame = 0; frame < 50; frame++) {
          await new Promise(requestAnimationFrame);
          const a = dialog.getBoundingClientRect();
          const b = control.getBoundingClientRect();
          samples.push([
            a.x,
            a.y,
            a.width,
            a.height,
            b.x,
            b.y,
            scrollX,
            scrollY,
          ]);
        }
        return samples;
      });
      assert(
        geometry.every((sample) =>
          sample.every((n, i) => Math.abs(n - geometry[0][i]) < 0.1),
        ),
        "Schedule dialog, controls and page stay stationary",
      );
      if (reducedMotion === "no-preference")
        await page.screenshot({
          path: path.resolve(`test-results/dialog-motion-${width}.png`),
        });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#scheduleRangeDialog").isVisible(),
        false,
      );
      await page.close();
    }
  }
  console.log(
    "Dialog motion: one opening alignment, stable focus, metadata filtering and failure cleanup passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
