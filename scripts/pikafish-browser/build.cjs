"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const source = path.join(root, ".cache/pikafish-port/synchronous");
const output = path.join(root, ".cache/pikafish-port/dist");
fs.mkdirSync(output, { recursive: true });
function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "universal" ? [] : sources(file);
    return entry.name.endsWith(".cpp") && entry.name !== "main.cpp"
      ? [file]
      : [];
  });
}
const args = [
  ...sources(source),
  "-I" + source,
  "-std=c++17",
  "-O3",
  "-DNDEBUG",
  "-DIS_64BIT",
  "-DNO_PREFETCH",
  "-DUSE_POPCNT",
  "-DUSE_SSE2",
  "-msse2",
  "-DUSE_SSSE3",
  "-mssse3",
  "-DUSE_SSE41",
  "-msse4.1",
  "-msimd128",
  "-fno-exceptions",
  "--no-entry",
  "-sMODULARIZE=1",
  "-sEXPORT_NAME=WorkTimePikafish",
  "-sENVIRONMENT=web,worker,node",
  "-sEXPORTED_FUNCTIONS=_wt_init,_wt_search,_malloc,_free",
  "-sEXPORTED_RUNTIME_METHODS=cwrap,FS",
  "-sINITIAL_MEMORY=128MB",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sMAXIMUM_MEMORY=512MB",
  "-sSTACK_SIZE=8MB",
  "-sNO_EXIT_RUNTIME=1",
  "-o",
  path.join(output, "pikafish.js"),
];
// Calling Python directly avoids Windows command-line length/quoting limits.
const sdk = path.join(root, ".cache/pikafish-port/emsdk-main");
const result = spawnSync(
  process.env.PIKAFISH_PYTHON || "python",
  [path.join(sdk, "upstream/emscripten/em++.py"), ...args],
  { stdio: "inherit", cwd: source },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
