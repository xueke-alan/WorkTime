"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");

async function verifyPacing(page) {
  const results = await page.evaluate(async () => {
    const games = WorkTimeApp.games;
    const original = {
      setTimeout: window.setTimeout,
      clearTimeout: window.clearTimeout,
      now: Object.getOwnPropertyDescriptor(performance, "now"),
      rules: games.rules2048,
      compat: WorkTimeApp.ui.animationCompat,
      session: WorkTimeApp.services.gameArchive.session,
    };
    const results = [];
    try {
      for (const reduced of [false, true]) {
        let now = 0,
          timerId = 0,
          active = 0,
          overlaps = 0;
        const timers = new Map(),
          turns = [],
          durations = [];
        window.setTimeout = (callback, delay = 0) => {
          timers.set(++timerId, { callback, due: now + delay });
          return timerId;
        };
        window.clearTimeout = (id) => timers.delete(id);
        Object.defineProperty(performance, "now", {
          configurable: true,
          value: () => now,
        });
        const flush = async () => {
          for (let i = 0; i < 20; i++) await Promise.resolve();
        };
        const advance = async () => {
          const [id, timer] = [...timers].sort(
            (a, b) => a[1].due - b[1].due,
          )[0];
          timers.delete(id);
          now = timer.due;
          timer.callback();
          await flush();
        };
        WorkTimeApp.ui.animationCompat = {
          preference: () => ({ matches: reduced }),
          listen: () => () => {},
          animate(element, frames, options) {
            durations.push(options.duration);
            active++;
            let finish,
              done = false;
            const finished = new Promise((resolve) => {
              finish = resolve;
            });
            const complete = () => {
              if (!done) {
                done = true;
                active--;
                finish();
              }
            };
            const id = setTimeout(complete, options.duration);
            return {
              finished,
              cancel() {
                clearTimeout(id);
                complete();
              },
            };
          },
        };
        WorkTimeApp.services.gameArchive.session = () => ({
          getItem: () => null,
          setItem() {},
        });
        games.rules2048 = {
          ...original.rules,
          chooseMove() {
            if (active) overlaps++;
            turns.push(now);
            return "left";
          },
          turn(state) {
            return {
              state: { ...state, score: state.score + 4 },
              previous: state,
              paths: [{ from: 0, to: 1, value: 2, merged: false }],
              spawned: 0,
            };
          },
        };
        const container = document.createElement("div");
        container.style.width = "400px";
        document.body.append(container);
        const abort = new AbortController();
        const instance = games
          .get("game-2048")
          .create({ container, signal: abort.signal });
        const click = (action) =>
          container.querySelector(`[data-puzzle-action="${action}"]`).click();
        const nextDelay = () =>
          Math.min(...[...timers.values()].map((timer) => timer.due)) - now;
        try {
          click("ai");
          click("confirm");
          const firstDelay = nextDelay();
          while (turns.length < 105 || active) await advance();
          const intervals = turns.slice(1).map((time, i) => time - turns[i]);
          instance.pause();
          await flush();
          const pausedTimers = timers.size;
          now += 5000;
          instance.resume();
          const resumeDelay = nextDelay();
          // Interrupt an active turn and resume before its promise settles.
          await advance();
          instance.pause();
          instance.resume();
          await flush();
          const resumedTimers = timers.size;
          click("restart");
          await flush();
          const confirmationTimers = timers.size;
          click("cancel");
          const cancelDelay = nextDelay();
          click("restart");
          click("confirm");
          click("ai");
          click("confirm");
          const resetDelay = nextDelay();
          abort.abort();
          instance.dispose();
          await flush();
          results.push({
            reduced,
            firstDelay,
            intervals,
            overlaps,
            durations,
            pausedTimers,
            resumeDelay,
            resumedTimers,
            confirmationTimers,
            cancelDelay,
            resetDelay,
            disposedTimers: timers.size,
          });
        } finally {
          abort.abort();
          instance.dispose();
          container.remove();
        }
      }
    } finally {
      window.setTimeout = original.setTimeout;
      window.clearTimeout = original.clearTimeout;
      if (original.now) Object.defineProperty(performance, "now", original.now);
      else delete performance.now;
      games.rules2048 = original.rules;
      WorkTimeApp.ui.animationCompat = original.compat;
      WorkTimeApp.services.gameArchive.session = original.session;
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.firstDelay, 500);
    result.intervals.forEach((interval, step) => {
      const expected = 100 + 400 * (1 - Math.min(step / 100, 1)) ** 2;
      assert.ok(Math.abs(interval - expected) < 0.001);
    });
    assert.equal(
      result.overlaps,
      0,
      "each turn waits for the previous animation",
    );
    assert.equal(result.pausedTimers, 0);
    assert.equal(result.resumeDelay, 100);
    assert.equal(
      result.resumedTimers,
      1,
      "interrupted turns cannot schedule a second loop",
    );
    assert.equal(result.confirmationTimers, 0);
    assert.equal(result.cancelDelay, 100);
    assert.equal(result.resetDelay, 500);
    assert.equal(result.disposedTimers, 0);
    if (result.reduced) assert.deepEqual(result.durations, []);
    else {
      assert.ok(
        Math.abs(result.durations[0] + result.durations[1] - 375) < 0.001,
      );
      assert.ok(
        Math.abs(result.durations[200] + result.durations[201] - 75) < 0.001,
      );
    }
  }
  console.log(
    "AI acceleration, animation sequencing, reduced motion, pause/resume and timer cleanup verified.",
  );
}

async function verify() {
  if (!process.argv.includes("--ui-only")) {
    const scope = { WorkTimeApp: { games: {} } };
    vm.compileFunction(
      fs.readFileSync(path.join(root, "assets/js/games/2048-rules.js"), "utf8"),
      ["WorkTimeApp"],
    )(scope.WorkTimeApp);
    const rules = scope.WorkTimeApp.games.rules2048;
    const legacySave = {
      version: 1,
      state: rules.create(() => 0),
      best: 0,
      previous: null,
    };
    assert.equal(rules.restore(legacySave).aiBest, 0);
    assert.equal(rules.restore({ ...legacySave, aiBest: 1234 }).aiBest, 1234);
    assert.equal(rules.restore({ ...legacySave, aiBest: -1 }), null);
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let state = rules.create(random),
      steps = 0;
    while (!rules.lost(state.board) && steps < 10000) {
      const before = JSON.stringify(state.board);
      const direction = rules.chooseMove(state.board);
      assert.equal(JSON.stringify(state.board), before);
      assert.ok(direction);
      const result = rules.turn(state, direction, random);
      assert.ok(result, "AI always chooses a legal move");
      state = result.state;
      if (state.board.some((value) => value >= 2048)) state.continued = true;
      steps++;
    }
    assert.ok(rules.lost(state.board), "one complete game reaches its end");
    assert.equal(rules.chooseMove(state.board), null);
    assert.ok(
      Math.max(...state.board) >= 2048,
      "AI reaches 2048 in the regression game",
    );
    console.log(
      `AI completed ${steps} moves: ${state.score} points, max tile ${Math.max(...state.board)}.`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (!["onboardingDialog", "startupPermissionsDialog"].includes(this.id))
          show.call(this);
      };
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const read = () =>
      page.evaluate(() => {
        const value = JSON.parse(
          localStorage.getItem("worktime.games.2048.v1"),
        );
        delete value.aiBest;
        delete value.aiDemo;
        return value;
      });
    await page.evaluate(() => {
      localStorage.setItem(
        "worktime.games.2048.v1",
        JSON.stringify({
          version: 1,
          state: {
            board: [1024, 1024, ...Array(14).fill(0)],
            score: 0,
            continued: false,
          },
          previous: null,
          best: 0,
        }),
      );
    });
    await launchGame(page, "game-2048");
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
    const action = (name) => page.locator(`[data-puzzle-action="${name}"]`);
    await page.keyboard.press("ArrowLeft");
    await action("continue").waitFor({ state: "visible" });
    await action("continue").click();
    const aiBox = await action("ai").boundingBox();
    const boardBox = await page.locator(".puzzle-board").boundingBox();
    assert.ok(
      Math.abs(aiBox.x - boardBox.x) < 1,
      "AI button aligns with the left board edge",
    );
    const saved = await read();
    const best = await page.locator("[data-puzzle-best]").textContent();
    await action("ai").click();
    assert.equal(await page.locator(".puzzle-confirm").isVisible(), true);
    const startLabel = await page.evaluate(() =>
      WorkTimeApp.i18n.t("games.puzzle.aiStart"),
    );
    assert.equal(
      await action("confirm").locator(".button-label").textContent(),
      startLabel,
    );
    assert.equal(
      await action("confirm").getAttribute("aria-label"),
      startLabel,
    );
    assert.equal(
      await page.locator(".game-2048").getAttribute("data-mode"),
      "manual",
    );
    const originalBoard = await page.locator(".puzzle-grid").textContent();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator(".puzzle-grid").textContent(),
      originalBoard,
    );
    assert.deepEqual(
      await read(),
      saved,
      "asking to start AI preserves the player save",
    );
    await action("cancel").click();
    assert.equal(await page.locator(".puzzle-confirm").isVisible(), false);
    assert.equal(
      await page.locator(".puzzle-grid").textContent(),
      originalBoard,
    );
    assert.equal(
      await action("ai").evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    await action("ai").click();
    await action("confirm").click();
    assert.equal(
      await action("ai").locator("use").getAttribute("href"),
      "#ms-robot-2",
    );
    assert.equal(await action("undo").isDisabled(), true);
    const aiBestCard = page.locator("[data-puzzle-ai-best]");
    assert.equal(await aiBestCard.isVisible(), true);
    assert.equal(
      await page.locator(".game-notice .puzzle-status").textContent(),
      await page.evaluate(() => WorkTimeApp.i18n.t("games.puzzle.aiRunning")),
    );
    assert.ok(
      (await aiBestCard.boundingBox()).x <
        (await page.locator("[data-puzzle-best]").boundingBox()).x,
    );
    await page.waitForTimeout(1100);
    assert.deepEqual(await read(), saved, "demo does not write player saves");
    assert.equal(await page.locator("[data-puzzle-best]").textContent(), best);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.2048.v1")).aiBest > 0,
    );
    const aiRecord = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime.games.2048.v1")).aiBest,
    );
    await action("restart").click();
    const values = () =>
      page
        .locator(".puzzle-grid .puzzle-cell")
        .evaluateAll((cells) => cells.map((cell) => cell.dataset.value));
    const frozen = await values();
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(650);
    assert.deepEqual(
      await values(),
      frozen,
      "restart confirmation pauses demo",
    );
    await action("cancel").click();
    await page.waitForTimeout(650);
    assert.notDeepEqual(await values(), frozen, "cancel resumes demo");
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    assert.deepEqual(await read(), saved);
    await launchGame(page, "game-2048");
    assert.equal(
      await page.locator(".game-2048").getAttribute("data-mode"),
      "ai",
    );
    assert.deepEqual(
      await read(),
      saved,
      "reopening preserves the player game underneath the demo",
    );
    assert.equal(await aiBestCard.isVisible(), true);
    assert.ok(
      Number(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("worktime.games.2048.v1")).aiBest,
        ),
      ) >= Number(aiRecord),
    );
    await action("restart").click();
    await action("confirm").click();
    await page.evaluate(() => {
      const rules = WorkTimeApp.games.rules2048;
      const create = rules.create;
      rules.create = () => {
        rules.create = create;
        return {
          board: [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2],
          score: 100,
          continued: false,
        };
      };
    });
    await action("ai").click();
    await action("confirm").click();
    assert.equal(
      await page.locator(".puzzle-overlay").isVisible(),
      false,
      "finished AI demo leaves the final board visible",
    );
    assert.equal(await action("ai").isEnabled(), true);
    assert.ok(Number(await aiBestCard.textContent()) >= Number(aiRecord));
    const finalBoard = await values();
    const finalScore = await page.locator("[data-puzzle-score]").textContent();
    const demoSave = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime.games.2048.v1")).aiDemo,
    );
    assert.ok(demoSave);
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForTimeout(500);
    if (!(await page.locator(".game-2048").isVisible()))
      await launchGame(page, "game-2048");
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
    assert.equal(
      await page.locator(".game-2048").getAttribute("data-mode"),
      "ai",
    );
    assert.deepEqual(
      await values(),
      finalBoard,
      "completed demo survives reopening and page reload",
    );
    assert.equal(
      await page.locator("[data-puzzle-score]").textContent(),
      finalScore,
    );
    assert.equal(await page.locator(".puzzle-overlay").isVisible(), false);
    assert.equal(await aiBestCard.isVisible(), true);
    await action("restart").click();
    await action("cancel").click();
    assert.deepEqual(
      await values(),
      finalBoard,
      "canceling a new game preserves the final demo",
    );
    await action("restart").click();
    await action("confirm").click();
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator(".game-2048").getAttribute("data-mode"),
      "manual",
    );
    assert.equal((await read()).state.score, 0);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("worktime.games.2048.v1")).aiDemo,
      ),
      null,
    );
    assert.equal(await aiBestCard.isVisible(), false);
    await verifyPacing(page);
    assert.deepEqual(errors, []);
    console.log(
      "Offline AI controls, record isolation, confirmation, resume and restart verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
