"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { buildPerformanceFixture } = require("./performance-fixtures.cjs");
const { fixBusinessDate } = require("./lib/fixed-business-date.cjs");
const args = process.argv.slice(2);
const root = path.resolve(__dirname, ".."),
  snapshot = args.includes("--snapshot"),
  sourceRoot = snapshot
    ? path.join(
        root,
        ".refactor-backups/workspace-2026-10-04T03-32-53-659Z/files",
      )
    : root;
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const repetitions = Number(option("--samples", "20"));
assert(Number.isInteger(repetitions) && repetitions >= 2 && repetitions <= 100);
const output = path.resolve(
  option("--output", "test-results/performance-current.json"),
);
assert(!fs.existsSync(output), "Refusing to overwrite a historical benchmark");
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const assets = [
  "index.html",
  "package-lock.json",
  "scripts/performance-fixtures.cjs",
  snapshot ? "tests/helpers/core-source.cjs" : "scripts/lib/domain-source.cjs",
  ...filesIn(path.join(sourceRoot, "assets")).map((file) =>
    path.relative(sourceRoot, file).replaceAll(path.sep, "/"),
  ),
];
const identity = Object.fromEntries(
  assets.map((file) => [
    file,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(sourceRoot, file)))
      .digest("hex"),
  ]),
);
const runnerIdentity = Object.fromEntries(
  [
    "scripts/benchmark-browser.cjs",
    "scripts/performance-fixtures.cjs",
    "scripts/lib/domain-source.cjs",
    "scripts/lib/fixed-business-date.cjs",
  ].map((file) => [
    file,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, file)))
      .digest("hex"),
  ]),
);
if (snapshot) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "../manifest.json"), "utf8"),
  );
  const expected = new Map(
    manifest.files.map((file) => [file.path, file.sha256]),
  );
  for (const [file, digest] of Object.entries(identity))
    assert.equal(
      digest,
      expected.get(file),
      "Protected source changed: " + file,
    );
}
const makeFixture = snapshot
  ? require(path.join(sourceRoot, "scripts/performance-fixtures.cjs"))
      .buildPerformanceFixture
  : buildPerformanceFixture;
const fixtures = [1, 5, 10].map((years) => makeFixture(years));
if (snapshot)
  for (const fixture of fixtures) {
    const current = buildPerformanceFixture(fixture.metadata.years);
    assert.deepEqual(fixture.state.days, current.state.days);
    assert.deepEqual(fixture.state.imports, current.state.imports);
    const { employmentDate, workCity, ...settings } = fixture.state.settings;
    assert.deepEqual(settings, current.state.settings);
    assert.deepEqual({ employmentDate, workCity }, current.state.personal);
    assert.deepEqual(
      fixture.state.scheduleRanges,
      current.state.scheduleRanges,
    );
    assert.deepEqual(fixture.state.timeTemplates, current.state.timeTemplates);
  }
