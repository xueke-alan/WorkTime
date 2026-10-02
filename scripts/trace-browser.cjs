"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  { buildPerformanceFixture } = require("./performance-fixtures.cjs");
const root = path.resolve(__dirname, ".."),
  output = path.resolve(process.argv[2] || "docs/performance-trace.json.gz"),
  reportPath = output + ".summary.json",
  url = pathToFileURL(path.join(root, "index.html")).href,
  fixture = buildPerformanceFixture(10);
assert(
  !fs.existsSync(output) && !fs.existsSync(reportPath),
  "Refusing to overwrite historical trace",
);
const original = fs.readFileSync(
    path.join(root, "assets/js/ui-alignment.js"),
    "utf8",
  ),
  startAnchor =
    "function refresh(scopes = null) {\n    if (disposed || suspended || document.hidden) return;",
  endAnchor = "    alignTexts(targets);\n    observe();";
assert.equal(original.split(startAnchor).length, 2);
assert.equal(original.split(endAnchor).length, 2);
const instrumented = original
  .replace(
    startAnchor,
    startAnchor + "\n    const traceStart = performance.now();",
  )
  .replace(
    endAnchor,
    endAnchor +
      '\n    performance.measure("worktime:alignment-refresh", {start:traceStart,end:performance.now()});',
  );
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
    throw Error("Animations did not settle");
  });
}
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    timezoneId: "Asia/Shanghai",
    reducedMotion: "no-preference",
  });
  const seed = await context.newPage();
  await seed.route("**/index.html", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await seed.goto(url);
  await seed.evaluate(
    (state) => localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
    fixture.state,
  );
  await seed.close();
  await context.route("**/ui-alignment.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: instrumented,
    }),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await context.newCDPSession(page),
    operations = [];
  await session.send("Tracing.start", {
    categories:
      "devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.cpu_profiler",
    transferMode: "ReturnAsStream",
  });
  async function capture(name, action) {
    const start =
      name === "firstScreen" ? 0 : await page.evaluate(() => performance.now());
    await action();
    await settle(page);
    operations.push(
      await page.evaluate(
        ({ name, start }) => {
          const end = performance.now(),
            refreshes = performance
              .getEntriesByName("worktime:alignment-refresh")
              .filter(
                (entry) => entry.startTime >= start && entry.startTime < end,
              );
          performance.measure("worktime:operation:" + name, { start, end });
          return {
            name,
            elapsedMs: end - start,
            refreshCount: refreshes.length,
            refreshTotalMs: refreshes.reduce(
              (sum, entry) => sum + entry.duration,
              0,
            ),
            refreshMaxMs: Math.max(
              0,
              ...refreshes.map((entry) => entry.duration),
            ),
          };
        },
        { name, start },
      ),
    );
  }
  await capture("firstScreen", async () => {
    await page.goto(url);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading") &&
        document.fonts.status === "loaded",
    );
  });
  await capture("save", () =>
    page.evaluate(() => {
      document.querySelector("#dayStart").value = "08:00";
      document.querySelector("#dayEnd").value = "20:00";
      for (const id of ["dayStart", "dayEnd"])
        document
          .getElementById(id)
          .dispatchEvent(new Event("input", { bubbles: true }));
    }),
  );
  assert(
    await page.evaluate(() =>
      Object.values(JSON.parse(localStorage.getItem(WorkTime.KEY)).days).some(
        (day) => day.actual?.end === "20:00" || day.estimate?.end === "20:00",
      ),
    ),
  );
  await capture("year", () =>
    page.locator("#monthTitle").evaluate((element) => element.click()),
  );
  assert.equal(await page.locator(".year-month").count(), 12);
  await capture("month", () =>
    page.locator("#monthTitle").evaluate((element) => element.click()),
  );
  assert.equal(await page.locator(".year-month").count(), 0);
  await capture("import", async () => {
    await page.evaluate(() => {
      document.querySelector("#importOpen").click();
      const text = document.querySelector("#pasteText"),
        month = WorkTime.businessDate().slice(5, 7);
      text.value = Array.from(
        { length: 28 },
        (_, i) => `${month}/${String(i + 1).padStart(2, "0")}\n08:00\n19:30`,
      ).join("\n");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
      () => !document.querySelector("#commitImport").disabled,
    );
    await page.locator("#commitImport").evaluate((element) => element.click());
  });
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTime.KEY)).imports.at(-1).records
          .length,
    ),
    28,
  );
  await capture("restore", async () => {
    await page.locator("#backupFile").setInputFiles({
      name: "trace-fixture.json",
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
    await page.evaluate(() => JSON.parse(localStorage.getItem(WorkTime.KEY))),
    fixture.state,
  );
  assert.deepEqual(errors, []);
  const complete = new Promise((resolve) =>
    session.once("Tracing.tracingComplete", resolve),
  );
  await session.send("Tracing.end");
  const { stream } = await complete,
    chunks = [];
  for (;;) {
    const response = await session.send("IO.read", { handle: stream });
    chunks.push(
      Buffer.from(response.data, response.base64Encoded ? "base64" : "utf8"),
    );
    if (response.eof) break;
  }
  await session.send("IO.close", { handle: stream });
  const raw = Buffer.concat(chunks),
    trace = JSON.parse(raw.toString()),
    events = trace.traceEvents;
  const layout = events.filter(
    (event) => event.ph === "X" && event.name === "Layout",
  );
  assert(layout.length > 0, "Trace lacks raw layout events");
  assert(
    operations.every((operation) => operation.refreshCount > 0),
    "Alignment instrumentation did not execute",
  );
  const totals = {};
  for (const event of events.filter(
    (event) =>
      event.ph === "X" &&
      [
        "Layout",
        "UpdateLayoutTree",
        "FunctionCall",
        "EvaluateScript",
        "RunTask",
      ].includes(event.name),
  )) {
    const key = event.pid + ":" + event.tid + ":" + event.name;
    if (!totals[key])
      totals[key] = {
        pid: event.pid,
        tid: event.tid,
        name: event.name,
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };
    const duration = (event.dur || 0) / 1000;
    totals[key].count++;
    totals[key].totalMs += duration;
    totals[key].maxMs = Math.max(totals[key].maxMs, duration);
  }
  fs.writeFileSync(output, zlib.gzipSync(raw));
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        complete: true,
        createdAt: new Date().toISOString(),
        browser: await browser.version(),
        fixture: fixture.metadata,
        method:
          "Diagnostic single ten-year run; route-instrumented alignment, normal animation, real clock; tracing overhead excludes this from performance budget comparison",
        alignmentOriginalSHA256: crypto
          .createHash("sha256")
          .update(original)
          .digest("hex"),
        instrumentedSHA256: crypto
          .createHash("sha256")
          .update(instrumented)
          .digest("hex"),
        rawSHA256: crypto.createHash("sha256").update(raw).digest("hex"),
        eventCount: events.length,
        operations,
        threadTotals: Object.values(totals),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ raw: output, events: events.length, operations }),
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
