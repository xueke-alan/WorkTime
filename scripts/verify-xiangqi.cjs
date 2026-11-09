"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
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
const classics = levels.filter(({ title }) => title);
const groupFor = ({ goal }) =>
  goal <= 3 ? goal : goal <= 5 ? 4 : goal <= 8 ? 5 : 6;
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
  assert.equal(levels.length, 200);
  assert.equal(classics.length, 120);
  assert.equal(new Set(levels.map(({ id }) => id)).size, 200);
  assert.equal(new Set(levels.map(({ position }) => position)).size, 200);
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
  const stalematePosition = rules.restore(
    levels.find(({ id }) => id === "xq-20"),
    [stalemateMove],
  );
  assert.equal(stalematePosition.status, "won");
  assert.equal(stalematePosition.outcome, "stalemate");
  assert.equal(rules.restore(first, delayedMate).status, "won");
  assert.equal(rules.restore(first, [opening]), null);
  assert.equal(rules.restore(first, [...delayedMate, defense]), null);
  assert.equal(rules.restore(first, [opening, 8100]), null);

  assert.equal(
    rules.restore(
      levels.find(({ id }) => id === "xq-07"),
      redDefeat,
    ).status,
    "lost",
  );
  assert.equal(
    rules.restore(
      levels.find(({ id }) => id === "xq-07"),
      [...redDefeat, 0],
    ),
    null,
  );
}

async function launch(page, touch = false) {
  await page.goto(entry);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("app-loading"),
  );
  await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
  const tab = page.locator("#date-tab-games");
  await page.waitForFunction(
    () =>
      typeof document.getElementById("date-tab-games")?.onclick === "function",
  );
  if (!(await page.locator("#gamesPanel").isVisible()))
    await tab.evaluate((button) => button.click());
  await page.locator("#gamesPanel").waitFor({ state: "visible" });
  // This suite repeatedly reloads saved games while shell/menu animations may
  // still be settling. Menu pointer behavior has its own dedicated verifier.
  await page
    .locator('#gamesPanel [data-game="game-xiangqi"]')
    .evaluate((button) => button.click());
  await page
    .locator("#gamesPanel .game-menu-play")
    .evaluate((button) => button.click());
  await page.waitForFunction(() => {
    const content = document.querySelector("#gameShell .game-content");
    return (
      content &&
      !content.hasAttribute("aria-busy") &&
      !!content.querySelector(".game-xiangqi")
    );
  });
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
}

