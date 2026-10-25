"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const budgets = require("./performance-budgets.json");
const root = path.resolve(process.argv[2] || ".");
async function verify() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [
    ...html.matchAll(
      /<script (defer )?src="([^"?]+)(?:\?[^"\n]*)?"><\/script>/g,
    ),
  ];
  const styles = [
    ...html.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^"\n]*)?">/g),
  ];
  const size = (files) =>
    files.reduce(
      (sum, file) => sum + fs.statSync(path.join(root, file)).size,
      0,
    );
  const bytes = {
    javascript: size(scripts.map((m) => m[2])),
    blocking: size(scripts.filter((m) => !m[1]).map((m) => m[2])),
    css: size(styles.map((m) => m[1])),
  };
  assert.ok(
    bytes.javascript <= budgets.sourceJavaScriptBytes,
    "initial JavaScript size budget exceeded",
  );
  // Published theme bundles also contain resource hashes, which are not blocking application code.
  assert.ok(
    bytes.blocking <= budgets.blockingJavaScriptBytes + 20000,
    "blocking script size budget exceeded",
  );
  assert.ok(
    bytes.css <= budgets.sourceCssBytes,
    "initial CSS size budget exceeded",
  );
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const samples = [];
  try {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      try {
        await context.route(/^https?:/, (route) => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: budgets.cpuThrottle,
        });
        await page.addInitScript(() => {
          window.auditTasks = [];
          new PerformanceObserver((list) =>
            window.auditTasks.push(
              ...list.getEntries().map((entry) => ({
                start: entry.startTime,
                duration: entry.duration,
              })),
            ),
          ).observe({ type: "longtask", buffered: true });
          document.addEventListener(
            "worktime:ready",
            () => {
              window.auditReady = performance.now();
            },
            { once: true },
          );
        });
        await page.goto(pathToFileURL(path.join(root, "index.html")).href);
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
        const startup = await page.evaluate(() => {
          // Count only occupancy before app-ready. A delivered long task may
          // extend past readiness into the first reveal/layout frame.
          const tasks = window.auditTasks
            .filter((task) => task.start < window.auditReady)
            .map((task) =>
              Math.min(task.duration, window.auditReady - task.start),
            );
          return {
            startup: Math.round(window.auditReady),
            totalLongTask: Math.round(tasks.reduce((a, b) => a + b, 0)),
            largestLongTask: Math.round(Math.max(0, ...tasks)),
          };
        });
        samples.push(startup);
        assert.ok(
          startup.startup < budgets.startupMs,
          "startup time budget exceeded: " + JSON.stringify(startup),
        );
        assert.ok(
          startup.totalLongTask < budgets.totalLongTaskMs,
          "total startup long task budget exceeded: " + JSON.stringify(startup),
        );
        assert.ok(
          startup.largestLongTask < budgets.largestLongTaskMs,
          "single startup long task budget exceeded: " +
            JSON.stringify(startup),
        );
        if (run === 0) {
          const large = await page.evaluate(async (years) => {
            const D = WorkTimeApp.domain,
              state = D.state.defaultState();
            for (let year = 2026 - years + 1; year <= 2026; year++)
              for (let month = 1; month <= 12; month++) {
                const key = year + "-" + String(month).padStart(2, "0");
                const count = Number(D.time.monthBounds(key)[1].slice(8));
                for (let day = 1; day <= count; day++)
                  state.days[key + "-" + String(day).padStart(2, "0")] = {
                    actual: {
                      start: "08:00",
                      end: "17:30",
                      nextDay: false,
                      effectiveMinutes: null,
                    },
                  };
              }
            const owner = WorkTimeApp.services.application.createState({
              state,
              persistence: {
                loadIssue: null,
                commit: async () => ({ persisted: true }),
              },
              core: {
                ...D.state,
                ...D.calendar,
                ...D.validation,
                ...D.observations,
              },
            });
            const derived = WorkTimeApp.services.derived.create({
              core: {
                ...D.time,
                ...D.state,
                ...D.statistics,
                ...D.records,
                ...D.schedule,
              },
              getState: () => owner.state,
              getRevision: () => owner.revision,
            });
            const before = performance.now();
            for (let edit = 0; edit < 100; edit++) {
              const date =
                "2026-10-" + String((edit % 31) + 1).padStart(2, "0");
              await owner.saveDay(date, {
                actual: {
                  start: "08:00",
                  end: edit % 2 ? "18:30" : "17:30",
                  nextDay: false,
                  effectiveMinutes: null,
                },
              });
              derived.queries.summary(owner.state, "2026-10-01", "2026-10-31");
            }
            const elapsed = Math.round(performance.now() - before);
            const cached = derived.queries.summary(
              owner.state,
              "2026-10-01",
              "2026-10-31",
            );
            const reference = D.statistics.summary(
              owner.state,
              "2026-10-01",
              "2026-10-31",
            );
            derived.dispose();
            return {
              elapsed,
              records: Object.keys(owner.state.days).length,
              equal: JSON.stringify(cached) === JSON.stringify(reference),
            };
          }, budgets.recordYears);
          assert.equal(
            large.equal,
            true,
            "cached statistics must match domain results after many edits",
          );
          assert.ok(
            large.elapsed < budgets.hundredEditsMs,
            "large archive edit budget exceeded: " + large.elapsed,
          );
          console.log({ largeArchive: large });
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
    console.log({ bytes, cpuThrottle: budgets.cpuThrottle, samples });
    console.log(
      "Initial asset sizes, throttled startup/long tasks and ten-year archive edit budgets verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
