"use strict";
// Explicit content refresh. Builds only read the resulting bilingual snapshot.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {
  selectExamples,
  validateExamples,
  wordCount,
  sentenceCandidate,
} = require("./example-policy.cjs");
const root = path.resolve(__dirname, "../..");
const cache = path.join(root, ".cache/vocabulary");
fs.mkdirSync(cache, { recursive: true });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const dictionary = read(path.join(__dirname, "dictionary.json"));
const previous = read(path.join(__dirname, "examples.json"));
const authored = read(path.join(__dirname, "short-originals.json"));
const excluded = read(path.join(__dirname, "excluded-examples.json"));
for (const [phrase, examples] of Object.entries(
  read(path.join(__dirname, "short-phrase-examples.json")),
))
  authored["phrase:" + phrase] = examples;
const optionalRead = (file) => (fs.existsSync(file) ? read(file) : {});
const dictionaryPool = optionalRead(path.join(cache, "short-dictionary.json"));
const corpusPool = optionalRead(path.join(cache, "short-tatoeba.json"));
const context = { WorkTimeApp: { data: {} } };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "assets/data/vocabulary/catalog.js"), "utf8"),
  context,
);
const catalog = context.WorkTimeApp.data.vocabularyCatalog;
const forms = new Map();
for (const entry of catalog.entries) {
  const variants = [
    entry.word,
    ...(entry.forms || []).flatMap((form) => form.split(" · ").slice(1)),
  ];
  for (const variant of variants) {
    const key = variant.toLowerCase();
    if (!forms.has(key)) forms.set(key, new Set());
    forms.get(key).add(entry.word);
  }
}
const supplement = new Map();
const multiword = catalog.entries.filter(
  (entry) => entry.kind === "word" && entry.word.includes(" "),
);
for (const line of fs
  .readFileSync(path.join(__dirname, "short-supplement.tsv"), "utf8")
  .trim()
  .split(/\r?\n/u)) {
  const [en, zh] = line.split("\t");
  if (!en || !zh || wordCount(en) > 8)
    throw Error("Invalid authored short example: " + line);
  const words = new Set(
    (en.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/gu) || []).flatMap(
      (token) => [
        ...(forms.get(token) || forms.get(token.replace(/'s$/u, "")) || []),
      ],
    ),
  );
  for (const entry of multiword)
    if (en.toLowerCase().includes(entry.word)) words.add(entry.word);
  for (const word of words) {
    if (!supplement.has(word)) supplement.set(word, []);
    supplement.get(word).push({
      en,
      zh,
      kind: "sentence",
      source: { type: "original", name: "WorkTime" },
      translation: { type: "editorial", reviewed: true },
    });
  }
}
const translationsFile = path.join(cache, "example-translations.json");
const translations = optionalRead(translationsFile);
const reviewed = read(path.join(__dirname, "reviewed-translations.json"));
const previousPreview = process.argv.includes("--from-preview")
  ? read(path.join(cache, "examples-preview.json"))
  : {};
const result = {};
const gaps = [];
const validationIssues = [];
const preview = {};
const usable = (example) => {
  if (excluded[example?.en]) return false;
  if (!example?.en || /[\[\]{}<>\\#_]|\b(?:fuck|nigger)\b/iu.test(example.en))
    return false;
  if (/^(?:[a-z-]+,\s*){3,}/iu.test(example.en)) return false;
  const zh =
    reviewed[example.en]?.zh ||
    (example.translation?.type === "machine"
      ? translations[hash(example.en)]?.zh || example.zh
      : example.zh || translations[hash(example.en)]?.zh);
  return !zh || !/[⁇�]|<unk>|<pad>|\p{Co}|\{\\/u.test(zh);
};
for (const entry of catalog.entries) {
  const own = (authored[entry.id] || []).map(
    ([en, zh, sense, kind = "sentence"]) => ({
      en,
      zh,
      sense,
      kind,
      source: { type: "original", name: "WorkTime" },
      translation: { type: "editorial", reviewed: true },
    }),
  );
  // Split pronunciations must never inherit examples for a different reading.
  const dedicated = entry.kind === "word" && entry.id.includes(":");
  const preferred = [
    ...own,
    ...(supplement.get(entry.word) || []),
    ...(previousPreview[entry.id] || previous.entries[entry.id] || []),
  ].filter(usable);
  const candidates = dedicated
    ? own
    : selectExamples(preferred).length >= 3
      ? preferred
      : [
          ...own,
          ...(supplement.get(entry.word) || []),
          ...(previous.entries[entry.id] ||
            previous.entries[entry.word.toLowerCase()] ||
            []),
          ...(dictionary.examples[entry.word] || []).map((example) => ({
            ...example,
            source: {
              type: "dictionary",
              name: dictionary.source.project,
              url: dictionary.source.entryURL + encodeURIComponent(entry.word),
              license: dictionary.source.license,
              attribution: "Wiktionary contributors",
              ...example.source,
            },
          })),
          ...(dictionaryPool[entry.word] || []),
          ...(corpusPool[entry.word] || []),
        ];
  const eligible = candidates
    .filter((example) => {
      if (!usable(example)) return false;
      if (wordCount(example.en) > 8 || wordCount(example.en) < 2) return false;
      if (example.kind) return true;
      if (!/[.!?]$/u.test(example.en)) return false;
      return sentenceCandidate(example.en);
    })
    .map((example) => ({ ...example, kind: example.kind || "sentence" }));
  // Keep curated text first; otherwise prefer a common short construction.
  eligible.sort((a, b) => {
    const score = (example) =>
      own.some((item) => item.en === example.en)
        ? -100
        : (example.source.type === "original" ? -50 : 0) +
          (example.source.type === "dictionary" ? 0 : 5) +
          Math.abs(wordCount(example.en) - 5) +
          (/\b(?:Tom|Mary|Sami|Ziri|Algeria|Islamophobes)\b/u.test(example.en)
            ? 15
            : 0);
    return score(a) - score(b);
  });
  const selected =
    own.length >= 3 ? selectExamples(own) : selectExamples(eligible);
  for (const example of selected) {
    if (reviewed[example.en]) {
      example.zh = reviewed[example.en].zh;
      example.translation = { type: "editorial", reviewed: true };
    } else if (!example.zh || example.translation?.type === "machine") {
      const cached = translations[hash(example.en)];
      if (cached) {
        example.translation = {
          type: "machine",
          provider:
            cached.provider ||
            example.translation?.provider ||
            "Google Translate",
          reviewed: false,
        };
        example.zh = cached.zh;
      } else if (!example.zh) {
        example.translation = {
          type: "machine",
          provider: "pending",
          reviewed: false,
        };
      }
    }
  }
  preview[entry.id] = selected;
  if (selected.length < 3)
    gaps.push({ id: entry.id, available: selected.length });
  else {
    const issues = validateExamples(entry.id, selected);
    validationIssues.push(...issues);
    if (!issues.length) result[entry.id] = selected;
  }
}
fs.writeFileSync(
  path.join(cache, "examples-preview.json"),
  JSON.stringify(preview),
);
fs.writeFileSync(
  path.join(__dirname, "example-gaps.json"),
  JSON.stringify(gaps, null, 2) + "\n",
);
console.log(
  "Short examples:",
  Object.keys(result).length,
  "translated complete entries;",
  gaps.length,
  "content gaps.",
);
if (process.argv.includes("--inventory")) process.exit(0);
const missingTranslations = Object.values(preview)
  .flat()
  .filter((example) => !example.zh).length;
if (missingTranslations)
  throw Error(
    "Missing short-example translations: " +
      missingTranslations +
      "; run translate-examples.py first",
  );
if (gaps.length)
  throw Error(
    "Short-example content gaps remain; previous application snapshot preserved",
  );
if (validationIssues.length) throw Error(validationIssues.join("\n"));
const source = {
  policy: { minimum: 3, maxWords: 8, maxPhrases: 1 },
  dictionary: dictionary.source,
  supplements: previous.source.supplements,
  wordnet: previous.source.wordnet,
  bilingualCorpus: {
    name: "Tatoeba / ManyThings.org",
    url: "https://www.manythings.org/anki/",
    sha256: "d606361aa7312dcdfb15ef4fc51cb1e7ed8bc2dc608a7b192626cd36e8403106",
    license: "CC-BY-2.0-FR",
  },
  corpus: {
    name: "Tatoeba",
    url: "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2",
    sha256: "3a0e7a2fdd7cbad76f226de4c28371a15a2fc4d115001617288b16a35c6293db",
    license: "CC-BY-2.0-FR",
  },
  complete: Object.keys(result).length,
  pending: gaps.map((gap) => gap.id),
};
const destination = path.join(__dirname, "examples.json");
fs.writeFileSync(
  destination + ".tmp",
  JSON.stringify({ source, entries: result }, null, 2) + "\n",
);
fs.renameSync(destination + ".tmp", destination);
