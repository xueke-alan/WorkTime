"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
require("./lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const entry = pathToFileURL(
  path.resolve(process.argv[2] || path.join(__dirname, ".."), "index.html"),
).href;

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    let context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) => route.abort());
    let page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-23T04:00:00Z"));
    await page.goto(entry);
    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await ready();
    const initial = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      state.settings.configured = true;
      state.personal.employmentDate = "2024-01-01";
      for (const day of [19, 20, 21, 22, 23, 26, 27, 28])
        state.days[`2026-10-${day}`] = { kind: "work" };
      state.days["2026-10-22"] = { kind: "rest", plannedOvertime: true };
      state.days["2026-10-23"].leaveMinutes = state.settings.standardMinutes;
      state.days["2026-10-24"] = { kind: "rest" };
      return state;
    });
    await context.close();
    context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) => route.abort());
    await context.addInitScript((state) => {
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, initial);
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-23T04:00:00Z"));
    await page.goto(entry);
    await ready();
    const date = (day) => `2026-10-${day}`;
    const card = (day) =>
      page.locator(`#calendar > .day[data-date="${date(day)}"]`);
    const selected = () =>
      page
        .locator("#calendar > .day.batchselected")
        .evaluateAll((cards) => cards.map((node) => node.dataset.date).sort());
    const expectDays = async (days) =>
      assert.deepEqual(await selected(), days.map(date).sort());
    async function move(day) {
      const box = await card(day).boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    async function sweep(days) {
      await move(days[0]);
      await page.mouse.down();
      for (const day of days.slice(1)) await move(day);
      await page.mouse.up();
    }
    await page.locator("#batchToggle").click();
    await page.locator("#batchStart").fill("08:00");
    await page.locator("#batchEnd").fill("18:00");
    await sweep([19, 20, 21, 20, 19]);
    await expectDays([19, 20, 21]);
    assert.match(await page.locator("#batchSelectionCount").textContent(), /3/);
    assert.equal(await page.locator("#batchSave").isEnabled(), true);
    await sweep([20, 21, 20]);
    await expectDays([19]);
    await sweep([21, 19, 26, 27, 26]);
    await expectDays([19, 21, 26, 27]);
    await sweep([20, 22, 23, 24]);
    await expectDays([19, 20, 21, 26, 27]);
    // Clear by mouse and keyboard: the synthetic click after pointerup must
    // never undo the starting date, while keyboard activation stays available.
    await card(20).locator(".day-select").click();
    await expectDays([19, 21, 26, 27]);
    await card(21).locator(".day-select").press("Space");
    await expectDays([19, 26, 27]);
    await page.locator("#batchClearSelection").click();
    await card(19).locator(".day-select").click();
    await card(21)
      .locator(".day-select")
      .click({ modifiers: ["Shift"] });
    await expectDays([19, 20, 21]);
    await move(26);
    await page.mouse.down();
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await move(27);
    await expectDays([19, 20, 21, 26]);
    await move(27);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await move(28);
    await page.mouse.up();
    await expectDays([19, 20, 21, 26, 27]);
    assert.equal(await page.locator(".is-batch-sweeping").count(), 0);
    await page.locator("#batchCancel").click();
    await card(20).locator(".day-select").click();
    assert.equal(
      await card(20).locator(".day-select").getAttribute("aria-pressed"),
      "true",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Batch sweep verified: select/deselect, revisits, mixed states, exclusions, preview, clicks, Shift, keyboard and cancellation via offline entry.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
