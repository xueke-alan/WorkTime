"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
const { rate, signature } = require("./killer-rating.cjs");
const root = path.resolve(__dirname, "..");
const ctx = { WorkTimeApp: { data: {}, games: {} } };
for (const file of ["assets/data/sudoku.js", "assets/js/games/sudoku-rules.js"])
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), ctx);
const puzzles = JSON.parse(
  JSON.stringify(
    ctx.WorkTimeApp.data.sudoku.groups.find((g) => g.id === "killer").puzzles,
  ),
);
const report = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/killer-difficulty.json"), "utf8"),
);
function verifyRules() {
  // Check pruning against both a known valid full cage partition and a contradiction.
  const fixture = {
    givens: "0".repeat(81),
    cages: Array.from({ length: 81 }, (_, i) => ({
      cells: [i],
      sum: ((Math.floor(i / 9) * 3 + Math.floor(i / 27) + (i % 9)) % 9) + 1,
    })),
  };
  assert.equal(rate(fixture).solutions.length, 1);
  fixture.cages[0].sum = 0;
  assert.equal(rate(fixture).solutions.length, 0);
  assert.equal(puzzles.length, 30);
  let score = 0;
  const geometries = new Set(puzzles.slice(0, 20).map(signature));
  for (const [i, p] of puzzles.entries()) {
    assert.equal(p.id, "killer-" + (i + 1));
    const r = rate(p);
    assert.deepEqual(r.solutions, [p.solution]);
    const { solutions, ...metrics } = r;
    assert.deepEqual(report.rows[i], {
      id: p.id,
      ...metrics,
      solutionCount: solutions.length,
    });
    if (i < 20) {
      assert.equal(p.difficulty, undefined);
      continue;
    }
    assert.equal(p.difficulty, "hard");
    const geometry = signature(p);
    assert.ok(!geometries.has(geometry), p.id + " distinct geometry");
    geometries.add(geometry);
    assert.equal(r.givens, 0);
    assert.equal(r.singleCages, 0);
    assert.ok(r.remaining > 0 && r.depth >= 3 && r.score > report.threshold);
    assert.ok(r.score >= score);
    score = r.score;
    const solved = {
      ...ctx.WorkTimeApp.games.sudokuRules.create(p),
      values: Array.from(p.solution, Number),
    };
    assert.ok(ctx.WorkTimeApp.games.sudokuRules.won(p, solved));
    assert.deepEqual(
      p.cages.flatMap((c) => c.cells).sort((a, b) => a - b),
      Array.from({ length: 81 }, (_, i) => i),
    );
    for (const c of p.cages) {
      assert.equal(
        new Set(c.cells.map((i) => p.solution[i])).size,
        c.cells.length,
      );
      assert.equal(
        c.sum,
        c.cells.reduce((s, i) => s + Number(p.solution[i]), 0),
      );
      const seen = new Set([c.cells[0]]);
      for (let pass = 0; pass < c.cells.length; pass++)
        for (const a of c.cells)
          if (
            [...seen].some(
              (b) =>
                Math.abs(Math.floor(a / 9) - Math.floor(b / 9)) +
                  Math.abs((a % 9) - (b % 9)) ===
                1,
            )
          )
            seen.add(a);
      assert.equal(seen.size, c.cells.length);
    }
  }
}
if (!process.argv.includes("--ui-only")) verifyRules();
async function ui() {
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
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (this.id !== "onboardingDialog") show.call(this);
      };
    });
    const entry = pathToFileURL(
      path.resolve(
        process.argv.find((a) => a.startsWith("--entry="))?.slice(8) || root,
        "index.html",
      ),
    ).href;
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.waitForTimeout(400); // Allow persisted sidebar layout to settle after startup.
    await launchGame(page, "game-sudoku");
    const action = (id) => page.locator(`[data-sudoku-action="${id}"]`);
    for (const lang of ["zh-CN", "en", "zh-TW", "zh-HK", "ko", "ja"]) {
      await page.evaluate((lang) => WorkTimeApp.i18n.setLanguage(lang), lang);
      await action("killer").click();
      assert.equal(
        await page.locator(".sudoku-levels button:visible").count(),
        30,
      );
      assert.equal(await page.locator(".sudoku-level-difficulty").count(), 10);
      const text = await page.evaluate(() =>
        WorkTimeApp.i18n.t("games.sudoku.hard"),
      );
      assert.equal(
        await action("level-21")
          .locator(".sudoku-level-difficulty")
          .innerText(),
        text,
      );
      assert.ok(
        (await action("level-30").getAttribute("aria-label")).includes(text),
      );
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await action("level-21").evaluate((b) => {
          const range = document.createRange();
          range.selectNode(b.firstChild);
          const n = range.getBoundingClientRect(),
            d = b
              .querySelector(".sudoku-level-difficulty")
              .getBoundingClientRect(),
            box = b.getBoundingClientRect();
          return {
            below: d.top >= n.bottom,
            inside:
              d.bottom <= box.bottom &&
              d.left >= box.left &&
              d.right <= box.right,
          };
        });
        assert.ok(layout.below && layout.inside, lang + " " + width);
      }
      await action("easy").click();
      assert.equal(await page.locator(".sudoku-level-difficulty").count(), 0);
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await action("killer").click();
    for (const n of [21, 30]) {
      const p = puzzles[n - 1];
      await action("level-" + n).click();
      await action("cell-0").click();
      await action("digit-" + p.solution[0]).click();
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.waitForTimeout(400); // Allow persisted sidebar layout to settle after startup.
      await launchGame(page, "game-sudoku");
      const save = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("worktime.games.sudoku.v1")),
      );
      assert.equal(save.drafts[p.id].values[0], Number(p.solution[0]));
      // Seed a nearly completed valid draft to exercise the real final-move win path.
      await page.addInitScript((p) => {
        const marker = "test-seed-" + p.id;
        if (sessionStorage.getItem(marker)) return;
        sessionStorage.setItem(marker, "1");
        const key = "worktime.games.sudoku.v1",
          save = JSON.parse(localStorage.getItem(key));
        const state = {
          values: Array.from(p.solution, Number),
          notes: Array(81).fill(0),
          elapsed: 0,
          hints: 0,
          history: [],
        };
        state.values[80] = 0;
        save.current = p.id;
        save.group = "killer";
        save.drafts[p.id] = state;
        localStorage.setItem(key, JSON.stringify(save));
      }, p);
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.waitForTimeout(400); // Allow persisted sidebar layout to settle after startup.
      await launchGame(page, "game-sudoku");
      if (await page.locator(".sudoku-cover.is-paused").isVisible())
        await action("pause").click();
      await action("cell-80").click();
      await action("digit-" + p.solution[80]).click();
      await page.waitForFunction(
        (id) =>
          !!JSON.parse(localStorage.getItem("worktime.games.sudoku.v1"))
            .completed[id],
        p.id,
      );
      await action("choose").click();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Killer: 30 levels, ten hard labels, six languages, narrow screens, drafts and wins verified offline.",
    );
  } finally {
    await browser.close();
  }
}
if (!process.argv.includes("--rules-only"))
  ui().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
