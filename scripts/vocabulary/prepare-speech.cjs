"use strict";
// Browser implementations are vendored with their original notices in vendor/.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "../..");
const dest = path.join(root, "assets/vendor/vocabulary");
const cache = path.join(root, ".cache/speech-comparison");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sources = {
  supertonic: {
    repo: "models/supertone-oss-archive/supertonic-3",
    revision: "aafc6e32416a594460b32413efc49d7fe4ce6d46",
    paths: Object.keys(require("./supertonic-files.json")),
  },
  piper: {
    repo: "models/rhasspy/piper-voices",
    revision: "e9c8a39444359388adaa94255becb37a5a2b8e51",
    paths: Object.keys(require("./speech-files.json")),
  },
};
async function download(source, file) {
  const local = path.join(
    cache,
    source.revision + "-" + file.replaceAll("/", "-"),
  );
  const model = source === sources.supertonic ? "supertonic" : "piper";
  const spec = require(
    model === "piper" ? "./speech-files.json" : "./supertonic-files.json",
  )[file];
  const valid = (bytes) =>
    bytes.length === spec.bytes &&
    (!spec.sha256 || hash(bytes) === spec.sha256);
  if (fs.existsSync(local)) {
    const bytes = fs.readFileSync(local);
    if (!valid(bytes))
      throw Error("Cached speech resource checksum mismatch: " + file);
    return bytes;
  }
  const repo = source.repo.replace(/^models\//, "");
  const url =
    "https://huggingface.co/" +
    repo +
    "/resolve/" +
    source.revision +
    "/" +
    file;
  const size = 1024 * 1024,
    total = Math.ceil(spec.bytes / size),
    parts = new Array(total);
  const ranges = [];
  for (let i = 0; i < total; i++) {
    const file = local + ".part-" + i,
      length = Math.min(size, spec.bytes - i * size);
    if (fs.existsSync(file) && fs.statSync(file).size === length)
      parts[i] = fs.readFileSync(file);
  }
  for (let i = 0; i < total;) {
    if (parts[i]) {
      i++;
      continue;
    }
    const first = i;
    while (i < total && !parts[i] && i - first < 8) i++;
    ranges.push([first, i]);
  }
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, ranges.length) }, async () => {
      while (cursor < ranges.length) {
        const [first, last] = ranges[cursor++],
          start = first * size,
          end = Math.min(spec.bytes, last * size) - 1;
        let failure;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const response = await fetch(
              url + "?range=" + start + "-" + end + "&attempt=" + attempt,
              {
                headers: { Range: "bytes=" + start + "-" + end },
                signal: AbortSignal.timeout(90000),
              },
            );
            if (!response.ok) throw Error("Download HTTP " + response.status);
            const bytes = Buffer.from(await response.arrayBuffer());
            const chunk =
              response.status === 200 && bytes.length === spec.bytes
                ? bytes.subarray(start, end + 1)
                : bytes;
            if (chunk.length !== end - start + 1)
              throw Error("Incomplete resource: " + file);
            for (let i = first; i < last; i++) {
              parts[i] = chunk.subarray(
                (i - first) * size,
                Math.min(chunk.length, (i - first + 1) * size),
              );
              fs.writeFileSync(local + ".part-" + i, parts[i]);
            }
            failure = null;
            break;
          } catch (error) {
            failure = error;
          }
        }
        if (failure) throw failure;
        console.log(model, file, parts.filter(Boolean).length, "/", total);
      }
    }),
  );
  const bytes = Buffer.concat(parts);
  if (!valid(bytes)) throw Error("Speech resource checksum mismatch: " + file);
  fs.writeFileSync(local, bytes);
  return bytes;
}
function pack(prefix, bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 3 * 1024 ** 2) {
    const file = `${prefix}-${parts.length}.js`;
    const output = `WorkTimeApp.data.vocabularyChunks.push(${JSON.stringify(bytes.subarray(i, i + 3 * 1024 ** 2).toString("base64"))});\n`;
    const target = path.join(dest, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output)
      fs.writeFileSync(target, output);
    parts.push("assets/vendor/vocabulary/" + file);
  }
  return { parts, bytes: bytes.length, sha256: hash(bytes) };
}
async function prepareSpeech() {
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  const manifest = {
    model: "Piper / Supertonic 3",
    groups: {},
    revision: sources.piper.revision,
    sampleRate: 22050,
    voices: ["F1", "en_GB-jenny_dioco-medium"],
    files: {},
  };
  for (const [name, source] of Object.entries(sources)) {
    const files = {};
    for (const file of source.paths) {
      const spec = require(
        name === "piper" ? "./speech-files.json" : "./supertonic-files.json",
      )[file];
      files[file] = {
        ...spec,
        url:
          "https://github.com/xueke-alan/WorkTime/releases/download/speech-models-v1/" +
          name +
          "-" +
          file.replaceAll("/", "-"),
      };
      files[file].parts = Array.from(
        { length: Math.ceil(spec.bytes / (3 * 1024 ** 2)) },
        (_, index) => files[file].url + ".part-" + index + ".js",
      );
    }
    Object.assign(manifest.files, files);
    manifest.groups[name] = Object.keys(files);
  }
  for (const [name, filename] of [
    ["mjs", "ort-wasm-simd-threaded.mjs"],
    ["wasm", "ort-wasm-simd-threaded.wasm"],
  ]) {
    manifest.files[name] = pack(
      name,
      fs.readFileSync(
        path.join(root, "node_modules/onnxruntime-web/dist", filename),
      ),
    );
  }
  for (const engine of ["piper", "supertonic"]) {
    const result = await esbuild.build({
      entryPoints: [path.join(__dirname, engine + "-worker.mjs")],
      bundle: true,
      platform: "browser",
      format: "iife",
      write: false,
      minify: true,
    });
    fs.writeFileSync(
      path.join(
        dest,
        engine === "piper" ? "worker-source.js" : "supertonic-worker-source.js",
      ),
      "WorkTimeApp.data.vocabularyWorkers ||= {}; WorkTimeApp.data.vocabularyWorkers." +
        engine +
        "=" +
        JSON.stringify(result.outputFiles[0].text) +
        ";\n",
    );
  }
  const keep = new Set(
    Object.values(manifest.files).flatMap((file) =>
      (file.parts || []).map((part) => path.basename(part)),
    ),
  );
  for (const filename of fs.readdirSync(dest))
    if (
      /^(?:supertonic|piper)-\d+-\d+\.js$/.test(filename) &&
      !keep.has(filename)
    )
      fs.unlinkSync(path.join(dest, filename));
  fs.writeFileSync(
    path.join(dest, "manifest.js"),
    "WorkTimeApp.data.vocabularySpeech=" + JSON.stringify(manifest) + ";\n",
  );
  fs.writeFileSync(
    path.join(dest, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
module.exports = { prepareSpeech, download, sources };
if (require.main === module)
  prepareSpeech().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
