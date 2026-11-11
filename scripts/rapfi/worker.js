/* global Rapfi */
"use strict";
let engine = null;
let current = null;
let evaluator = false;
let diagnostics = [];
let forbidden = false;
function modelName(side) {
  return forbidden
    ? "mix9svqrenju_bs15_" + (side === 1 ? "black" : "white")
    : "mix9svqfreestyle_bsmix";
}
const config = "__RAPFI_CONFIG__";
function output(line) {
  if (/Evaluator set to mix9svq/.test(line)) evaluator = true;
  if (/^ERROR/.test(line)) throw Error(line);
  if (!current) return;
  diagnostics.push(line);
  const match = /^(\d+),(\d+)$/.exec(line.trim());
  if (!match) return;
  if (!evaluator) throw Error("NNUE evaluator not loaded");
  const x = Number(match[1]),
    y = Number(match[2]);
  self.postMessage({
    type: "result",
    id: current.id,
    move: y * 15 + x,
    x,
    y,
    engine: "Rapfi",
    model: modelName(current.side),
    diagnostics,
  });
  current = null;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      forbidden = data.forbidden === true;
      engine = await Rapfi({
        wasmBinary: data.wasm,
        onReceiveStdout: output,
        onReceiveStderr: (line) => {
          if (/error|failed/i.test(line)) throw Error(line);
        },
        preRun: [
          (module) => {
            module.FS.writeFile(
              "/config.toml",
              forbidden
                ? config.replace(
                    /\[\[model.evaluator.weights\]\]\s*weight_file = "mix9svqfreestyle_bsmix.bin.lz4"/,
                    "",
                  )
                : config.replace(
                    /\[\[model.evaluator.weights\]\]\s*weight_file_black = "mix9svqrenju_bs15_black.bin.lz4"\s*weight_file_white = "mix9svqrenju_bs15_white.bin.lz4"/,
                    "",
                  ),
            );
            module.FS.writeFile(
              "/model210901.bin",
              new Uint8Array(data.classical),
            );
            if (forbidden) {
              module.FS.writeFile(
                "/mix9svqrenju_bs15_black.bin.lz4",
                new Uint8Array(data.renjuBlack),
              );
              module.FS.writeFile(
                "/mix9svqrenju_bs15_white.bin.lz4",
                new Uint8Array(data.renjuWhite),
              );
            } else {
              module.FS.writeFile(
                "/mix9svqfreestyle_bsmix.bin.lz4",
                new Uint8Array(data.model),
              );
            }
          },
        ],
      });
      if (!evaluator) throw Error("Rapfi NNUE initialization failed");
      self.postMessage({
        type: "ready",
        engine: "Rapfi",
        model: modelName(1),
      });
    } else if (data.type === "search") {
      if (!engine || current) throw Error("Engine not ready");
      current = data;
      diagnostics = [];
      const command = (text) => engine.sendCommand(text);
      command("INFO rule " + (forbidden ? 4 : 0));
      command("START 15");
      command("INFO pondering 0");
      command("INFO timeout_turn " + data.budget);
      command("INFO timeout_match 1000000000");
      command("INFO time_left 1000000000");
      command("INFO max_depth " + data.depth);
      command("INFO show_detail 2");
      const stones = data.path.map(
        (p) =>
          `${p % 15},${Math.floor(p / 15)},${data.board[p] === data.side ? 1 : 2}`,
      );
      command(
        "BOARD\n" + stones.join("\n") + (stones.length ? "\n" : "") + "DONE",
      );
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error.message || error),
    });
  }
};
