"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const { targetWords } = require("./source.cjs");
const { contains } = require("./import-examples.cjs");
const { sentenceCandidate } = require("./example-policy.cjs");
const decode = (text) =>
  text.replace(
    /&(?:amp|apos|quot|lt|gt);/g,
    (s) =>
      ({
        "&amp;": "&",
        "&apos;": "'",
        "&quot;": '"',
        "&lt;": "<",
        "&gt;": ">",
      })[s],
  );
async function main() {
  const url =
    "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz";
  const file = path.join(__dirname, "../../.cache/vocabulary/wordnet.xml.gz");
  if (!fs.existsSync(file)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw Error("WordNet download HTTP " + r.status);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const bytes = fs.readFileSync(file),
    checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  if (
    checksum !==
    "9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe"
  )
    throw Error("WordNet snapshot changed");
  const xml = gunzipSync(bytes).toString(),
    wanted = targetWords(),
    links = {};
  for (const match of xml.matchAll(
    /<LexicalEntry\b[^>]*>([\s\S]*?)<\/LexicalEntry>/g,
  )) {
    const lemma = match[1].match(
      /<Lemma writtenForm="([^"]+)" partOfSpeech="([^"]+)"/,
    );
    if (!lemma) continue;
    const word = decode(lemma[1]);
    if (!wanted.has(word)) continue;
    for (const sense of match[1].matchAll(/synset="([^"]+)"/g))
      (links[sense[1]] ||= []).push({ word, pos: lemma[2] });
  }
  const result = {};
  for (const match of xml.matchAll(
    /<Synset id="([^"]+)"[^>]*>([\s\S]*?)<\/Synset>/g,
  )) {
    const targets = links[match[1]];
    if (!targets) continue;
    for (const ex of match[2].matchAll(/<Example>([^<]+)<\/Example>/g)) {
      const raw = decode(ex[1]);
      if (raw.split(/\s+/).length < 2 || raw.split(/\s+/).length > 8) continue;
      const kind = sentenceCandidate(/[.!?]$/.test(raw) ? raw : raw + ".")
        ? "sentence"
        : "phrase";
      const en =
        raw[0].toUpperCase() +
        raw.slice(1) +
        (kind === "sentence" && !/[.!?]$/.test(raw) ? "." : "");
      for (const { word, pos } of targets)
        if (contains(en, word))
          (result[word] ||= []).push({
            en,
            kind,
            pos,
            gloss: decode(
              match[2].match(/<Definition>([^<]+)<\/Definition>/)?.[1] || "",
            ),
            source: {
              name: "Open English WordNet 2025",
              url: "https://en-word.net/lemma/" + encodeURIComponent(word),
              license: "CC-BY-4.0",
              attribution:
                "Open English Wordnet Community; derived from Princeton WordNet",
              adaptation:
                "Initial capitalization and final punctuation normalized",
            },
          });
    }
  }
  const snapshot = {
    source: {
      project: "Open English WordNet 2025",
      url,
      sha256: checksum,
      license: "CC-BY-4.0",
    },
    examples: result,
  };
  fs.writeFileSync(
    path.join(__dirname, "wordnet-examples.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  console.log("WordNet sentence coverage", Object.keys(result).length);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
