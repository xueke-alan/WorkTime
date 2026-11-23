"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseCSV, memberships } = require("./source.cjs");
const { collectExamples } = require("./import-dictionary.cjs");
const { contains } = require("./import-examples.cjs");
const { validateExamples, selectExamples } = require("./example-policy.cjs");
function verifyContent(catalog, storage) {
  const sentence = (en) => ({
    en,
    zh: "测试译文",
    kind: "sentence",
    source: { type: "original" },
  });
  const short = [
    sentence("The apple is red."),
    sentence("Please eat this apple."),
    { ...sentence("a fresh apple"), kind: "phrase" },
  ];
  assert.deepEqual(validateExamples("apple", short), []);
  assert(validateExamples("apple", short.slice(0, 2)).length);
  assert(
    validateExamples("apple", [
      ...short,
      { ...sentence("a green apple"), kind: "phrase" },
    ]).length,
  );
  assert(
    validateExamples("apple", [
      ...short,
      sentence("This short example has far too many words today."),
    ]).length,
  );
  assert(
    validateExamples("apple", [...short, sentence("THE APPLE IS RED!")]).length,
  );
  assert(
    validateExamples("apple", [
      ...short,
      { ...sentence("Another apple is here."), zh: "<unk>" },
    ]).length,
  );
  assert.equal(
    selectExamples([
      ...short,
      { ...sentence("a green apple"), kind: "phrase" },
    ]).filter((example) => example.kind === "phrase").length,
    1,
  );
  assert.deepEqual(
    parseCSV('word,translation\r\n"a,b","line 1\nline ""2"""\r\n'),
    [
      ["word", "translation"],
      ["a,b", 'line 1\nline "2"'],
    ],
  );
  assert.deepEqual(memberships({ tag: "gk ky cet4" }), ["kaoyan"]);
  assert(!memberships({ tag: "kyoto" }).includes("kaoyan"));
  const legacy = storage.defaults();
  legacy.settings.book = "cet4";
  legacy.favorites = ["program"];
  const migrated = storage.validate(legacy);
  assert.equal(migrated.settings.book, "daily");
  assert.deepEqual(migrated.favorites, legacy.favorites);
  assert.equal(legacy.settings.book, "cet4");
  const base = storage.defaults();
  base.settings.book = "kaoyan";
  assert.equal(storage.validate(base).settings.book, "kaoyan");
  const examples = {};
  collectExamples(
    {
      word: "test",
      pos: "noun",
      senses: [
        {
          examples: [
            { text: "This test is a useful example.", type: "example" },
            {
              text: "This test belongs to a published book.",
              type: "quotation",
              ref: "2020, a book",
            },
            {
              text: "This test is still a quotation without metadata.",
              type: "quotation",
            },
          ],
        },
      ],
    },
    examples,
  );
  assert.equal(examples.test.length, 1);
  assert(contains("The workers accused him.", "accuse"));
  assert(!contains("A chairman arrived.", "chair"));
  assert(contains("The item is labeled C++.", "C++"));
  const counts = {};
  for (const entry of catalog.entries) {
    assert.deepEqual(validateExamples(entry.id, entry.examples), []);
    for (const example of entry.examples) {
      assert(
        example.en && example.zh && /\p{Script=Han}/u.test(example.zh),
        entry.id,
      );
      assert(
        !/[⁇�]|<unk>|<pad>/.test(example.zh),
        "Invalid translated output: " + entry.id,
      );
      assert(
        ["dictionary", "corpus", "original"].includes(example.source.type),
        entry.id,
      );
      if (example.source.type !== "original") {
        assert.equal(new URL(example.source.url).protocol, "https:");
        assert(example.source.license && example.source.attribution, entry.id);
      }
      if (example.translation.type === "machine")
        assert(example.translation.provider);
    }
    for (const accent of ["us", "uk"]) {
      if (entry.pronunciationSource[accent] !== "generated")
        assert.equal(
          new URL(entry.pronunciationReferences[accent].url).protocol,
          "https:",
        );
    }
    for (const book of entry.books) counts[book] = (counts[book] || 0) + 1;
  }
  assert(counts.kaoyan > 4500);
  for (const [book, count] of Object.entries(catalog.source.counts))
    assert.equal(counts[book] - (book === "daily" ? 100 : 0), count);
  for (const id of [
    "record:noun",
    "record:verb",
    "lead:metal",
    "lead:guide",
    "read:past",
    "read:present",
  ]) {
    const entry = catalog.entries.find((e) => e.id === id);
    assert.equal(entry.examples[0].source.type, "original");
    assert(entry.manualReference);
  }
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(__dirname, "examples.json"), "utf8"),
  );
  assert(snapshot.source.dictionary.sha256);
  assert.equal(snapshot.source.complete, catalog.entries.length);
  assert.deepEqual(snapshot.source.pending, []);
  for (const id of ["bank", "run", "set", "state", "light", "charge"])
    assert(
      catalog.entries.find((entry) => entry.id === id).examples.length >= 4,
      id,
    );
  const audit = require("./example-audit.json");
  assert.equal(audit.results.length, 200);
  for (const row of audit.results) {
    const entry = catalog.entries.find(
      (e) => e.id === row.id || e.word.toLowerCase() === row.id,
    );
    assert(entry, row.id);
    const example = entry.examples.find((e) => e.en === row.en);
    assert(example, "Reviewed example changed: " + row.id);
    assert.equal(
      crypto
        .createHash("sha256")
        .update(example.en + "\n" + example.zh)
        .digest("hex"),
      row.sha256,
      row.id,
    );
  }
  console.log(
    "Vocabulary content: five books, complete bilingual examples, source credits, accent references and archive compatibility passed.",
  );
}
module.exports = { verifyContent };
