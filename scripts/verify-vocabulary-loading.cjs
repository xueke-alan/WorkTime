"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
async function main() {
  const site = path.resolve(
    process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) ||
      path.join(__dirname, ".."),
  );
  const server = await runtimeServer(site);
  const browser = await chromium.launch({ headless: true });
  try {
    // Automatic idle preparation must finish before any vocabulary click,
    // without opening a view, starting a session or loading voice models.
    const warm = await browser.newPage({ serviceWorkers: "block" });
    const warmErrors = [],
      warmRequests = [];
    warm.on("pageerror", (error) => warmErrors.push(error.message));
    warm.on("request", (request) => warmRequests.push(request.url()));
    await warm.addInitScript(() =>
      localStorage.setItem(
        "worktime.vocabulary.audio-settings",
        JSON.stringify({ enabled: false }),
      ),
    );
    await warm.goto(
      process.argv.includes("--file")
        ? pathToFileURL(path.join(site, "index.html")).href
        : server.url,
    );
    await warm.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await warm.waitForFunction(
      () => !!document.getElementById("vocabularyContent"),
    );
    assert.equal(await warm.locator("#vocabularyPanel").isVisible(), false);
    const before = await warm.evaluate(() =>
      WorkTimeApp.services.vocabularyStorage.read(),
    );
    assert.equal(before.draft, null);
    assert.equal(before.logs.length, 0);
    const uiRequests = () =>
      warmRequests.filter((url) =>
        /\/(?:assets\/css\/vocabulary\.css|assets\/js\/ui\/vocabulary-runtime\.min\.js|assets\/data\/vocabulary\/catalog\.js)(?:\?|$)/.test(
          url,
        ),
      );
    assert.equal(uiRequests().length, 3);
    assert.equal(
      warmRequests.filter((url) =>
        /\/assets\/vendor\/vocabulary\/(?:manifest|worker-source|supertonic-worker-source)\.js/.test(
          url,
        ),
      ).length,
      0,
    );
    await warm.locator("#date-tab-tools").click();
    await warm.locator("#vocabularyOpen").click();
    await warm.locator(".vocabulary-card").waitFor();
    assert.equal(
      uiRequests().length,
      3,
      "Warm opening fetches no additional UI resources",
    );
    assert.deepEqual(warmErrors, []);
    await warm.close();

    const failedWarm = await browser.newPage({ serviceWorkers: "block" });
    await failedWarm.addInitScript(() =>
      localStorage.setItem(
        "worktime.vocabulary.audio-settings",
        JSON.stringify({ enabled: false }),
      ),
    );
    let attempts = 0;
    await failedWarm.route(/\/assets\/css\/vocabulary\.css(?:\?|$)/, (route) =>
      ++attempts === 1 ? route.abort() : route.continue(),
    );
    const failed = failedWarm.waitForEvent("requestfailed", {
      predicate: (request) =>
        /\/assets\/css\/vocabulary\.css(?:\?|$)/.test(request.url()),
    });
    await failedWarm.goto(server.url);
    await failed;
    await failedWarm.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    assert.equal(
      await failedWarm.locator("#vocabularyPanel").isVisible(),
      false,
    );
    await failedWarm.locator("#date-tab-tools").click();
    assert.notEqual(
      await failedWarm.locator("#vocabularyOpen > span").innerText(),
      "重试",
      "A background failure does not change the entry UI",
    );
    await failedWarm.locator("#vocabularyOpen").click();
    await failedWarm.locator(".vocabulary-card").waitFor();
    assert.equal(attempts, 2, "Clicking retries a failed background preload");
    await failedWarm.close();

    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        // Exercise a genuinely cold click before any background idle work runs.
        window.requestIdleCallback = () => 0;
        window.cancelIdleCallback = () => {};
        localStorage.setItem(
          "worktime.vocabulary.audio-settings",
          JSON.stringify({ enabled: false }),
        );
      });
      await page.goto(server.url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#date-tab-tools").click();
      let releaseStyle, releaseUI, signalStyle, signalUI;
      const styleBlocked = new Promise((resolve) => {
        signalStyle = resolve;
      });
      const uiBlocked = new Promise((resolve) => {
        signalUI = resolve;
      });
      let styles = 0,
        runtimes = 0,
        rejectStyle = true;
      await page.route(
        /\/assets\/css\/vocabulary\.css(?:\?|$)/,
        async (route) => {
          styles++;
          if (rejectStyle) return route.abort();
          await new Promise((resolve) => {
            releaseStyle = resolve;
            signalStyle();
          });
          await route.continue();
        },
      );
      await page.route(
        /\/assets\/js\/ui\/vocabulary-runtime\.min\.js(?:\?|$)/,
        async (route) => {
          runtimes++;
          await new Promise((resolve) => {
            releaseUI = resolve;
            signalUI();
          });
          await route.continue();
        },
      );
      await page.locator("#vocabularyOpen").click();
      await page.waitForFunction(
        () =>
          !document.getElementById("vocabularyOpen").hasAttribute("aria-busy"),
      );
      assert(
        await page.locator(".tools-cards").isVisible(),
        JSON.stringify(
          await page.evaluate(() => ({
            tools: WorkTimeApp.ui.dateInfo.isActive("tools"),
            vocabulary: WorkTimeApp.ui.dateInfo.isActive("vocabulary"),
            open: String(WorkTimeApp.ui.vocabulary.open).slice(0, 700),
            panel: document
              .getElementById("vocabularyPanel")
              .outerHTML.slice(0, 400),
          })),
        ),
      );
      assert.equal(await page.locator("#vocabularyPanel").isVisible(), false);
      assert.equal(
        await page.locator("#vocabularyOpen > span").innerText(),
        "重试",
      );
      rejectStyle = false;
      const styleRequest = page.waitForRequest(
        /\/assets\/css\/vocabulary\.css(?:\?|$)/,
      );
      await page.locator("#vocabularyOpen").click();
      await styleRequest;
      await styleBlocked;
      assert(releaseStyle);
      assert(await page.locator(".tools-cards").isVisible());
      assert.equal(await page.locator("#vocabularyPanel").isVisible(), false);
      await page.locator("#vocabularyOpen").click();
      assert.equal(styles, 2, "Repeated clicks share one style request");
      const runtimeRequest = page.waitForRequest(
        /\/assets\/js\/ui\/vocabulary-runtime\.min\.js(?:\?|$)/,
      );
      releaseStyle();
      await runtimeRequest;
      await uiBlocked;
      assert(releaseUI);
      assert(await page.locator(".tools-cards").isVisible());
      assert.equal(await page.locator("#vocabularyPanel").isVisible(), false);
      assert.equal(await page.locator("#vocabularyContent").count(), 0);
      if (width === 390) await page.locator("#date-tab-notifications").click();
      releaseUI();
      await page.waitForFunction(
        () =>
          !document.getElementById("vocabularyOpen").hasAttribute("aria-busy"),
      );
      if (width === 390) {
        assert.equal(
          await page.locator("#vocabularyPanel").isVisible(),
          false,
          "Late runtime cannot reopen a view the user left",
        );
        await page.locator("#date-tab-tools").click();
        await page.locator("#vocabularyOpen").click();
      }
      await page.locator(".vocabulary-card").waitFor();
      assert.equal(
        await page.locator(".vocabulary-header h2").innerText(),
        "摸摸背单词",
      );
      assert.equal(
        await page.locator(".vocabulary-navigation button").count(),
        4,
      );
      assert.equal(
        await page
          .locator(".vocabulary-card")
          .evaluate((el) => getComputedStyle(el).display),
        "flex",
      );
      assert.equal(runtimes, 1);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Idle UI preload, warm opening, preload failure/retry, delayed cold CSS/runtime, repeated clicks, cancellation and mobile passed.",
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
