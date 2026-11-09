"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const baseline = process.argv.includes("--baseline");
const entry = path.resolve(process.argv[2] || root, "index.html");
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForFunction(() => {
      if (document.querySelector("#gamesPanel").hidden)
        document.querySelector("#date-tab-games").click();
      if (document.querySelector("#gamesPanel").hidden) return false;
      // Launch in the same task so unrelated startup notices cannot steal the
      // sidebar between selecting the game and pressing Play.
      document.querySelector('#gamesPanel [data-game="game-sokoban"]').click();
      document.querySelector("#gamesPanel .game-menu-play").click();
      return true;
    });
    await page.locator(".sokoban-catalog").waitFor({ state: "visible" });
    const action = (name) =>
      page.locator('[data-sokoban-action="' + name + '"]');
    const board = page.locator(".sokoban-board");
    const reports = [];
    for (let chapter = 0; chapter < 3; chapter++) {
      if (chapter) await action("choose").click();
      await action("chapter-" + chapter).click();
      await action("level-19").click();
      const report = await board.evaluate((board, chapter) => {
        const level = WorkTimeApp.data.sokoban.levels[chapter * 20 + 19];
        const firstCell = board.firstElementChild;
        const pieces = [...board.querySelectorAll("[data-piece]")];
        const observer = new MutationObserver(() => {});
        observer.observe(board, { childList: true, subtree: true });
        observer.observe(document.querySelector(".sokoban-catalog"), {
          childList: true,
          subtree: true,
        });
        const durations = [];
        const directions = {
          r: "ArrowRight",
          l: "ArrowLeft",
          u: "ArrowUp",
          d: "ArrowDown",
        };
        const moves = level.solution.slice(0, 40);
        for (const direction of moves) {
          const start = performance.now();
          board.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: directions[direction],
              bubbles: true,
            }),
          );
          // Include the layout work needed to present this move, not just dispatch.
          board.getBoundingClientRect();
          durations.push(performance.now() - start);
        }
        const added = observer
          .takeRecords()
          .reduce((sum, record) => sum + record.addedNodes.length, 0);
        observer.disconnect();
        durations.sort((a, b) => a - b);
        const save = JSON.parse(
          localStorage.getItem("worktime.games.sokoban.v1"),
        );
        return {
          chapter,
          moves: moves.length,
          added,
          stable:
            firstCell === board.firstElementChild &&
            pieces.every((piece) => piece.isConnected),
          medianMs: durations[Math.floor(durations.length / 2)],
          p95Ms: durations[Math.floor(durations.length * 0.95)],
          correct: save.drafts[level.id].path === moves,
        };
      }, chapter);
      assert.ok(report.correct, "moves and saves match verified solution");
      if (!baseline) {
        assert.ok(report.stable, "floor and pieces survive movement");
        assert.equal(
          report.added,
          0,
          "moves do not rebuild board SVGs or hidden catalog",
        );
      }
      reports.push(report);
      if (!baseline) {
        fs.mkdirSync(path.join(root, "test-results/sokoban"), {
          recursive: true,
        });
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.locator(".sokoban-stage").screenshot({
            path: path.join(
              root,
              "test-results/sokoban/motion-" + chapter + "-" + width + ".png",
            ),
          });
        }
      }
    }
    await action("choose").click();
    await action("chapter-0").click();
    await action("level-0").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const push = await board.evaluate((board) => {
      board.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      const tracks = board.getAnimations({ subtree: true });
      tracks.forEach((track) => {
        track.pause();
        track.currentTime = 60;
      });
      return tracks.map((track) => ({
        id: track.effect.target.dataset.piece,
        frames: track.effect.getKeyframes().map((frame) => frame.transform),
        x: new DOMMatrixReadOnly(
          getComputedStyle(track.effect.target).transform,
        ).m41,
      }));
    });
    assert.equal(push.length, 2, "player and pushed crate animate together");
    assert.deepEqual(push[0].frames, push[1].frames);
    assert.ok(
      push.every((track) => track.x < -1),
      "midpoint does not jump to destination",
    );
    // Queue undo while the push is paused; both logical and visual state settle.
    await board.evaluate((board) => {
      board.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      board.getAnimations({ subtree: true }).forEach((track) => track.finish());
    });
    await page.waitForFunction(() => {
      const saved = JSON.parse(
        localStorage.getItem("worktime.games.sokoban.v1"),
      );
      return (
        saved.drafts[WorkTimeApp.data.sokoban.levels[0].id].path === "" &&
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length
      );
    });
    await board.press("ArrowRight");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length,
    );
    await action("undo").click();
    await action("restart").click();
    await action("reset").click();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const rect = await board.boundingBox();
      assert.ok(rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= width);
      await board.press("ArrowRight");
      assert.equal(await action("next").isEnabled(), true);
      await action("undo").click();
    }
    await board.press("ArrowRight");
    await action("next").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const burst = await page.evaluate(() =>
      WorkTimeApp.data.sokoban.levels[1].solution.slice(0, 8),
    );
    await board.evaluate((board, burst) => {
      const keys = {
        r: "ArrowRight",
        l: "ArrowLeft",
        u: "ArrowUp",
        d: "ArrowDown",
      };
      for (const direction of burst)
        board.dispatchEvent(
          new KeyboardEvent("keydown", { key: keys[direction], bubbles: true }),
        );
    }, burst);
    await page.waitForFunction((burst) => {
      const save = JSON.parse(
        localStorage.getItem("worktime.games.sokoban.v1"),
      );
      return (
        save.drafts[WorkTimeApp.data.sokoban.levels[1].id].path === burst &&
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length
      );
    }, burst);
    await board.press("z");
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length,
    );
    await action("restart").click();
    await action("reset").click();
    await board.evaluate((board) => {
      board.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      for (let i = 0; i < 8; i++)
        board.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            repeat: true,
            bubbles: true,
          }),
        );
    });
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length,
    );
    const heldPath = await page.evaluate(() => {
      const save = JSON.parse(
        localStorage.getItem("worktime.games.sokoban.v1"),
      );
      return save.drafts[WorkTimeApp.data.sokoban.levels[1].id].path;
    });
    if (!baseline)
      assert.equal(
        heldPath,
        "rd",
        "held keys do not accumulate a long input tail",
      );
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, "test-results/sokoban"), { recursive: true });
    fs.writeFileSync(
      path.join(
        root,
        "test-results/sokoban/motion-" +
          (baseline ? "baseline" : "optimized") +
          ".json",
      ),
      JSON.stringify(reports, null, 2),
    );
    console.log(JSON.stringify(reports));
    console.log(
      "Sokoban motion: push synchronization, queued undo, reduced motion, restart, saved moves and responsive layout verified.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
