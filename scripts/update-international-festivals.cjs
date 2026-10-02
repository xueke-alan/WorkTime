"use strict";
const crypto = require("crypto");
const { create, validateDates } = require("./data-update.cjs");
const convert = require("./vendor/opencc-t2cn.cjs").Converter({
  from: "tw",
  to: "cn",
});
const dates = [];
for (let m = 1; m <= 12; m++)
  for (let d = 1; d <= new Date(2024, m, 0).getDate(); d++)
    dates.push(`${m}月${d}日`);
function parse(page) {
  const raw = page.revisions?.[0]?.slots.main["*"] || "",
    section =
      raw
        .split(/==\s*[节節]假日[\s和與及习習俗]*\s*==/)[1]
        ?.split(/\n==[^=]/)[0] || "",
    items = [];
  for (const line of section.split("\n")) {
    if (!/^\*\s/.test(line)) continue;
    let clean = convert(
      line
        .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, "")
        .replace(/<ref[^>]*\/>/g, "")
        .replace(/<!--[\s\S]*?-->/g, ""),
    );
    if (/\{\{/.test(clean)) continue;
    const links = [...clean.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)];
    clean = clean
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
      .replace(/^\*\s*/, "")
      .replace(/'{2,}/g, "")
      .trim();
    if (!/^(国际|世界|全球|联合国)/.test(clean)) continue;
    const name = clean.split(/[：:，,。；;(（]/)[0].trim();
    if (name.length > 35 || name.length < 3 || !/[日节周]$/.test(name))
      continue;
    const target = links.find((x) => (x[2] || x[1]) === name)?.[1];
    const url =
      "https://zh.wikipedia.org/zh-cn/" +
      encodeURIComponent(target || page.title);
    items.push({
      id:
        "wiki-observance-" +
        crypto
          .createHash("sha256")
          .update(page.title + "|" + name)
          .digest("hex")
          .slice(0, 16),
      name,
      url,
      sourceName: "中文维基百科",
      sourceUrl:
        "https://zh.wikipedia.org/zh-cn/" +
        encodeURIComponent(page.title) +
        "?oldid=" +
        page.revisions[0].revid,
      category: "international",
    });
  }
  return [...new Map(items.map((x) => [x.name, x])).values()];
}
(async () => {
  const update = create({ kind: "internationalFestivals" });
  const days = {};
  for (let i = 0; i < dates.length; i += 20) {
    let j;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(
          "https://zh.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content%7Cids&rvslots=main&format=json&titles=" +
            encodeURIComponent(dates.slice(i, i + 20).join("|")),
          { signal: AbortSignal.timeout(40000) },
        );
        if (!r.ok) throw Error("HTTP " + r.status);
        j = await r.json();
        if (!j.query) throw Error("Missing query");
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    update.capture("batch-" + i, j);
    for (const p of Object.values(j.query.pages)) {
      const [, m, d] = p.title.match(/(\d+)月(\d+)日/);
      days[m.padStart(2, "0") + "-" + d.padStart(2, "0")] = parse(p);
    }
    console.log("Checked", Math.min(i + 20, 366), "/366");
    await new Promise((r) => setTimeout(r, 600));
  }
  const sorted = Object.fromEntries(Object.entries(days).sort());
  validateDates(sorted, "internationalFestivals");
  update.write(
    "assets/data/international-festivals.js",
    "/* Wikipedia daily observances, CC BY-SA 4.0; retrieved " +
      update.date +
      ". */\nDateInfoData.internationalByDate=" +
      JSON.stringify(sorted, null, 2) +
      ";\n",
  );
  console.log(update.commit({ dryRun: process.argv.includes("--dry-run") }));
  console.log(
    "Validated",
    Object.values(days).flat().length,
    "observances across",
    Object.values(days).filter((x) => x.length).length,
    "dates; checked",
    Object.keys(days).length,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
