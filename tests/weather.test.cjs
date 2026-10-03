"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { snapshot } = require("./helpers/baidu-weather.cjs");
const context = {
  document: { getElementById: () => null, addEventListener() {} },
  addEventListener() {},
};
context.window = context;
for (const file of [
  "assets/data/weather-cities.js",
  "assets/js/weather-config.js",
  "assets/js/weather.js",
])
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"),
    context,
  );
const weather = context.WorkWeather,
  cities = context.WorkWeatherCities.cities;
assert.equal(cities.length, 10);
const districts = [
  "441900",
  "310118",
  "440307",
  "510117",
  "610113",
  "320114",
  "330108",
  "110108",
  "420115",
  "320571",
];
assert.deepEqual(
  Array.from(cities, (city) => city.districtId),
  districts,
);
for (const city of cities) {
  assert.equal(city.label, city.name);
  const record = weather.normalize(snapshot(), city);
  assert.equal(record.source, "百度天气");
  assert.equal(record.cityId, city.id);
  assert.equal(record.validAt, "2026-10-03T12:15:00+08:00");
  assert.equal(record.current.apparentTemperature, null);
  assert.equal(record.current.windClass, "3级");
  assert.equal(record.current.windDirectionText, "东北风");
  assert.equal(record.hourly.length, 24);
  assert.equal(record.hourly[0].time, "2026-10-03T12:00:00+08:00");
  assert.equal(record.daily.length, 5);
  assert.equal(record.daily[0].precipitationProbability, null);
  assert(weather.validRecord(record, city.id));
  assert(!weather.validRecord({ ...record, source: "old-source" }, city.id));
  assert.equal(weather.normalize(snapshot(false), city).hourly.length, 0);
}
const invalid = snapshot();
const compactTime = snapshot();
compactTime.cities.dongguan.result.forecast_hours[0].data_time =
  "20261003120000";
assert.equal(
  weather.normalize(compactTime, cities[0]).hourly[0].time,
  "2026-10-03T12:00:00+08:00",
);
invalid.cities.dongguan.districtId = "110101";
assert.throws(() => weather.normalize(invalid, cities[0]), /不完整/);
const badTemperature = snapshot();
badTemperature.cities.dongguan.result.now.temp = 999999;
assert.throws(() => weather.normalize(badTemperature, cities[0]), /不完整/);
assert.equal(context.WorkWeatherConfig.staleAfterMs, 7200000);
assert.equal(weather.resolveCity("上海市").name, "上海");
assert.equal(weather.resolveCity("未知城市"), null);
console.log(
  "Baidu weather: ten office districts, sentinel fields, optional forecasts, cache isolation passed",
);
