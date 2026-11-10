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
      return true;
    });
    await page.waitForFunction(() => {
      const shell = document.querySelector("#gameShell");
      if (
        shell.dataset.state === "open" &&
        document.querySelector(".game-sokoban")
      )
        return true;
      if (shell.dataset.state !== "closed") return false;
      document.querySelector("#date-tab-games").click();
      document.querySelector('#gamesPanel [data-game="game-sokoban"]').click();
      document.querySelector("#gamesPanel .game-menu-play").click();
      return false;
    });
    await page.locator(".sokoban-catalog").waitFor({ state: "visible" });
    const action = (name) =>
      page.locator('[data-sokoban-action="' + name + '"]');
    const board = page.locator(".sokoban-board");
    const reports = [];
    for (let chapter = 0; chapter < 7; chapter++) {
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
          board.dispatchEvent(
            new KeyboardEvent("keyup", {
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
      board.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
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
    // A queued undo overrides rapid directions and survives subsequent taps.
    await board.evaluate((board) => {
      for (const key of [
        "ArrowDown",
        "ArrowLeft",
        "z",
        "ArrowRight",
        "ArrowUp",
      ]) {
        board.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
        board.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      }
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
      for (const [index, direction] of [...burst].entries()) {
        board.dispatchEvent(
          new KeyboardEvent("keydown", { key: keys[direction], bubbles: true }),
        );
        board.dispatchEvent(
          new KeyboardEvent("keyup", { key: keys[direction], bubbles: true }),
        );
        if (!index) {
          board.getAnimations({ subtree: true }).forEach((track) => {
            track.pause();
            track.currentTime = 60;
          });
        }
      }
      const tracks = board.getAnimations({ subtree: true });
      if (tracks.length !== 1 || tracks[0].currentTime !== 60)
        throw Error("rapid taps must preserve the active animation");
      tracks.forEach((track) => track.finish());
    }, burst);
    const throttledPath = burst[0] + burst.at(-1);
    await page.waitForFunction((throttledPath) => {
      const save = JSON.parse(
        localStorage.getItem("worktime.games.sokoban.v1"),
      );
      return (
        save.drafts[WorkTimeApp.data.sokoban.levels[1].id].path ===
          throttledPath &&
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length
      );
    }, throttledPath);
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.sokoban.v1")).drafts[
            WorkTimeApp.data.sokoban.levels[1].id
          ].path,
      ),
      throttledPath,
      "rapid taps retain only one latest direction without a delayed input tail",
    );
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
    await board.press("ArrowRight");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length,
    );
    const heldStart = Date.now();
    await page.keyboard.down("ArrowDown");
    // No OS repeat events: the game must supply its own second step.
    await page.waitForFunction(
      () => {
        const saved = JSON.parse(
          localStorage.getItem("worktime.games.sokoban.v1"),
        );
        return (
          saved.drafts[WorkTimeApp.data.sokoban.levels[1].id].path.length >= 3
        );
      },
      null,
      { timeout: 1000 },
    );
    assert.ok(
      Date.now() - heldStart < 500,
      "held movement starts without the OS repeat delay",
    );
    await page.keyboard.up("ArrowDown");
    const releasedPath = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.sokoban.v1")).drafts[
          WorkTimeApp.data.sokoban.levels[1].id
        ].path,
    );
    await page.waitForTimeout(400);
    const heldPath = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.sokoban.v1")).drafts[
          WorkTimeApp.data.sokoban.levels[1].id
        ].path,
    );
    assert.equal(
      heldPath,
      releasedPath,
      "release removes repeat input queued behind animation",
    );
    await page.keyboard.down("ArrowUp");
    await board.evaluate(() => window.dispatchEvent(new Event("blur")));
    const blurredPath = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.sokoban.v1")).drafts[
          WorkTimeApp.data.sokoban.levels[1].id
        ].path,
    );
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowUp");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.sokoban.v1")).drafts[
            WorkTimeApp.data.sokoban.levels[1].id
          ].path,
      ),
      blurredPath,
      "blur stops held movement",
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
