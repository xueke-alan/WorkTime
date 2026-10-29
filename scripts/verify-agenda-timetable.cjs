"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const root = path.resolve(process.argv[2] || ".");

function verifyMath() {
  const context = vm.createContext({ WorkTimeApp: { ui: {}, domain: {} } });
  for (const file of [
    "domain/time.js",
    "domain/agenda.js",
    "ui/agenda-timeline-math.js",
  ])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../assets/js", file), "utf8"),
      context,
    );
  const m = context.WorkTimeApp.ui.agendaTimelineMath;
  const item = (overrides = {}) => ({
    id: "a",
    title: "event",
    date: "2026-10-28",
    endDate: "2026-10-28",
    allDay: false,
    start: "09:07",
    end: "10:07",
    note: "",
    status: "pending",
    createdAt: "2026-10-28T00:00:00Z",
    updatedAt: "2026-10-28T00:00:00Z",
    ...overrides,
  });
  const schedule = {
    workStart: "08:00",
    workEnd: "17:30",
    breaks: [{ start: 720, end: 810 }],
  };
  const schedules = Array(7).fill(schedule);
  const dates = ["2026-10-28", "2026-10-29", "2026-10-30"];
  const overnight = m.slice(
    [item({ start: "23:00", end: "01:00", endDate: dates[1] })],
    dates,
  );
  assert.equal(overnight.length, 2);
  assert.equal(overnight[0].end, 1440);
  assert.equal(overnight[1].start, 0);
  assert.equal(overnight[1].continuesBefore, true);
  assert.equal(
    m.slice([item({ end: "00:00", endDate: dates[1] })], dates).length,
    1,
  );
  assert.equal(m.slice([item({ end: "" })], dates)[0].end, null);
  const empty = m.axis(schedules, [], 700);
  assert.equal(empty.start, 480);
  assert.equal(empty.end, 1050);
  assert.equal(empty.bands.filter((b) => b.compressed).length, 1);
  for (const minute of [480, 570, 720, 750, 810, 900, 1050])
    assert.ok(Math.abs(empty.at(empty.y(minute)) - minute) < 0.001);
  assert.equal(
    m
      .axis(
        schedules,
        m.slice([item({ start: "12:30", end: "12:45" })], dates),
        700,
      )
      .bands.some((b) => b.compressed),
    false,
  );
  assert.equal(
    m
      .axis([schedule, { ...schedule, breaks: [] }], [], 700)
      .bands.some((b) => b.compressed),
    false,
  );
  const expanded = m.axis(
    schedules,
    m.slice([item({ start: "06:07", end: "21:01" })], dates),
    700,
  );
  assert.equal(expanded.start, 360);
  assert.equal(expanded.end, 1290);
  assert.equal(m.axis(schedules, overnight, 360).end, 1440);
  const cols = m.columns(
    m.slice(
      [
        item(),
        item({ id: "b", start: "09:30", end: "10:30" }),
        item({ id: "c", start: "10:30", end: "11:00" }),
      ],
      dates,
    ),
  );
  assert.equal(cols[0].columns, 2);
  assert.equal(cols[1].column, 1);
  assert.equal(cols[2].columns, 1);
  const original = m.bounds(item());
  const moved = m.update(item(), original.start + 1455, original.end + 1455);
  assert.equal(moved.date, "2026-10-29");
  assert.equal(moved.start, "09:22");
  assert.equal(moved.end, "10:22");
  console.log(
    "Timetable slicing, midnight, compressed mapping, variable schedules, expansion and overlap columns verified.",
  );
}

