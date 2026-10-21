"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const key = "worktime.games.snake.v1";
const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/snake-rules.js"), "utf8"),
  sandbox,
);
const rules = sandbox.WorkTimeApp.games.snakeRules;
sandbox.WorkTimeApp.games.register = () => {};
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/snake.js"), "utf8"),
  sandbox,
);
function verifyMotion() {
  const pathFor = sandbox.WorkTimeApp.games.snakePath;
  const length = (points) =>
    points.slice(1).reduce((sum, p, i) => {
      const dx = Math.abs(p.x - points[i].x),
        dy = Math.abs(p.y - points[i].y);
      assert.ok(
        dx < 1e-9 || dy < 1e-9,
        "body follows the grid trail without diagonal corner cutting",
      );
      return sum + dx + dy;
    }, 0);
  for (const mode of ["classic", "wrap"]) {
    let state = fixture(mode);
    state.body = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 11 },
      { x: 7, y: 12 },
      { x: 6, y: 12 },
      { x: 5, y: 12 },
    ];
    state.food = { x: 0, y: 0 };
    state.eaten = 3;
    state.score = 30;
    for (const direction of [
      "up",
      "left",
      "up",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
    ]) {
      const previous = state.body;
      state = rules.step(state, direction);
      if (state.status !== "playing") break;
      for (const alpha of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1])
        assert.ok(
          Math.abs(
            length(pathFor(state.body, previous, alpha)) -
              (state.body.length - 1),
          ) < 1e-9,
          "snake length stays constant throughout successive turns and portals",
        );
    }
  }
  const state = fixture();
  state.food = { x: 9, y: 9 };
  const grown = rules.step(state, "up");
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    const path = pathFor(grown.body, state.body, alpha);
    assert.ok(
      Math.abs(length(path) - (state.body.length - 1 + alpha)) < 1e-9,
      "growth extends smoothly without moving the tail",
    );
    assert.equal(path.at(-1).x, state.body.at(-1).x + 0.5);
    assert.equal(path.at(-1).y, state.body.at(-1).y + 0.5);
  }
  console.log(
    "Snake motion: fixed corners, axis-aligned trails, constant length, successive turns, wrapping and smooth growth verified.",
  );
}
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture(mode = "classic") {
  const s = rules.create(mode, () => 0);
  s.status = "playing";
  return s;
}
function packed(state) {
  return plain({
    version: 1,
    state,
    best: { classic: 100, wrap: 40, rush: 20 },
  });
}
function verifyRules() {
  for (const mode of Object.keys(rules.modes)) {
    const initial = rules.create(mode, () => 0);
    assert.ok(initial.food && initial.alternative);
    assert.ok(!rules.same(initial.food, initial.alternative));
    assert.ok(
      Math.abs(initial.food.x - initial.alternative.x) +
        Math.abs(initial.food.y - initial.alternative.y) >=
        4,
      "choices offer separated routes",
    );
    const choice = fixture(mode);
    choice.food = { x: 10, y: 10 };
    choice.alternative = { x: 9, y: 9 };
    const eaten = rules.step(choice, "up", () => 0);
    assert.equal(eaten.score, 10);
    assert.equal(eaten.body.length, 5);
    assert.ok(
      !rules.same(eaten.food, choice.food) &&
        !rules.same(eaten.alternative, choice.food),
      "eating the alternative refreshes the whole pair",
    );
    assert.ok(!rules.same(eaten.food, eaten.alternative));
  }
  let streak = fixture();
  let expected = 0;
  for (let count = 1; count <= 7; count++) {
    streak.bonus = { x: streak.body[0].x + 1, y: 10, ttl: 65, duration: 65 };
    streak = rules.step(streak);
    expected += 50 * Math.min(5, count);
    assert.equal(streak.score, expected);
    assert.equal(streak.combo, Math.min(5, count));
    assert.equal(streak.body.length, 4, "bonus streak does not grow the snake");
  }
  streak.bonus = { x: 0, y: 1, ttl: 1, duration: 65 };
  streak = rules.step(streak);
  assert.equal(streak.combo, 0, "missing a bonus resets the streak");
  streak.bonus = { x: streak.body[0].x + 1, y: 10, ttl: 10, duration: 65 };
  const restarted = rules.step(streak);
  assert.equal(restarted.score, expected + 50);
  assert.equal(restarted.combo, 1);
  assert.ok(rules.restore(packed(restarted)));
  const ring = [];
  for (let x = 5; x <= 9; x++) ring.push({ x, y: 5 });
  for (let y = 6; y <= 9; y++) ring.push({ x: 9, y });
  for (let x = 8; x >= 5; x--) ring.push({ x, y: 9 });
  for (let y = 8; y >= 6; y--) ring.push({ x: 5, y });
  for (const mode of ["classic", "wrap"])
    for (let sample = 0; sample < 20; sample++) {
      const enclosed = fixture(mode);
      enclosed.body = ring;
      enclosed.direction = "left";
      enclosed.food = { x: 4, y: 5 };
      enclosed.alternative = { x: 0, y: 0 };
      enclosed.eaten = ring.length - 4;
      enclosed.score = enclosed.eaten * 10;
      const next = rules.step(enclosed, "left", () => sample / 20);
      for (const food of [next.food, next.alternative]) {
        assert.ok(
          food && !(food.x > 5 && food.x < 9 && food.y > 5 && food.y < 9),
          "food avoids a body-enclosed cavity",
        );
        assert.ok(!next.body.some((p) => rules.same(p, food)));
      }
    }
  for (const mode of Object.keys(rules.modes)) {
    const s = fixture(mode),
      before = JSON.stringify(s);
    s.food = { x: 10, y: 10 };
    const grown = rules.step(s, "right", () => 0);
    assert.equal(grown.score, 10);
    assert.equal(grown.body.length, 5);
    assert.equal(grown.eaten, 1);
    assert.ok(!grown.body.some((p) => rules.same(p, grown.food)));
    assert.equal(
      rules.step(fixture(mode), "left").direction,
      "right",
      "reverse is rejected",
    );
    assert.equal(
      JSON.stringify(fixture(mode)),
      before,
      "step never mutates input",
    );
    assert.ok(rules.restore(packed(grown)));
  }
  let wall = fixture();
  wall.body.forEach((p) => (p.x += rules.columns - 10));
  assert.equal(rules.step(wall).status, "lost");
  wall.mode = "wrap";
  assert.equal(rules.step(wall).body[0].x, 0);
  let tail = fixture();
  tail.body = [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
  ];
  tail.direction = "up";
  assert.equal(
    rules.step(tail, "left").status,
    "playing",
    "vacated tail is safe",
  );
  tail.body.push({ x: 0, y: 2 });
  tail.eaten = 1;
  tail.score = 10;
  assert.equal(rules.step(tail, "left").status, "lost", "body collision loses");
  let s = fixture();
  for (let i = 0; i < 5; i++) {
    s.food = { x: s.body[0].x + 1, y: 10 };
    s = rules.step(s, "right", () => 0);
  }
  assert.equal(s.bonus.ttl, 65);
  assert.equal(s.bonus.duration, 65);
  const active = plain(s.bonus);
  for (let i = 0; i < 5; i++) {
    s.food = { x: s.body[0].x + 1, y: 10 };
    s = rules.step(s, "right", () => 0);
  }
  assert.equal(s.bonus.x, active.x);
  assert.equal(s.bonus.y, active.y);
  assert.equal(
    s.bonus.ttl,
    active.ttl - 5,
    "a new milestone never replaces a live bonus",
  );
  assert.equal(s.score, 100);
  s.bonus = { x: s.body[0].x + 1, y: 10, ttl: 5 };
  const bonus = rules.step(s);
  assert.equal(bonus.score, 150);
  assert.equal(bonus.body.length, s.body.length);
  assert.equal(bonus.bonus, null);
  s.bonus = { x: 0, y: 0, ttl: 1 };
  assert.equal(rules.step(s).bonus, null);
  assert.ok(rules.interval({ mode: "classic", eaten: 10000 }) >= 78);
  assert.ok(rules.interval(fixture("rush")) < rules.interval(fixture()));
  const full = [];
  for (let y = 0; y < rules.rows; y++)
    for (let x = 0; x < rules.columns; x++)
      full.push({ x: y % 2 ? rules.columns - 1 - x : x, y });
  const total = full.length;
  const win = fixture();
  win.body = full.slice(0, total - 1).reverse();
  win.direction = "left";
  win.food = full[total - 1];
  win.eaten = total - 5;
  win.score = win.eaten * 10;
  const won = rules.step(win);
  assert.equal(won.status, "won");
  assert.equal(won.alternative, null);
  assert.ok(rules.restore(packed(won)));
  const almost = {
    ...win,
    body: full.slice(0, total - 2).reverse(),
    food: full[total - 2],
    bonus: { ...full[total - 1], ttl: 30 },
    eaten: total - 6,
    score: (total - 6) * 10,
  };
  const last = rules.step(almost);
  assert.equal(last.status, "playing");
  assert.ok(last.food);
  assert.equal(last.bonus, null);
  for (const change of [
    (s) => (s.body[1] = s.body[0]),
    (s) => (s.food = s.body[0]),
    (s) => (s.mode = "bad"),
    (s) => (s.direction = "toString"),
    (s) => (s.eaten = -1),
    (s) => (s.bonus = { x: 0, y: 0, ttl: 999 }),
    (s) => (s.body[0].x = 99),
    (s) => (s.alternative = s.food),
    (s) => (s.combo = 6),
    (s) => (s.bonus = { x: 0, y: 1, ttl: 30, duration: 10 }),
  ]) {
    const bad = packed(fixture());
    change(bad.state);
    assert.equal(rules.restore(bad), null);
  }
  assert.equal(rules.restore(null), null);
  const legacy = packed(fixture());
  delete legacy.state.columns;
  delete legacy.state.rows;
  delete legacy.state.alternative;
  delete legacy.state.combo;
  assert.ok(
    rules.restore(legacy).state.alternative,
    "old saves receive a second choice",
  );
  assert.equal(rules.restore(legacy).state.combo, 0);
  assert.equal(
    rules.restore(legacy).state.columns,
    24,
    "legacy progress expands without resetting the run",
  );
  legacy.state.mode = "wrap";
  legacy.state.body = [
    { x: 0, y: 10 },
    { x: 19, y: 10 },
    { x: 18, y: 10 },
    { x: 17, y: 10 },
  ];
  assert.equal(
    rules.restore(legacy).state.columns,
    20,
    "legacy portal seam retains valid adjacency",
  );
  console.log(
    "Snake rules: growth, reverse, walls, portals, tail, collision, bonus, speed, full-board victory and corrupt saves verified.",
  );
}
async function verifyBrowser() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#date-tab-games").click();
    async function open() {
      await page.locator('#gamesPanel [data-game="game-snake"]').click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
    }
    async function close() {
      await page.locator("#gameExitButton").click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "closed",
      );
    }
    async function seed(state) {
      await page.evaluate(
        ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
        { key, save: packed(state) },
      );
    }
    const action = (name) => page.locator(`[data-snake-action="${name}"]`);
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    await seed(fixture());
    await open();
    assert.equal(
      await page.locator(".game-snake").getAttribute("data-paused"),
      "true",
    );
    await action("start").click();
    await page.clock.runFor(1900);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(350);
    await page.keyboard.press("p");
    assert.equal(
      (await read()).state.direction,
      "left",
      "two turns are buffered",
    );
    const stopped = JSON.stringify((await read()).state);
    await page.clock.runFor(2000);
    assert.equal(JSON.stringify((await read()).state), stopped);
    await page.locator("[data-game-help]").click();
    assert.equal(await page.locator(".game-help-screen").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".game-help-screen").isVisible(), false);
    await action("restart").click();
    assert.equal(await action("cancel").isVisible(), true);
    await action("cancel").click();
    assert.equal(JSON.stringify((await read()).state), stopped);
    await close();
    await open();
    assert.equal(JSON.stringify((await read()).state), stopped);
    await close();
    const foodState = fixture();
    const routeChoice = fixture();
    routeChoice.food = { x: 0, y: 0 };
    routeChoice.alternative = { x: 10, y: 10 };
    routeChoice.combo = 1;
    routeChoice.score = 50;
    await seed(routeChoice);
    await open();
    await action("start").click();
    await page.clock.runFor(2050);
    await page.keyboard.press("p");
    assert.equal(
      (await read()).state.score,
      60,
      "either food can be collected in the browser",
    );
    assert.equal(
      (await read()).state.combo,
      1,
      "ordinary food preserves the bonus streak",
    );
    assert.equal(
      await page
        .locator(".snake-counters .game-stat:last-child strong")
        .innerText(),
      "×1",
    );
    assert.ok((await read()).state.food && (await read()).state.alternative);
    await close();
    const chain = fixture();
    chain.combo = 1;
    chain.score = 50;
    chain.bonus = { x: 10, y: 10, ttl: 65, duration: 65 };
    await seed(chain);
    await open();
    await action("start").click();
    await page.clock.runFor(2050);
    await page.keyboard.press("p");
    assert.equal((await read()).state.score, 150);
    assert.equal((await read()).state.combo, 2);
    await close();
    await open();
    assert.equal(
      await page
        .locator(".snake-counters .game-stat:last-child strong")
        .innerText(),
      "×2",
      "streak survives exit and resume",
    );
    await close();
    chain.combo = 2;
    chain.score = 150;
    chain.bonus = { x: 0, y: 1, ttl: 1, duration: 65 };
    await seed(chain);
    await open();
    await action("start").click();
    await page.clock.runFor(2050);
    await page.keyboard.press("p");
    assert.equal((await read()).state.combo, 0);
    assert.equal(
      await page
        .locator(".snake-counters .game-stat:last-child strong")
        .innerText(),
      "×0",
      "expired bonus resets the visible streak",
    );
    await close();
    const collision = fixture();
    collision.body = [
      { x: 9, y: 10 },
      { x: 9, y: 11 },
      { x: 10, y: 11 },
      { x: 10, y: 10 },
      { x: 11, y: 10 },
    ];
    collision.direction = "up";
    collision.eaten = 1;
    collision.score = 10;
    for (const motion of ["no-preference", "reduce"]) {
      await page.emulateMedia({ reducedMotion: motion });
      await seed(collision);
      await open();
      await action("start").click();
      await page.clock.runFor(1850);
      await page.keyboard.press("ArrowRight");
      await page.clock.runFor(150);
      assert.equal(
        await page.locator(".game-snake").getAttribute("data-status"),
        "lost",
      );
      assert.equal(
        (await read()).state.status,
        "lost",
        "collision saves immediately",
      );
      assert.equal(
        await page.locator(".snake-cover").isVisible(),
        false,
        "impact precedes the failure window",
      );
      const deathBoard = await page.locator(".snake-board").boundingBox();
      await page.clock.runFor(motion === "reduce" ? 200 : 500);
      const opacity = await page
        .locator(".snake-cover")
        .evaluate((el) => Number(getComputedStyle(el).opacity));
      assert.ok(
        opacity > 0 && opacity < 1,
        "failure window fades in gradually after impact",
      );
      assert.equal(
        await action("start").evaluate((el) => !!el.closest("[inert]")),
        true,
        "restart cannot be accidentally activated during reveal",
      );
      await page.clock.runFor(800);
      assert.equal(
        await page
          .locator(".snake-cover")
          .evaluate((el) => Number(getComputedStyle(el).opacity)),
        1,
      );
      assert.equal(
        await page.locator(".game-snake").getAttribute("data-impact"),
        "false",
      );
      assert.deepEqual(
        await page.locator(".snake-board").boundingBox(),
        deathBoard,
        "impact keeps board layout fixed",
      );
      await action("start").click();
      assert.equal(
        await page.locator(".game-snake").getAttribute("data-status"),
        "ready",
      );
      await close();
    }
    // Leaving during the impact must cancel its frame loop and not replay it.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(collision);
    await open();
    await action("start").click();
    await page.clock.runFor(1850);
    await page.keyboard.press("ArrowRight");
    await page.clock.runFor(150);
    await close();
    await page.clock.runFor(1500);
    await open();
    assert.equal(
      await page.locator(".game-snake").getAttribute("data-impact"),
      "false",
    );
    assert.equal(await page.locator(".snake-cover").isVisible(), true);
    await close();
    const cornerState = fixture();
    cornerState.body = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 11 },
      { x: 7, y: 12 },
      { x: 6, y: 12 },
      { x: 5, y: 12 },
    ];
    cornerState.eaten = 3;
    cornerState.score = 30;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(cornerState);
    await open();
    await action("start").click();
    await page.clock.runFor(1900);
    const cornerPixels = () =>
      page.locator(".snake-board canvas").evaluate((canvas) => {
        const unit = canvas.width / 24;
        return Array.from(
          canvas
            .getContext("2d")
            .getImageData(
              Math.round(7 * unit),
              Math.round(10 * unit),
              Math.floor(unit),
              Math.floor(unit),
            ).data,
        );
      });
    const cornerBefore = await cornerPixels();
    for (const delta of [80, 50, 80]) {
      await page.clock.runFor(delta);
      const pixels = await cornerPixels();
      const coverageChange = pixels.reduce(
        (sum, value, i) =>
          sum + (i % 4 === 3 ? Math.abs(value - cornerBefore[i]) / 255 : 0),
        0,
      );
      // Canvas may switch GPU/CPU rasterizers after readback. Allow subpixel
      // antialiasing differences, but not a corner moving or cutting diagonally.
      assert.ok(
        coverageChange < Math.sqrt(pixels.length / 4) / 2,
        `stationary corner coverage changed by ${coverageChange} pixels`,
      );
    }
    const motionOutput = path.join(root, "test-results/snake");
    fs.mkdirSync(motionOutput, { recursive: true });
    await page.locator(".snake-board").screenshot({
      path: path.join(motionOutput, "stable-corner.png"),
      animations: "allow",
    });
    await close();
    await page.emulateMedia({ reducedMotion: "reduce" });
    foodState.food = { x: 10, y: 10 };
    await seed(foodState);
    await open();
    await action("start").click();
    await page.clock.runFor(2050);
    await page.keyboard.press("p");
    assert.equal((await read()).state.score, 10);
    const geometry = await page.locator(".snake-board").boundingBox();
    for (const language of ["en", "zh-CN", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.ok(
        !(await page.locator(".game-snake").innerText()).includes(
          "games.snake.",
        ),
      );
      assert.deepEqual(
        await page.locator(".snake-board").boundingBox(),
        geometry,
        "language changes keep the board stable",
      );
    }
    await action("restart").click();
    await action("start").click();
    await page.locator("#snakeModeTrigger").click();
    await page.locator('[data-game-option="wrap"]').click();
    assert.equal((await read()).state.mode, "wrap");
    await page.locator("#snakeModeTrigger").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal((await read()).state.mode, "rush");
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    const out = path.join(root, "test-results/snake");
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "desktop.png") });
    for (const width of [390, 320, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 400 ? 844 : 1000 });
      await page.clock.runFor(150);
      const b = await page.locator(".snake-board").boundingBox();
      assert.ok(
        b.x >= 0 && b.x + b.width <= width + 1,
        `board fits ${width}px viewport: ${JSON.stringify(b)}`,
      );
      assert.ok(
        b.width >= 140 && Math.abs(b.width / b.height - 1.2) < 0.02,
        "rectangular board preserves square cells",
      );
      assert.equal(
        await page.locator(".snake-feedback").count(),
        0,
        "no permanent explanatory text under the board",
      );
    }
    await close();
    let edge = fixture("wrap");
    edge.body.forEach((p) => (p.x += rules.columns - 10));
    await seed(edge);
    await open();
    await action("start").click();
    await page.clock.runFor(2050);
    await page.keyboard.press("p");
    assert.ok((await read()).state.body[0].x < 3);
    assert.equal((await read()).state.status, "playing");
    await close();
    await seed(fixture());
    await open();
    await action("start").click();
    await page.clock.runFor(1900);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      await page.locator(".game-snake").getAttribute("data-paused"),
      "true",
    );
    await close();
    await page.evaluate((key) => localStorage.setItem(key, "{broken"), key);
    await open();
    assert.equal(
      await page.locator(".game-snake").getAttribute("data-status"),
      "ready",
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw Error("Unavailable");
      };
    });
    await action("restart").click();
    assert.equal(await page.locator(".game-notice p").isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "mobile.png") });
    await close();
    await page.clock.runFor(5000);
    assert.deepEqual(errors, []);
    const touch = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    touch.on("pageerror", (error) => errors.push(error.message));
    await touch.route(/^https?:/, (route) => route.abort());
    await touch.goto(pathToFileURL(entry).href);
    await touch.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await touch.clock.install();
    await touch.emulateMedia({ reducedMotion: "no-preference" });
    const touchState = fixture();
    touchState.bonus = { x: 9, y: 9, ttl: 65 };
    await touch.evaluate(
      ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
      { key, save: packed(touchState) },
    );
    await touch.locator("#date-tab-games").tap();
    await touch.locator('#gamesPanel [data-game="game-snake"]').tap();
    await touch.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
    assert.equal(await touch.locator(".snake-pad").isVisible(), true);
    await touch.locator('[data-snake-action="start"]').tap();
    await touch.clock.runFor(1850);
    const box = await touch.locator(".snake-board canvas").boundingBox();
    const client = await touch.context().newCDPSession(touch);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 65 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touch.clock.runFor(180);
    await touch.screenshot({ path: path.join(out, "mobile-play.png") });
    await touch.locator('[data-snake-action="pause"]').tap();
    await touch.clock.runFor(350);
    const touchSave = await touch.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(
      touchSave.state.direction,
      "up",
      "real touch swipe steers the snake",
    );
    assert.equal(
      touchSave.state.score,
      50,
      "golden bonus scores without growing",
    );
    assert.equal(touchSave.state.body.length, 4);
    assert.equal(
      await touch.locator(".game-snake").getAttribute("data-paused"),
      "true",
      "touch pause stops play",
    );
    await touch.clock.runFor(400);
    await touch.locator('[data-snake-action="pause"]').tap();
    await touch.clock.runFor(350);
    assert.equal(
      await touch.locator(".game-snake").getAttribute("data-paused"),
      "false",
      "touch resumes",
    );
    await touch.clock.runFor(1850);
    assert.equal(
      await touch.locator(".snake-cover").isVisible(),
      false,
      "resume countdown completes",
    );
    await touch.locator('[data-snake-action="left"]').tap();
    assert.equal(
      await touch.locator(".game-snake").getAttribute("data-paused"),
      "false",
      "pad preserves running state",
    );
    await touch.clock.runFor(350);
    await touch.locator('[data-snake-action="pause"]').tap();
    await touch.clock.runFor(350);
    assert.equal(
      (
        await touch.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)),
          key,
        )
      ).state.direction,
      "left",
      `touch direction pad steers: ${await touch.locator(".snake-cover").innerText()}`,
    );
    for (const theme of ["blue", "purple", "green"])
      await touch.evaluate((theme) => WorkTimeApp.ui.theme.apply(theme), theme);
    await touch.locator('[data-snake-action="pause"]').tap();
    await touch.clock.runFor(1850);
    await touch.setViewportSize({ width: 1440, height: 1000 });
    await touch.clock.runFor(100);
    await touch.screenshot({ path: path.join(out, "desktop-play.png") });
    await touch.locator("#gameExitButton").tap();
    await touch.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    assert.equal(await touch.locator(".game-snake").count(), 0);
    assert.deepEqual(errors, []);
    await touch.close();
    console.log(
      "Snake browser: offline launch, buffered keyboard, scoring, pause, help, confirmation, resume, modes, six languages, layout, portals, focus loss, corrupt saves and unavailable storage verified.",
    );
  } finally {
    await browser.close();
  }
}
verifyRules();
verifyMotion();
verifyBrowser().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
