"use strict";
const locations = require("../../assets/data/weather-locations.json");
// Synthetic test data; never published as live weather.
function snapshot(hourly = true) {
  const value = {
    schemaVersion: 1,
    updatedAt: "2026-10-03T04:17:00Z",
    cities: {},
  };
  for (const { weatherKey: key, name, districtId } of locations) {
    value.cities[key] = {
      name,
      districtId,
      result: {
        location: { id: districtId },
        now: {
          temp: 23,
          feels_like: 999999,
          rh: 60,
          text: "多云",
          wind_class: "3级",
          wind_dir: "东北风",
          uptime: "20261003121500",
        },
        forecasts: Array.from({ length: 5 }, (_, i) => ({
          date: "2026-10-0" + (3 + i),
          high: 25,
          low: 18,
          text_day: "晴",
        })),
        ...(hourly
          ? {
              forecast_hours: Array.from({ length: 24 }, (_, i) => ({
                data_time:
                  "202610" +
                  (i < 12 ? "03" : "04") +
                  String((12 + i) % 24).padStart(2, "0") +
                  "0000",
                temp_fc: 24,
                pop: 999999,
              })),
            }
          : {}),
      },
    };
  }
  return value;
}
module.exports = { snapshot };
