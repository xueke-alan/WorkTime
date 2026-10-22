"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  entry = path.resolve(process.argv[2] || root, "index.html");
const output = path.join(root, "test-results/garden"),
  key = "worktime.games.garden.v1";
const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/garden-rules.js"), "utf8"),
  sandbox,
);
const rules = sandbox.WorkTimeApp.games.gardenRules;
function verifyRules() {
  const illustrations = new Set();
  for (let level = 0; level < rules.levelCount; level++) {
    for (let seed = 0; seed < 8; seed++) {
      let state = rules.create(level, seed);
      const { tiles, solution } = rules.layout(level, seed);
      if (level < 3) assert.equal(tiles.length, [24, 60, 90][level]);
      assert.ok(
        tiles.every(
          (tile) =>
            tile.x >= 0 && tile.x + 1 <= 6 && tile.y >= 0 && tile.y + 1 <= 7.4,
        ),
      );
      if (level > 0) {
        const sides = tiles.filter((tile) => tile.pile.startsWith("side-"));
        assert.ok(sides.length >= 6);
        assert.equal(
          rules
            .available(tiles, [])
            .filter((tile) => tile.pile.startsWith("side-")).length,
          2,
        );
        assert.ok(
          sides.every((tile) => tile.y > 5.5),
          "Both side piles are detached from the shaped main stack",
        );
      }
      assert.equal(tiles.length % 3, 0);
      tiles.forEach((tile) => illustrations.add(tile.type));
      if (level >= 3)
        assert.equal(
          new Set(tiles.map((tile) => tile.type)).size,
          rules.difficulty(level).kinds,
        );
      // Independent geometric oracle checks the generator's removal order.
      const gone = new Set();
      for (const id of solution) {
        const tile = tiles[id];
        assert.ok(
          !tiles.some(
            (other) =>
              !gone.has(other.id) &&
              other.z > tile.z &&
              Math.abs(other.x - tile.x) < 0.99 &&
              Math.abs(other.y - tile.y) < 0.99,
          ),
        );
        assert.ok(rules.move(state, tiles, "pick", id));
        const before = JSON.stringify(state);
        const next = rules.move(state, tiles, "pick", id);
        assert.equal(JSON.stringify(state), before, "input stays immutable");
        state = next;
        gone.add(id);
        assert.ok(
          state.tray.length <= (level < 3 ? 5 : 6),
          "witness never needs reserve or tools",
        );
      }
      assert.equal(rules.phase(state, tiles), "won");
      assert.ok(rules.restore(state));
      assert.equal(rules.stars(state, tiles), 3);
      assert.equal(
        rules.stars({ ...state, hintsLeft: state.hintsLeft - 1 }, tiles),
        2,
      );
    }
  }
  assert.equal(illustrations.size, 27);
  let legacy = { ...rules.create(2, 19), layoutVersion: 1 };
  const old = rules.layout(legacy.level, legacy.seed, 1);
  for (const id of old.solution.slice(0, 5))
    legacy = rules.move(legacy, old.tiles, "pick", id);
  delete legacy.layoutVersion;
  assert.equal(
    rules.restore(legacy).layoutVersion,
    1,
    "Unversioned old rounds retain their original geometry and legal history",
  );
  const state = rules.create(2, 19),
    { tiles, solution } = rules.layout(2, 19);
  const coveredId = tiles.find((tile) => tile.above.length).id;
  assert.equal(
    rules.move(state, tiles, "pick", coveredId),
    null,
    "covered tile cannot be picked",
  );
  assert.equal(
    rules.restore({
      ...state,
      removed: [coveredId],
      tray: [coveredId],
      moves: 1,
    }),
    null,
  );
  assert.equal(rules.restore({ ...state, seed: -1 }), null);
  assert.equal(rules.restore({ ...state, tray: [solution[0]] }), null);
  let current = rules.move(state, tiles, "pick", solution[0]);
  current = rules.move(current, tiles, "store", solution[0]);
  assert.equal(current.tray.length, 0);
  assert.equal(current.reserve.length, 1);
  assert.ok(rules.restore(current));
  current = rules.move(current, tiles, "return", solution[0]);
  assert.equal(current.tray.length, 1);
  assert.equal(current.reserve.length, 0);
  assert.ok(rules.hint(current, tiles));
  // Search for an actual full tray, then prove reserve can rescue it.
  let blocked = null;
  for (let seed = 1; seed <= 200 && !blocked; seed++) {
    let attempt = rules.create(2, seed);
    const layout = rules.layout(2, seed).tiles;
    while (rules.phase(attempt, layout) === "playing") {
      const choices = rules.available(layout, attempt.removed);
      if (!choices.length) break;
      attempt = rules.move(attempt, layout, "pick", choices[0].id);
    }
    if (rules.phase(attempt, layout) === "blocked")
      blocked = { state: attempt, tiles: layout };
  }
  assert.ok(blocked);
  assert.equal(
    rules.move(
      blocked.state,
      blocked.tiles,
      "pick",
      rules.available(blocked.tiles, blocked.state.removed)[0]?.id,
    ),
    null,
  );
  const rescued = rules.move(
    blocked.state,
    blocked.tiles,
    "store",
    blocked.state.tray[0],
  );
  assert.equal(rules.phase(rescued, blocked.tiles), "playing");
  assert.ok(rules.restore(rescued));
  console.log(
    "144 seeded layouts across 18 levels solved; 27 illustrations, stars, geometry, tray capacity, reserve rescue and save validation verified.",
  );
  return { ...blocked, legacy };
}
async function main() {
  const motionOnly = process.argv.includes("--motion-only");
  const blocked = motionOnly ? null : verifyRules();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    if (motionOnly) {
      await verifyMotion(browser);
      return;
    }
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const action = (name) => page.locator(`[data-garden-action="${name}"]`);
    const load = () =>
      page.evaluate(
        (storageKey) => JSON.parse(localStorage.getItem(storageKey)),
        key,
      );
    async function open() {
      await page.locator("#date-tab-games").click();
      await page.locator('#gamesPanel [data-game="game-garden"]').click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
    }
    async function exit() {
      await page.locator("#gameExitButton").click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "closed",
      );
    }
    async function assertFits() {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const result = await page.evaluate(() => {
        const content = document.querySelector(".game-content");
        const bounds = content.getBoundingClientRect();
        const elements = [
          ".garden-header",
          ".garden-stage",
          ".garden-tray",
          ".garden-footer",
        ];
        return {
          viewport: [innerWidth, innerHeight],
          boxes: elements.map((selector) => ({
            selector,
            ...document
              .querySelector(selector)
              .getBoundingClientRect()
              .toJSON(),
          })),
          scrollX: content.scrollWidth - content.clientWidth,
          scrollY: content.scrollHeight - content.clientHeight,
          visible: elements.every((selector) => {
            const box = document
              .querySelector(selector)
              .getBoundingClientRect();
            return (
              box.top >= bounds.top - 1 &&
              box.bottom <= Math.min(bounds.bottom, innerHeight) + 1 &&
              box.left >= bounds.left - 1 &&
              box.right <= Math.min(bounds.right, innerWidth) + 1
            );
          }),
        };
      });
      assert.ok(
        result.scrollX <= 1 && result.scrollY <= 1 && result.visible,
        JSON.stringify(result),
      );
    }
    await open();
    await action("levels").click();
    assert.equal(
      await page.locator(".garden-level-grid button:enabled").count(),
      1,
    );
    await action("cancel").click();
    await page.evaluate(async () => {
      const art = document.querySelector(".garden-art");
      const source = getComputedStyle(art).backgroundImage;
      const image = new Image();
      image.src = source.slice(5, -2);
      await image.decode();
      for (const atlas of ["garden-woodland.png", "garden-pond.png"]) {
        const added = new Image();
        added.src = new URL("assets/images/games/" + atlas, location.href).href;
        await added.decode();
        if (
          added.naturalWidth < 900 ||
          added.naturalWidth !== added.naturalHeight
        )
          throw Error("Invalid added illustration atlas");
      }
      if (
        image.naturalWidth < 900 ||
        image.naturalHeight !== image.naturalWidth
      )
        throw Error("Garden illustration atlas is missing or invalid");
    });
    assert.equal(await page.locator(".garden-tile").count(), 24);
    const first = Number(
      await page
        .locator(".garden-tile:enabled")
        .first()
        .getAttribute("data-tile"),
    );
    await page.locator(`.garden-tile[data-tile="${first}"]`).click();
    await page.locator(".garden-tray button:enabled").first().click();
    assert.equal((await load()).state.reserve.length, 1);
    await page.locator(".garden-reserve button:enabled").first().click();
    assert.equal((await load()).state.reserve.length, 0);
    await action("hint").click();
    assert.equal(await page.locator(".is-hinted").count(), 1);
    await action("undo").click();
    assert.equal((await load()).state.reserve.length, 1);
    assert.equal((await load()).state.undoLeft, 2);
    assert.equal((await load()).state.hintsLeft, 2);
    const saved = (await load()).state;
    await exit();
    await open();
    assert.deepEqual((await load()).state, saved);
    await action("restart").click();
    await assertFits();
    await action("cancel").click();
    assert.deepEqual((await load()).state, saved);
    await action("restart").click();
    await action("primary").click();
    for (let level = 0; level < rules.levelCount; level++) {
      const state = (await load()).state;
      assert.equal(state.level, level);
      const { solution } = rules.layout(level, state.seed);
      if ([0, 1, 2, 8, 17].includes(level)) {
        await page.locator(".garden-stage").screenshot({
          path: path.join(output, `stack-level-${level + 1}.png`),
        });
      }
      if (level === rules.levelCount - 1) {
        for (const [width, height] of [
          [1440, 1080],
          [1366, 768],
          [1280, 720],
          [390, 844],
          [375, 667],
          [320, 568],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          await assertFits();
          await action("levels").click();
          await assertFits();
          assert.equal(
            await page.evaluate(() => {
              const board = document.querySelector(".garden-board"),
                cover = document.querySelector(".garden-cover");
              // Inert suppresses hit testing, but does not change paint order.
              // Temporarily lift it to detect tiles painted above the cover.
              board.inert = false;
              try {
                return [...board.children].every((tile) => {
                  const box = tile.getBoundingClientRect();
                  return cover.contains(
                    document.elementFromPoint(
                      box.x + box.width / 2,
                      box.y + box.height / 2,
                    ),
                  );
                });
              } finally {
                board.inert = true;
              }
            }),
            true,
            "The level picker covers every tile, including the seventh layer",
          );
          const grid = await page.locator(".garden-level-grid").boundingBox();
          const cover = await page.locator(".garden-cover").boundingBox();
          assert.ok(
            grid.y >= cover.y && grid.y + grid.height <= cover.y + cover.height,
          );
          await action("cancel").click();
          const bounds = await page.locator(".garden-stage").boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
          assert.ok(await page.locator(".garden-tile:enabled").count());
          await page
            .locator(".game-garden")
            .screenshot({ path: path.join(output, `board-${width}.png`) });
          await page.screenshot({
            path: path.join(output, `viewport-${width}x${height}.png`),
          });
        }
        await page.setViewportSize({ width: 1440, height: 1080 });
      }
      for (const id of solution)
        await page.locator(`.garden-tile[data-tile="${id}"]`).click();
      assert.equal((await load()).state.tray.length, 0);
      assert.equal(await page.locator(".garden-cover").isVisible(), true);
      await assertFits();
      assert.equal((await load()).records[level], 3);
      if (level < rules.levelCount - 1) await action("primary").click();
    }
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        language,
      );
      assert.ok(
        !(await page.locator(".game-garden").innerText()).includes(
          "games.garden.",
        ),
      );
      await assertFits();
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    await action("levels").click();
    assert.equal(
      await page.locator(".garden-level-grid button:enabled").count(),
      18,
    );
    await action("level-6").click();
    assert.equal((await load()).state.level, 6);
    assert.equal((await load()).state.hintsLeft, 2);
    await exit();
    await open();
    assert.equal((await load()).records[17], 3);
    await action("levels").click();
    await action("level-0").click();
    assert.equal((await load()).records[0], 3);
    await exit();
    await page.evaluate(
      ({ key, state }) =>
        localStorage.setItem(key, JSON.stringify({ version: 1, state })),
      { key, state: blocked.state },
    );
    await open();
    assert.equal(await page.locator(".garden-cover").isVisible(), true);
    await page.locator(".garden-tray button:enabled").first().click();
    assert.equal(await page.locator(".garden-cover").isVisible(), false);
    await action("undo").click();
    assert.equal(await page.locator(".garden-cover").isVisible(), true);
    await action("primary").click();
    assert.equal((await load()).state.seed, blocked.state.seed);
    assert.equal((await load()).state.removed.length, 0);
    await page.locator(".game-garden [data-game-help]").click();
    assert.equal(
      await page.locator(".game-garden .game-help-screen").isVisible(),
      true,
    );
    await page.locator(".game-garden [data-game-help-close]").click();
    const tile = page.locator(".garden-tile:enabled").first();
    await tile.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal((await load()).state.removed.length, 1);
    await exit();
    await page.evaluate((key) => localStorage.setItem(key, "{broken"), key);
    await open();
    assert.equal((await load()).state.level, 0);
    await exit();
    await page.evaluate(
      ({ key, state }) =>
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, state, records: [3, 3] }),
        ),
      { key, state: blocked.legacy },
    );
    await open();
    assert.equal(
      await page.locator(".game-garden").getAttribute("data-layout-version"),
      "1",
    );
    assert.equal((await load()).state.removed.length, 5);
    await action("restart").click();
    await action("primary").click();
    assert.equal(
      await page.locator(".game-garden").getAttribute("data-layout-version"),
      "2",
    );
    assert.equal((await load()).records[0], 3);
    assert.deepEqual(errors, []);
    const unavailable = await context.newPage();
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
    await unavailable.locator('[data-game="game-garden"]').click();
    assert.ok(
      (await unavailable.locator(".garden-warning").innerText()).length,
    );
    assert.equal(await unavailable.locator(".garden-tile").count(), 24);
    console.log(
      "Garden UI: all rounds, reserve, undo, hints, retry, confirmation, save/resume, help, six languages, keyboard, mobile, corrupt/unavailable storage and offline entry verified: " +
        entry,
    );
    await verifyMotion(browser);
  } finally {
    await browser.close();
  }
}
async function verifyMotion(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const initial = rules.create(0, 19),
    { solution } = rules.layout(0, 19);
  await page.addInitScript(
    ({ key, initial }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, state: initial })),
    { key, initial },
  );
  await page.goto(pathToFileURL(entry).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#date-tab-games").click();
  await page.locator('[data-game="game-garden"]').click();
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
  const action = (name) => page.locator(`[data-garden-action="${name}"]`);
  const tile = (id) => page.locator(`.garden-tile[data-tile="${id}"]`);
  const settled = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".game-garden")?.dataset.busy !== "true" &&
        !document.querySelector(".garden-flight"),
    );
  const load = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state, key);
  await page.evaluate(() => {
    const nativeAnimate = Element.prototype.animate;
    window.gardenMotionAudit = {
      samples: 0,
      collapsed: 0,
      bursts: 0,
      particles: 0,
      errors: [],
    };
    let lastBurst = null;
    new MutationObserver(() => {
      const burst = document.querySelector(".garden-burst");
      if (burst && burst !== lastBurst) {
        lastBurst = burst;
        window.gardenMotionAudit.bursts++;
        window.gardenMotionAudit.particles = burst.children.length;
      }
    }).observe(document.querySelector(".garden-motion"), {
      childList: true,
      subtree: true,
    });
    Element.prototype.animate = function (frames, options) {
      const animation = nativeAnimate.call(this, frames, options);
      if (this.matches(".garden-flight, .garden-burst > i")) {
        const element = this,
          endpoint = frames.at(-1);
        animation.finished.then(
          () =>
            queueMicrotask(() => {
              if (!element.isConnected) return;
              const audit = window.gardenMotionAudit;
              audit.samples++;
              const actual = getComputedStyle(element);
              if (endpoint.transform) {
                const expected = new DOMMatrix(
                  endpoint.transform,
                ).toFloat64Array();
                const painted = new DOMMatrix(
                  actual.transform,
                ).toFloat64Array();
                if (
                  expected.some(
                    (value, i) => Math.abs(value - painted[i]) > 0.01,
                  )
                )
                  audit.errors.push(
                    "Track jumped after native fill was released",
                  );
              }
              if (
                endpoint.opacity !== undefined &&
                Math.abs(Number(actual.opacity) - Number(endpoint.opacity)) >
                  0.01
              )
                audit.errors.push("Completed match became visible again");
              if (
                element.classList.contains("garden-flight") &&
                endpoint.opacity === 0
              ) {
                const burst = document
                  .querySelector(".garden-burst")
                  .getBoundingClientRect();
                const box = element.getBoundingClientRect();
                audit.collapsed++;
                if (
                  Math.hypot(
                    box.x + box.width / 2 - burst.x,
                    box.y + box.height / 2 - burst.y,
                  ) > 0.5
                )
                  audit.errors.push(
                    "Triple shrank away from the shared center",
                  );
              }
            }),
          () => {},
        );
      }
      return animation;
    };
  });
  await tile(solution[0]).click();
  assert.equal(await page.locator('.game-garden[data-busy="true"]').count(), 1);
  assert.ok(await page.locator(".garden-flight").count());
  await page.screenshot({ path: path.join(output, "flight.png") });
  await settled();
  await action("store").click();
  await settled();
  assert.equal((await load()).reserve.length, 1);
  await page.locator(".garden-reserve button:enabled").first().click();
  await settled();
  assert.equal((await load()).reserve.length, 0);
  await action("undo").click();
  await settled();
  assert.equal((await load()).reserve.length, 1);
  await page.locator(".garden-reserve button:enabled").first().click();
  await settled();
  let removed = 0,
    sawBurst = false;
  for (const id of solution.slice(1, 12)) {
    const before = await load();
    await tile(id).click();
    const after = await load();
    if (after.tray.length < before.tray.length) {
      sawBurst = true;
    }
    await settled();
    removed = after.removed.length;
    if (sawBurst) break;
  }
  assert.ok(
    sawBurst,
    "A matched triple gathers and bursts before remaining tiles settle",
  );
  const motionAudit = await page.evaluate(() => window.gardenMotionAudit);
  assert.ok(motionAudit.samples > 8 && motionAudit.collapsed >= 3);
  assert.ok(motionAudit.bursts >= 1);
  assert.equal(motionAudit.particles, 8);
  assert.deepEqual(
    motionAudit.errors,
    [],
    "Every completed track retains its exact endpoint between animation phases",
  );
  assert.equal(await page.locator('[style*="visibility: hidden"]').count(), 0);
  const nextId = solution[removed];
  await tile(nextId).click();
  await page.setViewportSize({ width: 375, height: 667 });
  await settled();
  assert.equal((await load()).removed.length, removed + 1);
  await tile(solution[removed + 1]).click();
  await page.locator("#gameExitButton").click();
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "closed",
  );
  assert.equal(await page.locator(".garden-motion").count(), 0);
  await page.locator('[data-game="game-garden"]').click();
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
  assert.equal((await load()).removed.length, removed + 2);
  // Real hit testing while motion is running: no force-click or synthetic
  // dispatch, which would miss a CSS pointer-events input lock regression.
  const rapidStart = (await load()).removed.length;
  const rapidIds = solution.slice(rapidStart, rapidStart + 8);
  for (const id of rapidIds) {
    const box = await tile(id).boundingBox();
    assert.ok(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(
      (await load()).removed.at(-1),
      id,
      "Every rapid click is committed immediately, including newly exposed tiles",
    );
  }
  await settled();
  assert.deepEqual(
    (await load()).removed.slice(rapidStart),
    Array.from(rapidIds),
  );
  assert.equal(await page.locator('[style*="visibility: hidden"]').count(), 0);
  assert.equal(await page.locator(".garden-flight").count(), 0);
  assert.ok(
    rules.restore(await load()),
    "Rapid picks leave a valid restorable game",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  const saved = await load();
  await tile(solution[saved.removed.length]).click();
  await settled();
  assert.equal(await page.locator(".garden-flight").count(), 0);
  // Motion is optional: an unavailable native API must settle every phase.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Element.prototype.animate = () => {
      throw Error("Animation unavailable");
    };
  });
  await tile(solution[(await load()).removed.length]).click();
  await settled();
  await action("levels").click();
  await page
    .locator(".garden-level-grid")
    .screenshot({ path: path.join(output, "level-picker.png") });
  await action("cancel").click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Garden motion: flight, triple gather/burst, rack compaction, reserve, reverse undo, resize/exit cleanup, reduced motion and unavailable animation APIs verified.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
