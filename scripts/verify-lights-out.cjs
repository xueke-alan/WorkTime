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
const site = path.resolve(process.argv[2] || root);
const key = "worktime.games.lights-out.v1";
const id = "game-lights-out";
const copy = (v) => JSON.parse(JSON.stringify(v));
const context = vm.createContext({
  WorkTimeApp: { data: {}, games: {}, services: {} },
  window: { navigator: {} },
  TextEncoder,
});
for (const file of [
  "assets/data/lights-out-legacy.js",
  "assets/data/lights-out.js",
  "assets/js/games/lights-out-rules.js",
  "assets/js/services/game-archive.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const app = context.WorkTimeApp,
  rules = app.games.lightsOutRules;
const levels = app.data.lightsOut,
  archive = app.services.gameArchive;
// Independent exact solver: enumerate the first row and chase lit cells downward.
function chase(level) {
  const n = level.size;
  let minimum = Infinity;
  for (let mask = 0; mask < 2 ** n; mask++) {
    const board = Array.from(level.board, Number);
    let moves = 0;
    function press(r, c) {
      moves++;
      for (const [dr, dc] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const y = r + dr,
          x = c + dc;
        if (y >= 0 && y < n && x >= 0 && x < n) board[y * n + x] ^= 1;
      }
    }
    for (let c = 0; c < n; c++) if ((mask >>> c) & 1) press(0, c);
    for (let r = 1; r < n; r++)
      for (let c = 0; c < n; c++) if (board[(r - 1) * n + c]) press(r, c);
    if (board.every((v) => !v)) minimum = Math.min(minimum, moves);
  }
  return minimum;
}
function fixture(index = 0, finish = false) {
  const level = levels[index],
    state = rules.create(level);
  if (finish) for (const i of level.solution) rules.move(state, i, level.size);
  return {
    version: 1,
    chapter: Math.floor(index / 25),
    current: level.id,
    drafts: { [level.id]: state },
    completed: finish ? { [level.id]: copy(state) } : {},
  };
}
assert.equal(levels.length, 100);
assert.deepEqual(Array.from(rules.sizes), [4, 5, 6, 7]);
const retired = app.data.lightsOutRetired[0];
const legacyState = rules.create(retired);
for (const index of retired.solution)
  rules.move(legacyState, index, retired.size);
const legacy = rules.restore({
  version: 1,
  chapter: 4,
  current: retired.id,
  drafts: { [retired.id]: legacyState },
  completed: { [retired.id]: legacyState },
});
assert(legacy && legacy.current === null && legacy.chapter === 3);
assert(legacy.completed[retired.id]);
assert(archive.normalize(id, legacy).completed[retired.id]);
for (let chapter = 0; chapter < 4; chapter++) {
  const group = levels.slice(chapter * 25, chapter * 25 + 25);
  assert.equal(new Set(group.map((l) => l.board)).size, 25);
  let previous = 0;
  for (const level of group) {
    assert.equal(level.size, chapter + 4);
    assert.equal(level.board.length, level.size ** 2);
    assert(/^[01]+$/.test(level.board));
    assert.equal(level.minimum, chase(level));
    assert.equal(
      rules.solve(Array.from(level.board, Number), level.size).length,
      level.minimum,
    );
    assert(
      level.minimum >= previous &&
        level.minimum >= { 4: 7, 5: 13, 6: 24, 7: 32 }[level.size],
    );
    previous = level.minimum;
    const state = rules.create(level),
      before = copy(state.board);
    for (const index of level.solution)
      assert(rules.move(state, index, level.size));
    assert(rules.won(state.board));
    assert(!rules.move(state, 0, level.size));
    while (state.path.length) assert(rules.undo(state, level.size));
    assert.deepEqual(copy(state.board), before);
    assert(!rules.move(state, level.size ** 2, level.size));
    assert(!rules.move(state, -1, level.size));
  }
}
assert.deepEqual(copy(rules.neighbors(0, 7)), [0, 7, 1]);
assert.deepEqual(copy(rules.neighbors(3, 7)), [3, 10, 2, 4]);
assert.deepEqual(copy(rules.neighbors(24, 7)), [24, 17, 31, 23, 25]);
const board49 = Array(49).fill(0);
rules.flip(board49, 48, 7);
assert.deepEqual(
  board49.flatMap((v, i) => (v ? [i] : [])),
  [41, 47, 48],
);
rules.flip(board49, 48, 7);
assert(rules.won(board49));
for (const corrupt of [
  (s) => (s.drafts[s.current].board[0] = 9),
  (s) => s.drafts[s.current].path.push(99),
  (s) => (s.drafts[s.current].elapsed = -1),
  (s) => (s.drafts[s.current].started = "yes"),
  (s) => (s.current = "unknown"),
  (s) => (s.chapter = 5),
  (s) => (s.completed[s.current] = s.drafts[s.current]),
]) {
  const save = fixture();
  corrupt(save);
  assert.equal(rules.restore(save), null);
}
const finished = fixture(24, true),
  local = fixture(24, true),
  incoming = fixture(24, true);
local.completed[local.current].elapsed = 2000;
incoming.completed[incoming.current].elapsed = 900;
assert.equal(
  archive.merge(id, local, incoming).value.completed[local.current].elapsed,
  900,
);
const longer = fixture(24);
const target = levels[24];
rules.move(longer.drafts[target.id], 0, target.size);
rules.move(longer.drafts[target.id], 0, target.size);
for (const i of target.solution)
  rules.move(longer.drafts[target.id], i, target.size);
longer.completed[target.id] = copy(longer.drafts[target.id]);
assert.equal(
  archive.merge(id, local, longer).value.completed[target.id].path.length,
  target.minimum,
);
const a = fixture(1),
  b = fixture(2);
rules.move(a.drafts[a.current], 0, 4);
rules.move(b.drafts[b.current], 1, 4);
const merged = archive.merge(id, a, b, "incoming");
assert(merged.conflict);
assert.equal(merged.value.current, b.current);
assert.equal(Object.keys(merged.value.drafts).length, 2);
const values = new Map();
const storage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
  removeItem: (k) => values.delete(k),
};
const owner = archive.create(() => storage);
owner.session().setItem(key, JSON.stringify(finished));
assert.equal(owner.progressSummary(id).kind, "completed");
const raw = owner.read().raw;
delete raw[id];
storage.setItem(
  archive.JOURNAL,
  JSON.stringify({ version: 1, revision: "legacy", before: raw }),
);
owner.recover();
assert(!owner.pendingRecovery());
async function main() {
  const exported = owner.exportArchive();
  assert.deepEqual(
    copy(await archive.decode(await archive.encode(exported))),
    copy(exported),
  );
  const old = { ...exported, games: {} };
  assert.deepEqual(
    copy(await archive.decode(await archive.encode(old))),
    copy(old),
  );
  await owner.replace(old, async () => ({ persisted: true }));
  assert.equal(storage.getItem(key), null);
  owner.commit(owner.preview(exported));
  assert(owner.read().games[id].completed[finished.current]);
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const browserContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1280, height: 1000 },
    });
    const page = await browserContext.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await launchGame(page, id);
    await page.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "open",
    );
    assert.equal(await page.locator(".lights-level").count(), 25);
    assert(await page.locator(".lights-chooser").isVisible());
    const chooseChapter = async (chapter) => {
      await page.locator(`[data-lights-chapter="${chapter}"]`).click();
    };
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const press = (index) => page.locator(`[data-cell="${index}"]`).click();
    const action = (name) => page.locator(`[data-lights-action="${name}"]`);
    // Test arbitrary access, all four artworks and both viewport sizes.
    const shapes = new Set();
    const screenshots = path.join(root, "test-results/lights-out");
    fs.mkdirSync(screenshots, { recursive: true });
    for (let chapter = 0; chapter < 4; chapter++) {
      await chooseChapter(chapter);
      await page.locator(".lights-level").last().click();
      assert.equal(
        await page.locator(".lights-cell").count(),
        (chapter + 4) ** 2,
      );
      shapes.add(await page.locator(".lights-cell svg").first().innerHTML());
      assert.equal(await page.locator(".lights-stats .game-stat").count(), 2);
      assert.equal(
        await page.locator(".lights-level-title").textContent(),
        "第 " + String((chapter + 1) * 25) + " 关",
      );
      assert.equal(
        await page
          .locator(
            ".lights-help, .lights-caption, .lights-board-heading, #lightsChapter",
          )
          .count(),
        0,
      );
      assert(
        await page.locator(".lights-cells").evaluate((el) => {
          const rgb = getComputedStyle(el)
            .backgroundColor.match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
          return rgb.every((channel) => channel >= 230);
        }),
        "Every chapter uses a light board",
      );
      await page.screenshot({
        path: path.join(screenshots, `theme-${chapter}-desktop.png`),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await page.locator(".lights-board").boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
      assert(
        await page
          .locator(".lights-cells")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      assert(
        await page
          .locator(".lights-stats")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({
        path: path.join(screenshots, `theme-${chapter}-mobile.png`),
      });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await action("choose").click();
    }
    assert.equal(shapes.size, 4);
    assert(await page.locator(".game-level-categories").isVisible());
    assert.equal(await page.locator(".lights-header").isVisible(), false);
    assert.equal(await page.locator(".lights-actions").isVisible(), false);
    await page.screenshot({ path: path.join(screenshots, "level-page.png") });
    await page.locator(".lights-chooser .game-level-return").click();
    assert(await page.locator(".lights-board").isVisible());
    await action("choose").click();
    await chooseChapter(0);
    await page.locator(".lights-level").last().click();
    await page.locator('[data-cell="0"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.cell),
      "1",
    );
    await page.keyboard.press("Space");
    const moved = await read(),
      current = moved.current;
    assert.equal(moved.drafts[current].path.length, 1);
    await page.waitForTimeout(1150);
    await action("restart").click();
    const elapsed = (await read()).drafts[current].elapsed;
    await page.waitForTimeout(1150);
    assert.equal((await read()).drafts[current].elapsed, elapsed);
    await action("cancel").click();
    await action("undo").click();
    assert.equal((await read()).drafts[current].path.length, 0);
    assert((await read()).drafts[current].elapsed >= elapsed);
    await action("restart").click();
    await action("accept").click();
    assert.equal((await read()).drafts[current].elapsed, 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const index of levels[24].solution) await press(index);
    await page.locator(".lights-cover").waitFor();
    assert.equal(await page.locator(".game-celebration").count(), 0);
    assert.equal(
      (await read()).completed[current].path.length,
      levels[24].minimum,
    );
    assert(await action("next").isVisible());
    const record = copy((await read()).completed[current]);
    await action("accept").click();
    assert.deepEqual((await read()).completed[current], record);
    assert.equal((await read()).drafts[current].path.length, 0);
    await press(0);
    await action("choose").click();
    assert.equal(
      await page.locator('.lights-level[data-completed="true"]').count(),
      1,
    );
    const stopped = (await read()).drafts[current].elapsed;
    await page.waitForTimeout(1100);
    assert.equal((await read()).drafts[current].elapsed, stopped);
    await page.locator(".lights-level").first().click();
    await action("choose").click();
    await page.locator(".lights-level").last().click();
    assert.equal((await read()).drafts[current].path.length, 1);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await launchGame(page, id);
    assert.equal((await read()).drafts[current].path.length, 1);
    for (const language of ["en", "ja", "ko", "zh-TW", "zh-HK", "zh-CN"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(
        await page
          .locator(
            ".lights-help, .lights-caption, .lights-board-heading, #lightsChapter",
          )
          .count(),
        0,
      );
      assert.equal(await page.locator(".lights-stats .game-stat").count(), 2);
      assert.equal(
        await page
          .locator(".lights-stats")
          .evaluate(
            (el) =>
              new Set(
                [...el.querySelectorAll("strong")].map(
                  (value) => getComputedStyle(value).fontSize,
                ),
              ).size,
          ),
        1,
      );
    }
    // Exercise lifecycle and blocked persistence with an isolated factory.
    assert(
      await page.evaluate(
        async (save) => {
          const service = WorkTimeApp.services.gameArchive,
            original = service.session;
          let stored = JSON.stringify(save),
            denied = false;
          const host = document.createElement("div");
          document.body.append(host);
          const abort = new AbortController();
          service.session = () => ({
            getItem: () => stored,
            setItem: (k, v) => {
              if (denied) throw Error("denied");
              stored = v;
            },
          });
          let instance;
          try {
            instance = WorkTimeApp.games
              .get("game-lights-out")
              .create({ container: host, signal: abort.signal });
            host.querySelector('[data-cell="0"]').click();
            await new Promise((r) => setTimeout(r, 180));
            instance.pause();
            const before = JSON.parse(stored).drafts[save.current].elapsed;
            await new Promise((r) => setTimeout(r, 180));
            instance.pause();
            if (
              JSON.parse(stored).drafts[save.current].elapsed !== before ||
              before < 150
            )
              return false;
            instance.resume();
            await new Promise((r) => setTimeout(r, 180));
            instance.pause();
            if (JSON.parse(stored).drafts[save.current].elapsed < before + 150)
              return false;
            instance.resume();
            denied = true;
            host.querySelector('[data-cell="0"]').click();
            if (!host.querySelector(".lights-warning").textContent)
              return false;
            return true;
          } finally {
            abort.abort();
            instance?.dispose();
            service.session = original;
            host.remove();
          }
        },
        copy(fixture(24)),
      ),
    );
    assert.deepEqual(errors, []);
    // Visibility and immediate victory must not leave time or input running.
    for (const scenario of ["hidden", "win", "last", "corrupt"]) {
      await page.emulateMedia({
        reducedMotion: scenario === "cancel-win" ? "no-preference" : "reduce",
      });
      const save = scenario === "last" ? fixture(99, true) : fixture(24);
      if (scenario === "cancel-win") {
        const entry = levels[24];
        for (const cell of entry.solution.slice(0, -1))
          rules.move(save.drafts[entry.id], cell, entry.size);
      }
      assert(
        await page.evaluate(
          async ({ save, scenario, lastMove }) => {
            const service = WorkTimeApp.services.gameArchive,
              original = service.session;
            let stored =
              scenario === "corrupt" ? "{broken" : JSON.stringify(save);
            const host = document.createElement("div");
            document.body.append(host);
            const abort = new AbortController();
            service.session = () => ({
              getItem: () => stored,
              setItem: (k, v) => {
                stored = v;
              },
            });
            let instance;
            const hiddenDescriptor = Object.getOwnPropertyDescriptor(
              document,
              "hidden",
            );
            try {
              instance = WorkTimeApp.games
                .get("game-lights-out")
                .create({ container: host, signal: abort.signal });
              if (scenario === "corrupt")
                return (
                  !host.querySelector(".lights-chooser").hidden &&
                  !!host.querySelector(".lights-warning").textContent
                );
              if (scenario === "last") {
                const next = host.querySelector('[data-lights-action="next"]');
                if (
                  next.textContent !== WorkTimeApp.i18n.t("games.lights.choose")
                )
                  return false;
                next.click();
                return (
                  !host.querySelector(".lights-chooser").hidden &&
                  Object.keys(JSON.parse(stored).completed).length === 1
                );
              }
              if (scenario === "cancel-win") {
                host.querySelector(`[data-cell="${lastMove}"]`).click();
                instance.pause();
                instance.resume();
                return (
                  !host.querySelector(".lights-cover").hidden &&
                  !host.querySelector(".game-celebration")
                );
              }
              host.querySelector('[data-cell="0"]').click();
              await new Promise((r) => setTimeout(r, 160));
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
              const before = JSON.parse(stored).drafts[save.current].elapsed;
              await new Promise((r) => setTimeout(r, 220));
              host.querySelector('[data-cell="1"]').click();
              instance.pause();
              return (
                JSON.parse(stored).drafts[save.current].elapsed === before &&
                JSON.parse(stored).drafts[save.current].path.length === 1
              );
            } finally {
              if (hiddenDescriptor)
                Object.defineProperty(document, "hidden", hiddenDescriptor);
              else delete document.hidden;
              document.dispatchEvent(new Event("visibilitychange"));
              abort.abort();
              instance?.dispose();
              service.session = original;
              host.remove();
            }
          },
          { save: copy(save), scenario, lastMove: levels[24].solution.at(-1) },
        ),
        scenario,
      );
    }
    assert.deepEqual(errors, []);
    await browserContext.close();
    console.log(
      "Lights Out: 100 exact-minimum puzzles, four artworks, archive compatibility, keyboard, timer, undo, records, offline reload and responsive layouts verified: " +
        site,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
