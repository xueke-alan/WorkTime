"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { root, manifest } = require("./test-manifest.cjs");
const groups = manifest();
const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(JSON.stringify(groups, null, 2));
  process.exit(0);
}
const selected = args.includes("--all")
  ? ["syntax", "quality", "unit", "python", "browser", "styles", "resources"]
  : args.length
    ? args.map((arg) => arg.replace(/^--/, ""))
    : ["unit"];
for (const group of selected)
  if (!(group in groups) && group !== "quality")
    throw Error(`Unknown test group: ${group}`);
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
// Test execution may write results, but cannot silently replace evidence.
function protectedArtifacts() {
  function files(directory) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? files(file) : [file];
      });
  }
  return new Map(
    ["docs", "tests/fixtures"].flatMap((directory) =>
      files(path.join(root, directory)).map((file) => [
        path.relative(root, file),
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]),
    ),
  );
}
const protectedBefore = protectedArtifacts();
const results = [];
function run(group, file, command, parameters) {
  console.log(`${group.toUpperCase()} ${file}`);
  const started = Date.now();
  const result = spawnSync(command, parameters, {
    cwd: root,
    stdio: "inherit",
    timeout: 600000,
  });
  if (result.error) console.error(result.error);
  results.push({
    group,
    file,
    ok: !result.error && result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    elapsedMs: Date.now() - started,
  });
  fs.writeFileSync(
    path.join(output, "checks.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
for (const group of selected) {
  if (group === "quality") {
    run(group, "eslint", process.execPath, [
      "node_modules/eslint/bin/eslint.js",
      "assets/js",
      "scripts",
      "tests",
      "tools",
      "eslint.config.cjs",
      "--max-warnings",
      "0",
    ]);
    run(group, "prettier", process.execPath, [
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
      "assets/js/**/*.js",
      "scripts/**/*.cjs",
      "tests/**/*.cjs",
      "tools/**/*.js",
      "eslint.config.cjs",
    ]);
  } else if (group === "python") {
    for (const file of groups.python)
      run(group, file, process.env.WORKTIME_PYTHON || "python", [
        "-m",
        "unittest",
        "discover",
        "-s",
        path.dirname(file),
        "-p",
        path.basename(file),
      ]);
  } else {
    for (const file of groups[group])
      run(group, file, process.execPath, [
        ...(group === "syntax" ? ["--check"] : []),
        file,
      ]);
  }
}
const protectedAfter = protectedArtifacts();
const changedArtifacts = [
  ...new Set([...protectedBefore.keys(), ...protectedAfter.keys()]),
].filter((file) => protectedBefore.get(file) !== protectedAfter.get(file));
results.push({
  group: "artifacts",
  file: "docs and tests/fixtures remain unchanged",
  ok: changedArtifacts.length === 0,
  changedFiles: changedArtifacts,
});
fs.writeFileSync(
  path.join(output, "checks.json"),
  JSON.stringify(results, null, 2) + "\n",
);
if (changedArtifacts.length)
  console.error("Protected evidence changed during tests:", changedArtifacts);
const failures = results.filter((result) => !result.ok);
console.log(`${results.length} checks; ${failures.length} failures`);
for (const result of failures) console.log(`FAILED ${result.file}`);
process.exitCode = failures.length ? 1 : 0;
