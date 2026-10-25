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
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    async function create(title, date, endDate, timed = false) {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page
        .locator("#agendaNote")
        .fill("备注随日期卡片同步展开\n第二行备注");
      await page.locator("#agendaScheduleOpen").click();
      await page.locator("#agendaDateInput").fill(date);
      if (timed) {
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill("09:00");
        await page.locator("#agendaEnd").fill("10:00");
      }
      if (endDate) {
        await page.locator("#agendaMultiDay").check();
        await page.locator("#agendaEndDateInput").fill(endDate);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    }
    await create("第一周安排", "2026-10-20");
    await create("带时间的安排", "2026-10-20", undefined, true);
    await create("第二周安排", "2026-10-27");
    await page
      .locator('#calendar [data-date="2026-10-20"] .day-select')
      .click({ position: { x: 4, y: 4 } });
    const settled = () =>
      page.waitForFunction(
        () =>
          !document.querySelector("#calendar").getAnimations({ subtree: true })
            .length && !document.querySelector(".agenda-week-leaving"),
      );
    async function cycle(label) {
      for (const expected of ["week", "fortnight", "month"]) {
        await settled();
        const result = await page.evaluate(async () => {
          const calendar = document.querySelector("#calendar");
          document.querySelector("#agendaViewToggle").click();
          const noteEndpoints = [...calendar.querySelectorAll(".agenda-chip")]
            .filter((chip) => chip.querySelector(".agenda-chip-note"))
            .flatMap((chip) => {
              const expansion = chip
                .getAnimations()
                .find((animation) =>
                  animation.effect.getKeyframes().some((frame) => frame.height),
                );
              return expansion
                ? [
                    {
                      chip,
                      height: parseFloat(
                        expansion.effect.getKeyframes().at(-1).height,
                      ),
                    },
                  ]
                : [];
            });
          const samples = [],
            chipSamples = [],
            start = performance.now();
          while (performance.now() - start < 620) {
            for (const row of calendar.querySelectorAll(".agenda-week-lane")) {
              if (!row.querySelector(".agenda-chip")) continue;
              const day = row.dataset.dates.split(",")[0];
              const card = [...calendar.querySelectorAll(":scope > .day")].find(
                (node) =>
                  (node.dataset.date || node.dataset.previewDate) === day,
              );
              const laneRect = row.getBoundingClientRect(),
                cardRect = card.getBoundingClientRect();
              const cardAnimation = card
                .getAnimations()
                .find((animation) => animation.effect?.target === card);
              const laneAnimation = row
                .getAnimations()
                .find((animation) => animation.effect?.target === row);
              samples.push({
                day,
                offset: laneRect.top - cardRect.top,
                bottom: cardRect.bottom - laneRect.bottom,
                clock:
                  cardAnimation && laneAnimation
                    ? Math.abs(
                        cardAnimation.startTime - laneAnimation.startTime,
                      )
                    : 0,
              });
              for (const chip of row.querySelectorAll(
                ".agenda-chip:not([hidden])",
              )) {
                const anchor = [
                  ...calendar.querySelectorAll(":scope > .day"),
                ].find(
                  (node) =>
                    (node.dataset.date || node.dataset.previewDate) ===
                    chip.dataset.agendaSegmentStart,
                );
                if (!anchor) continue;
                chipSamples.push({
                  key:
                    chip.dataset.agendaEdit +
                    ":" +
                    chip.dataset.agendaSegmentStart,
                  left:
                    chip.getBoundingClientRect().left -
                    anchor.getBoundingClientRect().left,
                  overflow: getComputedStyle(chip).overflow,
                  clipPath: getComputedStyle(chip).clipPath,
                  gutter: row.offsetWidth - row.clientWidth,
                  contentWidth: row
                    .querySelector(".agenda-lane-content")
                    .getBoundingClientRect().width,
                });
              }
            }
            await new Promise(requestAnimationFrame);
          }
          return {
            samples,
            chipSamples,
            noteEndpoints: noteEndpoints.map(({ chip, height }) => ({
              expected: height,
              actual: chip.getBoundingClientRect().height,
            })),
            view: document.querySelector("#agendaViewToggle").dataset.view,
          };
        });
        assert.equal(result.view, expected);
        if (expected === "week") assert.ok(result.noteEndpoints.length > 0);
        for (const endpoint of result.noteEndpoints)
          assert.ok(
            Math.abs(endpoint.expected - endpoint.actual) < 0.05,
            `Note expansion must release to the same natural height: ${label} ${expected} ${page.viewportSize().width} ${JSON.stringify(endpoint)}`,
          );
        assert.ok(
          result.chipSamples.every((sample) => sample.overflow === "visible"),
          "Note expansion must preserve the outside continuation borders and resize handles",
        );
        const dates = new Set(result.samples.map((sample) => sample.day));
        for (const key of new Set(
          result.chipSamples.map((sample) => sample.key),
        )) {
          const samples = result.chipSamples.filter(
            (sample) => sample.key === key,
          );
          const delta =
            Math.max(...samples.map((sample) => sample.left)) -
            Math.min(...samples.map((sample) => sample.left));
          assert.ok(
            delta < 0.6,
            `Chip left edge ${label} ${expected} ${page.viewportSize().width}: ${JSON.stringify({ delta, first: samples[0], last: samples.at(-1) })}`,
          );
        }
        if (expected !== "month" || label === "cross-day")
          assert.ok(dates.size > 0);
        for (const day of dates) {
          const samples = result.samples.filter((sample) => sample.day === day);
          assert.ok(
            Math.max(...samples.map((sample) => sample.offset)) -
              Math.min(...samples.map((sample) => sample.offset)) <
              1.2,
            `${label} ${expected} ${day} width ${page.viewportSize().width}: ${JSON.stringify({ first: samples[0], last: samples.at(-1), min: Math.min(...samples.map((s) => s.offset)), max: Math.max(...samples.map((s) => s.offset)) })}`,
          );
          assert.ok(
            samples.every((sample) => sample.bottom >= -1.2),
            "Lane must stay clipped within the animated day height",
          );
          assert.ok(
            samples.every((sample) => sample.clock < 1),
            "Date and agenda animations share the same start time",
          );
        }
      }
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cycle("single-day");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await create("跨周安排", "2026-10-20", "2026-10-28");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cycle("cross-day");
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await cycle("cross-day");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1480, height: 1000 });
    for (let index = 0; index < 6; index++)
      await create("滚动安排 " + index, "2026-10-20");
    await page.addStyleTag({
      content: ".agenda-week-lane.is-scrollable { scrollbar-gutter: stable; }",
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cycle("scrollbar");
    await settled();
    await page.evaluate(() => {
      for (let i = 0; i < 6; i++)
        document.querySelector("#agendaViewToggle").click();
    });
    await settled();
    assert.equal(await page.locator(".agenda-week-leaving").count(), 0);
    await page.locator("#agendaViewToggle").click();
    await settled();
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#monthTitleWeek")
          .getAnimations({ subtree: true }).length,
    );
    const headerMotion = await page.evaluate(async () => {
      const label = document.querySelector(".month-title-week-label");
      const before = label.querySelector(
        ".summary-number-accessible",
      ).textContent;
      const bounds = () => {
        const range = document.createRange();
        const visual = label.querySelector(".summary-number-visual");
        range.setStartBefore(visual.children[0]);
        range.setEndAfter(visual.children[1]);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      };
      const initial = bounds();
      document.querySelector("#agendaViewToggle").click();
      const suffix = label.querySelector(".month-title-week-range");
      const samples = [];
      const start = performance.now();
      while (performance.now() - start < 450) {
        samples.push({
          ...bounds(),
          opacity: Number(getComputedStyle(suffix).opacity),
        });
        await new Promise(requestAnimationFrame);
      }
      return {
        before,
        after: label.querySelector(".summary-number-accessible").textContent,
        initial,
        samples,
        rolling: label.querySelectorAll(".summary-number-outgoing").length,
      };
    });
    assert.equal(headerMotion.before, "w4");
    assert.equal(headerMotion.after, "w4-5");
    assert.equal(headerMotion.rolling, 0);
    assert.ok(
      headerMotion.samples.every(
        (sample) =>
          Math.abs(sample.x - headerMotion.initial.x) < 0.6 &&
          Math.abs(sample.y - headerMotion.initial.y) < 0.6,
      ),
      `The shared W4 stays stationary throughout range expansion: ${JSON.stringify({ ...headerMotion, samples: headerMotion.samples.slice(0, 1) })}`,
    );
    assert.ok(headerMotion.samples[0].opacity < 0.5);
    assert.equal(headerMotion.samples.at(-1).opacity, 1);
    assert.deepEqual(errors, []);
    console.log(
      "Date/agenda synchronized trajectories, stable chip left edges, scrollbar geometry, heights, shared clocks, compact/cross-day lanes, notes and interrupted view switches verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
