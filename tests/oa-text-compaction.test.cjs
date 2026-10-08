"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const realm = vm.createContext({ AbortController });
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    [
      "assets/js/services/application.js",
      "assets/js/storage.js",
      "assets/js/imports.js",
      "assets/js/services/import-index.js",
    ]
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n") +
    ";globalThis.C=DomainTest;globalThis.S=WorkTimeApp.services",
  realm,
);
const { C, S } = realm;
const plain = (value) => JSON.parse(JSON.stringify(value));
const blocks = [
  "10/08\n周四\n08:00\n18:00",
  "10/09\n星期五\n08:00",
  "10/10\n--",
  "10/11\n08:00\n12:00\n18:00",
  "10/12\n18:00\n08:00",
  "10/13\n周一\n08:00\n18:00",
  "02/30\n08:00\n18:00",
  "10/14\n25:70\n8：99\n08:00",
  "10/15\n25:70",
];
for (const block of blocks) {
  const noisy =
    "\uFEFF姓名：测试用户\r\n部门：研发\r\n" +
    block.split("\n").join("\r\n查看详情\r\n\r\n") +
    "\r\n退出登录";
  const compact = C.compactOAText(noisy);
  assert.equal(compact, block);
  assert.equal(C.compactOAText(compact), compact);
  const before = C.parseText(noisy, 2026, "clipboard");
  const after = C.parseText(compact, 2026, "clipboard");
  assert.deepEqual(plain(before.warnings), plain(after.warnings));
  const observations = (parsed) =>
    plain(parsed.records).map(({ raw, ...record }) => record);
  assert.deepEqual(observations(before), observations(after));
}
assert.equal(C.compactOAText("姓名\n08:00\n部门\n--"), "");
const raw = "姓名：测试\n" + blocks.join("\n菜单\n") + "\n退出";
const parsed = C.parseText(raw, 2026, "clipboard");
const log = {
  id: "old",
  at: "2026-10-15T00:00:00Z",
  year: 2026,
  sources: [{ name: "clipboard", raw }],
  records: parsed.records,
  count: parsed.records.length,
};
const original = C.defaultState();
original.imports.push(log);
for (const record of log.records) C.applyObservation(original, record, log.id);
const originalText = JSON.stringify(original);
const clean = C.compactOAState(C.validateBackup(original));
assert.equal(
  JSON.stringify(original),
  originalText,
  "Migration never mutates its input",
);
assert.deepEqual(plain(C.compactOAState(clean)), plain(clean));
assert.equal(clean.imports[0].sources[0].raw, blocks.join("\n"));
assert.equal(
  clean.imports[0].sources[0].raw.includes("10/11\n08:00\n12:00\n18:00"),
  true,
);
assert.deepEqual(plain(C.validateBackup(clean)), plain(clean));
assert.deepEqual(
  plain(C.summary(original, "2026-10-01", "2026-10-31")),
  plain(C.summary(clean, "2026-10-01", "2026-10-31")),
);
const index = S.importIndex.create({ core: C });
assert.deepEqual(
  plain(index.describe(clean.imports[0])),
  plain(index.describe(log)),
);
const plan = S.imports.prepare(
  C,
  original,
  [{ name: "clipboard", raw: "菜单\n10/08\n08:00\n20:00" }],
  2026,
);
assert.equal(plan.needsReview, true);
const rejected = {
  ...log,
  id: "rejected",
  sources: plan.sources,
  records: S.imports.acceptedRecords(plan, () => "old"),
  count: 0,
};

let disk = originalText,
  quota = true;
const persistence = S.storage.create({
  key: C.KEY,
  validate: C.validateBackup,
  defaultState: C.defaultState,
  getStorage: () => ({
    getItem: () => disk,
    setItem(key, text) {
      if (quota)
        throw Object.assign(Error("full"), { name: "QuotaExceededError" });
      disk = text;
    },
  }),
});
const loaded = persistence.load();
const owner = S.application.createState({
  state: loaded.state,
  persistence,
  core: C,
});
assert(owner.dirty);
assert.equal(owner.retry().code, "QUOTA_EXCEEDED");
assert.equal(disk, originalText);
assert.deepEqual(plain(owner.state), plain(clean));
quota = false;
assert(owner.retry().persisted);
assert.equal(owner.dirty, false);
assert.equal(JSON.stringify(JSON.parse(disk)), JSON.stringify(clean));
disk = JSON.stringify({ ...clean, oaUrl: "https://example.com/external" });
assert.equal(owner.importRecords(rejected).code, "EXTERNAL_UPDATE");
assert.equal(JSON.parse(disk).oaUrl, "https://example.com/external");
assert.equal(owner.state.imports.at(-1).records.length, 0);
assert.equal(owner.state.imports.at(-1).sources[0].raw, "10/08\n08:00\n20:00");
owner.reload(persistence.load().state);
assert(owner.restore(original).persisted);
assert.deepEqual(plain(owner.state), plain(clean));
assert.equal(JSON.stringify(original), originalText);
const exportText = JSON.stringify(owner.state, null, 2);
assert(owner.restore(JSON.parse(exportText)).persisted);
quota = true;
const snapshot = JSON.stringify(owner.state);
assert.equal(
  owner.restore({ ...original, oaUrl: "https://example.com/failed" }).persisted,
  false,
);
assert.equal(
  JSON.stringify(owner.state),
  snapshot,
  "Failed restore remains atomic",
);
quota = false;
const changed = plain(original);
changed.imports.push({
  ...plain(log),
  id: "new",
  records: C.parseText("10/08\n08:00\n20:00", 2026, "clipboard").records,
});
for (const record of changed.imports[1].records)
  C.applyObservation(changed, record, "new");
const compactChanged = C.compactOAState(changed);
C.deleteImport(changed, "new");
C.deleteImport(compactChanged, "new");
assert.deepEqual(plain(C.compactOAState(changed)), plain(compactChanged));

const year = C.defaultState();
for (let day = 0; day < 365; day++)
  for (let run = 0; run < 2; run++) {
    const core = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(Date.UTC(2026, 0, 1 + day - offset))
        .toISOString()
        .slice(5, 10)
        .replace("-", "/");
      return date + "\n08:00\n18:00";
    }).join("\n");
    const text =
      "姓名：测试\n部门：研发\n" +
      core.replaceAll("\n", "\n查看详情\n") +
      "\n退出登录";
    const records = C.parseText(text, 2026, "clipboard").records;
    assert.equal(records.length, 7);
    const entry = {
      ...log,
      id: `batch-${day}-${run}`,
      sources: [{ name: "clipboard", raw: text }],
      records,
      count: records.length,
    };
    year.imports.push(entry);
    for (const record of records) C.applyObservation(year, record, entry.id);
  }
const bytes = (state) => Buffer.byteLength(JSON.stringify(state, null, 2));
const compactYear = C.compactOAState(year);
assert.equal(compactYear.imports.length, 730);
assert(bytes(compactYear) < bytes(year));
console.log(
  `OA text compaction passed: evidence, parser parity, migration/retry/conflict, restore/replay; 730 noisy seven-day imports: ${bytes(year)} -> ${bytes(compactYear)} bytes.`,
);
