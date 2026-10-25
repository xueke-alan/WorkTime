"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(process.argv[2] || ".");
const source = require(path.join(root, "assets/vendor/lunar.js"));
const runtime = require(path.join(root, "assets/vendor/lunar.min.js"));
assert.deepEqual(Object.keys(runtime).sort(), Object.keys(source).sort());
function describe(library, year, month, day) {
  const solar = library.Solar.fromYmd(year, month, day);
  const lunar = solar.getLunar();
  return {
    solar: solar.toFullString(),
    lunar: lunar.toFullString(),
    term: lunar.getJieQi(),
    festivals: lunar.getFestivals(),
    suitable: lunar.getDayYi(),
    unsuitable: lunar.getDayJi(),
  };
}
let count = 0;
for (let year = 1900; year <= 2100; year++) {
  for (let month = 1; month <= 12; month++) {
    for (const day of new Set([1, 15, new Date(year, month, 0).getDate()])) {
      assert.deepEqual(
        describe(runtime, year, month, day),
        describe(source, year, month, day),
        `${year}-${month}-${day}: compact lunar runtime differs from source`,
      );
      count++;
    }
  }
}
console.log(
  `Compact lunar exports, calendar, festivals, solar terms and almanac match upstream for ${count} dates across 1900–2100.`,
);
