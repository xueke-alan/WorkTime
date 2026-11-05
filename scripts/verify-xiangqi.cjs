"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const { rules } = require("./build-xiangqi.cjs");

const root = path.resolve(__dirname, "..");
const site = path.resolve(process.argv[2] ?? root);
const entry = pathToFileURL(path.join(site, "index.html")).href;
const context = vm.createContext({ WorkTimeApp: { data: {} } });
vm.runInContext(
  fs.readFileSync(path.join(site, "assets/data/xiangqi.js"), "utf8"),
  context,
);
const levels = context.WorkTimeApp.data.xiangqi;
const classics = levels.slice(100);
const key = "worktime.games.xiangqi.v1";
const delayedMate = [90, 283, 2460];
const redDefeat = [1629, 109, 2985, 1733];
const stalemateMove = 1093;
const firstMove = (node) => Number(Object.keys(node[1])[0]);
const squareAt = (page, index) =>
  page.locator(`.xiangqi-cell[data-square="${index}"]`);
const gameAction = (page, name) =>
  page.locator(`[data-xiangqi-action="${name}"]`);
async function center(page, index) {
  const { x, y, width, height } = await squareAt(page, index).boundingBox();
  return { x: x + width / 2, y: y + height / 2 };
}

function verifyRules() {
  function board(pieces) {
    const squares = Array(90).fill(".");
    for (const [index, piece] of Object.entries({ 4: "k", 85: "K", ...pieces }))
      squares[index] = piece;
    return squares.join("");
  }
  function can(position, from, to, red = true) {
    return rules
      .destinations(position, red, from)
      .includes(rules.encode(from, to));
  }
  assert(rules.checked(board({}), true), "facing generals");
  assert(!can(board({ 49: "R" }), 49, 50), "cannot expose the red general");
  assert(can(board({ 40: "P", 56: "H" }), 56, 39));
  assert(!can(board({ 40: "P", 56: "H", 47: "P" }), 56, 39), "blocked horse");
  assert(can(board({ 40: "P", 83: "E" }), 83, 63));
  assert(
    !can(board({ 40: "P", 83: "E", 73: "H" }), 83, 63),
    "blocked elephant",
  );
  assert(
    !can(board({ 40: "P", 51: "E" }), 51, 31),
    "elephant cannot cross the river",
  );
  assert(
    !can(board({ 40: "P", 84: "A" }), 84, 74),
    "advisor cannot leave palace",
  );
  assert(!can(board({ 40: "P" }), 85, 86 + 1), "general cannot jump");
  assert(
    !can(board({ 40: "P", 51: "C", 24: "h" }), 51, 24),
    "cannon needs a screen to capture",
  );
  assert(can(board({ 40: "P", 51: "C", 42: "P", 24: "h" }), 51, 24));
  assert(
    !can(board({ 40: "P", 51: "C", 42: "P" }), 51, 24),
    "cannon cannot jump to an empty square",
  );
  assert(
    !can(board({ 40: "P", 50: "P" }), 50, 51),
    "soldier cannot turn before crossing",
  );
  assert(
    can(board({ 40: "P", 67: "P" }), 40, 41),
    "soldier can turn after crossing",
  );
  assert(!can(board({ 40: "P" }), 40, 49), "soldier cannot retreat");
  const checked = board({ 4: ".", 3: "k", 67: "r", 79: "R" });
  assert(rules.checked(checked, true));
  assert(!can(checked, 79, 78), "must answer a check");
  assert(can(checked, 85, 86));
  const stalemate = board({ 4: ".", 3: "k", 13: "R", 22: "R" });
  assert.equal(rules.result(stalemate, false), "stalemate");

  function verifyBranches(level, board, tree, played = []) {
    const legal = rules.legalMoves(board, true);
    for (const [code, replies] of Object.entries(tree[1])) {
      const move = Number(code);
      assert(legal.includes(move));
      const after = rules.apply(board, move);
      if (replies === null) {
        assert.equal(rules.result(after, false), "mate");
        assert.equal(rules.restore(level, [...played, move]).status, "won");
        continue;
      }
      const black = rules.legalMoves(after, false);
      assert(black.length);
      assert.deepEqual(Object.keys(replies).map(Number), [...black]);
      const reply = rules.reply(replies);
      assert.equal(
        replies[reply][0],
        Math.max(...Object.values(replies).map((node) => node[0])),
      );
      for (const defense of black)
        verifyBranches(level, rules.apply(after, defense), replies[defense], [
          ...played,
          move,
          defense,
        ]);
    }
  }
  assert(classics.length > 0);
  assert(classics.every(({ goal, title }) => goal >= 4 && title));
  for (const level of levels)
    verifyBranches(level, rules.parse(level.position), level.tree);
  const [first] = levels;
  const [opening, defense, finish] = delayedMate;
  const start = rules.restore(first, []);
  assert(!Object.hasOwn(first.tree[1], opening));
  assert.equal(rules.playRound(start, opening).defense, defense);
  const draft = rules.restore(first, delayedMate.slice(0, 2));
  assert.equal(draft.status, "playing");
  assert.equal(draft.node, null);
  assert.equal(rules.suggest(draft.board, true), finish);
  assert.equal(rules.restore(first, delayedMate).status, "won");
  assert.equal(rules.restore(first, [opening]), null);
  assert.equal(rules.restore(first, [...delayedMate, defense]), null);
  assert.equal(rules.restore(first, [opening, 8100]), null);

  assert.equal(rules.restore(levels[6], redDefeat).status, "lost");
  assert.equal(rules.restore(levels[6], [...redDefeat, 0]), null);
}

