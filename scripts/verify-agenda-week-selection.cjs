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
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1000 },
        locale: "zh-CN",
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      const settle = () =>
        page.waitForFunction(
          () =>
            !document.querySelector(".calendar-navigation-viewport") &&
            !document.querySelector(".agenda-week-leaving") &&
            [...document.querySelectorAll(".timetable-scroll")].every(
              (node) => getComputedStyle(node).opacity === "1",
            ),
        );
      const assertSelection = async (expected) => {
        const upper = await page
          .locator("#calendar > .day[data-agenda-week].selected")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.date || node.dataset.previewDate),
          );
        const lower = await page
          .locator(".timetable-bottom-card.is-selected")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.timetableDate),
          );
        assert.deepEqual(
          upper,
          expected,
          "Upper date selection matches intent",
        );
        assert.deepEqual(lower, expected, "Lower cards share date selection");
      };
      await page.locator("#agendaMode").click();
      await page.locator("#agendaViewToggle").click();
      await settle();
      for (const workdaysOnly of [false, true]) {
        if (workdaysOnly) {
          await page.locator(".agenda-workday-switch").click();
          await settle();
        }
        await page.locator("#todayButton").click();
        await settle();
        await assertSelection(["2026-10-29"]);
        for (const button of [
          "nextMonth",
          "nextMonth",
          "prevMonth",
          "prevMonth",
        ]) {
          await page.locator("#" + button).click();
          await settle();
          await assertSelection([]);
        }
        const grid = page.locator(".timetable-column").nth(1);
        const date = await grid.getAttribute("data-timetable-date");
        const box = await grid.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + 45);
        await assertSelection([date]);
        const top = page.locator("#calendar > .day[data-agenda-week]").nth(2);
        const topDate = await top.evaluate(
          (node) => node.dataset.date || node.dataset.previewDate,
        );
        const point = await top.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height - 15 };
        });
        await page.mouse.click(point.x, point.y);
        await assertSelection([topDate]);
        await page.locator("#nextMonth").click();
        await page.locator("#nextMonth").click();
        await page.locator("#prevMonth").click();
        await settle();
        await assertSelection([]);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Week selection verified: forward/backward and cross-month navigation, rapid switching, workdays filter, upper/lower clicks, today and both motion modes.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
