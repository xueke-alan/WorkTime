"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.slice(2).find((a) => !a.startsWith("--")) || root,
);
const key = "worktime.games.klotski.v1",
  id = "game-klotski";
const clone = (v) => JSON.parse(JSON.stringify(v));
const sandbox = vm.createContext({
  WorkTimeApp: { data: {}, games: {}, services: {} },
  window: {
    navigator: {},
    crypto: require("node:crypto").webcrypto,
    dispatchEvent() {},
  },
  TextEncoder,
  TextDecoder,
  Response,
  Blob,
  CompressionStream,
  DecompressionStream,
  btoa,
  atob,
  Event,
});
for (const file of [
  "assets/data/klotski.js",
  "assets/js/games/klotski-rules.js",
  "assets/js/backup.js",
  "assets/js/services/game-archive.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
const app = sandbox.WorkTimeApp,
  rules = app.games.klotskiRules,
  archive = app.services.gameArchive;
const bank = app.data.klotski;
const certificates = require("./klotski/certificates.json");
const cert = (level) => certificates.levels.find((c) => c.id === level.id);
function fresh(level, state = rules.create(level)) {
  return {
    version: 1,
    grouping: 2,
    chapter: level.chapter,
    classics: false,
    current: level.id,
    drafts: { [level.id]: clone(state) },
    completed: {},
  };
}
async function verifyRules() {
  require("./klotski/build.cjs").run({ check: true });
  const localeContext = vm.createContext({
    WorkTimeApp: {
      data: {
        locales: Object.fromEntries(
          ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"].map((id) => [id, {}]),
        ),
      },
    },
  });
  for (const file of [
    "assets/data/klotski-names.js",
    "assets/js/locales/klotski.js",
  ])
    vm.runInContext(
      fs.readFileSync(path.join(root, file), "utf8"),
      localeContext,
    );
  for (const locale of ["zh-CN", "zh-TW", "zh-HK"]) {
    const seen = new Set();
    for (const level of bank.filter((l) => l.classic !== undefined)) {
      const name =
        localeContext.WorkTimeApp.data.locales[locale][
          "games.klotski.classic" + level.classic
        ];
      assert(
        name && [...name].length <= 5,
        "display names fit five characters: " + name,
      );
      assert(!seen.has(name), "short names stay distinct: " + name);
      seen.add(name);
    }
  }
  assert.equal(bank.length, 300);
  assert.equal(new Set(bank.map((l) => l.id)).size, 300);
  assert.equal(bank.filter((l) => l.classic !== undefined).length, 206);
  assert.equal(
    bank.filter((l) => l.classic !== undefined && l.collection !== "fayaa")
      .length,
    45,
  );
  assert.equal(bank.filter((l) => l.collection === "fayaa").length, 161);
  assert.equal(bank.filter((l) => l.classic >= 40 && l.classic < 47).length, 7);
  assert.deepEqual(
    certificates.namedSelectedByDifficulty,
    certificates.namedAvailableByDifficulty.map((n) => Math.min(n, 50)),
    "maximize named layouts within every difficulty quota",
  );
  const identities = new Set();
  for (const level of bank) {
    const { geometry, encode } = require("./klotski/build.cjs");
    const positions = level.pieces.map((p) => p[2]);
    const identity =
      level.pieces.map((p) => p.slice(0, 2).join("x")).join(",") +
      ":" +
      [encode(positions), geometry(level.pieces).mirror(positions)].sort()[0];
    assert(
      !identities.has(identity),
      "no duplicate or mirrored classic substitutes",
    );
    identities.add(identity);
  }
  assert.equal(app.data.klotskiRetired.length, 171);
  assert.equal(
    app.data.klotskiRetired.filter((l) => l.reason === "one-move").length,
    5,
  );
  assert.equal(
    app.data.klotskiRetired.filter((l) => l.reason === "classic-replacement")
      .length,
    166,
  );
  for (const retired of app.data.klotskiRetired) {
    assert(!bank.some((l) => l.id === retired.id));
    const certificate = certificates.retiredLevels.find(
      (c) => c.id === retired.id,
    );
    assert.equal(certificate.minimum === 1, retired.reason === "one-move");
    const state = rules.replay(retired, certificate.solution);
    assert(state && rules.won(state));
    const old = fresh(retired, state);
    delete old.grouping;
    old.completed[retired.id] = clone(state);
    archive.addCompletion(old, retired.id, state.path);
    const restored = archive.normalize(id, old);
    assert.equal(restored.current, null);
    assert(restored.completed[retired.id]);
    assert.equal(restored.completionHistory[retired.id].length, 1);
    assert.deepEqual(clone(archive.normalize(id, restored)), clone(restored));
  }
  const retained = bank.find((l) => l.chapter === 11);
  const legacy = fresh(retained);
  delete legacy.grouping;
  legacy.chapter = 5;
  assert.equal(
    archive.normalize(id, legacy).chapter,
    11,
    "legacy active level follows its new group",
  );
  legacy.current = null;
  assert.equal(
    archive.normalize(id, legacy).chapter,
    10,
    "legacy difficulty selection maps to its first group",
  );
  for (let chapter = 0; chapter < rules.groups.length; chapter++) {
    const group = bank.filter((l) => l.chapter === chapter);
    assert.equal(group.length, 25);
    let previous = 0;
    for (const level of group) {
      const c = cert(level),
        [lo, hi] = rules.bands[rules.groups[chapter].difficulty];
      assert(
        c.minimum > 1,
        "one-move layouts must never appear in the active bank",
      );
      assert(c.minimum >= lo && c.minimum <= hi && c.minimum >= previous);
      previous = c.minimum;
      assert(
        rules.valid(
          level,
          level.pieces.map((p) => p[2]),
        ),
      );
      const state = rules.replay(level, c.solution);
      assert(state && rules.won(state), level.id);
      assert.equal(state.path.length, c.minimum);
      assert(rules.restoreState(level, state));
      assert(!rules.move(level, state, 0, "u"), "won games cannot move");
      assert(rules.undo(level, state));
      assert(!rules.won(state));
    }
  }
  assert.equal(cert(bank.find((l) => l.classic === 0)).minimum, 81);
  const publishedData = fs.readFileSync(
    path.join(site, "assets/data/klotski.js"),
    "utf8",
  );
  assert(
    !/["'](?:minimum|solution|route)["']\s*:/.test(publishedData),
    "no answers or minimum counts shipped",
  );
  const level = bank.find((l) =>
    cert(l).solution.some((s) => /[lr][ud]|[ud][lr]/.test(s.route)),
  );
  const c = cert(level),
    turning = c.solution.findIndex((s) => /[lr][ud]|[ud][lr]/.test(s.route));
  const before = rules.replay(level, c.solution.slice(0, turning));
  const after = rules.replay(level, c.solution.slice(0, turning + 1));
  rules.undo(level, after);
  assert.deepEqual(
    clone(after.positions),
    clone(before.positions),
    "undo includes all turns of one block",
  );
  assert.deepEqual(clone(after.path), clone(before.path));
  const sample = bank[0],
    start = rules.create(sample);
  for (let piece = 0; piece < 10; piece++)
    for (const direction of Object.keys(rules.directions)) {
      const state = clone(start),
        original = clone(state);
      if (rules.move(sample, state, piece, direction))
        assert(rules.valid(sample, state.positions));
      else assert.deepEqual(state, original, "invalid moves are atomic");
    }
  assert(!rules.move(sample, start, -1, "d"));
  assert(!rules.move(sample, start, 0, "diagonal"));
  const save = fresh(sample);
  assert(archive.normalize(id, save));
  for (const bad of [
    { ...clone(save), version: 2 },
    { ...clone(save), chapter: 12 },
    { ...clone(save), classics: "yes" },
    { ...clone(save), current: "unknown" },
    { ...clone(save), completed: { [sample.id]: clone(start) } },
  ])
    assert.throws(() => archive.normalize(id, bad));
  const tampered = clone(save);
  tampered.drafts[sample.id].positions[0] = 0;
  assert.throws(() => archive.normalize(id, tampered));
  assert.equal(rules.replay(sample, [{ piece: 0, route: "x" }]), null);
  assert.equal(
    rules.replay(sample, [
      { piece: 0, route: "l" },
      { piece: 0, route: "r" },
    ]),
    null,
  );
  const complete = rules.replay(sample, cert(sample).solution);
  complete.elapsed = 5000;
  const a = fresh(sample, complete);
  a.completed[sample.id] = clone(complete);
  archive.addCompletion(a, sample.id, complete.path);
  const retainedPath = clone(a.completionHistory[sample.id][0].path);
  complete.path[0].route += "l";
  assert.deepEqual(
    clone(a.completionHistory[sample.id][0].path),
    retainedPath,
    "completion paths must not share mutable move groups with the live board",
  );
  const b = clone(a);
  b.completed[sample.id].elapsed = 3000;
  const merged = archive.merge(
    id,
    archive.normalize(id, a),
    archive.normalize(id, b),
  );
  assert.equal(merged.value.completed[sample.id].elapsed, 3000);
  assert.equal(merged.value.completionHistory[sample.id].length, 1);
  const other = fresh(bank[1]);
  const conflict = archive.merge(
    id,
    archive.normalize(id, a),
    archive.normalize(id, other),
    "incoming",
  );
  assert(conflict.conflict);
  assert.equal(
    conflict.value.current,
    bank[1].id,
    "chosen import keeps its selected level",
  );
  const invalidHistory = clone(a);
  invalidHistory.completionHistory[sample.id][0].path = [];
  assert.throws(() => archive.normalize(id, invalidHistory));
  const wrapped = {
    type: archive.TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    games: { [id]: archive.normalize(id, a) },
  };
  assert.deepEqual(
    clone(await archive.decode(await archive.encode(wrapped))),
    clone(wrapped),
  );
  const values = new Map(),
    memory = {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    };
  const owner = archive.create(() => memory);
  assert.equal(owner.progressSummary(id).kind, "empty");
  for (const retired of app.data.klotskiRetired) {
    memory.setItem(
      key,
      JSON.stringify({
        version: 1,
        drafts: { [retired.id]: { started: true } },
        completed: { [retired.id]: {} },
      }),
    );
    assert.equal(
      owner.progressSummary(id).kind,
      "empty",
      "retired layouts do not inflate the menu completion count",
    );
  }
  memory.setItem(key, JSON.stringify(a));
  assert.equal(owner.progressSummary(id).value, 1);
  const backup = owner.exportArchive();
  const destination = new Map(),
    target = archive.create(() => ({
      getItem: (k) => destination.get(k) ?? null,
      setItem: (k, v) => destination.set(k, v),
      removeItem: (k) => destination.delete(k),
    }));
  target.commit(target.preview(backup));
  assert.deepEqual(
    clone(target.read().games[id]),
    clone(archive.normalize(id, a)),
  );
  console.log(
    "300 puzzle certificates, exact generation, move grouping, validation and archive verified.",
  );
}
async function verifyUI() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1280, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    const entry = pathToFileURL(path.join(site, "index.html")).href;
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.games.get("game-klotski").retiredIds.length,
      ),
      app.data.klotskiRetired.length,
      "lazy catalog carries retired IDs without loading puzzle data",
    );
    await launchGame(page, id);
    await page.waitForFunction(
      () =>
        document.querySelector("#gameShell")?.dataset.state === "open" &&
        !document
          .querySelector(".workspace")
          .classList.contains("is-game-transitioning"),
    );
    assert.equal(await page.locator("[data-klotski-chapter]").count(), 12);
    for (let chapter = 0; chapter < 12; chapter++) {
      await page.locator(`[data-klotski-chapter="${chapter}"]`).click();
      assert.equal(await page.locator("[data-klotski-level]").count(), 25);
    }
    await page.locator('[data-klotski-action="classics"]').click();
    assert.equal(
      await page.locator("[data-klotski-level]").count(),
      bank.filter((l) => l.chapter === 11 && l.classic !== undefined).length,
    );
    for (let chapter = 0; chapter < 12; chapter++) {
      await page.locator(`[data-klotski-chapter="${chapter}"]`).click();
      const named = bank.filter(
        (l) => l.chapter === chapter && l.classic !== undefined,
      );
      assert.equal(
        await page.locator("[data-klotski-level]").count(),
        named.length,
      );
      for (const entry of named) {
        const card = page.locator(`[data-klotski-level="${entry.id}"]`);
        assert(
          (await card.locator(".klotski-classic-name").innerText()).trim(),
        );
        assert(
          [...(await card.locator(".klotski-classic-name").innerText())]
            .length <= 5,
        );
        assert.equal(await card.locator(".klotski-source-tag").count(), 0);
      }
    }
    const shots = path.join(root, "test-results/klotski");
    fs.mkdirSync(shots, { recursive: true });
    await page.waitForTimeout(350);
    await page
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "named-levels.png") });
    await page.locator('[data-klotski-action="classics"]').click();
    await page.locator('[data-klotski-chapter="0"]').click();
    await page.waitForTimeout(350);
    await page
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "levels.png") });
    const sample = bank.find((l) => {
      const c = cert(l),
        first = c.solution[0];
      if (l.chapter !== 0 || c.solution.length < 3 || first.route.length < 2)
        return false;
      const after = rules.replay(l, [first]);
      return !rules.move(l, after, first.piece, first.route.at(-1));
    });
    await page.locator(`[data-klotski-level="${sample.id}"]`).click();
    const read = () =>
      page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
    const action = (name) => page.locator(`[data-klotski-action="${name}"]`);
    const first = cert(sample).solution[0];
    // Real pointer capture, including a change of direction within one counted move.
    const piece = page.locator(`[data-piece="${first.piece}"]`),
      box = await piece.boundingBox();
    const cell = (await page.locator(".klotski-tiles").boundingBox()).width / 4;
    let x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const [initialDX, initialDY] = rules.directions[first.route[0]];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x + initialDX * cell * 0.3,
      y + initialDY * cell * 0.3,
      { steps: 3 },
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const following = await piece.boundingBox();
    assert(
      Math.abs(following.x - box.x - initialDX * cell * 0.3) < 2 &&
        Math.abs(following.y - box.y - initialDY * cell * 0.3) < 2,
      "a partial drag follows the pointer continuously",
    );
    assert.equal(
      (await read()).drafts[sample.id].path.length,
      0,
      "fractional movement does not create a move",
    );
    await page
      .locator(".klotski-board-host")
      .screenshot({ path: path.join(shots, "drag-follow.png") });
    await page.mouse.up();
    assert.equal(
      await piece.evaluate((el) => el.classList.contains("is-settling")),
      true,
      "release animates back to the grid",
    );
    await piece.evaluate((el) => {
      const animation = el
        .getAnimations()
        .find((a) =>
          a.effect
            .getKeyframes()
            .some((f) => String(f.transform).startsWith("translate(")),
        );
      animation.pause();
      animation.currentTime = 20;
      document.addEventListener(
        "pointerdown",
        (event) => {
          const target = event.target.closest("[data-piece]");
          if (target) {
            const r = target.getBoundingClientRect();
            window.klotskiRegrabPosition = { x: r.x, y: r.y };
          }
        },
        { capture: true, once: true },
      );
    });
    const held = await piece.boundingBox();
    await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
    await page.mouse.down();
    const regrabbed = await piece.boundingBox(),
      regrabStart = await page.evaluate(() => window.klotskiRegrabPosition);
    assert(
      Math.abs(regrabbed.x - regrabStart.x) < 1 &&
        Math.abs(regrabbed.y - regrabStart.y) < 1,
      "grabbing during snap animation never jumps to the grid",
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".klotski-piece.is-settling"),
    );
    assert.deepEqual(
      (await read()).drafts[sample.id].positions,
      clone(sample.pieces.map((p) => p[2])),
    );
    await page.evaluate((saveKey) => {
      window.klotskiDragMetrics = { writes: 0, catalogUpdates: 0 };
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === saveKey) window.klotskiDragMetrics.writes++;
        return original.call(this, key, value);
      };
      const observer = new MutationObserver((records) => {
        window.klotskiDragMetrics.catalogUpdates += records.length;
      });
      observer.observe(
        document.querySelector("#klotski-level-page .game-level-categories"),
        { childList: true, subtree: true },
      );
      window.stopKlotskiDragMetrics = () => {
        Storage.prototype.setItem = original;
        observer.disconnect();
      };
    }, key);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const d of first.route) {
      const [dx, dy] = rules.directions[d];
      x += dx * cell;
      y += dy * cell;
      await page.mouse.move(x, y, { steps: 5 });
    }
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const wall = await piece.boundingBox();
    const [wallDX, wallDY] = rules.directions[first.route.at(-1)];
    x += wallDX * cell * 0.9;
    y += wallDY * cell * 0.9;
    await page.mouse.move(x, y, { steps: 4 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    x -= wallDX * cell * 0.2;
    y -= wallDY * cell * 0.2;
    await page.mouse.move(x, y, { steps: 2 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const reversed = await piece.boundingBox();
    const reverseDistance =
      (wall.x - reversed.x) * wallDX + (wall.y - reversed.y) * wallDY;
    assert(
      reverseDistance > cell * 0.15 && reverseDistance < cell * 0.3,
      "reversing responds immediately after pushing beyond a wall",
    );
    const metrics = await page.evaluate(() => window.klotskiDragMetrics);
    assert.equal(
      metrics.writes,
      0,
      "active dragging never blocks on synchronous save writes",
    );
    assert.equal(
      metrics.catalogUpdates,
      0,
      "dragging does not rebuild the hidden level catalog",
    );
    await page.mouse.up();
    let saved = await read();
    assert(
      (await page.evaluate(() => window.klotskiDragMetrics.writes)) > 0,
      "release persists accepted moves",
    );
    await page.evaluate(() => window.stopKlotskiDragMetrics());
    assert.equal(saved.drafts[sample.id].path.length, 1);
    assert.equal(saved.drafts[sample.id].path[0].route, first.route);
    await action("undo").click();
    assert.deepEqual(
      (await read()).drafts[sample.id].positions,
      clone(sample.pieces.map((p) => p[2])),
    );
    const turnLevel = bank.find((l) =>
      /[lr][ud]|[ud][lr]/.test(cert(l).solution[0].route),
    );
    const turn = cert(turnLevel).solution[0];
    await action("choose").click();
    await page.locator(`[data-klotski-chapter="${turnLevel.chapter}"]`).click();
    await page.locator(`[data-klotski-level="${turnLevel.id}"]`).click();
    const turningPiece = page.locator(`[data-piece="${turn.piece}"]`),
      turnBox = await turningPiece.boundingBox();
    let turnX = turnBox.x + turnBox.width / 2,
      turnY = turnBox.y + turnBox.height / 2;
    await page.mouse.move(turnX, turnY);
    await page.mouse.down();
    for (const d of turn.route) {
      const [dx, dy] = rules.directions[d];
      turnX += dx * cell;
      turnY += dy * cell;
      await page.mouse.move(turnX, turnY);
    }
    await page.mouse.up();
    const turnSave = (await read()).drafts[turnLevel.id];
    assert.equal(turnSave.path.length, 1);
    assert.equal(
      turnSave.path[0].route,
      turn.route,
      "coalesced frames preserve a fast corner turn",
    );
    await action("choose").click();
    await page.locator(`[data-klotski-chapter="${sample.chapter}"]`).click();
    await page.locator(`[data-klotski-level="${sample.id}"]`).click();
    const arrows = {
      l: "ArrowLeft",
      r: "ArrowRight",
      u: "ArrowUp",
      d: "ArrowDown",
    };
    await piece.focus();
    await page.keyboard.press("Enter");
    for (const d of first.route) await page.keyboard.press(arrows[d]);
    assert.equal((await read()).drafts[sample.id].path.length, 1);
    await page.waitForTimeout(1100);
    await action("restart").click();
    const elapsed = (await read()).drafts[sample.id].elapsed;
    await page.waitForTimeout(1100);
    assert((await read()).drafts[sample.id].elapsed - elapsed < 100);
    await action("cancel").click();
    await action("choose").click();
    const chooserTime = (await read()).drafts[sample.id].elapsed;
    await page.waitForTimeout(1100);
    assert.equal((await read()).drafts[sample.id].elapsed, chooserTime);
    await page.locator(`[data-klotski-level="${sample.id}"]`).click();
    await page
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "board.png") });
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await launchGame(page, id);
    assert.equal((await read()).current, sample.id);
    assert.equal((await read()).drafts[sample.id].path.length, 1);
    await action("restart").click();
    await action("accept").click();
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("full"),
    );
    async function playSteps(steps) {
      for (const step of steps) {
        await page.locator(`[data-piece="${step.piece}"]`).focus();
        await page.keyboard.press("Enter");
        for (const d of step.route) await page.keyboard.press(arrows[d]);
      }
    }
    await playSteps(cert(sample).solution.slice(0, -1));
    const finalMove = cert(sample).solution.at(-1);
    const finalPiece = page.locator(`[data-piece="${finalMove.piece}"]`);
    const finalBox = await finalPiece.boundingBox();
    let finishX = finalBox.x + finalBox.width / 2,
      finishY = finalBox.y + finalBox.height / 2;
    await page.mouse.move(finishX, finishY);
    await page.mouse.down();
    for (const d of finalMove.route) {
      const [dx, dy] = rules.directions[d];
      finishX += dx * cell;
      finishY += dy * cell;
      await page.mouse.move(finishX, finishY, { steps: 5 });
    }
    await page.mouse.up();
    assert.equal(
      await page.locator(".klotski-board-host.is-escaping").count(),
      1,
    );
    assert(
      !(await page.locator(".klotski-cover").isVisible()),
      "result waits for Cao Cao to escape",
    );
    await page.waitForFunction(() =>
      document
        .querySelector('[data-kind="cao"]')
        .getAnimations()
        .some((a) =>
          a.effect
            .getKeyframes()
            .some((f) => f.transform === "translateY(110%)"),
        ),
    );
    // Sample the exit halfway through: both translation and fading must occur.
    const midway = await page.locator('[data-kind="cao"]').evaluate((el) => {
      const animation = el
        .getAnimations()
        .find((a) =>
          a.effect
            .getKeyframes()
            .some((f) => f.transform === "translateY(110%)"),
        );
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 550;
      const style = getComputedStyle(el);
      return {
        opacity: Number(style.opacity),
        y: new DOMMatrixReadOnly(style.transform).m42,
      };
    });
    assert(midway && midway.opacity > 0 && midway.opacity < 1 && midway.y > 0);
    await page
      .locator(".klotski-board-host")
      .screenshot({ path: path.join(shots, "escape.png") });
    await page.locator('[data-kind="cao"]').evaluate((el) => {
      el.getAnimations()
        .find((a) =>
          a.effect
            .getKeyframes()
            .some((f) => f.transform === "translateY(110%)"),
        )
        ?.finish();
    });
    await page.locator(".klotski-cover").waitFor();
    assert.equal(
      await page.locator(".klotski-board-host.is-escaping").count(),
      0,
    );
    assert.equal(
      await page
        .locator('[data-kind="cao"]')
        .evaluate((el) => getComputedStyle(el).visibility),
      "hidden",
    );
    saved = await read();
    assert.equal(saved.completed[sample.id].path.length, cert(sample).minimum);
    assert.equal(saved.completionHistory[sample.id].length, 1);
    assert.equal(
      await page
        .locator(
          '.game-klotski [data-klotski-action*="hint"], .game-klotski [data-klotski-action*="solve"], .game-klotski [data-klotski-action*="replay"]',
        )
        .count(),
      0,
    );
    // Undo and leaving the board invalidate pending animation callbacks.
    await action("accept").click();
    await playSteps(cert(sample).solution);
    await action("undo").click();
    assert.equal(
      await page.locator(".klotski-board-host.is-escaping").count(),
      0,
    );
    await page.waitForTimeout(1100);
    assert(!(await page.locator(".klotski-cover").isVisible()));
    await playSteps(cert(sample).solution.slice(-1));
    await action("choose").click();
    await page.waitForTimeout(1100);
    assert(await page.locator("#klotski-level-page").isVisible());
    await page.locator(`[data-klotski-level="${sample.id}"]`).click();
    assert(await page.locator(".klotski-cover").isVisible());
    assert.equal(
      await page.locator(".klotski-board-host.is-escaping").count(),
      0,
      "restoring a solved board does not replay the escape",
    );
    await action("accept").click();
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
    );
    await playSteps(cert(sample).solution);
    assert(await page.locator(".klotski-cover").isVisible());
    assert.equal(
      await page.locator(".klotski-board-host.is-escaping").count(),
      0,
      "reduced motion settles directly to the result",
    );
    await action("next").click();
    assert.notEqual((await read()).current, sample.id);
    // Switching language preserves geometry, history and a usable chooser.
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((l) => WorkTimeApp.i18n.setLanguage(l), language);
      assert(
        !(await page.locator(".game-klotski").innerText()).includes(
          "games.klotski.",
        ),
      );
    }
    await action("choose").click();
    const classic = bank.find((l) => l.classic === 0);
    await page.locator(`[data-klotski-chapter="${classic.chapter}"]`).click();
    await page.locator(`[data-klotski-level="${classic.id}"]`).click();
    await page
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "classic.png") });
    assert.equal(await page.locator("[data-piece]").count(), 10);
    // Touch context uses the same offline entry and bank without server dependencies.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const phone = await mobile.newPage();
    phone.on("pageerror", (e) => errors.push(e.message));
    await phone.route(/^https?:/, (route) => route.abort());
    await phone.goto(entry);
    await phone.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await launchGame(phone, id, { touch: true });
    await phone.waitForFunction(
      () =>
        document.querySelector("#gameShell")?.dataset.state === "open" &&
        !document
          .querySelector(".workspace")
          .classList.contains("is-game-transitioning"),
    );
    const touchFilter = phone.locator('[data-klotski-action="classics"]');
    await touchFilter.tap();
    assert.equal(
      await touchFilter.getAttribute("aria-pressed"),
      "true",
      "a touch action fires once, without a duplicate compatibility click",
    );
    await touchFilter.tap();
    assert.equal(await touchFilter.getAttribute("aria-pressed"), "false");
    await phone.locator('[data-klotski-chapter="8"]').tap();
    await phone.waitForTimeout(350);
    await phone
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "named-mobile.png") });
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await phone.locator('[data-klotski-chapter="0"]').tap();
    await phone.locator(`[data-klotski-level="${sample.id}"]`).tap();
    const touchBox = await phone
      .locator(`[data-piece="${first.piece}"]`)
      .boundingBox();
    const mobileCell =
      (await phone.locator(".klotski-tiles").boundingBox()).width / 4;
    const session = await mobile.newCDPSession(phone);
    let tx = touchBox.x + touchBox.width / 2,
      ty = touchBox.y + touchBox.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: tx, y: ty }],
    });
    const [dx, dy] = rules.directions[first.route[0]];
    tx += dx * mobileCell;
    ty += dy * mobileCell;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: tx, y: ty }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(
      await phone.evaluate(
        (k) =>
          JSON.parse(localStorage.getItem(k)).drafts[
            JSON.parse(localStorage.getItem(k)).current
          ].path.length,
        key,
      ),
      1,
    );
    assert(
      await phone.locator(".klotski-board").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
    );
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await phone.waitForTimeout(350);
    assert(
      await phone.locator(".klotski-board").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0;
      }),
    );
    await phone
      .locator(".game-klotski")
      .screenshot({ path: path.join(shots, "mobile.png") });
    await phone.locator('[data-klotski-action="choose"]').tap();
    await phone
      .locator("#klotski-level-page")
      .waitFor({ state: "visible", timeout: 3000 });
    assert.deepEqual(errors, []);
    await mobile.close();
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(
    "Offline UI, 12 groups of 25, classic filter, animated drag following/snapping, drag-to-win, touch controls, keyboard, whole-move undo, timer, resume, records and six languages verified: " +
      site,
  );
}
(async () => {
  await verifyRules();
  if (!process.argv.includes("--rules")) await verifyUI();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
