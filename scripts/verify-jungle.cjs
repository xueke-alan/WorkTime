"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : root,
);
const plain = (v) => JSON.parse(JSON.stringify(v));
const sandbox = vm.createContext({
  WorkTimeApp: { games: {}, services: {}, data: {} },
  window: { navigator: {} },
});
for (const file of [
  "assets/js/games/jungle-rules.js",
  "assets/js/services/game-archive.js",
])
  vm.runInContext(fs.readFileSync(path.join(site, file), "utf8"), sandbox);
const R = sandbox.WorkTimeApp.games.jungleRules;
const A = sandbox.WorkTimeApp.services.gameArchive;
function position(pieces, turn = 1) {
  const state = R.create();
  state.board.fill(0);
  for (const [p, piece] of Object.entries(pieces)) state.board[p] = piece;
  state.turn = turn;
  state.positions = [state.board.join(",") + ":" + turn];
  return state;
}
const can = (state, from, to) =>
  R.legal(state.board, state.turn).some(([a, b]) => a === from && b === to);
function unit() {
  const initial = R.create();
  assert.equal(initial.board.filter(Boolean).length, 16);
  assert.equal(initial.board[42], 1);
  assert.equal(initial.board[48], 8);
  assert.equal(R.legal(initial.board, 1).length, 24);
  assert.equal(R.legal(initial.board, -1).length, 24);
  assert(!can(initial, 42, 34), "no diagonal");
  assert(!can(position({ 58: 1, 0: -1 }), 58, 59), "own den forbidden");
  assert(
    can(position({ 28: 1, 29: -8 }), 28, 29) === false,
    "cannot capture across water boundary",
  );
  assert(
    can(position({ 14: 1, 15: -8 }), 14, 15),
    "rat captures elephant on land",
  );
  assert(
    !can(position({ 14: 8, 15: -1 }), 14, 15),
    "elephant cannot capture rat",
  );
  assert(can(position({ 14: 5, 15: -5 }), 14, 15), "equal ranks capture");
  assert(
    !can(position({ 14: 2, 15: -3 }), 14, 15),
    "weaker cannot capture stronger",
  );
  assert(!can(position({ 14: 8, 15: 1 }), 14, 15), "friendly pieces block");
  for (let animal = 1; animal <= 8; animal++) {
    const state = position({ 15: animal, 0: -1 });
    assert.equal(can(state, 15, 22), animal === 1);
    if ([6, 7].includes(animal)) assert(can(state, 15, 43), "vertical jump");
    if (animal !== 1)
      assert(
        !R.legal(state.board, 1).some(([, to]) => R.water(to)),
        "only rat lands in water",
      );
  }
  assert(
    can(position({ 22: 1, 23: -1 }), 22, 23),
    "water rats capture each other",
  );
  assert(
    !can(position({ 22: 1, 21: -1 }), 22, 21),
    "water rat cannot capture onto land",
  );
  assert(
    can(position({ 22: 1, 0: -1 }), 22, 21),
    "rat can leave water to empty land",
  );
  for (const animal of [6, 7]) {
    assert(can(position({ 21: animal, 0: -1 }), 21, 24), "horizontal jump");
    for (const blocker of [1, -1]) {
      assert(
        !can(position({ 21: animal, 22: blocker, 0: -1 }), 21, 24),
        "either rat blocks jump",
      );
      assert(
        !can(position({ 15: animal, 29: blocker, 0: -1 }), 15, 43),
        "rat blocks long jump",
      );
    }
    assert(
      !can(position({ 21: animal, 24: -8 }), 21, 24),
      "jump landing respects rank",
    );
    assert(
      can(position({ 21: animal, 24: -2 }), 21, 24),
      "jump can capture weaker animal",
    );
  }
  assert(
    can(position({ 51: 2, 52: -8 }), 51, 52),
    "enemy in own trap is capturable",
  );
  assert(!can(position({ 2: 8, 1: -2 }), 2, 1), "enemy trap weakens attacker");
  assert(
    can(position({ 58: 8, 57: -2 }), 58, 57),
    "own trap does not weaken attacker",
  );
  const escaped = R.move(position({ 2: 8, 56: -1, 8: -2 }), 2, 1);
  assert(escaped && can({ ...escaped, turn: 1 }, 1, 8), "can leave trap");
  const den = R.move(position({ 2: 1, 62: -1 }), 2, 3);
  assert.equal(den.status, "won");
  assert.equal(den.winner, 1);
  assert.equal(R.move(den, 62, 61), null, "terminal game rejects moves");
  assert.equal(
    R.move(position({ 14: 3, 15: -2 }), 14, 15).status,
    "won",
    "last capture wins",
  );
  const stuck = R.move(position({ 14: -2, 7: 3, 15: 3, 21: 3, 42: 3 }), 42, 35);
  assert.equal(stuck.status, "won", "no legal moves loses");
  const quiet = position({ 14: 1, 48: -1 });
  quiet.quiet = 99;
  assert.equal(R.move(quiet, 14, 7).status, "draw");
  const capture = position({ 14: 3, 15: -2, 62: -1 });
  capture.quiet = 99;
  assert.equal(R.move(capture, 14, 15).quiet, 0);
  let repeated = R.create();
  for (const move of [
    [56, 57],
    [6, 5],
    [57, 56],
    [5, 6],
    [56, 57],
    [6, 5],
    [57, 56],
    [5, 6],
  ])
    repeated = R.move(repeated, ...move);
  assert.equal(repeated.status, "draw", "threefold repetition");
  assert.equal(initial.path.length, 0, "immutable state");
  const played = R.move(initial, 42, 35);
  const save = {
    version: 1,
    state: { mode: "ai", difficulty: "hard", human: -1, path: played.path },
  };
  assert.deepEqual(plain(R.restore(save)), plain(save));
  for (const invalid of [
    null,
    {},
    { ...save, version: 2 },
    { ...save, state: { ...save.state, human: 0 } },
    { ...save, state: { ...save.state, path: [[42, 99]] } },
    {
      ...save,
      state: {
        ...save.state,
        path: [
          [42, 35],
          [42, 35],
        ],
      },
    },
    { ...save, state: { ...save.state, path: [[42, 34]] } },
  ])
    assert.equal(R.restore(invalid), null);
  assert.deepEqual(plain(A.normalize("game-jungle", save)), plain(save));
  assert(A.hasContent("game-jungle", save));
  const other = { version: 1, state: { ...save.state, path: [[48, 41]] } };
  assert(A.merge("game-jungle", save, other).conflict);
  assert.deepEqual(
    plain(A.merge("game-jungle", save, other, "incoming").value),
    other,
  );
  console.log(
    "Jungle rules, terrain, terminal states, replay validation, archive conflicts verified.",
  );
}
async function browserTests() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const output = path.join(
    root,
    "test-results",
    site === root ? "jungle" : "jungle-published",
  );
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const fallback of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addInitScript((fallback) => {
        const show = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = function (...args) {
          const result = show.apply(this, args);
          if (this.id === "onboardingDialog") this.close();
          return result;
        };
        const restoreWorker = window.Worker;
        window.restoreJungleWorker = () => {
          window.Worker = restoreWorker;
        };
        if (fallback)
          window.Worker = class {
            constructor() {
              throw Error("Worker unavailable for test");
            }
          };
        else {
          window.jungleWorkerReplies = 0;
          const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              this.addEventListener("message", (event) => {
                if (event.data.engine === "MistyJungle" && event.data.depth > 0)
                  window.jungleWorkerReplies++;
              });
            }
          };
        }
      }, fallback);
      const page = await context.newPage(),
        errors = [],
        remote = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (route) => {
        if (/jungle/i.test(route.request().url()))
          remote.push(route.request().url());
        return route.abort();
      });
      const action = (name) => page.locator(`[data-jungle-action="${name}"]`);
      const cell = (p) => page.locator(`.jungle-cell[data-square="${p}"]`);
      const save = () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("worktime.games.jungle.v1")),
        );
      const waitMoves = (count) =>
        page.waitForFunction(
          (count) =>
            JSON.parse(localStorage.getItem("worktime.games.jungle.v1")).state
              .path.length === count,
          count,
        );
      await page.goto(pathToFileURL(path.join(site, "index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await launchGame(page, "game-jungle");
      assert(await action("mode-ai").isVisible());
      await action("mode-local").click();
      assert(!(await action("difficulty-easy").isVisible()));
      await action("start").click();
      assert.equal(
        await page.locator(".jungle-animal-name, .jungle-rank").count(),
        0,
      );
      assert.equal(
        await page.locator(".jungle-side-label").count(),
        0,
        "no side captions around the board",
      );
      assert(
        await page.evaluate(() => {
          const red = document.querySelector('.jungle-piece[data-side="1"]');
          const blue = document.querySelector('.jungle-piece[data-side="-1"]');
          return (
            getComputedStyle(red).color !== getComputedStyle(blue).color &&
            getComputedStyle(red).backgroundImage !==
              getComputedStyle(blue).backgroundImage
          );
        }),
        "piece rings and backgrounds distinguish the two sides",
      );
      assert.equal(
        await page.locator(".jungle-piece:not([hidden]) svg").count(),
        16,
      );
      assert(
        await page
          .locator(".jungle-piece")
          .evaluateAll((pieces) =>
            pieces.every((piece) => !piece.textContent.trim()),
          ),
        "portraits have no text or numbers",
      );
      await cell(42).click();
      assert.equal(await cell(35).getAttribute("data-target"), "true");
      await cell(35).click();
      await waitMoves(1);
      await cell(20).click();
      await cell(27).click();
      await waitMoves(2);
      await action("undo").click();
      await waitMoves(1);
      await action("restart").click();
      await page.locator('[data-game-restart="cancel"]').click();
      await waitMoves(1);
      await action("restart").click();
      await page.locator('[data-game-restart="new"]').click();
      await waitMoves(0);
      await cell(42).focus();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      assert.equal(await cell(35).getAttribute("aria-pressed"), "false");
      await cell(42).click();
      await cell(35).click();
      await waitMoves(1);
      const archive = await page.evaluate(async () => {
        await WorkTimeApp.games.prepareArchive();
        const A = WorkTimeApp.services.gameArchive;
        const text = await A.encode(A.exportArchive());
        return (await A.decode(text)).games["game-jungle"];
      });
      assert.equal(archive.state.path.length, 1);
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
      await launchGame(page, "game-jungle");
      await waitMoves(1);
      assert.equal(await cell(35).getAttribute("data-side"), "1");
      for (const language of ["en", "zh-TW", "zh-HK", "ko", "ja", "zh-CN"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        assert(
          !(await page.locator(".game-jungle").innerText()).includes(
            "games.jungle.",
          ),
        );
      }
      await action("restart").click();
      await page.locator('[data-game-restart="new"]').click();
      const route = [42, 35, 28, 21, 14, 15, 22, 23, 24, 17, 10, 3];
      for (let i = 0; i < route.length - 1; i++) {
        await cell(route[i]).click();
        await cell(route[i + 1]).click();
        if (i < route.length - 2) {
          await cell(i % 2 ? 5 : 6).click();
          await cell(i % 2 ? 6 : 5).click();
        }
      }
      assert.equal(
        await page.locator(".jungle-status").textContent(),
        "红方获胜",
      );
      const wonMoves = (await save()).state.path.length;
      assert.equal(await cell(6).getAttribute("aria-disabled"), "true");
      await cell(6).dispatchEvent("click");
      await cell(5).dispatchEvent("click");
      assert.equal(
        (await save()).state.path.length,
        wonMoves,
        "terminal board does not accept moves",
      );
      await action("undo").click();
      assert.equal(
        await page.locator(".jungle-status").textContent(),
        "轮到红方走棋",
      );
      await action("restart").click();
      await page.locator('[data-game-restart="new"]').click();
      for (const [from, to] of [
        [56, 57],
        [6, 5],
        [57, 56],
        [5, 6],
        [56, 57],
        [6, 5],
        [57, 56],
        [5, 6],
      ]) {
        await cell(from).click();
        await cell(to).click();
      }
      assert.equal(await page.locator(".jungle-status").textContent(), "和棋");
      for (const difficulty of ["easy", "normal", "hard"]) {
        await action("settings").click();
        await action("mode-ai").click();
        await action("difficulty-" + difficulty).click();
        await action("human-1").click();
        await cell(42).click();
        await cell(35).click();
        if (difficulty === "hard") {
          await page.waitForFunction(() =>
            document
              .querySelector(".jungle-thinking")
              .hasAttribute("data-active"),
          );
          assert.equal(
            await page.locator(".jungle-thinking").getAttribute("data-side"),
            "blue",
          );
          const thinkingStyle = await page
            .locator(".jungle-thinking")
            .evaluate((el) => ({
              width: el.getBoundingClientRect().width,
              expectedWidth:
                parseFloat(
                  getComputedStyle(document.documentElement).fontSize,
                ) * 5.5,
              visibility: getComputedStyle(el).visibility,
              animations: el.getAnimations({ subtree: true }).length,
            }));
          assert(
            Math.abs(thinkingStyle.width - thinkingStyle.expectedWidth) < 1,
            "thinking icon uses the same 5.5rem size as xiangqi",
          );
          assert.equal(thinkingStyle.visibility, "visible");
          assert.equal(
            thinkingStyle.animations,
            0,
            "reduced motion keeps thinking icon static",
          );
          await page.screenshot({
            path: path.join(
              output,
              `${fallback ? "retry" : "worker"}-thinking.png`,
            ),
          });
          await action("rules").click();
          assert(
            await page
              .locator(".jungle-rules-dialog")
              .evaluate((el) => !el.hidden),
          );
          assert.equal(await page.locator(".jungle-rule-card").count(), 7);
          const rulesLayout = await page
            .locator(".jungle-rules-dialog")
            .evaluate((el) => {
              const area = el.closest(".game-jungle").getBoundingClientRect();
              const panel = el.getBoundingClientRect();
              const body = el.querySelector(".jungle-rules-body");
              return {
                inside:
                  panel.left >= area.left &&
                  panel.right <= area.right + 1 &&
                  panel.top >= area.top &&
                  panel.bottom <= area.bottom + 1,
                overflow: body.scrollHeight - body.clientHeight,
              };
            });
          assert(rulesLayout.inside, "rules stay inside the game window");
          assert(
            rulesLayout.overflow <= 1,
            "desktop rules fit without scrolling",
          );
          await page.screenshot({
            path: path.join(output, "rules-desktop.png"),
          });
          await page.waitForTimeout(3300);
          assert.equal(
            (await save()).state.path.length,
            1,
            "rules dialog pauses AI beyond its search budget",
          );
          await page.keyboard.press("Escape");
          assert(
            !(await page
              .locator(".jungle-rules-dialog")
              .evaluate((el) => !el.hidden)),
          );
          assert.equal(
            await page.locator("#gameShell").getAttribute("data-state"),
            "open",
            "Escape closes rules without exiting the game",
          );
          await action("settings").click();
          assert.equal(
            await page.locator(".jungle-thinking").getAttribute("data-active"),
            null,
          );
          await page.waitForTimeout(1700);
          assert.equal(
            (await save()).state.path.length,
            1,
            "settings cancels pending AI",
          );
          await action("continue").click();
        }
        if (fallback && difficulty === "easy") {
          await action("retry-engine").waitFor({ state: "visible" });
          assert.equal(
            (await save()).state.path.length,
            1,
            "engine failure pauses without fallback",
          );
          await page.evaluate(() => window.restoreJungleWorker());
          await action("retry-engine").click();
        }
        await waitMoves(2);
        assert.equal(
          await page.locator(".jungle-thinking").getAttribute("data-side"),
          "blue",
          "fade-out retains the AI color after red's turn begins",
        );
        assert.equal(
          await page.locator(".jungle-thinking").getAttribute("data-active"),
          null,
          "thinking icon stops on human turn",
        );
        assert.equal(
          await page.locator(".game-jungle").getAttribute("data-engine"),
          "MistyJungle",
        );
        assert.equal((await save()).state.difficulty, difficulty);
        await action("undo").click();
        await waitMoves(0);
      }
      await action("settings").click();
      await action("human--1").click();
      await waitMoves(1);
      assert(await action("undo").isDisabled());
      assert.equal(
        await page
          .locator('.jungle-cell[data-display="0"]')
          .getAttribute("data-square"),
        "62",
        "blue player board flips",
      );
      // Leaving during an AI turn must never write a stale result later.
      await action("settings").click();
      await action("human-1").click();
      await cell(42).click();
      await cell(35).click();
      await page.locator("#gameExitButton").click();
      await page.waitForTimeout(1700);
      assert.equal((await save()).state.path.length, 1);
      await launchGame(page, "game-jungle");
      await waitMoves(2);
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
        { width: 320, height: 740 },
      ]) {
        await page.setViewportSize(viewport);
        assert.equal(
          await page
            .locator(
              ".jungle-terrain-key, .jungle-guide-note, .jungle-strength-direction, .jungle-strength-exception",
            )
            .count(),
          0,
        );
        const alignment = await page
          .locator(".jungle-guide")
          .evaluate((el) => ({
            guide: el.getBoundingClientRect().left,
            ring: el.querySelector(".jungle-strength").getBoundingClientRect()
              .left,
          }));
        assert(
          Math.abs(alignment.guide - alignment.ring) < 1,
          "food chain aligns to the left",
        );
        if (viewport.width === 390) {
          const beforeRules = JSON.stringify(await save());
          await action("rules").click();
          await page.screenshot({
            path: path.join(output, "rules-mobile.png"),
          });
          const dialogBounds = await page
            .locator(".jungle-rules-dialog")
            .boundingBox();
          const rulesOverflow = await page
            .locator(".jungle-rules-body")
            .evaluate((el) => el.scrollHeight - el.clientHeight);
          assert(rulesOverflow <= 1, "mobile rules fit without scrolling");
          assert(
            dialogBounds.x >= 0 &&
              dialogBounds.x + dialogBounds.width <= viewport.width,
          );
          await action("rules-resume").click();
          assert.equal(JSON.stringify(await save()), beforeRules);
        }
        const actionBounds = await page
          .locator(".jungle-controls > .jungle-actions > button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const r = button.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width };
            }),
          );
        assert.equal(actionBounds.length, 4);
        assert(
          actionBounds.every(
            (r, index) =>
              Math.abs(r.y - actionBounds[0].y) < 1 &&
              r.width > 40 &&
              (!index || r.x > actionBounds[index - 1].x),
          ),
          "all four controls share one row at every viewport",
        );
        const before = JSON.stringify(await save());
        await action("rotate").click();
        const horizontal = await page.locator(".jungle-board").boundingBox();
        assert(
          horizontal.width > horizontal.height,
          "rotation gives a nine-column landscape board",
        );
        assert.equal(
          await page
            .locator('.jungle-cell[data-display="0"]')
            .getAttribute("data-square"),
          "56",
        );
        await page.screenshot({
          path: path.join(
            output,
            `${fallback ? "fallback" : "worker"}-landscape-${viewport.width}.png`,
          ),
        });
        assert.equal(
          JSON.stringify(await save()),
          before,
          "rotation preserves the match",
        );
        await action("rotate").click();
        await page.screenshot({
          path: path.join(
            output,
            `${fallback ? "fallback" : "worker"}-${viewport.width}.png`,
          ),
        });
        const bounds = await page.locator(".jungle-board").boundingBox();
        assert(
          bounds.width > 200 &&
            bounds.x >= 0 &&
            bounds.x + bounds.width <= viewport.width,
          "board fits viewport",
        );
        assert(
          await page
            .locator(".game-jungle")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          "no horizontal overflow",
        );
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(remote, []);
      if (!fallback)
        assert(
          await page.evaluate(() => window.jungleWorkerReplies > 0),
          "local Worker actually returns moves",
        );
      await context.close();
    }
    await verifyPresentation(browser, output);
    console.log(
      "Offline entry: same-device play, all AI levels, both sides, WASM Worker/failure retry, cancellation, undo, restart, save/export, languages and mobile layout verified.",
    );
  } finally {
    await browser.close();
  }
}
async function verifyPresentation(browser, output) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
  });
  await context.addInitScript(() => {
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      const result = show.apply(this, args);
      if (this.id === "onboardingDialog") this.close();
      return result;
    };
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(path.join(site, "index.html")).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
  await launchGame(page, "game-jungle");
  const action = (name) => page.locator(`[data-jungle-action="${name}"]`);
  const cell = (p) => page.locator(`.jungle-cell[data-square="${p}"]`);
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".jungle-board").dataset.moving !== "true" &&
        document.querySelector(".game-jungle").dataset.rotating !== "true",
    );
  const moving = () =>
    page.waitForFunction(
      () => document.querySelector(".jungle-board").dataset.moving === "true",
    );
  const move = async (from, to) => {
    await cell(from).click();
    await cell(to).click();
  };
  await action("mode-local").click();
  await action("start").click();
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
  const enlarged = await page.locator(".jungle-board").boundingBox();
  assert(
    enlarged.width > 580,
    "portrait board is larger than the old 490px cap",
  );
  await move(42, 35);
  await moving();
  assert(
    await cell(35)
      .locator(".jungle-piece")
      .evaluate((el) =>
        el
          .getAnimations()
          .some((animation) => animation.effect.getTiming().duration === 320),
      ),
    "normal moves animate",
  );
  await idle();
  await move(20, 27);
  await idle();
  await move(56, 49);
  await idle();
  await move(6, 5);
  await idle();
  await move(49, 42);
  await idle();
  await move(5, 6);
  await idle();
  await move(42, 43);
  await idle();
  await move(6, 5);
  await idle();
  await move(43, 15);
  await moving();
  assert(
    await cell(15)
      .locator(".jungle-piece")
      .evaluate((el) =>
        el
          .getAnimations()
          .some(
            (animation) =>
              animation.effect.getTiming().duration === 520 &&
              animation.effect
                .getKeyframes()
                .some((frame) => frame.transform.includes("1.16")),
          ),
      ),
    "river jumps use a higher, longer arc",
  );
  await idle();
  await move(5, 6);
  await idle();
  await move(15, 8);
  await moving();
  assert.equal(
    await page.locator(".jungle-captured").count(),
    1,
    "capture fades the removed animal",
  );
  await action("rotate").click();
  await page.waitForFunction(
    () => document.querySelector(".game-jungle").dataset.rotating === "true",
  );
  assert(
    await page
      .locator(".jungle-board")
      .evaluate((el) =>
        el
          .getAnimations()
          .some((animation) =>
            animation.effect
              .getKeyframes()
              .some((frame) => frame.transform.includes("rotate(-90deg)")),
          ),
      ),
    "portrait-to-landscape visibly rotates the board",
  );
  assert(
    await page
      .locator(".jungle-controls, .jungle-controls > *")
      .evaluateAll((elements) =>
        elements.every((element) =>
          element
            .getAnimations()
            .some(
              (animation) =>
                animation.effect.getTiming().duration === 560 &&
                animation.effect
                  .getKeyframes()
                  .every(
                    (frame) =>
                      frame.transform.includes("translate(") &&
                      !frame.transform.includes("scale("),
                  ),
            ),
        ),
      ),
    "sidebar title, buttons and instructions move in sync without scaling text",
  );
  assert(
    await cell(8)
      .locator(".jungle-piece:not(.jungle-captured)")
      .evaluate((el) =>
        el
          .getAnimations()
          .some((animation) =>
            animation.effect
              .getKeyframes()
              .some((frame) => frame.transform.includes("rotate(90deg)")),
          ),
      ),
    "animal portraits counter-rotate to remain upright",
  );
  await page.waitForTimeout(90);
  assert(
    await page.locator(".jungle-board").evaluate((el) => {
      const board = el.getBoundingClientRect(),
        root = el.closest(".game-jungle").getBoundingClientRect();
      return (
        board.left >= root.left &&
        board.right <= root.right &&
        board.top >= root.top &&
        board.bottom <= root.bottom
      );
    }),
    "rotating board stays inside the visible game area",
  );
  await page.screenshot({
    path: path.join(output, "rotation-in-progress.png"),
  });
  await idle();
  assert.equal(
    await page.locator(".jungle-captured").count(),
    0,
    "rotation settles active motion",
  );
  assert(
    await page
      .locator(".jungle-controls, .jungle-controls > *")
      .evaluateAll((elements) =>
        elements.every(
          (element) =>
            element.getAnimations().length === 0 &&
            getComputedStyle(element).transform === "none",
        ),
      ),
    "sidebar animation settles at its final layout",
  );
  assert.equal(await cell(8).getAttribute("data-side"), "1");
  assert.equal(
    await page.locator(".game-jungle").getAttribute("data-orientation"),
    "landscape",
  );
  async function rotateContrast() {
    return action("rotate").evaluate((el) => {
      const style = getComputedStyle(el),
        canvas = document.createElement("canvas"),
        context = canvas.getContext("2d");
      function luminance(color) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const values = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) =>
            n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
          );
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      }
      // Composite transparent button backgrounds over their actual ancestors.
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "white";
      context.fillRect(0, 0, 1, 1);
      const ancestors = [];
      for (let parent = el; parent; parent = parent.parentElement)
        ancestors.unshift(parent);
      for (const parent of ancestors) {
        context.fillStyle = getComputedStyle(parent).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const background = context.getImageData(0, 0, 1, 1).data;
      const backgroundColor = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
      const fg = luminance(style.color),
        bg = luminance(backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
  }
  await action("rotate").hover();
  await page.waitForTimeout(180);
  assert(
    (await rotateContrast()) >= 4.5,
    "rotation control remains legible on hover",
  );
  await page.mouse.move(0, 0);
  await page.waitForTimeout(180);
  assert(
    (await rotateContrast()) >= 4.5,
    "rotation control remains legible when selected",
  );
  await action("rotate").click();
  await page.waitForFunction(
    () => document.querySelector(".game-jungle").dataset.rotating === "true",
  );
  assert(
    await page
      .locator(".jungle-board")
      .evaluate((el) =>
        el
          .getAnimations()
          .some((animation) =>
            animation.effect
              .getKeyframes()
              .some((frame) => frame.transform.includes("rotate(90deg)")),
          ),
      ),
    "landscape-to-portrait animates the reverse turn",
  );
  await idle();
  await action("rotate").click();
  await page.waitForFunction(
    () => document.querySelector(".game-jungle").dataset.rotating === "true",
  );
  await page.setViewportSize({ width: 1420, height: 1000 });
  await idle();
  assert.equal(
    await page
      .locator(".jungle-board")
      .evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((animation) =>
              animation.effect
                .getKeyframes()
                .some((frame) => frame.transform?.includes("rotate(")),
            ).length,
      ),
    0,
    "resizing settles rotation without leaving transformed pieces",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await action("undo").click();
  assert.equal(await cell(8).getAttribute("data-side"), "-1");
  assert.equal(await cell(15).getAttribute("data-side"), "1");
  await cell(15).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.square),
    "8",
    "keyboard follows rotated screen coordinates",
  );
  await move(15, 8);
  await moving();
  await action("undo").click();
  await idle();
  assert.equal(
    await page.locator(".jungle-captured").count(),
    0,
    "undo cancels capture animation cleanly",
  );
  await page.evaluate(() =>
    WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
  );
  await move(15, 8);
  await idle();
  assert.equal(
    await page
      .locator(".jungle-board")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
    "reduced motion settles immediately",
  );
  await page.screenshot({
    path: path.join(output, "presentation-landscape.png"),
  });
  await action("settings").click();
  await action("mode-ai").click();
  await action("difficulty-normal").click();
  await action("human-1").click();
  await move(42, 35);
  await action("rotate").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("worktime.games.jungle.v1")).state.path
        .length === 2,
  );
  assert.equal(
    await page.locator(".game-jungle").getAttribute("data-orientation"),
    "portrait",
  );
  await page.screenshot({
    path: path.join(output, "presentation-portrait.png"),
  });
  await action("settings").click();
  await action("human--1").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("worktime.games.jungle.v1")).state.path
        .length === 1,
  );
  await action("rotate").click();
  assert.equal(
    await page
      .locator('.jungle-cell[data-display="0"]')
      .getAttribute("data-square"),
    "6",
    "blue-side rotation composes with board reversal",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
  await launchGame(page, "game-jungle");
  assert.equal(
    await page.locator(".game-jungle").getAttribute("data-orientation"),
    "landscape",
    "orientation preference survives reload",
  );
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Larger board, portrait artwork, terrain map, rotation, keyboard mapping, move/jump/capture motion, cancellation and reduced-motion behavior verified.",
  );
}
(async () => {
  unit();
  await require("./misty-jungle/verify.cjs").verify(site);
  if (!process.argv.includes("--unit")) await browserTests();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
