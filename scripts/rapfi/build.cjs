"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const source = path.join(root, ".cache/rapfi/Rapfi");
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim(),
  "1387d11312190ec66665d361ff07a7c70221b78a",
  "Unexpected Rapfi source revision",
);
const output = path.join(root, ".cache/rapfi-dist");
fs.mkdirSync(output, { recursive: true });
const cmake = fs.readFileSync(path.join(source, "CMakeLists.txt"), "utf8");
const sources = cmake
  .match(/set\(CORE_SOURCES([\s\S]*?)\)/)[1]
  .trim()
  .split(/\s+/);
const args = [
  ...sources.map((file) => path.join(source, file)),
  path.join(source, "external/lz4/src/lz4_all.c"),
  path.join(source, "external/lz4/src/xxhash.c"),
  ...[
    ".",
    "external/cpptoml/include",
    "external/cxxopts/include",
    "external/lz4/include",
    "external/simde/include",
  ].map((dir) => "-I" + path.join(source, dir)),
  "-std=c++17",
  "-O3",
  "-DNDEBUG",
  "-DUSE_WASM_SIMD",
  "-DNO_PREFETCH",
  "-msimd128",
  "-ffp-contract=off",
  "-fexceptions",
  "-flto",
  "--pre-js",
  path.join(source, "emscripten/preamble.js"),
  "-sMODULARIZE=1",
  "-sEXPORT_NAME=Rapfi",
  "-sEXPORTED_FUNCTIONS=_main,_gomocupLoopOnce,_emscripten_force_exit",
  "-sEXPORTED_RUNTIME_METHODS=cwrap,FS",
  "-sEXIT_RUNTIME=1",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=64MB",
  "-sMAXIMUM_MEMORY=512MB",
  "-sSTACK_SIZE=2MB",
  "-sENVIRONMENT=worker,node",
  "-o",
  path.join(output, "rapfi.js"),
];
const sdk = path.join(
  root,
  ".cache/pikafish-port/emsdk-main/upstream/emscripten/em++.py",
);
const temp = path.join(output, "tmp");
fs.mkdirSync(temp, { recursive: true });
const result = spawnSync("python", [sdk, ...args], {
  cwd: source,
  stdio: "inherit",
  env: { ...process.env, TEMP: temp, TMP: temp, EMCC_TEMP_DIR: temp },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
