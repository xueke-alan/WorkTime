"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      reducedMotion: "no-preference",
      locale: "zh-CN",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.route(/^https?:/, (r) => r.abort());
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    const settle = () =>
      page.waitForFunction(
        () =>
          !document.querySelector(".calendar-navigation-viewport") &&
          [...document.querySelectorAll(".timetable-scroll")].every(
            (n) => getComputedStyle(n).opacity === "1",
          ),
      );
    await page.locator("#agendaViewToggle").click();
    await settle();
    const dates = () =>
      page
        .locator("#calendar > .day[data-agenda-week]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.dataset.date || n.dataset.previewDate),
        );
    const height = () =>
      page
        .locator("#calendar > .day[data-agenda-week]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        );
    assert.deepEqual(await height(), Array(7).fill(160));
    await page.evaluate(() => {
      window.dualMotions = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.id === "calendar" || this.matches(".timetable-scroll"))
          window.dualMotions.push({
            page: this.id === "calendar",
            frames,
            options,
          });
        return original.call(this, frames, options);
      };
    });
    await page.locator("#nextMonth").click();
    await settle();
    const nextDates = await dates();
    const grid = await page.locator(".timetable-column").nth(2).boundingBox();
    await page.mouse.click(grid.x + grid.width / 2, grid.y + 50);
    assert.equal(
      await page
        .locator(".timetable-bottom-card.is-selected")
        .getAttribute("data-timetable-date"),
      nextDates[2],
      "Lower cards remain clickable after the page arrives",
    );
    const blankTop = await page
      .locator("#calendar > .day[data-agenda-week]")
      .nth(4)
      .evaluate((n) => {
        const r = n.getBoundingClientRect(),
          h = n.querySelector(".daytop").getBoundingClientRect();
        return { x: r.x + r.width / 2, y: h.bottom + 15 };
      });
    await page.mouse.click(blankTop.x, blankTop.y);
    assert.equal(
      await page
        .locator(".timetable-bottom-card.is-selected")
        .getAttribute("data-timetable-date"),
      nextDates[4],
      "Upper blank areas select the corresponding date without opening a new form",
    );
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    assert.deepEqual(await height(), Array(7).fill(160));
    assert.ok(
      await page.evaluate(() =>
        window.dualMotions.some(
          (m) =>
            m.page &&
            m.frames.some((f) => String(f.transform).includes("translateX")),
        ),
      ),
      "Single-week navigation uses a horizontal page slide",
    );
    await page.locator("#nextMonth").click();
    await page.locator("#nextMonth").click();
    await page.locator("#prevMonth").click();
    await settle();
    const interruptedDates = await dates();
    const afterInterruption = await page
      .locator(".timetable-column")
      .first()
      .boundingBox();
    await page.mouse.click(afterInterruption.x + 15, afterInterruption.y + 50);
    assert.equal(
      await page
        .locator(".timetable-bottom-card.is-selected")
        .getAttribute("data-timetable-date"),
      interruptedDates[0],
      "Rapid navigation releases the input guard",
    );
    await page.locator("#prevMonth").click();
    await settle();
    await page.locator("#prevMonth").click();
    await settle();
    const current = (await dates())[2];
    const point = (minute) =>
      page.evaluate(
        ({ date, minute }) => {
          const grid = document.querySelector(
              `.timetable-column[data-timetable-date="${date}"]`,
            ),
            r = grid.getBoundingClientRect();
          const lines = [...grid.querySelectorAll(".timetable-rule")].map(
            (n) => ({
              minute: Number(n.dataset.minute),
              y: parseFloat(n.style.top),
            }),
          );
          const a = lines.filter((l) => l.minute <= minute).at(-1),
            b = lines.find((l) => l.minute >= minute);
          return {
            x: r.x + r.width / 2,
            y:
              r.y +
              (a.minute === b.minute
                ? a.y
                : a.y +
                  ((b.y - a.y) * (minute - a.minute)) / (b.minute - a.minute)),
          };
        },
        { date: current, minute },
      );
    const beginDrag = async (a, b) => {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
    };
    await beginDrag(await point(900), await point(960));
    await page.mouse.up();
    await page.locator(".timetable-draft").waitFor();
    assert.equal(await page.locator(".timetable-preview").count(), 0);
    await page.locator("#agendaTitle").fill("保留拖选草稿");
    assert.equal(
      await page
        .locator(".timetable-draft .agenda-chip-title-text")
        .textContent(),
      "保留拖选草稿",
    );
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".timetable-draft").count(), 0);
    assert.equal(
      await page.locator(".timetable-event[data-agenda-edit]").count(),
      1,
      "Saving replaces the draft with exactly one persisted event",
    );
    await beginDrag(await point(840), await point(870));
    await page.mouse.up();
    await page.locator(".timetable-draft").waitFor();
    await page.locator("#agendaCancel").click();
    assert.equal(await page.locator(".timetable-draft").count(), 0);
    const create = async (title, start, end) => {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, current);
      await page.locator("#agendaAllDay").uncheck();
      await page.locator("#agendaStart").fill(start);
      await page.locator("#agendaEnd").fill(end);
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    };
    await create("分栏 A", "09:00", "10:00");
    await create("分栏 B", "10:30", "11:30");
    const item = (title) =>
      page.locator(".timetable-event[data-agenda-edit]").filter({
        has: page.locator(".agenda-chip-title-text", { hasText: title }),
      });
    const original = await item("分栏 B").boundingBox();
    const hour = (await point(660)).y - (await point(600)).y;
    await beginDrag(
      { x: original.x + original.width / 2, y: original.y + 18 },
      { x: original.x + original.width / 2, y: original.y + 18 - hour },
    );
    await page.waitForTimeout(180);
    const peer = await item("分栏 A").boundingBox(),
      preview = await page.locator(".timetable-preview").boundingBox();
    assert.ok(
      peer.x + peer.width <= preview.x + 1,
      "The moving preview and existing overlapping event occupy separate columns before release",
    );
    assert.equal(
      await item("分栏 B").evaluate((n) => n.style.visibility),
      "hidden",
    );
    await page.screenshot({
      path: path.resolve("artifacts/timetable-overlap-preview.png"),
    });
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".timetable-hint"),
    );
    const landed = await item("分栏 B").boundingBox();
    assert.ok(
      (await item("分栏 A").boundingBox()).x + peer.width <= landed.x + 1,
    );
    assert.match(
      await item("分栏 B").locator(".agenda-chip-time").textContent(),
      /09:30–10:30/,
    );
    await page.locator("#nextMonth").click();
    await settle();
    assert.deepEqual(await height(), Array(7).fill(160));
    const newGrid = await page
      .locator(".timetable-column")
      .first()
      .boundingBox();
    await page.mouse.click(newGrid.x + 20, newGrid.y + 40);
    assert.equal(
      await page.locator(".timetable-bottom-card.is-selected").count(),
      1,
    );
    await page.locator("#agendaViewToggle").click();
    await settle();
    assert.equal(
      await page.locator("#calendar").getAttribute("data-agenda-rows"),
      "2",
    );
    assert.equal(await page.locator(".timetable-bottom-card").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "Animated/rapid week navigation, upper/lower clicks, persistent new-event drafts, live overlap columns, fixed all-day height and shared page/fade animation verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
