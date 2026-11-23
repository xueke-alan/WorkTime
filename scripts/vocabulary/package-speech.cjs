"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { sources, download } = require("./prepare-speech.cjs");
async function packageSpeech(output, engine) {
  if (engine && !sources[engine]) throw Error("Unknown speech engine");
  const resources = [],
    inputs = [];
  for (const [name, source] of Object.entries(sources)) {
    if (engine && engine !== name) continue;
    const specs = require(
      name === "piper" ? "./speech-files.json" : "./supertonic-files.json",
    );
    for (const file of source.paths) {
      await download(source, file);
      resources.push({ engine: name, name: file, ...specs[file] });
      inputs.push(
        path.resolve(
          __dirname,
          "../../.cache/speech-comparison",
          source.revision + "-" + file.replaceAll("/", "-"),
        ),
      );
    }
  }
  const header = Buffer.from(
    JSON.stringify({ format: "worktime-speech-models", version: 1, resources }),
  );
  const prefix = Buffer.alloc(14);
  prefix.write("WTMODELS1\n");
  prefix.writeUInt32LE(header.length, 10);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + ".partial";
  const descriptor = fs.openSync(temporary, "w");
  try {
    fs.writeSync(descriptor, prefix);
    fs.writeSync(descriptor, header);
    for (const input of inputs)
      fs.writeSync(descriptor, fs.readFileSync(input));
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, output);
  console.log(
    "Offline speech package: " +
      output +
      " (" +
      fs.statSync(output).size +
      " bytes)",
  );
  return output;
}
module.exports = { packageSpeech };
if (require.main === module) {
  const engine = process.argv.find((v) => v.startsWith("--engine="))?.slice(9);
  const output = path.resolve(
    process.argv.find((v) => v.startsWith("--output="))?.slice(9) ||
      path.resolve(
        __dirname,
        "../../.cache/speech-packages/worktime-speech-models-v1" +
          (engine ? "-" + engine : "") +
          ".wtmodels",
      ),
  );
  packageSpeech(output, engine).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
