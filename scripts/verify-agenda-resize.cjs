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
      reducedMotion: "reduce",
      timezoneId: "America/New_York",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    const domain = await page.evaluate(() => {
      const A = WorkTimeApp.domain.agenda;
      const item = {
        id: "resize",
        title: "resize",
        date: "2028-02-28",
        endDate: "2028-03-02",
        allDay: true,
        start: "",
        end: "",
        note: "preserved",
        completed: false,
        status: "cancelled",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      const midnight = { ...item, allDay: false, start: "22:00", end: "00:00" };
      const invalid = (value, target) => {
        try {
          A.resizeEnd(value, target);
          return false;
        } catch {
          return true;
        }
      };
      return {
        item,
        leap: A.resizeEnd(item, "2028-02-29"),
        midnight: A.resizeEnd(midnight, "2028-02-29"),
        shortest: A.resizeEnd(midnight, item.date),
        year: A.resizeEnd(
          { ...midnight, date: "2026-12-30", endDate: "2027-01-02" },
          "2026-12-31",
        ),
        invalid: [
          invalid(item, "2028-02-27"),
          invalid(item, "2028-02-30"),
          invalid(
            { ...item, allDay: false, start: "22:00", end: "08:00" },
            item.date,
          ),
          invalid(
            { ...item, allDay: false, start: "09:00", end: "" },
            "2028-03-03",
          ),
          invalid(
            { ...midnight, date: "9999-12-30", endDate: "9999-12-31" },
            "9999-12-31",
          ),
          invalid(item, "1899-12-31"),
        ],
      };
    });
    assert.equal(domain.leap.endDate, "2028-02-29");
    assert.equal(domain.midnight.endDate, "2028-03-01");
    assert.equal(domain.shortest.endDate, "2028-02-29");
    assert.equal(domain.year.endDate, "2027-01-01");
    assert.ok(domain.invalid.every(Boolean));
    for (const key of [
      "id",
      "date",
      "title",
      "note",
      "completed",
      "status",
      "createdAt",
      "updatedAt",
    ])
      assert.deepEqual(domain.leap[key], domain.item[key]);
    async function create(title, date, endDate = "", start = "", end = "") {
      if (await page.locator("#agendaBack").isVisible())
        await page.locator("#agendaBack").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaItemStatus").selectOption("cancelled");
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, date);
      if (endDate) {
        await page.locator("#agendaEndDateInput").fill(endDate);
      }
      if (start) {
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill(start);
        if (end) await page.locator("#agendaEnd").fill(end);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaNote").fill("保留备注");
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#agendaTitle").value === "" &&
          !document.querySelector("#agendaFields").disabled,
      );
    }
    const chips = (title) =>
      page.locator("#calendar .agenda-chip:visible").filter({
        has: page.locator(".agenda-chip-title-text", { hasText: title }),
      });
    const handle = (title) => chips(title).locator(".agenda-resize-handle");
    const card = (date) =>
      page
        .locator(
          `#calendar > .day[data-date="${date}"], #calendar > .day[data-preview-date="${date}"]`,
        )
        .filter({ visible: true });
    async function begin(title) {
      const rect = await handle(title).boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      return rect;
    }
    async function hover(date) {
      const rect = await card(date).boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + 15, {
        steps: 12,
      });
    }
    async function finish() {
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !document.querySelector(".agenda-drag-preview") &&
          !document.querySelector("#agendaFields").disabled,
      );
    }
    async function resize(title, date) {
      await page.evaluate((title) => {
        window.resizeStable = [
          ...document.querySelectorAll("#calendar .agenda-chip"),
        ].filter(
          (node) =>
            node.querySelector(".agenda-chip-title-text").textContent !== title,
        );
        window.resizeRows = [
          ...document.querySelectorAll(".agenda-week-lane"),
        ].map((node) => ({ node, scroll: node.scrollTop }));
        window.resizeUsedLanes = document
          .querySelector("#calendar")
          .classList.contains("agenda-lane-view");
      }, title);
      await begin(title);
      await hover(date);
      assert.ok((await page.locator(".agenda-resize-segment").count()) > 0);
      await finish();
      assert.ok(
        await page.evaluate(() =>
          window.resizeStable.every((node) => node.isConnected),
        ),
        "Other agenda nodes must survive compact/lane layout changes",
      );
      assert.ok(
        await page.evaluate(
          () =>
            !window.resizeUsedLanes ||
            !document
              .querySelector("#calendar")
              .classList.contains("agenda-lane-view") ||
            window.resizeRows.every(
              ({ node, scroll }) =>
                node.isConnected && node.scrollTop === scroll,
            ),
        ),
        "Existing week scrollers must retain their identity and position",
      );
    }
    await create("固定事项", "2026-10-22");
    await create("长度调整", "2026-10-20");
    const separation = await handle("长度调整").evaluate(
      (node) =>
        node.getBoundingClientRect().left -
        node.parentElement.getBoundingClientRect().right,
    );
    assert.ok(
      separation >= 1,
      "Resize target must sit outside the agenda chip",
    );
    const origin = await begin("长度调整");
    await page.mouse.move(
      origin.x + origin.width / 2 + 3,
      origin.y + origin.height / 2,
    );
    assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    await finish();
    // Preview follows pixels within one date; only release expands to that date's edge.
    await begin("长度调整");
    const targetBounds = await card("2026-10-22").boundingBox();
    const firstX = targetBounds.x + targetBounds.width * 0.3;
    const secondX = targetBounds.x + targetBounds.width * 0.7;
    await page.mouse.move(firstX, targetBounds.y + 15, { steps: 10 });
    const firstPreview = await page
      .locator(".agenda-resize-segment")
      .last()
      .boundingBox();
    assert.ok(Math.abs(firstPreview.x + firstPreview.width - firstX) < 1);
    await page.evaluate(() => {
      window.smoothPreview = document.querySelector(".agenda-resize-segment");
    });
    await page.mouse.move(secondX, targetBounds.y + 15, { steps: 10 });
    const secondPreview = await page
      .locator(".agenda-resize-segment")
      .last()
      .boundingBox();
    assert.ok(Math.abs(secondPreview.x + secondPreview.width - secondX) < 1);
    assert.ok(secondPreview.width > firstPreview.width + 10);
    assert.ok(
      await page.evaluate(
        () =>
          window.smoothPreview ===
          document.querySelector(".agenda-resize-segment"),
      ),
      "Pixel updates must reuse the preview text node",
    );
    await finish();
    const snapped = await chips("长度调整").last().boundingBox();
    assert.ok(
      snapped.x + snapped.width > secondX + 5,
      "Release must fill the target date card",
    );
    await resize("长度调整", "2026-10-20");
    await resize("长度调整", "2026-10-22");
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-10-20",
    );
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-22",
    );
    await resize("长度调整", "2026-10-20");
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-20",
    );
    // Invalid dates, same-date release, Escape, gaps, blur, resize and mode changes.
    await begin("长度调整");
    await hover("2026-10-19");
    assert.equal(await page.locator(".agenda-drop-target").count(), 0);
    await finish();
    await begin("长度调整");
    await hover("2026-10-22");
    await page.keyboard.press("Escape");
    await finish();
    await begin("长度调整");
    await hover("2026-10-20");
    await finish();
    const a = await card("2026-10-21").boundingBox(),
      b = await card("2026-10-22").boundingBox();
    await begin("长度调整");
    await page.mouse.move((a.x + a.width + b.x) / 2, a.y + 15, { steps: 8 });
    await finish();
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-20",
    );
    for (const cancel of [
      () => page.evaluate(() => window.dispatchEvent(new Event("blur"))),
      () => page.setViewportSize({ width: 1470, height: 1000 }),
      () => page.mouse.move(0, 0),
    ]) {
      await begin("长度调整");
      await hover("2026-10-22");
      await cancel();
      await finish();
      assert.equal(
        await page.locator(".agenda-drag-preview,.agenda-drop-target").count(),
        0,
      );
    }
    await page.locator("#agendaNote").fill("未保存");
    await begin("长度调整");
    await hover("2026-10-22");
    await finish();
    assert.match(
      await page.locator("#agendaStatus").textContent(),
      /先保存或取消/,
    );
    await page.locator("#agendaCancel").click();
    await create("未设结束时间", "2026-10-20", "", "09:00");
    assert.equal(await handle("未设结束时间").count(), 0);
    await create("定时长度", "2026-10-20", "", "09:00", "10:00");
    await resize("定时长度", "2026-10-23");
    assert.equal(await page.locator("#agendaStart").inputValue(), "09:00");
    assert.equal(await page.locator("#agendaEnd").inputValue(), "10:00");
    await create("午夜长度", "2026-10-20", "2026-10-21", "22:00", "00:00");
    await resize("午夜长度", "2026-10-22");
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-23",
    );
    await resize("午夜长度", "2026-10-20");
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-21",
    );
    await page.evaluate(() => {
      window.resizeStore = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (...args) {
        if (this.mode === "readwrite")
          throw new DOMException("Test", "QuotaExceededError");
        return window.resizeStore.apply(this, args);
      };
    });
    await resize("午夜长度", "2026-10-22");
    assert.ok(await page.locator("#agendaError").textContent());
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-10-21",
    );
    await page.evaluate(() => {
      IDBTransaction.prototype.objectStore = window.resizeStore;
    });
    await create("跨周长度", "2026-10-23", "2026-10-28");
    assert.equal(
      await chips("跨周长度").locator(".agenda-resize-handle").count(),
      1,
    );
    assert.equal(
      await chips("跨周长度")
        .filter({ has: page.locator(".agenda-resize-handle") })
        .getAttribute("data-agenda-segment-end"),
      "2026-10-28",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await begin("跨周长度");
    await hover("2026-11-01");
    assert.equal(await page.locator(".agenda-resize-segment").count(), 2);
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await page.screenshot({
      path: path.resolve("artifacts/agenda-resize-preview.png"),
    });
    await finish();
    assert.equal(
      await page.locator("#agendaEndDateInput").inputValue(),
      "2026-11-01",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((target) => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== target; i++)
        button.click();
      if (button.dataset.agendaView !== target)
        throw Error("Agenda view did not change");
    }, "1");
    await begin("跨周长度");
    await hover("2026-10-30");
    await page.evaluate(() => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== "2"; i++)
        button.click();
    });
    await finish();
    assert.equal(
      await page.locator(".agenda-drag-preview,.agenda-drop-range").count(),
      0,
    );
    await page.evaluate((target) => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== target; i++)
        button.click();
      if (button.dataset.agendaView !== target)
        throw Error("Agenda view did not change");
    }, "1");
    await resize("跨周长度", "2026-10-30");
    await page.evaluate(() => {
      document.querySelector("#agendaViewToggle").click();
    });
    await resize("跨周长度", "2026-11-02");
    const end = await page.locator("#agendaEndDateInput").inputValue();
    const clipboard = async (text = null) =>
      page.evaluate((text) => {
        window.resizeBackup = text;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.resizeBackup = value;
            },
            readText: async () => window.resizeBackup,
          },
        });
      }, text);
    await clipboard();
    await page.locator("#backup").click();
    await page.waitForFunction(() => !!window.resizeBackup);
    const backup = await page.evaluate(() => window.resizeBackup);
    await page.reload();
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.evaluate(() => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.view !== "week"; i++)
        button.click();
    });
    await chips("跨周长度").last().click();
    assert.equal(await page.locator("#agendaEndDateInput").inputValue(), end);
    assert.equal(
      await handle("跨周长度").count(),
      0,
      "Off-screen real end must not expose a continuation resize handle",
    );
    await clipboard(backup);
    await page.locator("#restore").click();
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    await page.locator("#confirmRestore").click();
    await page.locator("#restoreDialog").waitFor({ state: "hidden" });
    await chips("跨周长度").last().click();
    assert.equal(await page.locator("#agendaEndDateInput").inputValue(), end);
    // Touch must never start a resize, even if a synthetic pointer targets a handle.
    await page.evaluate((target) => {
      const button = document.querySelector("#agendaViewToggle");
      for (let i = 0; i < 3 && button.dataset.agendaView !== target; i++)
        button.click();
      if (button.dataset.agendaView !== target)
        throw Error("Agenda view did not change");
    }, "0");
    const touch = await handle("固定事项").evaluate((node) => {
      const r = node.getBoundingClientRect(),
        opts = {
          bubbles: true,
          pointerId: 90,
          pointerType: "touch",
          button: 0,
          clientX: r.left + 2,
          clientY: r.top + 5,
        };
      node.dispatchEvent(new PointerEvent("pointerdown", opts));
      document.dispatchEvent(
        new PointerEvent("pointermove", { ...opts, clientX: r.left + 40 }),
      );
      document.dispatchEvent(new PointerEvent("pointerup", opts));
      return !!document.querySelector(".agenda-drag-preview");
    });
    assert.equal(touch, false);
    // The same controller cancels resized sources changed or deleted externally.
    await page.evaluate(() => {
      window.resizeItems = [
        {
          id: "external",
          title: "external",
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
      window.resizeNotices = [];
      window.resizeSaves = 0;
      const calendar = document.createElement("div");
      calendar.id = "resizeHarness";
      calendar.style.cssText =
        "position:fixed;left:400px;top:150px;display:flex;width:400px;height:140px;z-index:20000;background:white;gap:10px";
      calendar.innerHTML =
        '<div class="day" data-date="2026-10-20" style="width:190px;height:140px"><div class="daytop">20</div><button class="agenda-chip" data-agenda-edit="external"><span class="agenda-chip-title">external</span><span class="agenda-resize-handle" data-agenda-resize="end"></span></button></div><div class="day" data-date="2026-10-21" style="width:190px;height:140px"><div class="daytop">21</div></div>';
      document.body.append(calendar);
      window.resizeHarness = WorkTimeApp.ui.createAgendaDrag({
        calendar,
        getState: () => ({
          active: true,
          busy: false,
          readOnly: false,
          transitioning: false,
          draft: false,
          items: window.resizeItems,
        }),
        settle() {},
        async save() {
          window.resizeSaves++;
          return true;
        },
        notify(text) {
          window.resizeNotices.push(text);
        },
      });
    });
    for (const remove of [false, true]) {
      const rect = await page
        .locator("#resizeHarness .agenda-resize-handle")
        .boundingBox();
      await page.mouse.move(rect.x + 4, rect.y + 5);
      await page.mouse.down();
      await page.mouse.move(650, 165, { steps: 8 });
      assert.ok(await page.locator(".agenda-resize-segment").count());
      await page.evaluate((remove) => {
        window.resizeItems = remove
          ? []
          : window.resizeItems.map((item) => ({ ...item, note: "changed" }));
        window.resizeHarness.refresh();
      }, remove);
      await page.mouse.up();
      assert.equal(await page.locator(".agenda-drag-preview").count(), 0);
    }
    assert.equal(await page.evaluate(() => window.resizeSaves), 0);
    assert.equal(await page.evaluate(() => window.resizeNotices.length), 2);
    await page.evaluate(() => {
      window.resizeHarness.dispose();
      document.querySelector("#resizeHarness").remove();
    });
    assert.deepEqual(errors, []);
    console.log(
      "Agenda end-resize domain, handles, previews, compact/lane reuse, date/time/midnight, cancellation, drafts, atomic failure, month/week/fortnight, persistence and touch exclusion verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
