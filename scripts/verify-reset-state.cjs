"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function ready(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function verify() {
  const root = path.resolve(__dirname, "..");
  const realm = vm.createContext({});
  for (const file of ["assets/js/namespace.js", "assets/js/domain/state.js"])
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), realm);
  const seed = JSON.parse(
    vm.runInContext(
      "JSON.stringify(WorkTimeApp.domain.state.defaultState())",
      realm,
    ),
  );
  const record = { start: "08:00", end: "18:00", nextDay: false };
  seed.days = {
    "2026-10-08": { leaveMinutes: 60, actual: record, note: "clear" },
    "2026-10-09": { leaveMinutes: 480, actual: record },
    "2026-10-11": { plannedOvertime: true, estimate: record },
    "2026-10-12": { leaveMinutes: 120 },
    "2026-10-18": {
      plannedOvertime: true,
      leaveMinutes: 60,
      estimate: record,
      note: "clear on cancel",
    },
    "2026-10-25": { plannedOvertime: true },
  };
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) => route.abort());
    await context.addInitScript((state) => {
      if (!sessionStorage.getItem("reset-fixture")) {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        sessionStorage.setItem("reset-fixture", "1");
      }
    }, seed);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await ready(page);
    const select = async (date) => {
      await page.locator('.day[data-date="' + date + '"]').click();
    };
    for (const [date, leave] of [
      ["2026-10-08", "1"],
      ["2026-10-09", "8"],
      ["2026-10-11", null],
    ]) {
      await select(date);
      assert.equal(await page.locator("#clearManual").isEnabled(), true);
      await page.locator("#clearManual").click();
      await page.waitForFunction(
        () => document.querySelector("#clearManual").disabled,
      );
      assert.equal(await page.locator("#dayStart").inputValue(), "");
      if (leave !== null)
        assert.equal(await page.locator("#dayLeave").inputValue(), leave);
      else
        assert.equal(
          await page
            .locator("#plannedOvertimeToggle")
            .getAttribute("aria-pressed"),
          "true",
        );
    }
    for (const date of ["2026-10-12", "2026-10-25"]) {
      await select(date);
      assert.equal(await page.locator("#clearManual").isDisabled(), true);
    }
    await select("2026-10-18");
    await page.locator("#plannedOvertimeToggle").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#plannedOvertimeToggle")
          .getAttribute("aria-pressed") === "false",
    );
    assert.equal(await page.locator("#dayStart").inputValue(), "");
    assert.equal(await page.locator("#clearManual").isDisabled(), true);
    assert.equal(await page.locator("#dayLeave").inputValue(), "1");
    await page.reload();
    await ready(page);
    for (const [date, leave] of [
      ["2026-10-08", "1"],
      ["2026-10-09", "8"],
    ]) {
      await select(date);
      assert.equal(await page.locator("#dayLeave").inputValue(), leave);
      assert.equal(await page.locator("#dayStart").inputValue(), "");
      assert.equal(await page.locator("#clearManual").isDisabled(), true);
    }
    await select("2026-10-11");
    assert.equal(
      await page.locator("#plannedOvertimeToggle").getAttribute("aria-pressed"),
      "true",
    );
    await select("2026-10-18");
    assert.equal(
      await page.locator("#plannedOvertimeToggle").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await page.locator("#dayStart").inputValue(), "");
    assert.equal(await page.locator("#clearManual").isDisabled(), true);
    assert.equal(await page.locator("#dayLeave").inputValue(), "1");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Reset UI verified: leave and overtime survive reset/reload; cancellation clears manual records and persists.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
