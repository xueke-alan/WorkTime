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
    await page.evaluate(() =>
      document.querySelector("#onboardingDialog")?.close(),
    );
    await page.locator("#date-tab-games").click();
    await launchGame(page, "game-sudoku");
    const ids = await page.evaluate(() =>
      WorkTimeApp.data.sudoku.groups.map((group) => group.id),
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
        const geometry = await page.evaluate(() => {
          const board = document.querySelector(".sudoku-board");
          const cells = [...board.querySelectorAll(".sudoku-cell")];
          const overlay = board.querySelector(".sudoku-variant-overlay");
          const matrix = overlay.getScreenCTM();
          const screen = (x, y) => new DOMPoint(x, y).matrixTransform(matrix);
          const center = (element) => {
            const r = element.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          };
          const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
          return {
            // All 81 cells must share the SVG coordinate system, including
            // box edges, irregular regions and the outer row/column.
            centers: cells.map((cell, i) =>
              distance(
                center(cell),
                screen((i % 9) * 10 + 5, Math.floor(i / 9) * 10 + 5),
              ),
            ),
            digits: cells
              .filter((cell) => cell.querySelector(".sudoku-digit").textContent)
              .map((cell) =>
                distance(
                  center(cell),
                  center(cell.querySelector(".sudoku-digit")),
                ),
              ),
            sums: [...overlay.querySelectorAll(".sudoku-cage-sum")].map(
              (label) => {
                const r = label.getBBox();
                const x = Math.floor(Number(label.getAttribute("x")) / 10) * 10;
                const y = Math.floor(Number(label.getAttribute("y")) / 10) * 10;
                // Include the text halo; it must clear both dashed edges.
                return r.x - 0.15 > x + 0.9 && r.y - 0.15 > y + 0.9;
              },
            ),
            arrows: [...board.querySelectorAll(".sudoku-arrow-circle")].map(
              (circle) => {
                const line = circle.previousElementSibling;
                const first = line.points.getItem(0);
                const radius = circle.r.baseVal.value;
                return (
                  radius <= 3 &&
                  Math.abs(
                    Math.hypot(
                      first.x - circle.cx.baseVal.value,
                      first.y - circle.cy.baseVal.value,
                    ) - radius,
                  ) < 0.001
                );
              },
            ),
          };
        });
        assert.ok(
          geometry.centers.every((offset) => offset < 0.04),
          `${id} ${width} SVG/cell centers`,
        );
        assert.ok(
          geometry.digits.every((offset) => offset < 0.04),
          `${id} ${width} numeral ink centers`,
        );
        assert.ok(
          geometry.sums.every(Boolean),
          `${id} ${width} sums clear dashed edges`,
        );
        assert.ok(
          geometry.arrows.every(Boolean),
          `${id} ${width} arrows start on smaller circle rim`,
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
            const grid = getComputedStyle(element, "::after");
            return {
              background: style.backgroundColor,
              right: grid.borderRight,
              bottom: grid.borderBottom,
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
      `${ids.length} categories: centered digits/SVG clues, inset cage sums and smaller arrow circles; hover, active, selection, peer, same-digit and conflict states preserve clues/grid offline at desktop/mobile widths.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
