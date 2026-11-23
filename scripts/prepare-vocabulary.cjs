"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const {
  books: bookIds,
  parseCSV,
  memberships,
} = require("./vocabulary/source.cjs");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, ".cache/vocabulary");
const dest = path.join(root, "assets/vendor/vocabulary");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
async function download(name, url) {
  const file = path.join(cache, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0)
    return fs.readFileSync(file);
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) throw Error(response.status + ": " + url);
      const bytes = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(file, bytes);
      return bytes;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
async function main() {
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  await require("./vocabulary/prepare-speech.cjs").prepareSpeech();
  await esbuild.build({
    entryPoints: [path.join(root, "scripts/vocabulary/fsrs-entry.mjs")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(dest, "fsrs.js"),
    minify: true,
  });
  const csv = await download(
    "ecdict.csv",
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
  );
  if (
    sha(csv) !==
    "d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc"
  )
    throw Error(
      "ECDICT snapshot changed; review the source before updating the pinned checksum",
    );
  const records = parseCSV(csv.toString("utf8"));
  const headers = records.shift();
  const rows = records.map((values) =>
    Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])),
  );
  const words = rows.filter(
    (r) => /^[a-z][a-z '-]{0,49}$/.test(r.word) && r.translation.trim(),
  );
  const ranked = words
    .filter((r) => Number(r.frq) > 0 && !r.word.includes(" "))
    .sort((a, b) => Number(a.frq) - Number(b.frq));
  const daily = new Set(ranked.slice(0, 3000).map((r) => r.word));
  const seen = new Set(),
    entries = [],
    counts = Object.fromEntries(bookIds.map((book) => [book, 0]));
  const tagsFound = new Set();
  for (const r of words) {
    const tags = r.tag.split(/\s+/);
    tags.forEach((t) => tagsFound.add(t));
    const books = memberships(r);
    if (daily.has(r.word)) books.push("daily");
    if (!books.length || seen.has(r.word)) continue;
    seen.add(r.word);
    books.forEach((b) => counts[b]++);
    entries.push({
      id: r.word,
      word: r.word,
      zh: r.translation.replace(/\\n/g, "\n"),
      phonetic: r.phonetic,
      books,
      rank: Number(r.frq) || Number(r.bnc) || 999999,
      kind: "word",
      forms: r.exchange
        .split("/")
        .map((value) => {
          const [type, word] = value.split(":");
          const labels = {
            p: "过去式",
            d: "过去分词",
            i: "现在分词",
            3: "第三人称单数",
            r: "比较级",
            t: "最高级",
            s: "复数",
            0: "原形",
          };
          return labels[type] && word ? labels[type] + " · " + word : null;
        })
        .filter(Boolean),
    });
  }
  console.log("Source tags:", [...tagsFound].sort().join(" "));
  for (const [book, count] of Object.entries(counts))
    if (!count)
      throw Error(`Empty book: ${book}; inspect source tags before shipping`);
  const pronunciation = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts/vocabulary/pronunciation.json"),
      "utf8",
    ),
  );
  for (const [word, senses] of Object.entries(pronunciation)) {
    const index = entries.findIndex((e) => e.word === word);
    if (index < 0) throw Error("Missing pronunciation entry: " + word);
    const original = entries[index];
    entries.splice(
      index,
      1,
      ...senses.map((sense) => ({
        ...original,
        id: word + ":" + sense.sense,
        zh: sense.zh,
        phonetic: "",
        phonetics: { us: sense.us, uk: sense.uk },
        speech: { us: sense.us, uk: sense.uk },
        manualReference: sense.reference,
      })),
    );
  }
  const variants = [
    ["color", "colour"],
    ["favorite", "favourite"],
    ["center", "centre"],
    ["theater", "theatre"],
    ["organize", "organise"],
    ["recognize", "recognise"],
    ["analyze", "analyse"],
    ["traveling", "travelling"],
  ];
  for (const pair of variants)
    for (const entry of entries)
      if (pair.includes(entry.word))
        entry.variants = pair.filter((w) => w !== entry.word);
  for (const book of Object.keys(counts))
    counts[book] = entries.filter((e) => e.books.includes(book)).length;
  const phrases = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/vocabulary/phrases.json"), "utf8"),
  );
  for (const [word, zh] of phrases)
    entries.push({
      id: "phrase:" + word.toLowerCase(),
      word,
      zh,
      books: ["daily"],
      rank: 1000000,
      kind: "phrase",
      phonetic: "",
    });
  const studyContent = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts/vocabulary/study-content.json"),
      "utf8",
    ),
  );
  for (const entry of entries)
    if (studyContent[entry.id]) Object.assign(entry, studyContent[entry.id]);
  const examples = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts/vocabulary/examples.json"),
      "utf8",
    ),
  );
  const {
    validateExamples,
    wordCount,
  } = require("./vocabulary/example-policy.cjs");
  const contentReport = {
    total: entries.length,
    covered: 0,
    sources: {},
    missing: [],
    byBook: {},
    minExamples: Infinity,
    maxWords: 0,
    phrases: 0,
  };
  for (const entry of entries) {
    entry.examples =
      examples.entries[entry.id] ||
      examples.entries[entry.word.toLowerCase()] ||
      [];
    const issues = validateExamples(entry.id, entry.examples);
    if (issues.length) throw Error(issues.join("\n"));
    contentReport.minExamples = Math.min(
      contentReport.minExamples,
      entry.examples.length,
    );
    if (entry.examples.length) contentReport.covered++;
    else contentReport.missing.push(entry.id);
    for (const example of entry.examples) {
      contentReport.maxWords = Math.max(
        contentReport.maxWords,
        wordCount(example.en),
      );
      if (example.kind === "phrase") contentReport.phrases++;
      if (!example.en || !example.zh || !example.source?.type)
        throw Error("Invalid example: " + entry.id);
      const type = example.source.type;
      contentReport.sources[type] = (contentReport.sources[type] || 0) + 1;
    }
  }
  for (const book of bookIds) {
    const selected = entries.filter((e) => e.books.includes(book));
    contentReport.byBook[book] = {
      total: selected.length,
      covered: selected.filter((e) => e.examples.length).length,
    };
  }
  if (contentReport.missing.length)
    throw Error(
      "Missing bilingual examples: " + contentReport.missing.join(", "),
    );
  fs.writeFileSync(
    path.join(root, "scripts/vocabulary/example-report.json"),
    JSON.stringify(contentReport, null, 2) + "\n",
  );
  entries.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const pronunciationSource =
    await require("./vocabulary/build-pronunciation.cjs").completePronunciation(
      entries,
    );
  const source = {
    project: "ECDICT",
    url: "https://github.com/skywind3000/ECDICT",
    sha256: sha(csv),
    license: "MIT",
    counts,
    phrases: phrases.length,
    pronunciation: pronunciationSource,
    examples: examples.source,
  };
  fs.mkdirSync(path.join(root, "assets/data/vocabulary"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "assets/data/vocabulary/catalog.js"),
    `WorkTimeApp.data.vocabularyCatalog=${JSON.stringify({ source, entries })};\n`,
  );
  const licenses = [
    "Supertonic 3 — OpenRAIL-M; code MIT; see licenses/supertonic-model.txt and licenses/supertonic-browser.txt; https://huggingface.co/supertone-oss-archive/supertonic-3",
    "ONNX Runtime — MIT; https://github.com/microsoft/onnxruntime",
    "phonemizer.js — Apache-2.0; embeds eSpeak NG (GPL-3.0-or-later); https://github.com/xenova/phonemizer.js",
    "eSpeak NG source: https://github.com/espeak-ng/espeak-ng",
    "ts-fsrs — MIT; https://github.com/open-spaced-repetition/ts-fsrs",
    "ECDICT — MIT; https://github.com/skywind3000/ECDICT",
    `${pronunciationSource.project} pronunciation data — CC-BY-SA-4.0; © Wiktionary contributors. Extracted by Wiktextract / Kaikki.org. Adapted and supplemented for WorkTime. Attribution and entry history: ${pronunciationSource.entryURL}{word} (replace {word} with the entry spelling). Snapshot: ${pronunciationSource.modified}; SHA-256 ${pronunciationSource.sha256}; ${pronunciationSource.url} . License: https://creativecommons.org/licenses/by-sa/4.0/ ; adapted data is distributed under CC-BY-SA-4.0.`,
    "Scenario phrases, supplemental examples and memory hints: original WorkTime content.",
    "Dictionary usage examples: English Wiktionary contributors / Kaikki.org, CC-BY-SA-4.0. Adapted selection; English text unchanged. Per-example entry links and credits are included in the catalog. https://creativecommons.org/licenses/by-sa/4.0/",
    "Bilingual corpus examples: Tatoeba contributors, CC-BY-2.0-FR, via https://www.manythings.org/anki/ . Per-example sentence links and author names are included in the catalog. https://creativecommons.org/licenses/by/2.0/fr/",
    "Additional English examples: Tatoeba contributors, CC-BY-2.0-FR, English detailed export dated 2026-11-21; SHA-256 3a0e7a2fdd7cbad76f226de4c28371a15a2fc4d115001617288b16a35c6293db. https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2 . Each example retains its sentence URL and contributor name; Chinese machine translations are separately marked. https://creativecommons.org/licenses/by/2.0/fr/",
    "Dictionary example translations marked machine: Google Translate, unreviewed unless explicitly marked reviewed. https://translate.google.com/ . Original WorkTime examples and translations are separately marked.",
    "Local supplemental machine translations: Helsinki-NLP OPUS-MT en-zh (Apache-2.0), CTranslate2 conversion by gaudi, revision dcd22168f08b99dd34c62bc2195e31dc2f04e90b. Unreviewed unless explicitly marked reviewed. https://huggingface.co/Helsinki-NLP/opus-mt-en-zh ; no translation model is included in the application.",
    "Open English Wordnet 2025 examples: Open English Wordnet Community, derived from Princeton WordNet, CC-BY-4.0. Initial capitalization and sentence-final punctuation adapted. Per-example lemma links and credits are included in the catalog. https://creativecommons.org/licenses/by/4.0/",
    "Manually reviewed IPA references: Oxford Learner's Dictionaries; individual word entry links are included in the catalog. These are short pronunciation transcriptions, not reproduced definitions or example sentences.",
  ];
  for (const dependency of ["phonemizer", "onnxruntime-web", "ts-fsrs"]) {
    const directory = path.join(root, "node_modules", dependency);
    const name = ["LICENSE", "LICENSE.txt"].find((f) =>
      fs.existsSync(path.join(directory, f)),
    );
    if (name)
      licenses.push(
        `\n${dependency}\n` +
          fs.readFileSync(path.join(directory, name), "utf8"),
      );
  }
  licenses.push(
    "\nECDICT\n" +
      (
        await download(
          "ecdict-license",
          "https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE",
        )
      ).toString(),
  );
  licenses.push(
    "\neSpeak NG GPL-3.0-or-later\n" +
      (
        await download(
          "espeak-license",
          "https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING",
        )
      ).toString(),
  );
  fs.writeFileSync(
    path.join(root, "licenses/vocabulary.txt"),
    licenses.join("\n") + "\n",
  );
  console.log(
    "Vocabulary ready",
    entries.length,
    counts,
    "phrases",
    phrases.length,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
