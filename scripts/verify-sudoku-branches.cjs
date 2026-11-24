"use strict";
require("./lib/browser-test-setup.cjs");
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const assert = require("node:assert/strict");
const { launchGame } = require("./game-test-helpers.cjs");
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1600, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const show = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = function () {
          if (this.id !== "onboardingDialog") show.call(this);
        };
      });
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await launchGame(page, "game-sudoku");
      const a = (id) => page.locator(`[data-sudoku-action="${id}"]`);
      const draft = () =>
        page.evaluate(() => {
          const saved = JSON.parse(
            localStorage.getItem("worktime.games.sudoku.v1"),
          );
          return saved.drafts[saved.current];
        });
      await a("killer").click();
      await a("level-12").click();
      const edit = async (index, digit) => {
        await page.locator(`.sudoku-board [data-cell="${index}"]`).click();
        await a("digit-" + digit).click();
      };
      const select = async (id) => {
        const panel = page.locator(".sudoku-branches");
        if (!(await panel.evaluate((el) => el.open)))
          await panel.locator("summary").click();
        await a("branch-" + id).click();
      };
      await edit(0, 1);
      await edit(9, 7);
      await a("mark").click();
      let state = await draft();
      assert.equal(state.branches.length, 2);
      assert.equal(state.branches[0].values[0], 1);
      assert.equal(state.branches[0].values[9], 7);
      assert.deepEqual(state.branches[0].values, state.branches[1].values);
      await select(0);
      await edit(1, 2);
      state = await draft();
      assert.equal(state.activeBranch, 2);
      assert.equal(state.branches.length, 3);
      assert.equal(state.branches[0].values[1], 0);
      assert.equal(state.branches[2].values[1], 2);
      await a("undo").click();
      assert(await a("undo").isDisabled());
      state = await draft();
      assert.equal(state.values[1], 0);
      await select(0);
      await a("mark").click();
      await select(0);
      await a("mark").click();
      await select(0);
      await edit(2, 3);
      await page.locator(".sudoku-branch-limit-popover:popover-open").waitFor();
      state = await draft();
      assert.equal(state.branches.length, 5);
      assert.equal(state.values[2], 0);
      await page
        .locator(".sudoku-branch-limit-popover")
        .evaluate((el) => el.hidePopover());
      if (width === 390) {
        await a("pause").click();
        await a("pause").click();
      }
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      // Match the existing game fixture: persisted sidebar layout settles after ready.
      await page.waitForTimeout(400);
      await launchGame(page, "game-sudoku");
      assert.deepEqual((await draft()).branches, state.branches);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Sudoku branch UI: first snapshot, immediate sibling fork, undo boundary, four-child limit and reload passed at 1600/390px.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
