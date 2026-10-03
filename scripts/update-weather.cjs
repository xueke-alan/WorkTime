"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const directoryContext = {};
vm.runInNewContext(
  fs.readFileSync(
    path.resolve(__dirname, "../assets/data/weather-cities.js"),
    "utf8",
  ),
  directoryContext,
);
const directory = directoryContext.WorkWeatherCities;
const currentFields = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
];
const hourlyFields = ["temperature_2m", "precipitation_probability"];
const dailyFields = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
];
const variableCount =
  currentFields.length + hourlyFields.length + dailyFields.length;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function estimate(count) {
  const perLocation = Math.max(1, variableCount / 10);
  return {
    cities: count,
    variables: variableCount,
    callsPerRun: Math.ceil(count * perLocation),
    callsPerDay: Math.ceil(count * perLocation * 24),
    callsPer31Days: Math.ceil(count * perLocation * 24 * 31),
  };
}
function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function normalize(city, raw, fetchedAt) {
  if (
    !raw?.current ||
    !Array.isArray(raw.hourly?.time) ||
    !Array.isArray(raw.daily?.time) ||
    raw.utc_offset_seconds !== 28800 ||
    !Number.isFinite(Date.parse(raw.current.time + "+08:00")) ||
    number(raw.current.temperature_2m) === null ||
    raw.daily.time.length < 7
  )
    throw Error("天气响应缺少必要字段");
  const hours = raw.hourly.time.map((time, i) => ({
    time: time + "+08:00",
    temperature: number(raw.hourly.temperature_2m?.[i]),
    precipitationProbability: number(raw.hourly.precipitation_probability?.[i]),
  }));
  const cutoff = Math.floor(Date.parse(fetchedAt) / 3600000) * 3600000;
  const hourly = hours
    .filter((row) => Date.parse(row.time) >= cutoff)
    .slice(0, 24);
  if (
    hourly.length !== 24 ||
    hourly.some((row) => !Number.isFinite(Date.parse(row.time)))
  )
    throw Error("逐小时预报不足24小时");
  return {
    cityId: city.id,
    name: city.label,
    fetchedAt,
    validAt: raw.current.time + "+08:00",
    timezone: "Asia/Shanghai",
    units: {
      temperature: "°C",
      humidity: "%",
      wind: "m/s",
      precipitationProbability: "%",
    },
    source: "Open-Meteo",
    sourceUrl: "https://open-meteo.com/",
    license: "CC BY 4.0",
    current: {
      temperature: number(raw.current.temperature_2m),
      apparentTemperature: number(raw.current.apparent_temperature),
      humidity: number(raw.current.relative_humidity_2m),
      weatherCode: number(raw.current.weather_code),
      windSpeed: number(raw.current.wind_speed_10m),
      windDirection: number(raw.current.wind_direction_10m),
    },
    hourly,
    daily: raw.daily.time.slice(0, 7).map((date, i) => ({
      date,
      weatherCode: number(raw.daily.weather_code?.[i]),
      high: number(raw.daily.temperature_2m_max?.[i]),
      low: number(raw.daily.temperature_2m_min?.[i]),
      precipitationProbability: number(
        raw.daily.precipitation_probability_max?.[i],
      ),
    })),
  };
}
async function request(cities, key, options = {}) {
  const url = new URL(
    key
      ? "https://customer-api.open-meteo.com/v1/forecast"
      : "https://api.open-meteo.com/v1/forecast",
  );
  for (const [name, value] of Object.entries({
    latitude: cities.map((c) => c.latitude).join(","),
    longitude: cities.map((c) => c.longitude).join(","),
    current: currentFields.join(","),
    hourly: hourlyFields.join(","),
    daily: dailyFields.join(","),
    forecast_days: "7",
    timezone: "Asia/Shanghai",
    temperature_unit: "celsius",
    wind_speed_unit: "ms",
  }))
    url.searchParams.set(name, value);
  if (key) url.searchParams.set("apikey", key);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await (options.fetch || fetch)(url, {
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error("天气接口返回 " + response.status);
      const raw = await response.json();
      const rows = Array.isArray(raw) ? raw : [raw];
      if (rows.length !== cities.length)
        throw Error("天气接口返回地点数量不匹配");
      return rows;
    } catch {
      if (attempt === 2) throw Error("天气请求在3次尝试后失败");
      await (options.sleep || sleep)(2000 * 2 ** attempt);
    }
  }
}
async function update(options = {}) {
  const cities = options.cities || directory.cities;
  const key = options.key ?? process.env.OPEN_METEO_API_KEY;
  const budget = estimate(cities.length);
  if (
    !key &&
    (budget.callsPerDay > 10000 ||
      budget.callsPerRun > 5000 ||
      budget.callsPer31Days > 300000)
  )
    throw Error(
      "每小时全国更新超出免费额度，请配置 OPEN_METEO_API_KEY。估算: " +
        JSON.stringify(budget),
    );
  const output =
    options.output || path.resolve(__dirname, "../assets/data/weather");
  const fetchedAt = (options.now || new Date()).toISOString();
  const version = crypto.randomUUID();
  const provinces = {};
  for (const city of cities) {
    if (provinces[city.provinceId]) continue;
    let old = {};
    try {
      old =
        JSON.parse(
          fs.readFileSync(path.join(output, city.provinceId + ".json"), "utf8"),
        ).cities || {};
    } catch {}
    provinces[city.provinceId] = {
      schemaVersion: 1,
      version,
      province: city.province,
      cities: { ...old },
    };
  }
  let updated = 0;
  const failed = [];
  for (let offset = 0; offset < cities.length; offset += 30) {
    const batch = cities.slice(offset, offset + 30);
    let rows;
    try {
      rows = await (options.request || request)(batch, key);
    } catch {
      failed.push(...batch.map((c) => c.id));
    }
    if (rows)
      batch.forEach((city, i) => {
        try {
          provinces[city.provinceId].cities[city.id] = normalize(
            city,
            rows[i],
            fetchedAt,
          );
          updated++;
        } catch {
          failed.push(city.id);
        }
      });
    if (offset + 30 < cities.length) await (options.sleep || sleep)(4000);
  }
  if (!updated) throw Error("全部城市抓取失败；已保留现有数据");
  fs.mkdirSync(output, { recursive: true });
  const files = {};
  for (const [id, province] of Object.entries(provinces)) {
    fs.writeFileSync(path.join(output, id + ".json"), JSON.stringify(province));
    files[id] = id + ".json";
  }
  const index = {
    schemaVersion: 1,
    version,
    generatedAt: fetchedAt,
    cityDirectoryVersion: directory.version,
    updated,
    failed,
    provinces: files,
    source: "Open-Meteo",
    license: "CC BY 4.0",
    budget,
  };
  fs.writeFileSync(
    path.join(output, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  return index;
}
if (require.main === module) {
  if (process.argv.includes("--estimate"))
    console.log(JSON.stringify(estimate(directory.cities.length), null, 2));
  else
    update()
      .then((result) =>
        console.log(
          JSON.stringify({
            updated: result.updated,
            failed: result.failed.length,
          }),
        ),
      )
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
module.exports = { estimate, normalize, request, update };
