"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, scale, zoom] of [[1920, 1, 1]]) {
      const page = await browser.newPage({
        viewport: { width, height: 1200 },
        deviceScaleFactor: scale,
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-18T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (const [title, start, end] of [
        ["跨周测试", "2026-10-14", "2026-10-22"],
        ["发DVD v", "2026-10-15", "2026-10-23"],
        ["单日事项", "2026-10-18", "2026-10-18"],
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await page.locator("#agendaDateInput").fill(start);
        if (end !== start) {
          await page.locator("#agendaMultiDay").check();
          await page.locator("#agendaEndDateInput").fill(end);
        }
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }

      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addStyleTag({
        content:
          ".workspace { --accent: #1964bf; --theme-edge: #7aa2d4; } #calendar .day { transition: none !important; }",
      });
      for (const view of ["month", "week", "fortnight"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        await page
          .locator('#calendar .day[data-date="2026-10-16"] .day-select')
          .click({ position: { x: 8, y: 8 } });
        assert.ok(
          await page
            .locator('#calendar .day[data-date="2026-10-16"]')
            .evaluate((node) => node.classList.contains("motion-selection")),
          "Direct date selection keeps its existing feedback",
        );
        const dateSelectionColor = await page
          .locator('#calendar .day[data-date="2026-10-16"]')
          .evaluate((node) => getComputedStyle(node).borderLeftColor);
        const strip = page
          .locator('.agenda-week-lane[data-dates^="2026-10-12"] .agenda-chip')
          .first();
        await strip.click({ position: { x: 10, y: 8 } });
        await page.locator("#agendaForm").waitFor({ state: "visible" });
        const flashes = await page.evaluate(async () => {
          const flashes = [];
          const start = performance.now();
          do {
            for (const card of document.querySelectorAll("#calendar > .day")) {
              if (
                card.classList.contains("motion-selection") ||
                card
                  .getAnimations()
                  .some(
                    (animation) =>
                      animation.animationName === "motion-selection",
                  )
              )
                flashes.push(card.dataset.date || card.dataset.previewDate);
            }
            await new Promise(requestAnimationFrame);
          } while (performance.now() - start < 350);
          return flashes;
        });
        assert.deepEqual(
          flashes,
          [],
          "Opening an event must not pulse a date outline",
        );
        assert.ok(
          await strip.evaluate((node) =>
            node.classList.contains("is-selected"),
          ),
          "Event selection remains visible",
        );
        const colors = await strip.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            event: style.borderLeftColor,
            shadow: style.boxShadow,
            filter: style.filter,
          };
        });
        assert.equal(
          colors.event,
          dateSelectionColor,
          "Event and date selected strokes share a color",
        );
        assert.ok(colors.shadow.includes(dateSelectionColor));
        const box = await strip.boundingBox();
        await page.mouse.move(box.x + 10, box.y + 8);
        await page.mouse.down();
        assert.equal(
          await strip.evaluate((node) => getComputedStyle(node).filter),
          "none",
          "Pressing a selected strip must not darken its matching stroke",
        );
        await page.mouse.up();
        await page.locator("#agendaCancel").click();
      }
      await page.close();
    }
    console.log(
      "Event clicks do not flash date selection outlines; direct date feedback and event selection remain intact in month/week/fortnight views.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
