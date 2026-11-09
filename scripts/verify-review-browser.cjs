"use strict";
/** UI lifetime checks without loading reader internals. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const {
  runtimeServer,
  installRuntimeFixture,
} = require("./runtime-test-helpers.cjs");
async function main() {
  const root = path.resolve(process.argv[2] || ".");
  const server = await runtimeServer(root);
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 960 },
      serviceWorkers: "block",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installRuntimeFixture);
    await page.addInitScript(() => {
      window.reviewObservers = { resize: new Set(), mutation: new Set() };
      for (const [name, kind] of [
        ["ResizeObserver", "resize"],
        ["MutationObserver", "mutation"],
      ]) {
        const Native = window[name];
        window[name] = class extends Native {
          observed = new Set();
          observe(target, options) {
            this.observed.add(target);
            window.reviewObservers[kind].add(this);
            return super.observe(target, options);
          }
          unobserve(target) {
            this.observed.delete(target);
            if (!this.observed.size) window.reviewObservers[kind].delete(this);
            return super.unobserve(target);
          }
          disconnect() {
            this.observed.clear();
            window.reviewObservers[kind].delete(this);
            return super.disconnect();
          }
        };
      }
    });
    await page.addInitScript(() =>
      localStorage.setItem("worktime.installReminder.dismissed.v1", "true"),
    );
    await page.goto(server.url);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        WorkTimeApp.services.runtimeFolder.state.status === "available",
    );
    if (await page.locator("#onboardingDialog[open]").count())
      await page.locator("[data-onboarding-next]").click();
    await page.evaluate(() => WorkTimeApp.ui.music.open());
    await page.locator("#musicDialog[data-state=open]").waitFor();
    await page.evaluate(() => WorkTimeApp.ui.music.close());
    await page.locator("#musicDialog").waitFor({ state: "hidden" });
    await page.waitForTimeout(1200);
    const cdp = await page.context().newCDPSession(page);
    const resources = async () => {
      const value = await cdp.send("Runtime.evaluate", {
        expression: `JSON.stringify([window,document].map(target=>Object.fromEntries(Object.entries(getEventListeners(target)).map(([key,list])=>[key,list.length]))))`,
        includeCommandLineAPI: true,
        returnByValue: true,
      });
      return JSON.parse(value.result.value);
    };
    const before = await resources();
    const observerCounts = () =>
      page.evaluate(() =>
        Object.fromEntries(
          Object.entries(window.reviewObservers).map(([name, active]) => [
            name,
            active.size,
          ]),
        ),
      );
    const observersBefore = await observerCounts();
    for (let cycle = 0; cycle < 20; cycle++) {
      await page.evaluate(() => WorkTimeApp.ui.music.open());
      await page.locator("#musicDialog[data-state=open]").waitFor();
      await page.evaluate(() => WorkTimeApp.ui.music.close());
      await page.locator("#musicDialog").waitFor({ state: "hidden" });
    }
    const after = await resources();
    const observersAfter = await observerCounts();
    assert.deepEqual(
      observersAfter,
      observersBefore,
      "20 UI cycles must not accumulate observers",
    );
    assert.deepEqual(
      after,
      before,
      "20 music open/close cycles must not add global listeners",
    );
    const importer = await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder,
        original = runtime.importFiles;
      const host = document.createElement("div"),
        statusHost = document.createElement("div");
      document.body.append(host, statusHost);
      let complete,
        progress,
        refreshes = 0;
      runtime.importFiles = (_kind, _files, options) => {
        progress = options.progress;
        return new Promise((resolve) => {
          complete = resolve;
        });
      };
      try {
        const importer = WorkTimeApp.ui.createRuntimeImport({
          host,
          statusHost,
          kind: "music",
          refresh: () => {
            refreshes++;
          },
        });
        const task = importer.importFiles([new File(["test"], "test.wav")]);
        importer.dispose();
        importer.dispose();
        progress({ totalBytes: 1, processedBytes: 1 });
        complete({ completed: 1, errors: [] });
        await task;
        return {
          refreshes,
          nodes: host.childElementCount + statusHost.childElementCount,
        };
      } finally {
        runtime.importFiles = original;
        host.remove();
        statusHost.remove();
      }
    });
    assert.deepEqual(importer, { refreshes: 0, nodes: 0 });
    const restoreRace = await page.evaluate(async () => {
      const input = document.getElementById("backupFile");
      const first = WorkTimeApp.domain.state.defaultState();
      first.days = { "2026-11-01": { note: "older selection" } };
      const latest = WorkTimeApp.domain.state.defaultState();
      latest.days = {
        "2026-11-01": { note: "latest" },
        "2026-11-02": { note: "latest" },
      };
      let complete;
      const delayed = new Promise((resolve) => {
        complete = resolve;
      });
      const event = (text) => ({
        target: { files: [{ size: 1, text: () => text }], value: "fixture" },
      });
      const old = input.onchange(event(delayed));
      await input.onchange(event(Promise.resolve(JSON.stringify(latest))));
      const summary = document.getElementById("restoreSummary").textContent;
      complete(JSON.stringify(first));
      await old;
      const retained =
        document.getElementById("restoreSummary").textContent === summary;
      document.getElementById("restoreDialog").close();
      return retained;
    });
    assert.equal(
      restoreRace,
      true,
      "a late old file must not replace the latest restore preview",
    );
    await page.locator("#readerOpen").click();
    assert.equal(await page.locator(".reader-placeholder").isVisible(), true);
    assert.equal(await page.locator("#readerDialog").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /reader-runtime|vendor\/reader/.test(entry.name)),
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() => typeof window.Solar),
      "undefined",
      "default work view keeps lunar engine lazy",
    );
    await page.route(/\/lunar\.min\.js(?:\?|$)/, (route) => route.abort(), {
      times: 1,
    });
    assert.equal(
      await page.evaluate(async () => {
        try {
          await WorkTimeApp.services.dateInfo.loadLunar();
          return false;
        } catch {
          return true;
        }
      }),
      true,
      "failed lunar loads must reject and remain retryable",
    );
    assert.equal(
      await page.evaluate(async () => {
        await WorkTimeApp.services.dateInfo.loadLunar();
        return Boolean(
          WorkTimeApp.services.dateInfo.lunar("2026-11-09").toString(),
        );
      }),
      true,
    );
    const offline = await browser.newPage({ reducedMotion: "reduce" });
    offline.on("pageerror", (error) => errors.push(error.message));
    await offline.route(/^https?:/, (route) => route.abort());
    await offline.goto(pathToFileURL(path.join(root, "index.html")).href);
    await offline.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await offline.evaluate(async () => {
        await WorkTimeApp.services.dateInfo.loadLunar();
        return Boolean(
          WorkTimeApp.services.dateInfo.lunar("2026-11-09").toString(),
        );
      }),
      true,
      "lunar engine loads offline over file://",
    );
    const broken = await browser.newPage({ reducedMotion: "reduce" });
    broken.on("pageerror", (error) => errors.push(error.message));
    await broken.addInitScript(installRuntimeFixture);
    await broken.route(
      /\/core-runtime\.min\.js(?:\?|$)/,
      (route) => route.abort(),
      { times: 1 },
    );
    await broken.goto(server.url);
    await broken.waitForFunction(
      () => document.documentElement.dataset.appState === "failed",
    );
    assert.equal(await broken.locator("#startupFailure").isVisible(), true);
    assert.equal(
      await broken.locator("#startupFailure button").isEnabled(),
      true,
    );
    await broken.locator("#startupFailure button").click();
    await broken.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.deepEqual(errors, []);
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/review-lifecycle" +
        (root.endsWith("_site") ? "-published" : "") +
        ".json",
      JSON.stringify(
        {
          before,
          after,
          observersBefore,
          observersAfter,
          cycles: 20,
          importer,
          restoreRace,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "20 UI open/close cycles, disposed import callbacks and reader placeholder/loading boundary passed.",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
