"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  vm = require("node:vm"),
  { pathToFileURL } = require("node:url"),
  { readCoreSource } = require("./helpers/core-source.cjs");
const realm = vm.createContext({});
vm.runInContext(readCoreSource() + ";globalThis.C=DomainTest", realm);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  let cases = 0;
  for (const reducedMotion of ["no-preference", "reduce"])
    for (const mode of ["empty", "unconfigured", "recorded"]) {
      const state = realm.C.defaultState();
      state.settings.configured = mode !== "unconfigured";
      if (mode === "recorded")
        state.days["2026-09-30"] = {
          actual: { start: "08:00", end: "20:00", nextDay: false },
        };
      const average = realm.C.summary(
        state,
        "2026-09-01",
        "2026-09-30",
      ).average;
      if (mode !== "recorded") assert.equal(average, null);
      const context = await browser.newContext({
        viewport: { width: 390, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion,
      });
      const page = await context.newPage();
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.install({ time: new Date("2026-09-30T12:00:00+08:00") });
      await page.addInitScript(
        (fixture) =>
          localStorage.setItem("worktime-local-v1", JSON.stringify(fixture)),
        state,
      );
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const main = page.locator(".average-card .summary-number-accessible");
      assert.equal(await main.textContent(), ((average ?? 0) / 60).toFixed(3));
      assert.equal(
        await page.locator(".average-card small").textContent(),
        "h",
      );
      assert.equal(
        await page.locator(".average-card small[data-number-ink]").count(),
        1,
      );
      const owned = await page.evaluate(() => {
        // Detached output cannot be repaired by the alignment observer.
        const host = document.createElement("div"),
          numbers = WorkTimeApp.ui.numbers;
        numbers.set(host, null, { unit: "h", alignInk: true });
        const missing = host.firstElementChild;
        const structure = [...host.children].map((node) => [
          node.tagName,
          node.hasAttribute("data-number-ink"),
          node.textContent,
        ]);
        numbers.set(host, null, { unit: "h", alignInk: true });
        return { structure, retained: missing === host.firstElementChild };
      });
      assert.deepEqual(owned.structure, [
        ["SPAN", true, "—"],
        ["SMALL", true, "h"],
      ]);
      assert.equal(owned.retained, true);
      const preview = page.locator(
        "#previewAverage .summary-number-accessible",
      );
      assert.match(await preview.textContent(), /^\d+\.\d{2} h$/);
      if (mode === "empty") {
        assert.equal(await preview.textContent(), "0.00 h");
        assert.deepEqual(
          JSON.parse(
            await page.evaluate(() =>
              localStorage.getItem("worktime-local-v1"),
            ),
          ),
          JSON.parse(JSON.stringify(state)),
          "Displaying fallback zero must not write a record",
        );
        const transition = await page.evaluate(() => {
          const input = (id, value) => {
            const element = document.getElementById(id);
            element.value = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
          };
          input("dayStart", "08:00");
          input("dayEnd", "20:00");
          const element = document.getElementById("previewAverage");
          const positive = element.querySelector(
            ".summary-number-accessible",
          ).textContent;
          const node = element.querySelector(".summary-number");
          input("dayEnd", "20:00");
          const retained = node === element.querySelector(".summary-number");
          input("dayEnd", "");
          return {
            positive,
            retained,
            zero: element.querySelector(".summary-number-accessible")
              .textContent,
            running: element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running").length,
          };
        });
        assert.match(transition.positive, /^\d+\.\d{2} h$/);
        assert.notEqual(transition.positive, "0.00 h");
        assert.equal(transition.zero, "0.00 h");
        assert.equal(transition.retained, true);
        if (reducedMotion === "reduce") assert.equal(transition.running, 0);
      }
      await context.close();
      cases++;
    }
  await browser.close();
  console.log(
    `Average display passed: ${cases} actual-page cases; fixed precision, null domain values and motion transitions.`,
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
