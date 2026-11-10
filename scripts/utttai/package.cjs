"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const folder = path.join(root, "assets/vendor/utttai");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(path.join(root, file));
const files = {
  model: "policy_value_net_stage2.onnx",
  wasm: "ort-wasm-simd.wasm",
};
const pinned = {
  model: "81161d2e262c9904dbb9a14961a2fcd043009fab4fd4f76b41451587f89c60d2",
  wasm: "1e9d1928b147829dc6bd6542b5f9cb5eabf85008fd4b97235f74b38cab8eeb57",
};
const manifest = Object.fromEntries(
  Object.entries(files).map(([key, name]) => {
    const bytes = fs.readFileSync(path.join(folder, name));
    assert.equal(
      hash(bytes),
      pinned[key],
      "Unexpected upstream asset: " + name,
    );
    return [key, { name, size: bytes.length, hash: hash(bytes) }];
  }),
);
const prefix = '"use strict";\nWorkTimeApp.games.utttaiAssets ||= {};\n';
fs.writeFileSync(
  path.join(folder, "manifest.js"),
  prefix +
    "Object.assign(WorkTimeApp.games.utttaiAssets," +
    JSON.stringify(manifest) +
    ");\n",
);
const worker = [
  read("assets/vendor/utttai/ort.wasm.min.js").toString(),
  "self.WorkTimeApp = { games: {} };",
  read("assets/js/games/ultimate-ttt-rules.js").toString(),
  read("scripts/utttai/worker.js").toString(),
].join("\n");
fs.writeFileSync(
  path.join(folder, "worker-source.js"),
  prefix +
    "WorkTimeApp.games.utttaiAssets.worker = " +
    JSON.stringify(worker) +
    ";\n",
);
const base64 = Object.fromEntries(
  Object.entries(files).map(([key, name]) => [
    key,
    fs.readFileSync(path.join(folder, name)).toString("base64"),
  ]),
);
fs.writeFileSync(
  path.join(folder, "offline.js"),
  prefix +
    "WorkTimeApp.games.utttaiAssets.offline = " +
    JSON.stringify(base64) +
    ";\n",
);
console.log(
  "Packaged NMCTS2 model, single-threaded ORT 1.10.0 and file:// resources",
  manifest,
);
