import * as ort from "onnxruntime-web/wasm";
export { ort };
export let files;
const localFetch = self.fetch.bind(self);
export function initialize(data) {
  files = data.files;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const url = (name, type) => URL.createObjectURL(new Blob([files[name]], { type }));
  ort.env.wasm.wasmPaths = { mjs: url("mjs", "text/javascript"), wasm: url("wasm", "application/wasm") };
  self.fetch = async (input) => {
    const name = String(input).replace(/^\.\//, "");
    if (name.startsWith("blob:") || name.startsWith("data:")) return localFetch(input);
    if (!files[name]) throw Error("Unbundled speech resource: " + name);
    return new Response(files[name]);
  };
}
export function wav(pcm, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
  const label = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
  label(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return buffer;
}
