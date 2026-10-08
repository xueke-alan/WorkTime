"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=DomainTest",
  realm,
);
const C = realm.C;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const errors = [];
  for (const width of [2250, 1600, 390, 320])
    for (const mode of [
      "empty",
      "oa-pending",
      "manual-pending",
      "complete",
      "unconfigured",
      "met",
      "long",
    ]) {
      const state = C.defaultState();
      if (mode === "unconfigured") state.settings.configured = false;
      if (mode === "met") {
        state.overtimeRequirements = [0, 0, 0, 0, 0];
        for (let day = 1; day <= 30; day++)
          state.days["2026-09-" + C.pad(day)] = {
            actual: {
              start: "08:00",
              end: "17:30",
              nextDay: false,
              effectiveMinutes: 480,
            },
          };
      }
      if (mode === "oa-pending")
        state.days["2026-09-15"] = {
          oa: {
            date: "2026-09-15",
            start: "08:00",
            end: "",
            nextDay: false,
            status: "pending",
            source: "clipboard",
            raw: "09/15\n08:00",
            importId: "",
          },
        };
      if (mode === "manual-pending")
        state.days["2026-09-15"] = {
          draft: { start: "08:00", end: "", nextDay: false },
        };
      if (mode === "complete")
        state.days["2026-09-15"] = {
          actual: {
            start: "08:00",
            end: "17:30",
            nextDay: false,
            effectiveMinutes: null,
          },
        };
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.install({ time: new Date("2026-09-15T12:00:00+08:00") });
      await page.addInitScript((fixture) => {
        localStorage.setItem("worktime-local-v1", JSON.stringify(fixture));
        localStorage.setItem("worktime.pageTheme", "rose");
      }, state);
      await page.goto(
        require("node:url").pathToFileURL(
          path.resolve(__dirname, "../index.html"),
        ).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.clock.runFor(1000);
      const pace = C.targetPace(
        state,
        "2026-09-01",
        "2026-09-30",
        "2026-09-15",
        state.overtimeRequirements[0],
      );
      const label = (
        await page.locator("#targetTotalLabel").textContent()
      ).replace(/\s+/g, "");
      if (["empty", "oa-pending", "manual-pending", "complete"].includes(mode))
        assert.equal(
          label,
          (mode === "empty" ? "含今日后续" : "明日起后续") +
            pace.remainingDays +
            "天" +
            (mode === "empty" ? "需加班" : "需要加班"),
        );
      if (mode === "met") assert.equal(label, "已达标");
      if (mode === "unconfigured")
        assert.equal(
          await page.locator("#targetResult").textContent(),
          "请先完成工作时间设置",
        );
      if (mode === "long") {
        await page.evaluate(() => {
          for (const [id, value, unit] of [
            ["targetValue", 24, "h"],
            ["targetMetric", 1234.56, "h"],
            ["targetDailyMetric", 112.3, "h/d"],
          ])
            WorkTimeApp.ui.numbers.set(document.getElementById(id), value, {
              unit,
              alignInk: true,
            });
        });
        await page.clock.runFor(1000);
      }
      const layout = await page.locator(".target-panel").evaluate((el) => {
        const box = (selector) =>
          el.querySelector(selector).getBoundingClientRect();
        const a = box("#targetValue"),
          b = box("#targetMetric"),
          c = box("#targetDailyMetric"),
          label = box("#targetTotalLabel"),
          counts = box("#targetCounts"),
          divider = box(".target-divider svg");
        return {
          stacked: a.bottom < b.top && b.bottom < c.top,
          aligned:
            Math.abs(a.right - b.right) < 1 && Math.abs(b.right - c.right) < 1,
          separated: label.right < c.left && counts.right < b.left,
          curve: divider.top > a.bottom && divider.bottom < label.top,
          centered:
            !el.querySelector("#targetCounts").textContent ||
            Math.abs(divider.bottom - (counts.bottom + label.top) / 2) < 1,
          matchingColor:
            getComputedStyle(el.querySelector("#targetCounts")).color ===
            getComputedStyle(el.querySelector("#targetTotalLabel")).color,
          overflow: el.scrollWidth > el.clientWidth,
          childOverflow: [
            ...el.querySelectorAll(
              "h3, #targetCounts, #targetTotalLabel, #targetResult, .target-metric, .target-value",
            ),
          ].some(
            (child) =>
              child.clientWidth && child.scrollWidth > child.clientWidth + 1,
          ),
        };
      });
      assert(
        layout.stacked &&
          layout.aligned &&
          layout.separated &&
          layout.curve &&
          layout.centered &&
          layout.matchingColor &&
          !layout.overflow &&
          !layout.childOverflow,
        JSON.stringify({ width, mode, layout }),
      );
      if (["empty", "oa-pending", "long", "unconfigured", "met"].includes(mode))
        await page.locator(".target-panel").screenshot({
          path: path.resolve(
            __dirname,
            `../test-results/target-start-${width}-${mode}.png`,
          ),
        });
      await context.close();
    }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Target card passed: right-aligned vertical figures, left copy and curved divider at 2250/1600/390; empty, OA/manual start-only and complete records.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
