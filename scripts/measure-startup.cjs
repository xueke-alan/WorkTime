"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { startupServer } = require("./lib/startup-test-server.cjs");

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (
    ![
      "--site",
      "--offline",
      "--out",
      "--baseline",
      "--samples",
      "--minimum-cold-improvement-percent",
    ].includes(name) ||
    !process.argv[i + 1]
  )
    throw Error(
      "Expected --site, --offline, --out, --baseline, --samples or --minimum-cold-improvement-percent with a value",
    );
  options[name.slice(2)] = process.argv[i + 1];
}
const count = Number(options.samples || 10);
assert.ok(Number.isInteger(count) && count >= 1);
const minimumColdImprovement = Number(
  options["minimum-cold-improvement-percent"] ?? 10,
);
assert.ok(
  Number.isFinite(minimumColdImprovement) &&
    minimumColdImprovement >= 0 &&
    minimumColdImprovement < 100,
);
const config = {
  samples: count,
  cpuThrottle: 4,
  latencyMs: 150,
  downloadBitsPerSecond: 1600000,
  uploadBitsPerSecond: 750000,
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  serviceWorkers: "block",
  cold: "fresh context and HTTP cache; browser/GPU warmed independently of the app",
  warm: "second tab in the same context after the first tab has closed",
  clock:
    "native performance/timers; business date anchored at 2026-11-10T04:00:00Z",
};

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: Math.round(
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.ceil((sorted.length - 1) / 2)]) /
        2,
    ),
    p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
  };
}
async function instrument(context) {
  await context.addInitScript(() => {
    // Playwright's context-wide virtual clock carries time across warm tabs.
    // Fix only the business date, leaving navigation timing and timers native.
    const NativeDate = window.Date,
      started = NativeDate.now(),
      fixed = NativeDate.parse("2026-11-10T04:00:00Z");
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixed + NativeDate.now() - started]));
      }
      static now() {
        return fixed + NativeDate.now() - started;
      }
    };
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      const value = show.apply(this, args);
      if (this.id === "onboardingDialog") this.close();
      return value;
    };
    window.startupMeasurement = { tasks: [], stages: [] };
    document.addEventListener(
      "worktime:ready",
      () => {
        window.startupMeasurement.ready = performance.now();
      },
      { once: true },
    );
    document.addEventListener(
      "load",
      (event) => {
        if (event.target.tagName !== "SCRIPT") return;
        const match = event.target.src.match(
          /\/(core|date|view|startup)-runtime\.min\.js/,
        );
        if (match) window.startupMeasurement.stages.push(match[1]);
        if (match?.[1] === "startup") {
          const alignment = WorkTimeApp.ui.alignment,
            prepare = alignment.prepareFirstPaint;
          alignment.prepareFirstPaint = (...args) => {
            const started = performance.now();
            try {
              return prepare(...args);
            } finally {
              window.startupMeasurement.alignment = performance.now() - started;
            }
          };
        }
      },
      true,
    );
    const observer = new MutationObserver(() => {
      if (
        window.startupMeasurement.scheduled ||
        document.documentElement?.dataset.appState !== "ready" ||
        document.documentElement.classList.contains("app-loading")
      )
        return;
      window.startupMeasurement.scheduled = true;
      requestAnimationFrame(() => {
        if (
          !document.hidden &&
          !document.documentElement.classList.contains("app-loading")
        )
          window.startupMeasurement.visible = performance.now();
      });
      observer.disconnect();
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-app-state"],
    });
    new PerformanceObserver((list) =>
      window.startupMeasurement.tasks.push(
        ...list.getEntries().map((entry) => ({
          start: entry.startTime,
          duration: entry.duration,
        })),
      ),
    ).observe({ type: "longtask", buffered: true });
  });
}
async function sample(context, url, transport) {
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: config.cpuThrottle,
  });
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: ["https://*"] });
  if (transport === "http")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: config.latencyMs,
      downloadThroughput: config.downloadBitsPerSecond / 8,
      uploadThroughput: config.uploadBitsPerSecond / 8,
      connectionType: "cellular4g",
    });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.startupMeasurement.visible, null, {
    timeout: 30000,
  });
  const result = await page.evaluate(() => {
    const { ready, visible, tasks, stages } = window.startupMeasurement;
    const occupied = tasks
      .filter((task) => task.start < visible)
      .map((task) => Math.min(task.duration, visible - task.start));
    return {
      ready: Math.round(ready),
      visible: Math.round(visible),
      reveal: Math.round(visible - ready),
      longestTask: Math.round(Math.max(0, ...occupied)),
      stages,
      alignment: Math.round(window.startupMeasurement.alignment),
      resources: performance
        .getEntriesByType("resource")
        .filter((entry) =>
          /\/(?:core|date|view|startup)-runtime\.min\.js/.test(entry.name),
        )
        .map((entry) => ({
          name: entry.name.split("/").at(-1),
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
          transfer: entry.transferSize,
        })),
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(result.stages, ["core", "date", "view", "startup"]);
  await page.waitForTimeout(650);
  if (await page.evaluate(() => !!WorkTimeApp.ui.secondaryControllers)) {
    await page.waitForFunction(
      () => WorkTimeApp.ui.secondaryControllers.state === "ready",
      null,
      { timeout: 25000 },
    );
    result.prewarm = await page.evaluate(
      () => WorkTimeApp.ui.secondaryControllers.completedAt,
    );
  } else result.prewarm = null;
  await page.close();
  return result;
}
async function main() {
  const server = await startupServer(options.site || "_site");
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const report = {
    config,
    browser: browser.version(),
    measurements: {},
    summary: {},
    acceptance: {
      minimumColdImprovementPercent: minimumColdImprovement,
      maximumOtherP95RegressionPercent: 5,
    },
  };
  try {
    // Browser/GPU initialization is outside the navigation under measurement.
    const warmup = await browser.newPage();
    await warmup.setContent("<canvas width=1440 height=900></canvas>");
    await warmup.evaluate(() => {
      const ctx = document.querySelector("canvas").getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillRect(0, 0, 1, 1);
    });
    await warmup.close();
    for (let run = 0; run < count; run++) {
      for (const transport of ["http", "file"])
        for (const motion of ["full", "reduce"]) {
          const context = await browser.newContext({
            locale: config.locale,
            viewport: config.viewport,
            reducedMotion: motion === "full" ? "no-preference" : "reduce",
            serviceWorkers: "block",
          });
          try {
            await instrument(context);
            const url =
              transport === "http"
                ? server.url
                : pathToFileURL(path.resolve(options.offline || "index.html"))
                    .href;
            for (const cache of ["cold", "warm"]) {
              const key = [transport, motion, cache].join("/");
              (report.measurements[key] ||= []).push(
                await sample(context, url, transport),
              );
            }
          } finally {
            await context.close();
          }
        }
      console.log(`Completed startup sample ${run + 1}/${count}`);
    }
    for (const [key, values] of Object.entries(report.measurements)) {
      report.summary[key] = Object.fromEntries(
        ["ready", "visible", "reveal", "longestTask", "alignment"].map(
          (metric) => [metric, summarize(values.map((value) => value[metric]))],
        ),
      );
      const prewarmed = values.filter((value) => value.prewarm !== null);
      report.summary[key].prewarm = prewarmed.length
        ? summarize(prewarmed.map((value) => value.prewarm))
        : null;
      report.summary[key].prewarmAfterVisible = prewarmed.length
        ? summarize(prewarmed.map((value) => value.prewarm - value.visible))
        : null;
    }
    if (options.baseline) {
      const baseline = JSON.parse(fs.readFileSync(options.baseline, "utf8"));
      assert.deepEqual(
        report.config,
        baseline.config,
        "Benchmark conditions must match",
      );
      report.comparison = {};
      for (const [key, value] of Object.entries(report.summary)) {
        const before = baseline.summary[key].visible;
        const improvement = 1 - value.visible.median / before.median;
        const regression = value.visible.p95 / before.p95 - 1;
        report.comparison[key] = {
          medianImprovementPercent: Number((improvement * 100).toFixed(1)),
          p95RegressionPercent: Number((regression * 100).toFixed(1)),
          passed:
            key === "http/full/cold" || key === "http/reduce/cold"
              ? improvement >= minimumColdImprovement / 100
              : regression <= 0.05,
        };
      }
    }
    const output = path.resolve(
      options.out || "test-results/startup-speed/measurement.json",
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify(
        { summary: report.summary, comparison: report.comparison, output },
        null,
        2,
      ),
    );
    if (report.comparison)
      assert.ok(
        Object.values(report.comparison).every((item) => item.passed),
        "Startup performance acceptance failed; see report",
      );
  } finally {
    await browser.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
