"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setRange = require("./lib/agenda-test-range.cjs");

(async () => {
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
    page.on("pageerror", (e) => errors.push(e.stack));
    page.on("dialog", (d) => d.accept());
    await page.route(/^https?:/, (r) => r.abort());
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
          !document.querySelector(
            ".calendar-navigation-viewport, .agenda-week-leaving",
          ) &&
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some((a) => a.pending || a.playState === "running"),
      );
    await page.locator("#agendaMode").click();
    const create = async (
      title,
      date,
      endDate = date,
      start = "",
      end = "",
      note = "",
    ) => {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaNote").fill(note);
      await page.locator("#agendaScheduleOpen").click();
      await setRange(page, date, endDate);
      if (start) {
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill(start);
        await page.locator("#agendaEnd").fill(end);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    };
    await create("跨日 A", "2026-10-26", "2026-11-03");
    await create(
      "跨日 B",
      "2026-10-26",
      "2026-11-02",
      "",
      "",
      "第一行\n第二行",
    );
    await create(
      "长卡片",
      "2026-10-27",
      "2026-10-27",
      "08:15",
      "09:15",
      "第一行\n第二行\n第三行",
    );
    await create(
      "短卡片 1",
      "2026-10-28",
      "2026-10-28",
      "08:15",
      "09:15",
      "111",
    );
    await create(
      "短卡片 2",
      "2026-10-28",
      "2026-10-28",
      "08:45",
      "09:45",
      "111",
    );
    for (let i = 0; i < 9; i++)
      await create(
        "密集 " + i,
        "2026-10-28",
        "2026-10-28",
        "10:00",
        "11:00",
        "备注\n第二行",
      );
    await page
      .locator('#calendar .day[data-date="2026-10-29"] .day-select')
      .click({ position: { x: 6, y: 6 } });
    await page.evaluate(() => {
      window.modeFrames = [];
      window.textTransitions = [];
      window.refreshAnimations = [];
      document.addEventListener("transitionrun", (event) => {
        if (
          window.auditText &&
          event.propertyName === "translate" &&
          event.target.closest("#calendar")
        )
          window.textTransitions.push(event.target.className);
      });
      document.addEventListener("animationstart", (event) => {
        if (
          window.auditRefresh &&
          event.target.matches(".agenda-chip, .agenda-week-layers")
        )
          window.refreshAnimations.push(event.animationName);
      });
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (
          document.querySelector("#calendar")?.contains(this) ||
          this.id === "calendar"
        )
          window.modeFrames.push({ node: this, frames, options });
        return original.call(this, frames, options);
      };
    });
    const mark = () =>
      page.evaluate(() => {
        window.modeFrames = [];
      });
    const frames = () =>
      page.evaluate(() =>
        window.modeFrames.map(({ node, frames, options }) => ({
          page: node.id === "calendar",
          day: node.matches(".day"),
          lower: node.matches(".timetable-bottom-card"),
          chip: node.matches(".agenda-chip"),
          exit: node.matches(".agenda-overflow-exit"),
          time: node.matches(".timetable-scroll"),
          date: node.dataset.date || node.dataset.previewDate,
          id: node.dataset.agendaEdit,
          frames,
          options,
        })),
      );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mark();
    await page.locator("#agendaViewToggle").click();
    assert.equal(
      await page.locator(".calendar-navigation-copy").count(),
      0,
      "1: Month-to-week morph has no duplicate outgoing page",
    );
    assert.equal(await page.locator(".timetable-bottom-card").count(), 7);
    assert.equal(
      (await frames()).filter((a) => a.lower && a.frames[0].height).length,
      7,
      "1/6: Exactly seven lower cards morph from the next row",
    );
    assert.equal(
      await page
        .locator(".day.agenda-week-leaving[data-date^='2026-11']")
        .count(),
      0,
      "1: The final month row is not painted again as a departing lower row",
    );
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.resolve("artifacts/agenda-month-week-morph.png"),
    });
    await settle();
    assert.equal(
      await page.locator("#calendar > .day[data-agenda-week]").count(),
      7,
    );
    assert.equal(
      await page
        .locator(
          ".agenda-week-leaving, .calendar-navigation-copy, .agenda-overflow-exits",
        )
        .count(),
      0,
    );
    await page.evaluate(() => {
      window.firstWeekNodes = [
        ...document.querySelectorAll("#calendar > .day[data-agenda-week]"),
      ];
    });
    await mark();
    await page.locator("#agendaViewToggle").click();
    const morph = await frames();
    assert.equal(
      await page.locator(".calendar-navigation-viewport").count(),
      0,
      "2: Single-to-fortnight is a resize, not a page slide",
    );
    assert.ok(
      morph.some((a) => a.page && a.frames[0].gridTemplateRows),
      "2: Both row heights interpolate together",
    );
    assert.ok(
      !morph.some(
        (a) => (a.page || a.day) && a.frames.some((f) => f.transform),
      ),
      "2: Date cards have no independent translation animation",
    );
    assert.ok(
      morph.some((a) => a.chip && a.frames[0].height),
      "2: Existing event bounds morph with the rows",
    );
    assert.ok(
      await page.evaluate(() =>
        window.firstWeekNodes.every(
          (n, i) =>
            n ===
            document.querySelectorAll("#calendar > .day[data-agenda-week]")[i],
        ),
      ),
    );
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.resolve("artifacts/agenda-week-fortnight-morph.png"),
    });
    await settle();
    await page
      .locator(".agenda-packed-row .agenda-chip:not([hidden])")
      .filter({
        has: page.locator(".agenda-chip-title-text", { hasText: "跨日 A" }),
      })
      .first()
      .click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.retainedChips = [
        ...document.querySelectorAll(
          ".agenda-packed-row .agenda-chip:not([hidden])",
        ),
      ];
    });
    await mark();
    await page.evaluate(() => {
      window.auditRefresh = true;
      window.refreshAnimations = [];
      const selected = [
        ...document.querySelectorAll(
          "#calendar > .day.selected, .agenda-packed-row .agenda-chip.is-selected:not([hidden])",
        ),
      ];
      window.selectionPaint = [];
      window.selectionTransitions = [];
      document.addEventListener("transitionrun", (event) => {
        if (
          window.auditRefresh &&
          event.target.matches(".day.selected, .agenda-chip.is-selected")
        )
          window.selectionTransitions.push([
            event.target.className,
            event.propertyName,
          ]);
      });
      const sample = () => {
        window.selectionPaint.push(
          selected.map((node) => {
            const style = getComputedStyle(node);
            return [
              node.isConnected,
              style.boxShadow,
              style.opacity,
              ...["Top", "Right", "Bottom", "Left"].map((edge) =>
                parseFloat(style["border" + edge + "Width"])
                  ? style["border" + edge + "Color"]
                  : "",
              ),
            ];
          }),
        );
        if (window.auditRefresh) requestAnimationFrame(sample);
      };
      sample();
    });
    await page.locator("#agendaViewToggle").click();
    assert.ok(
      !(await frames()).some(
        (a) => a.chip && !a.exit && a.frames.some((f) => f.opacity === 0),
      ),
      "3: Existing event cards do not replay an opacity entrance",
    );
    const outgoing = (await frames()).filter(
      (a) => a.exit && a.frames[0].opacity !== undefined,
    );
    assert.ok(
      outgoing.length > 0,
      "Overflowed cards have exit animations instead of disappearing immediately",
    );
    assert.ok(
      outgoing.every(
        (a) => a.frames[0].opacity === 1 && a.frames.at(-1).opacity === 0,
      ),
      "Only overflowed snapshots fade out",
    );
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".agenda-overflow-exit")];
      window.overflowOpacity = [];
      const sample = () => {
        window.overflowOpacity.push(
          nodes.map((node) =>
            node.isConnected ? Number(getComputedStyle(node).opacity) : 0,
          ),
        );
        if (nodes.some((node) => node.isConnected))
          requestAnimationFrame(sample);
      };
      sample();
    });
    assert.equal(
      await page.locator(".agenda-overflow-exits [data-agenda-edit]").count(),
      0,
      "Exiting snapshots cannot edit or save records",
    );
    assert.equal(
      await page
        .locator(".agenda-overflow-exits[inert][aria-hidden='true']")
        .count(),
      1,
    );
    await page.waitForTimeout(60);
    assert.ok(
      await page
        .locator(".agenda-overflow-exit")
        .first()
        .evaluate((node) => {
          const opacity = Number(getComputedStyle(node).opacity);
          return opacity > 0 && opacity < 1;
        }),
      "Overflow cards remain visible during their fade",
    );
    assert.equal(
      await page
        .locator(
          ".agenda-week-layers.motion-card-content, .agenda-week-layers.motion-content",
        )
        .count(),
      0,
    );
    await settle();
    assert.equal(
      await page.locator(".agenda-overflow-exits").count(),
      0,
      "Exit snapshots are released after the mode transition",
    );
    assert.ok(
      await page.evaluate(() =>
        window.overflowOpacity.every(
          (frame, index, samples) =>
            !index ||
            frame.every(
              (opacity, column) => opacity <= samples[index - 1][column] + 0.01,
            ),
        ),
      ),
      "Overflow opacity decreases monotonically, including after the short fade finishes and before row movement finishes",
    );
    assert.ok(
      await page.evaluate(() =>
        window.retainedChips.every((node) => node.isConnected),
      ),
      "3: Existing event nodes are retained during the two-to-three-week resize",
    );
    assert.deepEqual(
      await page.evaluate(() => window.refreshAnimations),
      [],
      "3: No CSS refresh animation starts on retained event cards",
    );
    await page.evaluate(() => {
      window.auditRefresh = false;
    });
    assert.deepEqual(
      await page.evaluate(() => window.selectionTransitions),
      [],
      "Selected borders do not replay color/shadow transitions during the week resize",
    );
    assert.equal(
      await page.evaluate(
        () => new Set(window.selectionPaint.map(JSON.stringify)).size,
      ),
      1,
      "Selected date and cross-week event outlines stay stable on every sampled frame",
    );
    assert.equal(
      await page.locator(".agenda-measuring").count(),
      0,
      "Measurement suppression is removed before painting",
    );
    const packed = await page.evaluate(() =>
      [...document.querySelectorAll(".agenda-packed-row")].flatMap((row) => {
        const rowRect = row.getBoundingClientRect();
        return row.dataset.dates.split(",").map((date) => {
          const cards = [...row.querySelectorAll(".agenda-chip:not([hidden])")]
            .filter(
              (n) =>
                n.dataset.agendaSegmentStart <= date &&
                n.dataset.agendaSegmentEnd >= date,
            )
            .map((n) => n.getBoundingClientRect())
            .sort((a, b) => a.top - b.top);
          return {
            date,
            gaps: cards.slice(1).map((r, i) => r.top - cards[i].bottom),
            bottom: Math.max(rowRect.top, ...cards.map((r) => r.bottom)),
            limit: rowRect.bottom,
            more:
              row.querySelector('[data-agenda-date="' + date + '"]')
                ?.textContent || "",
          };
        });
      }),
    );
    assert.ok(
      packed.every((d) => d.gaps.every((gap) => Math.abs(gap - 3) < 1)),
      "5: Each date has compact sequential cards with only the normal 3px gap",
    );
    assert.ok(
      packed.every((d) => d.bottom <= d.limit + 1),
      "5: No partial card extends past a date's display area",
    );
    assert.ok(
      packed.find((d) => d.date === "2026-10-28").more.endsWith("+"),
      "5: Dense dates expose the omitted count",
    );
    await page.screenshot({
      path: path.resolve("artifacts/agenda-packed-three-weeks.png"),
    });
    const packedSource = page
      .locator(".agenda-packed-row [data-agenda-edit]")
      .filter({
        has: page.locator(".agenda-chip-title-text", { hasText: "跨日 A" }),
      })
      .first();
    const packedRect = await packedSource.boundingBox();
    const anchor = await page
      .locator('#calendar .day[data-date="2026-10-29"]')
      .boundingBox();
    const destination = await page
      .locator('#calendar .day[data-date="2026-10-30"]')
      .boundingBox();
    await page.mouse.move(anchor.x + anchor.width / 2, packedRect.y + 8);
    await page.mouse.down();
    await page.mouse.move(
      destination.x + destination.width / 2,
      packedRect.y + 8,
      { steps: 10 },
    );
    assert.equal(
      await page.locator(".agenda-drag-preview").count(),
      1,
      "5: Compacted ribbons retain cross-date dragging",
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-27",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-11-04",
    );
    await page.locator("#agendaScheduleOpen").click();
    await setRange(page, "2026-10-26", "2026-11-03");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    await page
      .locator('#calendar .day[data-date="2026-10-29"] .day-select')
      .click({ position: { x: 6, y: 6 } });
    await settle();
    await mark();
    await page.evaluate(() => {
      window.auditText = true;
      window.textTransitions = [];
    });
    await page.locator("#agendaViewToggle").click();
    await settle();
    await page.waitForTimeout(180);
    assert.deepEqual(
      await page.evaluate(() => window.textTransitions),
      [],
      "4: No text translate transition starts during or after the mode change",
    );
    await page.evaluate(() => {
      window.auditText = false;
    });
    assert.equal(
      await page.locator(".agenda-text-shifting").count(),
      0,
      "4: A mode change does not enable a second text translation",
    );
    assert.ok(
      await page.evaluate(
        () =>
          ![
            ...document.querySelectorAll("#calendar .agenda-chip-title-text"),
          ].some((n) =>
            n.getAnimations().some((a) => a.transitionProperty === "translate"),
          ),
      ),
      "4: Selected text has no post-transition translate animation",
    );
    await page.locator("#agendaViewToggle").click();
    await settle();
    await page.locator("#agendaMode").click();
    await settle();
    await mark();
    await page.locator("#agendaMode").click();
    const enter = await frames();
    assert.equal(
      enter.filter((a) => a.lower && a.frames[0].height).length,
      7,
      "6: Entering single week animates all seven lower date surfaces",
    );
    assert.ok(
      enter.some((a) => a.day && a.frames[0].height && a.frames[0].transform),
      "6: The anchor row moves and resizes into place",
    );
    assert.ok(
      enter.some(
        (a) => a.time && a.frames[0].opacity === 0 && a.frames[1].opacity === 1,
      ),
      "6: Time content changes while the card surfaces morph",
    );
    await settle();
    for (const button of ["#nextMonth", "#prevMonth"]) {
      await mark();
      await page.locator(button).click();
      const slide = (await frames()).find(
        (a) => a.page && a.frames[0].transform,
      );
      assert.ok(
        slide.frames.every((f) => /^translateX\(/.test(f.transform)),
        "7: Single-week navigation is horizontal",
      );
      assert.equal(
        slide.options.duration,
        await page.evaluate(
          () => WorkTimeApp.ui.motion.calendar.navigationDuration,
        ),
      );
      await settle();
    }
    await page
      .locator(".timetable-column")
      .nth(4)
      .click({ position: { x: 10, y: 20 } });
    assert.equal(
      await page.locator(".timetable-bottom-card.is-selected").count(),
      1,
    );
    await page.locator("#agendaMode").click();
    await settle();
    await page
      .locator('#calendar .day[data-date="2026-10-15"] .day-select')
      .click({ position: { x: 6, y: 6 } });
    await settle();
    await mark();
    await page.locator("#agendaMode").click();
    assert.equal(
      (await frames()).filter((a) => a.lower && a.frames[0].height).length,
      7,
    );
    assert.equal(
      await page
        .locator(
          '.day.agenda-week-leaving[data-date="2026-10-19"], .day.agenda-week-leaving[data-date="2026-10-20"], .day.agenda-week-leaving[data-date="2026-10-21"]',
        )
        .count(),
      0,
      "1/6: Source dates consumed by the lower row are never painted a second time",
    );
    await settle();
    for (let i = 0; i < 4; i++) {
      await page.locator("#agendaViewToggle").click();
      await page.waitForTimeout(35);
    }
    await settle();
    assert.equal(
      await page
        .locator(".agenda-week-leaving, .calendar-navigation-copy")
        .count(),
      0,
      "Interrupted view morphs release all outgoing rows",
    );
    assert.equal(await page.locator(".timetable-bottom-card").count(), 7);
    // Packed runs must never survive a return to the shared month/week lanes.
    await create("周六结束", "2026-10-26", "2026-10-31");
    await create("连续到周日", "2026-10-26", "2026-11-01");
    await create("全天 C", "2026-10-29");
    await create("全天 D", "2026-10-29");
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let mode = 0; mode < 4; mode++) {
        await page.locator("#agendaViewToggle").click();
        await settle();
        for (const ids of await page
          .locator(".agenda-packed-row")
          .evaluateAll((rows) =>
            rows.map((row) =>
              [...row.querySelectorAll(".agenda-chip:not([hidden])")].map(
                (button) => button.dataset.agendaEdit,
              ),
            ),
          ))
          assert.equal(
            new Set(ids).size,
            ids.length,
            "A cross-date event stays one continuous ribbon within its calendar row",
          );
        const lanes = await page
          .locator(".agenda-week-lane:not(.agenda-packed-row)")
          .evaluateAll((rows) =>
            rows.map((row) => {
              const buttons = [
                ...row.querySelectorAll(
                  ".agenda-lane-content > [data-agenda-edit]",
                ),
              ];
              return {
                ids: buttons.map((b) => b.dataset.agendaEdit),
                heights: buttons.map((b) => b.style.height),
                visibleHeights: buttons
                  .filter(
                    (b) =>
                      b.getClientRects().length &&
                      getComputedStyle(b).visibility !== "hidden",
                  )
                  .map((b) => b.getBoundingClientRect().height),
              };
            }),
          );
        for (const lane of lanes) {
          assert.equal(
            new Set(lane.ids).size,
            lane.ids.length,
            "Month/week has one display segment per event in each row",
          );
          assert.ok(
            lane.heights.every((height) => !height),
            "Packed heights are cleared on return to month/week",
          );
          if (await page.locator(".timetable-bottom-card").count())
            assert.ok(
              lane.visibleHeights.every((height) => Math.abs(height - 26) < 1),
              "Single-week all-day events retain compact height",
            );
        }
        if (cycle === 1 && mode >= 2)
          await page.screenshot({
            path: path.resolve(
              "artifacts/agenda-restored-" +
                (mode === 2 ? "month" : "week") +
                ".png",
            ),
          });
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#agendaViewToggle").click();
    await settle();
    await page.locator("#agendaViewToggle").click();
    await settle();
    assert.equal(
      await page.locator(".agenda-overflow-exits").count(),
      0,
      "Reduced motion hides overflow without exit effects",
    );
    assert.deepEqual(errors, []);
    console.log(
      "All seven requirements verified: unique week entry, two-row resize, no event refresh flash, no extra text shift, compact per-date overflow, work-to-week morph, horizontal weekly navigation.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
