"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const folder = path.join(root, "assets/vendor/rapfi");
fs.mkdirSync(folder, { recursive: true });
const read = (file) => fs.readFileSync(path.join(root, file));
const files = {
  wasm: ["rapfi.wasm", ".cache/rapfi-dist/rapfi.wasm"],
  model: [
    "mix9svqfreestyle_bsmix.bin.lz4",
    ".cache/rapfi-networks/mix9svq/mix9svqfreestyle_bsmix.bin.lz4",
  ],
  classical: [
    "model210901.bin",
    ".cache/rapfi-networks/classical/model210901.bin",
  ],
};
const manifest = {},
  offline = {};
const pinned = {
  model: "6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62",
  classical: "b3425ab5dbb73b25aad6f1c816e4700438c1fca265bf7a9c42aa3c2c006444af",
};
for (const [key, [name, source]] of Object.entries(files)) {
  const bytes = read(source);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (pinned[key]) assert.equal(hash, pinned[key], "Unexpected model: " + name);
  fs.writeFileSync(path.join(folder, name), bytes);
  manifest[key] = {
    name,
    size: bytes.length,
    hash,
  };
  offline[key] = bytes.toString("base64");
}
let config = read(
  ".cache/rapfi-networks/config-example/gomocalc-mix9svq.toml",
).toString();
config = config
  .replace(
    'coord_conversion_mode = "X_flipY"',
    'coord_conversion_mode = "none"',
  )
  .replace("default_tt_size_kb = 32768", "default_tt_size_kb = 16384")
  .replace(
    /\[\[model.evaluator.weights\]\]\s*weight_file = "mix9svqstandard_bs15.bin.lz4"\s*\[\[model.evaluator.weights\]\]\s*weight_file_black = "mix9svqrenju_bs15_black.bin.lz4"\s*weight_file_white = "mix9svqrenju_bs15_white.bin.lz4"/,
    "",
  );
fs.writeFileSync(path.join(__dirname, "config.toml"), config);
const prefix = '"use strict";\nWorkTimeApp.games.rapfiAssets ||= {};\n';
const worker =
  read(".cache/rapfi-dist/rapfi.js").toString() +
  "\n" +
  read("scripts/rapfi/worker.js")
    .toString()
    .replace('"__RAPFI_CONFIG__"', JSON.stringify(config));
fs.writeFileSync(
  path.join(folder, "manifest.js"),
  prefix +
    "Object.assign(WorkTimeApp.games.rapfiAssets," +
    JSON.stringify(manifest) +
    ");\n",
);
fs.writeFileSync(
  path.join(folder, "worker-source.js"),
  prefix +
    "WorkTimeApp.games.rapfiAssets.worker = " +
    JSON.stringify(worker) +
    ";\n",
);
fs.writeFileSync(
  path.join(folder, "offline.js"),
  prefix +
    "WorkTimeApp.games.rapfiAssets.offline = " +
    JSON.stringify(offline) +
    ";\n",
);
const licenses = path.join(root, "licenses/rapfi");
fs.mkdirSync(licenses, { recursive: true });
fs.copyFileSync(
  path.join(root, ".cache/rapfi/Copying.txt"),
  path.join(licenses, "COPYING.txt"),
);
fs.copyFileSync(
  path.join(root, ".cache/rapfi-networks/LICENSE"),
  path.join(licenses, "NETWORK-LICENSE.txt"),
);
fs.writeFileSync(
  path.join(__dirname, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(manifest);
