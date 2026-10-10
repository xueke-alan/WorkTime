"use strict";
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const assert = require("node:assert/strict");
const postcss = require("postcss");
const { versionHtml } = require("./version-site.cjs");
const root = path.resolve(__dirname, "..");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
for (const directory of ["assets", "scripts", "tools"])
  for (const file of files(path.join(root, directory))) {
    if (/\.(js|cjs)$/.test(file))
      acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: "latest" });
    else if (/\.css$/.test(file))
      postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
  }
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
assert.equal(lock.version, manifest.version, "Lockfile version must match");
assert.equal(
  lock.packages?.[""]?.version,
  manifest.version,
  "Root package version must match",
);
assert.ok(
  fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .includes('<span id="siteVersion">v' + manifest.version + "</span>"),
  "Offline entry version must match package.json",
);
for (const entryPath of ["index.html", "tools/convert-backup.html"])
  versionHtml(fs.readFileSync(path.join(root, entryPath), "utf8"), root, {
    entryPath,
  });
console.log(
  "JavaScript/CSS syntax, release versions and offline page dependencies verified.",
);
