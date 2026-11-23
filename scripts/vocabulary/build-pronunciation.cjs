"use strict";
const fs = require("node:fs");
const path = require("node:path");
function adapt(ipa, accent) {
  const phones = ipa
    .normalize("NFC")
    .replace(/([nlm])\u0329/g, "ə$1")
    .replace(/ɹ\u0329/g, accent === "us" ? "ɚ" : "ə")
    .replace(/([ɪʊiuy])\u032f/g, "$1")
    .replace(/\(ɹ\)|\(r\)/g, accent === "uk" ? "" : "ɹ")
    .replace(/[.\u0361\u035c]/g, "")
    .replace(/ɝ/g, "ɜːɹ")
    .replace(/ɫ/g, "l")
    .replace(/g/g, "ɡ")
    .replace(/r/g, "ɹ")
    .replace(/ʲ/g, "j")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l");
  if (!phones.trim() || /\u0329/u.test(phones) || phones.length > 510)
    return null;
  return phones;
}
async function completePronunciation(entries) {
  const { phonemize } = require("phonemizer");
  const dictionary = JSON.parse(
    fs.readFileSync(path.join(__dirname, "dictionary.json"), "utf8"),
  );
  const stats = {
    us: { manual: 0, dictionary: 0, generated: 0 },
    uk: { manual: 0, dictionary: 0, generated: 0 },
  };
  const review = [];
  const corrections = require("./pronunciation-corrections.json");
  const { rank } = require("./import-dictionary.cjs");
  const previous = require("node:vm").runInNewContext;
  const context = { WorkTimeApp: { data: {} } };
  const catalogPath = path.join(
    __dirname,
    "../../assets/data/vocabulary/catalog.js",
  );
  if (fs.existsSync(catalogPath))
    previous(fs.readFileSync(catalogPath, "utf8"), context);
  const baselinePath = path.join(
    __dirname,
    "../../.cache/vocabulary/pronunciation-baseline.json",
  );
  if (!fs.existsSync(baselinePath))
    fs.writeFileSync(
      baselinePath,
      JSON.stringify(context.WorkTimeApp.data.vocabularyCatalog?.entries || []),
    );
  const old = new Map(
    JSON.parse(fs.readFileSync(baselinePath, "utf8")).map((e) => [e.id, e]),
  );
  const changes = [];
  for (const entry of entries) {
    entry.phonetics ||= {};
    entry.speech ||= {};
    entry.pronunciationSource = {};
    entry.pronunciationReferences = {};
    entry.pronunciationVariants = {};
    for (const accent of ["us", "uk"]) {
      if (corrections[entry.id]?.[accent]) {
        entry.phonetics[accent] = corrections[entry.id][accent];
        entry.speech[accent] = adapt(entry.phonetics[accent], accent);
        entry.manualReference = corrections[entry.id].url;
        entry.manualReferenceName = corrections[entry.id].name;
      }
      let source = "manual";
      let ipa = entry.phonetics[accent];
      let phones = entry.speech[accent] && adapt(entry.speech[accent], accent);
      if (!ipa) {
        ipa = dictionary.words[entry.word.toLowerCase()]?.[accent];
        phones = ipa && adapt(ipa, accent);
        source = "dictionary";
      }
      if (ipa) {
        entry.pronunciationReferences[accent] = (source === "dictionary" &&
          dictionary.references?.[entry.word]?.[accent]) || {
          name:
            source === "manual"
              ? entry.manualReferenceName || "Oxford Learner's Dictionaries"
              : dictionary.source.project,
          url:
            source === "manual"
              ? entry.manualReference
              : dictionary.source.entryURL + encodeURIComponent(entry.word),
        };
      }
      if (!phones) {
        if (ipa)
          review.push({
            id: entry.id,
            accent,
            ipa,
            reason: "Speech adapter fallback; display IPA preserved",
          });
        const generated = (
          await phonemize(
            entry.word.replace(/[’‘]/g, "'"),
            accent === "uk" ? "gmw/en-GB-x-rp" : "gmw/en-US",
          )
        ).join(" ");
        phones = adapt(generated, accent);
        if (!phones)
          throw Error(
            "Unsupported generated pronunciation: " +
              entry.id +
              " / " +
              accent +
              " / " +
              generated,
          );
        if (!ipa) {
          ipa = generated;
          source = "generated";
        }
      }
      entry.phonetics[accent] = ipa;
      entry.speech[accent] = phones;
      entry.pronunciationSource[accent] = source;
      if (source === "dictionary") {
        const candidates = dictionary.candidates?.[entry.word]?.[accent] || [];
        const best = Math.max(
          0,
          ...candidates.map((c) =>
            rank({ ipa: "/" + c.ipa + "/", tags: c.tags }, accent),
          ),
        );
        const alternatives = new Map();
        for (const candidate of candidates) {
          if (
            rank(
              { ipa: "/" + candidate.ipa + "/", tags: candidate.tags },
              accent,
            ) < best
          )
            continue;
          const key = candidate.ipa + ":" + candidate.pos;
          alternatives.set(key, { ipa: candidate.ipa, pos: candidate.pos });
        }
        entry.pronunciationVariants[accent] = [...alternatives.values()];
      }
      stats[accent][source]++;
      if (old.get(entry.id)?.phonetics?.[accent] !== ipa)
        changes.push({
          id: entry.id,
          accent,
          before: old.get(entry.id)?.phonetics?.[accent] || null,
          after: ipa,
          source,
        });
    }
    // The old accent-neutral field must never mask a missing accent.
    delete entry.phonetic;
  }
  fs.writeFileSync(
    path.join(__dirname, "pronunciation-report.json"),
    JSON.stringify(
      {
        stats,
        review,
        changes,
        pending: entries
          .filter((e) =>
            Object.values(e.pronunciationSource).includes("generated"),
          )
          .map((e) => e.id),
        note: "Source coverage is not accuracy. Independent reference audit is in content-audit.json.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Pronunciation coverage", stats, "Review items:", review.length);
  return { ...dictionary.source, stats };
}
module.exports = { adapt, completePronunciation };
