"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto"),
  zlib = require("node:zlib"),
  assert = require("node:assert/strict");
function readFrozenOracleSource() {
  const file = path.resolve(
      __dirname,
      "../fixtures/legacy-oracle-2026-10-04.js.gz",
    ),
    provenance = JSON.parse(fs.readFileSync(file + ".source.json", "utf8")),
    bytes = fs.readFileSync(file),
    source = zlib.gunzipSync(bytes),
    sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
  assert.equal(sha(bytes), provenance.fixtureSha256);
  assert.equal(sha(source), provenance.sourceSha256);
  assert.equal(source.length, provenance.sourceBytes);
  const text = source.toString("utf8"),
    binding = "const WorkLegacyV2 =";
  assert.equal(text.split(binding).length, 2);
  return text.replace(binding, "const FrozenLegacyOracle =");
}
function readConversionSource({ withOracle = false } = {}) {
  return (
    require("./core-source.cjs").readCoreSource() +
    ["legacy-v2.js", "convert-backup.js"]
      .map((file) =>
        fs.readFileSync(path.resolve(__dirname, "../../tools", file), "utf8"),
      )
      .join("\n") +
    (withOracle ? "\n" + readFrozenOracleSource() : "")
  );
}
module.exports = { readConversionSource };
