"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || ".");
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      timezoneId: "America/New_York",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    const ready = () =>
      page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
    const openSchedule = async () => {
      if (
        !(await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open")))
      )
        await page.locator("#agendaScheduleOpen").click();
    };
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await ready();
    await page.locator("#agendaMode").click();
    async function clipboard() {
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.dragBackup = text;
            },
            readText: async () => window.dragBackup,
          },
        }),
      );
    }
    await clipboard();
    async function snapshot() {
      await page.evaluate(() => {
        window.dragBackup = null;
      });
      await page.locator("#backup").click();
      await page.waitForFunction(() => !!window.dragBackup);
      return page.evaluate(async () => {
        const doc = await WorkTimeApp.services.backup.decode(
          window.dragBackup,
          (value) => value,
        );
        return WorkTimeApp.services.archive.decode(doc.work).agenda;
      });
    }
    async function create(
      title,
      date,
      endDate = "",
      start = "",
      end = "",
      note = "",
    ) {
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      if (await page.locator("#agendaBack").isVisible())
        await page.locator("#agendaBack").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaItemStatus").selectOption("in-progress");
      await openSchedule();
      await setScheduleRange(page, date);
      if (endDate) {
        await openSchedule();
        await page.locator("#agendaEndDateInput").fill(endDate);
      }
      if (start) {
        await openSchedule();
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill(start);
        await page.locator("#agendaEnd").fill(end);
      }
      await page.locator("#agendaNote").fill(note);
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#agendaTitle").value === "" &&
          !document.querySelector("#agendaFields").disabled,
      );
    }
    const dateCard = (date) =>
      page
        .locator(
          `#calendar > .day[data-date="${date}"],#calendar > .day[data-preview-date="${date}"]`,
        )
        .filter({ visible: true });
    const chip = (title) =>
      page.locator("#calendar .agenda-chip:visible").filter({ hasText: title });
    let lastDrag = null;
    async function begin(title, anchor, segment = 0) {
      const source = chip(title).nth(segment);
      await source.waitFor({ state: "visible" });
      await source.scrollIntoViewIfNeeded();
      const rect = await source.boundingBox();
      const card = await dateCard(anchor).boundingBox();
      const x = Math.max(
        rect.x + 3,
        Math.min(card.x + card.width / 2, rect.x + rect.width - 3),
      );
      const y = rect.y + 7;
      lastDrag = {
        y,
        timed: await source.evaluate((node) =>
          node.classList.contains("timetable-event"),
        ),
      };
      await page.mouse.move(x, y);
      await page.mouse.down();
      return { x, y };
    }
    async function hover(date) {
      const rect = await dateCard(date).boundingBox();
      const single =
        (await page
          .locator("#agendaViewToggle")
          .getAttribute("data-agenda-view")) === "1";
      const header = single
        ? await dateCard(date).locator(".daytop").boundingBox()
        : null;
      const y = single
        ? lastDrag?.timed
          ? lastDrag.y
          : header.y + header.height + 10
        : rect.y + 15;
      await page.mouse.move(rect.x + rect.width / 2, y, {
        steps: 12,
      });
    }
    async function drag(title, anchor, target, segment = 0) {
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.pending || animation.playState === "running",
            ),
      );
      await rememberUnrelated(title);
      await begin(title, anchor, segment);
      await hover(target);
      const single =
        (await page
          .locator("#agendaViewToggle")
          .getAttribute("data-agenda-view")) === "1";
      assert.equal(
        await page
          .locator(single ? ".timetable-preview" : ".agenda-drag-preview")
          .count(),
        1,
      );
      if (!single)
        assert.equal(await page.locator(".agenda-drop-target").count(), 1);
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document.querySelector(".agenda-drag-preview, .timetable-preview") &&
          !document.querySelector("#agendaFields").disabled,
      );
      await verifyUnrelated();
    }
    async function rememberUnrelated(title) {
      await page.evaluate((movingTitle) => {
        window.stableAgendaNodes = [
          ...document.querySelectorAll("#calendar .agenda-chip"),
        ].filter(
          (node) =>
            node.querySelector(".agenda-chip-title-text").textContent !==
            movingTitle,
        );
        window.stableAgendaRows = [
          ...document.querySelectorAll(".agenda-week-lane"),
        ];
        window.agendaRowReveals = 0;
        window.originalAgendaMotion = WorkTimeApp.ui.motion.play;
        WorkTimeApp.ui.motion.play = function (element, ...args) {
          if (element?.matches(".agenda-lane-content, .agenda-card-items"))
            window.agendaRowReveals++;
          return window.originalAgendaMotion(element, ...args);
        };
      }, title);
    }
    async function verifyUnrelated() {
      const stable = await page.evaluate(() => {
        WorkTimeApp.ui.motion.play = window.originalAgendaMotion;
        return {
          nodes: window.stableAgendaNodes.every((node) => node.isConnected),
          rows: window.stableAgendaRows.every((node) => node.isConnected),
          reveals: window.agendaRowReveals,
        };
      });
      assert.ok(
        stable.nodes,
        "Moving an agenda must retain unrelated chip nodes, including at the destination",
      );
      assert.ok(
        stable.rows,
        "Moving an agenda must retain the existing week scrollers",
      );
      assert.equal(
        stable.reveals,
        0,
        "Moving one agenda must not replay a whole row entrance",
      );
    }
    const domain = await page.evaluate(() => {
      const A = WorkTimeApp.domain.agenda;
      const base = {
        id: "domain",
        title: "test",
        date: "2028-02-28",
        endDate: "2028-03-01",
        start: "22:00",
        end: "00:00",
        allDay: false,
        completed: false,
        status: "in-progress",
        note: "notes",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const moved = A.move(base, 2);
      const invalid = [];
      for (const [date, days] of [
        ["1900-01-01", -1],
        ["9999-12-31", 1],
        ["2028-02-28", 0.5],
      ]) {
        try {
          A.move({ ...base, date, endDate: date }, days);
          invalid.push(false);
        } catch {
          invalid.push(true);
        }
      }
      return {
        moved,
        base,
        invalid,
        year: A.move({ ...base, date: "2026-12-31", endDate: "2027-01-03" }, 1),
        dst: A.move({ ...base, date: "2026-03-07", endDate: "2026-03-09" }, 2),
      };
    });
    assert.equal(domain.moved.date, "2028-03-01");
    assert.equal(domain.moved.endDate, "2028-03-03");
    for (const key of [
      "start",
      "end",
      "note",
      "completed",
      "status",
      "createdAt",
      "updatedAt",
    ])
      assert.deepEqual(domain.moved[key], domain.base[key]);
    assert.deepEqual(domain.invalid, [true, true, true]);
    assert.equal(domain.dst.endDate, "2026-03-11");
    assert.equal(domain.year.date, "2027-01-01");
    assert.equal(domain.year.endDate, "2027-01-04");
    await create("目标已有日程", "2026-10-22");
    await create("拖动单日", "2026-10-20", "", "09:00", "10:00", "拖动备注");
    const before = (await snapshot()).find((item) => item.title === "拖动单日");
    const origin = await begin("拖动单日", "2026-10-20");
    await page.mouse.move(origin.x + 3, origin.y);
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await page.mouse.up();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "拖动单日");
    await drag("拖动单日", "2026-10-20", "2026-10-22");
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-22",
    );
    assert.equal(await page.locator("#agendaStart").inputValue(), "09:00");
    const moved = (await snapshot()).find((item) => item.id === before.id);
    assert.equal(moved.date, "2026-10-22");
    assert.equal(moved.note, before.note);
    assert.equal(moved.status, "in-progress");
    await begin("拖动单日", "2026-10-22");
    await hover("2026-10-22");
    await page.mouse.up();
    assert.equal(
      (await snapshot()).find((item) => item.id === before.id).updatedAt,
      moved.updatedAt,
    );
    await begin("拖动单日", "2026-10-22");
    await hover("2026-10-23");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(
      await page.locator(".agenda-drag-preview,.agenda-drop-target").count(),
      0,
    );
    await begin("拖动单日", "2026-10-22");
    const left = await dateCard("2026-10-23").boundingBox(),
      right = await dateCard("2026-10-24").boundingBox();
    await page.mouse.move(
      (left.x + left.width) * 0.75 + right.x * 0.25,
      left.y + 15,
      {
        steps: 8,
      },
    );
    assert.equal(await page.locator(".agenda-drop-target").count(), 1);
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-23",
      "Releasing inside a column gutter commits the preview date",
    );
    await drag("拖动单日", "2026-10-23", "2026-10-22");
    await begin("拖动单日", "2026-10-22");
    await hover("2026-10-23");
    await page.mouse.move(0, 0);
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await page.locator("#agendaNote").fill("未保存草稿");
    await begin("拖动单日", "2026-10-22");
    await hover("2026-10-23");
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    assert.match(
      await page.locator("#agendaStatus").textContent(),
      /先保存或取消/,
    );
    assert.equal(await page.locator("#agendaNote").inputValue(), "未保存草稿");
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await page.locator("#agendaMemo").fill("备忘录不阻止拖动");
    await drag("拖动单日", "2026-10-22", "2026-10-23");
    await begin("拖动单日", "2026-10-23");
    await hover("2026-10-24");
    await page.setViewportSize({ width: 1470, height: 1000 });
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await page.setViewportSize({ width: 1480, height: 1000 });
    await begin("拖动单日", "2026-10-23");
    await hover("2026-10-24");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await begin("拖动单日", "2026-10-23");
    await hover("2026-10-24");
    await page.evaluate(() => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== "1"; i++)
        button.click();
    });
    await page.mouse.up();
    assert.equal(
      await page.locator("#agendaViewToggle").getAttribute("data-agenda-view"),
      "1",
    );
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await drag("拖动单日", "2026-10-23", "2026-10-24");
    await create(
      "跨天拖动",
      "2026-10-28",
      "2026-11-04",
      "",
      "",
      "整条平移\n保持备注",
    );
    await create("同周保持原位", "2026-10-26");
    await page.evaluate((target) => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== target; i++)
        button.click();
      if (button.dataset.agendaView !== target)
        throw Error("Agenda view did not change");
    }, "2");
    assert.equal(
      await page.locator("#agendaViewToggle").getAttribute("data-agenda-view"),
      "2",
    );
    const dates = await page
      .locator("#calendar > .day[data-agenda-week]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.dataset.date || node.dataset.previewDate),
      );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await rememberUnrelated("跨天拖动");
    await begin("跨天拖动", "2026-10-30");
    await hover("2026-11-01");
    assert.ok((await page.locator(".agenda-drop-range").count()) > 1);
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await page.screenshot({
      path: path.resolve("artifacts/agenda-drag-preview.png"),
    });
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    await verifyUnrelated();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-30",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-11-06",
    );
    assert.deepEqual(
      await page
        .locator("#calendar > .day[data-agenda-week]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.dataset.date || node.dataset.previewDate),
        ),
      dates,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await drag("跨天拖动", "2026-11-04", "2026-11-05", 1);
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-31",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-11-07",
    );
    await create("午夜拖动", "2026-10-31", "2026-11-01", "22:00", "00:00");
    await drag("午夜拖动", "2026-10-31", "2026-11-01");
    assert.equal(
      await chip("午夜拖动").getAttribute("data-agenda-segment-end"),
      "2026-11-01",
    );
    await page.evaluate(() => {
      window.dragOriginalStore = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (...args) {
        if (this.mode === "readwrite")
          throw new DOMException("Test", "QuotaExceededError");
        return window.dragOriginalStore.apply(this, args);
      };
    });
    await drag("午夜拖动", "2026-11-01", "2026-11-02");
    assert.ok(await page.locator("#agendaError").textContent());
    assert.equal(
      await chip("午夜拖动").getAttribute("data-agenda-segment-start"),
      "2026-11-01",
    );
    await page.evaluate(() => {
      IDBTransaction.prototype.objectStore = window.dragOriginalStore;
    });
    await drag("午夜拖动", "2026-11-01", "2026-11-02");
    const archived = await snapshot();
    assert.equal(
      archived.find((item) => item.title === "午夜拖动").endDate,
      "2026-11-03",
    );
    const backupText = await page.evaluate(() => window.dragBackup);
    await page.reload();
    await ready();
    await clipboard();
    const reloaded = await snapshot();
    assert.deepEqual(reloaded, archived);
    await page.evaluate((text) => {
      window.dragBackup = text;
    }, backupText);
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.deepEqual(await snapshot(), archived);
    // Touch pointers must stay available to the browser for scrolling and taps.
    await page.setViewportSize({ width: 390, height: 844 });
    const touch = await page
      .locator("#calendar .agenda-chip")
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const event = (type, x) =>
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 81,
            pointerType: "touch",
            button: 0,
            clientX: x,
            clientY: rect.top + 5,
          });
        const accepted = node.dispatchEvent(
          event("pointerdown", rect.left + 5),
        );
        document.dispatchEvent(event("pointermove", rect.left + 30));
        document.dispatchEvent(event("pointerup", rect.left + 30));
        return {
          accepted,
          ghost: !!document.querySelector(".agenda-drag-preview"),
        };
      });
    assert.equal(touch.accepted, true);
    assert.equal(touch.ghost, false);
    await page.setViewportSize({ width: 1480, height: 1000 });
    // Simulate an external update/removal at the controller boundary while held.
    await page.evaluate(() => {
      window.harnessItems = [
        {
          id: "external",
          title: "外部更新测试",
          date: "2026-10-20",
          endDate: "2026-10-20",
          allDay: true,
          start: "",
          end: "",
          note: "",
          completed: false,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ];
      window.harnessSaves = 0;
      window.harnessOriginalItem = window.harnessItems[0];
      window.harnessNotices = [];
      const calendar = document.createElement("div");
      calendar.id = "dragHarness";
      calendar.style.cssText =
        "position:fixed;left:400px;top:160px;width:400px;height:140px;display:flex;gap:10px;z-index:20000;background:white";
      calendar.innerHTML =
        '<div class="day" data-date="2026-10-20" style="width:190px;height:140px"><button type="button" class="agenda-chip" data-agenda-edit="external">外部更新测试</button></div><div class="day" data-date="2026-10-21" style="width:190px;height:140px"></div>';
      document.body.append(calendar);
      calendar.addEventListener(
        "pointerdown",
        (event) => {
          window.harnessPointer = event.pointerId;
        },
        { capture: true },
      );
      window.harnessDrag = WorkTimeApp.ui.createAgendaDrag({
        calendar,
        getState: () => ({
          active: true,
          busy: false,
          readOnly: false,
          transitioning: false,
          draft: false,
          items: window.harnessItems,
        }),
        settle() {},
        async save(item) {
          window.harnessSaves++;
          window.harnessSaved = item;
          return true;
        },
        notify(text) {
          window.harnessNotices.push(text);
        },
      });
    });
    async function harnessStart() {
      const source = await page
        .locator("#dragHarness .agenda-chip")
        .boundingBox();
      const target = await page
        .locator('#dragHarness [data-date="2026-10-21"]')
        .boundingBox();
      await page.mouse.move(source.x + 15, source.y + 7);
      await page.mouse.down();
      await page.mouse.move(target.x + 30, target.y + 15, { steps: 8 });
      assert.equal(await page.locator(".agenda-drag-preview").count(), 1);
    }
    await harnessStart();
    await page.evaluate(() => {
      window.harnessItems = window.harnessItems.map((item) => ({
        ...item,
        note: "新版内容",
      }));
      window.harnessDrag.refresh();
    });
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await page.mouse.up();
    await harnessStart();
    await page.evaluate(() => {
      window.harnessItems = [];
    });
    await page.mouse.up();
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    assert.equal(await page.evaluate(() => window.harnessSaves), 0);
    assert.equal(await page.evaluate(() => window.harnessNotices.length), 2);
    await page.evaluate(() => {
      window.harnessItems = [window.harnessOriginalItem];
    });
    await harnessStart();
    // All events happen before the next animation frame. Release must use its
    // own coordinates rather than the last scheduled pointer preview.
    await page.evaluate(() => {
      const options = {
        bubbles: true,
        pointerType: "mouse",
        pointerId: window.harnessPointer,
        clientY: 175,
      };
      for (let index = 0; index < 30; index++)
        document.dispatchEvent(
          new PointerEvent("pointermove", { ...options, clientX: 430 + index }),
        );
      document.dispatchEvent(
        new PointerEvent("pointerup", { ...options, clientX: 650 }),
      );
    });
    await page.mouse.up();
    await page.waitForFunction(() => window.harnessSaves === 1);
    assert.equal(
      await page.evaluate(() => window.harnessSaved.date),
      "2026-10-21",
    );
    await harnessStart();
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: window.harnessPointer,
          clientX: 650,
          clientY: 175,
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.evaluate(() => window.harnessSaves), 1);
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await page.evaluate(() => {
      window.harnessDrag.dispose();
      document.querySelector("#dragHarness").remove();
    });
    assert.deepEqual(errors, []);
    console.log(
      "Mouse rescheduling, threshold/click, cross-day anchors, continuation, cancellation, drafts, midnight, atomic failures, persistence/backup and touch exclusion verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
