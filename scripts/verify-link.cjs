"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const output = path.join(root, "test-results/link");
const key = "worktime.games.link.v1";
const context = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/link-rules.js"), "utf8"),
  context,
);
const rules = context.WorkTimeApp.games.linkRules;
// Independent geometric oracle: enumerate all single middle rows / columns.
function oracle(board, a, b, cols = 6) {
  if (a === b || !board[a] || board[a] !== board[b]) return false;
  const rows = board.length / cols,
    start = [(a % cols) + 1, Math.floor(a / cols) + 1],
    end = [(b % cols) + 1, Math.floor(b / cols) + 1];
  function segment(p, q) {
    if (p[0] !== q[0] && p[1] !== q[1]) return false;
    const dx = Math.sign(q[0] - p[0]),
      dy = Math.sign(q[1] - p[1]);
    let [x, y] = p;
    for (;;) {
      const i = (y - 1) * cols + x - 1;
      if (
        x > 0 &&
        x <= cols &&
        y > 0 &&
        y <= rows &&
        i !== a &&
        i !== b &&
        board[i]
      )
        return false;
      if (x === q[0] && y === q[1]) return true;
      x += dx;
      y += dy;
    }
  }
  const clear = (points) =>
    points.slice(1).every((p, i) => segment(points[i], p));
  for (let x = 0; x <= cols + 1; x++)
    if (clear([start, [x, start[1]], [x, end[1]], end])) return true;
  for (let y = 0; y <= rows + 1; y++)
    if (clear([start, [start[0], y], [end[0], y], end])) return true;
  return false;
}
function verifyRules() {
  let seed = 47;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let test = 0; test < 60; test++) {
    const board = Array.from({ length: 36 }, () =>
      random() < 0.25 ? 0 : Math.ceil(random() * 4),
    );
    assert.ok(
      board.some(Boolean) && board.includes(0),
      "oracle fixtures contain both occupied and empty tiles",
    );
    for (let a = 0; a < 36; a++)
      for (let b = a + 1; b < 36; b++)
        assert.equal(
          !!rules.route(board, a, b, 6),
          oracle(board, a, b),
          `route ${test}: ${a},${b}`,
        );
  }
  for (let test = 0; test < 120; test++) {
    let board = rules.create(test % 3, random),
      removed = 0;
    const total = board.length,
      cols = rules.size(test % 3).cols;
    assert.equal(total, 240);
    assert.equal(new Set(board).size, 48);
    for (let kind = 1; kind <= 48; kind++) {
      const count = board.filter((value) => value === kind).length;
      assert.ok(count === 4 || count === 6, "balanced pairs of every animal");
    }
    while (board.some(Boolean)) {
      let pair = rules.find(board, cols);
      if (!pair) {
        board = rules.shuffle(board, random, cols);
        pair = rules.find(board, cols);
      }
      assert.ok(pair, "automatic rescue always yields a move");
      const route = pair.path;
      let turns = 0,
        previous = null;
      for (let i = 1; i < route.length; i++) {
        const [x, y] = route[i],
          [px, py] = route[i - 1];
        assert.equal(Math.abs(x - px) + Math.abs(y - py), 1);
        const direction = `${x - px},${y - py}`;
        if (previous && previous !== direction) turns++;
        previous = direction;
        if (
          i < route.length - 1 &&
          x > 0 &&
          x <= cols &&
          y > 0 &&
          y <= board.length / cols
        )
          assert.equal(board[(y - 1) * cols + x - 1], 0);
      }
      assert.ok(turns <= 2);
      board[pair.a] = board[pair.b] = 0;
      removed += 2;
      if (test % 2)
        board = rules.fall(board, cols, rules.directions[(removed / 2) % 4]);
    }
    assert.equal(removed, total);
  }
  for (let test = 0; test < 40; test++) {
    const board = Array.from({ length: 240 }, () =>
      random() < 0.4 ? 0 : Math.ceil(random() * 4),
    );
    for (let sample = 0; sample < 200; sample++) {
      const a = Math.floor(random() * 240),
        b = Math.floor(random() * 240);
      assert.equal(!!rules.route(board, a, b, 20), oracle(board, a, b, 20));
    }
  }
  const state = {
    mode: "quest",
    level: 0,
    cols: rules.size(0).cols,
    board: rules.create(0),
    phase: "playing",
    score: 0,
    remaining: 150000,
    hints: 3,
    shuffles: 2,
  };
  assert.ok(rules.restore(state));
  assert.equal(rules.restore(state).energy, 3);
  const fallExample = [1, 0, 2, 0, 3, 0];
  for (const [direction, expected] of Object.entries({
    down: [0, 0, 0, 1, 3, 2],
    up: [1, 3, 2, 0, 0, 0],
    left: [1, 2, 0, 3, 0, 0],
    right: [0, 1, 2, 0, 0, 3],
  })) {
    assert.deepEqual(
      Array.from(rules.fall(fallExample, 3, direction)),
      expected,
    );
    const plan = rules.fallPlan(fallExample, 3, direction);
    assert.deepEqual(Array.from(plan.board), expected);
    assert.equal(new Set(plan.moves.map(({ from }) => from)).size, 3);
    assert.equal(new Set(plan.moves.map(({ to }) => to)).size, 3);
    for (const { from, to } of plan.moves)
      assert.equal(plan.board[to], fallExample[from]);
  }
  assert.deepEqual(
    Array.from(
      rules.fallPlan([1, 0, 1, 1, 0, 1], 3, "left").moves,
      ({ from, to }) => [from, to],
    ),
    [
      [0, 0],
      [2, 1],
      [3, 3],
      [5, 4],
    ],
    "identical pictures retain stable identities",
  );
  assert.equal(
    rules.routeInfo([
      [1, 1],
      [2, 1],
    ]).base,
    160,
  );
  assert.equal(
    rules.routeInfo([
      [1, 1],
      [2, 1],
      [2, 2],
    ]).base,
    130,
  );
  assert.equal(
    rules.routeInfo([
      [1, 1],
      [1, 0],
      [2, 0],
      [2, 1],
    ]).base,
    140,
  );
  const missionBoard = Array(240).fill(0);
  [1, 1, 2, 2, 3, 3].forEach((value, i) => {
    missionBoard[i] = value;
  });
  missionBoard[20] = missionBoard[21] = 13;
  const mission = rules.restore({
    ...state,
    board: missionBoard,
    remaining: 100000,
    energy: 0,
  });
  assert.ok(rules.match(mission, 0, 1));
  assert.ok(rules.match(mission, 2, 3));
  assert.equal(rules.match(mission, 4, 5).completedMission, true);
  assert.equal(mission.score, 1080);
  assert.equal(mission.remaining, 120000);
  assert.equal(mission.energy, 5);
  assert.equal(mission.target, 1);
  assert.equal(mission.missions, 1);
  assert.equal(mission.targetProgress, 0);
  const beforeSwap = [...mission.board].sort((a, b) => a - b);
  assert.equal(
    rules.swap(mission, 20, 21),
    false,
    "same pictures cannot waste energy",
  );
  const swapping = rules.restore({ ...state, energy: 3 });
  const other = swapping.board.findIndex(
    (value) => value !== swapping.board[0],
  );
  const values = [swapping.board[0], swapping.board[other]];
  assert.equal(rules.swap(swapping, 0, other), true);
  assert.equal(swapping.energy, 0);
  assert.deepEqual(
    [swapping.board[0], swapping.board[other]],
    [values[1], values[0]],
  );
  assert.equal(
    rules.swap(swapping, 0, other),
    false,
    "energy cost is enforced",
  );
  assert.deepEqual(
    [...mission.board].sort((a, b) => a - b),
    beforeSwap,
  );
  const tide = rules.restore({ ...state, mode: "tide" });
  for (let n = 0; n < 8; n++) {
    const pair = rules.find(tide.board, tide.cols);
    if (!pair) tide.board = rules.shuffle(tide.board, random, tide.cols);
    const move = rules.find(tide.board, tide.cols);
    assert.equal(
      rules.match(tide, move.a, move.b).gravity,
      rules.directions[n % 4],
    );
    assert.equal(tide.tideStep, (n + 1) % 4);
    assert.ok(rules.restore(tide), "strategy fields survive reload");
  }
  for (const level of [0, 1, 2]) {
    const legacy = {
      ...state,
      level,
      board: Array.from(
        { length: (6 + level * 2) * 6 },
        (_, i) => (Math.floor(i / 2) % 8) + 1,
      ),
    };
    delete legacy.cols;
    const restored = rules.restore(legacy);
    assert.ok(restored);
    assert.equal(restored.cols, 6);
    assert.deepEqual(Array.from(restored.board), legacy.board);
    assert.ok(
      rules.restore(restored),
      "legacy save remains valid after resaving",
    );
  }
  for (const patch of [
    { score: -1 },
    { level: 3 },
    { cols: 11 },
    { energy: 7 },
    { targetProgress: 3 },
    { tideStep: 4 },
    { remaining: NaN },
    { hints: 4 },
    { phase: "won" },
    { board: [1, 1] },
    { mode: "bad" },
  ])
    assert.equal(rules.restore({ ...state, ...patch }), null);
  console.log(
    "Link rules: path-oracle comparisons, 120 fixed 240-tile clears with gravity/rescue and legacy save validation verified.",
  );
}
async function verifyTideAnimations(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(entry).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  const fixtures = [
    {
      step: 0,
      a: 220,
      b: 221,
      from: 0,
      to: 200,
      cards: [
        [0, 1],
        [1, 1],
        [40, 3],
        [41, 3],
        [220, 2],
        [221, 2],
      ],
    },
    {
      step: 1,
      a: 0,
      b: 20,
      from: 19,
      to: 1,
      cards: [
        [19, 1],
        [39, 1],
        [18, 3],
        [38, 3],
        [0, 2],
        [20, 2],
      ],
    },
    {
      step: 2,
      a: 0,
      b: 1,
      from: 220,
      to: 20,
      cards: [
        [220, 1],
        [221, 1],
        [180, 3],
        [181, 3],
        [0, 2],
        [1, 2],
      ],
    },
    {
      step: 3,
      a: 19,
      b: 39,
      from: 0,
      to: 18,
      cards: [
        [0, 1],
        [20, 1],
        [1, 3],
        [21, 3],
        [19, 2],
        [39, 2],
      ],
    },
  ];
  async function open(fixture = fixtures[0]) {
    await page.evaluate(
      ({ storageKey, fixture }) => {
        const board = Array(240).fill(0);
        fixture.cards.forEach(([index, value]) => {
          board[index] = value;
        });
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: {
              mode: "tide",
              level: 0,
              cols: 20,
              board,
              phase: "playing",
              score: 0,
              remaining: 150000,
              hints: 3,
              shuffles: 2,
              energy: 3,
              target: 0,
              targetProgress: 0,
              tideStep: fixture.step,
              missions: 0,
            },
          }),
        );
      },
      { storageKey: key, fixture },
    );
    await page.locator("#date-tab-games").click();
    await page.locator('#gamesPanel [data-game="game-link"]').click();
    await page
      .locator('#gamesPanel [data-game="game-link"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await page.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "open",
    );
    await page.locator('[data-link-action="primary"]').click();
  }
  async function exit() {
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "closed",
    );
  }
  async function trigger(fixture = fixtures[0]) {
    return page.evaluate(
      ({ fixture, storageKey }) => {
        const tile = (index) =>
          document.querySelector('.link-tile[data-index="' + index + '"]');
        const start = tile(fixture.from).getBoundingClientRect(),
          end = tile(fixture.to).getBoundingClientRect();
        tile(fixture.a).click();
        tile(fixture.b).click();
        return {
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          board: JSON.parse(localStorage.getItem(storageKey)).state.board,
          remaining: JSON.parse(localStorage.getItem(storageKey)).state
            .remaining,
        };
      },
      { fixture, storageKey: key },
    );
  }
  async function moving() {
    await page.waitForFunction(
      () => document.querySelector(".game-link").dataset.motion === "tide",
    );
  }
  async function settled() {
    await page.waitForFunction(
      () => !document.querySelector(".game-link")?.dataset.motion,
    );
    assert.equal(
      await page
        .locator(".link-board")
        .evaluate(
          (board) =>
            board
              .getAnimations({ subtree: true })
              .filter((animation) =>
                animation.effect
                  .getKeyframes()
                  .some((frame) => Object.hasOwn(frame, "transform")),
              ).length,
        ),
      0,
    );
  }
  try {
    for (const fixture of fixtures) {
      await open(fixture);
      const geometry = await trigger(fixture);
      await moving();
      const middle = await page.evaluate((from) => {
        const board = document.querySelector(".link-board");
        const animations = board.getAnimations({ subtree: true });
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration / 2;
        }
        const r = board
          .querySelector('[data-index="' + from + '"]')
          .getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          locked: board.inert,
          moving: animations.filter((animation) =>
            animation.effect
              .getKeyframes()
              .some((frame) => Object.hasOwn(frame, "transform")),
          ).length,
        };
      }, fixture.from);
      assert.ok(middle.locked && middle.moving > 0);
      const axis = geometry.start.x !== geometry.end.x ? "x" : "y",
        other = axis === "x" ? "y" : "x";
      assert.ok(
        middle[axis] > Math.min(geometry.start[axis], geometry.end[axis]) + 0.5,
      );
      assert.ok(
        middle[axis] < Math.max(geometry.start[axis], geometry.end[axis]) - 0.5,
      );
      assert.ok(
        Math.abs(middle[other] - geometry.start[other]) < 1,
        "moves follow one physical axis",
      );
      assert.equal(
        await page.locator('[data-link-action="hint"]').isDisabled(),
        true,
      );
      await page
        .locator(".link-board")
        .evaluate((board) =>
          board
            .getAnimations({ subtree: true })
            .forEach((animation) => animation.play()),
        );
      await settled();
      const remaining = await page.evaluate((storageKey) => {
        document.querySelector('[data-link-action="pause"]').click();
        return JSON.parse(localStorage.getItem(storageKey)).state.remaining;
      }, key);
      assert.ok(
        remaining >= geometry.remaining - 200,
        "movement does not consume thinking time",
      );
      assert.equal(
        await page.evaluate(
          ({ storageKey, to }) =>
            JSON.parse(localStorage.getItem(storageKey)).state.board[to],
          { storageKey: key, to: fixture.to },
        ),
        1,
      );
      assert.equal(await page.locator(".link-tile:enabled").count(), 4);
      await exit();
    }
    for (const action of [
      "pause",
      "resize",
      "reduce",
      "exit",
      "help",
      "language",
    ]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await open();
      const expected = await trigger();
      await moving();
      if (action === "pause")
        await page.locator('[data-link-action="pause"]').click();
      if (action === "resize")
        await page.setViewportSize({ width: 390, height: 844 });
      if (action === "reduce")
        await page.emulateMedia({ reducedMotion: "reduce" });
      if (action === "help")
        await page.locator(".game-link [data-game-help]").click();
      if (action === "language")
        await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
      if (action === "exit") await exit();
      else {
        await settled();
        if (action === "pause")
          assert.ok(await page.locator(".link-cover").isVisible());
        if (action === "help")
          await page.locator(".game-link [data-game-help-close]").click();
        await exit();
      }
      assert.deepEqual(
        await page.evaluate(
          (storageKey) =>
            JSON.parse(localStorage.getItem(storageKey)).state.board,
          key,
        ),
        expected.board,
        "interruption retains the committed board",
      );
      assert.equal(await page.locator(".game-link").count(), 0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      window.linkOriginalAnimate = Element.prototype.animate;
      Element.prototype.animate = undefined;
    });
    await open();
    await trigger();
    await settled();
    await exit();
    await page.evaluate(() => {
      Element.prototype.animate = window.linkOriginalAnimate;
      delete window.linkOriginalAnimate;
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open();
    await trigger();
    await settled();
    await exit();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open({
      ...fixtures[0],
      cards: [
        [220, 2],
        [221, 2],
      ],
    });
    await trigger();
    await page.locator('[data-link-action="restart"]').click();
    assert.ok(await page.locator(".link-catalog").isVisible());
    await settled();
    await exit();
    assert.deepEqual(errors, []);
    console.log(
      "Tide animation: four physical directions, duplicate tile identity, input lock, pause/help/resize/exit, reduced motion and missing animation API verified.",
    );
  } finally {
    await page.close();
  }
}
async function main() {
  verifyRules();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    if (process.argv.includes("--motion-only")) {
      await verifyTideAnimations(browser);
      return;
    }
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const action = (name) => page.locator(`[data-link-action="${name}"]`);
    const load = () =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey)),
        key,
      );
    async function open() {
      await page.locator("#date-tab-games").click();
      await page.locator('#gamesPanel [data-game="game-link"]').click();
      await page
        .locator('#gamesPanel [data-game="game-link"]')
        .locator('xpath=ancestor::div[contains(@class,"game-library")]')
        .locator(".game-menu-play")
        .click();
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "open",
      );
    }
    async function exit() {
      await page.locator("#gameExitButton").click();
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "closed",
      );
    }
    await open();
    await page
      .locator(".game-link")
      .screenshot({ path: path.join(output, "modes.png") });
    await action("quest").click();
    const initial = (await load()).state;
    await action("restart").click();
    await action("cancel").click();
    assert.deepEqual((await load()).state.board, initial.board);
    await action("restart").click();
    await action("primary").click();
    assert.equal(
      await action("zen").evaluate(
        (button) => document.activeElement === button,
      ),
      true,
      "Returning to mode selection focuses a visible mode button",
    );
    assert.equal((await load()).state, null);
    await page.keyboard.press("Enter");
    assert.equal((await load()).state.mode, "zen");
    await action("restart").click();
    await action("primary").click();
    await action("quest").click();
    assert.equal(await page.locator(".link-tile:enabled").count(), 240);
    assert.equal(await page.locator(".link-animal").count(), 240);
    assert.equal(
      await page
        .locator(".link-animal")
        .evaluateAll(
          (animals) =>
            new Set(
              animals.map(
                (animal) =>
                  animal.dataset.sheet + animal.style.backgroundPosition,
              ),
            ).size,
        ),
      48,
    );
    assert.ok(
      (await page.locator(".link-board").boundingBox()).width >= 470,
      "desktop board is enlarged",
    );
    const atlas = await page
      .locator(".link-animal")
      .first()
      .evaluate(async (animal) => {
        const image = new Image();
        image.src = getComputedStyle(animal).backgroundImage.slice(5, -2);
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      });
    assert.ok(atlas.width >= 1000 && atlas.height >= 750);
    assert.equal(atlas.width * 3, atlas.height * 4, "atlas has square cells");
    for (const mode of ["quest", "tide", "zen"]) {
      if (mode !== "quest") {
        await action("primary").click();
        await action(mode).click();
      }
      for (let round = 0; round < 3; round++) {
        let saved = await load();
        assert.equal(
          saved.state.board.length,
          240,
          "every round stays the same size",
        );
        assert.equal(saved.state.cols, 20);
        if (mode === "quest" && round === 2) {
          assert.equal(await page.locator(".link-animal").count(), 240);
          assert.equal(
            await page
              .locator(".link-animal")
              .evaluateAll(
                (animals) =>
                  new Set(
                    animals.map(
                      (animal) =>
                        animal.dataset.sheet + animal.style.backgroundPosition,
                    ),
                  ).size,
              ),
            48,
          );
          await page
            .locator(".game-link")
            .screenshot({ path: path.join(output, "animals-all.png") });
        }
        while (saved.state.phase === "playing") {
          const pair = await page.evaluate(
            (storageKey) =>
              WorkTimeApp.games.linkRules.find(
                JSON.parse(localStorage.getItem(storageKey)).state.board,
                JSON.parse(localStorage.getItem(storageKey)).state.cols,
              ),
            key,
          );
          assert.ok(pair);
          const before = saved.state.score;
          await page.locator(`.link-tile[data-index="${pair.a}"]`).click();
          await page.locator(`.link-tile[data-index="${pair.b}"]`).click();
          await page.waitForFunction(
            ({ storageKey, before }) =>
              JSON.parse(localStorage.getItem(storageKey)).state.score > before,
            { storageKey: key, before },
          );
          await page.waitForFunction(
            () => !document.querySelector(".link-path polyline"),
          );
          saved = await load();
        }
        assert.equal(saved.state.phase, round === 2 ? "won" : "cleared");
        if (round < 2) await action("primary").click();
      }
      assert.ok((await load()).best[mode] > 0);
    }
    await action("primary").click();
    await action("tide").click();
    const sheets = await page
      .locator(".link-animal")
      .evaluateAll(async (animals) => {
        const urls = [
          ...new Set(
            animals.map((animal) =>
              getComputedStyle(animal).backgroundImage.slice(5, -2),
            ),
          ),
        ];
        await Promise.all(
          urls.map(async (url) => {
            const image = new Image();
            image.src = url;
            await image.decode();
          }),
        );
        return urls.length;
      });
    assert.equal(sheets, 4, "all four animal atlases load offline");
    await page.screenshot({ path: path.join(output, "diversity.png") });
    const before = (await load()).state;
    const swapCells = await page.evaluate((storageKey) => {
      const state = JSON.parse(localStorage.getItem(storageKey)).state;
      const anchor = WorkTimeApp.games.linkRules.find(state.board, state.cols);
      const a = state.board.findIndex(
        (_, i) => i !== anchor.a && i !== anchor.b,
      );
      const b = state.board.findIndex(
        (value, i) =>
          i !== anchor.a && i !== anchor.b && value !== state.board[a],
      );
      return { a, b };
    }, key);
    await action("swap").click();
    assert.equal(await action("swap").getAttribute("aria-pressed"), "true");
    await page.locator('.link-tile[data-index="' + swapCells.a + '"]').click();
    await page.locator('.link-tile[data-index="' + swapCells.b + '"]').click();
    const after = (await load()).state;
    assert.equal(after.energy, 0);
    assert.equal(after.board[swapCells.a], before.board[swapCells.b]);
    assert.equal(after.board[swapCells.b], before.board[swapCells.a]);
    assert.equal(await action("swap").isDisabled(), true);
    for (let n = 0; n < 3; n++) {
      const pair = await page.evaluate((storageKey) => {
        const state = JSON.parse(localStorage.getItem(storageKey)).state;
        return WorkTimeApp.games.linkRules.find(state.board, state.cols);
      }, key);
      await page.locator('.link-tile[data-index="' + pair.a + '"]').click();
      await page.locator('.link-tile[data-index="' + pair.b + '"]').click();
      await page.waitForFunction(
        () => !document.querySelector(".link-path polyline"),
      );
    }
    assert.ok(
      (await load()).state.energy >= 3,
      "matching replenishes swap energy",
    );
    assert.equal(await action("swap").isEnabled(), true);
    await action("hint").click();
    assert.equal(await page.locator(".link-tile.is-hint").count(), 2);
    assert.equal((await load()).state.hints, 2);
    await action("shuffle").click();
    assert.equal((await load()).state.shuffles, 1);
    await action("pause").click();
    const paused = (await load()).state.remaining;
    await page.waitForTimeout(700);
    await action("primary").click();
    assert.ok(
      (await load()).state.remaining >= paused - 50,
      "manual pause freezes time",
    );
    await page.locator(".game-link [data-game-help]").click();
    await page.waitForTimeout(700);
    await page.locator(".game-link [data-game-help-close]").click();
    assert.equal(await page.locator(".link-cover").isVisible(), true);
    await action("primary").click();
    const draft = (await load()).state.board;
    await exit();
    await open();
    assert.equal(await page.locator(".link-cover").isVisible(), true);
    assert.deepEqual((await load()).state.board, draft);
    await action("primary").click();
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        language,
      );
      assert.ok(
        !(await page.locator(".game-link").innerText()).includes("games.link."),
      );
    }
    await page
      .locator(".game-link")
      .screenshot({ path: path.join(output, "desktop.png") });
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [800, 600],
      [390, 844],
      [320, 568],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const fit = await page.locator(".game-link").evaluate((root) => {
        const content = root.parentElement,
          bounds = content.getBoundingClientRect();
        const fits = (element) => {
          const r = element.getBoundingClientRect();
          return (
            r.left >= bounds.left - 1 &&
            r.right <= bounds.right + 1 &&
            r.top >= bounds.top - 1 &&
            r.bottom <= bounds.bottom + 1
          );
        };
        const elements = [
          content,
          root,
          ...root.querySelectorAll(".link-play, .link-scroll"),
        ];
        return {
          noOverflow: elements.every(
            (element) =>
              element.scrollWidth <= element.clientWidth + 1 &&
              element.scrollHeight <= element.clientHeight + 1,
          ),
          allVisible: [
            ...root.querySelectorAll(
              ".link-tile, .link-actions button, .link-meters",
            ),
          ].every(fits),
          cells: root.querySelectorAll(".link-tile").length,
          cols: root
            .querySelector(".link-stage")
            .style.getPropertyValue("--link-cols"),
        };
      });
      assert.ok(
        fit.noOverflow,
        "no horizontal or vertical scrolling at " + width + "x" + height,
      );
      assert.ok(
        fit.allVisible,
        "all tiles and controls fit at " + width + "x" + height,
      );
      assert.equal(fit.cells, 240);
      if (width === 390 || width === 320) {
        assert.equal(
          fit.cols,
          "12",
          "portrait layout transposes the whole board",
        );
        const nextDirection = ["→", "↑", "←", "↓"][
          (await load()).state.tideStep
        ];
        assert.ok(
          (await page.locator(".link-objective").innerText()).endsWith(
            nextDirection,
          ),
          "tide arrow follows the portrait coordinates",
        );
        await page.locator(".link-tile").first().focus();
        await page.keyboard.press("ArrowDown");
        assert.equal(
          await page.evaluate(() => document.activeElement.dataset.index),
          "1",
        );
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page.evaluate(() => document.activeElement.dataset.index),
          "21",
        );
      }
      await page.screenshot({
        path: path.join(output, "fit-" + width + "x" + height + ".png"),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const connection = await page.evaluate((storageKey) => {
      const state = JSON.parse(localStorage.getItem(storageKey)).state;
      const pair = WorkTimeApp.games.linkRules.find(state.board, state.cols);
      document.querySelector('.link-tile[data-index="' + pair.a + '"]').click();
      document.querySelector('.link-tile[data-index="' + pair.b + '"]').click();
      return {
        actual: document
          .querySelector(".link-path polyline")
          .getAttribute("points"),
        expected: pair.path
          .map(([x, y]) => y + 0.5 + "," + (x + 0.5))
          .join(" "),
      };
    }, key);
    assert.equal(
      connection.actual,
      connection.expected,
      "portrait routes follow the displayed tiles",
    );
    await page.waitForFunction(
      () => !document.querySelector(".link-path polyline"),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.waitForTimeout(100);
    await exit();
    await page.evaluate((storageKey) => {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      saved.state.mode = "quest";
      saved.state.remaining = 100;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }, key);
    await open();
    await action("primary").click();
    await page.waitForFunction(
      () => document.querySelector(".link-cover").hidden === false,
    );
    assert.equal((await load()).state.phase, "lost");
    await exit();
    await page.evaluate(
      (storageKey) => localStorage.setItem(storageKey, "{broken"),
      key,
    );
    await open();
    assert.equal(await page.locator(".link-catalog").isVisible(), true);
    await action("zen").click();
    await page.locator(".link-tile:enabled").first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.index),
      "20",
    );
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.index),
      "1",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator('.link-tile[aria-pressed="true"]').count(),
      1,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.index),
      "1",
      "selection preserves keyboard focus",
    );
    await exit();
    assert.deepEqual(errors, []);
    const unavailable = await browser.newPage();
    await unavailable.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw Error("disabled");
      };
      Storage.prototype.setItem = () => {
        throw Error("disabled");
      };
    });
    await unavailable.goto(pathToFileURL(entry).href);
    await unavailable.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await unavailable.locator("#date-tab-games").click();
    await unavailable.locator('[data-game="game-link"]').click();
    await unavailable
      .locator('[data-game="game-link"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await unavailable.locator('[data-link-action="zen"]').click();
    assert.ok((await unavailable.locator(".link-warning").innerText()).length);
    assert.equal(await unavailable.locator(".link-tile:enabled").count(), 240);
    await verifyTideAnimations(browser);
    console.log(
      "Link UI: 48 species, energy and swapping, all three modes completed, objectives, rotating tides, pause/resume, storage, keyboard, six languages and eight one-screen layouts verified: " +
        entry,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
