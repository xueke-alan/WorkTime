"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    let page = await browser.newPage({
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const result = await page.evaluate(() => {
      const D = WorkTimeApp.domain,
        state = D.state.defaultState();
      const record = (end, nextDay = false) => ({
        start: "08:00",
        end,
        nextDay,
        effectiveMinutes: null,
      });
      const put = (date, end, kind = "work", nextDay = false) => {
        state.days[date] = {
          kind,
          oa: {
            ...record(end, nextDay),
            date,
            status: "complete",
            source: "test",
            raw: "",
          },
        };
      };
      put("2026-10-01", "19:00");
      put("2026-10-02", "20:00");
      put("2026-10-03", "21:00");
      put("2026-10-04", "00:00", "work", true);
      put("2026-10-08", "00:00", "work", true);
      put("2026-10-07", "18:00", "rest");
      state.days["2026-10-05"] = { kind: "work", actual: record("20:00") };
      state.days["2026-10-06"] = {
        kind: "work",
        oa: {
          ...record(""),
          date: "2026-10-06",
          status: "pending",
          source: "test",
          raw: "",
        },
        actual: record("20:00"),
      };
      state.days["2026-10-29"] = { kind: "work", actual: record("23:00") };
      put("2026-09-01", "17:30");
      put("2026-09-02", "19:30");
      put("2026-09-29", "23:00");
      const analyze = (input = state, manual = false) =>
        D.statistics.monthlyAnalysis(input, "2026-10", "2026-10-28", manual, {
          workdaysOnly: true,
        });
      const compare = (month, asOf, input = state, manual = false) =>
        D.statistics.monthlyAnalysisComparison(input, month, asOf, manual);
      const before = JSON.stringify(state);
      const base = analyze(),
        included = analyze(state, true);
      const empty = D.state.defaultState();
      const zero = D.state.cloneState(empty);
      zero.days["2026-10-01"] = { kind: "work", actual: record("17:30") };
      const debt = D.state.cloneState(zero);
      debt.days["2026-10-01"].actual.end = "15:00";
      debt.days["2026-10-02"] = { kind: "work", actual: record("20:00") };
      const adjusted = D.state.cloneState(state);
      adjusted.days["2026-10-01"].leaveMinutes = 120;
      adjusted.scheduleRanges = [
        {
          start: "2026-10-02",
          end: null,
          schedule: {
            workStart: "09:00",
            workEnd: "18:30",
            standardMinutes: 480,
            breaks: [{ start: 720, end: 810 }],
          },
        },
      ];
      const adjustedAnalysis = analyze(adjusted);
      const adjustedExpected = adjustedAnalysis.days.reduce(
        (sum, day) =>
          sum +
          D.records.calculate(
            day.date,
            adjusted.days[day.date],
            D.schedule.scheduleForDate(adjusted, day.date),
            false,
          ).overtime,
        0,
      );
      const equal = D.state.cloneState(empty);
      equal.days["2026-09-01"] = { kind: "work", actual: record("20:00") };
      equal.days["2026-10-01"] = { kind: "work", actual: record("20:00") };
      const restOnly = D.state.cloneState(empty);
      restOnly.days["2026-10-07"] = state.days["2026-10-07"];
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
      return {
        state,
        base,
        included,
        empty: analyze(empty),
        zero: analyze(zero, true),
        debt: analyze(debt, true),
        current: compare("2026-10", "2026-10-28"),
        past: compare("2026-10", "2026-11-04"),
        clamped: compare("2026-03", "2026-03-31"),
        leap: compare("2024-03", "2024-03-31"),
        year: compare("2026-01", "2026-01-15"),
        future: compare("2026-11", "2026-10-28", state, true),
        single: compare("2026-09", "2026-10-28"),
        equal: compare("2026-10", "2026-10-28", equal, true),
        manualComparison: compare("2026-10", "2026-10-28", state, true),
        adjustedTotal: adjustedAnalysis.overtimeMinutes,
        adjustedExpected,
        restOnly: analyze(restOnly),
        allRest: D.statistics.monthlyAnalysis(
          restOnly,
          "2026-10",
          "2026-10-28",
        ),
        immutable: before === JSON.stringify(state),
      };
    });
    assert.equal(result.base.count, 5);
    assert.equal(result.base.overtimeMinutes, 1080);
    assert.equal(result.base.averageOvertime, 216);
    assert.equal(result.base.maximumOvertime.minutes, 360);
    assert.deepEqual(result.base.maximumOvertime.dates, [
      "2026-10-04",
      "2026-10-08",
    ]);
    assert.deepEqual(
      result.base.lateCounts.map((item) => item.count),
      [4, 3, 2],
    );
    assert.equal(
      result.included.count,
      7,
      "Include manual and filled missing punches, excluding future plans",
    );
    assert.equal(result.empty.averageOvertime, null);
    assert.equal(result.zero.overtimeMinutes, 0);
    assert.equal(result.zero.averageOvertime, 0);
    assert.equal(result.zero.maximumOvertime.minutes, 0);
    assert.equal(
      result.debt.overtimeMinutes,
      120,
      "Short days must not cancel overtime on other days",
    );
    assert.equal(result.debt.averageOvertime, 120);
    assert.equal(result.debt.maximumOvertime.minutes, 120);
    assert.equal(result.current.previousCount, 2);
    assert.equal(result.current.previousEnd, "2026-09-28");
    assert.equal(result.current.overtimeRatioChange, 50);
    assert.equal(result.current.overtimeMinutesChange, 990);
    assert.equal(result.current.averageEndChange, 186);
    assert.equal(result.past.previousCount, 3);
    assert.equal(result.past.previousEnd, "2026-09-30");
    assert.equal(result.clamped.previousEnd, "2026-02-28");
    assert.equal(result.leap.previousEnd, "2024-02-29");
    assert.equal(result.year.previousStart, "2025-12-01");
    assert.equal(result.year.previousEnd, "2025-12-15");
    assert.equal(result.future.currentCount, 0);
    assert.equal(result.future.overtimeMinutesChange, null);
    assert.equal(result.single.averageEndChange, null);
    assert.equal(result.equal.averageEndChange, 0);
    assert.equal(result.equal.overtimeMinutesChange, 0);
    assert.equal(result.equal.overtimeRatioChange, 0);
    assert.equal(result.manualComparison.currentCount, 7);
    assert.equal(result.adjustedTotal, result.adjustedExpected);
    assert.equal(result.restOnly.count, 0);
    assert.equal(result.allRest.count, 1);
    assert.equal(result.immutable, true);

    await page.close();
    page = await browser.newPage({
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
    await page.addInitScript(
      (state) =>
        localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
      result.state,
    );
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#analysisToggle").click();
    assert.equal(await page.locator(".analysis-metric-group").count(), 5);
    assert.equal(await page.locator(".analysis-metric").count(), 18);
    assert.equal(
      await page
        .locator('[data-key="totalOvertime"] .analysis-metric-value')
        .getAttribute("data-value"),
      "18.00 h",
    );
    assert.equal(
      await page
        .locator('[data-key="late1260"] .analysis-metric-value')
        .getAttribute("data-value"),
      "2",
    );
    await page.locator('[data-key="maximumOvertime"] summary').click();
    assert.match(
      await page
        .locator('[data-key="maximumOvertime"] details p')
        .textContent(),
      /10\/4.*10\/8/,
    );
    await page.locator('[data-key="maximumOvertime"] summary').click();
    for (const kind of [".analysis-range", ".analysis-day"]) {
      const target = page.locator(kind).first();
      const date = await target.getAttribute("data-date");
      await target.focus();
      await page.evaluate(() =>
        document.getElementById("analysisManual").click(),
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
      await page.setViewportSize({ width: 2000, height: 1080 });
      await page.waitForFunction(
        ({ kind, date }) =>
          document.activeElement.matches(kind) &&
          document.activeElement.dataset.date === date,
        { kind, date },
      );
      await page.evaluate(() =>
        document.getElementById("analysisManual").click(),
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
    fs.mkdirSync("test-results/analysis-summary", { recursive: true });
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [1400, 1080],
      [1000, 1080],
      [390, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("#analysisPage").scrollIntoViewIfNeeded();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        await page.waitForFunction(
          (language) => WorkTimeApp.i18n.language === language,
          language,
        );
        const issues = await page
          .locator("#analysisMetrics")
          .evaluate((root) => {
            const problems = [];
            for (const el of root.querySelectorAll(
              ".analysis-metric-group, .analysis-metric > strong",
            )) {
              if (el.scrollWidth > el.clientWidth + 1)
                problems.push(el.className + ": " + el.textContent);
            }
            if (root.scrollWidth > root.clientWidth + 1)
              problems.push("summary overflows");
            return problems;
          });
        assert.deepEqual(issues, [], `${language} at ${width}px`);
        if (width >= 1920) {
          assert.equal(
            await page
              .locator("#analysisPage")
              .evaluate(
                (el) =>
                  el.scrollHeight <= el.clientHeight + 1 &&
                  el.scrollWidth <= el.clientWidth + 1,
              ),
            true,
            `Entire routine page fits ${width}×${height}, ${language}`,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollHeight <= innerHeight + 1,
            ),
            true,
          );
        }
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page
        .locator("#analysisPage")
        .screenshot({ path: `test-results/analysis-summary/${width}.png` });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const enabled of [true, false, true, false]) {
      await page.locator("#analysisManual").setChecked(enabled);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);
    assert.match(
      await page
        .locator('[data-key="totalOvertime"] .analysis-metric-value')
        .getAttribute("data-value"),
      /18\.00 h/,
    );
    assert.equal(await page.locator(".analysis-ratio-outgoing").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "Grouped routine metrics, boundary statistics, period comparisons, locales, responsive layout and interrupted animations verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
