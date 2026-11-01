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
    const event = page.locator(".timetable-event[data-agenda-edit]").filter({
      has: page.locator(".agenda-chip-title-text", { hasText: "上下边界调时" }),
    });
    const assertSelectedDate = async (date) => {
      const upper = page.locator(`#calendar > .day[data-date="${date}"]`);
      assert.equal(
        await upper.locator(".day-select").getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .locator("#calendar > .day.selected")
          .getAttribute("data-date"),
        date,
      );
      assert.equal(
        await page
          .locator(".timetable-bottom-card.is-selected")
          .getAttribute("data-timetable-date"),
        date,
      );
      assert.equal(
        await upper.evaluate((node) => {
          for (const animation of node.getAnimations()) animation.finish();
          const other = node.parentElement.querySelector(
            ".day:not(.selected):not(.restday)",
          );
          return (
            getComputedStyle(node).borderColor !==
            getComputedStyle(other).borderColor
          );
        }),
        true,
        "The upper date selection remains visibly highlighted while editing a timed event",
      );
    };
    for (const keyboard of [false, true]) {
      await page
        .locator('#calendar > .day[data-date="2026-10-30"] .day-select')
        .click();
      if (keyboard) {
        await event.focus();
        await page.keyboard.press("Enter");
      } else await event.click();
      await assertSelectedDate("2026-10-29");
      await page.locator("#agendaCancel").click();
    }
    const point = (minute, date = "2026-10-29") =>
      page
        .locator(`.timetable-column[data-timetable-date="${date}"]`)
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
    const resize = async (
      edge,
      minute,
      cancel = false,
      targetDate = "2026-10-29",
    ) => {
      await page
        .locator('#calendar > .day[data-date="2026-10-30"] .day-select')
        .click();
      await page.waitForFunction(
        () => !document.querySelector(".agenda-timetable.is-axis-morphing"),
      );
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
      const target = await point(minute, targetDate);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await assertSelectedDate("2026-10-29");
      assert.equal(
        await event.getAttribute("aria-current"),
        "true",
        "Pressing either resize handle immediately selects the event",
      );
      assert.equal(
        await page
          .locator("#agendaTitle")
          .evaluate((node) => node === document.activeElement),
        false,
        "Resize activation keeps focus on the timeline",
      );
      await page.mouse.move(target.x, target.y, { steps: 6 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const preview = page.locator(".timetable-preview");
      await preview.waitFor({ state: "visible" });
      assert.equal(
        await preview.evaluate((node) => {
          const animation = node
            .getAnimations()
            .find((effect) => effect.transitionProperty === "height");
          if (!animation) return false;
          const frames = animation.effect.getKeyframes();
          return frames[0].height !== frames.at(-1).height;
        }),
        true,
        "Resizing interpolates the preview height from its previous geometry",
      );
      assert.equal(
        await preview.getAttribute("aria-current"),
        "true",
        "The resize preview retains the activated event selection",
      );
      const sample = await preview.evaluate((node) => {
        window.__resizePreview = node;
        const card = node.getBoundingClientRect();
        const title = node.querySelector(".agenda-chip-title-text");
        return {
          x: title.getBoundingClientRect().x - card.x,
          y: title.getBoundingClientRect().y - card.y,
          time: node.querySelector(".agenda-chip-time").textContent,
        };
      });
      // Several pointer frames inside one snap must retain both the DOM and
      // its already aligned text, including with ordinary motion enabled.
      for (const jitter of [0.2, -0.2, 0]) {
        await page.mouse.move(target.x, target.y + jitter);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const actual = await preview.evaluate((node) => {
          const card = node.getBoundingClientRect();
          const title = node.querySelector(".agenda-chip-title-text");
          return {
            same: node === window.__resizePreview,
            x: title.getBoundingClientRect().x - card.x,
            y: title.getBoundingClientRect().y - card.y,
            time: node.querySelector(".agenda-chip-time").textContent,
          };
        });
        assert.equal(actual.same, true, "Pointer samples reuse preview text");
        assert.ok(Math.abs(actual.x - sample.x) < 0.05);
        assert.ok(Math.abs(actual.y - sample.y) < 0.05);
        assert.equal(actual.time, sample.time);
      }
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
      assert.equal(
        await page.locator("#agendaDateInput").inputValue(),
        "2026-10-29",
      );
      assert.equal(
        await page.locator("#agendaEndDateInput").inputValue(),
        "2026-10-29",
      );
      await page.locator("#agendaCancel").click();
    };
    await resize("start", 525);
    await assertTimes("08:45", "10:15");
    await resize("end", 660);
    await assertTimes("08:45", "11:00");
    await event.click();
    await page.locator("#agendaNote").fill("调整时间时保留未保存备注");
    const activeHandle = await event
      .locator(".timetable-resize-end")
      .boundingBox();
    await page.mouse.move(
      activeHandle.x + activeHandle.width / 2,
      activeHandle.y + activeHandle.height / 2,
    );
    await page.mouse.down();
    assert.equal(
      await page.locator("#agendaNote").inputValue(),
      "调整时间时保留未保存备注",
    );
    await assertSelectedDate("2026-10-29");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.locator("#agendaCancel").click();
    await resize("start", 570, true);
    await assertTimes("08:45", "11:00");
    await resize("end", 510);
    await assertTimes("08:45", "09:00");
    await resize("end", 660);
    await assertTimes("08:45", "11:00");
    await resize("end", 720, false, "2026-10-30");
    await assertTimes("08:45", "12:00");
    await resize("start", 510, false, "2026-10-28");
    await assertTimes("08:30", "12:00");
    await resize("start", 525);
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
    for (const [date, start, end] of [
      ["2026-10-30", 540, 600],
      ["2026-10-29", 570, 630],
      ["2026-10-29", 735, 795],
    ]) {
      await page.waitForFunction(
        () => !document.querySelector(".agenda-timetable.is-axis-morphing"),
      );
      await event.evaluate((node) => {
        const title = node.querySelector(".agenda-chip-title-text");
        const time = node.querySelector(".agenda-chip-time");
        const y = (text) =>
          text.getBoundingClientRect().top - node.getBoundingClientRect().top;
        const initial = [y(title), y(time)];
        window.__creationMotion = { running: true, failures: [] };
        const sample = () => {
          const track = window.__creationMotion;
          if (!track.running) return;
          if (
            node.querySelector(".agenda-chip-title-text") !== title ||
            node.querySelector(".agenda-chip-time") !== time
          )
            track.failures.push("Unchanged text nodes were replaced");
          else if (
            Math.abs(y(title) - initial[0]) > 0.05 ||
            Math.abs(y(time) - initial[1]) > 0.05
          )
            track.failures.push(
              "Existing text shifted vertically inside its card",
            );
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const from = await point(start, date),
        to = await point(end, date);
      // The right side is blank even when the preview will overlap an event.
      const origin = await page
        .locator(`.timetable-column[data-timetable-date="${date}"]`)
        .boundingBox();
      const x = origin.x + origin.width - 1;
      if (date === "2026-10-30") {
        // A complete gesture in one event turn must not depend on the queued
        // preview frame having painted before pointerup.
        await page.evaluate(
          ({ x, from, to }) => {
            const options = {
              bubbles: true,
              pointerId: 99,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              clientX: x,
            };
            document.elementFromPoint(x, from.y).dispatchEvent(
              new PointerEvent("pointerdown", {
                ...options,
                clientY: from.y,
              }),
            );
            document.dispatchEvent(
              new PointerEvent("pointermove", { ...options, clientY: to.y }),
            );
            document.dispatchEvent(
              new PointerEvent("pointerup", { ...options, clientY: to.y }),
            );
          },
          { x, from, to },
        );
      } else {
        await page.mouse.move(x, from.y);
        await page.mouse.down();
        await page.mouse.move(x, to.y, { steps: 8 });
        await page.mouse.up();
      }
      await page.locator("#agendaForm").waitFor({ state: "visible" });
      await page.locator("#agendaTitle").fill("框选创建回归");
      await page.locator(end === 795 ? "#agendaSave" : "#agendaCancel").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".agenda-timetable")
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.pending || animation.playState === "running",
            ),
      );
      const failures = await page.evaluate(() => {
        window.__creationMotion.running = false;
        return [...new Set(window.__creationMotion.failures)];
      });
      assert.deepEqual(
        failures,
        [],
        "Blank-grid creation preserves other events' text and baselines",
      );
    }
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("跨日片段日期选择");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-29");
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaEndDateInput").fill("2026-10-30");
    await page.locator("#agendaStart").fill("23:00");
    await page.locator("#agendaEnd").fill("01:00");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    const continuation = page
      .locator('.timetable-event[data-timetable-date="2026-10-30"]')
      .filter({
        has: page.locator(".agenda-chip-title-text", {
          hasText: "跨日片段日期选择",
        }),
      });
    for (const keyboard of [false, true]) {
      await page
        .locator('#calendar > .day[data-date="2026-10-29"] .day-select')
        .click();
      if (keyboard) {
        await continuation.focus();
        await page.keyboard.press("Enter");
      } else await continuation.click();
      await assertSelectedDate("2026-10-30");
      assert.equal(
        await page.locator("#agendaDateInput").inputValue(),
        "2026-10-29",
        "Selecting a continuation does not change the event's original start date",
      );
      await page.locator("#agendaCancel").click();
    }
    await page
      .locator('#calendar > .day[data-date="2026-10-29"] .day-select')
      .click();
    await continuation.locator(".timetable-resize-end").hover();
    const continuationHandle = await continuation
      .locator(".timetable-resize-end")
      .boundingBox();
    await page.mouse.move(
      continuationHandle.x + continuationHandle.width / 2,
      continuationHandle.y + continuationHandle.height / 2,
    );
    await page.mouse.down();
    await assertSelectedDate("2026-10-30");
    assert.equal(await continuation.getAttribute("aria-current"), "true");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.locator("#agendaCancel").click();
    // The bottom of an expanded axis snaps to 24:00. A resize must stop at
    // 23:59 rather than saving midnight on the following date.
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("当日午夜边界");
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, "2026-10-29");
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaStart").fill("23:30");
    await page.locator("#agendaEnd").fill("23:45");
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => !document.querySelector(".agenda-timetable.is-axis-morphing"),
    );
    const late = page
      .locator(".timetable-event[data-agenda-edit]")
      .filter({ hasText: "当日午夜边界" });
    const lateId = await late.getAttribute("data-agenda-edit");
    const lateHandle = await late
      .locator(".timetable-resize-end")
      .boundingBox();
    const midnight = await point(1440, "2026-10-30");
    await page.mouse.move(
      lateHandle.x + lateHandle.width / 2,
      lateHandle.y + lateHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(midnight.x, midnight.y - 1, { steps: 6 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(
      await page.locator(".timetable-preview").count(),
      1,
      "Handle previews never extend into an adjacent date",
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".timetable-hint"),
    );
    await late.click();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-29",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-29",
    );
    assert.equal(await page.locator("#agendaEnd").inputValue(), "23:59");
    await page.locator("#agendaCancel").click();
    await page.locator(`[data-agenda-delete="${lateId}"]`).click();
    for (const width of [1480, 2000, 520]) {
      await page.setViewportSize({ width, height: 1000 });
      const clipping = await event.evaluate(async (node) => {
        const fixture = node.cloneNode(true);
        fixture.removeAttribute("data-agenda-edit");
        fixture.style.width = "160px";
        // Keep this synthetic height sweep outside the live grid reconciler.
        const host = document.createElement("div");
        host.className = "agenda-timetable";
        host.append(fixture);
        document.body.append(host);
        WorkTimeApp.ui.alignment.refresh([fixture]);
        const time = fixture.querySelector(".agenda-chip-time");
        const failures = [];
        const states = new Set();
        const inspect = () => {
          const style = getComputedStyle(fixture);
          const visible = getComputedStyle(time).visibility !== "hidden";
          states.add(visible);
          if (!visible) return;
          const card = fixture.getBoundingClientRect();
          const line = time.getBoundingClientRect();
          const bottom =
            card.bottom -
            parseFloat(style.borderBottomWidth) -
            parseFloat(style.paddingBottom);
          if (line.bottom > bottom + 0.05)
            failures.push({ height: card.height, bottom, line: line.bottom });
        };
        // Sweep fractional heights around the cutoff at all three font sizes.
        for (let height = 16; height <= 64; height += 0.25) {
          fixture.style.height = height + "px";
          inspect();
        }
        const animation = fixture.animate(
          [{ height: "64px" }, { height: "16px" }],
          { duration: 240, fill: "both" },
        );
        while (animation.playState !== "finished") {
          await new Promise(requestAnimationFrame);
          inspect();
        }
        animation.cancel();
        fixture.classList.add("is-point");
        fixture.style.height = "18px";
        const pointVisible = getComputedStyle(time).visibility === "visible";
        host.remove();
        return { failures, states: states.size, pointVisible };
      });
      assert.deepEqual(clipping.failures, [], "Time lines are never cropped");
      assert.equal(
        clipping.states,
        2,
        "Short cards hide time; tall cards show it",
      );
      assert.equal(
        clipping.pointVisible,
        true,
        "Point events retain inline time",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "Timetable interactions verified: blank-grid creation/cancel/save preserves other labels and baselines, stable resize text, complete time-line visibility at fractional/animated heights and responsive font sizes, minimum duration, Escape and reload persistence.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
