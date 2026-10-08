"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const scenario of [
    "normal",
    "no-getAnimations",
    "no-animate",
    "no-finished",
    "throw-animate",
    "legacy-media",
    "no-media",
    "decode-reject",
    "decode-stall",
  ]) {
    const page = await browser.newPage({ reducedMotion: "no-preference" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript((scenario) => {
      window.animationProbe = { legacy: new Set() };
      if (scenario === "no-getAnimations")
        Element.prototype.getAnimations = undefined;
      if (scenario === "no-animate") Element.prototype.animate = undefined;
      if (scenario === "throw-animate")
        Element.prototype.animate = () => {
          throw Error("Unavailable compositor");
        };
      if (scenario === "no-finished") {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          Object.defineProperty(animation, "finished", { value: undefined });
          return animation;
        };
      }
      if (scenario === "legacy-media") {
        const matchMedia = window.matchMedia;
        window.matchMedia = (query) => {
          const media = matchMedia(query);
          return {
            get matches() {
              return media.matches;
            },
            addListener(callback) {
              window.animationProbe.legacy.add(callback);
              media.addListener(callback);
            },
            removeListener(callback) {
              window.animationProbe.legacy.delete(callback);
              media.removeListener(callback);
            },
          };
        };
      }
      // Other application media queries still use the browser API. Test the
      // optional animation query separately after startup in this scenario.
      if (scenario === "decode-reject")
        HTMLImageElement.prototype.decode = () =>
          Promise.reject(Error("Decode failed"));
      else if (scenario === "decode-stall")
        HTMLImageElement.prototype.decode = () => new Promise(() => {});
      else HTMLImageElement.prototype.decode = undefined;
    }, scenario);
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.waitForTimeout(900);
    const surfaces = await page.evaluate(() => {
      const results = [];
      const sample = (element) => {
        const style = getComputedStyle(element);
        return { animation: style.animationName, transform: style.transform };
      };
      for (let cycle = 0; cycle < 3; cycle++) {
        document.getElementById("batchToggle").click();
        const day = document.querySelector(
          ".calendar.is-batch-editing > button.day[data-date]",
        );
        if (!day) throw Error("Batch editing did not open");
        results.push(sample(day));
        document.getElementById("batchCancel").click();
        if (document.querySelector(".calendar.is-batch-editing"))
          throw Error("Batch editing did not close");
        document.getElementById("pageSettingsOpen").click();
        results.push(sample(document.getElementById("pageSettingsPane")));
        document.getElementById("personalSettingsCancel").click();
      }
      const card = document.querySelector("#cards>.card");
      WorkTimeApp.ui.motion.play(card, "motion-enter");
      results.push(sample(card));
      return results;
    });
    assert.deepEqual(
      surfaces.map((row) => row.animation),
      [
        "motion-batch-wiggle",
        "motion-sidebar-forward",
        "motion-batch-wiggle",
        "motion-sidebar-forward",
        "motion-batch-wiggle",
        "motion-sidebar-forward",
        "motion-rise",
      ],
      scenario + " keeps batch, sidebar and card effects",
    );
    assert(
      surfaces.every((row) => row.transform.startsWith("matrix")),
      scenario + " uses transform keyframes",
    );
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "compat-number";
      document.body.append(host);
      WorkTimeApp.ui.numbers.set(host, 123);
      WorkTimeApp.ui.numbers.set(host, 98);
      WorkTimeApp.ui.numbers.set(host, 456);
    });
    assert.equal(
      await page
        .locator("#compat-number .summary-number-accessible")
        .textContent(),
      "456",
      scenario,
    );
    assert(
      await page.locator("#compat-number .number-roll-up").count(),
      scenario + " retains CSS digit animation",
    );
    await page.waitForTimeout(800);
    assert.equal(
      await page
        .locator(
          "#compat-number .number-roll-up,#compat-number .number-roll-down",
        )
        .count(),
      0,
      scenario,
    );
    assert.equal(
      await page.locator("#compat-number .summary-number-visual").textContent(),
      "456",
      scenario,
    );

    await page.evaluate(() => {
      const calendar = document.createElement("div");
      calendar.id = "compat-calendar";
      calendar.className = "calendar";
      window.animationProbe.initialLegacy = window.animationProbe.legacy.size;
      calendar.innerHTML =
        '<button class="day" data-date="2026-10-08"></button>';
      document.body.append(calendar);
      let code = 0;
      const weather = {
        snapshot: () => ({
          city: { name: "测试" },
          record: { daily: [{ date: "2026-10-08", weatherCode: code }] },
        }),
        weatherText: () => "天气",
        subscribe: () => () => {},
        setDemand: () => {},
      };
      window.compatWeather = WorkTimeApp.ui.createCalendarWeather({
        calendar,
        weather,
        weatherUI: WorkTimeApp.ui.weather,
        now: () => Date.now(),
        businessDate: () => "2026-10-08",
      });
      window.compatWeather.refresh();
      code = 61;
      window.compatWeather.refresh();
      code = 71;
      window.compatWeather.refresh();
      WorkTimeApp.ui.notificationMotion.reveal();
    });
    await page.waitForTimeout(1500);
    assert.equal(
      await page.locator("#compat-calendar .calendar-weather-icon").count(),
      1,
      scenario,
    );
    assert.equal(
      await page.locator("#compat-calendar .calendar-weather-outgoing").count(),
      0,
      scenario,
    );
    assert.equal(
      await page.locator("#compat-calendar img").getAttribute("src"),
      "assets/icons/meteocons/svg/snow.svg",
      scenario,
    );
    assert.equal(
      await page
        .locator("#compat-calendar picture")
        .evaluate((node) => getComputedStyle(node).opacity),
      "0.5",
      scenario,
    );

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "compat-hold";
      button.innerHTML = '<svg><circle class="hold-progress" /></svg>';
      document.body.append(button);
      window.holdCalls = { short: 0, long: 0 };
      window.compatHold = WorkTimeApp.ui.createHoldAction({
        button,
        onShort: () => window.holdCalls.short++,
        onLong: () => window.holdCalls.long++,
      });
    });
    await page.locator("#compat-hold").focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(250);
    await page.keyboard.up("Space");
    await page.waitForTimeout(450);
    assert.deepEqual(
      await page.evaluate(() => window.holdCalls),
      { short: 1, long: 0 },
      scenario,
    );
    assert.equal(
      await page.locator("#compat-hold").evaluate((node) => node.className),
      "",
      scenario,
    );
    if (["normal", "no-animate", "no-finished"].includes(scenario)) {
      await page.keyboard.down("Space");
      await page.waitForTimeout(250);
      await page.keyboard.up("Space");
      await page.keyboard.down("Space");
      await page.waitForTimeout(250);
      assert.equal(
        await page
          .locator("#compat-hold")
          .evaluate((node) => node.classList.contains("is-holding")),
        true,
        "Old reset cannot clear a new hold",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.up("Space");
      await page.waitForTimeout(450);
      await page.keyboard.down("Space");
      await page.waitForTimeout(2500);
      await page.keyboard.up("Space");
      assert.deepEqual(
        await page.evaluate(() => window.holdCalls),
        { short: 2, long: 1 },
        scenario + " long hold completes once",
      );
    }

    // A missing animationend event must not leave duplicate digit rows.
    await page.evaluate(() => {
      document.addEventListener(
        "animationend",
        (event) => event.stopImmediatePropagation(),
        { capture: true, once: true },
      );
      WorkTimeApp.ui.numbers.set(document.getElementById("compat-number"), 457);
    });
    await page.waitForTimeout(850);
    assert.equal(
      await page.locator("#compat-number .summary-number-visual").textContent(),
      "457",
      scenario,
    );
    await page.evaluate(() => {
      WorkTimeApp.ui.numbers.set(document.getElementById("compat-number"), 999);
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.locator("#compat-number .number-roll-up").count(),
      0,
      scenario,
    );
    await page.evaluate(() =>
      WorkTimeApp.ui.numbers.set(document.getElementById("compat-number"), 777),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator("#compat-number .summary-number-visual").textContent(),
      "777",
      "Preference changes settle active digits",
    );
    assert.equal(
      await page.locator("#compat-number .number-roll-down").count(),
      0,
    );
    await page.evaluate(() =>
      WorkTimeApp.ui.numbers.set(document.getElementById("compat-number"), 111),
    );
    assert.equal(
      await page.locator("#compat-number .number-roll-down").count(),
      0,
      scenario,
    );
    if (scenario === "no-media") {
      assert.equal(
        await page.evaluate(() => {
          const original = window.matchMedia;
          try {
            window.matchMedia = undefined;
            const query = WorkTimeApp.ui.animationCompat.preference();
            WorkTimeApp.ui.animationCompat.listen(query, () => {})();
            return query.matches;
          } finally {
            window.matchMedia = original;
          }
        }),
        false,
      );
    }
    await page.evaluate(() => {
      window.compatHold.dispose();
      window.compatWeather.dispose();
      if (
        window.animationProbe.legacy.size !==
        window.animationProbe.initialLegacy
      )
        throw Error("Custom weather/hold retained preference listeners");
      WorkTimeApp.ui.numbers.dispose();
      WorkTimeApp.ui.motion.dispose();
      WorkTimeApp.ui.background.dispose();
      WorkTimeApp.ui.notificationMotion.dispose();
      WorkTimeApp.ui.calendarWeather.dispose();
    });
    assert.deepEqual(errors, [], scenario);
    await page.close();
    console.log("Animation compatibility passed: " + scenario);
  }
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
