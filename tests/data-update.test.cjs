"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { create, validateDates, recover } = require("../scripts/data-update.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "worktime-data-update-")),
  project = path.resolve(__dirname, ".."),
  relative = "assets/data/international-festivals.js";
fs.mkdirSync(path.join(root, "assets/data/history"), { recursive: true });
for (const file of [
  "sources.js",
  "international-festivals.js",
  ...Array.from(
    { length: 12 },
    (_, i) => "history/" + String(i + 1).padStart(2, "0") + ".js",
  ),
])
  fs.copyFileSync(
    path.join(project, "assets/data", file),
    path.join(root, "assets/data", file),
  );
const context = vm.createContext({
  WorkTimeApp: { data: { dateInfo: { history: {}, festivals: [] } } },
});
context.window = context;
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/data/sources.js"), "utf8"),
  context,
);
vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context);
for (let month = 1; month <= 12; month++)
  vm.runInContext(
    fs.readFileSync(
      path.join(
        root,
        "assets/data/history",
        String(month).padStart(2, "0") + ".js",
      ),
      "utf8",
    ),
    context,
  );
validateDates(context.WorkTimeApp.data.dateInfo.history, "history");
validateDates(
  context.WorkTimeApp.data.dateInfo.internationalByDate,
  "internationalFestivals",
);
assert.throws(() => validateDates({}, "history"), /366/);
const original = fs.readFileSync(path.join(root, relative), "utf8"),
  beforeSources = fs.readFileSync(
    path.join(root, "assets/data/sources.js"),
    "utf8",
  ),
  next = original + "\n/* local transaction validation */\n";
const dry = create({
  kind: "internationalFestivals",
  root,
  now: new Date("2026-10-02T01:00:00Z"),
});
dry.write(relative, next);
assert.equal(dry.commit({ dryRun: true }).committed, false);
assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), original);
const failing = create({ kind: "internationalFestivals", root });
failing.write(relative, next);
const rename = fs.renameSync;
fs.renameSync = (source, destination) => {
  if (destination === path.join(root, "assets/data/sources.js"))
    throw Error("Injected replacement failure");
  return rename(source, destination);
};
try {
  assert.throws(() => failing.commit(), /Injected/);
} finally {
  fs.renameSync = rename;
}
assert.equal(
  fs.readFileSync(path.join(root, relative), "utf8"),
  original,
  "failed group restores first asset",
);
assert.equal(
  fs.readFileSync(path.join(root, "assets/data/sources.js"), "utf8"),
  beforeSources,
);
const success = create({
  kind: "internationalFestivals",
  root,
  now: new Date("2026-10-02T01:00:00Z"),
});
success.write(relative, next);
assert.equal(success.commit().committed, true);
const after = vm.createContext({
  WorkTimeApp: { data: { dateInfo: { history: {}, festivals: [] } } },
});
after.window = after;
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/data/sources.js"), "utf8"),
  after,
);
assert.equal(after.WorkTimeApp.data.dateInfo.sources.updated, "2026-10-02");
assert.equal(
  after.WorkTimeApp.data.dateInfo.sources.internationalFestivals.updated,
  "2026-10-02",
);
assert.equal(
  after.WorkTimeApp.data.dateInfo.sources.history.license,
  context.WorkTimeApp.data.dateInfo.sources.history.license,
);
const interrupted = create({ kind: "internationalFestivals", root });
interrupted.write(relative, original);
interrupted.commit({ dryRun: true });
const manifestPath = path.join(interrupted.directory, "manifest.json"),
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.status = "committing";
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
fs.writeFileSync(path.join(root, relative), original);
assert.throws(() => create({ kind: "history", root }), /Recover/);
recover(manifest.id, root);
assert.equal(
  fs.readFileSync(path.join(root, relative), "utf8"),
  next,
  "recovery restores transaction input",
);
const changed = create({ kind: "internationalFestivals", root });
changed.write(relative, original);
fs.appendFileSync(path.join(root, relative), "\n/* external change */");
assert.throws(() => changed.commit(), /changed during download/);
assert.throws(() => create({ kind: "unknown", root }), /Unknown/);
console.log(
  "data-update: complete local data validation, dry-run, rollback, commit metadata, interrupted recovery and external-change guard passed",
);
// Preserve the small isolated directory for diagnosis; no recursive deletion is needed.
