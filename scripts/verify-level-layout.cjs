"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
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
      for (const game of ["sudoku", "sokoban", "xiangqi", "tank", "garden"]) {
        await launchGame(page, "game-" + game);
        if (game === "tank")
          await page.locator('[data-tank-action="choose-stage"]').click();
        if (game === "garden")
          await page.locator('[data-garden-action="levels"]').click();
        const catalog = page.locator(".game-level-page:visible");
        await catalog.waitFor();
        const geometry = await catalog.evaluate((element) => {
          const categories = element.querySelector(".game-level-categories");
          const entries = element.querySelector(".game-level-entries");
          const left = categories.getBoundingClientRect();
          const right = entries.getBoundingClientRect();
          return {
            split:
              left.right <= right.left && Math.abs(left.top - right.top) < 1,
            fits: [element, categories, entries].every(
              (box) => box.scrollWidth <= box.clientWidth + 1,
            ),
          };
        });
        assert.ok(
          geometry.split && geometry.fits,
          game + " layout at " + width,
        );
        assert.ok(
          await catalog.evaluate((element) => {
            const cards = [
              ...element.querySelectorAll(".game-level-categories button"),
            ];
            const allBoxes = cards.map((card) => card.getBoundingClientRect());
            const difficultyCount = element.querySelectorAll(
              ".sudoku-difficulties button",
            ).length;
            const boxes = allBoxes.slice(difficultyCount);
            const difficultyRow =
              !difficultyCount ||
              (allBoxes
                .slice(0, 4)
                .every(
                  (box) =>
                    Math.abs(box.top - allBoxes[0].top) < 1 &&
                    box.height < boxes[0].height,
                ) &&
                allBoxes[3].right <=
                  element
                    .querySelector(".game-level-categories")
                    .getBoundingClientRect().right &&
                getComputedStyle(element.querySelector(".sudoku-difficulties"))
                  .borderBottomStyle === "solid");
            return (
              difficultyRow &&
              boxes[1].left > boxes[0].left &&
              Math.abs(boxes[1].top - boxes[0].top) < 1 &&
              boxes.every(
                (box) =>
                  Math.abs(box.width - boxes[0].width) < 1 &&
                  Math.abs(box.height - boxes[0].height) < 1,
              ) &&
              cards.every(
                (card) =>
                  card.scrollWidth <= card.clientWidth + 1 &&
                  card.scrollHeight <= card.clientHeight + 1,
              )
            );
          }),
          game + " equal category cards in two columns at " + width,
        );
        for (const reduced of [false, true]) {
          await page.emulateMedia({
            reducedMotion: reduced ? "reduce" : "no-preference",
          });
          const result = await catalog.evaluate((element) => {
            const buttons = [
              ...element.querySelectorAll(".game-level-categories button"),
            ];
            const target = buttons.find(
              (button) => button.getAttribute("aria-pressed") !== "true",
            );
            target.click();
            const entries = element.querySelector(".game-level-entries");
            return {
              selected: target.getAttribute("aria-pressed"),
              motion: entries.getAnimations().length,
              visible: [...entries.querySelectorAll(".game-level-card")].filter(
                (card) => card.getClientRects().length,
              ).length,
            };
          });
          assert.equal(result.selected, "true");
          assert.equal(result.motion > 0, !reduced, game + " motion");
          assert.ok(result.visible > 0, game + " visible levels");
        }
        await page.emulateMedia({ reducedMotion: "no-preference" });
        // Rapid category changes leave only the latest category and animation.
        assert.equal(
          await catalog.evaluate((element) => {
            const buttons = [
              ...element.querySelectorAll(".game-level-categories button"),
            ];
            buttons[0].click();
            buttons[1].click();
            buttons[0].click();
            return buttons.filter(
              (button) => button.getAttribute("aria-pressed") === "true",
            ).length;
          }),
          1,
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector(
                ".game-level-page:not([hidden]) .game-level-entries",
              )
              .getAnimations().length === 0,
        );
        if (game === "sudoku") {
          await page.screenshot({
            path: path.resolve("tmp/level-layout-" + width + ".png"),
          });
        }
        await page.locator("#gameExitButton").click();
        await page.waitForFunction(
          () => document.querySelector("#gameShell").dataset.state === "closed",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Five level catalogs: split layout, category contents, animation, rapid switching and reduced motion verified at desktop and mobile widths offline.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
