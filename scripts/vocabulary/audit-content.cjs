"use strict";
// Independent reference audit. Mismatches are review items, not proven errors.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const cache = path.join(root, ".cache/vocabulary/oxford");
function normalize(ipa, accent) {
  return ipa
    .normalize("NFC")
    .replace(/\(r\)|\(ɹ\)/g, accent === "uk" ? "" : "r")
    .replace(/[\/.[\]()ˌ\s]/g, "")
    .replace(/[\u0361\u035c\u032f]/g, "")
    .replace(/ɹ/g, "r")
    .replace(/ɚ/g, "ər")
    .replace(/ɝ/g, "ɜːr")
    .replace(/ɛ/g, "e")
    .replace(/ɡ/g, "g")
    .replace(/ɫ/g, "l")
    .replace(/([nlm])\u0329/g, "ə$1")
    .replace(/\(ə\)/g, "ə")
    .replace(/ə([lnm])(?=$|[^aeiouæɑɒəɛɜɪɔʊʌ])/g, "$1")
    .replace(accent === "us" ? /əʊ/g : /$^/g, "oʊ")
    .replace(/iː/g, "i")
    .replace(/uː/g, "u")
    .replace(/ɑː/g, "ɑ")
    .replace(/ɔːr/g, "ɔr")
    .replace(/ˈ([^aeiouæɑɒəɛɜɪɔʊʌyɐɚɝ]*)/g, "$1ˈ");
}
function extract(html) {
  const result = { uk: [], us: [] };
  for (const [accent, css] of [
    ["uk", "br"],
    ["us", "n_am"],
  ]) {
    const re = new RegExp(
      'class="phons_' + css + '"[\\s\\S]*?<span class="phon">([^<]+)</span>',
      "g",
    );
    for (const match of html.matchAll(re))
      result[accent].push(match[1].replace(/&[^;]+;/g, ""));
  }
  return result;
}
const stable = (id) =>
  crypto
    .createHash("sha256")
    .update("worktime-ipa-audit-v1:" + id)
    .digest("hex");
async function main() {
  fs.mkdirSync(cache, { recursive: true });
  const context = { WorkTimeApp: { data: {} } };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root, "assets/data/vocabulary/catalog.js"),
      "utf8",
    ),
    context,
  );
  const entries = context.WorkTimeApp.data.vocabularyCatalog.entries;
  const sorted = entries
    .filter((e) => e.kind === "word")
    .sort((a, b) => stable(a.id).localeCompare(stable(b.id)));
  // Balanced allocation among books, then deduplicate overlapping entries.
  const chosen = new Map();
  for (const book of require("./source.cjs").books) {
    for (const e of sorted.filter((e) => e.books.includes(book)).slice(0, 33))
      chosen.set(e.id, e);
  }
  for (const e of sorted) {
    if (chosen.size >= 200) break;
    chosen.set(e.id, e);
  }
  const sample = [...chosen.values()].slice(0, 200);
  const risk = entries.filter((e) => e.id.includes(":") && e.kind === "word");
  const selected = [
    ...new Map([...sample, ...risk].map((e) => [e.id, e])).values(),
  ];
  const results = new Array(selected.length);
  let cursor = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < selected.length) {
        const index = cursor++,
          entry = selected[index];
        const slug =
          entry.manualReference?.split("/").at(-1) ||
          entry.word.replace(/ /g, "-");
        let url =
          (entry.manualReference?.includes("oxfordlearnersdictionaries.com")
            ? entry.manualReference
            : "") ||
          "https://www.oxfordlearnersdictionaries.com/definition/english/" +
            encodeURIComponent(slug);
        let file = path.join(cache, encodeURIComponent(slug) + ".html");
        let html = "",
          error;
        try {
          if (fs.existsSync(file)) html = fs.readFileSync(file, "utf8");
          else {
            let r = await fetch(url, { signal: AbortSignal.timeout(20000) });
            if (r.status === 404 && !/_\d+$/.test(slug)) {
              url += "_1";
              file = path.join(
                cache,
                encodeURIComponent(slug + "_1") + ".html",
              );
              if (fs.existsSync(file)) html = fs.readFileSync(file, "utf8");
              else r = await fetch(url, { signal: AbortSignal.timeout(20000) });
            }
            if (html) {
              // The fallback entry is already cached.
            } else {
              if (!r.ok) throw Error("HTTP " + r.status);
              html = await r.text();
              if (!html.includes('class="phon"'))
                throw Error("No reference IPA");
              fs.writeFileSync(file, html);
            }
          }
        } catch (e) {
          error = e.message;
        }
        const allReference = extract(html);
        const reference = Object.fromEntries(
          ["us", "uk"].map((a) => [
            a,
            entry.id === "read:past"
              ? allReference[a].filter((ipa) => /red/.test(ipa))
              : allReference[a].slice(0, 1),
          ]),
        );
        results[index] = {
          id: entry.id,
          word: entry.word,
          sample: sample.some((e) => e.id === entry.id),
          url,
          error,
          accents: Object.fromEntries(
            ["us", "uk"].map((a) => [
              a,
              {
                actual: entry.phonetics[a],
                reference: reference[a],
                status: !reference[a].length
                  ? "unavailable"
                  : reference[a].some((ipa) =>
                        [
                          entry.phonetics[a],
                          ...(entry.pronunciationVariants?.[a] || []).map(
                            (v) => v.ipa,
                          ),
                        ].some((actual) => {
                          const actualNormalized = normalize(actual, a),
                            referenceNormalized = normalize(ipa, a);
                          return (
                            actualNormalized === referenceNormalized ||
                            (!ipa.includes("ˈ") &&
                              actualNormalized.replace(/ˈ/g, "") ===
                                referenceNormalized)
                          );
                        }),
                      )
                    ? "agreement"
                    : "review",
              },
            ]),
          ),
        };
        if (++done % 25 === 0)
          console.log("Independent audit", done, "/", selected.length);
      }
    }),
  );
  const counts = {};
  for (const a of ["us", "uk"]) {
    counts[a] = {};
    for (const r of results.filter((r) => r.sample))
      counts[a][r.accents[a].status] =
        (counts[a][r.accents[a].status] || 0) + 1;
  }
  fs.writeFileSync(
    path.join(__dirname, "content-audit.json"),
    JSON.stringify(
      {
        seed: "worktime-ipa-audit-v1",
        sampleSize: sample.length,
        method:
          "Deterministic book-balanced sample; normalized IPA agreement against independent Oxford reference. Agreement is not a human-verified accuracy estimate. Variants and unavailable references require review.",
        counts,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(counts);
}
module.exports = { normalize, extract };
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
