"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "no-preference",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    const ready = () =>
      page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await ready();
    const week = async () => {
      if (
        (await page.locator("#agendaMode").getAttribute("aria-pressed")) !==
        "true"
      )
        await page.locator("#agendaMode").click();
      while (
        (await page
          .locator("#agendaViewToggle")
          .getAttribute("data-agenda-view")) !== "1"
      )
        await page.locator("#agendaViewToggle").click();
      await page.waitForTimeout(450);
    };
    await week();
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("拖动即时保存");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-28");
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaStart").fill("09:07");
    await page.locator("#agendaEnd").fill("10:07");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    const event = page.locator(".timetable-event[data-agenda-edit]");
    const id = await event.getAttribute("data-agenda-edit");
    const sameEvent = () =>
      page.locator(`.timetable-event[data-agenda-edit="${id}"]`);
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("顶部文字跟随编辑日期");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-26", "2026-10-30");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    const assertTextDate = async (date) => {
      await page.waitForFunction(
        (date) =>
          document.querySelector(".agenda-week-lane .agenda-chip")?.dataset
            .agendaTextDate === date,
        date,
      );
    };
    const point = (date, minute) =>
      page.evaluate(
        ({ date, minute }) => {
          const grid = document.querySelector(
            `.timetable-column[data-timetable-date="${date}"]`,
          );
          const rect = grid.getBoundingClientRect();
          const lines = [...grid.querySelectorAll(".timetable-rule")].map(
            (n) => ({
              minute: Number(n.dataset.minute),
              y: parseFloat(n.style.top),
            }),
          );
          const before = lines.filter((l) => l.minute <= minute).at(-1),
            after = lines.find((l) => l.minute >= minute);
          const y =
            before.minute === after.minute
              ? before.y
              : before.y +
                ((after.y - before.y) * (minute - before.minute)) /
                  (after.minute - before.minute);
          return { x: rect.x + rect.width / 2, y: rect.y + y };
        },
        { date, minute },
      );
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document.querySelector(".timetable-hint") &&
          !document.querySelector("#agendaFields").disabled,
      );
    };
    for (const date of ["2026-10-26", "2026-10-27", "2026-10-28"]) {
      await page
        .locator(`#calendar > .day[data-date="${date}"] .day-select`)
        .click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(30);
    }
    await page.mouse.move(20, 20);
    await page.waitForTimeout(400);
    assert.ok(
      await page.evaluate(() => {
        const selected = document.querySelector("#calendar > .day.selected")
          .dataset.date;
        const selectedStyle = getComputedStyle(
          document.querySelector("#calendar > .day.selected"),
        );
        return [...document.querySelectorAll(".timetable-bottom-card")].every(
          (n) => {
            const top = document.querySelector(
              `#calendar > .day:is([data-date="${n.dataset.timetableDate}"], [data-preview-date="${n.dataset.timetableDate}"])`,
            );
            const s = getComputedStyle(n),
              t = getComputedStyle(top);
            return (
              s.borderColor === t.borderColor &&
              s.boxShadow === t.boxShadow &&
              (n.dataset.timetableDate === selected ||
                s.borderColor !== selectedStyle.borderColor)
            );
          },
        );
      }),
      "Lower cards derive stable selection from the same date as their upper cards",
    );
    await sameEvent().click();
    await page.locator("#agendaTitle").fill("尚未保存的标题");
    await page.locator("#agendaNote").fill("保留表单草稿");
    const from = await sameEvent().boundingBox();
    const hour =
      (await point("2026-10-28", 600)).y - (await point("2026-10-28", 540)).y;
    await drag(
      { x: from.x + from.width / 2, y: from.y + 16 },
      { x: from.x + from.width / 2, y: from.y + 16 + hour },
    );
    assert.match(
      await sameEvent().locator(".agenda-chip-time").textContent(),
      /10:07–11:07/,
      "Drop persists new times immediately even while editing a title draft",
    );
    assert.equal(await page.locator("#agendaStart").inputValue(), "10:07");
    assert.equal(
      await page.locator("#agendaTitle").inputValue(),
      "尚未保存的标题",
    );
    assert.equal(
      await page.locator("#agendaNote").inputValue(),
      "保留表单草稿",
    );
    assert.equal(
      await sameEvent().locator(".agenda-chip-title-text").textContent(),
      "拖动即时保存",
      "Dragging only commits timing, not unrelated unsaved fields",
    );
    await page.reload();
    await ready();
    await week();
    assert.match(
      await sameEvent().locator(".agenda-chip-time").textContent(),
      /10:07–11:07/,
      "New times survive a reload without a form save",
    );
    await sameEvent().click();
    assert.equal(
      await page.locator("#agendaTitle").inputValue(),
      "拖动即时保存",
    );
    assert.equal(await page.locator("#agendaNote").inputValue(), "");
    const end = await sameEvent()
      .locator(".timetable-resize-end")
      .boundingBox();
    await page
      .locator('#calendar > .day[data-date="2026-10-29"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    await assertTextDate("2026-10-29");
    await drag(
      { x: end.x + end.width / 2, y: end.y + 2 },
      await point("2026-10-28", 690),
    );
    await assertTextDate("2026-10-28");
    await page
      .locator('#calendar > .day[data-date="2026-10-29"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    const startHandle = await sameEvent()
      .locator(".timetable-resize-start")
      .boundingBox();
    await drag(
      { x: startHandle.x + startHandle.width / 2, y: startHandle.y + 2 },
      await point("2026-10-28", 615),
    );
    await assertTextDate("2026-10-28");
    await page.reload();
    await ready();
    await week();
    assert.match(
      await sameEvent().locator(".agenda-chip-time").textContent(),
      /10:15–11:30/,
      "Resize persists immediately and survives reload",
    );
    const crossOrigin = await sameEvent().boundingBox();
    const nextDate = await point("2026-10-29", 600);
    await drag(
      { x: crossOrigin.x + crossOrigin.width / 2, y: crossOrigin.y + 16 },
      { x: nextDate.x, y: crossOrigin.y + 16 },
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#calendar > .day.selected")?.dataset.date ===
          "2026-10-29" &&
        document.querySelector(".timetable-bottom-card.is-selected")?.dataset
          .timetableDate === "2026-10-29",
    );
    assert.equal(
      await page.locator(".timetable-bottom-card.is-selected").count(),
      1,
      "A cross-date drop selects exactly one matching pair of cards",
    );
    assert.equal(await page.locator(".timetable-preview").count(), 0);
    await assertTextDate("2026-10-29");
    await page.mouse.move(20, 20);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.resolve("artifacts/timetable-save-selection.png"),
    });
    await page.reload();
    await ready();
    await week();
    assert.equal(
      await sameEvent().getAttribute("data-timetable-date"),
      "2026-10-29",
    );
    assert.match(
      await sameEvent().locator(".agenda-chip-time").textContent(),
      /10:15–11:30/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Animated date selection, immediate drag/resize persistence, reload and unrelated draft preservation verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
