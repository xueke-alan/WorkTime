"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const site = path.resolve(process.argv[2] ?? root);

function verifyClock() {
  let now = 0,
    random = 0,
    sequence = 0;
  const timers = new Map();
  const context = vm.createContext({
    WorkTimeApp: { games: {} },
    performance: { now: () => now },
    Math: { random: () => random },
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js/games/ui.js"), "utf8"),
    context,
  );
  const create = context.WorkTimeApp.games.createThinkTurn;
  function advance(time) {
    now += time;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
  }
  for (const [options, minimum, maximum] of [
    [{ simple: true, advanced: true }, 600, 900],
    [{}, 800, 1300],
    [{ advanced: true }, 1000, 1600],
  ]) {
    for (const [sample, duration] of [
      [0, minimum],
      [0.5, (minimum + maximum) / 2],
      [1, maximum],
    ]) {
      random = sample;
      let calls = 0;
      const turn = create(options);
      advance(200); // Search time counts toward the total.
      turn.wait(() => calls++);
      advance(duration - 201);
      assert.equal(calls, 0);
      advance(1);
      assert.equal(calls, 1);
      advance(5000);
      assert.equal(calls, 1);
    }
  }
  random = 0;
  let calls = 0;
  const slow = create();
  advance(4000);
  slow.wait(() => calls++);
  assert.equal(calls, 1, "slow searches receive no extra delay");
  const suspended = create({ simple: true });
  suspended.wait(() => calls++);
  advance(500);
  suspended.pause();
  advance(5000);
  assert.equal(calls, 1);
  suspended.resume();
  advance(599);
  assert.equal(calls, 1);
  advance(1);
  assert.equal(calls, 2, "resume starts a fresh thinking interval");
  const cancelled = create();
  cancelled.wait(() => calls++);
  cancelled.cancel();
  cancelled.resume();
  advance(5000);
  assert.equal(calls, 2);
  assert.equal(timers.size, 0);
}

async function verifyGames(browser) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      const result = show.apply(this, args);
      if (this.id === "onboardingDialog") this.close();
      return result;
    };
  });
  await page.goto(pathToFileURL(path.join(site, "index.html")).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
  await page.evaluate(async () => {
    await WorkTimeApp.i18n.setLanguage("zh-CN");
    await Promise.all([
      WorkTimeApp.games.load("game-gomoku"),
      WorkTimeApp.games.load("game-xiangqi"),
    ]);
    Math.random = () => 0;
    window.aiThinkingTest = {
      instance: null,
      controller: null,
      mount: null,
      delay: 0,
      realWorker: window.Worker,
      realEngineFactory: WorkTimeApp.games.createXiangqiEngine,
    };
    // Deterministic search results let these checks isolate presentation timing.
    window.Worker = class {
      postMessage([board]) {
        setTimeout(
          () => this.onmessage?.({ data: board[112] ? board.indexOf(0) : 112 }),
          window.aiThinkingTest.delay,
        );
      }
      terminate() {} // Deliberately deliver stale replies to exercise cancellation.
    };
    WorkTimeApp.games.createXiangqiEngine = () => ({
      load: () => Promise.resolve(),
      search(fen) {
        const rules = WorkTimeApp.games.xiangqiRules;
        const [pieces, side] = fen.split(" ");
        const board = pieces
          .replaceAll("/", "")
          .replace(/\d/g, (n) => ".".repeat(Number(n)))
          .replace(/[nbNB]/g, (p) => ({ n: "h", b: "e", N: "H", B: "E" })[p]);
        const moves = rules.legalMoves(board, side === "w");
        const move = window.aiThinkingTest.preferCaptures
          ? (moves.find((move) => board[rules.decode(move)[1]] !== ".") ??
            moves[0])
          : moves[0];
        const [from, to] = rules.decode(move);
        window.aiThinkingTest.lastBoard = board;
        window.aiThinkingTest.lastMove = rules.encode(from, to);
        const square = (p) =>
          String.fromCharCode(97 + (p % 9)) + (9 - Math.floor(p / 9));
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(square(from) + square(to)),
            window.aiThinkingTest.delay,
          ),
        );
      },
      dispose() {},
    });
  });
  await page.clock.install({ time: new Date("2026-11-10T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-10T00:00:01Z"));
  async function open(game, puzzle = false) {
    await page.evaluate(
      ({ game, puzzle }) => {
        const test = window.aiThinkingTest;
        test.controller?.abort();
        test.instance?.dispose();
        test.mount?.remove();
        test.controller = new AbortController();
        test.mount = document.createElement("div");
        test.mount.className = "game-content";
        document.body.append(test.mount);
        test.mount.style.cssText =
          "position:fixed;inset:0;background:white;z-index:9999;overflow:auto";
        const key = WorkTimeApp.services.gameArchive.keys["game-" + game];
        localStorage.removeItem(key);
        test.instance = WorkTimeApp.games
          .list()
          .find(({ id }) => id === "game-" + game)
          .create({ container: test.mount, signal: test.controller.signal });
        if (puzzle) {
          const level =
            game === "gomoku"
              ? WorkTimeApp.data.gomoku[0]
              : WorkTimeApp.data.xiangqi.find(({ id }) => id === "xq-07");
          if (game === "xiangqi")
            test.mount.querySelector('[data-xiangqi-action="goal2"]').click();
          test.mount
            .querySelector(`[data-${game}-action="${level.id}"]`)
            .click();
          test.level = level;
        } else
          test.mount
            .querySelector(
              `[data-${game}-action="${game === "gomoku" ? "ai" : "versus"}"]`,
            )
            .click();
      },
      { game, puzzle },
    );
  }
  const action = (game, name) =>
    page.evaluate(
      ({ game, name }) =>
        window.aiThinkingTest.mount
          .querySelector(`[data-${game}-action="${name}"]`)
          .click(),
      { game, name },
    );
  const plies = (game) =>
    page.evaluate((game) => {
      const mount = window.aiThinkingTest.mount;
      return game === "xiangqi"
        ? Number(mount.firstElementChild.dataset.plies)
        : mount.querySelectorAll('.gomoku-cell:not([data-stone="0"])').length;
    }, game);
  const replying = (game) =>
    page.evaluate(
      (game) =>
        window.aiThinkingTest.mount
          .querySelector(`.${game}-board`)
          .hasAttribute("data-replying"),
      game,
    );
  const humanMove = (game) =>
    page.evaluate((game) => {
      const test = window.aiThinkingTest;
      if (game === "gomoku")
        test.mount.querySelector('.gomoku-cell[data-stone="0"]').click();
      else {
        const rules = WorkTimeApp.games.xiangqiRules;
        const board = rules.apply(test.lastBoard, test.lastMove);
        for (const square of rules.decode(rules.legalMoves(board, false)[0]))
          test.mount.querySelector(`[data-square="${square}"]`).click();
      }
    }, game);
  for (const game of ["gomoku", "xiangqi"]) {
    for (const difficulty of ["normal", "hard", "master"]) {
      await open(game);
      await action(game, "difficulty-" + difficulty);
      await action(game, game === "gomoku" ? "start-red" : "start-black");
      await page.clock.runFor(1); // Resolve the deterministic worker/search.
      assert.equal(await plies(game), 0);
      assert(await replying(game));
      assert.match(
        await page.locator(`.${game}-status`).textContent(),
        game === "gomoku" ? /黑方思考/ : /红方思考/,
      );
      await page.clock.runFor(598);
      assert.equal(await plies(game), 0, game + " must not move instantly");
      await page.clock.runFor(2);
      assert.equal(
        await plies(game),
        1,
        game + " opening prefers the simple range",
      );
      await humanMove(game);
      assert.equal(await plies(game), 2);
      await page.clock.runFor(601);
      assert.equal(await plies(game), 3);
      await humanMove(game);
      assert.equal(await plies(game), 4);
      const duration = difficulty === "normal" ? 800 : 1000;
      await page.clock.runFor(duration - 1);
      assert.equal(
        await plies(game),
        4,
        "non-opening moves use the chosen difficulty range",
      );
      await page.clock.runFor(2);
      assert.equal(await plies(game), 5);
      await humanMove(game);
      assert.equal(await plies(game), 6);
      await action(game, "undo");
      assert.equal(await plies(game), 5);
      await page.clock.runFor(4000);
      assert.equal(await plies(game), 5, "undo cancels a pending AI reply");
      await humanMove(game);
      await action(game, "restart");
      await page.evaluate(() =>
        window.aiThinkingTest.mount
          .querySelector('[data-game-restart="new"]')
          .click(),
      );
      assert.equal(await plies(game), 0);
      await page.clock.runFor(601);
      assert.equal(
        await plies(game),
        1,
        "restart only applies the new opening",
      );
    }
    await open(game);
    await action(game, game === "gomoku" ? "start-red" : "start-black");
    await page.clock.runFor(200);
    await page.evaluate(() => window.aiThinkingTest.instance.pause());
    await page.clock.runFor(4000);
    assert.equal(await plies(game), 0);
    await page.evaluate(() => window.aiThinkingTest.instance.resume());
    await page.clock.runFor(599);
    assert.equal(await plies(game), 0);
    await page.clock.runFor(2);
    assert.equal(await plies(game), 1);
    await open(game);
    await page.evaluate(() => {
      window.aiThinkingTest.delay = 4000;
    });
    await action(game, game === "gomoku" ? "start-red" : "start-black");
    await page.clock.runFor(3999);
    assert.equal(await plies(game), 0);
    await page.clock.runFor(2);
    assert.equal(await plies(game), 1, "slow searches do not wait twice");
    await open(game);
    await action(game, game === "gomoku" ? "start-red" : "start-black");
    await action(game, "choose");
    await page.clock.runFor(5000);
    assert.equal(
      await plies(game),
      0,
      "departed searches cannot change the board",
    );
    await page.evaluate(() => {
      window.aiThinkingTest.delay = 0;
    });

    await open(game, true);
    async function puzzleMove() {
      await page.evaluate((game) => {
        const { mount, level } = window.aiThinkingTest;
        if (game === "gomoku")
          mount.querySelector(`[data-square="${level.solution[0]}"]`).click();
        else {
          const code = Number(Object.keys(level.tree[1])[0]);
          for (const square of WorkTimeApp.games.xiangqiRules.decode(code))
            mount.querySelector(`[data-square="${square}"]`).click();
        }
      }, game);
    }
    await puzzleMove();
    assert(
      await replying(game),
      "reduced motion still waits for puzzle replies",
    );
    const before = await page.locator(`.${game}-board`).innerHTML();
    await page.clock.runFor(599);
    assert.equal(await page.locator(`.${game}-board`).innerHTML(), before);
    await page.evaluate(() => window.aiThinkingTest.instance.pause());
    await page.clock.runFor(4000);
    assert(await replying(game));
    await page.evaluate(() => window.aiThinkingTest.instance.resume());
    await page.clock.runFor(599);
    assert(await replying(game));
    await page.clock.runFor(2200);
    assert(!(await replying(game)));
    for (const cancellation of ["undo", "restart", "choose"]) {
      if (cancellation === "undo") await action(game, "undo");
      await puzzleMove();
      assert(await replying(game));
      await action(game, cancellation);
      const cancelledBoard = await page.locator(`.${game}-board`).innerHTML();
      await page.clock.runFor(4000);
      assert(!(await replying(game)));
      assert.equal(
        await page.locator(`.${game}-board`).innerHTML(),
        cancelledBoard,
        "cancelled puzzle replies stay cancelled",
      );
    }
  }
  // Every handicap combination must survive replay, undo and restart on either side.
  await open("xiangqi");
  for (const width of [375, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ko", "ja"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      const buttons = page.locator(".xiangqi-handicaps button");
      assert.equal(await buttons.count(), 3);
      assert(
        await buttons.evaluateAll((controls) =>
          controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return (
              rect.width >= 44 &&
              rect.height >= 44 &&
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              control.scrollWidth <= control.clientWidth
            );
          }),
        ),
        "handicap buttons fit the viewport: " +
          language +
          " " +
          width +
          " " +
          JSON.stringify(
            await buttons.evaluateAll((controls) =>
              controls.map((control) => ({
                rect: control.getBoundingClientRect().toJSON(),
                scroll: control.scrollWidth,
                client: control.clientWidth,
              })),
            ),
          ),
      );
    }
  }
  await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
  const rookHandicap = page.locator('[data-xiangqi-action="handicap-R"]');
  await rookHandicap.focus();
  await page.keyboard.press("Space");
  assert.equal(await rookHandicap.getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Enter");
  assert.equal(await rookHandicap.getAttribute("aria-pressed"), "false");
  const previews = path.join(root, ".cache/xiangqi-handicap");
  fs.mkdirSync(previews, { recursive: true });
  for (const width of [375, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".xiangqi-versus-setup").screenshot({
      path: path.join(previews, `setup-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const boardGlyphs = () =>
    page.locator(".xiangqi-cell .xiangqi-piece").allTextContents();
  async function verifyHandicapCaptures(mask, humanRed) {
    const expected = ["車", "馬", humanRed ? "砲" : "炮"].filter(
      (_, index) => mask & (1 << index),
    );
    assert.deepEqual(
      (
        await page
          .locator(".xiangqi-capture-bottom .xiangqi-captured-piece")
          .allTextContents()
      ).sort(),
      expected.sort(),
      "handicap pieces appear in the human player's capture tray at opening",
    );
    assert.equal(
      await page
        .locator(".xiangqi-capture-top .xiangqi-captured-piece")
        .count(),
      0,
    );
  }
  async function verifyOrientation(humanRed) {
    assert(
      await page.locator(".xiangqi-cell").evaluateAll(
        (cells, humanRed) =>
          cells.every((cell, square) => {
            const display = humanRed ? square : 89 - square;
            const style = getComputedStyle(cell);
            return (
              Number(style.gridRowStart) === Math.floor(display / 9) + 1 &&
              Number(style.gridColumnStart) === (display % 9) + 1 &&
              style.transform === "none"
            );
          }),
        humanRed,
      ),
      "all squares face the player without rotating their glyphs",
    );
    const black = await page.locator('[data-square="4"]').boundingBox();
    const red = await page.locator('[data-square="85"]').boundingBox();
    assert(
      black &&
        red &&
        black.width > 10 &&
        (humanRed ? black.y < red.y : black.y > red.y),
    );
  }
  for (const humanRed of [true, false]) {
    for (let mask = 0; mask < 8; mask++) {
      await open("xiangqi");
      for (const [index, piece] of ["R", "H", "C"].entries()) {
        const control = page.locator(
          `[data-xiangqi-action="handicap-${piece}"]`,
        );
        assert.equal(await control.getAttribute("aria-pressed"), "false");
        if (mask & (1 << index)) {
          // Exercise independent toggling and cancellation before selecting.
          for (let count = 0; count < 3; count++)
            await action("xiangqi", "handicap-" + piece);
          assert.equal(await control.getAttribute("aria-pressed"), "true");
        }
      }
      await action("xiangqi", humanRed ? "start-red" : "start-black");
      const initial = await page.evaluate(
        ({ humanRed, mask }) => {
          const rules = WorkTimeApp.games.xiangqiRules;
          const board = rules
            .parse(
              "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR",
            )
            .split("");
          const squares = humanRed ? [0, 1, 19] : [81, 82, 64];
          squares.forEach((square, index) => {
            if (mask & (1 << index)) board[square] = ".";
          });
          window.aiThinkingTest.handicapBoard = board.join("");
          const glyphs = {
            r: "車",
            h: "馬",
            e: "象",
            a: "士",
            k: "將",
            c: "砲",
            p: "卒",
            R: "車",
            H: "馬",
            E: "相",
            A: "仕",
            K: "帥",
            C: "炮",
            P: "兵",
          };
          return board.map((piece) => glyphs[piece] ?? "");
        },
        { humanRed, mask },
      );
      assert.deepEqual(await boardGlyphs(), initial);
      await verifyHandicapCaptures(mask, humanRed);
      await verifyOrientation(humanRed);
      await page.clock.runFor(2200);
      if (!humanRed)
        assert(
          await page.evaluate(
            () =>
              window.aiThinkingTest.lastBoard ===
              window.aiThinkingTest.handicapBoard,
          ),
          "AI red searches the handicap opening",
        );
      const beforeHuman = await boardGlyphs();
      if (mask === 0) {
        for (const width of [375, 1000]) {
          await page.setViewportSize({ width, height: 900 });
          await verifyOrientation(humanRed);
          await page.locator(".xiangqi-board").screenshot({
            path: path.join(
              previews,
              `board-${humanRed ? "red" : "black"}-${width}.png`,
            ),
          });
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        for (const [key, normal, reversed] of [
          ["ArrowLeft", 39, 41],
          ["ArrowRight", 41, 39],
          ["ArrowUp", 31, 49],
          ["ArrowDown", 49, 31],
        ]) {
          await page.locator('[data-square="40"]').focus();
          await page.keyboard.press(key);
          assert.equal(
            await page.evaluate(() =>
              Number(document.activeElement.dataset.square),
            ),
            humanRed ? normal : reversed,
            "arrow keys follow screen direction",
          );
        }
      }
      const expectedSearch = await page.evaluate((humanRed) => {
        const test = window.aiThinkingTest;
        const rules = WorkTimeApp.games.xiangqiRules;
        const board = humanRed
          ? test.handicapBoard
          : rules.apply(test.lastBoard, test.lastMove);
        const move = rules.legalMoves(board, humanRed)[0];
        for (const square of rules.decode(move))
          test.mount.querySelector(`[data-square="${square}"]`).click();
        return rules.apply(board, move);
      }, humanRed);
      await page.clock.runFor(2200);
      assert.equal(
        await page.evaluate(() => window.aiThinkingTest.lastBoard),
        expectedSearch,
        "engine FEN includes the actual handicap board and human move",
      );
      assert.equal(await plies("xiangqi"), humanRed ? 2 : 3);
      await action("xiangqi", "undo");
      assert.deepEqual(await boardGlyphs(), beforeHuman);
      await verifyOrientation(humanRed);
      await action("xiangqi", "restart");
      await page.locator('[data-game-restart="new"]').click();
      assert.deepEqual(await boardGlyphs(), initial);
      await verifyHandicapCaptures(mask, humanRed);
      await verifyOrientation(humanRed);
      await action("xiangqi", "choose");
      for (const [index, piece] of ["R", "H", "C"].entries())
        assert.equal(
          await page
            .locator(`[data-xiangqi-action="handicap-${piece}"]`)
            .getAttribute("aria-pressed"),
          String(!!(mask & (1 << index))),
          "returning to settings preserves the selection",
        );
      if (!humanRed) {
        await action("xiangqi", "start-red");
        await verifyOrientation(true);
      }
    }
  }
  // Each selected type draws its own side; a restart draws a new opening.
  for (const humanRed of [true, false]) {
    await open("xiangqi");
    for (const piece of ["R", "H", "C"])
      await action("xiangqi", "handicap-" + piece);
    for (const restarted of [false, true]) {
      await page.evaluate((restarted) => {
        const samples = restarted ? [0.9, 0.1, 0.9] : [0.1, 0.9, 0.1];
        Math.random = () => samples.shift() ?? 0;
      }, restarted);
      if (restarted) {
        await action("xiangqi", "restart");
        await page.locator('[data-game-restart="new"]').click();
      } else await action("xiangqi", humanRed ? "start-red" : "start-black");
      const empty = await page
        .locator(".xiangqi-cell")
        .evaluateAll((cells) =>
          cells.flatMap((cell, square) =>
            cell.querySelector(".xiangqi-piece").textContent ? [] : [square],
          ),
        );
      const removed = humanRed
        ? restarted
          ? [8, 1, 25]
          : [0, 7, 19]
        : restarted
          ? [89, 82, 70]
          : [81, 88, 64];
      const retained = humanRed
        ? restarted
          ? [0, 7, 19]
          : [8, 1, 25]
        : restarted
          ? [81, 88, 64]
          : [89, 82, 70];
      assert(removed.every((square) => empty.includes(square)));
      assert(retained.every((square) => !empty.includes(square)));
    }
  }
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  // Capture trays follow the capturer, chronology and visual orientation.
  await open("xiangqi", true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const puzzleTargets = await page.evaluate(() => {
    const test = window.aiThinkingTest;
    const rules = WorkTimeApp.games.xiangqiRules;
    const move = Number(Object.keys(test.level.tree[1])[0]);
    const next = rules.playRound(rules.restore(test.level, []), move);
    test.boardAnimations = [];
    test.originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.parentElement?.classList.contains("xiangqi-cell"))
        test.boardAnimations.push(Number(this.parentElement.dataset.square));
      return test.originalAnimate.apply(this, args);
    };
    for (const square of rules.decode(move))
      test.mount.querySelector(`[data-square="${square}"]`).click();
    return [rules.decode(move)[1], rules.decode(next.defense)[1]];
  });
  assert.deepEqual(
    await page.evaluate(() => window.aiThinkingTest.boardAnimations),
    [puzzleTargets[0]],
    "the human move only animates its own piece, never the pending reply square",
  );
  await page.clock.runFor(2200);
  assert.deepEqual(
    await page.evaluate(() => window.aiThinkingTest.boardAnimations),
    puzzleTargets,
    "each puzzle move animates once in turn order",
  );
  await page.evaluate(() => {
    Element.prototype.animate = window.aiThinkingTest.originalAnimate;
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.aiThinkingTest.captureFlights = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.classList.contains("xiangqi-captured-piece")) {
        const flight = {
          frames,
          options,
          createdAt: performance.now(),
          playedAt: null,
          covered: false,
        };
        window.aiThinkingTest.captureFlights.push(flight);
        const play = animation.play.bind(animation);
        animation.play = () => {
          const rect = this.getBoundingClientRect();
          this.style.pointerEvents = "auto";
          const stack = document.elementsFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          const above = stack.slice(0, stack.indexOf(this));
          flight.covered = above.some((element) =>
            element.classList.contains("xiangqi-cell"),
          );
          this.style.pointerEvents = "";
          flight.playedAt = performance.now();
          return play();
        };
      }
      return animation;
    };
  });
  for (const humanRed of [true, false]) {
    await open("xiangqi");
    await page.evaluate(() => {
      window.aiThinkingTest.preferCaptures = true;
      window.aiThinkingTest.lastBoard = null;
    });
    await action("xiangqi", humanRed ? "start-red" : "start-black");
    assert.equal(await page.locator(".xiangqi-captured-piece").count(), 0);
    await page.clock.runFor(2200);
    for (let round = 0; round < 16; round++) {
      const moved = await page.evaluate((humanRed) => {
        const test = window.aiThinkingTest;
        const rules = WorkTimeApp.games.xiangqiRules;
        const board = test.lastBoard
          ? rules.apply(test.lastBoard, test.lastMove)
          : rules.parse(
              "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR",
            );
        const moves = rules.legalMoves(board, humanRed);
        const move =
          moves.find((move) => board[rules.decode(move)[1]] !== ".") ??
          moves[0];
        if (move === undefined) return false;
        for (const square of rules.decode(move))
          test.mount.querySelector(`[data-square="${square}"]`).click();
        return true;
      }, humanRed);
      if (!moved) break;
      await page.clock.runFor(2200);
    }
    const count = await page.locator(".xiangqi-captured-piece").count();
    assert(count > 0, "actual captures appear in the trays");
    assert(
      await page.locator(".xiangqi-captures").evaluate(
        (rail, humanRed) =>
          [...rail.children].every((tray, side) => {
            const pieces = [...tray.children];
            return pieces.every(
              (piece, index) =>
                piece.classList.contains("is-red") ===
                  (side === 0 ? humanRed : !humanRed) &&
                Number(piece.style.gridColumn) === 3 - (index % 3) &&
                Number(piece.style.gridRow) ===
                  (side === 0
                    ? Math.floor(index / 3) + 1
                    : Math.ceil(pieces.length / 3) - Math.floor(index / 3)),
            );
          }),
        humanRed,
      ),
    );
    for (const width of [375, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      assert(
        await page.locator(".xiangqi-stage").evaluate((stage) => {
          const board = stage.querySelector(".xiangqi-board");
          const cells = [...board.querySelectorAll(".xiangqi-cell")];
          const spacing = cells[0].getBoundingClientRect();
          for (const tray of stage.querySelectorAll(
            ".xiangqi-capture-top, .xiangqi-capture-bottom",
          )) {
            const tokens = [...tray.children];
            for (let index = 0; index < tokens.length; index++) {
              const rect = tokens[index].getBoundingClientRect();
              const rail = tray.getBoundingClientRect();
              if (rect.left < rail.left - 1) return false;
              if (
                index % 3 !== 0 &&
                Math.abs(
                  tokens[index - 1].getBoundingClientRect().left -
                    rect.left -
                    spacing.width,
                ) > 1
              )
                return false;
              if (
                index >= 3 &&
                Math.abs(
                  Math.abs(
                    tokens[index - 3].getBoundingClientRect().top - rect.top,
                  ) - spacing.height,
                ) > 1
              )
                return false;
            }
          }
          const boardTop = Math.min(
            ...cells.map(
              (cell) =>
                cell.querySelector(".xiangqi-piece").getBoundingClientRect()
                  .top,
            ),
          );
          const boardBottom = Math.max(
            ...cells.map(
              (cell) =>
                cell.querySelector(".xiangqi-piece").getBoundingClientRect()
                  .bottom,
            ),
          );
          const top = [
            ...stage.querySelectorAll(".xiangqi-capture-top .xiangqi-piece"),
          ];
          const bottom = [
            ...stage.querySelectorAll(".xiangqi-capture-bottom .xiangqi-piece"),
          ];
          return (
            (!top.length ||
              Math.abs(
                Math.min(
                  ...top.map((piece) => piece.getBoundingClientRect().top),
                ) - boardTop,
              ) < 1) &&
            (!bottom.length ||
              Math.abs(
                Math.max(
                  ...bottom.map(
                    (piece) => piece.getBoundingClientRect().bottom,
                  ),
                ) - boardBottom,
              ) < 1)
          );
        }),
        "capture trays align with the board's first and last rows",
      );
      assert(
        await page.locator(".xiangqi-captured-piece").evaluateAll((tokens) =>
          tokens.every((token) => {
            const original = document.querySelector(
              token.classList.contains("is-red")
                ? ".xiangqi-cell.is-red .xiangqi-piece"
                : ".xiangqi-cell:not(.is-red) .xiangqi-piece",
            );
            const a = getComputedStyle(token),
              b = getComputedStyle(original);
            return (
              Math.abs(
                token.getBoundingClientRect().width -
                  original.getBoundingClientRect().width,
              ) < 0.1 &&
              [
                "fontSize",
                "fontFamily",
                "fontWeight",
                "borderRadius",
                "boxShadow",
                "backgroundColor",
              ].every((key) => a[key] === b[key])
            );
          }),
        ),
        "captured pieces match the board's size, typography and finish",
      );
      await page.locator(".xiangqi-stage").screenshot({
        path: path.join(
          previews,
          `captures-${humanRed ? "red" : "black"}-${width}.png`,
        ),
      });
    }
    await action("xiangqi", "undo");
    assert((await page.locator(".xiangqi-captured-piece").count()) <= count);
    await action("xiangqi", "restart");
    await page.locator('[data-game-restart="new"]').click();
    assert.equal(await page.locator(".xiangqi-captured-piece").count(), 0);
    await page.evaluate(() => {
      window.aiThinkingTest.preferCaptures = false;
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  assert(
    await page.evaluate(
      () =>
        window.aiThinkingTest.captureFlights.length > 0 &&
        window.aiThinkingTest.captureFlights.every(
          ({ frames, options, createdAt, playedAt, covered }) =>
            covered &&
            frames[0].transform.startsWith("translate(") &&
            frames.length === 21 &&
            frames.at(-1).offset === 1 &&
            options.duration >= 340 &&
            options.duration <= 520 &&
            playedAt !== null &&
            playedAt - createdAt >= 239,
        ),
    ),
    "captures animate from their board square to the tray",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Smoke-test the actual offline Pikafish payload after deterministic cases.
  await page.evaluate(() => {
    window.Worker = window.aiThinkingTest.realWorker;
    WorkTimeApp.games.createXiangqiEngine =
      window.aiThinkingTest.realEngineFactory;
  });
  await page.clock.resume();
  for (const difficulty of ["normal", "hard", "master"]) {
    await open("xiangqi");
    await action("xiangqi", "difficulty-" + difficulty);
    await action("xiangqi", "start-black");
    await page.waitForFunction(
      () => window.aiThinkingTest.mount.firstElementChild.dataset.plies === "1",
      null,
      { timeout: 60000 },
    );
    assert(!(await replying("xiangqi")));
  }
  await open("xiangqi");
  await action("xiangqi", "start-red");
  await page.evaluate(() => {
    const rules = WorkTimeApp.games.xiangqiRules;
    const initial = rules.parse(
      "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR",
    );
    const move = rules.legalMoves(initial, true)[0];
    for (const square of rules.decode(move))
      window.aiThinkingTest.mount
        .querySelector(`[data-square="${square}"]`)
        .click();
  });
  assert.equal(await plies("xiangqi"), 1);
  assert.match(
    await page.locator(".xiangqi-status").textContent(),
    /黑方思考|引擎/,
  );
  await page.waitForFunction(
    () => window.aiThinkingTest.mount.firstElementChild.dataset.plies === "2",
    null,
    { timeout: 60000 },
  );
  assert.deepEqual(errors, []);
  await page.close();
}

(async () => {
  verifyClock();
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    await verifyGames(browser);
  } finally {
    await browser.close();
  }
  console.log(
    "AI thinking: timing ranges, search overlap, both games/modes, all difficulties, reduced motion, pause/resume and stale callbacks passed offline.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
