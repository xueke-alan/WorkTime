"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const acorn = require("acorn");
const { validateDates } = require("./data-update.cjs");
const root = path.resolve(__dirname, "..");
function checkI18n() {
  const context = vm.createContext({
    WorkTimeApp: { data: { dateInfo: { festivals: [], historyEn: {} } } },
  });
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const run = (file) =>
    vm.runInContext(read(file), context, { filename: file });
  run("assets/js/language-config.js");
  for (const locale of [
    "zh-CN",
    "en",
    "zh-TW",
    "zh-HK",
    "ko",
    "ja",
    "content-en",
    "content-zh-TW",
    "content-zh-HK",
    "content-ko",
    "content-ja",
    "additions",
    "sudoku",
    "jump",
    "sokoban",
    "link",
    "garden",
  ])
    run("assets/js/locales/" + locale + ".js");
  const catalogs = context.WorkTimeApp.data.locales;
  const zh = catalogs["zh-CN"],
    en = catalogs.en;
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(zh).sort(),
    "Language catalogs must have matching keys",
  );
  const parameters = (text) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const tags = (text) =>
    [...text.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)].map((match) =>
      match[0].startsWith("</") ? "/" + match[1] : match[1],
    );
  for (const key of Object.keys(zh)) {
    assert.equal(typeof en[key], "string", key);
    assert.ok(
      !/[\u3400-\u9fff]/.test(en[key]),
      "Untranslated English message: " + key,
    );
    assert.deepEqual(
      parameters(en[key]),
      parameters(zh[key]),
      "Message parameters: " + key,
    );
    assert.deepEqual(
      tags(en[key]),
      tags(zh[key]),
      "Translation must preserve markup: " + key,
    );
  }
  for (const { id } of context.WorkTimeApp.data.languages) {
    const catalog = catalogs[id];
    assert.deepEqual(
      Object.keys(catalog).sort(),
      Object.keys(zh).sort(),
      id + " keys",
    );
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, "string", id + ": " + key);
      assert.deepEqual(
        parameters(value),
        parameters(zh[key]),
        id + " parameters: " + key,
      );
      assert.deepEqual(tags(value), tags(zh[key]), id + " markup: " + key);
      if (id !== "zh-CN" && id !== "en")
        assert.ok(value.trim() || !en[key].trim(), id + " empty: " + key);
    }
  }
  const files = ["assets/js", "tools"].flatMap((directory) =>
    fs
      .readdirSync(path.join(root, directory), { recursive: true })
      .filter((file) => file.endsWith(".js"))
      .map((file) => directory + "/" + file.replaceAll("\\", "/")),
  );
  for (const file of files) {
    if (file.includes("/locales/")) continue;
    const ast = acorn.parse(read(file), { ecmaVersion: "latest" });
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property.name === "t" &&
        node.arguments[0]?.type === "Literal" &&
        typeof node.arguments[0].value === "string"
      ) {
        const key = node.arguments[0].value;
        assert.ok(
          Object.hasOwn(zh, key),
          "Unknown translation key in " + file + ": " + key,
        );
      }
      for (const value of Object.values(node))
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
    }
    visit(ast);
  }
  for (const file of ["index.html", "tools/convert-backup.html"]) {
    for (const match of read(file).matchAll(
      /data-i18n-(?:title|aria-label|placeholder)="([^"]+)"/g,
    ))
      assert.ok(Object.hasOwn(zh, match[1]), file + ": " + match[1]);
    for (const match of read(file).matchAll(/data-i18n-text='([^']+)'/g))
      for (const key of Object.values(JSON.parse(match[1])))
        assert.ok(Object.hasOwn(zh, key), file + ": " + key);
  }
  run("assets/data/festivals.js");
  run("assets/data/international-festivals.js");
  run("assets/data/weather-cities.js");
  run("assets/vendor/lunar.js");
  const data = context.WorkTimeApp.data;
  const names = new Set([
    ...data.dateInfo.festivals.map((item) => item.name),
    ...data.dateInfo.internationalFestivals,
    ...Object.values(data.dateInfo.internationalByDate)
      .flat()
      .map((item) => item.name),
    ...Object.values(context.SolarUtil.FESTIVAL),
    ...Object.values(context.SolarUtil.WEEK_FESTIVAL),
    ...Object.values(context.LunarUtil.FESTIVAL),
    ...context.LunarUtil.JIE_QI,
    ...data.weatherCities.cities.flatMap((city) => [
      city.name,
      city.province,
      city.district,
      city.office,
    ]),
  ]);
  for (const name of names)
    for (const { id } of data.languages) {
      if (id === "zh-CN") continue;
      assert.ok(
        (id === "en" ? data.contentEnglish : data.contentLocales[id])[name],
        "Missing " + id + " content: " + name,
      );
    }
  for (let month = 1; month <= 12; month++)
    run("assets/data/history/en/" + String(month).padStart(2, "0") + ".js");
  validateDates(data.dateInfo.historyEn, "historyEn");
  for (const language of ["zh-TW", "zh-HK"]) {
    for (let month = 1; month <= 12; month++)
      run(
        "assets/data/history/" +
          language +
          "/" +
          String(month).padStart(2, "0") +
          ".js",
      );
    // Regional names can be shorter (e.g. 烏茲別克); preserve upstream events.
    validateDates(data.dateInfo.historyLocales[language], "history", {
      minTextLength: 8,
    });
  }
  console.log(
    "Six catalogs, parameters, markup, content coverage and 366 dates in each history variant verified.",
  );
}
if (require.main === module) checkI18n();
module.exports = { checkI18n };
