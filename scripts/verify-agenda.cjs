"use strict";
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
    const context = await browser.newContext({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let acceptDialogs = true;
    page.on("dialog", (dialog) =>
      acceptDialogs ? dialog.accept() : dialog.dismiss(),
    );
    const ready = async () =>
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
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.agendaBackup = text;
          },
          readText: async () => window.agendaBackup,
        },
      }),
    );
    const backup = async () => {
      await page.evaluate(() => {
        window.agendaBackup = null;
      });
      await page.locator("#backup").click();
      await page.waitForFunction(() => !!window.agendaBackup);
      return page.evaluate(async () =>
        WorkTimeApp.services.backup.decode(window.agendaBackup, (v) => v),
      );
    };
    const initial = await backup();
    const today = await page.evaluate(() =>
      WorkTimeApp.domain.time.businessDate(new Date()),
    );
    await page.evaluate(() => {
      window.originalCalendar = document.querySelector("#calendar");
      window.originalSelectedCard = document.querySelector(
        "#calendar .day.selected",
      );
      window.originalWeekdays = document.querySelector(
        "#panelContent > .weekdays",
      );
      window.originalDateHeader =
        window.originalSelectedCard.querySelector(".daytop");
    });
    await page.locator("#agendaMode").click();
    assert.equal(await page.locator("#importOpen").isVisible(), false);
    assert.equal(
      await page.locator(".sidebar-actions").evaluate((node) => node.inert),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("#calendar") === window.originalCalendar &&
          document.querySelector("#calendar .day.selected") ===
            window.originalSelectedCard &&
          document.querySelector("#panelContent > .weekdays") ===
            window.originalWeekdays &&
          window.originalSelectedCard.querySelector(".daytop") ===
            window.originalDateHeader &&
          !document.querySelector(
            "#agendaCalendar, .agenda-grid, .agenda-weekdays",
          ),
      ),
      true,
      "Agenda must reuse the original calendar, keyed cards, date headers and weekday component",
    );
    assert.equal(
      await page.locator("#panelContent > .weekdays").isVisible(),
      true,
    );
    assert.equal(await page.locator("#agendaEditor").isVisible(), true);
    assert.equal(await page.locator("#agendaEditor #agendaList").count(), 1);
    assert.equal(await page.locator("#agendaSummary #agendaList").count(), 0);
    assert.equal(
      await page.locator("#agendaEditor #agendaForm").isVisible(),
      false,
    );
    assert.equal(await page.locator("#dayForm").isVisible(), false);
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#analysisToggle").nextElementSibling.id,
      ),
      "agendaMode",
    );
    assert.equal(
      await page
        .locator("#analysisToggle")
        .evaluate((button) => button.parentElement.id),
      "agendaModes",
    );
    await page.locator("#agendaNew").click();
    // The themed picker owns selection while the editable native field owns value.
    await openSchedule();
    await page.locator("#agendaDateInput").fill("2028-02-28");
    await page.locator("#agendaDateOpen").click();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(":focus").getAttribute("data-picker-date"),
      "2028-02-29",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2028-02-29",
    );
    await page.locator("#agendaDateOpen").click();
    await page.locator(":popover-open [data-picker-step='1']:visible").click();
    await page
      .locator(":popover-open [data-picker-date='2028-03-03']:visible")
      .click();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2028-03-03",
    );
    for (const [date, step] of [
      ["1900-01-01", "-1"],
      ["9999-12-31", "1"],
    ]) {
      await openSchedule();
      await page.locator("#agendaDateInput").fill(date);
      await page.locator("#agendaDateOpen").click();
      assert.equal(
        await page
          .locator(`:popover-open [data-picker-step='${step}']:visible`)
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
    }
    await openSchedule();
    await page.locator(":popover-open [data-schedule-today]").click();
    assert.equal(await page.locator("#agendaDateInput").inputValue(), today);
    // One compact entry opens the full linked date/time range picker.
    await page.locator("#agendaDateInput").fill("2028-02-28");
    await page.locator("#agendaDateOpen").click();
    await page.locator("#agendaMultiDay").check();
    assert.equal(
      await page.locator(".agenda-inline-calendar:visible").count(),
      2,
    );
    const months = await page
      .locator(".agenda-inline-calendar:visible")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().top),
      );
    assert.equal(
      months[0],
      months[1],
      "Range calendars must sit beside each other on desktop",
    );
    await page
      .locator(
        ':popover-open [data-picker-date="2028-02-28"]:not(.is-adjacent)',
      )
      .click();
    await page
      .locator(
        ':popover-open [data-picker-date="2028-03-02"]:not(.is-adjacent)',
      )
      .click();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2028-02-28",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2028-03-02",
    );
    assert.equal(
      await page.locator(".agenda-picker-day.is-in-range:visible").count(),
      2,
    );
    await page
      .locator(
        ':popover-open [data-picker-date="2028-03-04"]:not(.is-adjacent)',
      )
      .click();
    await page
      .locator(
        ':popover-open [data-picker-date="2028-02-27"]:not(.is-adjacent)',
      )
      .click();
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2028-02-27",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2028-03-04",
    );
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaStart").fill("09:00");
    await page.locator("#agendaEnd").fill("18:00");
    await page.locator("[data-schedule-close]").click();
    assert.equal(await page.locator("#agendaAllDay").isVisible(), false);
    assert.match(
      await page.locator("#agendaScheduleSummary").textContent(),
      /2028-02-27 09:00.*2028-03-04 18:00/,
    );
    await openSchedule();
    await page.locator("#agendaMultiDay").uncheck();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator("#agendaScheduleOpen")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    const create = async (title, start = "", end = "") => {
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      if (start) {
        await openSchedule();
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill(start);
        if (end) await page.locator("#agendaEnd").fill(end);
      }
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () =>
          !document.querySelector("#agendaFields").disabled &&
          document.querySelector("#agendaTitle").value === "",
      );
    };
    await page.locator("#agendaCancel").click();
    await create("全天整理资料");
    await create("下午讨论", "14:00", "15:00");
    await create("上午讨论", "09:00");
    assert.equal(
      await page
        .locator(
          "#calendar .day.selected .agenda-chip-status[aria-label='待完成']",
        )
        .count(),
      3,
    );
    const memoText = "下周准备资料\n记得确认会议 <script>plain text</script>";
    await page.locator("#agendaMemo").fill(memoText);
    await page.waitForFunction(
      () =>
        document.querySelector("#agendaMemoStatus").textContent ===
        WorkTimeApp.i18n.t("agenda.saved"),
    );
    assert.equal(await page.locator("#agendaMemo script").count(), 0);
    await page.evaluate((text) => {
      const memo = document.querySelector("#agendaMemo");
      for (const value of ["快速输入", "继续编辑", "", text]) {
        memo.value = value;
        memo.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, memoText);
    const memoBackup = await backup();
    assert.equal(
      memoBackup.work.modules.find((m) => m.id === "worktime.memo").records[0]
        .data.text,
      memoText,
    );
    await page.locator("#agendaMemo").fill("");
    const clearedMemoBackup = await backup();
    assert.equal(
      clearedMemoBackup.work.modules.find((m) => m.id === "worktime.memo")
        .records[0].data.text,
      "",
    );
    await page.locator("#agendaMemo").fill(memoText);
    await page.waitForFunction(
      () =>
        document.querySelector("#agendaMemoStatus").textContent ===
        WorkTimeApp.i18n.t("agenda.saved"),
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    assert.equal(
      await page.locator("#agendaOverview [data-agenda-jump]").count(),
      3,
    );
    assert.equal(
      await page.locator("#agendaOverview .agenda-overview-section").count(),
      1,
    );
    assert.equal(
      await page.locator("#agendaOverview .agenda-overview-empty").count(),
      0,
    );
    assert.deepEqual(
      await page.locator("#agendaList strong").allTextContents(),
      ["全天整理资料", "上午讨论", "下午讨论"],
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#calendar .day.selected .agenda-chip:not([hidden])",
        ).length === 3,
    );
    assert.equal(
      await page.locator("#calendar .day.selected .agenda-more").isVisible(),
      false,
    );
    await page.locator("#calendar .day.selected").evaluate((card) => {
      card.style.height = "100px";
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#calendar .day.selected .agenda-chip:not([hidden])",
        ).length === 1,
    );
    assert.match(
      await page.locator("#calendar .day.selected .agenda-more").textContent(),
      /2/,
    );
    await page.locator("#calendar .day.selected").evaluate((card) => {
      card.style.height = "200px";
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#calendar .day.selected .agenda-chip:not([hidden])",
        ).length === 3,
    );
    assert.equal(
      await page.locator("#calendar .day.selected .agenda-more").isVisible(),
      false,
    );
    await page
      .locator("#calendar .day.selected")
      .evaluate((card) => card.style.removeProperty("height"));
    await page.locator("#agendaList .agenda-item-copy").nth(1).click();
    await page
      .locator("#agendaNote")
      .fill("逐项确认\n保留换行 <script>unsafe</script>");
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.waitForFunction(
      () => document.querySelector("#agendaTitle").value === "",
    );
    assert.match(
      await page.locator("#agendaList .agenda-note").textContent(),
      /<script>unsafe<\/script>/,
    );
    await page
      .locator("#calendar .day.selected .agenda-chip-title")
      .filter({ hasText: "上午讨论" })
      .click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "上午讨论");
    assert.equal(await page.locator("#agendaStart").inputValue(), "09:00");
    assert.equal(
      await page.locator("#agendaNote").inputValue(),
      "逐项确认\n保留换行 <script>unsafe</script>",
    );
    assert.equal(
      await page.locator("#agendaFormTitle").textContent(),
      await page.evaluate(() => WorkTimeApp.i18n.t("agenda.edit")),
    );
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.locator("#calendar .day.selected").evaluate((card) => {
      card.style.height = "160px";
    });
    await page
      .locator("#calendar .day.selected .agenda-chip-title")
      .filter({ hasText: "全天整理资料" })
      .click();
    assert.equal(
      await page.locator("#agendaTitle").inputValue(),
      "全天整理资料",
    );
    const editorTop = await page
      .locator("#agendaEditor")
      .evaluate((pane) => pane.getBoundingClientRect().top);
    assert.ok(
      editorTop >= -1 && editorTop < 100,
      "Stacked layouts scroll to the agenda editor",
    );
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page
      .locator("#calendar .day.selected")
      .evaluate((card) => card.style.removeProperty("height"));
    await page.locator("#agendaList .agenda-complete").first().click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#agendaList .agenda-complete")
          .getAttribute("aria-pressed") === "true",
    );
    assert.equal(
      await page
        .locator(
          "#calendar .day.selected .agenda-chip.is-complete .agenda-chip-status[aria-label='已完成'] svg",
        )
        .count(),
      1,
    );
    await page.locator("#agendaList .agenda-complete").first().click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#agendaList .agenda-complete")
          .getAttribute("aria-pressed") === "false",
    );
    // Moving an existing event across months updates both calendars and its identity.
    const movedDate = await page.evaluate((date) => {
      const value = WorkTimeApp.domain.time.localDate(date);
      value.setDate(value.getDate() + 40);
      return WorkTimeApp.domain.time.dateKey(value);
    }, today);
    const move = async (date) => {
      await page
        .locator("#agendaList .agenda-item-copy")
        .filter({ hasText: "下午讨论" })
        .click();
      await openSchedule();
      await page.locator("#agendaDateInput").fill(date);
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        (value) =>
          document.querySelector("#agendaTitle").value === "" &&
          document.querySelector("#calendar .day.selected").dataset.date ===
            value,
        date,
      );
    };
    await move(movedDate);
    assert.equal(await page.locator("#agendaMemo").inputValue(), memoText);
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 1);
    assert.deepEqual(
      await page
        .locator("#agendaOverview [data-agenda-jump] > span")
        .allTextContents(),
      ["全天整理资料", "上午讨论", "下午讨论"],
    );
    assert.deepEqual(
      await page.locator("#agendaOverview .agenda-count").allTextContents(),
      ["2", "1"],
    );
    await move(today);
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    assert.equal(
      await page.locator("#agendaOverview [data-agenda-jump]").count(),
      3,
    );
    // Validation rejects reversed times without changing persisted data.
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("无效时段");
    await openSchedule();
    await page.locator("#agendaAllDay").uncheck();
    await page.locator("#agendaStart").fill("15:00");
    await page.locator("#agendaEnd").fill("14:00");
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    assert.ok(await page.locator("#agendaError").textContent());
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    // Dismissing discard/delete confirmation preserves data and form values.
    acceptDialogs = false;
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "无效时段");
    await page.locator("#agendaBack").click();
    assert.equal(await page.locator("#agendaForm").isVisible(), true);
    // Refusing navigation or a mode change keeps the draft visible.
    await page.locator("#nextMonth").click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "无效时段");
    await page.locator("#agendaMode").click();
    assert.equal(await page.locator("#dayForm").isVisible(), false);
    assert.equal(await page.locator("#agendaTitle").inputValue(), "无效时段");
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      await openSchedule();
      assert.equal(
        await page.locator(":popover-open .agenda-picker-day:visible").count(),
        42,
      );
      assert.equal(
        await page.locator(":popover-open [data-schedule-today]").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("agenda.pickerToday")),
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#agendaTitle").inputValue(), "无效时段");
      assert.equal(
        await page.locator("#agendaSave").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("agenda.save")),
      );
    }
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    acceptDialogs = true;
    await page.locator("#agendaCancel").click();
    acceptDialogs = false;
    await page.locator("#agendaList [data-agenda-delete]").first().click();
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    acceptDialogs = true;
    await page.locator("#todayButton").click();
    const full = await backup();
    const agenda = full.work.modules.find((m) => m.id === "worktime.agenda");
    assert.equal(agenda.records.length, 3);
    assert.equal(agenda.records[0].data.date, today);
    const attendance = (doc) =>
      doc.work.modules.filter(
        (m) => !["worktime.agenda", "worktime.memo"].includes(m.id),
      );
    assert.equal(
      full.work.modules.find((m) => m.id === "worktime.memo").records[0].data
        .text,
      memoText,
    );
    assert.deepEqual(
      attendance(full),
      attendance(initial),
      "Agenda mutations must preserve attendance, settings and imports",
    );
    // Both optional-module legacy restore and full backup round trips validate.
    const checks = await page.evaluate((doc) => {
      const A = WorkTimeApp.services.archive,
        rules = WorkTimeApp.domain.agenda;
      const original = A.decode(doc.work);
      const old = structuredClone(doc.work);
      old.modules = old.modules.filter(
        (m) => ![A.ids.agenda, A.ids.memo].includes(m.id),
      );
      const invalid = structuredClone(doc.work);
      const rows = invalid.modules.find((m) => m.id === A.ids.agenda).records;
      rows[0].data.title = "";
      let rejected = false;
      try {
        A.decode(invalid);
      } catch {
        rejected = true;
      }
      let duplicate = false;
      try {
        rules.validateItems([original.agenda[0], original.agenda[0]]);
      } catch {
        duplicate = true;
      }
      return {
        oldCount: A.decode(old).agenda.length,
        oldMemo: A.decode(old).memo,
        roundTrip: A.decode(A.encode(original)).agenda,
        original: original.agenda,
        rejected,
        duplicate,
      };
    }, full);
    assert.equal(checks.oldCount, 0);
    assert.equal(checks.oldMemo, "");
    assert.deepEqual(checks.roundTrip, checks.original);
    assert.equal(checks.rejected, true);
    assert.equal(checks.duplicate, true);
    // Storage failure is atomic: the draft remains and no unsaved event appears.
    await page.evaluate(() => {
      window.agendaOriginalCommit = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (...args) {
        if (this.mode === "readwrite")
          throw new DOMException("Test write failure", "QuotaExceededError");
        return window.agendaOriginalCommit.apply(this, args);
      };
    });
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("失败后保留草稿");
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
      await page.locator("#agendaTitle").inputValue(),
      "失败后保留草稿",
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    await page.locator("#agendaMemo").fill("保存失败时保留的备忘录");
    await page.locator("#agendaMemoRetry").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#agendaMemo").inputValue(),
      "保存失败时保留的备忘录",
    );
    await page.evaluate(() => {
      IDBTransaction.prototype.objectStore = window.agendaOriginalCommit;
    });
    await page.locator("#agendaMemoRetry").click();
    await page.locator("#agendaMemoRetry").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.querySelector("#agendaMemoStatus").textContent ===
        WorkTimeApp.i18n.t("agenda.saved"),
    );
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaSave").click();
    await page.waitForFunction(
      () => document.querySelector("#agendaTitle").value === "",
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 4);
    await page.locator("#agendaList [data-agenda-delete]").last().click();
    await page.waitForFunction(
      () => document.querySelectorAll("#agendaList .agenda-item").length === 3,
    );
    // Persisted deletion and records survive reloading the offline entry.
    await page.reload();
    await ready();
    assert.equal(
      await page.locator("#agendaMemo").inputValue(),
      "保存失败时保留的备忘录",
    );
    assert.equal(
      await page.locator("#agendaMode").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await page.screenshot({
      path: path.resolve("artifacts/agenda-desktop.png"),
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "No horizontal page overflow at " + width,
      );
      assert.equal(
        await page.evaluate(() => {
          const panel = document
            .querySelector(".panel-head")
            .getBoundingClientRect();
          return [...document.querySelectorAll(".month-controls > *")].every(
            (node) => node.getBoundingClientRect().right <= panel.right + 1,
          );
        }),
        true,
      );
      await page.locator("#agendaNew").click();
      for (const id of ["agendaMode", "agendaTitle", "agendaSave"]) {
        const bounds = await page.locator("#" + id).boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          id + " remains within mobile viewport",
        );
      }
      await page.locator("#agendaCancel").click();
    }
    await page.screenshot({
      path: path.resolve("artifacts/agenda-mobile.png"),
      fullPage: true,
    });
    // Actual restore UI replaces agenda records; legacy backups clear with a preview.
    await page.evaluate(
      (doc) =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {},
            readText: async () => JSON.stringify(doc),
          },
        }),
      full,
    );
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#restoreSummary").textContent(),
      /3.*日程/,
    );
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 3);
    assert.equal(await page.locator("#agendaMemo").inputValue(), memoText);
    const legacy = structuredClone(full.work);
    legacy.modules = legacy.modules.filter(
      (m) => !["worktime.agenda", "worktime.memo"].includes(m.id),
    );
    await page.evaluate(
      (doc) =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { readText: async () => JSON.stringify(doc) },
        }),
      legacy,
    );
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#restoreSummary").textContent(),
      /0.*日程.*清空/,
    );
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 0);
    assert.equal(await page.locator("#agendaMemo").inputValue(), "");
    await page.reload();
    await ready();
    assert.equal(
      await page.locator("#agendaMode").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 0);
    // Simulate an installed pre-agenda database, without migrating through restore.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("worktime-archive");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(["archives", "modules"], "readwrite");
      const request = tx.objectStore("archives").get("active");
      request.onsuccess = () =>
        tx
          .objectStore("modules")
          .delete([request.result.archive.id, "worktime.agenda"]);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await ready();
    assert.equal(
      await page.locator("#agendaMode").getAttribute("aria-pressed"),
      "true",
    );
    await create("旧版数据库升级后新增");
    await page.reload();
    await ready();
    assert.equal(
      await page.locator("#agendaMode").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator("#agendaList strong").textContent(),
      "旧版数据库升级后新增",
    );
    // Content motion is confined to day bodies, with a stable grid/header and
    // deterministic cleanup on rapid toggles, reduction and unavailable APIs.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      window.agendaAnimations = [];
      window.agendaSideAnimations = [];
      window.agendaNativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.matches(".agenda-card-items, .agenda-content-outgoing"))
          window.agendaAnimations.push({
            outgoing: this.classList.contains("agenda-content-outgoing"),
            duration: options.duration,
          });
        if (
          this.matches(
            ".agenda-summary, .agenda-editor-body, #agendaDayDetails, #cards, .target-panel, #dayForm",
          )
        )
          window.agendaSideAnimations.push({
            side: this.closest(".summary-sidebar") ? "left" : "right",
            target: this.id || this.className,
            frames,
          });
        return window.agendaNativeAnimate.call(this, frames, options);
      };
    });
    const motion = await page.evaluate(() => {
      const calendar = document.querySelector("#calendar");
      const card = calendar.querySelector(".day.selected");
      const header = card.querySelector(".daytop");
      const weekdays = document.querySelector("#panelContent > .weekdays");
      const before = card.getBoundingClientRect();
      for (let i = 0; i < 4; i++) document.querySelector("#agendaMode").click();
      const after = card.getBoundingClientRect();
      return {
        same:
          card === calendar.querySelector(".day.selected") &&
          header === card.querySelector(".daytop") &&
          weekdays === document.querySelector("#panelContent > .weekdays"),
        geometry: [before.x, before.y, before.width, before.height].every(
          (v, i) =>
            Math.abs(v - [after.x, after.y, after.width, after.height][i]) <
            0.5,
        ),
        overlays: Math.max(
          0,
          ...[...calendar.querySelectorAll(".day[data-date]")].map(
            (day) =>
              day.querySelectorAll(":scope > .agenda-content-outgoing").length,
          ),
        ),
        headersMoving: [...header.getAnimations(), ...weekdays.getAnimations()]
          .length,
        events: window.agendaAnimations,
        sides: window.agendaSideAnimations,
      };
    });
    assert.equal(motion.same, true);
    assert.equal(motion.geometry, true);
    assert.equal(motion.headersMoving, 0);
    assert.ok(motion.sides.some((item) => item.side === "left"));
    assert.ok(motion.sides.some((item) => item.side === "right"));
    assert.ok(
      motion.sides.every(
        (item) =>
          item.frames[0].transform === "translateX(-6px)" &&
          item.frames.at(-1).transform === "none",
      ),
      "Both sidebars reveal from left to right",
    );
    assert.ok(
      motion.events.some((item) => item.outgoing && item.duration === 200),
    );
    assert.ok(
      motion.events.some((item) => !item.outgoing && item.duration === 300),
    );
    assert.ok(
      motion.overlays <= 3,
      "Rapid switching cannot stack outgoing copies",
    );
    await page.waitForFunction(
      () => !document.querySelector(".agenda-content-outgoing"),
    );
    await page.evaluate(() => {
      window.agendaAnimations = [];
    });
    await page.locator("#agendaList .agenda-complete").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#agendaList .agenda-complete")
          .getAttribute("aria-pressed") === "true",
    );
    assert.equal(
      await page.evaluate(() =>
        window.agendaAnimations.some((item) => item.outgoing),
      ),
      false,
      "Completion updates the existing chip without replacing its card summary",
    );
    await page.waitForFunction(
      () => !document.querySelector(".agenda-content-outgoing"),
    );
    await page.evaluate(() => {
      window.agendaAnimations = [];
    });
    await page.locator("#agendaList [data-agenda-delete]").click();
    await page.waitForFunction(
      () => !document.querySelector("#agendaList .agenda-item"),
    );
    assert.equal(
      await page.evaluate(() =>
        window.agendaAnimations.some((item) => item.outgoing),
      ),
      true,
      "Deleting the last item fades out its previous summary",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => !document.querySelector(".agenda-content-outgoing"),
    );
    const reduced = await page.evaluate(() => {
      window.agendaAnimations = [];
      document.querySelector("#agendaMode").click();
      document.querySelector("#agendaMode").click();
      return window.agendaAnimations.length;
    });
    assert.equal(reduced, 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Element.prototype.animate = undefined;
      document.querySelector("#agendaMode").click();
      document.querySelector("#agendaMode").click();
    });
    await page.waitForFunction(
      () => !document.querySelector(".agenda-content-outgoing"),
    );
    assert.equal(await page.locator("#agendaEditor").isVisible(), true);
    await page.evaluate(() => {
      Element.prototype.animate = window.agendaNativeAnimate;
    });
    await page.locator("#agendaMode").click();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-content-outgoing"),
    );
    await page.evaluate(() => {
      window.workAnimations = [];
      Element.prototype.animate = function (frames, options) {
        if (this.matches(".daytime, .dayhours, .day-footer"))
          window.workAnimations.push(this.className);
        return window.agendaNativeAnimate.call(this, frames, options);
      };
    });
    await page.locator("#dayStart").fill("08:00");
    await page.locator("#dayStart").press("Tab");
    await page.waitForFunction(() => window.workAnimations.length > 0);
    await page.evaluate(() => {
      Element.prototype.animate = window.agendaNativeAnimate;
    });
    await page.locator("#agendaMode").click();
    await create("较长的第一条日程用于检查退出排版");
    await create("第二条日程保持在下一行");
    for (const width of [1480, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 320) {
        await page.locator("#calendar .day.selected").evaluate((card) => {
          card.style.height = "220px";
        });
        await page.waitForFunction(
          () =>
            document.querySelectorAll(
              "#calendar .day.selected .agenda-chip:not([hidden])",
            ).length >= 2,
        );
      }
      await page
        .locator(
          "#calendar .day.selected > .agenda-card-items:not(.agenda-content-outgoing)",
        )
        .evaluate(async (host) => {
          await Promise.all(
            host.getAnimations().map((animation) => animation.finished),
          );
        });
      const layout = await page.evaluate(() => {
        const card = document.querySelector("#calendar .day.selected");
        const host = card.querySelector(
          ":scope > .agenda-card-items:not(.agenda-content-outgoing)",
        );
        const geometry = (node) => {
          const box = node.getBoundingClientRect();
          return [
            ...node.querySelectorAll(".agenda-chip, .agenda-chip span"),
          ].map((child) => {
            const rect = child.getBoundingClientRect();
            return [
              rect.left - box.left,
              rect.top - box.top,
              rect.width,
              rect.height,
            ];
          });
        };
        const before = geometry(host);
        document.querySelector("#agendaMode").click();
        const outgoing = card.querySelector(
          ":scope > .agenda-card-items.agenda-content-outgoing",
        );
        return {
          before,
          after: geometry(outgoing),
          direction: getComputedStyle(outgoing).flexDirection,
        };
      });
      assert.equal(layout.direction, "column");
      assert.ok(layout.before.length >= 4);
      assert.equal(layout.after.length, layout.before.length);
      assert.ok(
        layout.before.every((rect, index) =>
          rect.every(
            (value, axis) => Math.abs(value - layout.after[index][axis]) < 1,
          ),
        ),
        `Outgoing event text keeps its line layout at ${width}px: ${JSON.stringify(layout)}`,
      );
      await page.waitForFunction(
        () => !document.querySelector(".agenda-content-outgoing"),
      );
      await page.locator("#agendaMode").click();
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Agenda CRUD, ordering, completion, drafts, six languages, atomic failures, persistence, backup/legacy restore, mobile layouts and card-content animation verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
