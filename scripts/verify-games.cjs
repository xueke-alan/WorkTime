"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
function verifyRules() {
  const vm = require("node:vm");
  const context = vm.createContext({ WorkTimeApp: { games: {} } });
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js/games/2048-rules.js"), "utf8"),
    context,
  );
  const rules = context.WorkTimeApp.games.rules2048;
  const board = (values) => [...values, ...Array(16 - values.length).fill(0)];
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const initial = board([2, 2, 2, 2]);
  assert.deepEqual(plain(rules.move(initial, "left").board), board([4, 4]));
  assert.equal(rules.move(initial, "left").gain, 8);
  assert.deepEqual(
    plain(rules.move(board([2, 2, 4]), "left").board),
    board([4, 4]),
  );
  assert.deepEqual(
    plain(rules.move(initial, "right").board),
    board([0, 0, 4, 4]),
  );
  const vertical = board([2, 0, 0, 0, 2, 0, 0, 0, 4]);
  assert.deepEqual(
    plain(rules.move(vertical, "up").board),
    board([4, 0, 0, 0, 4]),
  );
  assert.deepEqual(
    plain(rules.move(vertical, "down").board),
    board([0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 4]),
  );
  assert.deepEqual(
    initial,
    board([2, 2, 2, 2]),
    "moves never mutate their input",
  );
  assert.equal(rules.create(() => 0).board.filter(Boolean).length, 2);
  assert.equal(rules.spawn(Array(16).fill(0), () => 0.9).board[14], 4);
  assert.equal(rules.spawn(Array(16).fill(0), () => 0.89).board[14], 2);
  const state = { board: board([2, 4]), score: 12, continued: false };
  assert.equal(
    rules.turn(state, "left", () => {
      throw Error("No spawn for no-op");
    }),
    null,
  );
  const turn = rules.turn({ ...state, board: initial }, "left", () => 0);
  assert.equal(turn.state.score, 20);
  assert.deepEqual(plain(turn.previous.board), initial);
  assert.equal(turn.state.board.filter(Boolean).length, 3);
  const loss = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(rules.lost(loss), true);
  assert.equal(rules.lost(board([2, 4])), false);
  assert.equal(rules.lost([4, ...loss.slice(1)]), false);
  const victory = rules.turn(
    { ...state, board: board([1024, 1024]) },
    "left",
    () => 0,
  ).state;
  assert.equal(rules.won(victory), true);
  assert.equal(rules.turn(victory, "right"), null);
  victory.continued = true;
  assert.equal(rules.won(victory), false);
  assert.ok(rules.turn(victory, "right", () => 0));
  const save = { version: 1, state, previous: turn.previous, best: 100 };
  assert.ok(rules.restore(save));
  for (const invalid of [
    null,
    { ...save, version: 2 },
    { ...save, best: -1 },
    { ...save, state: { ...state, board: board([3, 2]) } },
    { ...save, state: { ...state, score: Infinity } },
    { ...save, previous: {} },
    { ...save, state: { ...state, board: [2] } },
  ])
    assert.equal(rules.restore(invalid), null);
  console.log(
    "2048 pure rules, scoring, random spawning, victory, loss and save validation verified.",
  );
}
async function verifyPuzzle(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await ready(page);
  const initial = [2, 2, 4, 0, ...Array(12).fill(0)];
  const seed = async (
    board = initial,
    score = 0,
    previous = null,
    continued = false,
  ) => {
    if (
      (await page.locator("#gameShell").getAttribute("data-state")) !== "closed"
    ) {
      await page.locator("#gameExitButton").click();
      await state(page, "closed");
    }
    await page.evaluate(
      (save) =>
        localStorage.setItem("worktime.games.2048.v1", JSON.stringify(save)),
      { version: 1, state: { board, score, continued }, previous, best: 100 },
    );
    await enter(page);
  };
  const read = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("worktime.games.2048.v1")),
    );
  const action = (name) => page.locator(`[data-puzzle-action="${name}"]`);
  const values = () =>
    page
      .locator(".puzzle-grid .puzzle-cell")
      .evaluateAll((cells) => cells.map((cell) => Number(cell.dataset.value)));
  await seed();
  const stableBoard = await page.locator(".puzzle-board").boundingBox();
  assert.equal(await page.locator(".game-2048 .ui-button").count(), 0);
  assert.equal(await page.locator(".game-2048 [data-game-help]").count(), 0);
  assert.equal(await page.locator(".game-2048 .game-help-screen").count(), 0);
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    stableBoard,
  );
  await action("restart").click();
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    stableBoard,
    "confirmation overlays the board without reflow",
  );
  await page.locator(".puzzle-confirm").screenshot({
    path: path.join(root, "test-results/games/confirmation.png"),
  });
  await action("cancel").click();
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    stableBoard,
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal((await read()).state.score, 4);
  assert.deepEqual((await read()).previous.board, initial);
  assert.equal((await values()).filter(Boolean).length, 3);
  await action("undo").click();
  assert.deepEqual(await values(), initial);
  assert.equal((await read()).best, 100);
  assert.equal(await action("undo").isDisabled(), true);
  assert.equal(
    await page
      .locator(".puzzle-board")
      .evaluate((board) => document.activeElement === board),
    true,
    "undo returns keyboard focus to the board",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal((await read()).state.score, 4);
  assert.deepEqual(
    (await read()).previous.board,
    initial,
    "direction keys work immediately after undo without clicking the board",
  );
  await seed([2, 4, ...Array(14).fill(0)]);
  const unchanged = await read();
  await page.keyboard.press("a");
  assert.deepEqual(await read(), unchanged);
  await page.keyboard.press("d");
  assert.ok((await read()).previous);
  const afterMove = await read();
  await page.keyboard.press("Escape");
  await page.locator('#gameShell [data-game="game-2048"]').click();
  assert.deepEqual(
    await read(),
    afterMove,
    "menu round trip preserves undo and board",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await enter(page);
  assert.deepEqual(await values(), afterMove.state.board);
  await action("undo").click();
  assert.deepEqual(await values(), unchanged.state.board);
  await seed();
  await page.keyboard.press("ArrowRight");
  assert.ok((await read()).previous);
  await seed();
  const touchBox = await page.locator(".puzzle-board").boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + 30, y: touchBox.y + 50 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchBox.x + 130, y: touchBox.y + 50 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  assert.ok((await read()).previous, "swipe performs a move");
  await seed();
  const box = await page.locator(".puzzle-board").boundingBox();
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 50);
  await page.mouse.up();
  assert.ok((await read()).previous, "captured pointer performs a move");
  const saved = await read();
  await action("restart").click();
  assert.equal(await page.locator(".puzzle-confirm").isVisible(), true);
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual(await read(), saved, "confirmation blocks moves");
  await action("cancel").click();
  assert.deepEqual(await read(), saved);
  await action("restart").click();
  await action("confirm").click();
  assert.equal((await values()).filter(Boolean).length, 2);
  assert.equal((await read()).state.score, 0);
  assert.equal((await read()).best, 100);
  await seed([1024, 1024, ...Array(14).fill(0)]);
  const beforeVictory = await page.locator(".puzzle-board").boundingBox();
  await page.keyboard.press("ArrowLeft");
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    beforeVictory,
    "victory does not move the board",
  );
  assert.equal(await action("continue").isVisible(), true);
  await page.locator(".puzzle-overlay").screenshot({
    path: path.join(root, "test-results/games/won.png"),
  });
  const victory = await read();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await read(), victory);
  await action("continue").click();
  assert.equal((await read()).state.continued, true);
  await action("undo").click();
  assert.equal((await read()).state.continued, false);
  assert.equal((await read()).best, 2048);
  const loss = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  await seed(loss, 20, { board: initial, score: 0, continued: false });
  assert.equal(await page.locator(".puzzle-overlay").isVisible(), true);
  assert.equal(await action("continue").isVisible(), false);
  await page.locator(".puzzle-overlay").screenshot({
    path: path.join(root, "test-results/games/lost.png"),
  });
  await action("undo").click();
  assert.deepEqual(await values(), initial);
  const beforeLargeScore = await page.locator(".puzzle-board").boundingBox();
  await seed(initial, 999999999999);
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    beforeLargeScore,
    "large scores stay inside fixed counters",
  );
  await page.locator("#gameExitButton").click();
  await state(page, "closed");
  await page.evaluate(() =>
    localStorage.setItem("worktime.games.2048.v1", "{broken"),
  );
  await enter(page);
  assert.equal((await values()).filter(Boolean).length, 2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const beforePause = await read();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await read(), beforePause);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await seed();
  const beforeSlide = await page.locator(".puzzle-board").boundingBox();
  await page.keyboard.press("ArrowRight");
  assert.ok(await page.locator(".puzzle-ghost").count());
  assert.equal(
    await page
      .locator(".puzzle-board")
      .evaluate((board) => board.getAnimations().length),
    0,
    "the board itself does not animate",
  );
  assert.deepEqual(
    await page.locator(".puzzle-board").boundingBox(),
    beforeSlide,
  );
  const beforeNextTurn = await read();
  await page.keyboard.press("ArrowDown");
  assert.notDeepEqual(
    await read(),
    beforeNextTurn,
    "consecutive turns update immediately",
  );
  await page.waitForFunction(() => !document.querySelector(".puzzle-ghost"));
  assert.equal(await page.locator(".puzzle-ghost").count(), 0);
  await page.keyboard.press("ArrowDown");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".puzzle-ghost"));
  assert.equal(await page.locator(".puzzle-ghost").count(), 0);
  assert.equal(await action("undo").isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".puzzle-board").screenshot({
    path: path.join(root, "test-results/games/board-mobile.png"),
  });
  assert.equal(
    await page
      .locator(".game-2048")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  );
  assert.deepEqual(errors, []);
  await context.close();
  const blockedContext = await browser.newContext({ reducedMotion: "reduce" });
  const blocked = await blockedContext.newPage();
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = function () {
      throw Error("Storage unavailable");
    };
    Storage.prototype.setItem = function () {
      throw Error("Storage unavailable");
    };
  });
  await blocked.route(/^https?:/, (route) => route.abort());
  await ready(blocked);
  await enter(blocked);
  assert.equal(await blocked.locator(".puzzle-save-warning").isVisible(), true);
  for (const direction of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"])
    await blocked.keyboard.press(direction);
  assert.equal(
    await blocked.locator('[data-puzzle-action="undo"]').isEnabled(),
    true,
  );
  await blockedContext.close();
  console.log(
    "2048 keyboard, pointer, buttons, undo, persistence, victory, restart, corruption, pause and unavailable storage verified.",
  );
}
async function ready(page) {
  await page.goto(pathToFileURL(entry).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function state(page, value) {
  await page.waitForFunction(
    (value) => document.getElementById("gameShell").dataset.state === value,
    value,
  );
}
async function sampleMotion(page, moments) {
  return page.evaluate((moments) => {
    const workspace = document.querySelector(".workspace");
    const targets = {
      left: workspace.querySelector(".summary-sidebar"),
      right: workspace.querySelector(".editor"),
      center: workspace.querySelector("section.panel"),
      shell: document.getElementById("gameShell"),
      surface: workspace.querySelector(".game-surface"),
      toolbar: workspace.querySelector(".game-toolbar"),
      content: workspace.querySelector(".game-content"),
    };
    const running = Object.entries(targets).flatMap(([target, element]) =>
      element.getAnimations().map((animation) => ({
        target,
        animation,
        time: animation.currentTime,
      })),
    );
    const read = (element) => {
      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(
        style.transform === "none" ? undefined : style.transform,
      );
      return {
        opacity: Number(style.opacity),
        x: matrix.m41,
        y: matrix.m42,
        scaleX: matrix.m11,
        scaleY: matrix.m22,
        clip: style.clipPath,
      };
    };
    const timing = running.map(({ target, animation }) => ({
      target,
      start: animation.startTime,
      ...animation.effect.getTiming(),
    }));
    running.forEach(({ animation }) => animation.pause());
    const samples = moments.map((at) => {
      running.forEach(({ animation }) => (animation.currentTime = at));
      return {
        at,
        ...Object.fromEntries(
          Object.entries(targets).map(([key, element]) => [key, read(element)]),
        ),
      };
    });
    for (const { animation, time } of running) {
      animation.currentTime = time;
      animation.play();
    }
    return { timing, samples };
  }, moments);
}
function assertMotion(result, opening) {
  const { timing, samples } = result;
  assert.equal(timing.length, 10);
  assert.equal(
    new Set(timing.map((track) => track.start)).size,
    1,
    "one timeline epoch for all tracks",
  );
  for (const sample of samples) {
    assert.equal(
      sample.shell.opacity,
      1,
      "shell must not multiply foreground opacity",
    );
    assert.equal(sample.content.scaleX, 1);
    assert.equal(sample.content.scaleY, 1);
    assert.ok(sample.left.x <= 0 && sample.left.x >= -28);
    assert.ok(sample.right.x >= 0 && sample.right.x <= 28);
  }
  if (opening) {
    const [early, middle, late, end] = samples;
    assert.ok(
      early.center.opacity > 0 && early.center.opacity < early.left.opacity,
      "center fades before side columns finish",
    );
    assert.equal(early.toolbar.opacity, 0);
    assert.equal(middle.center.opacity, 0);
    assert.ok(middle.toolbar.opacity > 0 && middle.toolbar.opacity < 1);
    assert.equal(middle.content.opacity, 0, "content waits for the expansion");
    assert.equal(late.left.opacity, 0);
    assert.ok(late.content.opacity > 0 && late.content.opacity < 1);
    assert.ok(late.content.y > 0 && late.content.y < 6);
    assert.ok(end.content.opacity > 0.99);
    assert.equal(
      timing.find((track) => track.target === "shell").duration,
      380,
    );
  } else {
    const [early, middle, end] = samples;
    for (const column of [early.left, early.right, early.center])
      assert.ok(
        column.opacity > 0 && column.opacity < 1,
        "original columns return from the start",
      );
    assert.ok(early.surface.opacity > 0 && early.surface.opacity < 1);
    assert.equal(middle.content.opacity, 0);
    assert.equal(middle.toolbar.opacity, 0);
    assert.equal(end.center.opacity, 1);
    assert.equal(end.left.opacity, 1);
    assert.equal(end.surface.opacity, 0);
    assert.equal(
      timing.find((track) => track.target === "shell").duration,
      360,
    );
  }
}
async function enter(page) {
  await page.locator("#date-tab-games").click();
  await page.locator('#gamesPanel [data-game="game-2048"]').click();
  await state(page, "open");
}
async function close(page) {
  await page.locator("#gameExitButton").click();
  await state(page, "closed");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "date-tab-games",
  );
  assert.equal(await page.locator(".workspace > [inert]").count(), 0);
  for (const selector of [
    ".workspace > .panel",
    ".game-shell",
    ".game-surface",
    ".game-toolbar",
    ".game-content",
  ]) {
    const hints = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).willChange),
      );
    assert.ok(
      hints.every((value) => value === "auto"),
      "temporary layer promotion must be released",
    );
  }
  assert.equal(
    await page
      .locator(
        ".workspace.is-game-expanded, .game-origin-muted, .workspace.is-game-transitioning",
      )
      .count(),
    0,
  );
  for (const selector of [
    ".summary-sidebar",
    ".workspace > .editor",
    ".workspace > section.panel",
  ]) {
    assert.equal(
      await page
        .locator(selector)
        .evaluate((element) => getComputedStyle(element).opacity),
      "1",
    );
  }
}
async function verify() {
  verifyRules();
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await ready(page);
    assert.equal(
      await page.locator("#date-tab-games + #date-tab-history").count(),
      1,
    );
    const snapshot = await page.evaluate(() => {
      const input = document.querySelector('#dayForm input[type="text"]');
      if (input) input.value = "09:37";
      return {
        month: document.querySelector(".day[data-date]").dataset.date,
        selected: document.querySelector(".day.selected")?.dataset.date,
        inputId: input?.id,
        inputValue: input?.value,
      };
    });
    await page.locator("#date-tab-games").click();
    const before = await page.locator(".workspace").boundingBox();
    fs.mkdirSync(path.join(root, "test-results/games"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "test-results/games/menu.png"),
    });
    await page.evaluate(() =>
      document.querySelector('#gamesPanel [data-game="game-2048"]').click(),
    );
    assertMotion(await sampleMotion(page, [80, 180, 280, 410]), true);
    await state(page, "open");
    const box = await page.locator("#gameShell").boundingBox();
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(box[key] - before[key]) <= 1,
        key + " aligns with workspace",
      );
    assert.equal(await page.locator(".workspace > [inert]").count(), 3);
    assert.equal(await page.locator(".game-2048").count(), 1);
    const backgroundMeasurements = await page.evaluate(async () => {
      let probes = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.target.closest?.(".game-shell")) continue;
          probes += [...record.addedNodes].filter(
            (node) => node.nodeName === "I" && node.getAttribute("aria-hidden"),
          ).length;
        }
      });
      observer.observe(document.querySelector(".workspace"), {
        childList: true,
        subtree: true,
      });
      const marker = document.createElement("span");
      document.querySelector(".game-content").append(marker);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      observer.disconnect();
      marker.remove();
      return probes;
    });
    assert.equal(
      backgroundMeasurements,
      0,
      "game text changes never measure the background calendar or sidebars",
    );
    await page.screenshot({
      path: path.join(root, "test-results/games/open.png"),
    });
    // Focus cannot escape into the preserved editor or footer.
    assert.equal(await page.locator(".puzzle-directions").count(), 0);
    await page.locator(".puzzle-board").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "gameExitButton",
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.className),
      "puzzle-board",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".game-2048").count(), 0);
    assert.equal(
      await page.locator("#gameShell [data-game]").count(),
      await page.evaluate(() => WorkTimeApp.games.list().length),
    );
    await page.keyboard.press("Escape");
    assertMotion(await sampleMotion(page, [80, 180, 350]), false);
    await page.waitForTimeout(240);
    assert.equal(
      await page
        .locator(".game-content")
        .evaluate((element) => getComputedStyle(element).opacity),
      "0",
    );
    assert.notEqual(
      await page
        .locator("#gameShell")
        .evaluate((element) => getComputedStyle(element).clipPath),
      "none",
    );
    await state(page, "closed");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "date-tab-games",
    );
    assert.equal(
      await page.locator(".day[data-date]").first().getAttribute("data-date"),
      snapshot.month,
    );
    assert.equal(
      await page.locator(".day.selected").getAttribute("data-date"),
      snapshot.selected,
    );
    if (snapshot.inputId)
      assert.equal(
        await page.locator("#" + snapshot.inputId).inputValue(),
        snapshot.inputValue,
      );

    // Independent factories must be aborted and disposed exactly once per mount.
    await page.evaluate(() => {
      window.gameProbe = {
        created: 0,
        disposed: 0,
        aborted: 0,
        sizes: 0,
        paused: 0,
        resumed: 0,
      };
      WorkTimeApp.games.register({
        id: "probe",
        nameKey: "games.puzzleName",
        descriptionKey: "games.puzzleDescription",
        create({ container, signal }) {
          window.gameProbe.created++;
          signal.addEventListener("abort", () => window.gameProbe.aborted++, {
            once: true,
          });
          const button = document.createElement("button");
          button.textContent = "Probe";
          container.append(button);
          return {
            dispose() {
              assertAborted();
              window.gameProbe.disposed++;
              button.remove();
            },
            resize(size) {
              if (size.width > 0 && size.height > 0) window.gameProbe.sizes++;
            },
            pause() {
              window.gameProbe.paused++;
            },
            resume() {
              window.gameProbe.resumed++;
            },
          };
          function assertAborted() {
            if (!signal.aborted) throw Error("Dispose before abort");
          }
        },
      });
      WorkTimeApp.i18n.setLanguage("en");
    });
    await page.locator('#gamesPanel [data-game="probe"]').click();
    await state(page, "open");
    assert.equal(
      await page.evaluate(() => {
        const before = window.gameProbe.sizes;
        window.dispatchEvent(new Event("resize"));
        return window.gameProbe.sizes - before;
      }),
      0,
      "unchanged viewport dimensions do not resize the game again",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
    });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.keyboard.press("Escape");
    await page.locator('#gameShell [data-game="probe"]').click();
    await close(page);
    const probe = await page.evaluate(() => window.gameProbe);
    assert.equal(probe.created, 2);
    assert.equal(probe.disposed, 2);
    assert.equal(probe.aborted, 2);
    assert.ok(probe.sizes > 0 && probe.paused > 0 && probe.resumed > 0);
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(await page.locator("#date-tab-games").count(), 1);
      assert.equal(
        await page.locator("#date-tab-games").getAttribute("aria-selected"),
        "true",
      );
      await enter(page);
      assert.equal(
        await page.locator("#gameTitle").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("games.puzzleName")),
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
      assert.equal(await page.locator(".game-2048 h2").count(), 0);
      await close(page);
    }
    // Cancel transitions through both exit and resizing; repeated clicks cannot mount twice.
    await page.evaluate(() => {
      const button = document.querySelector(
        '#gamesPanel [data-game="game-2048"]',
      );
      button.click();
      button.click();
      document.getElementById("gameExitButton").click();
    });
    await state(page, "closed");
    const reversal = await page.evaluate(() => {
      document.querySelector('#gamesPanel [data-game="game-2048"]').click();
      const targets = [
        ...document.querySelectorAll(
          ".workspace > .panel, .game-shell, .game-surface, .game-toolbar, .game-content",
        ),
      ];
      for (const animation of targets.flatMap((element) =>
        element.getAnimations(),
      )) {
        animation.pause();
        animation.currentTime = 90;
      }
      const snapshot = () =>
        targets.map((element) => {
          const style = getComputedStyle(element);
          return {
            opacity: Number(style.opacity),
            transform: style.transform,
            clip: style.clipPath,
          };
        });
      const before = snapshot();
      document.getElementById("gameExitButton").click();
      const after = snapshot();
      const duration = document
        .getElementById("gameShell")
        .getAnimations()[0]
        .effect.getTiming().duration;
      return { before, after, duration };
    });
    assert.deepEqual(
      reversal.after,
      reversal.before,
      "reversing preserves the exact painted frame across all layers",
    );
    assert.ok(
      reversal.duration > 0 && reversal.duration < 360,
      "partial expansion returns over the remaining distance",
    );
    await state(page, "closed");
    await page.evaluate(() => {
      document.querySelector('#gamesPanel [data-game="game-2048"]').click();
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await state(page, "open");
    assert.equal(
      await page.locator(".workspace.is-game-transitioning").count(),
      0,
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await close(page);
    await page.evaluate(() =>
      document.querySelector('#gamesPanel [data-game="game-2048"]').click(),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await state(page, "open");
    await page.evaluate(() =>
      document.getElementById("gameExitButton").click(),
    );
    await page.setViewportSize({ width: 1500, height: 900 });
    await state(page, "closed");
    assert.equal(
      await page.locator(".workspace.is-game-transitioning").count(),
      0,
    );
    await page.evaluate(() =>
      document.querySelector('#gamesPanel [data-game="game-2048"]').click(),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await state(page, "open");
    assert.equal(
      await page.locator(".workspace.is-game-transitioning").count(),
      0,
    );
    await close(page);
    await enter(page);
    assert.equal(
      await page
        .locator("#gameShell")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
      0,
    );
    await close(page);
    for (const width of [1000, 820, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await enter(page);
      const compact = await page.locator("#gameShell").boundingBox();
      assert.ok(compact.x >= 0 && compact.x + compact.width <= width + 1);
      assert.ok(compact.y >= 0 && compact.y + compact.height <= 845);
      const exitBox = await page.locator("#gameExitButton").boundingBox();
      assert.ok(exitBox.y >= 0 && exitBox.y + exitBox.height <= 844);
      if (width === 390)
        await page.screenshot({
          path: path.join(root, "test-results/games/mobile.png"),
        });
      await close(page);
    }
    // No optional animation API must still reach the final state.
    await page.evaluate(() => (Element.prototype.animate = undefined));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await enter(page);
    await close(page);
    // A failed factory must release its signal and keep navigation usable,
    // including after a language change.
    await page.evaluate(() => {
      WorkTimeApp.games.register({
        id: "broken",
        nameKey: "games.puzzleName",
        descriptionKey: "games.puzzleDescription",
        create({ signal }) {
          signal.addEventListener(
            "abort",
            () => (window.brokenAborted = true),
            { once: true },
          );
          throw Error("Expected test factory failure");
        },
      });
      WorkTimeApp.i18n.setLanguage("zh-CN");
    });
    await page.locator('#gamesPanel [data-game="broken"]').click();
    await state(page, "open");
    assert.equal(await page.evaluate(() => window.brokenAborted), true);
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
    assert.equal(await page.locator("#gameShell [role=alert]").count(), 1);
    assert.equal(await page.locator("#gameExitButton").isEnabled(), true);
    await page.locator("#gameExitButton").click();
    await state(page, "closed");
    await page.locator('#gamesPanel [data-game="probe"]').click();
    await state(page, "open");
    const priorDisposals = await page.evaluate(() => window.gameProbe.disposed);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(await page.locator("#gameShell").count(), 0);
    assert.equal(await page.locator(".workspace > [inert]").count(), 0);
    assert.equal(
      await page.evaluate(() => window.gameProbe.disposed),
      priorDisposals + 1,
    );
    assert.deepEqual(errors, []);
    await context.close();
    await verifyPuzzle(browser);
    console.log(
      "Game navigation, shell geometry, drafts, focus, lifecycle cleanup, six languages, interrupted transitions, reduced motion, mobile and offline loading verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
