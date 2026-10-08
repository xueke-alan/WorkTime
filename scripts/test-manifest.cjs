"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
function manifest() {
  const tests = files(path.join(root, "tests"));
  const groups = {
    unit: [],
    browser: [],
    styles: [],
    resources: [],
    python: [],
  };
  for (const absolute of tests.sort()) {
    const file = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (/\.test\.cjs$/.test(file)) groups.unit.push(file);
    else if (/\.browser\.cjs$/.test(file)) {
      const group = /(?:-styles|style-contract)\.browser/.test(file)
        ? "styles"
        : /icons-offline\.browser/.test(file)
          ? "resources"
          : "browser";
      groups[group].push(file);
    } else if (/\/test_[^/]+\.py$/.test(file)) groups.python.push(file);
  }
  groups.syntax = ["assets", "scripts", "tests", "tools"]
    .flatMap((dir) => files(path.join(root, dir)))
    .filter((file) => /\.(?:js|cjs)$/.test(file))
    .map((file) => path.relative(root, file))
    .concat("eslint.config.cjs")
    .sort();
  return groups;
}
module.exports = { root, manifest };
