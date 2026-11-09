"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const games = [
  ["snake", "snake", ".snake-board"],
  ["link", "link", ".link-arena"],
  ["jump", "jump", ".jump-stage"],
  ["tank", "tank", ".tank-board"],
  ["sudoku", "sudoku", ".sudoku-stage"],
  ["garden", "garden", ".garden-arena"],
  ["sokoban", "sokoban", ".sokoban-stage"],
  ["2048", "puzzle", ".puzzle-board"],
  ["minesweeper", "mine", ".mine-board-frame"],
  ["gomoku", "gomoku", ".gomoku-stage"],
  ["xiangqi", "xiangqi", ".xiangqi-stage"],
];
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const output = path.resolve("test-results/game-restart");
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [game, prefix, host] of games) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const show = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = function () {
          if (this.id !== "onboardingDialog") show.call(this);
        };
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await launchGame(page, "game-" + game);
      const action = (name) =>
        page.locator(`[data-${prefix}-action="${name}"]`);
      if (game === "sudoku") await action("level-1").click();
      if (game === "sokoban") await action("level-1").click();
      if (game === "link") await action("quest").click();
      if (game === "gomoku") {
        await action("ai").click();
        await action("start-black").click();
      }
      if (game === "xiangqi") {
        await action("versus").click();
        await action("start-red").click();
      }
      // Start and pause moving games before sampling their saved position.
      if (["snake", "jump", "tank"].includes(game)) {
        await action("start").click();
        if (game === "snake")
          await page.waitForFunction(
            () => document.querySelector(".snake-cover").hidden,
          );
        await action("pause").click();
      }
      if (game === "sudoku") {
        const cell = page.locator(".sudoku-cell:not([disabled])").first();
        await cell.focus();
      }
      const cover = page.locator(".game-restart-cover:not([hidden])");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await action("restart").click();
        await cover.waitFor();
        const buttons = cover.locator(".game-restart-actions > button");
        assert.deepEqual(
          await buttons.allTextContents(),
          ["取消", "新游戏"],
          game,
        );
        const geometry = await cover.evaluate((element, selector) => {
          const parent = document
            .querySelector(selector)
            .getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const buttons = [
            ...element.querySelectorAll(".game-restart-actions > button"),
          ].map((b) => b.getBoundingClientRect());
          const icon = element
            .querySelector(".game-restart-icon")
            .getBoundingClientRect();
          return {
            contained:
              rect.left >= parent.left - 1 &&
              rect.right <= parent.right + 1 &&
              rect.top >= parent.top - 1 &&
              rect.bottom <= parent.bottom + 1,
            equal: Math.abs(buttons[0].width - buttons[1].width) < 1,
            row: Math.abs(buttons[0].top - buttons[1].top) < 1,
            icon: icon.width > 0 && icon.bottom <= buttons[0].top,
            centered:
              Math.abs(
                icon.left + icon.width / 2 - rect.left - rect.width / 2,
              ) < 2,
            blur: getComputedStyle(element).backdropFilter,
          };
        }, host);
        assert.ok(
          geometry.contained &&
            geometry.equal &&
            geometry.row &&
            geometry.icon &&
            geometry.centered,
          game + " " + width + " " + JSON.stringify(geometry),
        );
        assert.equal(geometry.blur, "none");
        await buttons.first().focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await buttons.last().evaluate((el) => el === document.activeElement),
          true,
        );
        await page.screenshot({
          path: path.join(output, `${game}-${width}.png`),
        });
        await page.keyboard.press("Escape");
        assert.equal(await cover.count(), 0, game + " Escape cancels");
      }
      await action("restart").click();
      await cover.locator(".game-restart-actions > button").last().click();
      assert.equal(await cover.count(), 0, game + " confirmation completes");
      // Restarting a puzzle in the board games must retain its original behavior.
      if (["gomoku", "xiangqi"].includes(game)) {
        await action("choose").click();
        const category = game === "gomoku" ? "easy" : "goal1";
        await action(category).click();
        const card = page.locator(`.${game}-levels:visible > button`).first();
        await card.click();
        await action("restart").click();
        assert.equal(await cover.count(), 0, game + " puzzles excluded");
      }
      assert.deepEqual(errors, [], game + " page errors");
      console.log(
        game +
          ": board-local confirmation, equal buttons, focus/Escape, confirm and 2 viewport sizes verified.",
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
