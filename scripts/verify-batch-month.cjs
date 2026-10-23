"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const realm = vm.createContext({});
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const [, file] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  if (
    file === "assets/js/namespace.js" ||
    file.startsWith("assets/js/domain/") ||
    /assets\/data\/(calendars|major-festivals|struggle-days)\.js/.test(file)
  )
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), realm);
}
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/services/application.js"),
    "utf8",
  ) + ";globalThis.W = WorkTimeApp;",
  realm,
);
const { W } = realm;
const D = W.domain;
const plain = (value) => JSON.parse(JSON.stringify(value));
const month = "2026-10";
const dates = ["2025-10-20", "2026-09-21", "2026-10-19", "2026-11-02"];
const record = { start: "08:00", end: "18:00", nextDay: false };
const initial = D.state.defaultState();
for (const date of dates) initial.days[date] = { estimate: record, note: date };
initial.days["2026-10-20"] = {
  oa: { ...record },
  actual: record,
  leaveMinutes: 120,
  extension: { keep: true },
};
initial.days["2026-10-21"] = { leaveMinutes: 1440, note: "full leave" };
initial.days["2026-10-11"] = { plannedOvertime: true, estimate: record };
initial.days["2026-10-18"] = { plannedOvertime: true };
async function verifyAutoSelection() {
  const state = plain(D.state.defaultState()),
    full = { ...record, effectiveMinutes: null },
    oa = (date, end) => ({
      date,
      start: "08:00",
      end,
      nextDay: false,
      status: end ? "complete" : "pending",
      source: "test",
      raw: "",
    });
  state.days = {
    "2026-10-20": { kind: "work", oa: oa("2026-10-20", "18:00") },
    "2026-10-21": { kind: "work", oa: oa("2026-10-21", "") },
    "2026-10-22": { kind: "work", oa: oa("2026-10-22", ""), actual: full },
    "2026-10-23": {
      kind: "work",
      leaveMinutes: state.settings.standardMinutes,
    },
    "2026-10-24": { kind: "rest" },
    "2026-10-26": { kind: "work", plannedOvertime: true },
    "2026-10-27": { kind: "work", draft: { ...full, end: "" } },
    "2026-10-28": { kind: "work", actual: full },
  };
  const expected = Array.from(
    { length: 31 },
    (_, index) => month + "-" + String(index + 1).padStart(2, "0"),
  ).filter(
    (date) =>
      D.schedule.canBatchEditDate(state, date) &&
      !D.records.complete(D.records.effectiveRecord(state.days[date], true)),
  );
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) => route.abort());
    await context.addInitScript((state) => {
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, state);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-23T04:00:00Z"));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const saved = await page.evaluate(() =>
      localStorage.getItem("worktime-local-v1"),
    );
    await page.locator("#batchToggle").click();
    await page.locator('.day[data-date="2026-10-20"]').click();
    const selected = () =>
      page
        .locator(".day.batchselected")
        .evaluateAll((cards) => cards.map((card) => card.dataset.date));
    await page.locator("#batchAutoSelect").click();
    assert.deepEqual(await selected(), expected);
    assert.ok(expected.includes("2026-10-21"));
    assert.ok(expected.includes("2026-10-27"));
    for (const day of ["20", "22", "23", "24", "26", "28"])
      assert.ok(!expected.includes(month + "-" + day));
    assert.ok(
      (await page.locator("#batchSelectionCount").textContent()).includes(
        String(expected.length),
      ),
    );
    await page.locator("#batchStart").fill("08:00");
    await page.locator("#batchEnd").fill("18:00");
    await page.locator("#batchAutoSelect").click();
    assert.deepEqual(
      await selected(),
      expected,
      "Selection uses original records during preview",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
      saved,
      "Selection must not persist preview data",
    );
    for (const width of [1365, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        const geometry = await page
          .locator("#batchAutoSelect")
          .evaluate((button) => {
            const bounds = button.getBoundingClientRect(),
              row = button.parentElement.getBoundingClientRect(),
              count = document
                .querySelector("#batchSelectionCount")
                .getBoundingClientRect();
            return {
              text: button.textContent,
              right: Math.abs(bounds.right - row.right),
              overlap: count.right > bounds.left,
              height: bounds.height,
            };
          });
        assert.ok(geometry.text && !geometry.text.includes("batch.autoSelect"));
        assert.ok(geometry.right < 2);
        assert.equal(geometry.overlap, false);
        assert.ok(geometry.height <= 34);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

async function verify() {
  const before = plain(initial);
  for (const reset of ["none", "selected", "all"]) {
    const draft = { month, dates, record, reset };
    const preview = D.batch.applyBatchChanges(initial, draft);
    for (const date of dates.filter((date) => !date.startsWith(month)))
      assert.equal(preview.days[date], initial.days[date]);
    assert.deepEqual(plain(initial), before, "Preview must not mutate storage");
    let allow = false;
    const owner = W.services.application.createState({
      state: initial,
      core: {},
      persistence: { commit: async () => ({ persisted: allow }) },
    });
    assert.equal((await owner.confirmBatch(draft)).persisted, false);
    assert.deepEqual(plain(owner.state), before);
    allow = true;
    assert.equal((await owner.confirmBatch(draft)).persisted, true);
    assert.deepEqual(plain(owner.state), plain(preview));
  }
  const reset = D.batch.applyBatchChanges(initial, { month, reset: "all" });
  assert.equal(
    D.batch.applyBatchChanges(initial, {
      month,
      dates: [null, undefined, 123, "invalid"],
      record,
    }),
    initial,
    "Invalid selected dates must be ignored before checking month membership",
  );
  assert.equal(reset.days["2026-10-19"], undefined);
  assert.deepEqual(plain(reset.days["2026-10-21"]), { leaveMinutes: 1440 });
  assert.deepEqual(plain(reset.days["2026-10-11"]), { plannedOvertime: true });
  assert.equal(reset.days["2026-10-18"], initial.days["2026-10-18"]);
  assert.deepEqual(plain(reset.days["2026-10-20"]), {
    oa: record,
    leaveMinutes: 120,
    extension: { keep: true },
  });
  for (const invalid of [undefined, "2026-13", "2026-1"])
    assert.throws(
      () =>
        D.batch.applyBatchChanges(initial, { month: invalid, reset: "all" }),
      /Invalid batch month/,
    );
  const owner = W.services.application.createState({
    state: initial,
    core: {},
    persistence: { commit: async () => ({ persisted: true }) },
  });
  assert.throws(() => owner.resetBatch(null), /Invalid batch month/);
  await owner.resetBatch(null, month);
  assert.deepEqual(plain(owner.state), plain(reset));
  for (const date of ["2026-10-20", "2026-10-21", "2026-10-11"]) {
    const single = W.services.application.createState({
      state: initial,
      core: {},
      persistence: { commit: async () => ({ persisted: true }) },
    });
    await single.resetDay(date);
    assert.deepEqual(plain(single.state.days[date]), plain(reset.days[date]));
    const draft = { month, dates: [date], reset: "selected" };
    const preview = D.batch.applyBatchChanges(initial, draft);
    const batch = W.services.application.createState({
      state: initial,
      core: {},
      persistence: { commit: async () => ({ persisted: true }) },
    });
    await batch.confirmBatch(draft);
    assert.deepEqual(plain(batch.state), plain(preview));
    assert.deepEqual(
      plain(preview.days[date]),
      plain(
        D.schedule.canBatchEditDate(initial, date)
          ? reset.days[date]
          : initial.days[date],
      ),
    );
    for (const other of Object.keys(initial.days).filter((key) => key !== date))
      assert.deepEqual(plain(preview.days[other]), plain(initial.days[other]));
  }
  const plannedDate = "2026-10-11";
  const cancelState = D.state.defaultState();
  cancelState.days[plannedDate] = {
    plannedOvertime: true,
    leaveMinutes: 60,
    oa: record,
    actual: record,
    estimate: record,
    draft: { start: "09:00" },
    kind: "rest",
    note: "clear me",
    sourcePriority: "manual",
    extension: { keep: true },
  };
  let writes = 0;
  let allowCancel = false;
  const cancel = W.services.application.createState({
    state: cancelState,
    core: {},
    persistence: {
      commit: async () => {
        writes++;
        return { persisted: allowCancel };
      },
    },
  });
  assert.equal((await cancel.cancelPlanned(plannedDate)).persisted, false);
  assert.equal(writes, 1, "Cancellation and reset use one save");
  assert.equal(cancel.dirty, true);
  assert.deepEqual(plain(cancel.state.days[plannedDate]), {
    leaveMinutes: 60,
    oa: record,
    extension: { keep: true },
  });
  allowCancel = true;
  assert.equal((await cancel.retry()).persisted, true);
  assert.equal(cancel.dirty, false);
  await owner.cancelPlanned("2026-10-18");
  assert.equal(owner.state.days["2026-10-18"], undefined);
  await verifyAutoSelection();
  console.log(
    "Batch month verified: preview, fill, selected/all reset, failed save and atomic confirmation preserve other months.",
  );
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
