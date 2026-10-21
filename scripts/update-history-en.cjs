"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { create, validateDates } = require("./data-update.cjs");
const { stripReferences, fetchPages } = require("./lib/wiki-source.cjs");
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month, 1)),
  ),
);
function parse(page) {
  const text = stripReferences(page.revisions[0].slots.main["*"]);
  const section = text
    .split(/^==\s*Events\s*==\s*$/m)[1]
    ?.split(/^==[^=].*==\s*$/m)[0];
  if (!section) throw Error("Missing Events section: " + page.title);
  const sourceUrl =
    "https://en.wikipedia.org/wiki/" +
    encodeURIComponent(page.title.replaceAll(" ", "_")) +
    "?oldid=" +
    page.revisions[0].revid;
  const items = [];
  for (const line of section.split("\n")) {
    const plain = line
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_, target, label) => label || target,
      )
      .replace(/&ndash;|&mdash;|\{\{ndash\}\}/g, "–");
    const match =
      /^\*\s*(?:AD\s+)?(\d+)\s*(BC|BCE|AD|CE)?\s*[–—-]\s*(.+)$/.exec(plain);
    if (!match) continue;
    const year = Number(match[1]) * (/^BC/.test(match[2] || "") ? -1 : 1);
    if (year > 2025) continue;
    const body = match[3]
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_, target, label) => label || target,
      )
      .replace(/\{\{(?:ndash|snd|spaced ndash)\}\}/gi, "–")
      .replace(
        /\{\{(?:nowrap|small|circa|c\.|lang\|[^|]+)\|([^{}]*)\}\}/gi,
        "$1",
      )
      .replace(/<[^>]*>/g, "")
      .replace(/'{2,}/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&ndash;/g, "–")
      .replace(/&mdash;/g, "—")
      .trim();
    if (body.length < 12 || /\[\[|\]\]|\{\{|\}\}/.test(body)) continue;
    items.push({
      year,
      text: body,
      id:
        "wiki-en-" +
        crypto
          .createHash("sha256")
          .update(page.title + "|" + year + "|" + body)
          .digest("hex")
          .slice(0, 16),
      sourceUrl,
      sourceName: "English Wikipedia · " + page.title,
      sourceDateUrl: sourceUrl.split("?")[0],
    });
  }
  if (items.length < 3)
    throw Error("Insufficient English events: " + page.title);
  return [...new Map(items.map((event) => [event.id, event])).values()].sort(
    (a, b) => a.year - b.year,
  );
}
async function main() {
  const storage = path.resolve(".refactor-data-updates");
  const resume =
    process.argv.includes("--resume") && fs.existsSync(storage)
      ? fs
          .readdirSync(storage)
          .filter((name) => name.startsWith("historyen-"))
          .sort()
          .at(-1)
      : null;
  const update = create({ kind: "historyEn" });
  const days = Array.from({ length: 12 }, (_, month) =>
    Array.from(
      { length: new Date(2024, month + 1, 0).getDate() },
      (_, day) => ({
        month,
        day: day + 1,
        title: monthNames[month] + " " + (day + 1),
      }),
    ),
  ).flat();
  const months = Array.from({ length: 12 }, () => ({}));
  for (let offset = 0; offset < days.length; offset += 20) {
    const batch = days.slice(offset, offset + 20);
    const cached =
      resume && path.join(storage, resume, "batch-" + offset + ".json");
    const response =
      cached && fs.existsSync(cached)
        ? JSON.parse(fs.readFileSync(cached, "utf8"))
        : await fetchPages(
            batch.map((day) => day.title),
            { language: "en" },
          );
    update.capture("batch-" + offset, response);
    for (const day of batch) {
      const page = Object.values(response.query.pages).find(
        (page) => page.title === day.title,
      );
      if (!page) throw Error("Missing page: " + day.title);
      months[day.month][
        String(day.month + 1).padStart(2, "0") +
          "-" +
          String(day.day).padStart(2, "0")
      ] = parse(page);
    }
    console.log("English history dates:", Math.min(offset + 20, 366) + "/366");
    if (!cached || !fs.existsSync(cached))
      await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  validateDates(Object.assign({}, ...months), "historyEn");
  for (let month = 0; month < 12; month++)
    update.write(
      "assets/data/history/en/" + String(month + 1).padStart(2, "0") + ".js",
      "WorkTimeApp.data.dateInfo.historyEn ||= {};\nObject.assign(WorkTimeApp.data.dateInfo.historyEn," +
        JSON.stringify(months[month], null, 2) +
        ");\n",
    );
  console.log(update.commit({ dryRun: process.argv.includes("--dry-run") }));
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { parse };
