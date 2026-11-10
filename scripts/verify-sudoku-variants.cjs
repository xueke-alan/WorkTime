"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const { rate } = require("./killer-rating.cjs");
const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({ WorkTimeApp: { data: {}, games: {} } });
for (const file of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx);
const { data, games } = ctx.WorkTimeApp,
  rules = games.sudokuRules;
const ids = [
  "sandwich",
  "killer",
  "arrow",
  "jigsaw",
  "whispers",
  "renban",
  "kropki",
  "xsums",
  "antiKnight",
  "inequality",
  "extraRegion",
  "palindrome",
  "quadSum",
  "windmill",
  "flower",
  "triple",
  "tenBox",
];
const plain = (value) => JSON.parse(JSON.stringify(value));
const adjacent = (a, b) =>
  Math.abs(Math.floor(a / 9) - Math.floor(b / 9)) +
    Math.abs((a % 9) - (b % 9)) ===
  1;
function connected(cells) {
  const seen = new Set([cells[0]]),
    pending = [cells[0]];
  while (pending.length) {
    const i = pending.pop();
    for (const j of cells)
      if (!seen.has(j) && adjacent(i, j)) {
        seen.add(j);
        pending.push(j);
      }
  }
  return seen.size === cells.length;
}
function verifyRules() {
  const variants = data.sudoku.groups.filter(
    (g) => !["easy", "medium", "hard", "expert"].includes(g.id),
  );
  assert.equal(variants.length, 20);
  for (const group of variants)
    assert.equal(
      group.puzzles.length,
      group.id === "killer" ? 30 : 20,
      group.id + " level count",
    );
  for (const id of ids) {
    const group = plain(data.sudoku.groups.find((g) => g.id === id));
    assert.equal(group.puzzles.length, id === "killer" ? 30 : 20);
    for (const p of group.puzzles) {
      const values = Array.from(p.solution, Number),
        state = { ...rules.create(p), values };
      assert.deepEqual(
        plain(
          p.difficulty === "hard" && p.cages
            ? rate(p).solutions
            : rules.solve(p),
        ),
        [p.solution],
        p.id + " unique",
      );
      assert.ok(rules.won(p, state));
      if (p.antiKnight) {
        for (let i = 0; i < 81; i++)
          for (let j = i + 1; j < 81; j++)
            if (
              Math.abs(Math.floor(i / 9) - Math.floor(j / 9)) *
                Math.abs((i % 9) - (j % 9)) ===
              2
            )
              assert.notEqual(values[i], values[j], p.id + " knight exclusion");
        assert.equal(
          rules.solve({ givens: p.givens }, 2).length,
          2,
          "anti-knight rule is essential",
        );
      }
      const sum = (cells) => cells.reduce((a, i) => a + values[i], 0);
      for (const [a, b] of p.inequalities || [])
        assert.ok(values[a] > values[b]);
      for (const cells of p.extraRegions || [])
        assert.equal(
          cells
            .map((i) => values[i])
            .sort()
            .join(""),
          "123456789",
        );
      for (const line of p.palindromes || [])
        assert.deepEqual(
          line.map((i) => values[i]),
          line.map((i) => values[i]).reverse(),
        );
      for (const cells of p.quadSums || [])
        assert.equal(Math.max(...cells.map((i) => values[i])) * 2, sum(cells));
      if (p.tenBox) {
        const grid = rules.layout(p);
        assert.equal(grid.width, 10);
        assert.equal(grid.height, 10);
        assert.equal(grid.positions.length, 90);
        assert.equal(grid.regions.length, 10);
        assert.equal(new Set(grid.regions.flat()).size, 90);
        grid.units.forEach((unit) => {
          assert.equal(unit.length, 9);
          assert.equal(
            unit
              .map((i) => values[i])
              .sort()
              .join(""),
            "123456789",
          );
        });
        for (const region of grid.regions) {
          const coords = region.map((i) => grid.positions[i]);
          const rows = [...new Set(coords.map((p) => p[0]))],
            cols = [...new Set(coords.map((p) => p[1]))];
          assert.equal(rows.length, 3);
          assert.equal(cols.length, 3);
          assert.ok(
            rows.some(
              (r) => rows.includes((r + 1) % 10) && rows.includes((r + 2) % 10),
            ),
          );
          assert.ok(
            cols.some(
              (c) => cols.includes((c + 1) % 10) && cols.includes((c + 2) % 10),
            ),
          );
        }
        const pair = grid.regions.flatMap((unit) =>
          unit.flatMap((i) =>
            unit
              .filter(
                (j) =>
                  i < j &&
                  Math.abs(grid.positions[i][0] - grid.positions[j][0]) > 7 &&
                  grid.positions[i][1] !== grid.positions[j][1],
              )
              .map((j) => [i, j]),
          ),
        )[0];
        assert.ok(pair);
        const board = Array(90).fill(0);
        board[pair[0]] = 5;
        assert.equal(
          rules.allowed(board, pair[1], 5, p),
          false,
          "wrapped box conflict",
        );
      }
      if (p.grids) {
        const { positions } = rules.layout(p);
        assert.equal(positions.length, p.solution.length);
        if (id === "triple") {
          assert.deepEqual(p.grids, [
            [0, 3],
            [3, 6],
            [6, 0],
          ]);
          assert.equal(positions.length, 180);
          assert.equal(rules.layout(p).width, 15);
          assert.equal(rules.layout(p).height, 15);
        }
        for (const [r, c] of p.grids) {
          const at = (y, x) =>
            values[
              positions.findIndex((pos) => pos[0] === r + y && pos[1] === c + x)
            ];
          for (let n = 0; n < 9; n++) {
            const units = [
              Array.from({ length: 9 }, (_, j) => at(n, j)),
              Array.from({ length: 9 }, (_, j) => at(j, n)),
              Array.from({ length: 9 }, (_, j) =>
                at(
                  Math.floor(n / 3) * 3 + Math.floor(j / 3),
                  (n % 3) * 3 + (j % 3),
                ),
              ),
            ];
            units.forEach((unit) =>
              assert.equal(unit.sort().join(""), "123456789"),
            );
          }
        }
        const progress = rules.create(p),
          log = rules.startReplay(p, progress);
        const index = p.givens.lastIndexOf("0");
        assert.ok(rules.enter(p, progress, index, values[index]));
        rules.recordEdit(log, index, values[index], false);
        assert.ok(
          rules.restoreReplay(p, log, progress),
          p.id + " extended replay",
        );
        assert.ok(rules.undo(progress));
        rules.recordEdit(log);
        assert.ok(
          rules.restoreReplay(p, log, progress),
          p.id + " extended undo replay",
        );
      }

      if (p.cages) {
        assert.deepEqual(
          p.cages.flatMap((c) => Array.from(c.cells)).sort((a, b) => a - b),
          Array.from({ length: 81 }, (_, i) => i),
        );
        for (const c of p.cages) {
          assert.ok(connected(c.cells));
          assert.equal(sum(c.cells), c.sum);
          assert.equal(
            new Set(c.cells.map((i) => values[i])).size,
            c.cells.length,
          );
        }
        const bad = {
          ...p,
          cages: p.cages.map((c, i) => (i ? c : { ...c, sum: c.sum + 1 })),
        };
        assert.equal(rules.won(bad, state), false);
      }
      if (p.regions) {
        assert.equal(p.regions.length, 81);
        let irregular = false;
        for (let region = 0; region < 9; region++) {
          const cells = Array.from(p.regions).flatMap((r, i) =>
            r === region ? [i] : [],
          );
          assert.equal(cells.length, 9);
          assert.ok(connected(cells));
          assert.equal(
            cells
              .map((i) => values[i])
              .sort()
              .join(""),
            "123456789",
          );
          if (
            new Set(
              cells.map(
                (i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3),
              ),
            ).size > 1
          )
            irregular = true;
        }
        assert.ok(irregular);
      }
      for (const arrow of p.arrows || []) {
        assert.equal(sum(arrow.cells), values[arrow.circle]);
        assert.ok(adjacent(arrow.circle, arrow.cells[0]));
      }
      for (const key of ["whispers", "renbans"])
        for (const line of p[key] || []) {
          line.forEach((i, n) => {
            if (n) {
              assert.ok(adjacent(i, line[n - 1]));
              if (key === "whispers")
                assert.ok(Math.abs(values[i] - values[line[n - 1]]) >= 5);
            }
          });
          if (key === "renbans") {
            const digits = line.map((i) => values[i]).sort((a, b) => a - b);
            assert.ok(digits.every((v, i) => !i || v === digits[i - 1] + 1));
          }
        }
      for (const dot of p.kropki || []) {
        const [a, b] = dot.cells.map((i) => values[i]);
        assert.ok(adjacent(...dot.cells));
        assert.ok(
          dot.kind === "white"
            ? Math.abs(a - b) === 1
            : Math.max(a, b) === 2 * Math.min(a, b),
        );
      }
      for (const key of ["sandwich", "xsums"])
        if (p[key])
          for (let side = 0; side < 2; side++)
            for (let n = 0; n < 9; n++) {
              const line = Array.from(
                { length: 9 },
                (_, j) => values[side ? n * 9 + j : j * 9 + n],
              );
              const a = line.indexOf(1),
                b = line.indexOf(9);
              const digits =
                key === "sandwich"
                  ? line.slice(Math.min(a, b) + 1, Math.max(a, b))
                  : line.slice(0, line[0]);
              assert.equal(
                digits.reduce((x, y) => x + y, 0),
                p[key][side][n],
              );
              const clues = plain(p[key]);
              clues[side][n]++;
              assert.equal(rules.won({ ...p, [key]: clues }, state), false);
            }
      const restored = rules.restore(p, plain(state));
      assert.ok(restored);
      assert.ok(rules.won(p, restored));
    }
    console.log(
      id +
        ": " +
        group.puzzles.length +
        " unique, independently validated puzzles",
    );
  }
  assert.equal(
    data.sudoku.groups
      .find((g) => g.id === "killer")
      .puzzles.filter((p) => /^0{81}$/.test(p.givens)).length,
    27,
  );
  const board = Array(81).fill(0);
  // Deliberately use cells in different rows, columns and boxes to isolate each extra rule.
  board[40] = 4;
  assert.equal(rules.allowed(board, 0, 3, { inequalities: [[0, 40]] }), false);
  assert.equal(rules.allowed(board, 0, 5, { inequalities: [[0, 40]] }), true);
  assert.equal(
    rules.allowed(board, 0, 3, { palindromes: [[0, 20, 40]] }),
    false,
  );
  assert.equal(
    rules.allowed(board, 0, 4, { palindromes: [[0, 20, 40]] }),
    true,
  );
  assert.equal(rules.allowed(board, 0, 4, { extraRegions: [[0, 40]] }), false);
  board[10] = 1;
  board[20] = 2;
  assert.equal(
    rules.allowed(board, 0, 7, { quadSums: [[0, 10, 20, 40]] }),
    true,
  );
  assert.equal(
    rules.allowed(board, 0, 8, { quadSums: [[0, 10, 20, 40]] }),
    false,
  );
  board.fill(0);
  board[13] = 4;
  assert.equal(rules.allowed(board, 2, 4, {}), true);
  assert.equal(rules.allowed(board, 2, 4, { antiKnight: true }), false);
  assert.ok(rules.puzzlePeers({ antiKnight: true })[13].includes(2));
  assert.ok(!rules.puzzlePeers({ antiKnight: true })[8].includes(28));
  const knightPuzzle = { givens: "0".repeat(81), antiKnight: true };
  const knightState = rules.create(knightPuzzle);
  assert.ok(rules.enter(knightPuzzle, knightState, 13, 4, true));
  assert.ok(rules.enter(knightPuzzle, knightState, 2, 4));
  assert.equal(knightState.notes[13], 0);
  assert.ok(rules.undo(knightState));
  assert.equal(knightState.notes[13], 8);
  board[13] = 0;
  board[40] = 3;
  assert.equal(
    rules.allowed(board, 0, 3, { cages: [{ cells: [0, 40], sum: 6 }] }),
    false,
    "cage repeat",
  );
  assert.equal(
    rules.allowed(board, 0, 4, { cages: [{ cells: [0, 40], sum: 7 }] }),
    true,
  );
  assert.equal(rules.allowed(board, 0, 7, { whispers: [[0, 40]] }), false);
  assert.equal(rules.allowed(board, 0, 8, { whispers: [[0, 40]] }), true);
  assert.equal(rules.allowed(board, 0, 3, { renbans: [[0, 40]] }), false);
  assert.equal(rules.allowed(board, 0, 5, { renbans: [[0, 40]] }), false);
  assert.equal(rules.allowed(board, 0, 4, { renbans: [[0, 40]] }), true);
  assert.equal(
    rules.allowed(board, 0, 6, { kropki: [{ cells: [0, 40], kind: "black" }] }),
    true,
  );
  assert.equal(
    rules.allowed(board, 0, 5, { kropki: [{ cells: [0, 40], kind: "black" }] }),
    false,
  );
  assert.equal(
    rules.allowed(board, 0, 4, { kropki: [{ cells: [0, 40], kind: "white" }] }),
    true,
  );
  board[80] = 3;
  assert.equal(
    rules.allowed(board, 0, 6, { arrows: [{ circle: 0, cells: [40, 80] }] }),
    true,
    "arrow repeats allowed",
  );
  assert.equal(
    rules.allowed(board, 0, 5, { arrows: [{ circle: 0, cells: [40, 80] }] }),
    false,
  );
}
async function verifyUI() {
  const output = path.join(root, "test-results/sudoku-variants");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || root, "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.locator("#date-tab-games").click();
    await launchGame(page, "game-sudoku");
    assert.deepEqual(
      await page
        .locator(".sudoku-categories button")
        .evaluateAll((buttons) => buttons.map((b) => b.dataset.sudokuAction)),
      [
        "easy",
        "medium",
        "hard",
        "expert",
        "killer",
        "kropki",
        "arrow",
        "whispers",
        "renban",
        "thermo",
        "antiKnight",
        "jigsaw",
        "sandwich",
        "xsums",
        "skyscraper",
        "parity",
        "inequality",
        "extraRegion",
        "palindrome",
        "quadSum",
        "windmill",
        "flower",
        "triple",
        "tenBox",
      ],
    );
    assert.equal(
      await page
        .locator('[data-sudoku-action="easy"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    const action = (id) => page.locator(`[data-sudoku-action="${id}"]`);
    async function choose() {
      await action("choose").click();
    }
    let pooledCell = null;
    for (const id of ids) {
      await action(id).click();
      assert.equal(
        await page.locator(".sudoku-levels button:visible").count(),
        id === "killer" ? 30 : 20,
      );
      await action("level-" + (id === "killer" ? 4 : 1)).click();
      if (!pooledCell) pooledCell = await action("cell-0").elementHandle();
      assert.ok(
        await pooledCell.evaluate(
          (cell) => cell === document.querySelector('[data-cell="0"]'),
        ),
        "reuse cells across shapes",
      );
      assert.equal(
        await page.locator(".sudoku-notes span").count(),
        0,
        "no empty note grid items",
      );
      if (id === "tenBox") {
        assert.equal(await page.locator(".sudoku-blocked").count(), 10);
        assert.equal(await page.locator(".sudoku-cell").count(), 90);
        assert.ok(await page.locator(".sudoku-multi-grid").count());
      }
      if (id === "killer") {
        assert.equal(await page.locator(".sudoku-cell.is-given").count(), 0);
        assert.ok(await page.locator(".sudoku-cage-sum").count());
      }
      if (id === "arrow")
        assert.ok(await page.locator(".sudoku-arrow-circle").count());
      if (id === "whispers" || id === "renban")
        assert.ok(await page.locator(".sudoku-" + id).count());
      if (id === "kropki") {
        assert.ok(await page.locator(".sudoku-kropki-white").count());
        assert.ok(await page.locator(".sudoku-kropki-black").count());
      }
      if (id === "sandwich" || id === "xsums")
        assert.equal(
          await page.locator(".sudoku-sky-clues:not([hidden]) span").count(),
          18,
        );
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(
          (wide) =>
            document.querySelector(".game-sudoku").dataset.layout ===
            (wide ? "wide" : "compact"),
          width > 1000,
        );
        if (
          width === 320 &&
          ["windmill", "flower", "triple", "tenBox"].includes(id)
        ) {
          await action("zoom").click();
          const cell = await page.locator(".sudoku-cell").first().boundingBox();
          assert.ok(cell.width >= 24, "readable enlarged cells");
          if (id !== "tenBox")
            assert.equal(
              await page
                .locator(".sudoku-field")
                .evaluate((el) => el.scrollWidth > el.clientWidth),
              true,
            );
          await action("zoom").click();
        }
        const rect = await page.locator(".sudoku-field").boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1);
        await page.screenshot({
          path: path.join(output, id + "-" + width + ".png"),
        });
      }
      for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
        await page.evaluate(
          (lang) => WorkTimeApp.i18n.setLanguage(lang),
          language,
        );
        assert.ok(
          !(await page.locator(".game-sudoku").innerText()).includes(
            "games.sudoku.",
          ),
        );
        assert.equal(
          await page
            .locator(
              ".sudoku-rule, [data-game-help], .sudoku-source, .sudoku-options",
            )
            .count(),
          0,
        );
      }
      const puzzle = data.sudoku.groups.find((g) => g.id === id).puzzles[
          id === "killer" ? 3 : 0
        ],
        index = puzzle.givens.indexOf("0");
      await action("cell-" + index).click();
      await action("notes").click();
      await action("digit-" + puzzle.solution[index]).click();
      const noteSlots = action("cell-" + index).locator(".sudoku-notes span");
      assert.equal(await noteSlots.count(), 9);
      const noteSlot = await noteSlots.first().elementHandle();
      await action("notes").click();
      assert.ok(
        await noteSlot.evaluate(
          (span, i) =>
            span ===
            document.querySelector(`[data-cell="${i}"] .sudoku-notes span`),
          index,
        ),
        "reuse unchanged note slots",
      );
      await action("undo").click();
      assert.equal(await noteSlots.count(), 0);
      await action("digit-" + puzzle.solution[index]).click();
      assert.equal(
        await action("cell-" + index).getAttribute("aria-invalid"),
        "false",
      );
      if (id === "antiKnight") {
        const pair = await page.evaluate(() => {
          const p = WorkTimeApp.data.sudoku.groups.find(
            (g) => g.id === "antiKnight",
          ).puzzles[0];
          for (let i = 0; i < 81; i++)
            for (let j = i + 1; j < 81; j++)
              if (
                p.givens[i] === "0" &&
                p.givens[j] === "0" &&
                Math.abs(Math.floor(i / 9) - Math.floor(j / 9)) *
                  Math.abs((i % 9) - (j % 9)) ===
                  2 &&
                !WorkTimeApp.games.sudokuRules.peers[i].includes(j)
              )
                return [i, j];
          return null;
        });
        assert.ok(pair);
        await action("cell-" + pair[0]).click();
        assert.ok(
          (await action("cell-" + pair[1]).getAttribute("class")).includes(
            "is-peer",
          ),
        );
        await action("digit-" + puzzle.solution[pair[0]]).click();
        await action("cell-" + pair[1]).click();
        await action("digit-" + puzzle.solution[pair[0]]).click();
        assert.equal(
          await action("cell-" + pair[1]).getAttribute("aria-invalid"),
          "true",
        );
        await action("undo").click();
        assert.equal(
          await action("cell-" + pair[1]).getAttribute("aria-invalid"),
          "false",
        );
      }
      const normalized = await page.evaluate(() => {
        const save = JSON.parse(
          localStorage.getItem("worktime.games.sudoku.v1"),
        );
        return WorkTimeApp.services.gameArchive.normalize("game-sudoku", save);
      });
      assert.equal(normalized.current, puzzle.id);
      assert.equal(
        normalized.drafts[puzzle.id].values[index],
        Number(puzzle.solution[index]),
      );
      await choose();
    }
    for (const group of data.sudoku.groups.filter(
      (g) => !["easy", "medium", "hard", "expert"].includes(g.id),
    )) {
      await action(group.id).click();
      assert.equal(
        await page.locator(".sudoku-levels button:visible").count(),
        group.id === "killer" ? 30 : 20,
      );
      await action("level-20").click();
      const last = group.puzzles[19],
        cell = last.givens.indexOf("0");
      await action("cell-" + cell).click();
      await action("digit-" + last.solution[cell]).click();
      const saved = await page.evaluate(() => {
        const value = JSON.parse(
          localStorage.getItem("worktime.games.sudoku.v1"),
        );
        return WorkTimeApp.services.gameArchive.normalize("game-sudoku", value);
      });
      assert.equal(saved.current, last.id);
      assert.equal(
        saved.drafts[last.id].values[cell],
        Number(last.solution[cell]),
      );
      await choose();
    }
    // The compact replacement must not reinterpret saved cells from the old 21×21 layout.
    for (const legacyGroup of ["triple"]) {
      const legacy = data.sudoku.groups.find((g) => g.id === legacyGroup)
        .legacyPuzzles[0];
      const legacyState = rules.create(legacy);
      legacyState.replay = rules.startReplay(legacy, legacyState);
      const legacyIndex = legacy.givens.lastIndexOf("0");
      rules.enter(
        legacy,
        legacyState,
        legacyIndex,
        Number(legacy.solution[legacyIndex]),
      );
      rules.recordEdit(
        legacyState.replay,
        legacyIndex,
        Number(legacy.solution[legacyIndex]),
        false,
      );
      const legacyPage = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      legacyPage.on("pageerror", (e) => errors.push(e.message));
      await legacyPage.route(/^https?:/, (route) => route.abort());
      await legacyPage.addInitScript(
        (save) => {
          localStorage.setItem("worktime.onboarding.v1", "dismissed");
          localStorage.setItem(
            "worktime.games.sudoku.v1",
            JSON.stringify(save),
          );
        },
        plain({
          version: 1,
          group: "triple",
          current: legacy.id,
          drafts: { [legacy.id]: legacyState },
          completed: {},
        }),
      );
      await legacyPage.goto(
        pathToFileURL(path.resolve(process.argv[2] || root, "index.html")).href,
      );
      await legacyPage.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await legacyPage.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await launchGame(legacyPage, "game-sudoku");
      assert.equal(
        await legacyPage.locator(".sudoku-cell").count(),
        legacy.givens.length,
      );
      assert.match(
        await legacyPage.locator(".game-title").innerText(),
        /第 1 关/,
      );
      assert.equal(await legacyPage.locator(".sudoku-rule").count(), 0);
      const preserved = await legacyPage.evaluate(() =>
        WorkTimeApp.services.gameArchive.normalize(
          "game-sudoku",
          JSON.parse(localStorage.getItem("worktime.games.sudoku.v1")),
        ),
      );
      assert.equal(preserved.current, legacy.id);
      assert.ok(preserved.drafts[legacy.id].replay);
      await legacyPage.locator('[data-sudoku-action="choose"]').click();
      assert.equal(
        await legacyPage.locator(".sudoku-levels button:visible").count(),
        20,
      );
      await legacyPage.locator('[data-sudoku-action="level-1"]').click();
      assert.equal(await legacyPage.locator(".sudoku-cell").count(), 180);
      await legacyPage.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Seventeen variants: offline UI, clues, empty-grid killer, six languages, mobile and archives verified.",
    );
  } finally {
    await browser.close();
  }
}
verifyRules();
if (!process.argv.includes("--rules-only"))
  verifyUI().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
