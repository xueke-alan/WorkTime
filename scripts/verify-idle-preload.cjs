"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const server = await runtimeServer(root);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of [
      server.url,
      pathToFileURL(path.join(root, "index.html")).href,
    ]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem(
          "worktime.vocabulary.audio-settings",
          JSON.stringify({ enabled: false }),
        );
        document.addEventListener(
          "worktime:ready",
          () => {
            const input = document.createElement("textarea");
            input.id = "idle-preload-input";
            document.body.append(input);
            const type = () =>
              input.dispatchEvent(new InputEvent("input", { bubbles: true }));
            type();
            window.preloadTyping = setInterval(type, 100);
          },
          { once: true },
        );
      });
      // Exercise the resource queue without downloading large engine binaries.
      await page.route(
        /\/assets\/vendor\/(pikafish|utttai|rapfi|misty-jungle)\/(?!manifest\.js)/,
        (route) => route.abort(),
      );
      await page.goto(url);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      const initialPreloads = await page.locator('link[rel="preload"]').count();
      await page.waitForTimeout(2400);
      assert.equal(
        await page.locator('link[rel="preload"]').count(),
        initialPreloads,
        "Typing postpones startup warming even when audio caching is disabled",
      );
      await page.evaluate(() => clearInterval(window.preloadTyping));
      console.log("Checking resource queue: " + url);
      await page.waitForFunction(
        () => {
          const status = WorkTimeApp.services.gamePrefetch?.status;
          return (
            status &&
            Object.entries(status)
              .filter(
                ([id]) =>
                  id === "shared" ||
                  id.startsWith("game-") ||
                  id.startsWith("app-") ||
                  id === "typing-lessons",
              )
              .every(([, state]) => state === "complete")
          );
        },
        null,
        { timeout: 90000 },
      );
      assert.equal(
        await page
          .locator(
            "#musicDialog:not([hidden]), #typingDialog:not([hidden]), #gameShell:not([hidden])",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => WorkTimeApp.games.get("game-snake").lazy),
        true,
        "Warming must not execute game modules",
      );
      console.log("Checking shared idle rules: " + url);
      const idleRules = await page.evaluate(async () => {
        const idle = WorkTimeApp.services.vocabularyIdle;
        const input = document.getElementById("idle-preload-input");
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let ready = false;
        input.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
        const waiting = idle.whenIdle().then(() => {
          ready = true;
        });
        await delay(2100);
        const compositionBlocked = !ready;
        input.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
        await delay(500);
        const cooldownBlocked = !ready;
        await waiting;
        const shell = document.createElement("div");
        shell.id = "gameShell";
        document.body.append(shell);
        await delay(0);
        await idle.whenIdle();
        const ordinaryGameAllowed = true;
        const finishModel = idle.beginModelTask();
        let gameReady = false;
        const gameWaiting = idle.whenIdle().then(() => {
          gameReady = true;
        });
        await delay(2100);
        const gameBlocked = !gameReady;
        finishModel();
        shell.remove();
        await gameWaiting;
        const started = performance.now();
        window.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 50, clientY: 50 }),
        );
        window.dispatchEvent(new Event("scroll"));
        document.body.click();
        await idle.whenIdle();
        return {
          compositionBlocked,
          cooldownBlocked,
          gameBlocked,
          ordinaryGameAllowed,
          ordinaryInputAllowed: performance.now() - started < 500,
        };
      });
      for (const [rule, result] of Object.entries(idleRules))
        assert.equal(result, true, rule);
      console.log("Checking foreground and media: " + url);
      await page.evaluate(async () => {
        await WorkTimeApp.games.load("game-snake");
        await WorkTimeApp.ui.music.open({ mini: true });
      });
      assert.equal(
        await page.evaluate(() => !!WorkTimeApp.games.get("game-snake").create),
        true,
      );
      assert.equal(await page.locator("#musicPanel").isVisible(), true);
      const mediaIdle = await page.evaluate(async () => {
        const idle = WorkTimeApp.services.vocabularyIdle;
        await WorkTimeApp.ui.music.expand();
        await new Promise((resolve) => setTimeout(resolve, 0));
        let started = performance.now();
        await idle.whenIdle();
        const music = performance.now() - started < 500;
        WorkTimeApp.ui.music.close();
        await WorkTimeApp.services.assets.script(
          "assets/js/ui/reader-runtime.min.js",
        );
        await WorkTimeApp.ui.reader.expand();
        await new Promise((resolve) => setTimeout(resolve, 0));
        started = performance.now();
        await idle.whenIdle();
        return { music, reader: performance.now() - started < 500 };
      });
      assert.deepEqual(
        mediaIdle,
        { music: true, reader: true },
        "Full music and reader workspaces do not suspend idle work",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Idle preload passed over HTTP and file: delayed startup, audio-independent warming, shared input/game rules, all game/app resources and foreground opening.",
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
