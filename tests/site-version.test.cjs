"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { versionHtml, versionSite } = require("../scripts/version-site.cjs");
const root = path.resolve(__dirname, "..");
const original = fs.readFileSync(path.join(root, "index.html"), "utf8");
const output = versionHtml(original, root);
const expectedVersion = "v" + require("../package.json").version;
assert(
  original.includes('<span id="siteVersion">' + expectedVersion + "</span>"),
);
assert(
  output.includes('<span id="siteVersion">' + expectedVersion + "</span>"),
);
assert.equal(
  versionHtml('<span id="siteVersion">v0.0.0</span>', root),
  '<span id="siteVersion">' + expectedVersion + "</span>",
);
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
const converterHtml = fs.readFileSync(
  path.join(root, "tools/convert-backup.html"),
  "utf8",
);
const converterVersion = versionHtml(converterHtml, root, {
  entryPath: "tools/convert-backup.html",
});
assert.equal(
  versionHtml(converterVersion, root, {
    entryPath: "tools/convert-backup.html",
  }),
  converterVersion,
);
let converterCount = 0;
for (const [, asset, hash] of converterVersion.matchAll(
  /(?:src|href)="([^"?]+)\?v=([a-f0-9]{16})"/g,
)) {
  assert.equal(
    hash,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.resolve(root, "tools", asset)))
      .digest("hex")
      .slice(0, 16),
  );
  converterCount++;
}
assert.equal(
  converterCount,
  [...converterHtml.matchAll(/(?:src|href)="[^"?]+\.(?:js|css)"/g)].length,
);
assert(converterCount > 15);
assert(converterVersion.includes('href="../index.html"'));
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
  fs.mkdirSync(path.join(temporary, "tools"));
  const main = path.join(temporary, "index.html"),
    converter = path.join(temporary, "tools", "convert-backup.html");
  fs.writeFileSync(main, html);
  fs.writeFileSync(converter, '<script src="../assets/missing.js"></script>');
  assert.throws(() => versionSite(temporary));
  assert.equal(
    fs.readFileSync(main, "utf8"),
    html,
    "Both pages preflight before any write",
  );
  fs.writeFileSync(
    converter,
    '<script src="../assets/example.js#preserved"></script>',
  );
  versionSite(temporary);
  assert.match(
    fs.readFileSync(converter, "utf8"),
    /\?v=[a-f0-9]{16}#preserved/,
  );
  assert.match(fs.readFileSync(main, "utf8"), /\?v=[a-f0-9]{16}/);
  assert.throws(
    () =>
      versionHtml('<script src="../../escape.js"></script>', temporary, {
        entryPath: "tools/convert-backup.html",
      }),
    /escapes/,
  );
  const remote =
    '<script src="https://example.test/script.js"></script><link href="data:text/css,a" rel="stylesheet">';
  assert.equal(versionHtml(remote, temporary), remote);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(
  "Site versioning: all assets fingerprinted, changed content invalidates cache, idempotent, missing files rejected.",
);
