"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { versionHtml } = require("../scripts/version-site.cjs");
const root = path.resolve(__dirname, "..");
const original = fs.readFileSync(path.join(root, "index.html"), "utf8");
const output = versionHtml(original, root);
assert.equal(versionHtml(output, root), output);
let count = 0;
for (const [, asset, hash] of output.matchAll(
  /(?:src|href)="(assets\/[^"?]+)\?v=([a-f0-9]{16})"/g,
)) {
  assert.equal(
    hash,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, asset)))
      .digest("hex")
      .slice(0, 16),
  );
  count++;
}
assert.equal(
  count,
  [...original.matchAll(/(?:src|href)="assets\/[^"?]+"/g)].length,
);
assert(count > 50);
assert(output.includes('href="data:image/svg+xml,'));
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "worktime-site-version-"),
);
try {
  fs.mkdirSync(path.join(temporary, "assets"));
  const file = path.join(temporary, "assets", "example.js");
  const html = '<script src="assets/example.js"></script>';
  fs.writeFileSync(file, "old");
  const before = versionHtml(html, temporary);
  fs.writeFileSync(file, "new");
  assert.notEqual(versionHtml(html, temporary), before);
  assert.throws(() =>
    versionHtml('<script src="assets/missing.js"></script>', temporary),
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(
  "Site versioning: all assets fingerprinted, changed content invalidates cache, idempotent, missing files rejected.",
);
