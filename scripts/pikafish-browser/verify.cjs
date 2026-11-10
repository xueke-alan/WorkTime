"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
require("../lib/browser-test-setup.cjs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("../game-test-helpers.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../.."));

async function main() {
  const server = http.createServer((request, response) => {
    const file = path.resolve(
      root,
      "." +
        decodeURIComponent(new URL(request.url, "http://localhost").pathname),
    );
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
      if (error) return response.writeHead(404).end();
      const type = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
      }[path.extname(file)];
      response.setHeader("Content-Type", type || "application/octet-stream");
      response.end(bytes);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const entry of [
      pathToFileURL(path.join(root, "index.html")).href,
      `http://127.0.0.1:${server.address().port}/index.html`,
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await context.addInitScript(() => {
        window.engineWorkerCount = 0;
        window.Worker = class extends Worker {
          constructor(...args) {
            super(...args);
            if (
              String(args[0]).includes("/pikafish/") ||
              new Error().stack.includes("xiangqi-engine.js")
            )
              window.engineWorkerCount++;
          }
        };
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(entry);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await launchGame(page, "game-xiangqi");
      await page.locator('[data-xiangqi-action="versus"]').click();
      for (const difficulty of ["normal", "hard", "master"]) {
        await page
          .locator(`[data-xiangqi-action="difficulty-${difficulty}"]`)
          .click();
        await page.locator('[data-xiangqi-action="start-red"]').click();
        await page.locator('[data-square="54"]').click();
        await page.locator('[data-square="45"]').click();
        await page.waitForFunction(
          () => document.querySelector(".game-xiangqi").dataset.plies === "2",
          null,
          { timeout: 120000 },
        );
        assert.equal(
          await page.locator(".game-xiangqi").getAttribute("data-thinking"),
          "false",
        );
        if (difficulty === "master" && entry.startsWith("file:")) {
          await page.screenshot({
            path: path.resolve(__dirname, "../../.cache/pikafish-preview.png"),
          });
        }
        await page.locator('[data-xiangqi-action="undo"]').click();
        assert.equal(
          await page.locator(".game-xiangqi").getAttribute("data-plies"),
          "0",
        );
        await page.locator('[data-xiangqi-action="restart"]').click();
        await page.locator('[data-game-restart="new"]').click();
        await page.screenshot({
          path: path.resolve(__dirname, "../../.cache/xiangqi-ui.png"),
        });
        await page.locator('[data-xiangqi-action="choose"]').click();
        console.log(
          entry.split(":")[0],
          difficulty,
          "legal reply / undo / restart passed",
        );
      }
      assert.equal(
        await page.evaluate(() => window.engineWorkerCount),
        1,
        "prewarming, difficulty changes, undo and idle restarts reuse one Worker",
      );
      // A pending answer must never land on a new board after restart.
      await page.screenshot({
        path: path.resolve(__dirname, "../../.cache/pikafish-setup.png"),
      });
      await page.locator('[data-xiangqi-action="difficulty-master"]').click();
      await page.locator('[data-xiangqi-action="start-red"]').click();
      await page.locator('[data-square="54"]').click();
      await page.locator('[data-square="45"]').click();
      await page.locator('[data-xiangqi-action="restart"]').click();
      await page.locator('[data-game-restart="new"]').click();
      await page.waitForTimeout(3500);
      assert.equal(
        await page.locator(".game-xiangqi").getAttribute("data-plies"),
        "0",
      );
      assert.equal(
        await page.locator(".game-xiangqi").getAttribute("data-thinking"),
        "false",
      );
      await page.locator('[data-square="54"]').click();
      await page.locator('[data-square="45"]').click();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(3500);
      assert.equal(
        await page.locator(".game-xiangqi").getAttribute("data-plies"),
        "1",
      );
      assert.equal(
        await page.locator(".game-xiangqi").getAttribute("data-thinking"),
        "false",
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(
        () => document.querySelector(".game-xiangqi").dataset.plies === "2",
        null,
        { timeout: 120000 },
      );
      console.log(
        entry.split(":")[0],
        "restart cancellation / background pause / resume passed",
      );
      await page.locator('[data-xiangqi-action="choose"]').click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.resolve(__dirname, "../../.cache/pikafish-setup-mobile.png"),
      });
      assert(
        await page
          .locator(".xiangqi-versus-setup")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
      await page.locator('[data-xiangqi-action="difficulty-normal"]').click();
      await page.locator('[data-xiangqi-action="start-black"]').click();
      await page.waitForFunction(
        () => document.querySelector(".game-xiangqi").dataset.plies === "1",
        null,
        { timeout: 120000 },
      );
      assert(await page.locator('[data-xiangqi-action="undo"]').isDisabled());
      await page.locator('[data-square="27"]').click();
      await page.locator('[data-square="36"]').click();
      await page.waitForFunction(
        () => document.querySelector(".game-xiangqi").dataset.plies === "3",
        null,
        { timeout: 120000 },
      );
      await page.locator('[data-xiangqi-action="undo"]').click();
      assert.equal(
        await page.locator(".game-xiangqi").getAttribute("data-plies"),
        "1",
      );
      console.log(
        entry.split(":")[0],
        "play as Black / computer opening / round undo passed",
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