async function verifyBrowser() {
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
    page.on("pageerror", (e) => errors.push(e.message));
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      return dialog.accept();
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    const idleReads = await page.evaluate(async () => {
      const calendar = document.createElement("div");
      calendar.style.cssText =
        "position:fixed;left:-1000px;width:200px;height:200px";
      const day = document.createElement("div");
      day.className = "day";
      day.style.cssText = "width:100px;height:100px";
      const icon = document.createElement("span");
      day.append(icon);
      calendar.append(day);
      document.body.append(calendar);
      const animation = icon.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 1000,
        iterations: Infinity,
      });
      let reads = 0;
      const bounds = day.getBoundingClientRect.bind(day);
      day.getBoundingClientRect = () => {
        reads++;
        return bounds();
      };
      const edges = WorkTimeApp.ui.createAgendaEdges({
        calendar,
        enabled: () => true,
      });
      try {
        edges.refresh();
        await new Promise((resolve) => setTimeout(resolve, 100));
        reads = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return reads;
      } finally {
        edges.dispose();
        animation.cancel();
        calendar.remove();
      }
    });
    assert.equal(
      idleReads,
      0,
      "Looping child icons must leave date edge geometry idle",
    );
    await page.locator("#agendaMode").click();
    await page.locator("#agendaViewToggle").click();
    assert.equal(
      await page.locator(".agenda-timetable").count(),
      1,
      "Single week directly includes time cards",
    );
    assert.equal(await page.locator(".agenda-week-lane").count(), 1);
    assert.equal(await page.locator(".timetable-bottom-card").count(), 7);
    assert.ok(
      await page.evaluate(() => {
        const top = [
          ...document.querySelectorAll("#calendar > .day[data-agenda-week]"),
        ].map((n) => n.getBoundingClientRect());
        const bottom = [
          ...document.querySelectorAll(".timetable-bottom-card"),
        ].map((n) => n.getBoundingClientRect());
        return (
          top.length === 7 &&
          top.every(
            (r, i) =>
              Math.abs(r.left - bottom[i].left) < 1 &&
              Math.abs(r.width - bottom[i].width) < 1 &&
              bottom[i].top > r.bottom + 1 &&
              Math.abs(r.height - top[0].height) < 1 &&
              Math.abs(bottom[i].top - bottom[0].top) < 1,
          )
        );
      }),
      "Fourteen separate, aligned cards keep their column and row gaps",
    );
    const dates = await page
      .locator("#calendar > .day[data-agenda-week]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.dataset.date || n.dataset.previewDate),
      );
    const date = dates[2];
    const create = async (
      title,
      start = "",
      end = "",
      first = date,
      last = first,
      status = "pending",
    ) => {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaItemStatus").selectOption(status);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, first, last);
      if (start) {
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill(start);
        await page.locator("#agendaEnd").fill(end);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    };
    await create("全天跨度", "", "", dates[0], dates[3]);
    await create("精确分钟", "09:07", "10:07");
    await create("重叠", "09:30", "10:30", date, date, "in-progress");
    await create("短事件", "11:00", "11:05", date, date, "completed");
    await create("时间点", "14:00", "", date, date, "cancelled");
    await page.locator(".agenda-timetable").waitFor();
    assert.equal(await page.locator(".agenda-week-lane").count(), 1);
    assert.equal(await page.locator(".timetable-break").count(), 7);
    assert.equal(await page.locator("#agendaTimetableToggle").count(), 0);
    assert.equal(
      await page.locator(".timetable-gutter, .timetable-tick").count(),
      0,
    );
    assert.equal(
      await page
        .locator(".timetable-grid")
        .first()
        .evaluate((n) => n.scrollWidth > n.clientWidth),
      false,
    );
    const event = (title) =>
      page.locator("#calendar [data-agenda-edit]").filter({
        has: page.locator(".agenda-chip-title-text", { hasText: title }),
      });
    assert.equal(await event("全天跨度").count(), 1);
    const a = await event("精确分钟").boundingBox();
    const b = await event("重叠").boundingBox();
    assert.ok(
      a.x + a.width <= b.x + 1,
      "Overlapping events occupy separate columns",
    );
    assert.ok(
      (await event("短事件").boundingBox()).height < a.height / 5,
      "Short event uses actual duration",
    );
    assert.equal(
      await event("时间点").getAttribute("data-status"),
      "cancelled",
    );
    assert.equal(await event("时间点").locator(".timetable-resize").count(), 0);
    const point = async (index, minute) =>
      page.evaluate(
        ({ index, minute }) => {
          const column = document
            .querySelectorAll(".timetable-column")
            [index].getBoundingClientRect();
          const grid = document
            .querySelectorAll(".timetable-grid")
            [index].getBoundingClientRect();
          const ticks = [
            ...document
              .querySelectorAll(".timetable-grid")
              [index].querySelectorAll(".timetable-rule"),
          ]
            .map((n) => ({
              minute: Number(n.dataset.minute),
              y: parseFloat(n.style.top),
            }))
            .sort((a, b) => a.minute - b.minute);
          const before = ticks.filter((t) => t.minute <= minute).at(-1),
            after = ticks.find((t) => t.minute >= minute);
          const y =
            before.minute === after.minute
              ? before.y
              : before.y +
                ((after.y - before.y) * (minute - before.minute)) /
                  (after.minute - before.minute);
          return { x: column.x + column.width / 2, y: grid.y + y };
        },
        { index, minute },
      );
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document.querySelector(".timetable-hint") &&
          !document.querySelector("#agendaFields").disabled,
      );
    };
    const burst = await page.evaluate(
      async ({ from, to }) => {
        const root = document.querySelector(".agenda-timetable");
        const target = document.elementFromPoint(from.x, from.y);
        const pointer = (type, point) =>
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 71,
            isPrimary: true,
            button: 0,
            clientX: point.x,
            clientY: point.y,
          });
        target.dispatchEvent(pointer("pointerdown", from));
        let previews = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node.nodeType === 1 && node.matches(".timetable-preview"))
                previews++;
        });
        observer.observe(root, { childList: true, subtree: true });
        try {
          for (let i = 1; i <= 30; i++)
            document.dispatchEvent(
              pointer("pointermove", {
                x: to.x,
                y: from.y + ((to.y - from.y) * i) / 30,
              }),
            );
          const immediate = root.querySelectorAll(".timetable-preview").length;
          await new Promise(requestAnimationFrame);
          await Promise.resolve();
          return { immediate, previews };
        } finally {
          observer.disconnect();
          document.dispatchEvent(pointer("pointercancel", to));
        }
      },
      { from: await point(1, 900), to: await point(1, 960) },
    );
    assert.deepEqual(
      burst,
      { immediate: 0, previews: 1 },
      "Pointer bursts paint only their latest preview once per frame",
    );
    // Empty-grid creation is only a draft, and cancelling leaves no event behind.
    const empty = await point(1, 660);
    const gap = await page.evaluate((y) => {
      const cards = [
        ...document.querySelectorAll(".timetable-bottom-card"),
      ].map((n) => n.getBoundingClientRect());
      return { x: (cards[0].right + cards[1].left) / 2, y };
    }, empty.y);
    await page.mouse.click(gap.x, gap.y);
    assert.equal(
      await page.locator("#agendaForm").isVisible(),
      false,
      "Card gaps do not create drafts",
    );
    await page.mouse.click(empty.x, empty.y);
    assert.equal(
      await page.locator("#agendaForm").isVisible(),
      false,
      "A single click selects the date without starting a draft",
    );
    for (const [dx, dy] of [
      [3, 5],
      [1, 9],
      [18, 2],
    ]) {
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.down();
      await page.mouse.move(empty.x + dx, empty.y + dy, { steps: 3 });
      assert.equal(
        await page.locator(".timetable-preview").count(),
        0,
        "Small or sideways click jitter never starts a creation preview",
      );
      await page.mouse.up();
      assert.equal(
        await page.locator("#agendaForm").isVisible(),
        false,
        "Click jitter never leaves a new draft",
      );
    }
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x, empty.y + 14, { steps: 3 });
    await page.mouse.move(empty.x, empty.y + 2, { steps: 3 });
    await page.mouse.up();
    assert.equal(
      await page.locator("#agendaForm").isVisible(),
      false,
      "Moving back to the press point cancels accidental drag creation",
    );
    assert.equal(
      await page.locator(".timetable-preview, .timetable-draft").count(),
      0,
    );
    assert.equal(
      await page.locator("#calendar > .day.selected").getAttribute("data-date"),
      dates[1],
    );
    const another = await point(4, 660);
    await page.mouse.click(another.x, another.y);
    assert.equal(
      await page.locator("#calendar > .day.selected").getAttribute("data-date"),
      dates[4],
      "Other dates remain clickable after selecting a lower card",
    );
    const upperBlank = await page
      .locator("#calendar > .day[data-agenda-week]")
      .last()
      .evaluate((n) => {
        const r = n.getBoundingClientRect(),
          h = n.querySelector(".daytop").getBoundingClientRect();
        return { x: r.x + r.width / 2, y: h.bottom + 12 };
      });
    await page.mouse.click(upperBlank.x, upperBlank.y);
    assert.equal(
      await page
        .locator("#calendar > .day.selected")
        .getAttribute("data-preview-date"),
      dates[6],
    );
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    await drag(await point(1, 900), await point(1, 960));
    assert.equal(await page.locator("#agendaStart").inputValue(), "15:00");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "16:00");
    assert.equal(
      await page.locator(".timetable-draft").count(),
      1,
      "The new event remains visible after releasing a drag selection",
    );
    assert.equal(
      await page.locator("#agendaDraft").isVisible(),
      false,
      "Prefilled drag-selection times are not unsaved edits",
    );
    const beforePrefillSelection = dialogs.length;
    await page.mouse.click(another.x, another.y);
    assert.equal(
      dialogs.length,
      beforePrefillSelection,
      "Untouched prefills do not trigger discard confirmation",
    );
    assert.equal(
      await page.locator("#agendaForm").isVisible(),
      false,
      "An untouched prefilled form does not block date selection",
    );
    await drag(await point(1, 900), await point(1, 960));
    await page.locator("#agendaCancel").click();
    await drag(await point(1, 960), await point(1, 900));
    assert.equal(await page.locator("#agendaStart").inputValue(), "15:00");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "16:00");
    await page.locator("#agendaCancel").click();
    const origin = await event("精确分钟").boundingBox();
    const target = await point(3, 600);
    const hour = (await point(2, 600)).y - (await point(2, 540)).y;
    await drag(
      { x: origin.x + origin.width / 2, y: origin.y + 15 },
      { x: target.x, y: origin.y + 15 + hour },
    );
    await event("精确分钟").click();
    assert.equal(await page.locator("#agendaDateInput").inputValue(), dates[3]);
    assert.equal(await page.locator("#agendaStart").inputValue(), "10:07");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "11:07");
    await page.locator("#agendaCancel").click();
    const beforeGapDrop = await event("精确分钟").boundingBox();
    await drag({ x: beforeGapDrop.x + 10, y: beforeGapDrop.y + 15 }, gap);
    await event("精确分钟").click();
    assert.equal(await page.locator("#agendaDateInput").inputValue(), dates[3]);
    assert.equal(
      await page.locator("#agendaStart").inputValue(),
      "10:07",
      "Dropping into a card gap cancels the move",
    );
    await page.locator("#agendaCancel").click();
    const endHandle = await event("精确分钟")
      .locator(".timetable-resize-end")
      .boundingBox();
    await drag(
      {
        x: endHandle.x + endHandle.width / 2,
        y: endHandle.y + endHandle.height / 2,
      },
      await point(3, 690),
    );
    await event("精确分钟").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "11:30");
    await page.locator("#agendaCancel").click();
    // Escape and invalid releases do not alter persisted dates or times.
    const original = await event("精确分钟").boundingBox();
    await page.mouse.move(original.x + 10, original.y + 15);
    await page.mouse.down();
    const invalid = await point(4, 660);
    await page.mouse.move(invalid.x, invalid.y, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await event("精确分钟").click();
    assert.equal(await page.locator("#agendaStart").inputValue(), "10:07");
    await page.locator("#agendaCancel").click();
    const startHandle = await event("精确分钟")
      .locator(".timetable-resize-start")
      .boundingBox();
    await drag(
      { x: startHandle.x + startHandle.width / 2, y: startHandle.y + 2 },
      await point(3, 585),
    );
    await event("精确分钟").click();
    assert.equal(await page.locator("#agendaStart").inputValue(), "09:45");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "11:30");
    await page.locator("#agendaCancel").click();
    // Inject a quota failure in this isolated browser profile. Atomic agenda
    // persistence must leave the event at its original time after a failed drop.
    const failedOrigin = await event("精确分钟").boundingBox();
    await page.evaluate(() => {
      window.timetablePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("fixture quota", "QuotaExceededError");
      };
    });
    try {
      await drag(
        { x: failedOrigin.x + 15, y: failedOrigin.y + 15 },
        await point(4, 660),
      );
      assert.ok((await page.locator("#agendaError").textContent()).length > 0);
    } finally {
      await page.evaluate(() => {
        IDBObjectStore.prototype.put = window.timetablePut;
      });
    }
    await event("精确分钟").click();
    assert.equal(await page.locator("#agendaDateInput").inputValue(), dates[3]);
    assert.equal(await page.locator("#agendaStart").inputValue(), "09:45");
    await page.locator("#agendaCancel").click();
    const allOrigin = await event("全天跨度").boundingBox();
    const upper = await page
      .locator("#calendar > .day[data-agenda-week]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().toJSON()),
      );
    const allGrid = { x: upper[0].x, width: upper[6].right - upper[0].x };
    const dayShift = upper[1].x - upper[0].x;
    await drag(
      { x: allOrigin.x + 12, y: allOrigin.y + 10 },
      { x: allOrigin.x + 12 + dayShift, y: allOrigin.y + 10 },
    );
    await event("全天跨度").click();
    assert.equal(await page.locator("#agendaDateInput").inputValue(), dates[1]);
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      dates[4],
    );
    await page.locator("#agendaCancel").click();
    const dateHandle = await event("全天跨度")
      .locator(".agenda-resize-handle")
      .boundingBox();
    await drag(
      { x: dateHandle.x + 3, y: dateHandle.y + 10 },
      { x: allGrid.x + (allGrid.width * 5.5) / 7, y: allOrigin.y + 10 },
    );
    await event("全天跨度").click();
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      dates[5],
    );
    await page.locator("#agendaCancel").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      window.axisFrames = [];
      window.axisSettles = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (
          this.matches(
            ".timetable-rule, .timetable-offhours, .timetable-event, .timetable-axis-exit",
          )
        )
          window.axisFrames.push({
            kind: this.className,
            date: this.closest(".timetable-column")?.dataset.timetableDate,
            frames,
            options,
          });
        const animation = original.call(this, frames, options);
        if (
          this.matches(
            ".timetable-rule, .timetable-offhours, .timetable-event, .timetable-axis-exit",
          )
        ) {
          animation.finished.then(
            () => {
              if (!this.isConnected) return;
              const before = this.getBoundingClientRect();
              const opacity = getComputedStyle(this).opacity;
              queueMicrotask(() => {
                if (!this.isConnected) return;
                const after = this.getBoundingClientRect();
                const delta = [
                  after.top - before.top,
                  after.height - before.height,
                  after.left - before.left,
                  after.width - before.width,
                ];
                if (
                  delta.some((value) => Math.abs(value) > 0.05) ||
                  getComputedStyle(this).opacity !== opacity
                )
                  window.axisSettles.push({
                    kind: this.className,
                    delta,
                    opacity,
                    afterOpacity: getComputedStyle(this).opacity,
                  });
              });
            },
            () => {},
          );
        }
        return animation;
      };
    });
    await page.locator("#agendaNew").click();
    await page.locator("#agendaScheduleOpen").click();
    await setScheduleRange(page, date, date);
    await page.locator("#agendaAllDay").uncheck();
    await page.evaluate(() => {
      window.axisTrace = [];
      window.traceAxis = true;
      const sample = () => {
        const lines = [
          ...document.querySelectorAll('.timetable-rule[data-minute="810"]'),
        ];
        if (lines.length)
          window.axisTrace.push({
            tops: lines.map((line) => line.getBoundingClientRect().top),
            scrolls: [...document.querySelectorAll(".timetable-scroll")].map(
              (node) => node.scrollTop,
            ),
          });
        if (window.traceAxis) requestAnimationFrame(sample);
      };
      sample();
    });
    await page.locator("#agendaStart").fill("10:15");
    await page.locator("#agendaEnd").fill("15:00");
    await page.evaluate(() => {
      window.axisNodes = [
        ...document.querySelectorAll(".timetable-rule, .timetable-offhours"),
      ];
      window.axisTrackCount = window.axisFrames.length;
    });
    await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaTitle").fill("跨午休草稿");
    await page.locator("#agendaNote").fill("动画中修改文字");
    assert.ok(
      await page.evaluate(() =>
        window.axisNodes.every((node) => node.isConnected),
      ),
      "Text-only draft renders retain the painted grid and shading nodes",
    );
    assert.equal(
      await page.evaluate(() => window.axisFrames.length),
      await page.evaluate(() => window.axisTrackCount),
      "Text changes never cancel or restart active time-axis tracks",
    );
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
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const trace = await page.evaluate(() => {
      window.traceAxis = false;
      return window.axisTrace;
    });
    const direction = Math.sign(trace.at(-1).tops[0] - trace[0].tops[0]);
    assert.ok(
      trace.every(
        (sample, index) =>
          !index ||
          direction * (sample.tops[0] - trace[index - 1].tops[0]) >= -0.02,
      ),
      "The visible lunch boundary never reverses, including after text updates and animation cleanup",
    );
    assert.ok(
      trace.every(
        (sample) => Math.max(...sample.tops) - Math.min(...sample.tops) < 0.02,
      ),
      "All seven date columns stay aligned on every animation frame",
    );
    assert.ok(
      trace.every((sample) =>
        sample.scrolls.every(
          (scroll, index) => scroll === trace[0].scrolls[index],
        ),
      ),
      "Animation never changes the columns' scroll offsets",
    );
    assert.equal(await page.locator(".timetable-draft").count(), 1);
    await page.locator("#agendaCancel").click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".agenda-timetable")
          .getAnimations({ subtree: true })
          .some((a) => a.pending || a.playState === "running"),
    );
    assert.equal(await page.locator(".timetable-draft").count(), 0);
    assert.equal(
      await page.locator(".timetable-break").count(),
      7,
      "Cancelling an unsaved lunch-spanning draft restores all seven compressed breaks",
    );
    await page.evaluate(() => {
      window.axisFrames = [];
    });
    await create("午间", "12:30", "13:00");
    const axisFrames = await page.evaluate(() => window.axisFrames);
    assert.ok(
      axisFrames.some(
        (a) =>
          a.kind.includes("timetable-rule") &&
          a.frames[0].top !== a.frames[1].top,
      ),
      "Time rules smoothly change their positions when lunch expands",
    );
    const shadeFrames = axisFrames.filter(
      (a) =>
        a.kind.includes("timetable-offhours") &&
        a.frames[0].height !== a.frames[1].height,
    );
    assert.equal(
      new Set(shadeFrames.map((a) => a.date)).size,
      7,
      "Rest shading smoothly changes height in all seven aligned date cards",
    );
    assert.equal(
      shadeFrames.length,
      7,
      "Saving a new lunch event does not temporarily remove the draft and reverse/restart the time axis",
    );
    assert.ok(
      axisFrames.some(
        (a) =>
          a.kind.includes("timetable-event") &&
          a.frames[0].top !== a.frames[1].top,
      ),
      "Existing event positions follow the same animated time mapping",
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".agenda-timetable")
          .getAnimations({ subtree: true })
          .some((a) => a.pending || a.playState === "running"),
    );
    assert.equal(await page.locator(".timetable-axis-exit").count(), 0);
    assert.deepEqual(
      await page.evaluate(() => window.axisSettles),
      [],
      "Releasing animation effects never changes timeline geometry or revives faded rest stripes",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".timetable-break").count(), 0);
    await create("跨午夜", "23:00", "01:00", dates[4], dates[5]);
    assert.equal(await event("跨午夜").count(), 2);
    assert.equal(
      await event("跨午夜").locator(".timetable-resize-start").count(),
      1,
    );
    assert.equal(
      await event("跨午夜").locator(".timetable-resize-end").count(),
      1,
    );
    await page.screenshot({
      path: path.join(__dirname, "../artifacts/timetable.png"),
    });
    await event("跨午夜").last().click();
    await page.locator("#agendaCancel").click();
    const crossId = await event("跨午夜")
      .first()
      .getAttribute("data-agenda-edit");
    await page.locator(`[data-agenda-delete="${crossId}"]`).click();
    await page.waitForFunction(
      (id) =>
        !document.querySelector(`.agenda-timetable [data-agenda-edit="${id}"]`),
      crossId,
    );
    assert.equal(await event("跨午夜").count(), 0);
    assert.equal(
      await page
        .locator(
          '.timetable-grid:first-child .timetable-rule[data-minute="1050"]',
        )
        .count(),
      7,
    );
    assert.equal(
      await page.locator('.timetable-rule[data-minute="1440"]').count(),
      0,
      "Removing the late event restores the work-time axis",
    );
    await page.locator("#agendaViewToggle").click();
    assert.equal(await page.locator(".agenda-timetable").count(), 0);
    assert.equal(
      await page.locator("#calendar").getAttribute("data-agenda-rows"),
      "2",
    );
    assert.equal(await page.locator("#agendaTimetableToggle").count(), 0);
    assert.equal(await page.locator(".agenda-week-lane").count(), 2);
    await page.locator("#agendaViewToggle").click();
    assert.equal(await page.locator(".agenda-week-lane").count(), 3);
    await page.locator("#agendaViewToggle").click();
    assert.equal(await page.locator(".agenda-timetable").count(), 0);
    await page.locator("#agendaViewToggle").click();
    for (let i = 0; i < 9; i++) await create("密集全天 " + i);
    assert.ok(
      await page.evaluate(() => {
        const calendar = document.querySelector("#calendar");
        const upper = [
          ...calendar.querySelectorAll(":scope > .day[data-agenda-week]"),
        ].map((n) => n.getBoundingClientRect());
        const lane = calendar.querySelector(".agenda-week-lane");
        return (
          upper.every((r) => Math.abs(r.height - upper[0].height) < 1) &&
          upper[0].height === 160 &&
          lane.querySelectorAll(".agenda-chip:not([hidden])").length === 3
        );
      }),
      "Dense all-day cards retain a fixed 160px height and display at most three rows",
    );
    const more = page.locator(`.agenda-more[data-agenda-date="${date}"]`);
    assert.equal(await more.textContent(), "7+");
    await more.click();
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    assert.ok(
      (await page.locator("#agendaList [data-agenda-edit]").count()) >= 10,
      "Overflow opens the complete selected-date list",
    );
    await page.setViewportSize({ width: 850, height: 650 });
    await page.locator(".timetable-grid").first().waitFor();
    await page.waitForFunction(() => {
      const grid = document.querySelector(".timetable-grid");
      const scroll = document.querySelector(".timetable-scroll");
      return grid.clientHeight === 360 && scroll.clientHeight < 360;
    });
    assert.ok(
      await page
        .locator(".timetable-grid")
        .first()
        .evaluate((n) => n.clientHeight >= 360),
    );
    const upperTop = await page
      .locator("#calendar > .day[data-agenda-week]")
      .first()
      .evaluate((n) => n.getBoundingClientRect().top);
    await page
      .locator(".timetable-scroll")
      .nth(2)
      .evaluate((n) => {
        n.scrollTop = 35;
      });
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".timetable-scroll")].every(
        (n) => n.scrollTop === 35,
      ),
    );
    assert.equal(
      await page
        .locator("#calendar > .day[data-agenda-week]")
        .first()
        .evaluate((n) => n.getBoundingClientRect().top),
      upperTop,
      "Time scrolling leaves upper cards fixed",
    );
    await page.screenshot({
      path: path.join(__dirname, "../artifacts/timetable-small.png"),
      fullPage: true,
    });
    const workdaySwitch = page.locator("#agendaWorkdaysOnly");
    await create("周六独立全天", "", "", dates[5]);
    await create("周日独立定时", "09:00", "10:00", dates[6]);
    await workdaySwitch.click();
    assert.equal(await workdaySwitch.getAttribute("aria-checked"), "true");
    assert.equal(await page.locator(".timetable-bottom-card").count(), 5);
    assert.equal(
      await page
        .locator(`#calendar > .day[data-agenda-week][data-date="${dates[5]}"]`)
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".agenda-week-lane .agenda-chip-title-text")
        .filter({ hasText: "周六独立全天" })
        .count(),
      0,
      "Saturday-only ribbons are omitted rather than shifted onto Sunday",
    );
    assert.equal(
      await page
        .locator(".timetable-event .agenda-chip-title-text")
        .filter({ hasText: "周日独立定时" })
        .count(),
      0,
    );
    assert.ok(
      await page.evaluate(() => {
        const cards = [
          ...document.querySelectorAll("#calendar > .day[data-agenda-week]"),
        ];
        const bottom = [...document.querySelectorAll(".timetable-bottom-card")];
        return (
          cards.length === 5 &&
          cards.every((card, index) => {
            const a = card.getBoundingClientRect(),
              b = bottom[index].getBoundingClientRect();
            return (
              Math.abs(a.left - b.left) < 1 &&
              Math.abs(a.width - b.width) < 1 &&
              Math.abs(a.width - cards[0].getBoundingClientRect().width) < 1
            );
          })
        );
      }),
      "Five weekday columns and both card rows fill the available width and remain aligned",
    );
    await page.locator("#nextMonth").click();
    assert.equal(await page.locator(".timetable-bottom-card").count(), 5);
    await page.locator("#prevMonth").click();
    const fridayGrid = await page
      .locator(".timetable-column")
      .last()
      .boundingBox();
    await drag(
      { x: fridayGrid.x + fridayGrid.width - 10, y: fridayGrid.y + 45 },
      { x: fridayGrid.x + fridayGrid.width - 10, y: fridayGrid.y + 90 },
    );
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      dates[4],
      "Five-column drag creation hits the actual Friday card",
    );
    await page.locator("#agendaCancel").click();
    await page.screenshot({
      path: path.join(__dirname, "../artifacts/timetable-weekdays-only.png"),
      fullPage: true,
    });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator(".timetable-bottom-card").first().waitFor();
    assert.equal(
      await page.locator(".timetable-bottom-card").count(),
      5,
      "Working-day filter survives reload",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("#agendaViewToggle").click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#calendar")
          .getAnimations({ subtree: true })
          .some((a) => a.pending || a.playState === "running"),
    );
    assert.equal(
      await page.locator("#calendar > .day[data-agenda-week]").count(),
      10,
      "Two-week view retains the working-day filter",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator("#agendaWorkdaysOnly:visible").count(), 1);
    await page.locator("#agendaViewToggle").click();
    await page.locator("#agendaViewToggle").click();
    await page.locator("#agendaViewToggle").click();
    assert.equal(await page.locator(".timetable-bottom-card").count(), 5);
    await workdaySwitch.focus();
    await page.keyboard.press("Space");
    assert.equal(await page.locator(".timetable-bottom-card").count(), 7);
    assert.equal(
      await page
        .locator(".timetable-event .agenda-chip-title-text")
        .filter({ hasText: "周日独立定时" })
        .count(),
      1,
      "Restoring Sunday restores its saved events",
    );
    const fixture = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      state.agenda = [
        {
          id: "work-filter-ribbon",
          title: "跨日期文字位置与箭头",
          date: "2026-10-26",
          endDate: "2026-10-30",
          allDay: true,
          start: "",
          end: "",
          note: "",
          status: "pending",
          createdAt: "2026-10-26T00:00:00Z",
          updatedAt: "2026-10-26T00:00:00Z",
        },
        {
          id: "work-filter-timed",
          title: "定时位置",
          date: "2026-10-28",
          endDate: "2026-10-28",
          allDay: false,
          start: "08:15",
          end: "09:15",
          note: "111",
          status: "pending",
          createdAt: "2026-10-26T00:00:00Z",
          updatedAt: "2026-10-26T00:00:00Z",
        },
      ];
      state.days = {
        "2026-10-26": { kind: "rest" },
        "2026-10-28": { kind: "rest", plannedOvertime: true },
        "2026-10-29": {
          kind: "rest",
          actual: { start: "08:00", end: "09:00", nextDay: false },
        },
        "2026-10-30": {
          kind: "rest",
          oa: {
            date: "2026-10-30",
            start: "08:00",
            end: "",
            status: "pending",
            nextDay: false,
            source: "test",
            raw: "",
          },
        },
        "2026-10-31": { kind: "work" },
        "2026-11-01": {
          kind: "rest",
          estimate: { start: "08:00", end: "09:00", nextDay: false },
        },
        "2026-11-07": { plannedOvertime: true },
        "2026-11-09": { kind: "rest" },
      };
      return state;
    });
    for (const empty of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 1480, height: 1000 },
        locale: "zh-CN",
      });
      await context.route(/^https?:/, (route) => route.abort());
      await context.addInitScript(
        ({ fixture, empty, dates }) => {
          if (empty)
            fixture.days = Object.fromEntries(
              dates.map((date) => [date, { kind: "rest" }]),
            );
          localStorage.setItem("worktime-local-v1", JSON.stringify(fixture));
          localStorage.setItem(
            "worktime.calendarView",
            JSON.stringify({ mode: "agenda", weeks: 1, workdaysOnly: true }),
          );
        },
        { fixture, empty, dates },
      );
      const view = await context.newPage();
      view.on("pageerror", (error) => errors.push(error.message));
      await view.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
      await view.goto(pathToFileURL(path.join(root, "index.html")).href);
      await view.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const filter = view.locator("#agendaWorkdaysOnly");
      assert.equal(await filter.count(), 1);
      assert.equal(await view.locator(".agenda-weekend-switch").count(), 0);
      assert.equal(await filter.textContent(), "");
      assert.ok(
        await filter.evaluate((node) => {
          const a = node.getBoundingClientRect(),
            b = node.parentElement.getBoundingClientRect();
          return (
            Math.abs(
              a.top +
                a.height / 2 -
                (b.top +
                  parseFloat(getComputedStyle(node.parentElement).paddingTop) +
                  11),
            ) < 2 &&
            node.querySelector("use").getAttribute("href") ===
              "#ms-right-panel-close"
          );
        }),
        "The Right Panel Close icon stays on the weekday row, without visible text",
      );
      if (empty) {
        assert.equal(await view.locator(".timetable-bottom-card").count(), 0);
        assert.equal(
          await view.locator(".timetable-empty").textContent(),
          "本周没有工作日",
        );
        await filter.click();
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        assert.equal(await view.locator(".timetable-bottom-card").count(), 7);
      } else {
        assert.deepEqual(
          await view
            .locator(".timetable-bottom-card")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.dataset.timetableDate),
            ),
          [dates[1], dates[2], dates[3], dates[5], dates[6]],
          "Manual rest and incomplete records hide; planned, recorded, estimated overtime and makeup working dates remain",
        );
        await filter.click();
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        await view.evaluate(() => {
          window.columnPaint = {};
          for (const id of ["work-filter-ribbon", "work-filter-timed"]) {
            const node = document.querySelector(`[data-agenda-edit="${id}"]`);
            window.columnPaint[id] = {
              rect: node.getBoundingClientRect().toJSON(),
              title: node
                .querySelector(".agenda-chip-title-text")
                .getBoundingClientRect()
                .toJSON(),
            };
          }
        });
        await filter.click();
        const firstFrame = await view.evaluate(() => {
          const animations = document
            .querySelector("#calendar")
            .getAnimations({ subtree: true });
          for (const animation of animations) {
            animation.pause();
            animation.currentTime = 0;
          }
          const differences = Object.entries(window.columnPaint).map(
            ([id, old]) => {
              const node = document.querySelector(`[data-agenda-edit="${id}"]`),
                rect = node.getBoundingClientRect(),
                title = node
                  .querySelector(".agenda-chip-title-text")
                  .getBoundingClientRect();
              return {
                id,
                top: rect.top - old.rect.top,
                left: rect.left - old.rect.left,
                textX: title.left - old.title.left,
                textY: title.top - old.title.top,
              };
            },
          );
          for (const animation of animations) animation.play();
          return differences;
        });
        assert.ok(
          firstFrame.every((frame) =>
            [frame.top, frame.left, frame.textX, frame.textY].every(
              (value) => Math.abs(value) < 0.1,
            ),
          ),
          JSON.stringify(firstFrame),
        );
        assert.equal(await view.locator(".agenda-weekend-exit").count(), 2);
        assert.equal(
          await view.locator(".agenda-weekday-exit").count(),
          2,
          "Weekday labels leave with their corresponding date columns",
        );
        assert.ok(
          await view
            .locator(".agenda-weekday-exit")
            .evaluateAll((nodes) =>
              nodes.every((node) =>
                node
                  .getAnimations()
                  .some(
                    (a) =>
                      a.effect.getKeyframes()[0].opacity === "1" &&
                      a.effect.getKeyframes().at(-1).opacity === "0",
                  ),
              ),
            ),
        );
        assert.equal(
          await view
            .locator(".agenda-week-lane .agenda-chip-continuation")
            .evaluateAll(
              (nodes) =>
                nodes.filter((node) =>
                  node
                    .getAnimations()
                    .some((a) => a.effect.getKeyframes()[0].opacity === "0"),
                ).length,
            ),
          2,
          "New continuation arrows fade in rather than appearing abruptly",
        );
        assert.ok(
          await view.locator(".agenda-weekend-exit").evaluateAll((nodes) =>
            nodes.every((node) =>
              node.getAnimations().some((animation) => {
                const frames = animation.effect.getKeyframes();
                return (
                  frames[0].opacity === "1" &&
                  frames.at(-1).opacity === "0" &&
                  new DOMMatrix(frames.at(-1).transform).m41 > 0 &&
                  new DOMMatrix(frames.at(-1).transform).m11 > 1 &&
                  animation.effect.getTiming().duration === 360
                );
              }),
            ),
          ),
          "Hidden non-working columns move right while fading",
        );
        const borderMotion = await view.evaluate(
          () =>
            new Promise((resolve) => {
              let frames = 0,
                maxError = 0,
                missing = 0;
              let worst = null;
              const sample = () => {
                frames++;
                for (const source of document.querySelectorAll(
                  "#calendar > .day[data-agenda-week], .agenda-timetable:not(.agenda-weekend-exit) > .timetable-bottom-card",
                )) {
                  const date =
                    source.dataset.date ||
                    source.dataset.previewDate ||
                    source.dataset.timetableDate;
                  const kind = source.classList.contains("day")
                    ? "day"
                    : "timed";
                  const edge = document.querySelector(
                    `.agenda-date-edge[data-edge-date="${date}"][data-kind="${kind}"][data-ghost="false"]`,
                  );
                  if (!edge) {
                    missing++;
                    continue;
                  }
                  const a = source.getBoundingClientRect(),
                    b = edge.getBoundingClientRect();
                  const error = Math.max(
                    ...["left", "top", "width", "height"].map((key) =>
                      Math.abs(a[key] - b[key]),
                    ),
                  );
                  if (error > maxError) {
                    maxError = error;
                    worst = {
                      date,
                      kind,
                      frame: frames,
                      source: a.toJSON(),
                      edge: b.toJSON(),
                    };
                  }
                }
              };
              // Sample after the stroke writer, rather than racing it with a
              // separate requestAnimationFrame callback in the same frame.
              const observer = new MutationObserver(sample);
              observer.observe(document.querySelector(".agenda-date-edges"), {
                subtree: true,
                childList: true,
                attributes: true,
              });
              const finish = () => {
                if (
                  document
                    .querySelector("#calendar")
                    .getAnimations({ subtree: true })
                    .some((a) => a.pending || a.playState === "running")
                )
                  requestAnimationFrame(finish);
                else {
                  observer.disconnect();
                  resolve({ frames, maxError, missing, worst });
                }
              };
              requestAnimationFrame(finish);
            }),
        );
        assert.ok(
          borderMotion.frames > 1 &&
            borderMotion.missing === 0 &&
            borderMotion.maxError < 0.1,
          "Date strokes follow the actual animated card bounds: " +
            JSON.stringify(borderMotion),
        );
        assert.ok(
          await view.evaluate(() => {
            const layer = document.querySelector(".agenda-date-edges"),
              lanes = document.querySelector(".agenda-week-layers");
            return (
              getComputedStyle(layer).pointerEvents === "none" &&
              Number(getComputedStyle(layer).zIndex) >
                Number(getComputedStyle(lanes).zIndex) &&
              [...layer.children].every(
                (edge) =>
                  getComputedStyle(edge).pointerEvents === "none" &&
                  getComputedStyle(edge).backgroundColor === "rgba(0, 0, 0, 0)",
              )
            );
          }),
          "Only transparent, non-interactive strokes are painted above agenda ribbons",
        );
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        assert.equal(await view.locator(".agenda-weekend-exit").count(), 0);
        assert.ok(
          await view.evaluate(() =>
            ["work-filter-ribbon", "work-filter-timed"].every(
              (id) =>
                Math.abs(
                  document
                    .querySelector(`[data-agenda-edit="${id}"]`)
                    .getBoundingClientRect().top -
                    window.columnPaint[id].rect.top,
                ) < 0.1,
            ),
          ),
          "Toggling the filter never shifts the agenda cards vertically",
        );
        await view.waitForFunction(
          () =>
            new DOMMatrix(
              getComputedStyle(
                document.querySelector("#agendaWorkdaysOnly .ui-icon"),
              ).transform,
            ).a < -0.99,
        );
        await filter.click();
        assert.equal(
          await view.locator(".agenda-arrow-exit").count(),
          2,
          "Removed arrows also fade out",
        );
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        await view.waitForFunction(
          () =>
            new DOMMatrix(
              getComputedStyle(
                document.querySelector("#agendaWorkdaysOnly .ui-icon"),
              ).transform,
            ).a > 0.99,
        );
        await filter.click();
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        await view.evaluate(() => {
          window.returnFrames = [];
          const animate = Element.prototype.animate;
          Element.prototype.animate = function (frames, options) {
            if (this.matches(".day") && this.dataset.date)
              window.returnFrames.push({ date: this.dataset.date, frames });
            return animate.call(this, frames, options);
          };
        });
        await view.locator("#agendaMode").click();
        const returning = await view.evaluate(() =>
          window.returnFrames.filter(
            (track) =>
              track.frames[0].transform &&
              ["2026-10-26", "2026-10-30"].includes(track.date),
          ),
        );
        assert.equal(returning.length, 2);
        assert.ok(
          returning.every(
            ({ frames }) =>
              frames.length === 4 &&
              frames[1].offset === 0.6 &&
              frames[2].offset === 0.74 &&
              frames[0].height === frames[1].height &&
              frames[1].height !== frames[2].height &&
              parseFloat(frames[0].transform.slice("translate(".length)) >
                parseFloat(frames[1].transform.slice("translate(".length)),
          ),
          "Restored non-working columns almost finish sliding in before the longer attendance morph begins",
        );
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        assert.equal(
          await view.locator(".agenda-date-edges").count(),
          0,
          "Temporary stroke overlay is removed after returning to attendance",
        );
        await view.locator("#agendaMode").click();
        await view.waitForFunction(
          () =>
            !document
              .querySelector("#calendar")
              .getAnimations({ subtree: true })
              .some((a) => a.pending || a.playState === "running"),
        );
        assert.equal(await view.locator(".timetable-bottom-card").count(), 5);
        const settleView = () =>
          view.waitForFunction(
            () =>
              !document
                .querySelector("#calendar")
                .getAnimations({ subtree: true })
                .some((a) => a.pending || a.playState === "running"),
          );
        for (const expected of [
          [5, 6],
          [5, 6, 4],
        ]) {
          await view.locator("#agendaViewToggle").click();
          await settleView();
          assert.equal(await filter.isVisible(), true);
          assert.equal(await filter.getAttribute("aria-checked"), "true");
          const grouped = await view
            .locator("#calendar > .day[data-agenda-week]")
            .evaluateAll((nodes) => {
              const rows = new Map();
              for (const node of nodes) {
                if (!rows.has(node.dataset.agendaRow))
                  rows.set(node.dataset.agendaRow, []);
                rows
                  .get(node.dataset.agendaRow)
                  .push(node.getBoundingClientRect().toJSON());
              }
              return [...rows.values()];
            });
          assert.deepEqual(
            grouped.map((row) => row.length),
            expected,
            "Each week filters its own rest days and retains overtime dates",
          );
          const columnGap = await view
            .locator("#calendar")
            .evaluate((node) => parseFloat(getComputedStyle(node).columnGap));
          assert.ok(
            grouped.every((row) =>
              row.every(
                (rect, index) =>
                  Math.abs(rect.top - row[0].top) < 0.1 &&
                  Math.abs(rect.width - row[0].width) < 0.1 &&
                  (!index ||
                    Math.abs(rect.left - row[index - 1].right - columnGap) <
                      0.1),
              ),
            ),
            "Filtered rows stay compact with equal-width cards and normal gutters: " +
              JSON.stringify(grouped),
          );
          assert.equal(
            await view.locator(".agenda-week-lane").count(),
            expected.length,
          );
          if (expected.length === 3)
            await view.screenshot({
              path: path.join(
                __dirname,
                "../artifacts/agenda-filtered-three-weeks.png",
              ),
              fullPage: true,
            });
          if (expected.length === 2) {
            const ribbon = view
              .locator(
                '.agenda-packed-row [data-agenda-edit="work-filter-ribbon"]:not([hidden])',
              )
              .first();
            const source = await ribbon.boundingBox();
            const origin = await view
              .locator('#calendar > .day[data-date="2026-10-27"]')
              .boundingBox();
            const target = await view
              .locator('#calendar > .day[data-date="2026-10-28"]')
              .boundingBox();
            await view.mouse.move(origin.x + origin.width / 2, source.y + 8);
            await view.mouse.down();
            await view.mouse.move(target.x + target.width / 2, source.y + 8, {
              steps: 8,
            });
            await view.mouse.up();
            await view.waitForFunction(
              () =>
                document.querySelector("#agendaDateInput").value ===
                  "2026-10-27" &&
                !document.querySelector(".agenda-drag-preview"),
            );
            assert.equal(
              await view.locator("#agendaEndDateInput").inputValue(),
              "2026-10-31",
              "Filtered multiweek dragging moves by actual calendar date rather than visible column number",
            );
            await view.locator("#agendaScheduleOpen").click();
            await setScheduleRange(view, "2026-10-26", "2026-10-30");
            await view.locator("[data-schedule-close]").click();
            await view.locator("#agendaSave").click();
            await view.locator("#agendaForm").waitFor({ state: "hidden" });
            await settleView();
          }
        }
        await filter.click();
        await settleView();
        assert.equal(
          await view.locator("#calendar > .day[data-agenda-week]").count(),
          21,
        );
        await filter.click();
        await settleView();
        assert.equal(
          await view.locator("#calendar > .day[data-agenda-week]").count(),
          15,
        );
        await view.evaluate(() => {
          window.returnFrames = [];
        });
        await view.locator("#agendaViewToggle").click();
        assert.equal(
          await filter.isVisible(),
          false,
          "Month view hides the filter switch",
        );
        const restored = await view.evaluate(() =>
          window.returnFrames.filter((track) => track.frames.length === 4),
        );
        assert.ok(
          restored.some((track) => track.date === "2026-10-26"),
          "Hidden dates return through the staged restoration animation before the month layout settles",
        );
        await settleView();
        assert.equal(
          await view
            .locator('#calendar > .day[data-date="2026-10-26"]')
            .isVisible(),
          true,
        );
        assert.equal(await view.locator(".agenda-week-lane").count(), 5);
        await view.locator("#agendaViewToggle").click();
        await settleView();
        assert.equal(await view.locator(".timetable-bottom-card").count(), 5);
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Offline timetable, dual cards, hidden coordinates, overlaps, point/short/cross-day events, creation, minute-preserving move, resize, cancellation and other views verified: " +
        root,
    );
  } finally {
    await browser.close();
  }
}
verifyMath();
verifyBrowser().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
