"use strict";
const fs = require("node:fs");
const path = require("node:path");
const books = ["daily", "cet6", "kaoyan", "toefl", "ielts"];
function parseCSV(text) {
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (c === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
function sourceRows(text) {
  const records = parseCSV(text),
    headers = records.shift();
  return records
    .map((values) =>
      Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])),
    )
    .filter(
      (r) => /^[a-z][a-z '-]{0,49}$/.test(r.word) && r.translation.trim(),
    );
}
function memberships(row) {
  const tags = row.tag.split(/\s+/);
  return books.filter(
    (b) => b !== "daily" && tags.includes(b === "kaoyan" ? "ky" : b),
  );
}
function targetWords() {
  const root = path.resolve(__dirname, "../..");
  const rows = sourceRows(
    fs.readFileSync(path.join(root, ".cache/vocabulary/ecdict.csv"), "utf8"),
  );
  const daily = rows
    .filter((r) => Number(r.frq) > 0 && !r.word.includes(" "))
    .sort((a, b) => Number(a.frq) - Number(b.frq))
    .slice(0, 3000);
  const result = new Set(
    [...rows.filter((r) => memberships(r).length), ...daily].map((r) =>
      r.word.toLowerCase(),
    ),
  );
  for (const [word] of require("./phrases.json"))
    result.add(word.toLowerCase());
  return result;
}
module.exports = { books, parseCSV, sourceRows, memberships, targetWords };
