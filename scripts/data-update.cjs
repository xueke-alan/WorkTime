"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  vm = require("node:vm");
const project = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function target(root, relative) {
  if (
    !/^assets\/data\/(?:sources\.js|international-festivals\.js|history\/(?:0[1-9]|1[0-2])\.js)$/.test(
      relative,
    )
  )
    throw Error("Invalid data target: " + relative);
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep))
    throw Error("Target escapes project");
  return file;
}
function journal(directory, manifest) {
  const temporary = path.join(directory, "manifest.tmp");
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2));
  fs.renameSync(temporary, path.join(directory, "manifest.json"));
}
function withLock(root, action) {
  const lock = path.join(root, ".refactor-data-updates", "writer.lock");
  const fd = fs.openSync(lock, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    return action();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
function validateDates(days, kind) {
  const expected = [];
  for (let month = 1; month <= 12; month++)
    for (let day = 1; day <= new Date(2024, month, 0).getDate(); day++)
      expected.push(
        String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
      );
  if (JSON.stringify(Object.keys(days).sort()) !== JSON.stringify(expected))
    throw Error("Data must cover exactly all 366 calendar dates");
  for (const [date, items] of Object.entries(days)) {
    if (
      !Array.isArray(items) ||
      (kind === "history" && (items.length < 3 || items.length > 5))
    )
      throw Error("Invalid records at " + date);
    const ids = new Set();
    for (const item of items) {
      if (!item.id || ids.has(item.id) || !item.sourceName)
        throw Error("Invalid identity at " + date);
      ids.add(item.id);
      if (kind === "history") {
        if (
          !Number.isInteger(item.year) ||
          item.year > 2025 ||
          typeof item.text !== "string" ||
          item.text.length < 12
        )
          throw Error("Invalid history event at " + date);
      } else if (
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.category !== "international"
      )
        throw Error("Invalid observance at " + date);
      const source = new URL(item.sourceUrl);
      if (
        source.protocol !== "https:" ||
        source.hostname !== "zh.wikipedia.org" ||
        !/^\d+$/.test(source.searchParams.get("oldid") || "")
      )
        throw Error("Missing revision source at " + date);
      if (kind !== "history" && new URL(item.url).protocol !== "https:")
        throw Error("Invalid observance URL");
    }
  }
}
function rollback(root, directory, manifest) {
  for (const entry of [...manifest.files].reverse()) {
    const file = target(root, entry.path),
      current = hash(fs.readFileSync(file));
    if (current === entry.before) continue;
    if (current !== entry.after)
      throw Error("External change prevents rollback: " + entry.path);
    if (!/^before-\d+\.js$/.test(entry.backup))
      throw Error("Invalid backup path");
    const backup = path.join(directory, entry.backup);
    if (hash(fs.readFileSync(backup)) !== entry.before)
      throw Error("Backup checksum mismatch");
    const temporary = path.join(
      directory,
      "restore-" + path.basename(entry.backup),
    );
    fs.copyFileSync(backup, temporary);
    fs.renameSync(temporary, file);
  }
  manifest.status = "rolled-back";
  journal(directory, manifest);
}
function create({ kind, root = project, now = new Date() }) {
  if (!["history", "internationalFestivals"].includes(kind))
    throw Error("Unknown data kind");
  root = path.resolve(root);
  const storage = path.join(root, ".refactor-data-updates");
  fs.mkdirSync(storage, { recursive: true });
  for (const name of fs.readdirSync(storage)) {
    const file = path.join(storage, name, "manifest.json");
    if (
      fs.existsSync(file) &&
      ["committing", "rollback-failed"].includes(
        JSON.parse(fs.readFileSync(file, "utf8")).status,
      )
    )
      throw Error(
        "Recover interrupted update first: node scripts/data-update.cjs --recover " +
          name,
      );
  }
  const date = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10),
    id =
      kind.toLowerCase() +
      "-" +
      Date.now() +
      "-" +
      crypto.randomBytes(4).toString("hex"),
    directory = path.join(storage, id),
    manifest = { id, kind, date, status: "downloading", files: [] },
    originals = new Map();
  fs.mkdirSync(directory);
  const targets =
    kind === "history"
      ? Array.from(
          { length: 12 },
          (_, i) =>
            "assets/data/history/" + String(i + 1).padStart(2, "0") + ".js",
        )
      : ["assets/data/international-festivals.js"];
  targets.push("assets/data/sources.js");
  for (const relative of targets)
    originals.set(relative, fs.readFileSync(target(root, relative)));
  journal(directory, manifest);
  function write(relative, content) {
    if (!originals.has(relative))
      throw Error("Unexpected update file " + relative);
    new vm.Script(content, { filename: relative });
    const index = manifest.files.length,
      staged = "new-" + index + ".js",
      backup = "before-" + index + ".js";
    if (manifest.files.some((entry) => entry.path === relative))
      throw Error("Duplicate update file");
    fs.writeFileSync(path.join(directory, staged), content);
    fs.writeFileSync(path.join(directory, backup), originals.get(relative));
    manifest.files.push({
      path: relative,
      staged,
      backup,
      before: hash(originals.get(relative)),
      after: hash(content),
    });
    journal(directory, manifest);
  }
  function commit({ dryRun = false } = {}) {
    const stagedContext = vm.createContext({
      DateInfoData: { history: {}, festivals: [] },
    });
    stagedContext.window = stagedContext;
    for (const entry of manifest.files)
      vm.runInContext(
        fs.readFileSync(path.join(directory, entry.staged), "utf8"),
        stagedContext,
        { timeout: 1000 },
      );
    validateDates(
      kind === "history"
        ? stagedContext.DateInfoData.history
        : stagedContext.DateInfoData.internationalByDate,
      kind,
    );
    const context = vm.createContext({});
    context.window = context;
    vm.runInContext(
      originals.get("assets/data/sources.js").toString(),
      context,
      { timeout: 1000 },
    );
    const sources = JSON.parse(JSON.stringify(context.DateInfoData.sources));
    sources.updated = date;
    sources[kind] = {
      ...(sources[kind] || {
        name: sources.history.name,
        url: sources.history.url,
        license: sources.history.license,
        api: sources.history.api,
      }),
      version: (sources[kind]?.version || 0) + 1,
      updated: date,
      coverageDays: 366,
      ...(kind === "history" ? { eventThroughYear: 2025 } : {}),
      artifacts: manifest.files.map((entry) => ({
        path: entry.path,
        sha256: entry.after,
      })),
    };
    write(
      "assets/data/sources.js",
      "window.DateInfoData=window.DateInfoData||{history:{},festivals:[]};\nDateInfoData.sources=" +
        JSON.stringify(sources) +
        ";\n",
    );
    if (manifest.files.length !== targets.length)
      throw Error("Incomplete update files");
    manifest.status = "validated";
    journal(directory, manifest);
    if (dryRun) return { directory, committed: false };
    return withLock(root, () => {
      for (const entry of manifest.files)
        if (hash(fs.readFileSync(target(root, entry.path))) !== entry.before)
          throw Error("Data changed during download: " + entry.path);
      for (const entry of manifest.files)
        if (
          hash(fs.readFileSync(path.join(directory, entry.staged))) !==
          entry.after
        )
          throw Error("Staged file checksum mismatch: " + entry.path);
      manifest.status = "committing";
      journal(directory, manifest);
      try {
        for (const entry of manifest.files) {
          const file = target(root, entry.path),
            temporary = path.join(directory, "commit-" + entry.staged);
          fs.copyFileSync(path.join(directory, entry.staged), temporary);
          fs.renameSync(temporary, file);
        }
        manifest.status = "committed";
        journal(directory, manifest);
      } catch (error) {
        try {
          rollback(root, directory, manifest);
        } catch (recoveryError) {
          manifest.status = "rollback-failed";
          journal(directory, manifest);
          throw new AggregateError(
            [error, recoveryError],
            "Update failed; recover " + id,
          );
        }
        throw error;
      }
      return { directory, committed: true };
    });
  }
  return {
    date,
    directory,
    write,
    commit,
    capture(name, response) {
      if (!/^batch-\d+$/.test(name)) throw Error("Invalid batch name");
      fs.writeFileSync(
        path.join(directory, name + ".json"),
        JSON.stringify(response),
      );
    },
  };
}
function recover(id, root = project) {
  if (!/^[a-z0-9-]+$/.test(id)) throw Error("Invalid update id");
  const directory = path.join(root, ".refactor-data-updates", id),
    manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
  if (
    manifest.id !== id ||
    !["validated", "committing", "rollback-failed"].includes(manifest.status)
  )
    throw Error("Update does not need recovery");
  const lock = path.join(root, ".refactor-data-updates", "writer.lock");
  if (fs.existsSync(lock)) {
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
    }
    if (alive) throw Error("Updater process is still active: " + owner.pid);
    fs.unlinkSync(lock);
  }
  withLock(root, () => rollback(root, directory, manifest));
}
module.exports = { create, validateDates, recover };
if (require.main === module) {
  try {
    if (process.argv[2] !== "--recover" || !process.argv[3])
      throw Error("Usage: node scripts/data-update.cjs --recover <id>");
    recover(process.argv[3]);
    console.log("Interrupted data update rolled back");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
