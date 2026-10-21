"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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
  extension: { keep: true },
};
initial.days["2026-10-21"] = { leaveMinutes: 1440, note: "full leave" };
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
  assert.equal(reset.days["2026-10-21"], undefined);
  assert.deepEqual(plain(reset.days["2026-10-20"]), {
    oa: record,
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
  console.log(
    "Batch month verified: preview, fill, selected/all reset, failed save and atomic confirmation preserve other months.",
  );
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
