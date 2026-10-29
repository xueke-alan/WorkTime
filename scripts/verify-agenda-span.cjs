"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
    const domain = await page.evaluate(() => {
      const rules = WorkTimeApp.domain.agenda;
      const base = {
        id: "span",
        title: "test",
        date: "2028-02-28",
        endDate: "2028-03-01",
        allDay: true,
        start: "",
        end: "",
        note: "",
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const item = rules.validate(base);
      const night = rules.validate({
        ...base,
        allDay: false,
        start: "22:00",
        end: "02:00",
      });
      const midnight = rules.validate({
        ...base,
        allDay: false,
        endDate: "2028-02-29",
        start: "22:00",
        end: "00:00",
      });
      const invalid = [];
      for (const fields of [
        { endDate: "2028-02-27" },
        { allDay: false, start: "22:00", end: "" },
        { endDate: "2028-02-28", allDay: false, start: "22:00", end: "02:00" },
      ]) {
        try {
          rules.validate({ ...base, ...fields });
          invalid.push(false);
        } catch {
          invalid.push(true);
        }
      }
      const old = { ...base };
      delete old.endDate;
      const A = WorkTimeApp.services.archive;
      const state = WorkTimeApp.domain.state.defaultState();
      state.agenda = [old];
      const archive = A.encode(state);
      const module = archive.modules.find((entry) => entry.id === A.ids.agenda);
      module.version = 1;
      const migrated = A.decode(archive);
      const queriedDates = [
        "2028-03-01",
        "2028-02-29",
        "2028-02-28",
        "2028-02-29",
        "1900-01-01",
        "9999-12-31",
      ];
      const queryItems = [
        night,
        { ...item, id: "all-day" },
        { ...midnight, id: "midnight" },
        { ...item, id: "long-span", date: "1900-01-01", endDate: "9999-12-31" },
      ];
      const originalOrder = queryItems.map((item) => item.id).join();
      const batch = rules.forDates(queryItems, queriedDates);
      const batchMatches = [...batch].every(
        ([date, items]) =>
          items.map((item) => item.id).join() ===
          rules
            .forDate(queryItems, date)
            .map((item) => item.id)
            .join(),
      );
      return {
        batchMatches,
        batchSize: batch.size,
        emptyBatch: rules.forDates(queryItems, []).size,
        orderPreserved:
          originalOrder === queryItems.map((item) => item.id).join(),
        leap: rules.forDate([item], "2028-02-29").length,
        inclusive: rules.forDate([item], "2028-03-01").length,
        midnight: rules.lastDate(midnight),
        night: rules.lastDate(night),
        invalid,
        oldEnd: migrated.agenda[0].endDate,
        version: A.encode(migrated).modules.find(
          (entry) => entry.id === A.ids.agenda,
        ).version,
      };
    });
    assert.equal(domain.leap, 1);
    assert.equal(domain.inclusive, 1);
    assert.equal(domain.midnight, "2028-02-28");
    assert.equal(domain.night, "2028-03-01");
    assert.deepEqual(domain.invalid, [true, true, true]);
    assert.equal(domain.oldEnd, "2028-02-28");
    assert.equal(domain.version, 2);
    assert.equal(domain.batchMatches, true);
    assert.equal(domain.batchSize, 5);
    assert.equal(domain.emptyBatch, 0);
    assert.equal(domain.orderPreserved, true);
    async function create(
      title,
      date,
      endDate,
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
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await openSchedule();
      await setScheduleRange(page, date);
      if (endDate) {
        await openSchedule();
        assert.equal(
          await page.locator("#agendaEndDateInput").isVisible(),
          true,
        );
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
    const setView = async (view) => {
      for (
        let index = 0;
        index < 4 &&
        (await page
          .locator("#agendaViewToggle")
          .evaluate(
            (node) =>
              ["month", "week", "fortnight", "threeweek"][
                Number(node.dataset.agendaView)
              ],
          )) !== view;
        index++
      )
        await page.evaluate(() => {
          document.querySelector("#agendaViewToggle").click();
        });
    };
    const chip = (title) =>
      page
        .locator(".agenda-week-layers .agenda-chip")
        .filter({ hasText: title });
    await create(
      "跨天项目",
      "2026-10-28",
      "2026-11-04",
      "",
      "",
      "资料确认\n跨天备注",
    );
    assert.equal(await chip("跨天项目").count(), 1);
    const spanWidth = await chip("跨天项目").evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    const dayWidth = await page
      .locator('[data-date="2026-10-28"]')
      .evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(spanWidth > dayWidth * 4.5);
    assert.equal(
      await chip("跨天项目").locator(".agenda-chip-note").count(),
      0,
    );
    await setView("fortnight");
    assert.equal(await chip("跨天项目").count(), 2);
    assert.equal(
      await chip("跨天项目").first().getAttribute("data-agenda-segment-end"),
      "2026-11-01",
    );
    assert.equal(
      await chip("跨天项目").last().getAttribute("data-agenda-segment-start"),
      "2026-11-02",
    );
    const beforeDates = await page
      .locator("#calendar > .day[data-agenda-week]")
      .evaluateAll((cards) =>
        cards.map((card) => card.dataset.date || card.dataset.previewDate),
      );
    await chip("跨天项目").last().click();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-28",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-11-04",
    );
    assert.deepEqual(
      await page
        .locator("#calendar > .day[data-agenda-week]")
        .evaluateAll((cards) =>
          cards.map((card) => card.dataset.date || card.dataset.previewDate),
        ),
      beforeDates,
    );
    assert.equal(
      await page.locator("#agendaOverview [data-agenda-jump]").count(),
      1,
    );
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await page.locator("#agendaList .agenda-complete").click();
    await page.locator('[data-agenda-status-choice="completed"]').click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".agenda-week-layers .agenda-chip.is-complete",
        ).length === 2,
    );
    await page.locator("#agendaList .agenda-complete").click();
    await page.locator('[data-agenda-status-choice="pending"]').click();
    await create("午夜结束", "2026-10-31", "2026-11-01", "22:00", "00:00");
    assert.equal(
      await chip("午夜结束").getAttribute("data-agenda-segment-end"),
      "2026-10-31",
    );
    await create("跨夜会议", "2026-10-31", "2026-11-01", "23:00", "02:00");
    assert.equal(
      await chip("跨夜会议").getAttribute("data-agenda-segment-end"),
      "2026-11-01",
    );
    await create("单日事项", "2026-10-31", "");
    const rects = await page
      .locator(".agenda-week-layers .agenda-chip")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.dataset.agendaEdit,
          rect: node.getBoundingClientRect().toJSON(),
        })),
      );
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].rect,
          b = rects[j].rect;
        assert.ok(
          a.right <= b.left + 0.5 ||
            b.right <= a.left + 0.5 ||
            a.bottom <= b.top + 0.5 ||
            b.bottom <= a.top + 0.5,
          "Overlapping events occupy distinct lanes",
        );
      }
    for (let i = 0; i < 6; i++)
      await create(
        "较长日程 " + i,
        "2026-10-31",
        "",
        "",
        "",
        "第一行\n第二行\n第三行\n第四行",
      );
    const overflow = page.locator(
      '.agenda-packed-row .agenda-more[data-agenda-date="2026-10-31"]',
    );
    await overflow.click();
    assert.equal(
      await page
        .locator("#agendaList .agenda-item")
        .filter({ hasText: "较长日程" })
        .count(),
      6,
      "Packed overflow opens the date details without losing hidden events",
    );
    await setView("month");
    assert.ok(
      (await page.locator(".agenda-week-layers .agenda-more").count()) > 0,
    );
    await setView("fortnight");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      document.querySelector("#nextMonth").click();
      document.querySelector("#prevMonth").click();
    });
    await page.waitForFunction(
      () =>
        !document.querySelector(".agenda-week-leaving") &&
        !document.querySelector(".agenda-week-snapshot"),
    );
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    for (const width of [1480, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setView("fortnight");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: path.resolve(`artifacts/agenda-span-${width}.png`),
        fullPage: width < 1000,
      });
    }
    await page.setViewportSize({ width: 1480, height: 1000 });
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      assert.ok((await chip("跨天项目").count()) > 0);
    }
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.spanBackupText = text;
          },
          readText: async () => window.spanBackupText,
        },
      }),
    );
    await page.locator("#backup").click();
    await page.waitForFunction(() => !!window.spanBackupText);
    const saved = await page.evaluate(async () => {
      const doc = await WorkTimeApp.services.backup.decode(
        window.spanBackupText,
        (value) => value,
      );
      const work = WorkTimeApp.services.archive.decode(doc.work);
      return {
        events: work.agenda,
        version: doc.work.modules.find(
          (module) => module.id === "worktime.agenda",
        ).version,
      };
    });
    assert.equal(saved.version, 2);
    assert.equal(
      saved.events.find((item) => item.title === "跨天项目").endDate,
      "2026-11-04",
    );
    const backupText = await page.evaluate(() => window.spanBackupText);
    await page.reload();
    await ready();
    assert.ok((await chip("跨天项目").count()) > 0);
    const restoredSegmentCount = await chip("跨天项目").count();
    await chip("跨天项目").first().click();
    await page.locator("#agendaNote").fill("保存失败不应修改跨天卡片");
    await page.evaluate(() => {
      window.spanOriginalStore = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (...args) {
        if (this.mode === "readwrite")
          throw new DOMException("Test", "QuotaExceededError");
        return window.spanOriginalStore.apply(this, args);
      };
    });
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.waitForFunction(
      () =>
        !!document.querySelector("#agendaError").textContent &&
        !document.querySelector("#agendaFields").disabled,
    );
    assert.equal(
      await page.locator("#agendaNote").inputValue(),
      "保存失败不应修改跨天卡片",
    );
    assert.equal(
      await chip("跨天项目").filter({ hasText: "保存失败" }).count(),
      0,
    );
    await page.evaluate(() => {
      IDBTransaction.prototype.objectStore = window.spanOriginalStore;
    });
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await page
      .locator("#agendaList .agenda-item")
      .filter({ hasText: "跨天项目" })
      .locator("[data-agenda-delete]")
      .click();
    await page.waitForFunction(
      () =>
        ![
          ...document.querySelectorAll(
            ".agenda-week-layers .agenda-chip-title",
          ),
        ].some((node) => node.textContent === "跨天项目"),
    );
    await page.evaluate(
      (text) =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { readText: async () => text },
        }),
      backupText,
    );
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(await chip("跨天项目").count(), restoredSegmentCount);
    await create("跨年项目", "2026-12-30", "2027-01-05");
    assert.equal(await chip("跨年项目").count(), 2);
    assert.equal(
      await chip("跨年项目").last().getAttribute("data-agenda-segment-end"),
      "2027-01-05",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Cross-day validation, v1 migration, continuous lanes, midnight exclusion, editing, completion, deduplication, packed overflow, languages, backup and reload verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
