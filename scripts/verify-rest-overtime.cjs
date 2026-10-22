"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    const url = pathToFileURL(path.resolve("index.html")).href;
    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await page.goto(url);
    await ready();
    const fixture = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      const oa = (date, start = "08:00", end = "17:30") => ({
        date,
        start,
        end,
        nextDay: false,
        status: end ? "complete" : "pending",
        source: "test",
        raw: "",
      });
      state.days = {
        "2026-10-11": { oa: oa("2026-10-11"), plannedOvertime: true },
        "2026-10-17": { oa: oa("2026-10-17", "08:00", "") },
        "2026-10-18": { oa: oa("2026-10-18", "08:00", "08:00") },
        "2026-10-24": { plannedOvertime: true },
        "2026-10-25": {
          actual: { start: "08:00", end: "17:30", nextDay: false },
        },
        "2026-10-10": { oa: oa("2026-10-10") },
        "2026-10-01": { oa: oa("2026-10-01") },
      };
      return state;
    });
    await context.close();
    const seeded = await browser.newContext({ locale: "zh-CN" });
    await seeded.route(/^https?:/, (route) => route.abort());
    await seeded.addInitScript((state) => {
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, fixture);
    const view = await seeded.newPage();
    view.on("pageerror", (error) => errors.push(error.message));
    await view.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await view.goto(url);
    await view.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const counts = await view.evaluate((state) => {
      return WorkTimeApp.domain.statistics.selectOvertimeRequirement(
        state,
        "2026-10-01",
        "2026-10-31",
      );
    }, fixture);
    assert.deepEqual(counts, {
      actualDays: 3,
      plannedDays: 1,
      totalDays: 4,
      tier: 4,
      targetMinutes: fixture.overtimeRequirements[4],
    });
    assert.equal(
      await view.locator("#targetCounts").textContent(),
      "休息日加班：4 d",
    );
    const card = (date) => view.locator(`.day[data-date="${date}"]`);
    for (const date of ["2026-10-11", "2026-10-25", "2026-10-01"]) {
      assert.equal(
        await card(date).locator(".pill.overtime").textContent(),
        "加班",
      );
      assert.equal(await card(date).locator(".overtime-plan").count(), 0);
    }
    for (const date of ["2026-10-17", "2026-10-18", "2026-10-10"])
      assert.equal(await card(date).locator(".pill.overtime").count(), 0);
    assert.equal(await card("2026-10-24").locator(".overtime-plan").count(), 1);
    assert.equal(
      await card("2026-10-11").locator(".record-source-dot.oa").count(),
      1,
    );
    const button = view.locator("#plannedOvertimeToggle");
    for (const date of ["2026-10-11", "2026-10-01"]) {
      await card(date).click();
      assert.equal(await button.isDisabled(), true);
      assert.equal(await button.textContent(), "加班");
      assert.equal(await button.getAttribute("aria-label"), "加班");
      assert.equal(await button.getAttribute("aria-pressed"), "false");
    }
    for (const date of ["2026-10-17", "2026-10-18", "2026-10-25"]) {
      await card(date).click();
      assert.equal(await button.isEnabled(), true);
      assert.equal(await button.textContent(), "计划加班");
    }
    await card("2026-10-24").click();
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.deepEqual(errors, []);
    await seeded.close();
    console.log(
      "Rest-day OA/manual overtime tags, planned tags, incomplete records and makeup workdays verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