async function launch(page, touch = false) {
  await page.goto(entry);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
  const tab = page.locator("#date-tab-games");
  if (touch) await tab.tap();
  else await tab.click();
  await launchGame(page, "game-xiangqi", { touch });
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
}

async function desktop(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const action = (name) => page.locator(`[data-xiangqi-action="${name}"]`);
  const square = (index) =>
    page.locator(`.xiangqi-cell[data-square="${index}"]`);
  const status = page.locator(".xiangqi-status");
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const boardState = () =>
    page.locator(".xiangqi-cell .xiangqi-piece").allTextContents();
  async function move(code) {
    const [from, to] = rules.decode(code);
    await square(from).click();
    await square(to).click();
  }
  await launch(page);
  const visibleLevels = page.locator(".xiangqi-levels button:visible");
  assert.equal(await visibleLevels.count(), 30);
  assert.equal(await action("goal1").getAttribute("aria-pressed"), "true");
  assert.match(
    await page.locator(".game-level-progress").textContent(),
    /0\/30/,
  );
  const [first] = levels;
  await action(first.id).click();
  assert.equal(
    await square(1).evaluate((cell) => getComputedStyle(cell).outlineStyle),
    "none",
  );
  await page.keyboard.press("Enter");
  assert.equal(await square(1).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await square(1).getAttribute("aria-pressed"), "false");
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.square),
    "2",
  );
  await action("hint").click();
  assert.equal(await page.locator(".xiangqi-cell.is-selected").count(), 1);
  assert.equal(await page.locator(".xiangqi-cell.is-suggested").count(), 0);
  await action("hint").click();
  assert.equal(await page.locator(".xiangqi-cell.is-suggested").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".xiangqi-cell.is-suggested").count(), 0);
  await action("hint").click();
  await square(89).click();
  assert.match(await status.textContent(), /不符合/);
  const initial = await boardState();
  await square(rules.decode(delayedMate[0])[1]).click();
  assert.deepEqual(
    (await saved()).drafts[first.id].path,
    delayedMate.slice(0, 2),
  );
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /红方已走 1 步/,
  );
  const offTrackBoard = await boardState();
  assert.notDeepEqual(offTrackBoard, initial);
  await launch(page);
  assert.deepEqual(await boardState(), offTrackBoard);
  await action("hint").click();
  await action("hint").click();
  const [hintFrom, hintTo] = rules.decode(delayedMate[2]);
  assert.equal(await square(hintFrom).getAttribute("aria-pressed"), "true");
  assert(
    await square(hintTo).evaluate((cell) =>
      cell.classList.contains("is-suggested"),
    ),
  );
  await square(hintTo).click();
  assert.match(await status.textContent(), /已通关/);
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /红方已走 2 步/,
  );
  assert.deepEqual((await saved()).completed[first.id].path, delayedMate);
  await action("undo").click();
  assert.deepEqual(await boardState(), offTrackBoard);
  await action("undo").click();
  assert.deepEqual(await boardState(), initial);
  const [freeFrom] = rules.decode(delayedMate[0]);
  await square(freeFrom).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  assert.deepEqual(await boardState(), offTrackBoard);
  await action("undo").click();
  const alternate = Number(Object.keys(first.tree[1])[1]);
  const [keyboardFrom, keyboardTo] = rules.decode(alternate);
  await square(keyboardFrom).focus();
  await page.keyboard.press("Enter");
  for (const [distance, positive, negative] of [
    [(keyboardTo % 9) - (keyboardFrom % 9), "ArrowRight", "ArrowLeft"],
    [
      Math.floor(keyboardTo / 9) - Math.floor(keyboardFrom / 9),
      "ArrowDown",
      "ArrowUp",
    ],
  ])
    for (let step = 0; step < Math.abs(distance); step++)
      await page.keyboard.press(distance > 0 ? positive : negative);
  await page.keyboard.press("Space");
  assert.match(await status.textContent(), /已通关/);
  await action("undo").click();
  assert.deepEqual(await boardState(), initial);
  assert.deepEqual((await saved()).completed[first.id].path, delayedMate);
  await action("choose").click();
  assert.equal(await action(first.id).textContent(), "01");
  assert.equal(
    await action(first.id)
      .locator(".game-level-badge")
      .getAttribute("data-state"),
    "complete",
  );

  const two = levels[6];
  await action("goal2").click();
  assert.equal(await visibleLevels.count(), 35);
  assert.equal(await action("goal1").getAttribute("aria-pressed"), "false");
  assert.equal(await action("goal2").getAttribute("aria-pressed"), "true");
  await action(two.id).click();
  await move(firstMove(two.tree));
  assert.equal((await saved()).drafts[two.id].path.length, 2);
  const midway = await boardState();
  await launch(page);
  assert.deepEqual(await boardState(), midway);
  await action("choose").click();
  assert.equal(await action("goal2").getAttribute("aria-pressed"), "true");
  assert.match(await action(two.id).getAttribute("aria-label"), /进行中/);
  assert.equal(
    await action(two.id)
      .locator(".game-level-badge")
      .getAttribute("data-state"),
    "draft",
  );
  assert(
    await action(two.id).evaluate(
      (element) => element === document.activeElement,
    ),
  );
  await action(two.id).click();
  await action("undo").click();
  assert.deepEqual((await saved()).drafts[two.id].path, []);
  await action("choose").click();

  const last = levels.at(-1);
  for (const level of levels) {
    if (!(await action(level.id).isVisible()))
      await action("goal" + Math.min(level.goal, 4)).click();
    await action(level.id).click();
    let node = level.tree;
    while (node) {
      const code = firstMove(node);
      await move(code);
      const defenses = node[1][code];
      node = defenses === null ? null : defenses[rules.reply(defenses)];
    }
    assert.match(await status.textContent(), /已通关/, level.id);
    if (level.id === "xq-100") {
      await action("next").click();
      assert.match(
        await page.locator(".xiangqi-objective").textContent(),
        /第 101 关/,
      );
    }
    if (level === last) assert(!(await action("next").isVisible()));
    await action("choose").click();
  }
  assert.equal(
    await page.locator(".xiangqi-progress").textContent(),
    `已通关 ${levels.length}/${levels.length}`,
  );
  assert.equal(await action("goal4").getAttribute("aria-pressed"), "true");
  assert.equal(await visibleLevels.count(), classics.length);
  const stalemate = levels[19];
  await action("goal3").click();
  await action(stalemate.id).click();
  await move(stalemateMove);
  assert.match(await status.textContent(), /黑方被困毙/);
  assert(await action("hint").isDisabled());
  assert(!(await action("next").isVisible()));
  assert.deepEqual((await saved()).drafts[stalemate.id].path, [stalemateMove]);
  await launch(page);
  assert.match(await status.textContent(), /黑方被困毙/);
  await action("undo").click();
  assert.deepEqual((await saved()).drafts[stalemate.id].path, []);
  await move(stalemateMove);
  await action("restart").click();
  assert.deepEqual((await saved()).drafts[stalemate.id].path, []);
  await page.evaluate(
    ({ key, id, path }) => {
      const save = JSON.parse(localStorage.getItem(key));
      save.current = id;
      save.drafts[id] = { path };
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, id: two.id, path: redDefeat },
  );
  await launch(page);
  assert.match(await status.textContent(), /红方无棋可走/);
  assert(await action("hint").isDisabled());
  assert(!(await action("next").isVisible()));
  await action("undo").click();
  assert.deepEqual((await saved()).drafts[two.id].path, redDefeat.slice(0, 2));
  assert.deepEqual(errors, []);
  await page.close();
}

