"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const context = vm.createContext({});
for (const name of ["clipboard", "downloads", "application", "clock"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../assets/js/services", name + ".js"),
      "utf8",
    ),
    context,
  );
const clipboard = vm.runInContext("WorkClipboard", context),
  downloads = vm.runInContext("WorkDownloads", context),
  application = vm.runInContext("WorkApplication", context);
const clocks = vm.runInContext("WorkClock", context);
(async () => {
  let source = {
    text: "old",
    readText() {
      return this.text;
    },
    writeText(text) {
      this.text = text;
    },
  };
  const adapter = clipboard.create(() => source);
  assert.equal(await adapter.readText(), "old");
  await adapter.writeText("new");
  assert.equal(source.text, "new");
  source = {
    readText() {
      throw Object.assign(Error("denied"), { name: "NotAllowedError" });
    },
  };
  await assert.rejects(adapter.readText(), { name: "NotAllowedError" });
  source = null;
  await assert.rejects(adapter.readText(), /不支持读取/);
  await assert.rejects(adapter.writeText("a"), /不支持写入/);
  const revoked = [],
    pending = new Map(),
    canceled = [];
  let clicks = 0,
    sequence = 0,
    fail = false;
  const service = downloads.create({
    document: {
      createElement() {
        return {
          click() {
            if (fail) throw Error("click failed");
            clicks++;
          },
        };
      },
    },
    Blob,
    URL: {
      createObjectURL() {
        return "blob:" + ++sequence;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    schedule(fn) {
      pending.set(sequence, fn);
      return sequence;
    },
    cancel(id) {
      canceled.push(id);
      pending.delete(id);
    },
  });
  service.download("one.json", "{}", "application/json");
  assert.equal(clicks, 1);
  pending.get(1)();
  pending.delete(1);
  assert.deepEqual(revoked, ["blob:1"]);
  service.download("two.json", "{}", "application/json");
  service.dispose();
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  assert.deepEqual(canceled, [2]);
  service.dispose();
  assert.equal(revoked.length, 2, "Dispose is idempotent");
  fail = true;
  assert.throws(
    () => service.download("fail.json", "{}", "application/json"),
    /click failed/,
  );
  assert.deepEqual(revoked, ["blob:1", "blob:2", "blob:3"]);
  const first = application.create({
    state: { days: {} },
    writable: false,
    readError: null,
    corrupt: false,
    today: "2026-10-02",
  });
  const second = application.create({
    state: { days: {} },
    writable: true,
    readError: null,
    corrupt: false,
    today: "2026-10-02",
  });
  first.batchDays.add("2026-10-01");
  assert.equal(second.batchDays.size, 0);
  assert.equal(first.storageFailed, true);
  assert.equal(second.storageFailed, false);
  const instant = vm.runInContext("new Date('2026-12-31T23:59:59Z')", context);
  const clock = clocks.create({
    now: () => instant,
    dateKey: (value) => value.toISOString().slice(0, 10),
  });
  assert.equal(clock.today(), "2026-12-31");
  assert.equal(clock.year(), 2026);
  const copy = clock.now();
  copy.setUTCFullYear(2000);
  assert.equal(clock.year(), 2026, "Clock callers cannot mutate injected time");
  instant.setTime(instant.getTime() + 1000);
  assert.equal(clock.today(), "2027-01-01");
  assert.equal(clock.year(), 2027);
  assert.throws(
    () => clocks.create({ now: () => null, dateKey: () => "" }).now(),
    /无效时间/,
  );
  console.log(
    "Platform services passed: live clipboard adapter, permission/missing API errors, blob revocation on success/failure/dispose and isolated application models.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
