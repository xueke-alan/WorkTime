"use strict";
// Explicit refresh only: normal builds consume the checked-in, compact snapshot.
const fs = require("node:fs");
const path = require("node:path");
const { targetWords } = require("./source.cjs");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { Readable } = require("node:stream");
const { createGunzip } = require("node:zlib");
const root = path.resolve(__dirname, "../..");
const full = process.argv.includes("--full");
const url = full
  ? "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
  : "https://kaikki.org/dictionary/downloads/simple/simple-extract.jsonl";
async function download() {
  if (!full) {
    const response = await fetch(url + ".gz", {
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok)
      throw Error("Dictionary download failed: " + response.status);
    const input = Readable.fromWeb(response.body),
      decoded = input.pipe(createGunzip());
    input.on("error", (error) => decoded.destroy(error));
    return { response, input: decoded };
  }
  const compressed = url + ".gz";
  const headers = { "Accept-Encoding": "identity" };
  const response = await fetch(compressed, { method: "HEAD", headers });
  if (!response.ok)
    throw Error("Dictionary metadata failed: " + response.status);
  const etag = response.headers.get("etag");
  const size = Number(response.headers.get("content-length"));
  if (!etag || !Number.isSafeInteger(size) || size <= 0)
    throw Error("Missing dictionary snapshot metadata");
  const directory = path.join(
    root,
    ".cache/vocabulary/dictionary-" +
      crypto.createHash("sha256").update(etag).digest("hex").slice(0, 16),
  );
  fs.mkdirSync(directory, { recursive: true });
  const chunkSize = 4 * 1024 ** 2,
    parts = new Array(Math.ceil(size / chunkSize));
  let cursor = 0,
    completed = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < parts.length) {
        const index = cursor++,
          start = index * chunkSize,
          end = Math.min(size, start + chunkSize) - 1;
        const file = path.join(directory, index + ".gz.part");
        if (
          !fs.existsSync(file) ||
          fs.statSync(file).size !== end - start + 1
        ) {
          let lastError;
          for (let retry = 0; retry < 3; retry++) {
            try {
              const r = await fetch(compressed, {
                headers: {
                  ...headers,
                  "If-Match": etag,
                  Range: `bytes=${start}-${end}`,
                },
                signal: AbortSignal.timeout(120000),
              });
              if (
                r.status !== 206 ||
                r.headers.get("etag") !== etag ||
                r.headers.get("content-range") !==
                  `bytes ${start}-${end}/${size}`
              )
                throw Error(
                  "Dictionary snapshot changed or invalid range response",
                );
              const bytes = Buffer.from(await r.arrayBuffer());
              if (bytes.length !== end - start + 1)
                throw Error("Incomplete dictionary chunk");
              fs.writeFileSync(file, bytes);
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (lastError) throw lastError;
        }
        parts[index] = file;
        if (++completed % 16 === 0)
          console.log("Dictionary download:", completed, "/", parts.length);
      }
    }),
  );
  const input = Readable.from(
    (async function* () {
      for (const file of parts) yield* fs.createReadStream(file);
    })(),
  );
  const decoded = input.pipe(createGunzip());
  input.on("error", (error) => decoded.destroy(error));
  return { response, input: decoded };
}
function rank(sound, accent) {
  if (!sound.ipa || !/^\/[^/]+\/$/.test(sound.ipa)) return 0;
  const tags = [...(sound.tags || []), ...(sound.raw_tags || [])];
  if (tags.some((t) => /obsolete|archaic|dated|dialectal|nonstandard/i.test(t)))
    return 0;
  const preferred =
    accent === "us"
      ? ["General-American", "General American"]
      : [
          "Received-Pronunciation",
          "Received Pronunciation",
          "Standard Southern British",
          "Southern-England",
        ];
  if (tags.some((t) => preferred.includes(t))) return 3;
  const regions =
    accent === "us"
      ? ["US", "United-States", "American"]
      : ["UK", "British", "England"];
  // Untagged pronunciations are not assumed to represent both accents.
  return tags.some((t) => regions.includes(t)) ? 2 : 0;
}
async function main() {
  const wanted = targetWords();
  const { response, input } = await download();
  const sha = crypto.createHash("sha256");
  input.on("data", (bytes) => sha.update(bytes));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const words = {},
    examples = {},
    candidates = {},
    scores = {};
  let count = 0;
  for await (const line of lines) {
    const entry = JSON.parse(line);
    const word = entry.word?.toLowerCase();
    if (
      entry.lang_code !== "en" ||
      entry.word !== word ||
      !wanted.has(word) ||
      ["name", "proper-noun", "symbol", "character", "abbrev"].includes(
        entry.pos,
      )
    )
      continue;
    collectExamples(entry, examples);
    for (const sound of entry.sounds || [])
      for (const accent of ["us", "uk"]) {
        const score = rank(sound, accent);
        if (score) {
          const list = ((candidates[word] ||= {})[accent] ||= []);
          const candidate = {
            ipa: sound.ipa.slice(1, -1),
            pos: entry.pos,
            tags: sound.tags || [],
            sense: sound.note || sound.sense || "",
          };
          if (
            !list.some(
              (item) => JSON.stringify(item) === JSON.stringify(candidate),
            )
          )
            list.push(candidate);
        }
        if (score > (scores[word]?.[accent] || 0)) {
          (words[word] ||= {})[accent] = sound.ipa.slice(1, -1);
          (scores[word] ||= {})[accent] = score;
        }
      }
    if (++count % 2000 === 0)
      console.log("Dictionary matching entries:", count);
  }
  const result = {
    source: {
      project: full
        ? "English Wiktionary / Kaikki"
        : "Simple English Wiktionary / Kaikki",
      url,
      modified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      sha256: sha.digest("hex"),
      license: "CC-BY-SA-4.0",
      attribution:
        "Wiktionary contributors; extracted by Wiktextract / Kaikki.org",
      entryURL: full
        ? "https://en.wiktionary.org/wiki/"
        : "https://simple.wiktionary.org/wiki/",
    },
    examples,
    candidates,
    words: Object.fromEntries(
      Object.entries(words).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  const destination = path.join(__dirname, "dictionary.json");
  fs.writeFileSync(
    destination + ".tmp",
    JSON.stringify(result, null, 2) + "\n",
  );
  fs.renameSync(destination + ".tmp", destination);
  console.log(
    "Dictionary snapshot:",
    Object.keys(words).length,
    result.source.sha256,
  );
}
function collectExamples(entry, result) {
  const word = entry.word.toLowerCase();
  for (const sense of entry.senses || []) {
    if (
      (sense.tags || []).some((t) =>
        /obsolete|archaic|offensive|vulgar|derogatory/.test(t),
      )
    )
      continue;
    for (const example of sense.examples || []) {
      // Published quotations carry separate rights: only dictionary-authored usage examples.
      const en = example.text?.replace(/\s+/g, " ").trim();
      if (
        example.ref ||
        ["quote", "quotation"].includes(example.type) ||
        !en ||
        en.split(/\s+/).length < 2 ||
        en.split(/\s+/).length > 8
      )
        continue;
      if (
        !en.toLowerCase().includes(word) ||
        /[\[\]{}<>]|fuck|shit|nigger|suicide|kill yourself/i.test(en)
      )
        continue;
      const list = (result[word] ||= []);
      if (list.length >= 8 || list.some((e) => e.en === en)) continue;
      list.push({
        en,
        ...(!/[.!?]$/.test(en) ? { kind: "phrase" } : {}),
        pos: entry.pos,
        gloss: (sense.glosses || []).join("; "),
      });
    }
  }
}
module.exports = { rank, collectExamples };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
