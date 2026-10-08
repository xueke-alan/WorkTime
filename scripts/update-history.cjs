"use strict";
const crypto = require("crypto");
const { create, validateDates } = require("./data-update.cjs");
const { dates, stripReferences, fetchPages } = require("./lib/wiki-source.cjs");
const toSimplified = require("./vendor/opencc-t2cn.cjs").Converter({
  from: "tw",
  to: "cn",
});
function parse(page) {
  const text = page.revisions[0].slots.main["*"].replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  const section = text
    .split(/==\s*大事[记紀紀记記]\s*==/)[1]
    ?.split(/\n==[^=]/)[0];
  if (!section) throw Error("Missing events: " + page.title);
  const pool = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\*\s*(?:\[\[)?(前?\d+)年(?:\]\])?\s*[：:]/);
    if (!m || line.includes("{{")) continue;
    const year = m[1].startsWith("前") ? -Number(m[1].slice(1)) : Number(m[1]);
    if (year > 2025) continue;
    const body = stripReferences(line.slice(m[0].length))
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
      .replace(/<[^>]*>/g, "")
      .replace(/'{2,}/g, "")
      .trim();
    if (body.length < 12 || body.includes("[[") || body.includes("}}"))
      continue;
    pool.push({ year, text: body });
  }
  if (pool.length < 3) throw Error("Insufficient events " + page.title);
  // Keep all usable events instead of sampling a handful from each date.
  const picks = [
    ...new Map(
      pool.map((e) => [e.year + "|" + toSimplified(e.text), e]),
    ).values(),
  ].sort((a, b) => a.year - b.year);
  const dateUrl =
    "https://zh.wikipedia.org/wiki/" + encodeURIComponent(page.title);
  return picks.map((e) => ({
    ...e,
    text: toSimplified(e.text),
    id:
      "wiki-" +
      page.title +
      "-" +
      crypto
        .createHash("sha256")
        .update(e.year + "|" + e.text)
        .digest("hex")
        .slice(0, 12),
    sourceUrl: dateUrl + "?oldid=" + page.revisions[0].revid + "&variant=zh-cn",
    sourceName: "中文维基百科 · " + page.title,
    sourceDateUrl: dateUrl.replace("/wiki/", "/zh-cn/"),
  }));
}
(async () => {
  const update = create({ kind: "history" });
  const months = Array.from({ length: 12 }, () => ({}));
  for (let i = 0; i < dates.length; i += 20) {
    const j = await fetchPages(dates.slice(i, i + 20));
    update.capture("batch-" + i, j);
    for (const page of Object.values(j.query.pages)) {
      const md = page.title.match(/(\d+)月(\d+)日/),
        mm = md[1].padStart(2, "0"),
        dd = md[2].padStart(2, "0");
      months[Number(mm) - 1][mm + "-" + dd] = parse(page);
    }
    console.log("Sourced dates", Math.min(i + 20, 366) + "/366");
    await new Promise((r) => setTimeout(r, 600));
  }
  validateDates(Object.assign({}, ...months), "history");
  for (let i = 0; i < 12; i++)
    update.write(
      "assets/data/history/" + String(i + 1).padStart(2, "0") + ".js",
      "Object.assign(WorkTimeApp.data.dateInfo.history," +
        JSON.stringify(months[i], null, 2) +
        ");\n",
    );
  console.log(update.commit({ dryRun: process.argv.includes("--dry-run") }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
