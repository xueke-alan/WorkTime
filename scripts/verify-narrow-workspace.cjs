"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const {
  runtimeServer,
  installRuntimeFixture,
  enableReaderRuntime,
} = require("./runtime-test-helpers.cjs");

async function verify() {
  const site = path.resolve(process.argv[2] || ".");
  const server = await runtimeServer(site);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(installRuntimeFixture);
    const page = await context.newPage();
    await enableReaderRuntime(page);
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const originalOverflow = await page.evaluate(
      () => document.documentElement.style.overflow,
    );
    async function check(shellId, contentSelector) {
      const shell = page.locator(shellId);
      await page.waitForFunction(
        (id) => document.querySelector(id)?.dataset.state === "open",
        shellId,
      );
      const content = await page.locator(contentSelector).elementHandle();
      for (const [width, height] of [
        [390, 844],
        [500, 550],
        [850, 700],
        [851, 700],
        [1150, 800],
        [1920, 1080],
        [500, 350],
        [851, 700],
        [500, 550],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(
          ({ id, width }) => {
            const rect = document.querySelector(id).getBoundingClientRect();
            return width <= 850
              ? Math.abs(rect.width - visualViewport.width) < 1
              : rect.width < innerWidth;
          },
          { id: shellId, width },
        );
        const geometry = await shell.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            radius: style.borderRadius,
            padding: style.padding,
            border: getComputedStyle(element.querySelector(".game-surface"))
              .borderTopWidth,
            viewport: {
              left: visualViewport.offsetLeft,
              top: visualViewport.offsetTop,
              width: visualViewport.width,
              height: visualViewport.height,
            },
          };
        });
        if (width <= 850) {
          for (const key of ["left", "top", "width", "height"])
            assert.ok(
              Math.abs(geometry[key] - geometry.viewport[key]) < 1,
              `${shellId} ${width}: ${key}`,
            );
          assert.equal(geometry.radius, "0px");
          assert.equal(geometry.padding, "0px");
          assert.equal(geometry.border, "0px");
          if (shellId === "#gameShell")
            assert.equal(
              await page
                .locator(".game-content")
                .evaluate((node) => getComputedStyle(node).padding),
              "8px",
            );
        } else assert.equal(geometry.radius, "16px");
        assert.ok(await content.evaluate((node) => node.isConnected));
        assert.equal(
          await shell.evaluate((node) => node.scrollWidth > node.clientWidth),
          false,
          `${shellId} ${width}: horizontal overflow`,
        );
      }
    }
    for (const game of ["game-ultimate-ttt", "game-2048", "game-snake"]) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await launchGame(page, game);
      let saved;
      if (game === "game-ultimate-ttt") {
        await page.locator('[data-uttt-action="mode-local"]').click();
        await page.locator('[data-uttt-action="start-local"]').click();
        await page.locator('.uttt-cell[data-cell="4"]').click();
        saved = await page.evaluate(() =>
          localStorage.getItem("worktime.games.ultimate-ttt.v1"),
        );
      }
      await check("#gameShell", "#gameShell .game-content > :first-child");
      if (saved) {
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem("worktime.games.ultimate-ttt.v1"),
          ),
          saved,
        );
        const board = await page.locator(".uttt-board").boundingBox();
        assert.ok(board.x >= 0 && board.x + board.width <= 500);
        await page.locator('.uttt-cell[data-cell="36"]').click();
        assert.notEqual(
          await page.evaluate(() =>
            localStorage.getItem("worktime.games.ultimate-ttt.v1"),
          ),
          saved,
        );
        const output = path.resolve("test-results/narrow-workspace");
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({
          path: path.join(output, "ultimate-ttt-500.png"),
        });
      }
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
    }
    for (const name of ["music", "reader"]) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.locator(`#${name}Open`).click();
      await check(`#${name}Dialog`, `.${name}-main`);
      await page.evaluate((name) => WorkTimeApp.ui[name].close(), name);
      await page.locator(`#${name}Dialog`).waitFor({ state: "hidden" });
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.style.overflow),
      originalOverflow,
    );
    console.log(
      "Narrow games, music and reader: edge-to-edge geometry, breakpoint round trips, session DOM preservation and scroll restoration passed.",
    );
  } finally {
    await browser.close();
    await server.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
