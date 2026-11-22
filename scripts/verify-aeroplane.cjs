"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const { R, A } = require("./aeroplane/cli.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || root,
);
const clone = (v) => JSON.parse(JSON.stringify(v));
const scope = {
  TextEncoder,
  TextDecoder,
  WorkTimeApp: { games: { aeroplaneRules: R }, services: {} },
};
vm.createContext(scope);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets/js/services/game-archive.js"),
    "utf8",
  ),
  scope,
);
const archive = scope.WorkTimeApp.services.gameArchive;
function fixture(n, die = 1, turn = 0) {
  const s = R.create();
  s.pieces[turn * 4] = n;
  s.turn = turn;
  return R.roll(s, die);
}
async function unit() {
  assert.equal(new Set(R.track.map((q) => q.join(","))).size, 52);
  assert.equal(R.polygons.length, 52);
  assert.ok(R.polygons.every((points) => [3, 4].includes(points.length)));
  assert.equal(R.roll(R.create(), 1).turn, 1);
  let s = R.roll(R.create(), 6);
  assert.equal(R.legal(s).length, 4);
  s = R.move(s, 0).state;
  assert.equal(s.pieces[0], -1);
  assert.equal(s.turn, 0);
  for (let i = 0; i < 5; i++) {
    s = R.roll(s, 6);
    s = R.move(s, R.legal(s)[0]).state;
    assert.equal(s.turn, 0);
  }
  assert.throws(() => R.move(R.create(), 0));
  assert.throws(() => R.roll(R.create(), 7));
  for (let p = 0; p < 4; p++) {
    const start = R.coordinate(p, 18),
      midpoint = R.coordinate((p + 2) % 4, 53),
      end = R.coordinate(p, 30);
    assert.ok(
      Math.abs(
        (midpoint[0] - start[0]) * (end[1] - start[1]) -
          (midpoint[1] - start[1]) * (end[0] - start[0]),
      ) < 1e-9,
      "express lane crosses the exact opposing home square",
    );
    assert.equal(
      R.END - 50,
      6,
      "home path includes five cells and a terminal triangle",
    );
    const gate = R.polygons[p * 13 + 12];
    const area =
      Math.abs(
        gate.reduce(
          (sum, q, i) =>
            sum +
            q[0] * gate[(i + 1) % gate.length][1] -
            gate[(i + 1) % gate.length][0] * q[1],
          0,
        ),
      ) / 2;
    assert.equal(
      area,
      2,
      "gate occupies one full cell rather than two half cells",
    );
    assert.equal(R.landing(p, -1, 1).to, 1);
    const ready = R.create(Array(4).fill("human"));
    ready.turn = p;
    const apron = R.move(R.roll(ready, 6), 0).state;
    assert.equal(apron.pieces[p * 4], -1);
    const first = R.move(R.roll(apron, 1), 0).state;
    assert.equal(first.pieces[p * 4], 1);
    const [ax, ay] = R.coordinate(p, -1),
      [fx, fy] = R.coordinate(p, 1);
    const expectedFirst = [
      [5.35, 15.65],
      [1.35, 5.35],
      [11.65, 1.35],
      [15.65, 11.65],
    ][p];
    assert.ok(Math.hypot(fx - expectedFirst[0], fy - expectedFirst[1]) < 1e-9);
    assert.ok(
      Math.hypot(fx - ax, fy - ay) < 1,
      "first step adjoins the apron for every color",
    );
    assert.deepEqual(clone(R.landing(p, -1, 3).path), [1, 2, 3]);
    assert.equal(R.landing(p, 1, 1).to, 6, "same-color jump");
    assert.equal(R.landing(p, 17, 1).to, 30, "express entry");
    assert.equal(R.landing(p, 11, 1).to, 12, "no color mismatch jump");
    assert.equal(
      R.landing(p, 13, 1).to,
      30,
      "a jump into the express entry continues into flight",
    );
    assert.deepEqual(clone(R.landing(p, 13, 1).path), [14, 18, 30]);
    const relative = (g, seat) => (g - seat * 13 - 1 + 52) % 52;
    for (const [from, landings] of [
      [1, [2, 6]],
      [17, [18, 30]],
      [13, [14, 18, 30]],
    ]) {
      const state = fixture(from, 1, p),
        enemy = (p + 1) % 4,
        opposite = (p + 2) % 4;
      landings.forEach((step, i) => {
        state.pieces[enemy * 4 + i] = relative(R.global(p, step), enemy);
      });
      state.pieces[enemy * 4 + 3] = relative(R.global(p, from), enemy);
      state.pieces[opposite * 4 + 3] = relative(
        R.global(p, from + 2),
        opposite,
      );
      state.pieces[p * 4 + 1] = landings[0];
      if (from !== 1) {
        state.pieces[opposite * 4] = 53;
        state.pieces[opposite * 4 + 1] = 53;
        state.pieces[opposite * 4 + 2] = 52;
      }
      const moved = R.move(state, 0);
      assert.equal(
        moved.effect.captured.length,
        landings.length + (from !== 1 ? 2 : 0),
      );
      landings.forEach((_, i) =>
        assert.equal(moved.state.pieces[enemy * 4 + i], -2),
      );
      assert.equal(
        moved.state.pieces[enemy * 4 + 3],
        state.pieces[enemy * 4 + 3],
      );
      assert.equal(moved.state.pieces[p * 4 + 1], landings[0]);
      assert.equal(
        moved.state.pieces[opposite * 4 + 3],
        state.pieces[opposite * 4 + 3],
        "passing a square between landings does not capture",
      );
      if (from !== 1) {
        assert.equal(moved.state.pieces[opposite * 4], -2);
        assert.equal(moved.state.pieces[opposite * 4 + 1], -2);
        assert.equal(moved.state.pieces[opposite * 4 + 2], 52);
      }
    }
    assert.equal(R.landing(p, 55, 2).to, 55, "bounce");
    assert.equal(R.landing(p, 55, 1).to, 56, "exact finish");
    assert.deepEqual(
      clone(R.coordinate(p, R.END)),
      clone(R.rotate([7.95, 9.65], p)),
    );
    for (let n = -1; n < R.END; n++)
      for (let d = 1; d <= 6; d++) {
        const x = R.landing(0, n, d),
          y = R.landing(p, n, d);
        assert.equal(x.to, y.to);
        assert.equal(x.special, y.special);
        assert.ok(y.to >= 0 && y.to <= R.END);
      }
  }
  s = fixture(17);
  const end = R.global(0, 30);
  const relative = (p, g) => (g - p * 13 - 1 + 52) % 52;
  s.pieces[8] = 53;
  s.pieces[9] = 53;
  s.pieces[4] = relative(1, end);
  let result = R.move(s, 0);
  assert.equal(result.effect.captured.length, 3);
  assert.equal(result.state.pieces[4], -2);
  assert.equal(result.state.pieces[0], 30);
  s = fixture(7, 2);
  s.pieces[4] = relative(1, R.global(0, 8));
  assert.equal(
    R.move(s, 0).state.pieces[4],
    s.pieces[4],
    "passing does not capture",
  );
  s = fixture(0, 1);
  s.pieces[1] = 0;
  result = R.move(s, 0);
  assert.equal(result.state.pieces[1], 0, "friendly stack moves independently");
  s = fixture(55);
  s.pieces[1] = s.pieces[2] = s.pieces[3] = R.END;
  s = R.move(s, 0).state;
  assert.equal(s.winner, 0);
  assert.equal(s.phase, "won");
  assert.ok(R.restore(s));
  for (const mutate of [
    (v) => (v.pieces[0] = 58),
    (v) => (v.pieces[0] = 1.1),
    (v) => v.seats.fill("ai"),
    (v) => (v.phase = "won"),
    (v) => (v.winner = 1),
    (v) => (v.turn = 4),
    (v) => (v.die = 8),
    (v) => (v.actions = -1),
    (v) => (v.rolls = [[0, 7]]),
    (v) => (v.version = 3),
  ]) {
    const invalid = R.create();
    mutate(invalid);
    assert.equal(R.restore(invalid), null);
  }
  const legacy = R.create();
  legacy.version = 1;
  legacy.pieces.splice(0, 4, 50, 51, 52, 57);
  const migrated = R.restore(legacy);
  assert.deepEqual(clone(migrated.pieces.slice(0, 4)), [50, 50, 51, 56]);
  assert.equal(migrated.version, 2);
  const legacyWon = clone(legacy);
  legacyWon.pieces.splice(0, 4, 57, 57, 57, 57);
  legacyWon.winner = 0;
  legacyWon.phase = "won";
  assert.ok(R.restore(legacyWon));
  const wrongFirst = R.create();
  wrongFirst.pieces = [0, -1, -2, 5, ...wrongFirst.pieces.slice(4)];
  const repaired = R.restore(wrongFirst);
  assert.deepEqual(clone(repaired.pieces.slice(0, 4)), [1, -1, -2, 5]);
  assert.equal(
    wrongFirst.pieces[0],
    0,
    "save repair must not mutate incoming data",
  );
  const modelScope = { WorkTimeApp: { games: {} } };
  vm.createContext(modelScope);
  for (const file of ["manifest.js", "model.js"])
    vm.runInContext(
      fs.readFileSync(path.join(root, "assets/vendor/aeroplane", file), "utf8"),
      modelScope,
    );
  const model = modelScope.WorkTimeApp.games.aeroplaneModel,
    manifest = modelScope.WorkTimeApp.games.aeroplaneManifest;
  assert.ok(A.validate(model));
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(model)).digest("hex"),
    manifest.payloadHash,
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(root, "assets/vendor/aeroplane/evaluation.json")),
  );
  assert.equal(report.passed, true);
  for (const name of ["rules", "ai"])
    assert.equal(
      report.sources[name],
      crypto
        .createHash("sha256")
        .update(
          fs
            .readFileSync(
              path.join(root, `assets/js/games/aeroplane-${name}.js`),
              "utf8",
            )
            .replace(/\r\n?/g, "\n"),
        )
        .digest("hex"),
      "report must match shipped rules and inference",
    );
  assert.ok(
    report.cases.baseline.games >= 2000 && report.cases.random.games >= 2000,
  );
  assert.ok(
    report.cases.baseline.low > 0.25 &&
      report.hardVsNormal.low > 0 &&
      report.modelVsAblation.low > 0,
  );
  assert.throws(() => A.choose(fixture(1), { ...model, policy: [NaN] }));
  for (let seed = 1; seed <= 120; seed++) {
    let state = R.create();
    const rng = R.random(seed);
    let steps = 0;
    while (state.phase !== "won" && steps++ < 12000) {
      assert.ok(R.restore(state));
      if (state.phase === "roll")
        state = R.roll(state, 1 + Math.floor(rng() * 6));
      if (state.phase === "move") {
        const action =
          seed < 8
            ? A.choose(
                state,
                model,
                ["easy", "normal", "hard"][seed % 3],
                steps,
                { budget: 2, rounds: 1 },
              )
            : R.legal(state)[Math.floor(rng() * R.legal(state).length)];
        assert.ok(R.legal(state).includes(action));
        state = R.move(state, action).state;
      }
    }
    assert.equal(state.phase, "won");
    assert.ok(R.restore(state));
  }
  const values = new Map(),
    storage = {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, String(v)),
      removeItem: (k) => values.delete(k),
    };
  const owner = archive.create(() => storage),
    saved = { version: 1, state: fixture(17) };
  storage.setItem(archive.keys["game-aeroplane"], JSON.stringify(saved));
  const exported = owner.exportArchive(),
    decoded = await archive.decode(await archive.encode(exported));
  await owner.commit(owner.preview(decoded, { "game-aeroplane": "incoming" }));
  assert.equal(
    JSON.stringify(owner.read().games["game-aeroplane"]),
    JSON.stringify(saved),
  );
  assert.ok(archive.hasContent("game-aeroplane", saved));
  const merged = archive.merge(
    "game-aeroplane",
    saved,
    { version: 1, state: R.create() },
    "incoming",
  );
  assert.equal(merged.value.state.phase, "roll");
  console.log(
    "Aeroplane rules, real weights, complete games and archive round-trip passed.",
  );
  return model;
}
async function browser(model) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-aeroplane");
    const side = page.locator(".aero-sidebar");
    const cards = side.locator(".aero-player");
    const cardSizes = () =>
      cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const { width, height } = node.getBoundingClientRect();
          return [width, height];
        }),
      );
    const desktopCards = await cardSizes();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCards = await cardSizes();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const switches = side.getByRole("switch");
    assert.equal(await switches.count(), 4);
    assert.equal(await side.locator("select, h3, p").count(), 0);
    await switches.nth(0).focus();
    await page.keyboard.press("Space");
    assert.equal(await switches.nth(0).getAttribute("aria-checked"), "false");
    assert.ok(
      await switches.nth(0).evaluate((node) => node === document.activeElement),
    );
    assert.ok(await page.locator('[data-aero-action="start"]').isDisabled());
    await switches.nth(2).click();
    assert.equal(await switches.nth(2).getAttribute("aria-checked"), "true");
    await page.locator('[data-aero-action="start"]').click();
    assert.deepEqual(await cardSizes(), desktopCards);
    assert.equal(
      await side
        .locator(
          '[data-aero-action="pause"], [data-aero-action="rules"], .aero-status',
        )
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state
            .difficulty,
      ),
      "normal",
    );
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1"))?.state
          ?.actions > 0,
    );
    await page.locator('[data-aero-action="restart"]').click();
    const saved = await page.evaluate(() =>
      localStorage.getItem("worktime.games.aeroplane.v1"),
    );
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.aeroplane.v1"),
      ),
      saved,
    );
    await page.keyboard.press("Escape");
    const stress = fixture(17);
    stress.pieces.splice(0, 4, 17, 35, 45, 52);
    stress.pieces.splice(4, 8, 9, 24, 38, 49, 12, 25, 36, 53);
    const parity = await page.evaluate(
      async ({ s, model }) => {
        const G = WorkTimeApp.games;
        const source = `const R=(${G.aeroplaneRulesFactory.toString()})();const A=(${G.aeroplaneAiFactory.toString()})(R);onmessage=e=>postMessage({features:A.features(e.data.s,0),rank:A.rank(e.data.s,e.data.model),action:A.choose(e.data.s,e.data.model,"hard",77,{rounds:2,budget:1e9})});`;
        const url = URL.createObjectURL(
            new Blob([source], { type: "text/javascript" }),
          ),
          worker = new Worker(url);
        try {
          return await new Promise((resolve, reject) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = reject;
            worker.postMessage({ s, model });
          });
        } finally {
          worker.terminate();
          URL.revokeObjectURL(url);
        }
      },
      { s: clone(stress), model: clone(model) },
    );
    assert.deepEqual(parity.features, clone(A.features(stress, 0)));
    assert.deepEqual(parity.rank, clone(A.rank(stress, model)));
    assert.equal(
      parity.action,
      A.choose(stress, model, "hard", 77, { rounds: 2, budget: 1e9 }),
    );
    const inferenceMs = await page.evaluate(
      async ({ s, model }) => {
        const G = WorkTimeApp.games,
          source = `const R=(${G.aeroplaneRulesFactory.toString()})();const A=(${G.aeroplaneAiFactory.toString()})(R);onmessage=e=>{const times={};for(const d of ["easy","normal","hard"]){const start=performance.now();A.choose(e.data.s,e.data.model,d,23);times[d]=performance.now()-start;}postMessage(times);};`;
        const url = URL.createObjectURL(
            new Blob([source], { type: "text/javascript" }),
          ),
          worker = new Worker(url);
        try {
          return await new Promise((resolve, reject) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = reject;
            worker.postMessage({ s, model });
          });
        } finally {
          worker.terminate();
          URL.revokeObjectURL(url);
        }
      },
      { s: clone(stress), model: clone(model) },
    );
    assert.ok(
      inferenceMs.hard < 3000,
      "local search has a bounded foreground budget",
    );
    const out = path.join(root, "test-results/aeroplane");
    fs.mkdirSync(out, { recursive: true });
    await page.locator(".aero-dialog").waitFor({ state: "detached" });
    await page
      .locator(".game-aeroplane")
      .screenshot({ path: path.join(out, "desktop.png") });
    for (const theme of ["blue", "rose", "slate"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      assert.equal(await page.locator(".aero-plane").count(), 16);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await cardSizes(), mobileCards);
    assert.equal(await page.locator(".aero-art text").count(), 0);
    assert.equal(
      await page.locator(".aero-dice-pad, .aero-die-shadow").count(),
      0,
    );
    assert.ok(
      await page
        .locator(".game-aeroplane")
        .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    );
    await page
      .locator(".game-aeroplane")
      .screenshot({ path: path.join(out, "mobile.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForFunction(() => {
      const content = document.querySelector("#gameShell .game-content");
      return content.scrollHeight <= content.clientHeight + 1;
    });
    const centered = await page.locator(".aero-board").evaluate((board) => {
      const slots = Array.from(board.querySelectorAll(".aero-hangar"));
      return Array.from(board.querySelectorAll(".aero-plane")).every(
        (plane, i) => {
          const slot = slots[i].getBoundingClientRect();
          const piece = plane.getBoundingClientRect();
          const icon = plane.querySelector("path").getBoundingClientRect();
          const close = (rect) =>
            Math.abs(rect.x + rect.width / 2 - slot.x - slot.width / 2) < 1 &&
            Math.abs(rect.y + rect.height / 2 - slot.y - slot.height / 2) < 1;
          return close(piece) && close(icon);
        },
      );
    });
    assert.ok(centered, "pieces and their icons are centered in their hangars");
    await page.setViewportSize({ width: 390, height: 844 });
    async function reopen(state) {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
      await page.evaluate(
        (s) =>
          localStorage.setItem(
            "worktime.games.aeroplane.v1",
            JSON.stringify({ version: 1, state: s }),
          ),
        clone(state),
      );
      await launchGame(page, "game-aeroplane");
    }
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "true"),
    );
    for (let player = 0; player < 4; player++) {
      const ready = R.create(Array(4).fill("human"));
      ready.turn = player;
      await reopen(ready);
      await page.evaluate(() => {
        window.aeroOriginalRandom = crypto.getRandomValues;
        crypto.getRandomValues = (buffer) => {
          buffer.fill(5);
          return buffer;
        };
      });
      try {
        await page.locator(".aero-dice").click();
        await page.locator(`[data-plane="${player * 4}"]`).click();
        const apron = await page.evaluate(
          (player) =>
            JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1"))
              .state.pieces[player * 4],
          player,
        );
        assert.equal(
          apron,
          -1,
          "six must first leave the hangar for the apron",
        );
        await page.evaluate(
          () =>
            (crypto.getRandomValues = (buffer) => {
              buffer.fill(0);
              return buffer;
            }),
        );
        await page.locator(".aero-dice").click();
        await page.locator(`[data-plane="${player * 4}"]`).click();
        const first = await page.evaluate(
          (player) =>
            JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1"))
              .state.pieces[player * 4],
          player,
        );
        assert.equal(
          first,
          1,
          "one from the apron must enter the adjacent first square",
        );
        const at = await page
          .locator(`[data-plane="${player * 4}"]`)
          .evaluate((n) => [
            (parseFloat(n.style.left) / 100) * 17.6 - 0.3,
            (parseFloat(n.style.top) / 100) * 17.6 - 0.3,
          ]);
        const target = R.coordinate(player, 1);
        assert.ok(
          Math.hypot(at[0] - target[0], at[1] - target[1]) < 1e-4,
          "first-square rendering matches the rules",
        );
      } finally {
        await page.evaluate(() => {
          crypto.getRandomValues = window.aeroOriginalRandom;
          delete window.aeroOriginalRandom;
        });
      }
    }
    assert.equal(
      await page
        .locator(
          ".aero-heading,.aero-board-caption,.aero-base-count,.aero-target,.aero-crossing,.aero-route-arrow,.aero-dice-callout,.aero-plane[title]",
        )
        .count(),
      0,
    );
    assert.equal(
      await page.locator(".aero-home").count(),
      20,
      "five inner cells per color, plus each terminal triangle",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "false"),
    );
    const hoverState = fixture(3, 4);
    hoverState.seats.fill("human");
    await reopen(hoverState);
    const legalPlane = page.locator('[data-plane="0"]');
    const exitPosition = () =>
      page.locator('[data-aero-action="restart"]').evaluate((node) => {
        const workspace = node.closest(".aero-workspace");
        return (
          node.getBoundingClientRect().y - workspace.getBoundingClientRect().y
        );
      });
    const actionHeight = await exitPosition();
    await legalPlane.hover();
    assert.ok(
      await legalPlane.evaluate((node) =>
        node
          .getAnimations()
          .some((animation) => animation.transitionProperty === "transform"),
      ),
      "hover scales the piece with a transition",
    );
    await reopen(R.create(Array(4).fill("human")));
    await page.evaluate(() => {
      window.aeroOriginalRandom = crypto.getRandomValues;
      crypto.getRandomValues = (buffer) => {
        buffer.fill(0);
        return buffer;
      };
    });
    try {
      await page.locator(".aero-dice").click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-dice-player="0"] .aero-dice-scene')
          ?.getAnimations()
          .some(
            (animation) =>
              animation.effect.getKeyframes().at(-1).opacity === "0",
          ),
      );
      await page.locator('[data-dice-player="1"]').waitFor();
      assert.equal(
        await page
          .locator(".aero-dice")
          .evaluate((node) => node.classList.contains("aero-dice-enter")),
        true,
      );
      assert.equal(await exitPosition(), actionHeight);
    } finally {
      await page.evaluate(() => {
        crypto.getRandomValues = window.aeroOriginalRandom;
        delete window.aeroOriginalRandom;
      });
    }
    for (const [before, die, steps] of [
      [3, 4, [4, 5, 6, 7]],
      [1, 1, [2, 3, 4, 5, 6]],
      [17, 1, [18, "crossing", 30]],
      [13, 1, [14, 15, 16, 17, 18, "crossing", 30]],
    ]) {
      const motion = fixture(before, die);
      motion.seats.fill("human");
      await reopen(motion);
      await page.locator('[data-plane="0"]').click();
      const route = await page.locator('[data-plane="0"]').evaluate((n) => {
        const animation = n.getAnimations()[0];
        animation.pause();
        const frames = animation.effect.getKeyframes();
        return {
          anchor: [
            (parseFloat(n.style.left) / 100) * 17.6 - 0.3,
            (parseFloat(n.style.top) / 100) * 17.6 - 0.3,
          ],
          unit: n.closest(".aero-board").getBoundingClientRect().width / 17.6,
          frames: frames.map((f) => f.transform),
        };
      });
      assert.equal(
        route.frames.length,
        1 + steps.length * 2,
        "each grid step gets its own smooth segment",
      );
      for (let i = 0; i < steps.length; i++) {
        const point =
          steps[i] === "crossing"
            ? R.coordinate(2, 53)
            : R.coordinate(0, steps[i]);
        const match = route.frames[(i + 1) * 2].match(
          /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/,
        );
        assert.ok(match);
        assert.ok(
          Math.abs(route.anchor[0] + Number(match[1]) / route.unit - point[0]) <
            1e-4,
        );
        assert.ok(
          Math.abs(route.anchor[1] + Number(match[2]) / route.unit - point[1]) <
            1e-4,
          "movement follows the drawn route exactly",
        );
      }
    }
    for (let value = 1; value <= 6; value++) {
      const rolling = R.create(Array(4).fill("human"));
      rolling.turn = (value - 1) % 4;
      rolling.pieces[rolling.turn * 4] = 0;
      await reopen(rolling);
      await page.evaluate((value) => {
        window.aeroOriginalRandom = crypto.getRandomValues;
        crypto.getRandomValues = (buffer) => {
          buffer.fill(value - 1);
          return buffer;
        };
      }, value);
      try {
        await page.locator(".aero-dice").click();
        assert.equal(
          await page.locator(".aero-dice").getAttribute("data-dice-player"),
          String(rolling.turn),
        );
        assert.equal(await page.locator(".aero-dice-rolling").count(), 1);
        const visibleFace = await page
          .locator(".aero-dice-cube")
          .evaluate((cube) => {
            // Inspect the held landing frame before the board is redrawn.
            const spin = cube.getAnimations()[0];
            const end = spin.effect.getComputedTiming().endTime;
            spin.currentTime = end - 100;
            const rotation = new DOMMatrix(getComputedStyle(cube).transform);
            const normal = new DOMPoint(0, 0, 1, 0);
            const faces = Array.from(cube.querySelectorAll(".aero-die-face"));
            const depth = (face) =>
              rotation
                .multiply(new DOMMatrix(getComputedStyle(face).transform))
                .transformPoint(normal).z;
            faces.sort((a, b) => depth(b) - depth(a));
            spin.finish();
            return {
              value: Number(faces[0].dataset.faceValue),
              pips: faces[0].querySelectorAll(".aero-die-pip").length,
            };
          });
        assert.deepEqual(
          visibleFace,
          { value, pips: value },
          "the face turned toward the viewer matches the recorded roll",
        );
        await page.waitForFunction(
          () =>
            !document
              .querySelector(".game-aeroplane")
              .hasAttribute("data-visual-busy"),
        );
        assert.equal(
          await page.locator(".aero-dice").getAttribute("data-die-value"),
          String(value),
        );
        const expected = R.rotate([2, 15], rolling.turn);
        const at = await page
          .locator(".aero-dice")
          .evaluate((n) => [
            (parseFloat(n.style.left) / 100) * 17.6 - 0.3,
            (parseFloat(n.style.top) / 100) * 17.6 - 0.3,
          ]);
        assert.ok(
          Math.abs(at[0] - expected[0]) < 1e-4 &&
            Math.abs(at[1] - expected[1]) < 1e-4,
          "every player rolls inside their own base",
        );
      } finally {
        await page.evaluate(() => {
          crypto.getRandomValues = window.aeroOriginalRandom;
          delete window.aeroOriginalRandom;
        });
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "true"),
    );
    await reopen(R.create(Array(4).fill("human")));
    const randomRolls = await page.evaluate(async () => {
      document.documentElement.dataset.reducedMotion = "true";
      const counts = Array(6).fill(0);
      for (let i = 0; i < 120; i++) {
        const stored = () =>
          JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state;
        if (stored().phase === "won") break;
        if (stored().phase === "move") {
          document.querySelector(".aero-plane-choices button").click();
          await Promise.resolve();
        }
        const beforeRoll = stored().actions;
        document.querySelector(".aero-dice").click();
        await Promise.resolve();
        if (stored().actions !== beforeRoll + 1)
          throw Error("Random-roll probe did not execute a new roll");
        counts[stored().rolls.at(-1)[1] - 1]++;
      }
      return counts;
    });
    assert.ok(
      randomRolls.filter((n) => n > 0).length > 1,
      "real, unmocked dice must not be stuck at one",
    );
    const human = fixture(17);
    human.seats.fill("human");
    await reopen(human);
    await page.locator('[data-plane="0"]').focus();
    await page.keyboard.press("1");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state
          .pieces[0] === 30,
    );
    await page.locator('[data-aero-action="restart"]').click();
    const dialog = page.locator(".aero-dialog");
    const modalRect = await dialog.boundingBox();
    const boardRect = await page.locator(".aero-board").boundingBox();
    assert.ok(
      Math.abs(
        modalRect.x + modalRect.width / 2 - boardRect.x - boardRect.width / 2,
      ) < 1 &&
        Math.abs(
          modalRect.y +
            modalRect.height / 2 -
            boardRect.y -
            boardRect.height / 2,
        ) < 1,
      "exit confirmation is centered on the board",
    );
    assert.equal(await page.locator(".aero-overlay").count(), 0);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.locator('.game-aeroplane [role="dialog"]').count(),
      1,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator('.game-aeroplane [role="dialog"]').count(),
      0,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "false"),
    );
    await reopen(human);
    await page.locator('[data-plane="0"]').click();
    await page.locator('[data-aero-action="restart"]').click();
    const canceled = await page.evaluate(() =>
      localStorage.getItem("worktime.games.aeroplane.v1"),
    );
    await page.waitForTimeout(1000);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.aeroplane.v1"),
      ),
      canceled,
      "cancelled flight cannot commit a delayed turn",
    );
    // Every localized game must render actual copy, including all setup seats.
    for (const locale of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
      await page.evaluate(
        (locale) => WorkTimeApp.i18n.setLanguage(locale),
        locale,
      );
      await launchGame(page, "game-aeroplane");
      assert.ok(
        !(await page.locator(".game-aeroplane").innerText()).includes(
          "games.aeroplane.",
        ),
      );
    }
    // Force a malformed model, then verify retry, real inference and cancellation.
    const computer = fixture(0);
    computer.turn = 1;
    computer.pieces[4] = 0;
    await page.evaluate(async () => {
      await WorkTimeApp.services.assets.scripts([
        "assets/vendor/aeroplane/manifest.js",
        "assets/vendor/aeroplane/model.js",
      ]);
      WorkTimeApp.games.aeroplaneModel = { format: 999 };
    });
    await reopen(computer);
    await page.locator(".aero-warning").waitFor();
    const faultSave = await page.evaluate(() =>
      localStorage.getItem("worktime.games.aeroplane.v1"),
    );
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.aeroplane.v1"),
      ),
      faultSave,
    );
    await page.evaluate((model) => {
      WorkTimeApp.games.aeroplaneModel = model;
    }, clone(model));
    await page.locator('[data-aero-action="retry"]').click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state
          .actions > 1,
    );
    await page.locator("#gameExitButton").click();
    const after = await page.evaluate(() =>
      localStorage.getItem("worktime.games.aeroplane.v1"),
    );
    await page.waitForTimeout(700);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.aeroplane.v1"),
      ),
      after,
    );
    assert.deepEqual(errors, []);
    await context.close();
    await httpSmoke(browser);
    fs.writeFileSync(
      path.join(
        out,
        site === root ? "browser-source.json" : "browser-published.json",
      ),
      JSON.stringify(
        { site, inferenceMs, randomRolls, passed: true },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Aeroplane file entry, Worker parity, six locales, layouts, restart and model failure/retry passed: " +
        site,
    );
  } finally {
    await browser.close();
  }
}
async function httpSmoke(browser) {
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(
      site,
      "." + decodeURIComponent(name === "/" ? "/index.html" : name),
    );
    if (
      !file.startsWith(site + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
    };
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true },
          ),
        );
      await WorkTimeApp.services.assets.whenIdle();
    });
    await launchGame(page, "game-aeroplane");
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    const computer = fixture(17, 1, 1);
    await page.evaluate(
      (s) =>
        localStorage.setItem(
          "worktime.games.aeroplane.v1",
          JSON.stringify({ version: 1, state: s }),
        ),
      clone(computer),
    );
    await launchGame(page, "game-aeroplane");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state
          .actions > 1,
    );
    assert.equal(await page.locator(".aero-warning").count(), 0);
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.evaluate(
      (s) =>
        localStorage.setItem(
          "worktime.games.aeroplane.v1",
          JSON.stringify({ version: 1, state: s }),
        ),
      clone(computer),
    );
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-aeroplane");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.aeroplane.v1")).state
          .actions > 1,
    );
    assert.equal(await page.locator(".aero-warning").count(), 0);
    assert.deepEqual(errors, []);
    console.log("Aeroplane HTTP and installed offline model inference passed.");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
unit()
  .then((model) => (process.argv.includes("--unit") ? null : browser(model)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
