/* global WorkTimePikafish, pikafishWasm, pikafishNet */
"use strict";

// build packaging supplies the factory and both binary payloads before this file.
function decode(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
let search;
WorkTimePikafish({
  wasmBinary: decode(pikafishWasm),
  print() {},
  printErr() {},
})
  .then((module) => {
    module.FS.writeFile("/pikafish.nnue", decode(pikafishNet));
    module.cwrap("wt_init", null, [])();
    search = module.cwrap("wt_search", "string", [
      "string",
      "number",
      "number",
      "number",
    ]);
    self.postMessage({ type: "ready" });
  })
  .catch((error) => {
    self.postMessage({ type: "error", message: String(error) });
  });
self.onmessage = ({ data }) => {
  if (data.type !== "search") return;
  try {
    const configuration = {
      normal: [200, 4, 10000],
      hard: [1000, 12, 200000],
      master: [3000, 64, 0],
    }[data.difficulty];
    if (!configuration || !search) throw Error("Invalid search request");
    self.postMessage({
      type: "move",
      id: data.id,
      move: search(data.fen, ...configuration),
    });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