async function layout(browser) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.route(/^https?:/, (route) => route.abort());
  await launch(page);
  await gameAction(page, "goal4").click();
  await gameAction(page, classics[0].id).click();
  for (const [width, height] of [
    [1689, 1114],
    [1280, 850],
    [778, 924],
    [1280, 480],
    [320, 740],
    [390, 740],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector).getBoundingClientRect().toJSON();
      const content = document.querySelector(".game-content");
      const style = getComputedStyle(content);
      const playStyle = getComputedStyle(
        document.querySelector(".xiangqi-play"),
      );
      return {
        board: rect(".xiangqi-board"),
        stage: rect(".xiangqi-stage"),
        controls: rect(".xiangqi-controls"),
        controlsPadding: parseFloat(
          getComputedStyle(document.querySelector(".xiangqi-controls"))
            .paddingBottom,
        ),
        content: rect(".game-content"),
        gap: parseFloat(playStyle.gap),
        padding: parseFloat(playStyle.paddingLeft),
        title: rect(".xiangqi-level-title"),
        details: [...document.querySelectorAll(".xiangqi-detail")].map((node) =>
          node.getBoundingClientRect().toJSON(),
        ),
        actions: [...document.querySelectorAll(".xiangqi-actions button")]
          .filter((node) => !node.hidden)
          .map((node) => node.getBoundingClientRect().toJSON()),
        available:
          content.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        overflow: content.scrollWidth > content.clientWidth,
      };
    });
    const { board, stage, controls, content, available, gap, padding } = bounds;
    assert(board.width > 0 && board.height > 0);
    assert(Math.abs(board.width / board.height - 0.9) < 0.005);
    assert(!bounds.overflow, `${width}: no horizontal overflow`);
    assert(board.x >= content.x && board.right <= content.right);
    if (available >= 640) {
      assert(controls.x >= board.right, `${width}: controls on right`);
      assert(board.bottom <= content.bottom, `${width}: board fits height`);
      assert(Math.abs(board.width - stage.width) < 2);
      assert(Math.abs(controls.x - board.right - gap) < 2);
      assert(Math.abs(controls.y - board.y) < 2);
      assert(bounds.title.y > board.y);
      assert(
        Math.abs(
          (board.x + controls.right) / 2 - (content.x + content.right) / 2,
        ) < 2,
      );
      assert(board.y >= content.y + padding);
    } else {
      assert(controls.y >= board.bottom, `${width}: controls below board`);
      assert(
        Math.abs(board.width - (available - padding * 2)) < 2,
        JSON.stringify({ width, bounds }),
      );
    }
    assert(bounds.title.bottom <= bounds.details[0].y);
    assert(bounds.details[0].bottom <= bounds.details[1].y);
    assert.equal(bounds.actions.length, 3);
    bounds.actions.forEach((action, index) => {
      assert(Math.abs(action.y - bounds.actions[0].y) < 1);
      if (index) assert(action.x >= bounds.actions[index - 1].right);
    });
    if (available >= 640)
      assert(
        Math.abs(
          bounds.actions[0].bottom - controls.bottom + bounds.controlsPadding,
        ) < 2,
      );
    assert.equal(
      await page.locator(".xiangqi-actions button .ui-icon").count(),
      4,
    );
    assert.equal(await gameAction(page, "hint").count(), 0);
    assert.equal(
      await page.locator(".xiangqi-help, .game-xiangqi .game-title").count(),
      0,
    );
    if (process.env.WORKTIME_XIANGQI_SCREENSHOTS === "1") {
      const directory = path.join(root, "test-results", "xiangqi");
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, `${width}-${height}.png`),
      });
    }
  }
  await page.close();
}

