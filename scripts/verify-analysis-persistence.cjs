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
  const url = pathToFileURL(
    path.resolve(process.argv[2] || ".", "index.html"),
  ).href;
  const errors = [];
  async function open(saved, failure = "", reducedMotion = "reduce") {
    const context = await browser.newContext({
      locale: "zh-CN",
      reducedMotion,
      viewport: { width: 1920, height: 1080 },
    });
    await context.route(/^https?:/, (route) => route.abort());
    await context.addInitScript(
      ({ saved, failure }) => {
        if (!sessionStorage.getItem("view-seeded")) {
          if (saved !== undefined)
            localStorage.setItem("worktime.calendarView", saved);
          sessionStorage.setItem("view-seeded", "1");
        }
        window.viewWrites = 0;
        const get = Storage.prototype.getItem,
          set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === "worktime.calendarView" && failure === "read")
            throw Error("Read blocked for test");
          return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === "worktime.calendarView") {
            window.viewWrites++;
            if (failure === "write") throw Error("Write blocked for test");
          }
          return set.call(this, key, value);
        };
      },
      { saved, failure },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    await page.goto(url);
    await ready(page);
    return { page, context };
  }
  async function ready(page) {
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  }
  async function analysis(page, expected) {
    await page.waitForFunction(
      (expected) =>
        document.getElementById("analysisPage").hidden === !expected,
      expected,
    );
    assert.equal(
      await page.locator("#analysisToggle").getAttribute("aria-pressed"),
      String(expected),
    );
    if (expected) {
      await page.locator("#analysisPage").waitFor({ state: "visible" });
      assert.equal(
        await page.locator(".sidebar-brand-subtitle").getAttribute("title"),
        "作息分析",
      );
      assert.equal(await page.locator("#calendar").isVisible(), false);
      await page.waitForFunction(
        () => document.querySelectorAll(".analysis-lane").length === 2,
      );
    }
  }
  try {
    for (const [mode, weeks, motion] of [
      ["attendance", 0, "reduce"],
      ["agenda", 0, "reduce"],
      ["agenda", 1, "reduce"],
      ["agenda", 2, "reduce"],
      ["agenda", 3, "no-preference"],
    ]) {
      const { page, context } = await open(
        JSON.stringify({ mode, weeks }),
        "",
        motion,
      );
      await analysis(page, false);
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        String(mode === "agenda"),
      );
      await page.locator("#analysisToggle").click();
      await analysis(page, true);
      await page.waitForTimeout(600);
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("worktime.calendarView")),
        ),
        { mode, weeks, analysis: true },
      );
      await page.locator("#analysisManual").check();
      await page.locator("#nextMonth").click();
      const writes = await page.evaluate(() => window.viewWrites);
      await page.evaluate(() =>
        document.dispatchEvent(new Event("worktime:languagechange")),
      );
      assert.equal(
        await page.evaluate(() => window.viewWrites),
        writes,
        "Unchanged view must not rewrite storage",
      );
      await page.reload();
      await ready(page);
      await analysis(page, true);
      assert.equal(await page.locator("#analysisManual").isChecked(), false);
      assert.equal(
        await page.locator("#monthTitle").getAttribute("aria-label"),
        "本月作息",
      );
      await page.locator("#analysisToggle").click();
      await analysis(page, false);
      await page.waitForTimeout(600);
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        String(mode === "agenda"),
      );
      if (mode === "agenda")
        assert.equal(
          await page
            .locator("#agendaViewToggle")
            .getAttribute("data-agenda-view"),
          String(weeks),
        );
      await page.reload();
      await ready(page);
      await analysis(page, false);
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        String(mode === "agenda"),
      );
      await page.locator("#analysisToggle").click();
      await analysis(page, true);
      await page.waitForTimeout(600);
      await page.locator("#agendaMode").click();
      await analysis(page, false);
      await page.waitForTimeout(600);
      await page.reload();
      await ready(page);
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        "true",
      );
      await analysis(page, false);
      await context.close();
    }
    for (const saved of [
      "{",
      JSON.stringify({ mode: "unknown", weeks: 0, analysis: true }),
      JSON.stringify({ mode: "agenda", weeks: 99, analysis: true }),
      JSON.stringify({ mode: "attendance", weeks: 0, analysis: "true" }),
    ]) {
      const { page, context } = await open(saved);
      await analysis(page, false);
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        "false",
      );
      await context.close();
    }
    for (const failure of ["read", "write"]) {
      const { page, context } = await open(undefined, failure);
      await analysis(page, false);
      await page.locator("#analysisToggle").click();
      await analysis(page, true);
      await page.locator("#analysisToggle").click();
      await analysis(page, false);
      await page.reload();
      await ready(page);
      await analysis(page, false);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Analysis reload restoration, return to agenda/week views, deduplicated writes, legacy data and unavailable storage verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
