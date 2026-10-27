"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1100 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-18T04:00:00Z"));
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
    const statuses = ["pending", "completed", "in-progress", "cancelled"];
    const trigger = (id) =>
      page.locator(`#agendaList [data-agenda-status="${id}"]`);
    const choice = (status) =>
      page.locator(`[data-agenda-status-choice="${status}"]`);
    async function change(id, status) {
      await trigger(id).click();
      await choice(status).click();
      await page.waitForFunction(
        ({ id, status }) =>
          document.querySelector(`#agendaList [data-agenda-status="${id}"]`)
            ?.dataset.status === status &&
          !document.querySelector("#agendaFields").disabled,
        { id, status },
      );
    }
    for (const status of statuses) {
      await page.locator("#agendaNew").click();
      assert.equal(
        await page.locator("#agendaItemStatus").inputValue(),
        "pending",
      );
      await page.locator("#agendaTitle").fill("State " + status);
      await page.locator("#agendaItemStatus").selectOption(status);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, "2026-10-18", "2026-10-21");
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    }
    const ids = await page
      .locator("#agendaList [data-agenda-status]")
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [node.dataset.status, node.dataset.agendaStatus]),
        ),
      );
    assert.equal(
      await page.locator("#agendaOverview [data-agenda-jump]").count(),
      2,
    );
    await trigger(ids.pending).click();
    assert.equal(await choice("pending").getAttribute("aria-checked"), "true");
    assert.equal(
      await page.evaluate(
        () => document.activeElement.dataset.agendaStatusChoice,
      ),
      "pending",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(
        () => document.activeElement.dataset.agendaStatusChoice,
      ),
      "completed",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(
        () => document.activeElement.dataset.agendaStatusChoice,
      ),
      "cancelled",
    );
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.evaluate(
        () => document.activeElement.dataset.agendaStatusChoice,
      ),
      "cancelled",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.agendaStatus),
      ids.pending,
    );
    await trigger(ids.pending).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-agenda-status="${id}"]`)?.dataset
          .status === "completed",
      ids.pending,
    );
    await change(ids.pending, "pending");
    // A failed status write must leave both the old state and an error visible.
    await page.evaluate(() => {
      window.originalAgendaStore = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (...args) {
        if (this.mode === "readwrite")
          throw new DOMException("Test write failure", "QuotaExceededError");
        return window.originalAgendaStore.apply(this, args);
      };
    });
    await trigger(ids.pending).click();
    await choice("cancelled").click();
    await page.waitForFunction(
      () =>
        !!document.querySelector("#agendaError").textContent &&
        !document.querySelector("#agendaFields").disabled,
    );
    assert.equal(
      await trigger(ids.pending).getAttribute("data-status"),
      "pending",
    );
    await page.evaluate(() => {
      IDBTransaction.prototype.objectStore = window.originalAgendaStore;
    });
    await page.reload();
    await ready();
    for (const status of statuses)
      assert.equal(
        await trigger(ids[status]).getAttribute("data-status"),
        status,
      );
    // Inspect actual exported records, then decode legacy and new archives.
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.agendaStatusBackup = value;
          },
        },
      }),
    );
    await page.locator("#backup").click();
    await page.waitForFunction(() => !!window.agendaStatusBackup);
    const result = await page.evaluate(async () => {
      await Promise.all(
        ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"].map((id) =>
          WorkTimeApp.i18n.loadLanguage(id),
        ),
      );
      const A = WorkTimeApp.services.archive;
      const doc = await WorkTimeApp.services.backup.decode(
        window.agendaStatusBackup,
        (value) => value,
      );
      const state = A.decode(doc.work);
      const legacy = structuredClone(doc.work);
      for (const row of legacy.modules.find(
        (module) => module.id === A.ids.agenda,
      ).records)
        delete row.data.status;
      const invalid = structuredClone(doc.work);
      invalid.modules.find(
        (module) => module.id === A.ids.agenda,
      ).records[0].data.status = "unknown";
      let rejected = false;
      try {
        A.decode(invalid);
      } catch {
        rejected = true;
      }
      const rules = WorkTimeApp.domain.agenda;
      return {
        items: state.agenda,
        roundTrip: A.decode(A.encode(state)).agenda,
        legacy: A.decode(legacy).agenda,
        rejected,
        moves: state.agenda.map((item) => rules.move(item, 2)),
        resized: state.agenda.map((item) =>
          rules.resizeEnd(item, "2026-10-23"),
        ),
        synced: state.agenda.map((item) =>
          rules.validate({ ...item, completed: !item.completed }),
        ),
        translations: Object.values(WorkTimeApp.data.locales).map((locale) => [
          locale["agenda.status"],
          locale["agenda.changeStatus"],
          locale["agenda.statusInProgress"],
          locale["agenda.statusCancelled"],
        ]),
      };
    });
    assert.deepEqual(
      result.items.map((item) => item.status),
      statuses,
    );
    assert.deepEqual(result.roundTrip, result.items);
    assert.equal(result.rejected, true);
    for (const key of ["moves", "resized", "synced"]) {
      assert.deepEqual(
        result[key].map((item) => item.status),
        statuses,
      );
      assert.ok(
        result[key].every(
          (item) => item.completed === (item.status === "completed"),
        ),
      );
    }
    assert.deepEqual(
      result.legacy.map((item) => item.status),
      ["pending", "completed", "pending", "pending"],
    );
    assert.equal(result.translations.length, 6);
    assert.ok(
      result.translations
        .flat()
        .every((label) => typeof label === "string" && label.length),
    );
    // Editing a cancelled item keeps its state and detects state-only drafts.
    await page
      .locator(`#agendaList [data-agenda-edit="${ids.cancelled}"]`)
      .click();
    assert.equal(
      await page.locator("#agendaItemStatus").inputValue(),
      "cancelled",
    );
    await page.locator("#agendaItemStatus").selectOption("pending");
    assert.equal(await page.locator("#agendaDraft").isVisible(), true);
    await page.locator("#agendaItemStatus").selectOption("cancelled");
    await page.locator("#agendaTitle").fill("Edited cancelled");
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    assert.equal(
      await trigger(ids.cancelled).getAttribute("data-status"),
      "cancelled",
    );
    for (const status of statuses.slice(0, 3))
      await change(ids[status], "cancelled");
    assert.equal(
      await page.locator("#agendaOverview [data-agenda-jump]").count(),
      0,
    );
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger(ids.pending).click();
    const box = await page.locator("#agendaStatusMenu").boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.x + box.width <= 390 &&
        box.y >= 0 &&
        box.y + box.height <= 844,
    );
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1480, height: 1100 });
    for (const status of statuses.slice(0, 3))
      await change(ids[status], status);
    await page.screenshot({
      path: path.resolve("artifacts/agenda-four-states.png"),
      fullPage: true,
    });
    console.log(
      "Four states: create/edit/menu/keyboard, atomic write failure, reload, legacy and backup, move/resize preservation, cancellation, six languages and mobile menu verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