async function resultAnimation(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
  });
  await page.route(/^https?:/, (route) => route.abort());
  const effect = page.locator(".xiangqi-result");
  const action = (name) => gameAction(page, name);
  async function move(code) {
    const [from, to] = rules.decode(code);
    await squareAt(page, from).click();
    await squareAt(page, to).click();
    await page
      .locator(".xiangqi-board[data-replying]")
      .waitFor({ state: "detached" });
  }
  async function seed(id, path) {
    await page.evaluate(
      ({ key, id, path }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            current: id,
            drafts: { [id]: { path } },
            completed: {},
          }),
        );
      },
      { key, id, path },
    );
    await launch(page);
    assert(
      await effect.isHidden(),
      "restoring a position does not replay the effect",
    );
  }
  await launch(page);
  await action(levels[0].id).click();
  await move(firstMove(levels[0].tree));
  assert(await effect.isHidden(), "wait for the last piece to land");
  await effect.waitFor({ state: "visible" });
  assert.equal(await effect.getAttribute("data-result"), "win");
  assert.equal(await effect.getAttribute("aria-hidden"), "true");
  assert.equal(
    await effect.evaluate((el) => getComputedStyle(el).pointerEvents),
    "none",
  );
  await page.waitForTimeout(250);
  const image = effect.locator("img");
  assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0));
  assert((await image.getAttribute("src")).endsWith("win-brush.png"));
  assert(
    (await effect.evaluate(
      (el) => el.getAnimations({ subtree: true }).length,
    )) >= 3,
  );
  if (process.env.WORKTIME_XIANGQI_SCREENSHOTS === "1") {
    const directory = path.join(root, "test-results", "xiangqi");
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, "result-win.png") });
    await effect.evaluate((el) => {
      const animations = el.getAnimations({ subtree: true });
      animations.forEach((animation) => animation.pause());
    });
    for (const time of [180, 550, 1100, 1550]) {
      await effect.evaluate(
        (el, time) =>
          el.getAnimations({ subtree: true }).forEach((animation) => {
            animation.currentTime = Math.min(
              time,
              animation.effect.getComputedTiming().endTime - 1,
            );
          }),
        time,
      );
      await page.screenshot({
        path: path.join(directory, `result-stage-${time}.png`),
      });
    }
  }
  await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
  await effect.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 740 });
  await page.waitForTimeout(100);
  assert(await effect.isHidden());
  await page.setViewportSize({ width: 1280, height: 900 });
  await action("undo").click();
  await move(firstMove(levels[0].tree));
  await effect.waitFor({ state: "visible" });
  await action("restart").click();
  assert(await effect.isHidden());
  assert.equal(
    await effect.evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
  );
  await page.waitForTimeout(200);
  assert(await effect.isHidden(), "cancelled callbacks do not resurface");
  await move(firstMove(levels[0].tree));
  await action("choose").click();
  await page.waitForTimeout(250);
  assert(
    await effect.isHidden(),
    "cancel the pending result during piece movement",
  );
  await seed("xq-07", redDefeat.slice(0, 2));
  await move(redDefeat[2]);
  await effect.waitFor({ state: "visible" });
  assert.equal(await effect.getAttribute("data-result"), "loss");
  if (process.env.WORKTIME_XIANGQI_SCREENSHOTS === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(root, "test-results", "xiangqi", "result-loss.png"),
    });
  }
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert(await effect.isHidden());
  await seed("xq-07", redDefeat);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed("xq-20", []);
  await move(stalemateMove);
  assert.equal(await effect.getAttribute("data-result"), "stalemate");
  assert.equal(
    await effect.locator("img").evaluate((el) => el.getAnimations().length),
    0,
  );
  assert(await effect.locator(".xiangqi-result-wash").isHidden());
  assert(await effect.locator(".xiangqi-result-splash").isHidden());
  await effect.waitFor({ state: "hidden" });
  await action("undo").click();
  assert(await effect.isHidden());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await move(stalemateMove);
  await effect.waitFor({ state: "visible" });
  assert.equal(await effect.getAttribute("data-result"), "stalemate");
  assert((await image.getAttribute("src")).endsWith("stalemate-brush.png"));
  if (process.env.WORKTIME_XIANGQI_SCREENSHOTS === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(root, "test-results", "xiangqi", "result-stalemate.png"),
    });
  }
  const legacy = await page.evaluate(
    ({ key, path }) => {
      const normalized = WorkTimeApp.services.gameArchive.normalize(
        "game-xiangqi",
        {
          version: 1,
          current: "xq-20",
          drafts: { "xq-20": { path } },
          completed: {},
        },
      );
      localStorage.setItem(key, JSON.stringify(normalized));
      return normalized;
    },
    { key, path: [stalemateMove] },
  );
  assert.equal(legacy.current, null);
  assert.deepEqual(legacy.drafts, {});
  assert.deepEqual(legacy.completed["xq-20"].path, [stalemateMove]);
  await launch(page);
  assert(await effect.isHidden());
  assert.equal(
    await page
      .locator('.xiangqi-levels [data-level-status="complete"]')
      .count(),
    1,
  );
  await seed(levels[0].id, []);
  await move(delayedMate[0]);
  await page
    .locator(".xiangqi-board[data-replying]")
    .waitFor({ state: "detached" });
  assert(await effect.isHidden(), "ordinary rounds do not show a result");
  await page.setViewportSize({ width: 320, height: 740 });
  await seed(levels[0].id, []);
  await move(firstMove(levels[0].tree));
  await effect.waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  const mobileBounds = await image.boundingBox();
  assert(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 320);
  if (process.env.WORKTIME_XIANGQI_SCREENSHOTS === "1")
    await page.screenshot({
      path: path.join(root, "test-results", "xiangqi", "result-mobile.png"),
    });
  await action("restart").click();
  assert.equal(
    await effect.evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
  );
  await seed(levels[0].id, []);
  await page.evaluate(() => {
    Element.prototype.animate = undefined;
  });
  await move(firstMove(levels[0].tree));
  assert.equal(await effect.getAttribute("data-result"), "win");
  await effect.waitFor({ state: "hidden" });
  await page.close();
}

