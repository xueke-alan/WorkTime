/* global WorkTimePikafish */
"use strict";

let search;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const module = await WorkTimePikafish({
        wasmBinary: new Uint8Array(data.wasm),
        print() {},
        printErr() {},
      });
      module.FS.writeFile("/pikafish.nnue", new Uint8Array(data.net));
      module.cwrap("wt_init", null, [])();
      module.FS.unlink("/pikafish.nnue");
      search = module.cwrap("wt_search", "string", [
        "string",
        "number",
        "number",
        "number",
      ]);
      self.postMessage({ type: "ready" });
    } else if (data.type === "search") {
      const configuration = {
        normal: [200, 4, 10000],
        hard: [1000, 12, 200000],
        master: [3000, 64, 0],
      }[data.difficulty];
      if (!search || !configuration) throw Error("Invalid search request");
      self.postMessage({
        type: "move",
        id: data.id,
        move: search(data.fen, ...configuration),
      });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
