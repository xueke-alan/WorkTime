"use strict";
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const { versionHtml } = require("./version-site.cjs");
const root = path.resolve(__dirname, "..");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
for (const directory of ["assets", "scripts", "tools"])
  for (const file of files(path.join(root, directory)))
    if (/\.(js|cjs)$/.test(file))
      acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: "latest" });
for (const entryPath of ["index.html", "tools/convert-backup.html"])
  versionHtml(fs.readFileSync(path.join(root, entryPath), "utf8"), root, {
    entryPath,
  });
console.log("JavaScript syntax and offline page dependencies verified.");
