"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { bundleSite } = require("./bundle-site.cjs");
const { versionSite } = require("./version-site.cjs");
const root = path.resolve(__dirname, "..");
const site = path.join(root, "_site");
// Only this fixed generated directory may be replaced.
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site);
for (const entry of [
  "index.html",
  "rescue.html",
  "assets",
  "licenses",
  "tools",
  "data",
]) {
  const source = path.join(root, entry);
  if (entry === "data" && !fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(site, entry), { recursive: true });
}
bundleSite(site);
versionSite(site);
fs.writeFileSync(path.join(site, ".nojekyll"), "");
console.log("Prepared _site for GitHub Pages.");
