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
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
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
    await page.locator("#agendaMode").click();
    await page.locator("#agendaViewToggle").click();
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("上下边界调时");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-29");
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaStart").fill("09:15");
    await page.locator("#agendaEnd").fill("10:15");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    const event = page.locator(".timetable-event[data-agenda-edit]");
    const point = (minute) =>
      page
        .locator('.timetable-column[data-timetable-date="2026-10-29"]')
        .evaluate((node, minute) => {
          const ticks = [...node.querySelectorAll(".timetable-rule")].map(
            (tick) => ({
              minute: Number(tick.dataset.minute),
              y: parseFloat(tick.style.top),
            }),
          );
          const before = ticks.filter((tick) => tick.minute <= minute).at(-1);
          const after = ticks.find((tick) => tick.minute >= minute);
          const r = node.getBoundingClientRect();
          const offset =
            before.minute === after.minute
              ? before.y
              : before.y +
                ((after.y - before.y) * (minute - before.minute)) /
                  (after.minute - before.minute);
          return { x: r.x + r.width / 2, y: r.y + offset };
        }, minute);
    const resize = async (edge, minute, cancel = false) => {
      const handle = event.locator(".timetable-resize-" + edge);
      await handle.hover();
      assert.equal(
        await handle.evaluate((node) => getComputedStyle(node).cursor),
        "ns-resize",
      );
      assert.ok(
        await handle.evaluate(
          (node) => Number(getComputedStyle(node, "::after").opacity) > 0,
        ),
      );
      const box = await handle.boundingBox();
      const card = await event.boundingBox();
      assert.ok(
        box.height >= Math.min(7, card.height * 0.3),
        "Edge hot zones expand for normal events and fit short events",
      );
      const target = await point(minute);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 6 });
      assert.equal(await page.locator(".timetable-hint").count(), 1);
      assert.equal(
        await page.locator("body.agenda-timetable-resizing").count(),
        1,
      );
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.waitForFunction(
        () => !document.querySelector(".timetable-hint"),
      );
      assert.equal(
        await page.locator("body.agenda-timetable-resizing").count(),
        0,
      );
    };
    const assertTimes = async (start, end) => {
      await event.focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#agendaStart").inputValue(), start);
      assert.equal(await page.locator("#agendaEnd").inputValue(), end);
      await page.locator("#agendaCancel").click();
    };
    await resize("start", 525);
    await assertTimes("08:45", "10:15");
    await resize("end", 660);
    await assertTimes("08:45", "11:00");
    await resize("start", 570, true);
    await assertTimes("08:45", "11:00");
    await resize("end", 510);
    await assertTimes("08:45", "09:00");
    await resize("end", 660);
    await assertTimes("08:45", "11:00");
    await page.reload();
    await ready();
    if (!(await page.locator(".agenda-timetable").count())) {
      if (
        (await page.locator("#agendaMode").getAttribute("aria-pressed")) !==
        "true"
      )
        await page.locator("#agendaMode").click();
      if (!(await page.locator(".agenda-timetable").count()))
        await page.locator("#agendaViewToggle").click();
    }
    await assertTimes("08:45", "11:00");
    assert.deepEqual(errors, []);
    console.log(
      "Timetable edge resize verified: hover affordance, start/end changes, opposite-edge preservation, minimum duration, Escape and reload persistence.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
