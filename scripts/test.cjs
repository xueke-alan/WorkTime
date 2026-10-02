"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const syntax = process.argv.includes("--syntax");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const targets = syntax
  ? ["assets", "scripts", "tests"]
      .flatMap((dir) => files(path.join(root, dir)))
      .filter((file) => /\.(?:js|cjs)$/.test(file))
      .concat(path.join(root, "eslint.config.cjs"))
  : files(path.join(root, "tests")).filter((file) => /\.test\.cjs$/.test(file));
let failures = 0;
for (const file of targets.sort()) {
  console.log(`${syntax ? "CHECK" : "TEST"} ${path.relative(root, file)}`);
  const run = spawnSync(
    process.execPath,
    [...(syntax ? ["--check"] : []), file],
    { cwd: root, stdio: "inherit" },
  );
  if (run.error || run.status !== 0) {
    failures++;
    if (run.error) console.error(run.error);
  }
}
console.log(`${targets.length} files; ${failures} failures`);
process.exitCode = failures ? 1 : 0;
