"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) || root,
);
const copy = (value) => JSON.parse(JSON.stringify(value));
const scope = vm.createContext({
  WorkTimeApp: { games: {}, data: {}, services: {} },
  window: { navigator: {}, crypto: webcrypto },
});
for (const name of ["xiangqi", "gomoku", "sokoban", "lights-out"]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/data", name + ".js"), "utf8"),
    scope,
  );
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "assets/js/games", name + "-rules.js"),
      "utf8",
    ),
    scope,
  );
}
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/services/game-archive.js"),
    "utf8",
  ),
  scope,
);
const app = scope.WorkTimeApp;
const archive = app.services.gameArchive;
const fixtures = ["xiangqi", "gomoku", "sokoban", "lights-out"].map((name) => {
  const id = "game-" + name;
  const rules =
    app.games[
      {
        xiangqi: "xiangqiRules",
        gomoku: "gomokuRules",
        sokoban: "sokobanRules",
        "lights-out": "lightsOutRules",
      }[name]
    ];
  const level =
    name === "sokoban"
      ? app.data.sokoban.levels[0]
      : app.data[
          { xiangqi: "xiangqi", gomoku: "gomoku", "lights-out": "lightsOut" }[
            name
          ]
        ][name === "xiangqi" ? 20 : 0];
  let solution;
  if (name === "xiangqi") {
    solution = [];
    let position = rules.restore(level, []);
    while (position.status === "playing") {
      const move = Number(Object.keys(position.node[1])[0]);
      position = rules.playRound(position, move);
      solution.push(move);
      if (position.defense !== null) solution.push(position.defense);
    }
    assert.equal(position.status, "won");
  } else if (name === "gomoku") {
    let state = rules.create(level);
    for (let n = 0; state.status === "playing" && n < level.goal; n++)
      state = rules.move(
        level,
        state,
        level.vct
          ? level.solution[n * 2]
          : n
            ? rules.winInTwo(state.board)
            : level.center,
      );
    assert.equal(state.status, "won");
    solution = state.path;
  } else solution = level.solution;
  const draftPath = solution.slice(0, -1);
  const save = {
    version: 1,
    current: level.id,
    drafts: { [level.id]: { path: copy(draftPath) } },
    completed: { [level.id]: { path: copy(solution) } },
  };
  if (name === "sokoban" || name === "lights-out") save.chapter = 0;
  if (name === "lights-out") {
    const state = rules.create(level);
    for (const index of draftPath) rules.move(state, index, level.size);
    save.drafts[level.id] = copy(state);
    rules.move(state, solution.at(-1), level.size);
    save.completed[level.id] = copy(state);
  }
  assert(archive.normalize(id, save));
  save.completionHistory = {
    [level.id]: [3, 2, 1].map((n) => ({
      id: "old-" + n,
      finishedAt: new Date(2026, 10, 12, 12, n).getTime(),
      path: copy(solution),
    })),
  };
  assert.equal(
    archive.normalize(id, save).completionHistory[level.id].length,
    3,
  );
  const another = copy(save);
  another.completionHistory[level.id] = [
    {
      id: "new",
      finishedAt: new Date(2026, 10, 14).getTime(),
      path: copy(solution),
    },
  ];
  for (const source of ["local", "incoming"]) {
    const merged = archive.merge(
      id,
      archive.normalize(id, save),
      archive.normalize(id, another),
      source,
    ).value;
    assert.deepEqual(
      copy(merged.completionHistory[level.id].map((r) => r.id)),
      ["new", "old-3", "old-2"],
    );
  }
  const corrupt = copy(save);
  corrupt.completionHistory[level.id][0].path =
    typeof solution === "string" ? "" : [];
  assert.throws(() => archive.normalize(id, corrupt));
  const legacy = copy(save);
  delete legacy.completionHistory;
  assert.equal(archive.normalize(id, legacy).completionHistory, undefined);
  archive.addCompletion(legacy, level.id, solution);
  assert.equal(legacy.completionHistory[level.id].length, 1);
  assert.notEqual(legacy.completionHistory[level.id][0].id, "old-3");
  assert.equal(
    archive.normalize(id, legacy).completionHistory[level.id].length,
    1,
  );
  const historyOnly = copy(save);
  historyOnly.completed = {};
  historyOnly.drafts = {};
  historyOnly.current = null;
  assert(archive.hasContent(id, archive.normalize(id, historyOnly)));
  assert.deepEqual(
    copy(
      archive.merge(
        id,
        archive.normalize(id, save),
        archive.normalize(id, save),
      ).value.completionHistory,
    ),
    copy(save.completionHistory),
    "merging the same records is idempotent",
  );
  return {
    name,
    id,
    level: copy(level),
    solution: copy(solution),
    save: copy(save),
    key: archive.keys[id],
  };
});