async function historicalSave(browser) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.route(/^https?:/, (route) => route.abort());
  const retired = context.WorkTimeApp.data.xiangqiRetired;
  const oldMate = retired.find(({ goal }) => goal === 1);
  const oldBoard = rules.parse(oldMate.position);
  const oldWin = rules
    .legalMoves(oldBoard, true)
    .find(
      (move) => rules.result(rules.apply(oldBoard, move), false) === "mate",
    );
  const current = retired.find(({ goal }) => goal === 2).id;
  const completed = {
    [levels[0].id]: { path: [firstMove(levels[0].tree)] },
    [oldMate.id]: { path: [oldWin] },
  };
  await page.addInitScript(
    ({ key, current, completed }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          current,
          drafts: { [current]: { path: [] } },
          completed,
        }),
      );
    },
    { key, current, completed },
  );
  await launch(page);
  assert(await page.locator(".game-level-page").isVisible());
  assert(await page.locator(".xiangqi-warning").isHidden());
  assert.equal(
    await page
      .locator('.xiangqi-levels [data-level-status="complete"]')
      .count(),
    1,
  );
  await gameAction(page, levels[0].id).click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    key,
  );
  assert.deepEqual(saved.completed, JSON.parse(JSON.stringify(completed)));
  assert.deepEqual(saved.drafts[current], { path: [] });
  await page.close();
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
    await page.clock.fastForward(3100);
  }
  await launch(page);
  await page.clock.install();
  const visibleLevels = page.locator(".xiangqi-levels button:visible");
  assert.equal(
    await page.locator(".game-xiangqi .game-level-categories button").count(),
    7,
  );
  for (const group of [1, 2, 3, 4, 5, 6]) {
    await action("goal" + group).click();
    const entries = levels.filter((level) => groupFor(level) === group);
    const expected = Array.from(
      entries,
      (level) =>
        level.title ?? String(levels.indexOf(level) + 1).padStart(2, "0"),
    );
    assert.deepEqual(await visibleLevels.allTextContents(), expected);
    assert.equal(
      await visibleLevels
        .filter({ has: page.locator('[data-state="complete"]') })
        .count(),
      0,
    );
  }
  await action("goal1").click();
  assert.equal(await visibleLevels.count(), 20);
  assert.equal(await action("goal1").getAttribute("aria-pressed"), "true");
  assert.equal(
    await visibleLevels
      .filter({ has: page.locator('[data-state="complete"]') })
      .count(),
    0,
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
  assert.equal(await action("hint").count(), 0);
  assert.equal(
    await page.locator(".xiangqi-help, .game-xiangqi .game-title").count(),
    0,
  );
  await square(rules.decode(delayedMate[0])[0]).click();
  await square(89).click();
  assert.match(await status.textContent(), /落点不合法/);
  const initial = await boardState();
  await square(rules.decode(delayedMate[0])[1]).click();
  await page.clock.fastForward(3100);
  assert.deepEqual(
    (await saved()).drafts[first.id].path,
    delayedMate.slice(0, 2),
  );
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /红方已走：1 步/,
  );
  const offTrackBoard = await boardState();
  assert.notDeepEqual(offTrackBoard, initial);
  await launch(page);
  assert.deepEqual(await boardState(), offTrackBoard);
  await move(delayedMate[2]);
  assert.match(await status.textContent(), /已通关/);
  assert.match(
    await page.locator(".xiangqi-objective").textContent(),
    /红方已走：2 步/,
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
  await page.clock.fastForward(3100);
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

  const two = levels.find(({ id }) => id === "xq-07");
  await action("goal2").click();
  assert.equal(await visibleLevels.count(), 30);
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
      await action("goal" + groupFor(level)).click();
    await action(level.id).click();
    let node = level.tree;
    while (node) {
      const code = firstMove(node);
      await move(code);
      const defenses = node[1][code];
      node = defenses === null ? null : defenses[rules.reply(defenses)];
    }
    assert.match(await status.textContent(), /已通关/, level.id);
    if (level === levels[79]) {
      await action("next").click();
      assert.match(
        await page.locator(".xiangqi-objective").textContent(),
        new RegExp(classics[0].title),
      );
    }
    if (level === last) assert(!(await action("next").isVisible()));
    await action("choose").click();
  }
  assert.equal(
    await page
      .locator('.xiangqi-levels [data-level-status="complete"]')
      .count(),
    levels.length,
  );
  assert.equal(await action("goal6").getAttribute("aria-pressed"), "true");
  assert.equal(
    await visibleLevels.count(),
    classics.filter((level) => groupFor(level) === 6).length,
  );
  const stalemate = levels.find(({ id }) => id === "xq-20");
  await action("goal3").click();
  await action(stalemate.id).click();
  await move(stalemateMove);
  assert.match(await status.textContent(), /困毙，已通关/);
  assert(await action("next").isVisible());
  assert.equal(
    rules.restore(stalemate, (await saved()).completed[stalemate.id].path)
      .status,
    "won",
  );
  assert.equal((await saved()).drafts[stalemate.id], undefined);
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
  assert.match(await status.textContent(), /红方败北/);
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
    /红方已走：1 步/,
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
  const target = { x: source.x + 12, y: source.y };
  const touch = (type, point) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ ...point, id: 1 }] : [],
    });
  await touch("touchStart", source);
  await touch("touchMove", target);
  assert.equal(await page.locator(".xiangqi-ghost, .is-drop").count(), 0);
  await touch("touchCancel");
  assert.match(await page.locator(".xiangqi-status").textContent(), /轮到红方/);
  await touch("touchStart", source);
  await touch("touchMove", target);
  await touch("touchEnd");
  assert.match(await page.locator(".xiangqi-status").textContent(), /轮到红方/);
  assert.notEqual(
    await squareAt(page, from).locator(".xiangqi-piece").textContent(),
    "",
  );
  await gameAction(page, "restart").tap();
  await squareAt(page, from).tap();
  await squareAt(page, to).tap();
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
  const two = levels.find(({ id }) => id === "xq-07");
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
  for (const point of [target, { x: 2, y: 2 }, await center(page, 89)]) {
    await drag(point);
    assert.equal(
      await page.locator(".xiangqi-ghost, .is-drop, .is-drag-origin").count(),
      0,
    );
    assert.equal(
      await squareAt(page, from)
        .locator(".xiangqi-piece")
        .evaluate((piece) => getComputedStyle(piece).visibility),
      "visible",
    );
    await page.mouse.up();
    assert.deepEqual((await saved()).drafts[first.id].path, []);
    assert.match(await status.textContent(), /轮到红方/);
  }
  assert.equal(
    await squareAt(page, from).evaluate(
      (cell) => getComputedStyle(cell).cursor,
    ),
    "pointer",
  );
  await squareAt(page, from).click();
  assert.equal(await squareAt(page, from).getAttribute("aria-pressed"), "true");
  assert(
    await squareAt(page, to).evaluate((cell) =>
      cell.classList.contains("is-capture"),
    ),
  );
  await squareAt(page, to).click();
  await page.waitForFunction(() =>
    document.querySelector(".xiangqi-status").textContent.includes("已通关"),
  );
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
        const stillLocked = !board.querySelector(".is-selected");
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
  assert.equal(
    await reply.count(),
    1,
    "missing animation API still preserves thinking time",
  );
  await reply.waitFor({ state: "detached" });
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
    await historicalSave(browser);
    await resultAnimation(browser);
    await layout(browser);
    await desktop(browser);
    await mobile(browser);
    await interaction(browser);
    console.log(
      `Xiangqi responsive layout without hints, rules, all ${levels.length} offline puzzles, continuation, keyboard, click/tap-only input, reply animation and storage errors passed.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