async function settle(page) {
  await page.evaluate(async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const finite = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        );
      if (!finite.length) return;
      await Promise.allSettled(finite.map((animation) => animation.finished));
    }
    throw Error("Finite UI animations did not settle");
  });
}
async function metrics(session) {
  const result = await session.send("Performance.getMetrics");
  return Object.fromEntries(
    result.metrics.map((metric) => [metric.name, metric.value]),
  );
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return {
    samples: sorted.length,
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const report = {
    createdAt: new Date().toISOString(),
    browser: await browser.version(),
    node: process.version,
    machine: {
      platform: process.platform,
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      logicalCPUs: os.cpus().length,
      memoryBytes: os.totalmem(),
    },
    repetitions,
    pilot: repetitions < 20,
    viewport: { width: 1600, height: 1000 },
    dpr: 1,
    motion: "no-preference",
    clock:
      "Date fixed at 2026-10-02T12:00:00+08:00; timers and performance.now run normally",
    identity,
    runnerIdentity,
    sourceRoot,
    snapshot,
    boundary:
      "Navigation to ready/fonts/two frames and finite animations settled; operations include automation dispatch/async readiness waits. CDP CPU/layout counters are separate from elapsed UI time. Infinite background animations continue. No human think time; JSON restore uses in-memory File.",
    datasets: fixtures.map((fixture) => fixture.metadata),
    runs: [],
    summaries: [],
    complete: false,
  };
  const url = pathToFileURL(path.join(sourceRoot, "index.html")).href;
  for (const fixture of fixtures) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const context = await browser.newContext({
        viewport: report.viewport,
        deviceScaleFactor: 1,
        timezoneId: "Asia/Shanghai",
        reducedMotion: "no-preference",
      });
      try {
        // Seed the same file origin before timing, without loading the application.
        const seedPage = await context.newPage();
        await seedPage.route("**/index.html", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html><body>Performance seed</body></html>",
          }),
        );
        await seedPage.goto(url);
        await seedPage.evaluate(
          (state) =>
            localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
          fixture.state,
        );
        await seedPage.close();
        await context.addInitScript(() => {
          window.benchmarkTasks = [];
          window.benchmarkReads = 0;
          window.benchmarkMeasures = 0;
          if (!PerformanceObserver.supportedEntryTypes.includes("longtask"))
            throw Error("Long task observation unavailable");
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              window.benchmarkTasks.push({
                startTime: entry.startTime,
                duration: entry.duration,
              });
          }).observe({ type: "longtask", buffered: true });
          const rect = Element.prototype.getBoundingClientRect;
          Element.prototype.getBoundingClientRect = function (...values) {
            if (
              this.classList.contains("ui-aligned-text") ||
              (this.tagName === "I" &&
                this.getAttribute("aria-hidden") === "true")
            )
              window.benchmarkReads++;
            return rect.apply(this, values);
          };
          const measure = CanvasRenderingContext2D.prototype.measureText;
          CanvasRenderingContext2D.prototype.measureText = function (
            ...values
          ) {
            window.benchmarkMeasures++;
            return measure.apply(this, values);
          };
        });
        const page = await context.newPage(),
          errors = [];
        await fixBusinessDate(page);
        page.on("pageerror", (error) => errors.push(error.message));
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        const run = {
          years: fixture.metadata.years,
          repetition,
          operations: [],
        };
        async function capture(name, start, before, counters) {
          await settle(page);
          const sample = await page.evaluate(
            ({ start, counters }) => {
              const end = performance.now();
              return {
                durationMs: end - start,
                longTasks: window.benchmarkTasks.filter(
                  (task) =>
                    task.startTime < end &&
                    task.startTime + task.duration > start,
                ),
                alignmentRectReads: window.benchmarkReads - counters.reads,
                canvasMeasureCalls:
                  window.benchmarkMeasures - counters.measures,
              };
            },
            { start, counters },
          );
          const after = await metrics(session);
          sample.cdp = Object.fromEntries(
            [
              "LayoutCount",
              "RecalcStyleCount",
              "LayoutDuration",
              "RecalcStyleDuration",
              "ScriptDuration",
              "TaskDuration",
            ].map((key) => [key, after[key] - before[key]]),
          );
          assert(
            Object.values(sample.cdp).every(Number.isFinite),
            "CDP metrics unavailable",
          );
          run.operations.push({ name, ...sample });
        }
        async function operation(name, action) {
          const before = await metrics(session);
          const mark = await page.evaluate(() => ({
            start: performance.now(),
            counters: {
              reads: window.benchmarkReads,
              measures: window.benchmarkMeasures,
            },
          }));
          await action();
          await capture(name, mark.start, before, mark.counters);
        }
        const initial = await metrics(session);
        await page.goto(url);
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading") &&
            document.fonts.status === "loaded",
        );
        await capture("firstScreen", 0, initial, { reads: 0, measures: 0 });
        assert.equal(
          await page.evaluate(
            () =>
              Object.keys(
                JSON.parse(localStorage.getItem("worktime-local-v1")).days,
              ).length,
          ),
          fixture.metadata.days,
        );
        await operation("save", () =>
          page.evaluate(() => {
            document.querySelector("#dayStart").value = "08:00";
            document.querySelector("#dayEnd").value = "20:00";
            document
              .querySelector("#dayStart")
              .dispatchEvent(new Event("input", { bubbles: true }));
            document
              .querySelector("#dayEnd")
              .dispatchEvent(new Event("input", { bubbles: true }));
          }),
        );
        assert(
          await page.evaluate(() =>
            (() => {
              const day = JSON.parse(localStorage.getItem("worktime-local-v1"))
                .days["2026-10-02"];
              return (
                day?.actual?.end === "20:00" || day?.estimate?.end === "20:00"
              );
            })(),
          ),
          "Save did not persist",
        );
        await operation("year", () =>
          page.locator("#monthTitle").evaluate((element) => element.click()),
        );
        assert.equal(await page.locator(".year-month").count(), 12);
        await operation("month", () =>
          page.locator("#monthTitle").evaluate((element) => element.click()),
        );
        assert.equal(await page.locator(".year-month").count(), 0);
        await operation("import", async () => {
          await page.evaluate(() => {
            document.querySelector("#importOpen").click();
            const month = String(new Date().getMonth() + 1).padStart(2, "0");
            const text = document.querySelector("#pasteText");
            text.value = Array.from(
              { length: 28 },
              (_, index) =>
                `${month}/${String(index + 1).padStart(2, "0")}\n08:00\n19:30`,
            ).join("\n");
            text.dispatchEvent(new Event("input", { bubbles: true }));
          });
          await page.waitForFunction(
            () => !document.querySelector("#commitImport").disabled,
          );
          await page
            .locator("#commitImport")
            .evaluate((element) => element.click());
        });
        const imported = await page.evaluate(
          () => JSON.parse(localStorage.getItem("worktime-local-v1")).imports,
        );
        assert.equal(imported.length, fixture.metadata.imports + 1);
        assert.equal(imported.at(-1).records.length, 28);
        await operation("restore", async () => {
          await page.locator("#backupFile").setInputFiles({
            name: "performance-fixture.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(fixture.state)),
          });
          await page.waitForFunction(
            () => document.querySelector("#restoreDialog").open,
          );
          await page
            .locator("#confirmRestore")
            .evaluate((element) => element.click());
        });
        assert.deepEqual(
          await page.evaluate(() =>
            JSON.parse(localStorage.getItem("worktime-local-v1")),
          ),
          fixture.state,
        );
        assert.deepEqual(
          errors,
          [],
          "Page errors invalidate performance results",
        );
        report.runs.push(run);
        fs.writeFileSync(
          output + ".partial.json",
          JSON.stringify(report, null, 2),
        );
        console.log(
          `Measured ${fixture.metadata.years} years: ${repetition + 1}/${repetitions}`,
        );
      } finally {
        await context.close();
      }
    }
  }
  for (const years of [1, 5, 10])
    for (const name of [
      "firstScreen",
      "save",
      "year",
      "month",
      "import",
      "restore",
    ]) {
      const operations = report.runs
        .filter((run) => run.years === years)
        .map((run) =>
          run.operations.find((operation) => operation.name === name),
        );
      report.summaries.push({
        years,
        name,
        elapsedMs: summary(operations.map((operation) => operation.durationMs)),
        layoutMs: summary(
          operations.map((operation) => operation.cdp.LayoutDuration * 1000),
        ),
        scriptMs: summary(
          operations.map((operation) => operation.cdp.ScriptDuration * 1000),
        ),
        longTaskCount: operations.reduce(
          (n, operation) => n + operation.longTasks.length,
          0,
        ),
        maxLongTaskMs: Math.max(
          0,
          ...operations.flatMap((operation) =>
            operation.longTasks.map((task) => task.duration),
          ),
        ),
      });
    }
  report.complete = true;
  for (const [file, digest] of Object.entries(identity))
    assert.equal(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(sourceRoot, file)))
        .digest("hex"),
      digest,
      "Source changed during benchmark: " + file,
    );
  for (const [file, digest] of Object.entries(runnerIdentity))
    assert.equal(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
      digest,
      "Runner changed during benchmark: " + file,
    );
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  fs.writeFileSync(output + ".partial.json", JSON.stringify(report, null, 2));
  console.log(
    `Benchmark complete: ${report.runs.length} isolated runs; ${output}`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