async function mobile(browser) {
  const page = await browser.newPage({
    viewport: { width: 320, height: 740 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw Error("Storage full");
      return original.call(this, name, value);
    };
  }, key);
  await launch(page, true);
  await gameAction(page, "goal4").tap();
  const classic = classics[0];
  const finalLevel = gameAction(page, classic.id);
  const boundsInCatalog = await finalLevel.boundingBox();
  assert(
    boundsInCatalog.x >= 0 && boundsInCatalog.x + boundsInCatalog.width <= 320,
  );
  await finalLevel.tap();
  const objective = await page.locator(".xiangqi-objective").textContent();
  assert(objective.includes(classic.title));
  assert(objective.includes(`${classic.goal} 步杀`));
  const finalBoard = await page.locator(".xiangqi-board").boundingBox();
  assert(finalBoard.y >= 0 && finalBoard.y + finalBoard.height <= 740);
  await gameAction(page, "choose").tap();
  await gameAction(page, "goal1").tap();
  await page.locator('[data-xiangqi-action="xq-01"]').tap();
  const bounds = await page.locator(".xiangqi-board").boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  const [freeFrom, freeTo] = rules.decode(delayedMate[0]);
  await squareAt(page, freeFrom).tap();
  await squareAt(page, freeTo).tap();
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /红方已走 1 步/,
  );
  await gameAction(page, "restart").tap();
  const [from, to] = rules.decode(firstMove(levels[0].tree));
  await page.locator(`.xiangqi-cell[data-square="${from}"]`).tap();
  await page.locator(`.xiangqi-cell[data-square="${to}"]`).tap();
  assert.match(await page.locator(".xiangqi-status").textContent(), /已通关/);
  assert(await page.locator(".xiangqi-warning").isVisible());
  await page.locator('[data-xiangqi-action="next"]').tap();
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /第 2 关/,
  );
  await page.setViewportSize({ width: 390, height: 740 });
  await page.locator('[data-xiangqi-action="choose"]').tap();
  await gameAction(page, "xq-01").tap();
  const wide = await page.locator(".xiangqi-board").boundingBox();
  assert(wide.x >= 0 && wide.x + wide.width <= 390);
  const client = await page.context().newCDPSession(page);
  const source = await center(page, from);
  const target = await center(page, to);
  const touch = (type, point) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ ...point, id: 1 }] : [],
    });
  await touch("touchStart", source);
  await touch("touchMove", target);
  assert(await page.locator(".xiangqi-ghost").isVisible());
  await touch("touchCancel");
  assert(!(await page.locator(".xiangqi-ghost").isVisible()));
  assert.match(await page.locator(".xiangqi-status").textContent(), /轮到红方/);
  await touch("touchStart", source);
  await touch("touchMove", target);
  await touch("touchEnd");
  assert.match(await page.locator(".xiangqi-status").textContent(), /已通关/);
  await page.close();
}

