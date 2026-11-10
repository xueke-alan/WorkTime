"use strict";
require("../lib/browser-test-setup.cjs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "scripts/utttai/bakeoff-results.json");
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await page.evaluate(() =>
      WorkTimeApp.services.assets.scripts([
        "assets/js/games/ultimate-ttt-rules.js",
        "assets/js/games/ultimate-ttt-engine.js",
      ]),
    );
    await page.exposeFunction("bakeoffProgress", (result) => {
      const archive = fs.existsSync(output)
        ? JSON.parse(fs.readFileSync(output, "utf8"))
        : { games: [] };
      archive.games.push(result);
      archive.modelHash =
        "81161d2e262c9904dbb9a14961a2fcd043009fab4fd4f76b41451587f89c60d2";
      archive.budgets = { easy: 200, normal: 1000, hard: 3000 };
      fs.writeFileSync(output, JSON.stringify(archive, null, 2) + "\n");
      console.log(
        `${archive.games.length}/160 ${result.chain ? "chain" : "regular"} ${result.strong}/${result.weak} score=${result.score} plies=${result.path.length - result.opening.length}`,
      );
    });
    const existing = fs.existsSync(output)
      ? JSON.parse(fs.readFileSync(output, "utf8")).games
      : [];
    await page.evaluate(async (existing) => {
      const G = WorkTimeApp.games,
        R = G.ultimateTttRules;
      let seed = 20261111;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const jobs = [];
      for (const chain of [false, true]) {
        const openings = new Set();
        while (openings.size < 20) {
          let state = R.create(chain);
          while (state.status === "playing") {
            const legal = R.legal(state);
            state = R.move(state, legal[Math.floor(random() * legal.length)]);
          }
          // Fixed late-midgame openings keep a full-budget regression practical.
          const opening = state.path.slice(
            0,
            Math.max(4, state.path.length - 18),
          );
          openings.add(JSON.stringify(opening));
        }
        for (const openingText of openings)
          for (const [strong, weak] of [
            ["normal", "easy"],
            ["hard", "normal"],
          ])
            for (const strongSide of [1, -1]) {
              const key = JSON.stringify([
                chain,
                openingText,
                strong,
                strongSide,
              ]);
              if (!existing.some((g) => g.key === key))
                jobs.push({
                  key,
                  chain,
                  opening: JSON.parse(openingText),
                  strong,
                  weak,
                  strongSide,
                });
            }
      }
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          const engine = G.createUltimateTttEngine();
          try {
            await engine.load();
            while (jobs.length) {
              const job = jobs.shift();
              let state = R.replay(job.opening, job.chain);
              const stats = [];
              while (state.status === "playing") {
                const difficulty =
                  state.turn === job.strongSide ? job.strong : job.weak;
                const result = await engine.search(state, difficulty);
                stats.push({
                  move: result.move,
                  difficulty,
                  simulations: result.simulations,
                  elapsed: result.elapsed,
                });
                state = R.move(state, result.move);
                if (!state) throw Error("Illegal tournament move");
              }
              await window.bakeoffProgress({
                ...job,
                path: state.path,
                winner: state.winner,
                reason: state.reason,
                score:
                  state.winner === 0
                    ? 0.5
                    : state.winner === job.strongSide
                      ? 1
                      : 0,
                stats,
              });
            }
          } finally {
            engine.dispose();
          }
        }),
      );
    }, existing);
    const archive = JSON.parse(fs.readFileSync(output, "utf8"));
    archive.summary = [];
    for (const chain of [false, true])
      for (const strong of ["normal", "hard"]) {
        const games = archive.games.filter(
          (g) => g.chain === chain && g.strong === strong,
        );
        const score = games.reduce((n, g) => n + g.score, 0) / games.length;
        archive.summary.push({
          chain,
          strong,
          games: games.length,
          wins: games.filter((g) => g.score === 1).length,
          draws: games.filter((g) => g.score === 0.5).length,
          score,
        });
      }
    fs.writeFileSync(output, JSON.stringify(archive, null, 2) + "\n");
    console.log(archive.summary);
    assert.equal(archive.games.length, 160);
    assert(
      archive.summary.every((s) => s.score > 0.5),
      "Higher difficulty must score above 50% in both modes",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
