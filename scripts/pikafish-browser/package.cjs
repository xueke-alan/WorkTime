"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const cache = path.join(root, ".cache/pikafish-port");
const output = path.join(root, "assets/vendor/pikafish");
const net = fs.readFileSync(path.join(cache, "pikafish.nnue"));
const expected =
  "810ef8ecb0d0697755deac0a1d956296d762132f63b74fc4f8658f2ec5203f5b";
if (crypto.createHash("sha256").update(net).digest("hex") !== expected)
  throw Error("Unexpected NNUE model: verify before changing pinned hash");
const factory = fs.readFileSync(path.join(cache, "dist/pikafish.js"), "utf8");
const wasm = fs.readFileSync(path.join(cache, "dist/pikafish.wasm"));
const worker = [
  factory,
  "const pikafishWasm = " + JSON.stringify(wasm.toString("base64")) + ";",
  "const pikafishNet = " + JSON.stringify(net.toString("base64")) + ";",
  fs.readFileSync(path.join(__dirname, "worker.js"), "utf8"),
].join("\n");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, "engine.js"),
  "/*! Pikafish GPL-3.0-or-later. See licenses/pikafish. */\n" +
    "WorkTimeApp.games.pikafishWorkerSource = " +
    JSON.stringify(worker) +
    ";\n",
);
console.log("Packaged offline worker: " + Buffer.byteLength(worker) + " bytes");
