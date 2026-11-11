"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const site = path.resolve(process.argv[2] || root);
const probe = `<!doctype html><base href="/"><script>window.WorkTimeApp={games:{},data:{},services:{assets:{script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});}}}};</script><script src="assets/js/games/gomoku-engine.js"></script>`;
async function main() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/probe") return res.end(probe);
    const file = path.resolve(site, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(site + path.sep)) return res.writeHead(403).end();
    if (/\.(wasm|lz4|bin)$/.test(file)) requests.push(url.pathname);
    fs.readFile(file, (error, bytes) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
      );
      res.end(bytes);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const offline of [false, true]) {
      const page = await browser.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") console.error(msg.text());
      });
      if (offline) {
        await page.goto(pathToFileURL(path.join(site, "index.html")).href);
        await page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await page.evaluate(() => WorkTimeApp.games.load("game-gomoku"));
      } else await page.goto(`http://127.0.0.1:${server.address().port}/probe`);
      const results = await page.evaluate(async () => {
        const engine = WorkTimeApp.games.createGomokuEngine();
        const run = async (path, difficulty) => {
          const board = Array(225).fill(0);
          path.forEach((p, i) => (board[p] = (i % 2) + 1));
          const snapshot = [...board];
          const result = await engine.search({ board, path }, difficulty);
          if (JSON.stringify(board) !== JSON.stringify(snapshot))
            throw Error("Mutated board");
          return result;
        };
        const out = [];
        for (const difficulty of ["normal", "hard", "master"]) {
          const opening = await run([], difficulty);
          const midgame = await run([112, 113, 97, 127, 96, 128], difficulty);
          const win = await run([105, 104, 106, 0, 107, 2, 108, 4], difficulty);
          const block = await run([105, 104, 106, 0, 107, 2, 108], difficulty);
          const whiteWin = await run(
            [104, 105, 0, 106, 2, 107, 4, 108, 6],
            difficulty,
          );
          out.push({ difficulty, opening, midgame, win, block, whiteWin });
        }
        engine.cancel();
        const reloaded = await run([112], "normal");
        const cancelled = engine
          .search({ board: Array(225).fill(0), path: [] }, "master")
          .then(
            () => false,
            () => true,
          );
        engine.cancel();
        const cancellation = await cancelled;
        engine.dispose();
        return { out, reloaded, cancellation };
      });
      for (const result of results.out) {
        assert.equal(result.opening.move, 112);
        assert.ok(![112, 113, 97, 127, 96, 128].includes(result.midgame.move));
        assert.ok(
          result.midgame.diagnostics.some((line) => /depth|Depth/.test(line)),
          "real search completed a depth",
        );
        assert.equal(result.win.move, 109, "black takes win");
        assert.equal(result.block.move, 109, "white blocks four");
        assert.equal(result.whiteWin.move, 109, "white takes win");
        assert.equal(result.win.model, "mix9svqfreestyle_bsmix");
      }
      assert.ok(results.cancellation);
      assert.ok(results.reloaded.move >= 0);
      console.log(
        offline ? "file://" : "HTTP",
        "real NNUE: all difficulties, both colors, tactics, reload and cancellation passed",
      );
      if (!offline) {
        assert.equal(
          requests.length,
          3,
          "binary cache avoids repeat downloads",
        );
        await page.evaluate(async () => {
          const cache = await caches.open("worktime-rapfi-binaries-v1");
          const key = (await cache.keys()).find((key) =>
            key.url.endsWith(".lz4"),
          );
          await cache.put(key, new Response(new Uint8Array([0])));
          const engine = WorkTimeApp.games.createGomokuEngine();
          await engine.load();
          engine.dispose();
        });
        assert.equal(
          requests.length,
          4,
          "corrupt model is downloaded and repaired",
        );
        await page.route("**/worker-source.js", (route) => route.abort());
        assert.equal(
          await page.evaluate(async () => {
            window.retryEngine = WorkTimeApp.games.createGomokuEngine();
            return window.retryEngine.load().then(
              () => false,
              () => true,
            );
          }),
          true,
          "load failure rejects instead of falling back",
        );
        await page.unroute("**/worker-source.js");
        await page.evaluate(async () => {
          await window.retryEngine.load();
          window.retryEngine.dispose();
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
