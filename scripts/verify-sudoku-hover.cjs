"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-games").click();
    await launchGame(page, "game-sudoku");
    const ids = await page.evaluate(() =>
      WorkTimeApp.data.sudoku.groups.slice(4).map((group) => group.id),
    );
    const action = (id) => page.locator(`[data-sudoku-action="${id}"]`);
    for (const id of ids) {
      await action(id).click();
      await action("level-1").click();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(
          (wide) =>
            document.querySelector(".game-sudoku").dataset.layout ===
            (wide ? "wide" : "compact"),
          width > 1000,
        );
        const index = await page.evaluate((id) => {
          const puzzle = WorkTimeApp.data.sudoku.groups.find(
            (group) => group.id === id,
          ).puzzles[0];
          return (
            puzzle.arrows?.[0].circle ??
            puzzle.thermos?.[0][0] ??
            puzzle.whispers?.[0][0] ??
            puzzle.renbans?.[0][0] ??
            puzzle.cages?.[0].cells[0] ??
            puzzle.kropki?.[0].cells[0] ??
            0
          );
        }, id);
        const cell = action("cell-" + index);
        await cell.focus();
        const paint = () =>
          cell.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              background: style.backgroundColor,
              right: style.borderRight,
              bottom: style.borderBottom,
            };
          });
        for (const state of [
          "",
          "is-peer",
          "is-same",
          "is-selected",
          "is-conflict",
        ]) {
          await page.mouse.move(0, 0);
          await cell.evaluate((element, state) => {
            element.classList.remove(
              "is-peer",
              "is-same",
              "is-selected",
              "is-conflict",
            );
            if (state) element.classList.add(state);
          }, state);
          const normal = await paint();
          await cell.hover();
          assert.deepEqual(
            await paint(),
            normal,
            `${id} ${width} ${state} hover must preserve clue background and grid`,
          );
          await page.mouse.down();
          assert.deepEqual(
            await paint(),
            normal,
            `${id} ${width} ${state} active`,
          );
          // A fully opaque cell hides the shared SVG clue layer behind it.
          assert.ok(
            await cell.evaluate((element) => {
              const context = document.createElement("canvas").getContext("2d");
              context.fillStyle = getComputedStyle(element).backgroundColor;
              context.fillRect(0, 0, 1, 1);
              return context.getImageData(0, 0, 1, 1).data[3] < 255;
            }),
            `${id} ${state} clue layer remains visible`,
          );
          await page.mouse.up();
        }
      }
      await page.locator(".sudoku-options > summary").click();
      await action("choose").click();
    }
    assert.deepEqual(errors, []);
    console.log(
      `${ids.length} variants: hover, active, selection, peer, same-digit and conflict backgrounds preserve clues and grid lines at desktop/mobile widths offline.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
