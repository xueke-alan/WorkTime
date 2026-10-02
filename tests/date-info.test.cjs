"use strict";
const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert"),
  path = require("path");
const root = path.resolve(__dirname, "..");
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
function load(p) {
  vm.runInContext(fs.readFileSync(path.join(root, p), "utf8"), ctx, {
    filename: p,
  });
}
load("assets/vendor/lunar.js");
load("assets/data/sources.js");
load("assets/data/festivals.js");
load("assets/data/international-festivals.js");
for (let m = 1; m <= 12; m++)
  load("assets/data/history/" + String(m).padStart(2, "0") + ".js");
load("assets/js/date-info.js");
const ids = new Set();
let count = 0;
for (let m = 1; m <= 12; m++)
  for (let d = 1; d <= new Date(2024, m, 0).getDate(); d++) {
    const key = String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"),
      events = ctx.DateInfoData.history[key];
    assert(events && events.length >= 3 && events.length <= 5, key);
    const duplicates = new Set();
    for (const e of events) {
      assert(Number.isInteger(e.year) && e.text && e.sourceName && e.id);
      assert(!ids.has(e.id), "Duplicate ID");
      ids.add(e.id);
      assert(/^https:\/\//.test(e.sourceUrl));
      assert(!duplicates.has(e.year + "|" + e.text));
      duplicates.add(e.year + "|" + e.text);
      count++;
    }
  }
const api = ctx.DateInfo,
  rows = (date, id = "festivals") => api.getContent(id, date).rows;
assert(rows("2026-02-17").some((x) => x[1].includes("春节")));
assert(rows("2026-02-16").some((x) => x[1].includes("除夕")));
assert(rows("2026-04-05").some((x) => x[1].includes("清明")));
assert(rows("2026-12-22").some((x) => x[1].includes("冬至")));
assert(rows("2026-05-10").some((x) => x[1].includes("母亲节")));
assert(api.lunar("2023-03-22").getMonth() === -2);
for (const date of ["1900-01-01", "2100-12-31", "2026-12-31", "2027-01-01"]) {
  assert(api.getContent("almanac", date).ok, date);
  assert(api.getContent("festivals", date).ok, date);
}
assert(!api.getContent("almanac", "1899-12-31").ok);
assert(!api.getContent("festivals", "2101-01-01").ok);
assert(!api.getContent("history", "2026-02-29").ok);
assert(
  api.getContent("history", "1900-01-01").events.every((e) => e.year <= 1900),
);
ctx.DateInfoData.festivals.push({
  id: "mother",
  kind: "weekday",
  month: 5,
  week: 2,
  weekday: 0,
  name: "自定义母亲节",
});
assert(rows("2026-05-10").some((x) => x[1].includes("自定义母亲节")));
api.register({
  id: "broken",
  label: "坏模块",
  getContent() {
    throw Error("test");
  },
});
assert(!api.getContent("broken", "2026-01-01").ok);
assert(api.getContent("almanac", "2026-01-01").ok);
const saved = ctx.DateInfoData.history["01-01"];
delete ctx.DateInfoData.history["01-01"];
assert(!api.getContent("history", "2026-01-01").ok);
ctx.DateInfoData.history["01-01"] = saved;
console.log(
  "Date info checks passed: 366 dates, " + count + " attributed events",
);

assert.strictEqual(
  Object.keys(ctx.DateInfoData.internationalByDate).length,
  366,
);
const observanceIds = new Set();
for (const [date, items] of Object.entries(
  ctx.DateInfoData.internationalByDate,
)) {
  assert(ctx.DateInfoData.history[date]);
  const names = new Set();
  for (const item of items) {
    assert(item.id && item.name && item.sourceName);
    assert(!observanceIds.has(item.id));
    observanceIds.add(item.id);
    assert(!names.has(item.name));
    names.add(item.name);
    assert(item.url.startsWith("https://zh.wikipedia.org/zh-cn/"));
    assert(item.sourceUrl.includes("oldid="));
  }
}
assert(
  api
    .getContent("festivals", "2026-10-01")
    .sections.find((x) => x.kind === "international")
    .links.some((x) => x.text === "国际咖啡日"),
);
assert.strictEqual(
  api
    .getContent("festivals", "2026-04-05")
    .sections.find((x) => x.kind === "terms").rows.length,
  1,
);
assert.strictEqual(
  api.getContent("festivals", "2026-10-01").sections[1].rows.length,
  2,
);
assert(
  !JSON.stringify(api.getContent("festivals", "2026-10-01")).includes(
    "当日无节气",
  ),
);
