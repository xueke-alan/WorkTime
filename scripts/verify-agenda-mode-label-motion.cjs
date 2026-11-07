"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const width of [1480, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-11-01T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#plannedOvertimeToggle").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#plannedOvertimeToggle")
            .getAttribute("aria-pressed") === "true",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const entering of [true, false]) {
        const sample = await page.evaluate(async () => {
          document.querySelector("#agendaMode").click();
          const card = document.querySelector('.day[data-date="2026-11-01"]');
          const label = card.querySelector(".daytop .daykind");
          const outgoing = card.querySelector(
            ".agenda-content-outgoing.daykind",
          );
          const animation = label
            .getAnimations()
            .find((entry) =>
              entry.effect
                .getKeyframes()
                .some((frame) => frame.opacity !== undefined),
            );
          if (!animation || !outgoing)
            throw Error("Expected both label fade layers");
          const frames = animation.effect.getKeyframes();
          const timing = animation.effect.getTiming();
          animation.pause();
          animation.currentTime =
            Number(timing.delay) + Number(timing.duration) - 1;
          const before =
            label.getBoundingClientRect().top -
            card.getBoundingClientRect().top;
          animation.finish();
          await Promise.resolve();
          await new Promise(requestAnimationFrame);
          const after =
            label.getBoundingClientRect().top -
            card.getBoundingClientRect().top;
          return {
            frames,
            jump: Math.abs(after - before),
            text: label.textContent,
            oldText: outgoing.textContent,
          };
        });
        assert.notEqual(sample.text, sample.oldText);
        assert.equal(sample.text.includes("加班"), entering);
        assert.ok(
          sample.frames.every((frame) => frame.transform === undefined),
          "Label fade must preserve the ink alignment transform",
        );
        assert.ok(
          sample.jump < 0.1,
          `Label jumps ${sample.jump}px at ${width}px`,
        );
        await page.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.pending || animation.playState === "running",
              ),
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Mode labels crossfade without a baseline jump on desktop and mobile.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
