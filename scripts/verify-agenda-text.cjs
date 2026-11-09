"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verifyFirstDateSelection(browser) {
  for (const width of [1480, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
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
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("刷新后第一次选择日期的跨天日程");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-19", "2026-10-25");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    for (const weeks of [0, 1, 2, 3]) {
      if (weeks) await page.locator("#agendaViewToggle").click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.reload();
      await ready();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some((a) => a.pending || a.playState === "running"),
      );
      for (const date of ["2026-10-22", "2026-10-23"]) {
        // Let font/resize observers commit the resting layout before sampling
        // the next gesture's initial position.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const result = await page.evaluate((date) => {
          const chip = [
            ...document.querySelectorAll(
              ".agenda-week-lane .agenda-chip:not([hidden])",
            ),
          ].find((node) => node.textContent.includes("刷新后第一次"));
          const text = chip.querySelector(".agenda-chip-title-text");
          const start = text.getBoundingClientRect().left;
          document
            .querySelector(
              '#calendar > .day[data-date="' + date + '"] .day-select',
            )
            .click();
          const current = [
            ...document.querySelectorAll(
              ".agenda-week-lane .agenda-chip:not([hidden])",
            ),
          ].find((node) => node.dataset.agendaEdit === chip.dataset.agendaEdit);
          const title = current.querySelector(".agenda-chip-title-text");
          const animation = title
            .getAnimations()
            .find((a) => a.transitionProperty === "translate");
          if (!animation)
            return {
              animated: false,
              reused: text === title,
              className: current.closest(".agenda-week-lane").className,
            };
          animation.pause();
          animation.currentTime = 0;
          const first = title.getBoundingClientRect().left;
          animation.currentTime = 180;
          const middle = title.getBoundingClientRect().left;
          animation.currentTime = 360;
          const end = title.getBoundingClientRect().left;
          animation.finish();
          return {
            animated: true,
            reused: text === title,
            start,
            first,
            middle,
            end,
            date: current.dataset.agendaTextDate,
          };
        }, date);
        assert.equal(
          result.animated,
          true,
          `Text animates on the first and subsequent clicks after reload: ${width}px, ${weeks} weeks, ${JSON.stringify(result)}`,
        );
        assert.equal(result.reused, true);
        assert.ok(
          Math.abs(result.first - result.start) < 1,
          `${width}px, ${weeks} weeks, ${date}: ${JSON.stringify(result)}`,
        );
        assert.ok(result.middle > result.first && result.middle < result.end);
        assert.equal(result.date, date);
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(
        () => document.documentElement.dataset.reducedMotion === "true",
      );
      await page
        .locator('#calendar > .day[data-date="2026-10-21"] .day-select')
        .click({ position: { x: 8, y: 8 } });
      assert.equal(
        await page
          .locator(".agenda-week-lane .agenda-chip-title-text")
          .evaluateAll((nodes) =>
            nodes.some((node) =>
              node
                .getAnimations()
                .some((a) => a.transitionProperty === "translate"),
            ),
          ),
        false,
      );
    }
    await page.close();
  }
}
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    await verifyFirstDateSelection(browser);
    for (const [scale, zoom] of [
      [1, 1],
      [1.25, 1],
      [1.5, 1],
      [2, 1],
      [1, 1.25],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1200 },
        deviceScaleFactor: scale,
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (const title of [
        "痛五痛五痛五".repeat(24),
        "Continuous English title across calendar dates ".repeat(8),
        "中文 English 123 连续文本 ".repeat(12),
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await setScheduleRange(page, "2026-10-14");
        await page.locator("#agendaEndDateInput").fill("2026-10-22");
        // Keep an all-day ribbon in week view, where timed events use the timetable.
        if (!title.startsWith("痛")) {
          await page.locator("#agendaAllDay").uncheck();
          await page.locator("#agendaStart").fill("09:00");
          await page.locator("#agendaEnd").fill("18:00");
        }
        await page.locator("[data-schedule-close]").click();
        await page
          .locator("#agendaNote")
          .fill("多行备注 English 文字跨日期\n第二行备注");
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      for (const view of ["month", "week", "fortnight"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        await page
          .locator('#calendar .day[data-date="2026-10-14"] .day-select')
          .click({ position: { x: 8, y: 8 } });
        await page.mouse.move(0, 0);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const state = await page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              titleCount: node.querySelectorAll(".agenda-chip-title-text")
                .length,
              copies: node.querySelectorAll(".agenda-chip-face > *").length,
              mask: getComputedStyle(node).maskImage,
              texts: [
                ...node.querySelectorAll(
                  ".agenda-chip-title-text, :scope > .agenda-chip-time, :scope > .agenda-chip-note",
                ),
              ].map((text) => ({
                visibility: getComputedStyle(text).visibility,
                mask: getComputedStyle(text).maskImage,
              })),
            })),
          );
        assert.ok(state.length > 0);
        for (const chip of state) {
          assert.equal(chip.titleCount, 1);
          assert.equal(chip.copies, 0);
          assert.equal(chip.mask, "none");
          for (const text of chip.texts) {
            assert.equal(text.visibility, "visible");
            assert.equal(text.mask, "none");
          }
        }
        const strip = page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .first();
        const geometry = await strip.evaluate((node) => {
          const title = node.querySelector(".agenda-chip-title-text");
          const row = node.closest(".agenda-week-lane");
          const first = [...document.querySelectorAll("#calendar > .day")].find(
            (card) =>
              (card.dataset.date || card.dataset.previewDate) ===
              node.dataset.agendaSegmentStart,
          );
          const box = first.getBoundingClientRect();
          return {
            right: title.getBoundingClientRect().right,
            limit: box.right,
            ellipsis: getComputedStyle(title).textOverflow,
            truncated: title.scrollWidth > title.clientWidth,
            date: row.dataset.dates,
          };
        });
        assert.ok(
          geometry.right < geometry.limit,
          `Heading stays inside its first date: ${scale} ${zoom} ${view}`,
        );
        assert.equal(geometry.ellipsis, "ellipsis");
        assert.ok(geometry.truncated);
        if (scale === 1 && zoom === 1)
          await page.screenshot({ path: `artifacts/agenda-text-${view}.png` });
        // Only date-card clicks move text. Event clicks preserve that anchor.
        await page
          .locator('#calendar .day[data-date="2026-10-16"] .day-select')
          .click({ position: { x: 8, y: 8 } });
        assert.equal(
          await strip.getAttribute("data-agenda-text-date"),
          "2026-10-16",
        );
        const insets = await strip.evaluate((node) => {
          const card = document.querySelector(
            '#calendar .day[data-date="2026-10-16"]',
          );
          const cardStyle = getComputedStyle(card);
          const style = getComputedStyle(node);
          const scale =
            node.getBoundingClientRect().width / parseFloat(style.width);
          const expected =
            card.getBoundingClientRect().left +
            (card.clientLeft +
              parseFloat(cardStyle.paddingLeft) -
              (parseFloat(
                getComputedStyle(
                  document.getElementById("calendar"),
                ).getPropertyValue("--agenda-card-left-extension"),
              ) || 0) +
              parseFloat(style.borderLeftWidth) +
              parseFloat(style.paddingLeft)) *
              scale;
          return [
            ...node.querySelectorAll(
              ".agenda-chip-title-text, :scope > .agenda-chip-time, :scope > .agenda-chip-note",
            ),
          ]
            .filter((text) => text.getClientRects().length)
            .map(
              (text) => (text.getBoundingClientRect().left - expected) / scale,
            );
        });
        for (const inset of insets)
          assert.ok(
            Math.abs(inset) < 1,
            "Moved title, time and note use ordinary date padding: " +
              JSON.stringify({ scale, zoom, view, insets }),
          );
        const laneOutline = await strip.evaluate((node) => {
          const lane = node.closest(".agenda-week-lane");
          lane.focus();
          return getComputedStyle(lane).outlineStyle;
        });
        assert.equal(
          laneOutline,
          "none",
          "Focusing a scroll lane must not draw a frame across the week",
        );
        const textLeft = await strip
          .locator(".agenda-chip-title-text")
          .evaluate((node) => node.getBoundingClientRect().left);
        await strip.click({ position: { x: 12, y: 8 } });
        assert.equal(
          await strip.getAttribute("data-agenda-text-date"),
          "2026-10-16",
        );
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => node.getBoundingClientRect().left),
          textLeft,
        );
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => node.getAnimations().length),
          0,
        );
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        if (scale === 1 && zoom === 1)
          await page.screenshot({
            path: `artifacts/agenda-text-selected-${view}.png`,
          });
        await page.locator("#agendaCancel").click();
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        assert.ok(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => node.scrollWidth > node.clientWidth),
        );
        // Continuation endpoints are dashed only, without an inset left stroke.
        const continuations = await page
          .locator(".agenda-chip.continues-before:visible")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              left: getComputedStyle(node, "::before").width,
              shadow: getComputedStyle(node).getPropertyValue(
                "--agenda-chip-outline",
              ),
              faces: [...node.querySelectorAll(".agenda-chip-face")].map(
                (face) => getComputedStyle(face).boxShadow,
              ),
            })),
          );
        for (const continuation of continuations) {
          assert.equal(continuation.left, "1px");
          for (const shadow of continuation.faces)
            assert.ok(
              !shadow.includes("0px 0px 0px 1px"),
              "No solid outline stacked beside the continuation dash",
            );
        }
      }
      if (scale === 1 && zoom === 1) {
        const laneOffsets = () =>
          page
            .locator(".agenda-week-lane")
            .first()
            .evaluate((row) =>
              [...row.querySelectorAll(".agenda-chip")].map((chip) =>
                parseFloat(chip.style.top),
              ),
            );
        const beforeFont = await laneOffsets();
        const fontMetrics = await page.addStyleTag({
          content: ".agenda-chip-title { padding-block: 12px !important; }",
        });
        await page.evaluate(async () => {
          document.fonts.dispatchEvent(new Event("loadingdone"));
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        const afterFont = await laneOffsets();
        assert.ok(
          afterFont[1] >= beforeFont[1] + 20,
          "Font metric invalidation must remeasure chip heights and reposition later lanes",
        );
        await fontMetrics.evaluate((node) => node.remove());
        await page.evaluate(async () => {
          document.fonts.dispatchEvent(new Event("loadingdone"));
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        assert.deepEqual(await laneOffsets(), beforeFont);
        const strip = page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .first();
        await strip.focus();
        await strip.press("Enter");
        await page.locator("#agendaForm").waitFor({ state: "visible" });
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        await page.locator("#agendaCancel").click();
        const id = await strip.getAttribute("data-agenda-edit");
        const complete = page.locator(`[data-agenda-status="${id}"]`);
        await complete.click();
        await page.locator('[data-agenda-status-choice="completed"]').click();
        await page.waitForFunction(
          (id) =>
            [...document.querySelectorAll(".agenda-chip")]
              .filter((node) => node.dataset.agendaEdit === id)
              .every((node) => node.classList.contains("is-complete")),
          id,
        );
        const segments = page.locator(
          `.agenda-week-lane .agenda-chip[data-agenda-edit="${id}"]`,
        );
        for (const segment of await segments.all()) {
          assert.equal(await segment.locator(".agenda-chip-status").count(), 1);
          assert.equal(
            await segment.locator(".agenda-chip-status svg").count(),
            0,
          );
        }
        await complete.click();
        await page.locator('[data-agenda-status-choice="pending"]').click();
        await page.waitForFunction(
          (id) =>
            [...document.querySelectorAll(".agenda-chip")]
              .filter((node) => node.dataset.agendaEdit === id)
              .every((node) => !node.classList.contains("is-complete")),
          id,
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Single-date heading truncation without text masks, keyboard/completion, continuation outlines, month/week/fortnight and DPI/zoom verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
