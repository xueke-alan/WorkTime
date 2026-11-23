"use strict";
// Supplement accent gaps without replacing the fuller English edition.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { createGunzip } = require("node:zlib");
const readline = require("node:readline");
const { targetWords } = require("./source.cjs");
const { rank, collectExamples } = require("./import-dictionary.cjs");
async function main() {
  const url =
    "https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl";
  const r = await fetch(url + ".gz", { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw Error("Simple dictionary HTTP " + r.status);
  const input = Readable.fromWeb(r.body).pipe(createGunzip()),
    sha = crypto.createHash("sha256");
  input.on("data", (bytes) => sha.update(bytes));
  const file = path.join(__dirname, "dictionary.json"),
    dictionary = JSON.parse(fs.readFileSync(file, "utf8"));
  const wanted = targetWords(),
    words = {},
    scores = {},
    examples = {};
  for await (const line of readline.createInterface({
    input,
    crlfDelay: Infinity,
  })) {
    const entry = JSON.parse(line),
      word = entry.word;
    if (entry.lang_code !== "en" || !wanted.has(word)) continue;
    collectExamples(entry, examples);
    for (const accent of ["us", "uk"])
      for (const sound of entry.sounds || []) {
        const score = rank(sound, accent);
        if (score > (scores[word]?.[accent] || 0)) {
          (words[word] ||= {})[accent] = sound.ipa.slice(1, -1);
          (scores[word] ||= {})[accent] = score;
        }
      }
  }
  const source = {
    project: "Simple English Wiktionary / Kaikki",
    url,
    entryURL: "https://simple.wiktionary.org/wiki/",
    modified: r.headers.get("last-modified"),
    sha256: sha.digest("hex"),
    license: "CC-BY-SA-4.0",
  };
  dictionary.supplements = [source];
  dictionary.references ||= {};
  let filled = 0;
  for (const [word, accents] of Object.entries(words))
    for (const [accent, ipa] of Object.entries(accents)) {
      if (dictionary.words[word]?.[accent]) continue;
      (dictionary.words[word] ||= {})[accent] = ipa;
      (dictionary.references[word] ||= {})[accent] = {
        name: source.project,
        url: source.entryURL + encodeURIComponent(word),
      };
      filled++;
    }
  for (const [word, items] of Object.entries(examples)) {
    if (dictionary.examples[word]?.length) continue;
    dictionary.examples[word] = items.map((e) => ({
      ...e,
      source: {
        name: source.project,
        url: source.entryURL + encodeURIComponent(word),
        license: source.license,
      },
    }));
  }
  fs.writeFileSync(file + ".tmp", JSON.stringify(dictionary, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
  console.log("Simple dictionary filled accent gaps:", filled);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
