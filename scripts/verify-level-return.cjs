"use strict";
const { chromium } = require("playwright"),
  { launchGame } = require("./game-test-helpers.cjs"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const game of ["sudoku", "sokoban", "xiangqi", "gomoku", "tank"]) {
      const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: "reduce",
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (r) => r.abort());
      await page.addInitScript(() =>
        localStorage.setItem("worktime.onboarding.v1", "dismissed"),
      );
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await launchGame(page, "game-" + game);
      const root = page.locator(".game-" + game),
        back = root.locator(".game-level-return"),
        catalog = root.locator(".game-level-page"),
        action = (name) => root.locator(`[data-${game}-action="${name}"]`);
      if (game !== "tank") {
        assert.equal(
          await back.isVisible(),
          false,
          "no opened game means no back icon",
        );
        await root
          .locator(".game-level-entries .game-button:visible")
          .first()
          .click();
      }
      if (game === "sudoku") {
        const move = await page.evaluate(() => {
          const save = JSON.parse(
              localStorage.getItem("worktime.games.sudoku.v1"),
            ),
            p = WorkTimeApp.data.sudoku.groups
              .flatMap((g) => g.puzzles)
              .find((p) => p.id === save.current);
          const i = p.givens.indexOf("0");
          return { i, digit: p.solution[i] };
        });
        await action("cell-" + move.i).press(move.digit);
      }
      assert.equal(
        await root.locator(".game-level-page-summary").count(),
        0,
        "no level subtitle in any catalog",
      );
      const boardSelector = {
        sudoku: ".sudoku-digit",
        sokoban: ".sokoban-board",
        xiangqi: ".xiangqi-board",
        gomoku: ".gomoku-board",
        tank: ".tank-board",
      }[game];
      const boardBefore = await root.locator(boardSelector).allTextContents();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await action(game === "tank" ? "choose-stage" : "choose").click();
        assert.equal(await back.isVisible(), true);
        assert.equal(
          await back.locator("use").getAttribute("href"),
          "#ms-chevron-left",
        );
        assert.equal(await back.getAttribute("aria-label"), "返回游戏");
        const b = await back.boundingBox(),
          title = await root.locator(".game-level-page-title").boundingBox();
        assert.ok(b.x + b.width <= title.x, "back is left of title");
        assert.ok(
          Math.abs(b.y + b.height / 2 - title.y - title.height / 2) < 1,
          "icon and title share vertical center",
        );
        assert.ok(b.x >= 0 && title.x + title.width <= width + 1);
        fs.mkdirSync("test-results/level-return", { recursive: true });
        await page.screenshot({
          path: `test-results/level-return/${game}-${width}.png`,
        });
        await back.click();
        assert.equal(await catalog.isVisible(), false);
        assert.deepEqual(
          await root.locator(boardSelector).allTextContents(),
          boardBefore,
          "return keeps current board",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        game +
          ": conditional back icon, title alignment, desktop/mobile, same game and progress preserved",
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
