"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const scope = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/uno-rules.js"), "utf8"),
  scope,
);
const R = scope.WorkTimeApp.games.unoRules;
const card = (color, value) =>
  R.cards.find((c) => c.color === color && c.value === value).id;
const key = "worktime.games.uno.v1";
function fixture(last, total = 0) {
  const s = R.create(2, "normal", 12345);
  Object.assign(s, {
    hands: [[last], [card("blue", 2)]],
    discard: [card("red", 5)],
    color: "red",
    turn: 0,
    direction: 1,
    openingColor: false,
    log: [],
    scores: [total, 0],
  });
  s.deck = R.cards
    .map((c) => c.id)
    .filter((id) => ![...s.hands.flat(), ...s.discard].includes(id));
  assert.ok(R.restore(s));
  return s;
}
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "no-preference",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state, key);
    const idle = () =>
      page.waitForFunction(
        () => !document.querySelector(".game-uno[data-visual-busy]"),
      );
    const exit = async () => {
      if (await page.locator("#gameShell").isVisible()) {
        await page.locator("#gameExitButton").click();
        await page.locator("#gameShell").waitFor({ state: "hidden" });
      }
    };
    const reopen = async (s) => {
      await exit();
      await page.evaluate(
        ({ key, state }) =>
          localStorage.setItem(key, JSON.stringify({ version: 1, state })),
        { key, state: JSON.parse(JSON.stringify(s)) },
      );
      await launchGame(page, "game-uno");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
    };
    for (const value of [12, 13]) {
      let seed = 1;
      for (; ; seed++) {
        const s = R.create(2, "normal", seed);
        if (R.cards[s.discard[0]].value === value && s.dealer === 1) break;
      }
      await exit();
      await page.evaluate(
        ({ key, seed }) => {
          localStorage.removeItem(key);
          window.unoOriginalRandom ??= crypto.getRandomValues.bind(crypto);
          crypto.getRandomValues = (array) => {
            array[0] = seed;
            return array;
          };
          document.documentElement.dataset.reducedMotion = "false";
        },
        { key, seed },
      );
      await launchGame(page, "game-uno");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
      await page.locator("#uno-playersTrigger").click();
      await page.locator('#uno-playersOptions [data-game-option="2"]').click();
      await page.locator('[data-uno-action="start"]').click();
      assert.equal(
        await page.locator(".uno-table").getAttribute("data-color"),
        "none",
      );
      assert.ok(
        await page
          .locator(".uno-direction,.uno-player-pointer")
          .evaluateAll((els) =>
            els.every(
              (el) => getComputedStyle(el).color === "rgb(137, 147, 152)",
            ),
          ),
        "opening arrows stay gray until a color is revealed",
      );
      await idle();
      assert.equal((await read()).actions, 0);
      assert.equal(await page.locator("[data-uno-hidden]").count(), 0);
      if (value === 12) {
        assert.equal(
          await page.locator(".uno-table").getAttribute("data-color"),
          (await read()).color,
        );
        assert.equal((await read()).hands[0].length, 9);
        assert.equal(await page.locator(".uno-hand button").count(), 9);
        assert.ok(
          await page
            .locator(".uno-hand button")
            .evaluateAll((els) =>
              els.every((el) => getComputedStyle(el).visibility === "visible"),
            ),
        );
      } else {
        assert.equal(await page.locator("[data-uno-opening-color]").count(), 4);
        await reopen(await read());
        assert.equal(
          await page.locator(".uno-table").getAttribute("data-color"),
          "none",
          "an opening wild remains gray until a color is chosen",
        );
        for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
          await page.evaluate((l) => WorkTimeApp.i18n.setLanguage(l), language);
          assert.ok(
            !(await page.locator(".game-uno").innerText()).includes(
              "games.uno.",
            ),
          );
        }
        await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
        await page.locator('[data-uno-opening-color="green"]').click();
        assert.equal(
          await page.locator(".uno-table").getAttribute("data-color"),
          "green",
        );
        assert.equal((await read()).color, "green");
        assert.equal((await read()).turn, 0);
        assert.equal((await read()).hands[0].length, 7);
      }
    }
    await page.evaluate(() => {
      crypto.getRandomValues = window.unoOriginalRandom;
    });
    for (const value of [12, 14]) {
      const last = card(value === 14 ? "wild" : "red", value);
      await reopen(fixture(last));
      await page.locator(`.uno-hand [data-card="${last}"]`).click();
      if (value === 14) await page.locator('[data-uno-color="red"]').click();
      assert.equal(
        await page.locator(".uno-hand-actions:not([hidden])").count(),
        0,
        "results wait for penalty animation",
      );
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".uno-flight.uno-back").length === count,
        value === 12 ? 2 : 4,
      );
      assert.equal(
        await page.locator(".uno-hand-actions:not([hidden])").count(),
        0,
      );
      await idle();
      await page.locator('[data-uno-action="nextRound"]').waitFor();
      const ended = await read();
      assert.equal(
        await page
          .locator(
            ".uno-sidebar .uno-result,.uno-sidebar .uno-final-hands,.uno-sidebar .uno-scores",
          )
          .count(),
        0,
        "round scoring does not add sidebar details",
      );
      assert.equal(ended.hands[1].length, value === 12 ? 3 : 5);
      assert.equal(ended.scores[0], R.points(ended.hands[1]));
      await reopen(ended);
      await page.locator('[data-uno-action="restart"]').click();
      await page.locator(".uno-confirm").waitFor();
      await page.locator('.uno-confirm [data-uno-action="cancel"]').click();
      const names = await page
        .locator(".uno-seat .uno-seat-labels strong")
        .allTextContents();
      await page.locator('[data-uno-action="nextRound"]').click();
      await page.waitForFunction(
        (round) =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
            .round ===
          round + 1,
        ended.round,
      );
      const next = await read();
      assert.equal(next.round, 2);
      assert.equal(next.dealer, (ended.dealer + 1) % 2);
      assert.deepEqual(next.scores, ended.scores);
      assert.deepEqual(
        await page
          .locator(".uno-seat .uno-seat-labels strong")
          .allTextContents(),
        names,
      );
    }
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    for (const total of [499, 500, 501]) {
      await reopen(fixture(card("red", 1), total - 2));
      await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
      await page.locator(".uno-hand-actions:not([hidden])").waitFor();
      assert.equal((await read()).scores[0], total);
      assert.equal((await read()).matchWinner, total >= 500 ? 0 : null);
      assert.equal(
        await page.locator('[data-uno-action="newMatch"]').count(),
        total >= 500 ? 1 : 0,
      );
    }
    await page.locator('[data-uno-action="newMatch"]').click();
    assert.deepEqual((await read()).scores, [0, 0]);
    assert.equal((await read()).round, 1);
    assert.deepEqual(errors, []);
    console.log(
      "UNO official openings, final penalties, manual rounds, 500-point wins and recovery verified.",
    );
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
