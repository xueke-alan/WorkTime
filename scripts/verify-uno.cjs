"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
async function setDocumentHidden(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
const site = path.resolve(
  process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || root,
);
const scope = vm.createContext({
  performance,
  TextEncoder,
  WorkTimeApp: { games: {}, services: {} },
});
for (const name of ["games/uno-rules", "games/uno-ai", "services/game-archive"])
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js", name + ".js"), "utf8"),
    scope,
  );
const R = scope.WorkTimeApp.games.unoRules,
  A = scope.WorkTimeApp.games.unoAi;
const archive = scope.WorkTimeApp.services.gameArchive;
// Build genuine old saves without weakening the production rules.
const legacyRules = vm.runInNewContext(
  "(" +
    scope.WorkTimeApp.games.unoRulesFactory
      .toString()
      .replace("const MAX_PLAYERS = 8", "const MAX_PLAYERS = 10") +
    ")()",
);
const clone = (v) => JSON.parse(JSON.stringify(v));
const id = (color, value, copy = 0) =>
  R.cards.filter((c) => c.color === color && c.value === value)[copy].id;
const play = (card, color = R.cards[card].color) => ({
  type: "play",
  card,
  color,
});
function fixture(hands, top = id("red", 5)) {
  const s = R.create(hands.length);
  const used = new Set([...hands.flat(), top]);
  Object.assign(s, {
    hands: clone(hands),
    deck: R.cards.map((c) => c.id).filter((n) => !used.has(n)),
    discard: [top],
    color: R.cards[top].color,
    turn: 0,
    direction: 1,
    openingColor: false,
    log: [],
  });
  assert.ok(R.restore(s));
  return s;
}
function valid(s) {
  assert.ok(R.restore(s), "every transition must produce a valid save");
  assert.equal(new Set([...s.hands.flat(), ...s.deck, ...s.discard]).size, 108);
}
function officialRules() {
  const seen = new Set();
  for (let seed = 1; seed <= 500; seed++) {
    for (const count of [2, 4, 8]) {
      const s = R.create(count, "normal", seed);
      valid(s);
      const value = R.cards[s.discard[0]].value;
      seen.add(value);
      const first = (s.dealer + 1) % count;
      assert.equal(
        s.turn,
        value === 11
          ? s.dealer
          : (first + ([10, 12].includes(value) ? 1 : 0)) % count,
      );
      assert.equal(s.direction, value === 11 ? -1 : 1);
      assert.equal(s.openingColor, value === 13);
      if (value === 13) {
        assert.equal(R.apply(s, { type: "draw" }), null);
        assert.equal(R.apply(s, play(s.hands[s.turn][0])), null);
        for (const difficulty of ["easy", "normal", "hard"]) {
          const a = A.choose(R.observe(s), difficulty);
          assert.equal(a.type, "color");
          const counts = R.colors.map(
            (color) =>
              s.hands[s.turn].filter((id) => R.cards[id].color === color)
                .length,
          );
          assert.equal(a.color, R.colors[counts.indexOf(Math.max(...counts))]);
          const n = R.apply(s, a);
          valid(n);
          assert.equal(n.turn, s.turn);
          assert.equal(n.color, a.color);
          assert.equal(n.openingColor, false);
          assert.equal(R.apply(n, a), null);
        }
      }
    }
  }
  for (let value = 0; value <= 13; value++) assert.ok(seen.has(value));
  // Repeated rejected +4 openings are covered by deterministic RNG instrumentation.
  const traceFactory = scope.WorkTimeApp.games.unoRulesFactory
    .toString()
    .replace(
      "s.deck.push(opening);",
      "s.rejected = (s.rejected || 0) + 1; s.deck.push(opening);",
    );
  const traced = vm.runInNewContext("(" + traceFactory + ")()");
  let repeat = null;
  for (let seed = 1; seed <= 10000 && !repeat; seed++) {
    const s = traced.create(4, "normal", seed);
    if (s.rejected >= 2) repeat = s;
  }
  assert.ok(repeat, "exercise consecutive rejected opening +4 cards");
  valid(repeat);
  for (const c of R.cards)
    assert.equal(
      R.points([c.id]),
      c.value <= 9 ? c.value : c.value >= 13 ? 50 : 20,
    );
  for (const value of [12, 14]) {
    const last = id(value === 14 ? "wild" : "red", value);
    const s = fixture([[last], [id("blue", 1)], [id("green", 2)]]);
    const n = R.apply(s, play(last, "red"));
    valid(n);
    assert.equal(n.hands[1].length, value === 12 ? 3 : 5);
    assert.equal(n.roundPoints[1], R.points(n.hands[1]));
    assert.equal(n.scores[0], R.points(n.hands[1]) + R.points(n.hands[2]));
    assert.equal(R.apply(n, { type: "draw" }), null);
    assert.equal(
      JSON.stringify(R.restore(n)),
      JSON.stringify(R.restore(R.restore(n))),
    );
  }
  for (const total of [499, 500, 501]) {
    const s = fixture([[id("red", 1)], [id("blue", 2)]]);
    s.scores[0] = total - 2;
    const n = R.apply(s, play(id("red", 1)));
    valid(n);
    assert.equal(n.scores[0], total);
    assert.equal(n.matchWinner, total >= 500 ? 0 : null);
    const next = R.nextRound(n);
    if (total >= 500) assert.equal(next, null);
    else {
      valid(next);
      assert.equal(next.round, 2);
      assert.equal(next.appearanceSeed, s.appearanceSeed);
      assert.equal(
        next.direction,
        R.cards[next.discard[0]].value === 11 ? -1 : 1,
      );
      assert.equal(next.dealer, (s.dealer + 1) % 2);
      assert.deepEqual(clone(next.scores), [499, 0]);
      assert.equal(next.difficulty, s.difficulty);
      assert.equal(next.discardLimit, s.discardLimit);
      assert.equal(R.nextRound(next), null);
    }
  }
  const last = id("red", 12);
  for (const target of R.TARGET_SCORES) {
    assert.equal(R.create(4, "normal", 91, target).targetScore, target);
    for (const offset of [-1, 0, 1]) {
      const s = fixture([[id("red", 1)], [id("blue", 2)]]);
      s.targetScore = target;
      s.scores[0] = target + offset - 2;
      const ended = R.apply(s, play(id("red", 1)));
      valid(ended);
      assert.equal(ended.matchWinner, offset >= 0 ? 0 : null);
      assert.equal(R.restore(ended).targetScore, target);
      if (offset < 0) assert.equal(R.nextRound(ended).targetScore, target);
    }
  }
  for (const targetScore of [0, 101, 250, "500", null]) {
    const bad = clone(R.create());
    bad.targetScore = targetScore;
    assert.equal(R.restore(bad), null);
  }
  const oldTarget = clone(R.create());
  delete oldTarget.targetScore;
  assert.equal(R.restore(oldTarget).targetScore, 500);
  const recycle = fixture([[last], [id("blue", 1)]]);
  recycle.discard = [...recycle.deck, ...recycle.discard];
  recycle.deck = [];
  const ended = R.apply(recycle, play(last));
  valid(ended);
  assert.equal(ended.hands[1].length, 3);
  assert.equal(ended.scores[0], R.points(ended.hands[1]));
  const old = clone(fixture([[id("red", 1)], [id("blue", 2)]]));
  for (const key of [
    "rulesVersion",
    "round",
    "dealer",
    "scores",
    "roundPoints",
    "matchWinner",
    "openingColor",
  ])
    delete old[key];
  old.direction = -1;
  const migrated = R.restore(old);
  assert.equal(migrated.turn, old.turn);
  assert.equal(migrated.direction, -1);
  assert.deepEqual(clone(migrated.scores), [0, 0]);
  assert.equal(migrated.dealer, 1);
  old.hands[0] = [];
  old.discard.push(id("red", 1));
  old.status = "won";
  old.winner = 0;
  const oldWon = R.restore(old);
  assert.equal(oldWon.scores[0], 2);
  assert.equal(
    R.restore(oldWon).scores[0],
    2,
    "migration does not rescore a new save",
  );
  for (const mutate of [
    (s) => {
      s.scores = [0];
    },
    (s) => {
      s.scores[0] = 500;
    },
    (s) => {
      s.scores[0] = -1;
    },
    (s) => {
      s.dealer = 9;
    },
    (s) => {
      s.round = 0;
    },
    (s) => {
      s.rulesVersion = 3;
    },
    (s) => {
      s.openingColor = true;
    },
    (s) => {
      s.roundPoints = [0, 0];
    },
  ]) {
    const s = fixture([[id("red", 1)], [id("blue", 2)]]);
    mutate(s);
    assert.equal(R.restore(s), null);
  }
  for (const difficulty of ["easy", "normal", "hard"]) {
    let s = R.create(4, difficulty, 9123);
    let rounds = 0;
    while (s.matchWinner === null && rounds++ < 100) {
      let actions = 0;
      while (s.status === "playing" && actions++ < 2500) {
        s = R.apply(s, A.choose(R.observe(s), difficulty, s.rng, 0));
        valid(s);
      }
      assert.notEqual(s.status, "playing");
      if (s.matchWinner === null) s = R.nextRound(s);
    }
    assert.notEqual(s.matchWinner, null, "multi-round AI match reaches 500");
  }
}
async function unit() {
  assert.equal(R.cards.length, 108);
  assert.equal(R.MAX_PLAYERS, 8);
  for (let players = 9; players <= 10; players++) {
    assert.throws(() => R.create(players));
    assert.equal(R.restore(legacyRules.create(players)), null);
    assert.throws(() =>
      archive.normalize("game-uno", {
        version: 1,
        state: legacyRules.create(players),
      }),
    );
  }
  const r1 = id("red", 1),
    b1 = id("blue", 1),
    b2 = id("blue", 2);
  for (let count = 2; count <= R.MAX_PLAYERS; count++) {
    const s = R.create(count, "normal", count);
    valid(s);
    const opening = R.cards[s.discard[0]].value;
    assert.ok(
      s.hands.every(
        (h, i) =>
          h.length === (opening === 12 && i === (s.dealer + 1) % count ? 9 : 7),
      ),
    );
    const packed = {
      type: "worktime-games",
      version: 1,
      exportedAt: new Date().toISOString(),
      games: { "game-uno": { version: 1, state: s } },
    };
    const decoded = await archive.decode(await archive.encode(packed));
    assert.equal(decoded.games["game-uno"].state.hands.length, count);
    assert.notEqual(opening, 14);
    assert.equal(s.discard.length, 1);
    assert.equal(s.deck.length, 108 - s.hands.flat().length - 1);
  }
  officialRules();
  let s = fixture([
    [r1, b1],
    [b2, id("green", 2)],
  ]);
  assert.equal(R.apply(s, play(b1)), null);
  assert.equal(R.apply(s, play(r1)).turn, 1);
  assert.equal(R.apply(s, play(r1)).log[0].uno, true);
  const snapshot = JSON.stringify(s);
  R.apply(s, play(r1));
  assert.equal(JSON.stringify(s), snapshot, "rules do not mutate input");
  const wild4 = id("wild", 14),
    wild = id("wild", 13);
  s = fixture([
    [r1, wild4, wild],
    [b1, b2],
  ]);
  assert.equal(R.apply(s, play(wild4, "blue")), null);
  assert.equal(R.apply(s, play(wild, "purple")), null);
  let n = R.apply(s, play(wild, "green"));
  assert.equal(n.color, "green");
  valid(n);
  s = fixture([
    [wild4, b1],
    [b2, id("green", 1)],
  ]);
  n = R.apply(s, play(wild4, "blue"));
  assert.equal(n.hands[1].length, 6);
  assert.equal(n.turn, 0);
  valid(n);
  for (const value of [10, 11, 12]) {
    s = fixture([
      [id("red", value), r1],
      [b1, b2],
    ]);
    n = R.apply(s, play(id("red", value)));
    assert.equal(n.turn, 0, "two-player action skips the opponent");
    valid(n);
    if (value === 12) assert.equal(n.hands[1].length, 4);
  }
  s = fixture([
    [id("red", 11), r1],
    [b1, b2],
    [id("green", 1), id("green", 3)],
  ]);
  n = R.apply(s, play(id("red", 11)));
  assert.equal(n.turn, 2);
  assert.equal(n.direction, -1);
  s = fixture([
    [id("red", 12), r1],
    [id("blue", 12), b2],
    [b1, id("green", 1)],
  ]);
  n = R.apply(s, play(id("red", 12)));
  assert.equal(n.turn, 2);
  assert.equal(n.hands[1].length, 4);
  s = fixture([
    [r1, b1],
    [b2, id("green", 1)],
  ]);
  const drawn = id("red", 8);
  s.deck.splice(s.deck.indexOf(drawn), 1);
  s.deck.push(drawn);
  n = R.apply(s, { type: "draw" });
  assert.equal(n.drawn, drawn);
  assert.equal(n.turn, 0);
  valid(n);
  assert.equal(R.apply(n, play(r1)), null);
  assert.ok(R.apply(n, play(drawn)));
  assert.equal(R.apply(n, { type: "pass" }).turn, 1);
  assert.equal(R.apply(s, { type: "pass" }), null);
  s = fixture([[id("red", 12)], [b1, b2]]);
  n = R.apply(s, play(id("red", 12)));
  assert.equal(n.status, "won");
  assert.equal(n.winner, 0);
  assert.equal(
    n.hands[1].length,
    4,
    "last card penalty is drawn before scoring",
  );
  valid(n);
  s = fixture([
    [r1, b1],
    [b2, id("green", 1)],
  ]);
  s.discard = [...s.deck, ...s.discard];
  s.deck = [];
  const beforeRefill = JSON.stringify(s);
  const refilled = R.refill(s);
  assert.equal(
    JSON.stringify(s),
    beforeRefill,
    "refill preserves the original save",
  );
  assert.equal(refilled.actions, s.actions);
  assert.equal(refilled.turn, s.turn);
  valid(refilled);
  n = R.apply(s, { type: "draw" });
  valid(n);
  assert.equal(n.discard.length, 1);
  assert.equal(n.hands[0].length, 3);
  s = fixture([
    [r1, b1],
    [b2, id("green", 1)],
  ]);
  const lastDeckCard = s.deck[0],
    retainedTop = s.discard.at(-1);
  s.discard = [...s.deck.slice(1), ...s.discard];
  s.deck = [lastDeckCard];
  n = R.apply(s, { type: "draw" });
  assert.ok(
    n.deck.length > 0,
    "taking the last card immediately refills the deck",
  );
  assert.deepEqual(clone(n.discard), [retainedTop]);
  assert.equal(n.drawn, lastDeckCard);
  valid(n);
  s = fixture([
    [r1, b1],
    [b2, id("green", 1)],
  ]);
  s.hands[1].push(...s.deck);
  s.deck = [];
  n = R.apply(s, play(r1));
  assert.deepEqual(
    clone(n.deck),
    [s.discard[0]],
    "a newly available discard is refilled after a play too",
  );
  assert.deepEqual(clone(n.discard), [r1]);
  valid(n);
  // Synthetic exhaustion exercises the defensive no-progress rule.
  s = fixture([[b1], [b2]]);
  s.deck = [];
  n = R.apply(R.apply(s, { type: "draw" }), { type: "draw" });
  assert.equal(n.status, "draw");
  s = fixture([[id("red", 12), r1], [b1], [b2]]);
  s.deck = [];
  n = R.apply(s, play(id("red", 12)));
  assert.equal(
    n.log[0].count,
    1,
    "only the available discard can be recycled for a penalty",
  );
  assert.equal(n.turn, 2);
  s = R.create();
  for (const mutate of [
    (v) => {
      v.hands[0][0] = v.hands[1][0];
    },
    (v) => {
      v.turn = 20;
    },
    (v) => {
      v.rng = 0;
    },
    (v) => {
      v.drawn = v.deck[0];
    },
    (v) => {
      v.status = "won";
      v.winner = 0;
    },
    (v) => {
      v.log = [{ player: 40, type: "draw" }];
    },
  ]) {
    const bad = clone(s);
    mutate(bad);
    assert.equal(R.restore(bad), null);
  }
  for (const discardLimit of [0, 16, 1.5, "5"]) {
    const invalid = clone(R.create());
    invalid.discardLimit = discardLimit;
    assert.equal(R.restore(invalid), null);
  }
  const oldPresentation = clone(R.create());
  delete oldPresentation.discardLimit;
  assert.equal(R.restore(oldPresentation).discardLimit, 10);
  const normalized = archive.normalize("game-uno", { version: 1, state: s });
  assert.equal(normalized.state.hands.length, 4);
  assert.ok(archive.hasContent("game-uno", normalized));
  const other = { version: 1, state: R.create(6) };
  const merged = archive.merge("game-uno", normalized, other, "incoming");
  assert.equal(merged.value.state.hands.length, 6);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const owner = archive.create(() => storage);
  storage.setItem(archive.keys["game-uno"], JSON.stringify(normalized));
  const exported = owner.exportArchive();
  const imported = await archive.decode(await archive.encode(exported));
  const preview = owner.preview(imported, { "game-uno": "incoming" });
  await owner.commit(preview);
  assert.equal(
    JSON.stringify(owner.exportArchive().games),
    JSON.stringify(exported.games),
  );
  await owner.replace(imported, async () => ({ persisted: true }));
  assert.equal(owner.read().games["game-uno"].state.hands.length, 4);
  const previous = storage.getItem(archive.keys["game-uno"]);
  await assert.rejects(
    owner.replace(
      {
        ...imported,
        games: { "game-uno": { version: 1, state: legacyRules.create(9) } },
      },
      async () => ({ persisted: true }),
    ),
  );
  assert.equal(
    storage.getItem(archive.keys["game-uno"]),
    previous,
    "invalid old import cannot overwrite current save",
  );
  for (const difficulty of ["easy", "normal", "hard"]) {
    for (let count = 2; count <= R.MAX_PLAYERS; count++) {
      for (let seed = 1; seed <= (difficulty === "hard" ? 1 : 4); seed++) {
        let state = R.create(count, difficulty, seed);
        let steps = 0;
        while (state.status === "playing" && steps++ < 2500) {
          const o = R.observe(state);
          const action = A.choose(o, difficulty, state.rng, 1);
          const next = R.apply(state, action);
          assert.ok(next, "AI must return a legal action");
          state = next;
          valid(state);
        }
        assert.notEqual(state.status, "playing", "seeded AI game must finish");
      }
    }
  }
  s = R.create(6, "normal", 123);
  const hidden = clone(s),
    first = (s.turn + 1) % 6,
    second = (s.turn + 2) % 6;
  [hidden.hands[first][0], hidden.hands[second][0]] = [
    hidden.hands[second][0],
    hidden.hands[first][0],
  ];
  assert.equal(JSON.stringify(R.observe(s)), JSON.stringify(R.observe(hidden)));
  for (const d of ["easy", "normal", "hard"])
    assert.equal(
      JSON.stringify(A.choose(R.observe(s), d, 77, 0)),
      JSON.stringify(A.choose(R.observe(hidden), d, 77, 0)),
    );
  console.log(
    "UNO rules, saves, fair observations and 63 seeded AI matches verified.",
  );
}
async function browser() {
  const browser = await chromium.launch({ headless: true });
  let debugPage;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    debugPage = page;
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    await page.locator(".uno-setup").waitFor();
    await page.locator("#uno-playersTrigger").click();
    await page.locator('#uno-playersOptions [data-game-option="6"]').click();
    await page.locator("#uno-difficultyTrigger").click();
    await page
      .locator('#uno-difficultyOptions [data-game-option="hard"]')
      .click();
    await page.locator('[data-uno-action="start"]').click();
    assert.equal(await page.locator(".uno-seat").count(), 5);
    await page.waitForFunction(() => {
      const s = JSON.parse(
        localStorage.getItem("worktime.games.uno.v1"),
      )?.state;
      return s && (s.turn === 0 || s.actions > 2);
    });
    await setDocumentHidden(page, true);
    const saved = await page.evaluate(() =>
      localStorage.getItem("worktime.games.uno.v1"),
    );
    await page.waitForTimeout(900);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime.games.uno.v1")),
      saved,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".uno-seat").count(), 5);
    assert.ok(
      await page
        .locator(".game-uno")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "mobile game must not overflow horizontally",
    );
    await page.screenshot({
      path: path.join(root, "_uno-mobile.png"),
      fullPage: true,
    });
    await setDocumentHidden(page, false);
    await page.locator('[data-uno-action="restart"]').click();
    await page.locator('.uno-confirm [data-uno-action="cancel"]').click();
    await setDocumentHidden(page, true);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime.games.uno.v1")),
      saved,
    );
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime.games.uno.v1")),
      saved,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    assert.equal(await page.locator(".uno-seat").count(), 5);
    // Inject a fully valid human-turn fixture through the public archive key, then reopen.
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    const human = fixture([
      [id("wild", 13), id("red", 1)],
      [id("blue", 1), id("blue", 2)],
    ]);
    await page.evaluate(
      (s) =>
        localStorage.setItem(
          "worktime.games.uno.v1",
          JSON.stringify({ version: 1, state: s }),
        ),
      clone(human),
    );
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    const before = await page.evaluate(() =>
      localStorage.getItem("worktime.games.uno.v1"),
    );
    await page.locator(`button[data-card="${id("wild", 13)}"]`).click();
    assert.equal(await page.locator(".uno-color-choice").count(), 0);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(240);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime.games.uno.v1")),
      before,
      "leaving the swatches cancels selection without committing a card",
    );
    await page.locator(`button[data-card="${id("wild", 13)}"]`).focus();
    await page.locator(`button[data-card="${id("wild", 13)}"]`).press("Enter");
    await page.locator('.uno-color-swatch[data-uno-color="blue"]').click();
    await setDocumentHidden(page, true);
    const after = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state,
    );
    assert.equal(after.color, "blue");
    assert.equal(after.hands[0].length, 1);
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.evaluate((l) => WorkTimeApp.i18n.setLanguage(l), language);
      assert.ok(
        !(await page.locator(".game-uno").innerText()).includes("games.uno."),
      );
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    async function reopen(save) {
      if (await page.locator("#gameShell").isVisible()) {
        await page.locator("#gameExitButton").click();
        await page.locator("#gameShell").waitFor({ state: "hidden" });
      }
      await page.evaluate(
        (s) =>
          localStorage.setItem(
            "worktime.games.uno.v1",
            JSON.stringify({ version: 1, state: s }),
          ),
        clone(save),
      );
      await setDocumentHidden(page, false);
      await launchGame(page, "game-uno");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
    }
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state,
      );
    let opening;
    for (let seed = 1; !opening; seed++) {
      const candidate = R.create(2, "hard", seed);
      if (candidate.openingColor && candidate.turn === 0) opening = candidate;
    }
    await reopen(opening);
    assert.equal(await page.locator("[data-uno-opening-color]").count(), 4);
    assert.equal(
      await page.locator('[data-uno-action="draw"]').isDisabled(),
      true,
    );
    assert.equal(
      await page.locator(".uno-hand button:not(:disabled)").count(),
      0,
    );
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.evaluate((l) => WorkTimeApp.i18n.setLanguage(l), language);
      assert.ok(
        !(await page.locator(".game-uno").innerText()).includes("games.uno."),
      );
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.locator('[data-uno-opening-color="blue"]').click();
    assert.equal((await read()).color, "blue");
    assert.equal((await read()).turn, 0);
    assert.equal((await read()).hands[0].length, 7);
    assert.equal((await read()).openingColor, false);
    await reopen(await read());
    assert.equal(await page.locator("[data-uno-opening-color]").count(), 0);
    for (let seed = 1; ; seed++) {
      const aiOpening = R.create(2, "hard", seed);
      if (!aiOpening.openingColor || aiOpening.turn !== 1) continue;
      const expected = A.choose(R.observe(aiOpening), "hard");
      await reopen(aiOpening);
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
            .actions > 0,
      );
      await setDocumentHidden(page, true);
      assert.equal((await read()).color, expected.color);
      assert.equal((await read()).hands[1].length, 7);
      break;
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const ending = fixture([[id("red", 12)], [id("blue", 1), id("blue", 2)]]);
    await reopen(ending);
    await page.locator(`.uno-hand [data-card="${id("red", 12)}"]`).click();
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    const roundEnd = await read();
    assert.equal(roundEnd.hands[1].length, 4);
    assert.equal(roundEnd.scores[0], R.points(roundEnd.hands[1]));
    assert.equal(
      await page.locator('[data-uno-action="nextRound"]').count(),
      1,
    );
    const exported = await archive.decode(
      await archive.encode({
        type: "worktime-games",
        version: 1,
        exportedAt: new Date().toISOString(),
        games: { "game-uno": { version: 1, state: roundEnd } },
      }),
    );
    await reopen(exported.games["game-uno"].state);
    assert.equal((await read()).scores[0], roundEnd.scores[0]);
    await page.locator('[data-uno-action="restart"]').click();
    await page.locator(".uno-confirm").waitFor();
    await page.locator('.uno-confirm [data-uno-action="cancel"]').click();
    const namesBefore = await page
      .locator(".uno-seat .uno-seat-labels strong")
      .allTextContents();
    await page.locator('[data-uno-action="nextRound"]').click();
    await page.waitForFunction(
      (round) =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .round ===
        round + 1,
      roundEnd.round,
    );
    await setDocumentHidden(page, true);
    const secondRound = await read();
    assert.equal(secondRound.round, 2);
    assert.equal(secondRound.dealer, (roundEnd.dealer + 1) % 2);
    assert.equal(await page.locator(".uno-dealer").count(), 1);
    assert.equal(
      await page
        .locator(
          secondRound.dealer === 0
            ? ".uno-own-info .uno-dealer"
            : `[data-seat="${secondRound.dealer}"] .uno-dealer`,
        )
        .count(),
      1,
      "dealer badge follows the new round, including cached opponent views",
    );
    assert.deepEqual(secondRound.scores, roundEnd.scores);
    assert.deepEqual(
      await page.locator(".uno-seat .uno-seat-labels strong").allTextContents(),
      namesBefore,
    );
    await reopen(secondRound);
    assert.equal((await read()).round, 2);
    const matchPoint = fixture([[id("red", 1)], [id("blue", 2)]]);
    matchPoint.scores[0] = 498;
    await reopen(matchPoint);
    await page.locator(`.uno-hand [data-card="${id("red", 1)}"]`).click();
    await page.locator('[data-uno-action="newMatch"]').waitFor();
    assert.equal((await read()).matchWinner, 0);
    assert.equal((await read()).scores[0], 500);
    assert.equal(
      await page.locator('[data-uno-action="nextRound"]').count(),
      0,
    );
    await page.locator('[data-uno-action="newMatch"]').click();
    await setDocumentHidden(page, true);
    assert.deepEqual((await read()).scores, [0, 0]);
    assert.equal((await read()).round, 1);
    function layoutFixture(players, ownCount = 7) {
      const top = id("red", 5);
      const pool = R.cards.map((c) => c.id).filter((card) => card !== top);
      const hands = [pool.splice(0, ownCount)];
      for (let i = 1; i < players; i++) hands.push(pool.splice(0, 7));
      return fixture(hands, top);
    }
    const output = path.join(root, "test-results", "uno");
    fs.mkdirSync(output, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1280, height: 900 },
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
      { width: 360, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      for (let players = 2; players <= 8; players++) {
        const s = layoutFixture(players);
        s.direction = players % 2 ? -1 : 1;
        await reopen(s);
        assert.equal(await page.locator(".uno-seat").count(), players - 1);
        const geometry = await page.locator(".game-uno").evaluate((el) => {
          const bounds = (selector) =>
            [...el.querySelectorAll(selector)].map((n) =>
              n.getBoundingClientRect(),
            );
          const overlaps = (a, b) =>
            a.left < b.right - 1 &&
            a.right > b.left + 1 &&
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1;
          const seats = bounds(".uno-seat"),
            center = bounds(".uno-table")[0],
            hand = bounds(".uno-own")[0];
          return {
            seats: seats.map((a) => ({
              x: a.x,
              y: a.y,
              width: a.width,
              height: a.height,
            })),
            center: {
              x: center.x,
              y: center.y,
              width: center.width,
              height: center.height,
            },
            overflow: el.scrollWidth > el.clientWidth + 1,
            collision: seats.some(
              (a, i) =>
                overlaps(a, center) ||
                overlaps(a, hand) ||
                seats.some((b, j) => j > i && overlaps(a, b)),
            ),
            bottom: hand.bottom,
            viewport: innerHeight,
          };
        });
        assert.equal(
          geometry.overflow,
          false,
          JSON.stringify({ viewport, players, geometry }),
        );
        assert.equal(
          geometry.collision,
          false,
          JSON.stringify({ viewport, players, geometry }),
        );
        assert.ok(
          geometry.bottom <= geometry.viewport + 2,
          "hand stays within the visible game area: " +
            JSON.stringify({ viewport, players, geometry }),
        );
        assert.equal(await page.locator(".uno-own.uno-active").count(), 1);
        assert.ok(
          await page.evaluate(() => {
            const h = document
                .querySelector(".uno-hand")
                .getBoundingClientRect(),
              t = document.querySelector(".uno-table").getBoundingClientRect();
            return Math.abs(h.x + h.width / 2 - t.x - t.width / 2) < 1;
          }),
          "human hand viewport is centered on the table axis",
        );
        const seatIds = await page
          .locator(".uno-seat")
          .evaluateAll((els) => els.map((e) => Number(e.dataset.seat)));
        assert.deepEqual(
          seatIds,
          Array.from({ length: players - 1 }, (_, i) => i + 1),
        );
        if (players === 8) await page.mouse.move(0, 0);
        if (players === 8)
          await page.screenshot({
            path: path.join(
              output,
              `table-${viewport.width}x${viewport.height}.png`,
            ),
          });
      }
      for (const handCount of [1, 10, 20, 50]) {
        await reopen(layoutFixture(8, handCount));
        assert.equal(await page.locator(".uno-hand button").count(), handCount);
        assert.ok(
          await page
            .locator(".uno-hand")
            .evaluate((el) => el.classList.contains("uno-hand-fan")),
          "large hands retain the curved card layout",
        );
        assert.ok(
          await page
            .locator(".uno-hand")
            .evaluate((el) => el.scrollWidth >= el.clientWidth),
        );
        if (viewport.width <= 700 && handCount > 1) {
          const exposure = await page
            .locator(".uno-hand button")
            .evaluateAll(
              (els) =>
                els[1].getBoundingClientRect().left -
                els[0].getBoundingClientRect().left,
            );
          assert.ok(exposure >= 44, "touch cards expose at least 44px");
        }
        const last = page.locator(".uno-hand button:not(:disabled)").last();
        await last.focus();
        assert.ok(
          await last.evaluate((el) => {
            const a = el.getBoundingClientRect(),
              b = el.closest(".uno-hand").getBoundingClientRect();
            return a.left >= b.left - 1 && a.right <= b.right + 1;
          }),
          "keyboard focus scrolls the card fully into view",
        );
        if (handCount === 1) {
          await last.click();
          await page.locator(".uno-hand-actions:not([hidden])").waitFor();
          assert.equal((await read()).status, "won");
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await reopen(legacyRules.create(9));
    await page.locator(".uno-setup").waitFor();
    assert.ok(
      (await page.locator(".uno-warning").innerText()).includes("八人上限"),
    );
    assert.equal(await page.locator('[data-uno-action="continue"]').count(), 0);
    assert.deepEqual(
      await page
        .locator(".uno-setup select")
        .first()
        .locator("option")
        .evaluateAll((els) => els.map((e) => e.value)),
      ["2", "3", "4", "5", "6", "7", "8"],
    );
    await page.locator('[data-uno-action="start"]').click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.hands
            .length,
      ),
      4,
    );
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    const ai = fixture([
      [id("blue", 1), id("blue", 2)],
      [id("red", 1), id("wild", 13)],
    ]);
    ai.turn = 1;
    ai.difficulty = "hard";
    await page.evaluate((s) => {
      localStorage.setItem(
        "worktime.games.uno.v1",
        JSON.stringify({ version: 1, state: s }),
      );
      const NativeWorker = window.Worker;
      window.unoWorkerStarts = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          window.unoWorkerStarts++;
        }
      };
    }, clone(ai));
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .actions > 0,
    );
    assert.equal(
      await page.evaluate(() => window.unoWorkerStarts),
      1,
      "hard AI actually uses a worker",
    );
    assert.equal(await page.locator(".uno-warning").count(), 0);
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.evaluate((s) => {
      localStorage.setItem(
        "worktime.games.uno.v1",
        JSON.stringify({ version: 1, state: s }),
      );
      window.Worker = class {
        constructor() {
          throw Error("Simulated unavailable worker");
        }
      };
    }, clone(ai));
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .actions > 0,
    );
    assert.ok(
      (await page.locator(".uno-warning").innerText()).includes("普通 AI"),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
    await require("./verify-uno-motion.cjs").verifyMotion(site);
    console.log(
      "UNO file entry, worker, mobile layout, pause, cancellation and save recovery verified: " +
        site,
    );
  } catch (error) {
    if (debugPage && !debugPage.isClosed())
      await debugPage.screenshot({
        path: path.join(root, "_uno-error.png"),
        fullPage: false,
      });
    throw error;
  } finally {
    await browser.close();
  }
}
unit()
  .then(() => {
    if (!process.argv.includes("--unit")) return browser();
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
