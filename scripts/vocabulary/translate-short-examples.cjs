"use strict";
// Explicit developer-only online translation of public example texts.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const file = path.join(root, ".cache/vocabulary/example-translations.json");
const cache = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {};
const entries = process.argv.includes("--preview")
  ? JSON.parse(
      fs.readFileSync(
        path.join(root, ".cache/vocabulary/examples-preview.json"),
        "utf8",
      ),
    )
  : require("./examples.json").entries;
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const pending = [
  ...new Set(
    Object.values(entries)
      .flat()
      .filter((example) => example.translation.type === "machine")
      .map((example) => example.en),
  ),
].filter((en) => cache[hash(en)]?.provider !== "Google Translate");
async function translate(batch) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  for (const [key, value] of Object.entries({
    client: "gtx",
    sl: "en",
    tl: "zh-CN",
    dt: "t",
    q: batch.join("\n"),
  }))
    url.searchParams.set(key, value);
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error("Translation HTTP " + response.status);
      const data = await response.json();
      const output = data[0]
        .map((row) => row[0] || "")
        .join("")
        .trim()
        .split(/\n+/u);
      if (
        output.length !== batch.length ||
        output.some((zh) => !/\p{Script=Han}/u.test(zh))
      ) {
        if (batch.length > 1) {
          const middle = Math.floor(batch.length / 2);
          await translate(batch.slice(0, middle));
          await translate(batch.slice(middle));
          return;
        }
        throw Error("Translation alignment failed: " + batch[0]);
      }
      batch.forEach((en, index) => {
        cache[hash(en)] = {
          en,
          zh: output[index].trim(),
          provider: "Google Translate",
          url: "https://translate.google.com/",
        };
      });
      return;
    } catch (error) {
      failure = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 2000 * (attempt + 1)),
        );
    }
  }
  throw failure;
}
async function main() {
  let cursor = 0,
    completed = 0;
  console.log("Public short-example translation:", pending.length, "pending");
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < pending.length) {
        const batch = pending.slice(cursor, cursor + 32);
        cursor += batch.length;
        await translate(batch);
        completed += batch.length;
        // JavaScript callbacks serialize these writes; a failed batch preserves
        // all previously completed work and never publishes application data.
        fs.writeFileSync(file + ".tmp", JSON.stringify(cache));
        fs.renameSync(file + ".tmp", file);
        if (completed % 512 === 0 || completed === pending.length)
          console.log("Translated", completed, "/", pending.length);
      }
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
