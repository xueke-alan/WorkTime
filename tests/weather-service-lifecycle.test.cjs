"use strict";
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { snapshot } = require("./helpers/baidu-weather.cjs");
const timers = new Map(),
  listeners = new Set(),
  requests = [],
  storage = new Map();
let nextTimer = 0,
  notifications = 0,
  writes = 0;
function events(target) {
  return {
    addEventListener: (type, callback) =>
      listeners.add({ target, type, callback }),
    removeEventListener: (type, callback) => {
      for (const item of listeners)
        if (
          item.target === target &&
          item.type === type &&
          item.callback === callback
        )
          listeners.delete(item);
    },
  };
}
const context = {
  ...events("window"),
  document: { ...events("document"), hidden: false },
  URL,
  Date,
  AbortController,
  setTimeout: (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout: (id) => timers.delete(id),
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, text) => {
      storage.set(key, text);
      writes++;
    },
  },
  fetch: (url, options) =>
    new Promise((resolve) =>
      requests.push({ url, signal: options.signal, resolve }),
    ),
};
context.window = context;
vm.createContext(context);
for (const file of [
  "assets/js/namespace.js",
  "assets/data/weather-cities.js",
  "assets/js/weather-config.js",
  "assets/js/weather.js",
])
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
const weather = vm.runInContext("WorkTimeApp.services.weather", context),
  cities = vm.runInContext("WorkTimeApp.data.weatherCities.cities", context);
async function deliver(request) {
  request.resolve({
    ok: true,
    url: String(request.url),
    json: async () => snapshot(),
  });
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
(async () => {
  for (let round = 0; round < 3; round++) {
    weather.mount();
    weather.mount();
    assert.equal(listeners.size, 3);
    const unsubscribe = weather.subscribe(() => notifications++);
    const beforeDemand = requests.length;
    weather.setCity(cities[round].id);
    assert.equal(
      requests.length,
      beforeDemand,
      "City changes alone do not start requests without a consumer",
    );
    weather.setDemand("calendar", true);
    weather.setDemand("details", true);
    const active = requests.at(-1);
    assert.equal(active.signal.aborted, false);
    assert.equal(
      [...timers.values()].filter((timer) => timer.delay === 20000).length,
      1,
    );
    assert.equal(
      [...timers.values()].filter((timer) => timer.delay === 60000).length,
      1,
    );
    weather.setDemand("details", false);
    assert.equal(
      active.signal.aborted,
      false,
      "Calendar still needs the request",
    );
    weather.setDemand("calendar", false);
    assert.equal(active.signal.aborted, true);
    assert.equal(
      timers.size,
      0,
      "Last demand cancels deadline and periodic timer immediately",
    );
    const canceledNotifications = notifications;
    await deliver(active);
    assert.equal(notifications, canceledNotifications);
    assert.equal(writes, 0, "Canceled response cannot populate cache");
    weather.setDemand("calendar", true);
    const pending = requests.at(-1);
    assert.notEqual(
      pending,
      active,
      "Remount demand retries canceled request despite throttle window",
    );
    weather.dispose();
    weather.dispose();
    unsubscribe();
    assert.equal(pending.signal.aborted, true);
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
    const before = notifications,
      requestCount = requests.length,
      selected = weather.snapshot().city.id;
    weather.setCity(cities[(round + 1) % cities.length].id);
    weather.setDemand("late", true);
    weather.subscribe(() => notifications++);
    await weather.refresh(true);
    await deliver(pending);
    assert.equal(notifications, before);
    assert.equal(requests.length, requestCount);
    assert.equal(writes, 0);
    assert.equal(weather.snapshot().city.id, selected);
    assert.equal(weather.snapshot().loading, false);
  }
  weather.mount();
  weather.subscribe(() => notifications++);
  weather.setDemand("calendar", true);
  await deliver(requests.at(-1));
  assert.equal(writes, 1, "Live mounted request can update cache");
  assert(weather.snapshot().record);
  weather.dispose();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  console.log(
    "Weather service lifecycle passed: three mount/dispose rounds, two-consumer ownership, immediate deadline cancellation, ignored late responses and live remount cache writes.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
