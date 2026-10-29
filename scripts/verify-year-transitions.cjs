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
    for (const width of [1440, 390]) {
      for (const target of [
        "monthTitle",
        "date",
        "agendaMode",
        "analysisToggle",
        "todayButton",
      ]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
        await page.goto(
          pathToFileURL(path.resolve(process.argv[2] || ".", "index.html"))
            .href,
        );
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
        async function finish() {
          await page.evaluate(() => {
            for (const animation of document
              .getElementById("panelContent")
              .getAnimations())
              animation.finish();
          });
        }
        async function switchPage(selector, direction) {
          const outgoing = await page.evaluate((selector) => {
            document.querySelector(selector).click();
            const content = document.getElementById("panelContent");
            const animation = content.getAnimations()[0];
            animation.pause();
            const frames = animation.effect.getKeyframes();
            // Additional toolbar clicks must not alter the pending destination.
            document.getElementById("nextMonth").click();
            return {
              duration: animation.effect.getTiming().duration,
              frames,
              inert: content.inert,
              copies: document.querySelectorAll(".calendar-navigation-copy")
                .length,
            };
          }, selector);
          assert.equal(outgoing.duration, 180);
          assert.equal(outgoing.inert, true);
          assert.equal(outgoing.copies, 0);
          assert.equal(outgoing.frames[0].opacity, "1");
          assert.equal(outgoing.frames[1].opacity, "0");
          assert.equal(
            outgoing.frames[1].transform,
            `translateY(${-24 * direction}px)`,
          );
          await finish();
          await page.waitForFunction(() =>
            document
              .getElementById("panelContent")
              .getAnimations()
              .some(
                (animation) => animation.effect.getTiming().duration === 280,
              ),
          );
          const incoming = await page.evaluate(() => {
            const content = document.getElementById("panelContent");
            const animation = content.getAnimations()[0];
            animation.pause();
            return {
              frames: animation.effect.getKeyframes(),
              easing: animation.effect.getTiming().easing,
              nested: document
                .getElementById("calendar")
                .classList.contains("motion-calendar-view"),
              footer: [
                ...document.querySelectorAll(".calendar-footer > *"),
              ].some((element) => element.getAnimations().length),
            };
          });
          assert.equal(
            incoming.frames[0].transform,
            `translateY(${24 * direction}px)`,
          );
          assert.equal(incoming.easing, "cubic-bezier(0.22, 1, 0.36, 1)");
          assert.equal(incoming.nested, false);
          assert.equal(incoming.footer, true);
          await finish();
          await page.waitForFunction(
            () => !document.getElementById("panelContent").inert,
          );
          assert.equal(
            await page
              .locator("#panelContent")
              .evaluate((element) => getComputedStyle(element).opacity),
            "1",
          );
          assert.equal(
            await page.locator(".calendar-navigation-copy").count(),
            0,
          );
        }
        if (target === "monthTitle") await page.locator("#importOpen").click();
        await switchPage("#monthTitle", 1);
        assert.equal(await page.locator("#calendar.year-calendar").count(), 1);
        assert.equal(await page.locator("#importDialog").isVisible(), false);
        assert.equal(
          await page
            .locator("#monthTitleYear .summary-number-accessible")
            .textContent(),
          "2026",
        );
        if (target === "monthTitle") {
          await page.evaluate(() =>
            document.getElementById("nextMonth").click(),
          );
          assert.equal(
            await page.locator(".calendar-navigation-copy").count(),
            1,
          );
          await page.evaluate(async () => {
            for (const element of document.querySelectorAll(
              "#calendar, .calendar-navigation-copy",
            ))
              for (const animation of element.getAnimations())
                animation.finish();
            await new Promise(requestAnimationFrame);
          });
          assert.equal(
            await page
              .locator("#monthTitleYear .summary-number-accessible")
              .textContent(),
            "2027",
          );
        }
        await switchPage(
          target === "date" ? '[data-year-date="2026-02-01"]' : "#" + target,
          target === "analysisToggle" ? 1 : -1,
        );
        assert.equal(await page.locator("#calendar.year-calendar").count(), 0);
        if (target === "date")
          assert.equal(
            await page
              .locator("#calendar .day.selected")
              .getAttribute("data-date"),
            "2026-02-01",
          );
        if (target === "agendaMode")
          assert.equal(await page.locator(".workspace.agenda-mode").count(), 1);
        if (target === "analysisToggle")
          assert.equal(await page.locator("#analysisPage").isVisible(), true);
        if (target === "todayButton")
          assert.equal(
            await page
              .locator("#calendar .day.selected")
              .getAttribute("data-date"),
            "2026-10-20",
          );
        if (target === "monthTitle") {
          await page.evaluate(() => {
            document.getElementById("monthTitle").click();
            window.dispatchEvent(new Event("resize"));
          });
          assert.equal(
            await page.locator("#calendar.year-calendar").count(),
            1,
          );
          assert.equal(
            await page
              .locator("#panelContent")
              .evaluate((element) => element.inert),
            false,
          );
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.locator("#monthTitle").click();
          assert.equal(
            await page.locator("#calendar.year-calendar").count(),
            0,
          );
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await page.evaluate(() => {
            document.getElementById("monthTitle").click();
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
            delete document.hidden;
          });
          assert.equal(
            await page.locator("#calendar.year-calendar").count(),
            1,
          );
          assert.equal(
            await page
              .locator("#panelContent")
              .evaluate((element) => element.inert),
            false,
          );
          await page.evaluate(() => {
            window.savedYearAnimate = Element.prototype.animate;
            Element.prototype.animate = undefined;
            document.getElementById("monthTitle").click();
          });
          await page.waitForFunction(
            () => !document.getElementById("panelContent").inert,
          );
          assert.equal(
            await page.locator("#calendar.year-calendar").count(),
            0,
          );
          await page.evaluate(() => {
            Element.prototype.animate = window.savedYearAnimate;
          });
          await page.locator("#monthTitle").click();
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.waitForFunction(
            () => !document.getElementById("panelContent").inert,
          );
          assert.equal(
            await page.locator("#calendar.year-calendar").count(),
            1,
          );
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    console.log(
      "Year page transitions: all exits, timing, direction, footer, OA closure, focus/selection, repeated clicks, resize and reduced motion passed at 1440/390px.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
