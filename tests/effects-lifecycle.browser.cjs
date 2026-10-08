"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage({ reducedMotion: "no-preference" });
  await page.setContent(
    '<canvas id="particleBg"></canvas><div id="number"></div><div id="motion"></div><div id="weather"></div>',
  );
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/namespace.js"),
  });
  await page.evaluate(() => {
    const nativeAdd = EventTarget.prototype.addEventListener,
      nativeRemove = EventTarget.prototype.removeEventListener;
    const listeners = [],
      frames = new Set(),
      timers = new Set();
    const nativeFrame = window.requestAnimationFrame,
      nativeCancel = window.cancelAnimationFrame,
      nativeSet = window.setTimeout,
      nativeClear = window.clearTimeout;
    const category = (target) =>
      target === window ||
      target === document ||
      target instanceof MediaQueryList
        ? "global"
        : target.id?.startsWith("weather-forecast-")
          ? "weather"
          : target.classList?.contains("summary-number-track")
            ? "number"
            : null;
    EventTarget.prototype.addEventListener = function (
      type,
      callback,
      options,
    ) {
      const kind = category(this),
        capture =
          typeof options === "boolean" ? options : Boolean(options?.capture);
      if (
        kind &&
        !options?.signal?.aborted &&
        !listeners.some(
          (e) =>
            e.target === this &&
            e.type === type &&
            e.callback === callback &&
            e.capture === capture,
        )
      ) {
        const entry = { target: this, type, callback, capture, kind };
        listeners.push(entry);
        if (options?.signal)
          nativeAdd.call(
            options.signal,
            "abort",
            () => {
              const i = listeners.indexOf(entry);
              if (i >= 0) listeners.splice(i, 1);
            },
            { once: true },
          );
      }
      return nativeAdd.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      callback,
      options,
    ) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const i = listeners.findIndex(
        (e) =>
          e.target === this &&
          e.type === type &&
          e.callback === callback &&
          e.capture === capture,
      );
      if (i >= 0) listeners.splice(i, 1);
      return nativeRemove.call(this, type, callback, options);
    };
    window.requestAnimationFrame = (callback) => {
      const id = nativeFrame((time) => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
      nativeCancel(id);
    };
    window.setTimeout = (callback, delay) => {
      const id = nativeSet(() => {
        timers.delete(id);
        callback();
      }, delay);
      timers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      timers.delete(id);
      nativeClear(id);
    };
    window.effectProbe = {
      snapshot: () => ({
        globals: listeners.filter((e) => e.kind === "global").length,
        weather: listeners.filter((e) => e.kind === "weather").length,
        numbers: listeners.filter((e) => e.kind === "number").length,
        frames: frames.size,
        timers: timers.size,
      }),
      tick: () =>
        new Promise((resolve) => nativeFrame(() => nativeFrame(resolve))),
      restore() {
        EventTarget.prototype.addEventListener = nativeAdd;
        EventTarget.prototype.removeEventListener = nativeRemove;
        window.requestAnimationFrame = nativeFrame;
        window.cancelAnimationFrame = nativeCancel;
        window.setTimeout = nativeSet;
        window.clearTimeout = nativeClear;
      },
    };
    WorkTimeApp.services.weather = { weatherText: () => "晴" };
  });
  for (const file of [
    "animation-compat.js",
    "summary-numbers.js",
    "motion.js",
    "background.js",
    "weather-ui.js",
  ])
    await page.addScriptTag({
      path: path.resolve(__dirname, "../assets/js", file),
    });
  const result = await page.evaluate(async () => {
    const { numbers, motion, background, weather } = WorkTimeApp.ui,
      probe = window.effectProbe;
    const host = document.getElementById("number"),
      box = document.getElementById("motion"),
      panel = document.getElementById("weather");
    const expect = (actual, expected, message) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw Error(message + ": " + JSON.stringify(actual));
    };
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const value = {
      city: { name: "测试城市" },
      record: {
        validAt: Date.now(),
        fetchedAt: Date.now(),
        current: { temperature: 20, weatherCode: 0 },
        daily: [{ date: today, weatherCode: 0, high: 25, low: 15 }],
        hourly: [],
      },
    };
    const cycles = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const component of [numbers, motion, background]) {
        component.mount();
        component.mount();
      }
      weather.render(panel, value);
      await probe.tick();
      const active = probe.snapshot();
      expect(
        [active.globals, active.weather, active.frames],
        [13, 8, 1],
        "Mount must create exactly one listener set and background frame",
      );
      numbers.set(host, 1, { decimals: 2 });
      if (!host.querySelector(".number-roll-up"))
        throw Error("Remounted numbers failed to animate");
      motion.play(box);
      if (
        !box.classList.contains("motion-content") ||
        probe.snapshot().timers !== 2
      )
        throw Error("Remounted motion did not schedule one cleanup");
      const oldHourly = document.getElementById("weather-forecast-hourly"),
        oldHidden = oldHourly.hidden,
        oldButton = document.getElementById(
          "weather-forecast-tab-" + (oldHidden ? "hourly" : "daily"),
        );
      weather.render(panel, value);
      oldButton.click();
      if (oldHourly.hidden !== oldHidden)
        throw Error("Replaced weather handler survived");
      expect(
        probe.snapshot().weather,
        8,
        "Rerender must release old node handlers",
      );
      const hourly = document.getElementById("weather-forecast-hourly"),
        hidden = hourly.hidden,
        button = document.getElementById(
          "weather-forecast-tab-" + (hidden ? "hourly" : "daily"),
        );
      button.click();
      if (hourly.hidden === hidden)
        throw Error("Remounted weather click failed");
      weather.dispose();
      weather.dispose();
      // A retained DOM node must no longer change the component or add animation timers.
      document
        .getElementById(
          "weather-forecast-tab-" + (hourly.hidden ? "hourly" : "daily"),
        )
        .click();
      if (hourly.hidden === hidden)
        throw Error("Disposed weather node handler survived");
      for (const component of [numbers, motion, background]) {
        component.dispose();
        component.dispose();
      }
      const saved = host.innerHTML;
      numbers.set(host, 5);
      motion.play(box);
      if (saved !== host.innerHTML || box.classList.contains("motion-content"))
        throw Error("Disposed effects still active");
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new Event("visibilitychange"));
      await probe.tick();
      expect(
        probe.snapshot(),
        { globals: 0, weather: 0, numbers: 0, frames: 0, timers: 0 },
        "Disposed effects retained resources",
      );
      cycles.push(cycle + 1);
    }
    return cycles;
  });
  assert.deepEqual(result, [1, 2, 3]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(async () => {
    const { numbers, motion, background, weather } = WorkTimeApp.ui;
    for (const component of [numbers, motion, background, weather])
      component.mount();
    numbers.set(document.getElementById("number"), 2, { decimals: 2 });
    motion.play(document.getElementById("motion"));
    await window.effectProbe.tick();
    if (document.querySelector(".number-roll-up,.motion-content"))
      throw Error("Reduced motion was lost after remount");
    return window.effectProbe.snapshot();
  });
  assert.deepEqual(reduced, {
    globals: 13,
    weather: 0,
    numbers: 0,
    frames: 0,
    timers: 0,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const resumed = await page.evaluate(async () => {
    const { numbers, motion, background, weather } = WorkTimeApp.ui;
    numbers.set(document.getElementById("number"), 3, { decimals: 2 });
    motion.play(document.getElementById("motion"));
    await window.effectProbe.tick();
    const active = window.effectProbe.snapshot();
    if (
      !document.querySelector(".number-roll-up,.motion-content") ||
      active.frames !== 1 ||
      active.timers !== 2
    )
      throw Error("Remounted media listeners failed to resume effects");
    for (const component of [numbers, motion, background, weather])
      component.dispose();
    const disposed = window.effectProbe.snapshot();
    window.effectProbe.restore();
    return disposed;
  });
  assert.deepEqual(resumed, {
    globals: 0,
    weather: 0,
    numbers: 0,
    frames: 0,
    timers: 0,
  });
  await browser.close();
  console.log(
    "Effects lifetime passed: three mount/dispose rounds, exact listeners, canceled frames/timers/number handlers and inert old weather nodes.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