async function interaction(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const action = (name) => gameAction(page, name);
  const status = page.locator(".xiangqi-status");
  const reply = page.locator(".xiangqi-board[data-replying]");
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const [first] = levels;
  const two = levels[6];
  const [from, to] = rules.decode(firstMove(first.tree));
  await launch(page);
  await action(first.id).click();

  const source = await center(page, from);
  const target = await center(page, to);
  const drag = async (point) => {
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y, { steps: 4 });
  };
  await drag({ x: source.x + 3, y: source.y });
  assert(!(await page.locator(".xiangqi-ghost").isVisible()));
  await page.mouse.up();
  assert.equal(await squareAt(page, from).getAttribute("aria-pressed"), "true");
  assert(
    await squareAt(page, to).evaluate((cell) =>
      cell.classList.contains("is-capture"),
    ),
  );
  await drag({ x: 2, y: 2 });
  await page.mouse.up();
  assert.equal(await squareAt(page, from).getAttribute("aria-pressed"), "true");
  assert.deepEqual((await saved()).drafts[first.id].path, []);
  await drag(await center(page, 89));
  await page.mouse.up();
  assert.match(await status.textContent(), /不符合/);
  assert.equal(await squareAt(page, from).getAttribute("aria-pressed"), "true");
  const offTrack = rules
    .destinations(rules.parse(first.position), true, from)
    .find((move) => !Object.hasOwn(first.tree[1], move));
  await drag(await center(page, rules.decode(offTrack)[1]));
  await page.mouse.up();
  assert.equal((await saved()).drafts[first.id].path[0], offTrack);
  await action("restart").click();
  assert.deepEqual((await saved()).drafts[first.id].path, []);
  await drag(target);
  assert(await page.locator(".xiangqi-ghost").isVisible());
  assert(
    await squareAt(page, to).evaluate((cell) =>
      cell.classList.contains("is-drop"),
    ),
  );
  await page.mouse.up();
  assert.match(await status.textContent(), /已通关/);
  assert.equal(await page.locator(".xiangqi-cell.is-check").count(), 1);
  assert.deepEqual((await saved()).completed[first.id].path, [
    firstMove(first.tree),
  ]);
  await action("next").click();
  await action("choose").click();
  await action("goal2").click();
  await action(two.id).click();

  const opening = firstMove(two.tree);
  const black = rules.reply(two.tree[1][opening]);
  const round = [opening, black];
  async function startRound(then) {
    const result = await page.evaluate(
      ({ move, then }) => {
        const [from, to] = move;
        const cell = (index) =>
          document.querySelector(`[data-square="${index}"]`);
        const action = (name) =>
          document.querySelector(`[data-xiangqi-action="${name}"]`);
        cell(from).click();
        cell(to).click();
        const board = document.querySelector(".xiangqi-board");
        const replying = board.hasAttribute("data-replying");
        const redAnimation = cell(to)
          .querySelector(".xiangqi-piece")
          .getAnimations()
          .some((animation) => animation.effect.getTiming().duration === 110);
        cell(from).click();
        cell(to).click();
        const stillLocked =
          action("hint").disabled && !board.querySelector(".is-selected");
        if (then === "exit") document.querySelector("#gameExitButton").click();
        else if (then) action(then).click();
        return { replying, redAnimation, stillLocked };
      },
      { move: rules.decode(opening), then },
    );
    assert.deepEqual(result, {
      replying: true,
      redAnimation: true,
      stillLocked: true,
    });
  }

  await startRound();
  assert.deepEqual((await saved()).drafts[two.id].path, round);
  await page.waitForFunction(() =>
    document
      .querySelector(".xiangqi-board")
      .getAnimations({ subtree: true })
      .some((animation) => animation.effect.getTiming().duration === 150),
  );
  await reply.waitFor({ state: "detached" });
  await action("undo").click();
  await startRound("undo");
  assert.deepEqual((await saved()).drafts[two.id].path, []);
  await startRound("restart");
  assert.deepEqual((await saved()).drafts[two.id].path, []);
  await startRound();
  await launch(page);
  assert.equal(await reply.count(), 0);
  assert.deepEqual((await saved()).drafts[two.id].path, round);
  await action("undo").click();
  await startRound("exit");
  await page.locator(".game-xiangqi").waitFor({ state: "detached" });
  assert.deepEqual((await saved()).drafts[two.id].path, round);
  await launch(page);
  await action("undo").click();
  await page.evaluate(() => {
    Element.prototype.animate = undefined;
  });
  const [origin, destination] = rules.decode(opening);
  await squareAt(page, origin).click();
  await squareAt(page, destination).click();
  assert.equal(await reply.count(), 0);
  assert.deepEqual((await saved()).drafts[two.id].path, round);
  assert.deepEqual(errors, []);
  await page.close();
}

(async () => {
  verifyRules();
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    await desktop(browser);
    await mobile(browser);
    await interaction(browser);
    console.log(
      `Xiangqi rules, all ${levels.length} offline puzzles, continuation, keyboard, mouse/touch drag, reply animation and storage errors passed.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
