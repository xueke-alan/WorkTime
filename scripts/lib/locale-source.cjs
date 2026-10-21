"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
function readCatalogs() {
  const context = { WorkTimeApp: { data: {} } };
  for (const name of ["zh-CN", "en", "content-en"])
    vm.runInNewContext(
      fs.readFileSync(
        path.join(root, "assets/js/locales/" + name + ".js"),
        "utf8",
      ),
      context,
    );
  return context.WorkTimeApp.data;
}
// Legacy catalogs contain HTML fragments. Only visible text and accessible
// attributes belong to translators; selectors, identifiers and markup do not.
function translateMarkup(text, translate) {
  const attributes = (part) =>
    part.replace(
      /((?:title|aria-label|placeholder)=")([^"]*)("|$)/g,
      (_, before, value, after) => before + translate(value) + after,
    );
  return text
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (part.startsWith("<")) return attributes(part);
      // A few legacy messages begin in the middle of an attribute or tag.
      if (part.includes('="') || part.includes('">'))
        return part.includes('="')
          ? attributes(part)
          : part.replace(
              /^([^<>]*)(">)/,
              (_, value, end) => translate(value) + end,
            );
      return translate(part);
    })
    .join("");
}
function phrases() {
  const data = readCatalogs(),
    all = new Set();
  const collect = (text) => {
    const value = text.trim();
    if (
      /[A-Za-z]/.test(value) &&
      !/^(?:worktime-|https?:|CC BY-SA|°C|h$|HH:MM|12:00|13:00)/.test(value)
    )
      all.add(value);
    return text;
  };
  for (const value of Object.values(data.locales.en))
    translateMarkup(value, collect);
  for (const value of Object.values(data.contentEnglish)) collect(value);
  return [...all];
}
module.exports = { root, readCatalogs, translateMarkup, phrases };
