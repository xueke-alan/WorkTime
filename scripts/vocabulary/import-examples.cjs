"use strict";
// Normal builds consume the checked-in snapshot; refresh is explicit.
const patterns = new Map();
function contains(en, word) {
  if (!patterns.has(word)) {
    const forms = new Set([word]);
    if (/^[a-z]{4,}$/.test(word)) {
      for (const suffix of ["s", "es", "ed", "ing"]) forms.add(word + suffix);
      if (word.endsWith("e")) {
        forms.add(word.slice(0, -1) + "ing");
        forms.add(word + "d");
      }
      if (word.endsWith("y")) {
        forms.add(word.slice(0, -1) + "ies");
        forms.add(word.slice(0, -1) + "ied");
      }
    }
    patterns.set(
      word,
      new RegExp(
        "(^|[^a-z])(?:" +
          [...forms]
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|") +
          ")([^a-z]|$)",
        "i",
      ),
    );
  }
  return patterns.get(word).test(en);
}

module.exports = { contains };
if (require.main === module) require("./refresh-short-examples.cjs");
