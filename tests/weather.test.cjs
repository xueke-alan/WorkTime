"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const {
  estimate,
  normalize,
  update,
  request,
} = require("../scripts/update-weather.cjs");
const context = {};
vm.runInNewContext(
  fs.readFileSync(
    path.resolve(__dirname, "../assets/data/weather-cities.js"),
    "utf8",
  ),
  context,
);
const cities = context.WorkWeatherCities.cities;
const now = new Date("2026-10-03T04:17:00Z");
function raw() {
  return {
    utc_offset_seconds: 28800,
    current: {
      time: "2026-10-03T12:15",
      temperature_2m: 23,
      apparent_temperature: null,
      relative_humidity_2m: 60,
      weather_code: 2,
      wind_speed_10m: 3,
      wind_direction_10m: 90,
    },
    hourly: {
      time: Array.from({ length: 48 }, (_, i) =>
        new Date(Date.UTC(2026, 9, 3) + i * 3600000).toISOString().slice(0, 16),
      ),
      temperature_2m: Array(48).fill(24),
      precipitation_probability: Array(48).fill(20),
    },
    daily: {
      time: Array.from(
        { length: 7 },
        (_, i) => "2026-10-" + String(3 + i).padStart(2, "0"),
      ),
      weather_code: Array(7).fill(2),
      temperature_2m_max: Array(7).fill(25),
      temperature_2m_min: Array(7).fill(18),
      precipitation_probability_max: Array(7).fill(30),
    },
  };
}
(async () => {
  assert(cities.length >= 6);
  assert.equal(new Set(cities.map((c) => c.id)).size, cities.length);
  assert.equal(cities.find((c) => c.name === "西安").province, "陕西省");
  const selectedIds = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../assets/data/weather-locations.json"),
    ),
  );
  assert.deepEqual(
    Array.from(cities, (c) => c.id),
    selectedIds,
  );
  assert.equal(estimate(6).callsPerDay, 173);
  const record = normalize(cities[0], raw(), now.toISOString());
  assert.equal(record.hourly.length, 24);
  assert.equal(record.hourly[0].time, "2026-10-03T12:00+08:00");
  assert.equal(record.daily.length, 7);
  assert.equal(record.current.apparentTemperature, null);
  assert.throws(() => normalize(cities[0], {}, now.toISOString()));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "worktime-weather-"));
  try {
    let calls = 0;
    await assert.rejects(
      update({
        cities: Array(1000).fill(cities[0]),
        key: "",
        output: folder,
        request: async () => {
          calls++;
        },
      }),
      /免费额度/,
    );
    assert.equal(calls, 0);
    const all = await update({
      cities,
      key: "",
      output: folder,
      now,
      request: async (batch) => batch.map(raw),
    });
    assert.equal(all.updated, cities.length);
    assert.equal(
      Object.keys(all.provinces).length,
      new Set(cities.map((c) => c.provinceId)).size,
    );
    const before = fs.readFileSync(
      path.join(folder, cities[0].provinceId + ".json"),
      "utf8",
    );
    const beforeIndex = fs.readFileSync(
      path.join(folder, "index.json"),
      "utf8",
    );
    await assert.rejects(
      update({
        cities,
        key: "",
        output: folder,
        now,
        request: async () => {
          throw Error("offline");
        },
      }),
      /全部城市/,
    );
    assert.equal(
      fs.readFileSync(path.join(folder, "index.json"), "utf8"),
      beforeIndex,
    );
    const partial = await update({
      cities,
      key: "",
      output: folder,
      now: new Date(now.getTime() + 3600000),
      request: async (batch) => batch.map((_, i) => (i ? raw() : {})),
    });
    assert.equal(partial.updated, cities.length - 1);
    assert.deepEqual(partial.failed, [cities[0].id]);
    const retained = JSON.parse(
      fs.readFileSync(path.join(folder, cities[0].provinceId + ".json")),
    );
    assert.deepEqual(
      retained.cities[cities[0].id],
      JSON.parse(before).cities[cities[0].id],
    );
    let retries = 0;
    await assert.rejects(
      request([cities[0]], "secret-test", {
        sleep: async () => {},
        fetch: async (url) => {
          assert.equal(url.hostname, "customer-api.open-meteo.com");
          retries++;
          throw Error(String(url));
        },
      }),
      (error) => !error.message.includes("secret-test"),
    );
    assert.equal(retries, 3);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  const files = path.resolve(__dirname, "../assets/data/weather");
  const index = JSON.parse(fs.readFileSync(path.join(files, "index.json")));
  for (const city of cities) {
    const province = JSON.parse(
      fs.readFileSync(path.join(files, index.provinces[city.provinceId])),
    );
    assert.equal(province.version, index.version);
    assert.equal(province.cities[city.id].cityId, city.id);
  }
  console.log(
    "weather: directory, quota, timestamps, partial failures, total failures, retries passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
