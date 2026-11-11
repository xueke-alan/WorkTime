"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
require("./lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const root = path.resolve(process.argv[2] || ".");
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      const ready = async () => {
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
        await page.evaluate(() =>
          WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
        );
      };
      await ready();
      assert.equal(
        await page
          .locator('link[href*="analysis.css"],link[href*="game-session.css"]')
          .count(),
        0,
      );
      let fail = true;
      const intercept = (route) => (fail ? route.abort() : route.continue());
      await page.route(/analysis\.css/, intercept);
      const dialog = page
        .waitForEvent("dialog")
        .then((value) => value.accept());
      await page.locator("#analysisToggle").click();
      await dialog;
      assert.equal(
        await page.locator("#analysisToggle").getAttribute("aria-pressed"),
        "false",
      );
      fail = false;
      // A late stylesheet must not reopen analysis after the user chose another view.
      let releaseStyle;
      const blocked = page.waitForRequest(/analysis\.css/);
      await page.unroute(/analysis\.css/, intercept);
      await page.route(
        /analysis\.css/,
        async (route) => {
          await new Promise((resolve) => {
            releaseStyle = resolve;
          });
          await route.continue();
        },
        { times: 1 },
      );
      await page.locator("#analysisToggle").click();
      await blocked;
      await page.locator("#agendaMode").click();
      releaseStyle();
      await page.evaluate(() =>
        WorkTimeApp.services.assets.style("assets/css/analysis.css"),
      );
      assert.equal(
        await page.locator("#analysisToggle").getAttribute("aria-pressed"),
        "false",
      );
      await page.locator("#analysisToggle").click();
      await page.locator("#analysisPage").waitFor({ state: "visible" });
      assert.equal(await page.locator(".analysis-lane").count(), 2);
      await page.reload();
      await ready();
      await page.locator("#analysisPage").waitFor({ state: "visible" });
      assert.equal(await page.locator('link[href*="analysis.css"]').count(), 1);
      await page.route(/analysis\.css/, (route) => route.abort(), { times: 1 });
      await page.reload();
      await ready();
      assert.equal(
        await page.locator("#analysisToggle").getAttribute("aria-pressed"),
        "false",
        "a missing stylesheet must leave the calendar usable on startup",
      );
      await page.locator("#analysisToggle").click();
      await page.locator("#analysisPage").waitFor({ state: "visible" });
      await page.locator("#analysisToggle").click();
      await page.locator("#analysisPage").waitFor({ state: "hidden" });
      await launchGame(page, "game-2048");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
      assert.equal(
        await page.locator('link[href*="game-session.css"]').count(),
        1,
      );
      assert.equal(
        await page.evaluate(() => {
          const links = [
            ...document.querySelectorAll('link[rel="stylesheet"]'),
          ];
          return links[0].href.includes("game-session.css");
        }),
        true,
        "session CSS must preserve the critical stylesheet's cascade priority",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width && rect.right > innerWidth + 1;
              })
              .slice(0, 12)
              .map((node) => ({
                className: node.className,
                id: node.id,
                rect: node.getBoundingClientRect().toJSON(),
              })),
          ),
        ),
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Deferred styles: absent from initial entry, failure/retry, restored analysis, game cascade and desktop/mobile layout passed: " +
        root,
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