async function main() {
  if (process.argv.includes("--unit")) return;
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate((fixtures) => {
      for (const { key, save } of fixtures)
        localStorage.setItem(key, JSON.stringify(save));
    }, fixtures);
    const output = path.join(root, "test-results/completion-history");
    fs.mkdirSync(output, { recursive: true });
    for (const fixture of fixtures) {
      const { name, id, level, solution, key } = fixture;
      await launchGame(page, id);
      const game = page.locator(".game-" + name);
      const panel = game.locator(".game-completion-history");
      const rows = panel.locator(".game-completion-row");
      const action = (value) =>
        panel.locator(`[data-replay-action="${value}"]`);
      const read = () => page.evaluate((key) => localStorage.getItem(key), key);
      const board = game.locator(
        {
          xiangqi: ".xiangqi-board",
          gomoku: ".gomoku-board",
          sokoban: ".sokoban-board",
          "lights-out": ".lights-board",
        }[name],
      );
      const boardState = () =>
        board.evaluate((node) =>
          [
            ...node.querySelectorAll(
              "[data-square], [data-cell], [data-piece]",
            ),
          ].map((cell) => [
            cell.getAttribute("data-square"),
            cell.getAttribute("data-cell"),
            cell.getAttribute("data-piece"),
            cell.getAttribute("data-stone"),
            cell.getAttribute("data-on"),
            cell.getAttribute("style"),
            cell.querySelector(".xiangqi-piece")?.textContent ?? null,
          ]),
        );
      assert.equal(await rows.count(), 3, name);
      assert.match(await rows.first().textContent(), /通关记录-\d+步-20261112/);
      const before = await read();
      const beforeBoard = await boardState();
      await rows.first().locator("button").click();
      await action("play").click();
      assert.equal(await game.getAttribute("data-replaying"), "true");
      assert.equal(
        await panel.locator(".game-replay-progress").textContent(),
        `0 / ${solution.length}`,
      );
      await action("next").click();
      assert.equal(
        await panel.locator(".game-replay-progress").textContent(),
        `1 / ${solution.length}`,
      );
      await action("previous").click();
      assert.equal(
        await panel.locator(".game-replay-progress").textContent(),
        `0 / ${solution.length}`,
      );
      for (let n = 0; n < solution.length; n++) await action("next").click();
      assert(await action("next").isDisabled());
      assert.equal(await read(), before, name + " playback must not save");
      await action("exit").click();
      assert.deepEqual(
        await boardState(),
        beforeBoard,
        name + " restores draft",
      );
      assert.equal(await read(), before);

      const final = solution.at(-1);
      if (name === "xiangqi") {
        const [from, to] = app.games.xiangqiRules.decode(final);
        await game.locator(`[data-square="${from}"]`).click();
        await game.locator(`[data-square="${to}"]`).click();
      } else if (name === "gomoku")
        await game.locator(`[data-square="${final}"]`).click();
      else if (name === "lights-out")
        await game.locator(`[data-cell="${final}"]`).click();
      else {
        await board.focus();
        await page.keyboard.press(
          { l: "ArrowLeft", r: "ArrowRight", u: "ArrowUp", d: "ArrowDown" }[
            final
          ],
        );
      }
      await page.waitForFunction(
        ({ key, level }) =>
          JSON.parse(localStorage.getItem(key)).completionHistory[level].some(
            (record) => !record.id.startsWith("old-"),
          ),
        { key, level: level.id },
      );
      const finished = JSON.parse(await read());
      const transported = await page.evaluate(async (id) => {
        const archive = WorkTimeApp.services.gameArchive;
        // Other fixture games have not loaded their lazy rule modules yet.
        const owner = archive.create(() => ({
          getItem: (key) =>
            key === archive.keys[id] ? localStorage.getItem(key) : null,
        }));
        return (
          await archive.decode(await archive.encode(owner.exportArchive()))
        ).games[id].completionHistory;
      }, id);
      assert.deepEqual(
        transported,
        finished.completionHistory,
        name + " archive round trip",
      );
      assert.equal(finished.completionHistory[level.id].length, 3);
      assert(
        !finished.completionHistory[level.id].some(
          (record) => record.id === "old-1",
        ),
      );
      const localDate = await page.evaluate(() => {
        const d = new Date();
        return (
          String(d.getFullYear()) +
          String(d.getMonth() + 1).padStart(2, "0") +
          String(d.getDate()).padStart(2, "0")
        );
      });
      const steps = ["xiangqi", "gomoku"].includes(name)
        ? Math.ceil(solution.length / 2)
        : solution.length;
      assert.match(
        await rows.first().textContent(),
        new RegExp(`通关记录-${steps}步-${localDate}`),
      );
      await page.screenshot({
        path: path.join(output, name + "-desktop.png"),
        fullPage: true,
      });
      const panelBox = await panel.boundingBox(),
        boardBox = await board.boundingBox();
      assert(
        panelBox.x >= boardBox.x + boardBox.width - 2,
        name + " desktop history right of board",
      );
      await page.setViewportSize({ width: 390, height: 1000 });
      const mobilePanel = await panel.boundingBox(),
        mobileBoard = await board.boundingBox();
      assert(
        mobilePanel.y >= mobileBoard.y + mobileBoard.height - 2,
        name + " mobile history below board",
      );
      await page.screenshot({
        path: path.join(output, name + "-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await rows.first().locator("button").click();
      await page.waitForFunction(
        () => {
          const [index, length] = document
            .querySelector(
              ".game-replay-controls:not([hidden]) .game-replay-progress",
            )
            .textContent.split(" / ")
            .map(Number);
          return index === length;
        },
        null,
        { timeout: solution.length * 700 + 5000 },
      );
      assert.equal(await action("play").textContent(), "播放");
      assert.deepEqual(JSON.parse(await read()), finished);
      await action("play").click();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const hiddenProgress = await panel
        .locator(".game-replay-progress")
        .textContent();
      await page.waitForTimeout(800);
      assert.equal(
        await panel.locator(".game-replay-progress").textContent(),
        hiddenProgress,
      );
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.keyboard.press("Escape");
      assert.equal(await game.getAttribute("data-replaying"), null);
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.waitForTimeout(600);
      assert.equal(
        JSON.parse(await read()).completionHistory[level.id].length,
        3,
      );
      console.log(
        name + ": recording, replay, restore, reload and layout passed",
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
}
main()
  .then(() =>
    console.log(
      "Four-game completion history: validation, retention, merge, offline playback, draft restoration, visibility pause and responsive layouts passed.",
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
