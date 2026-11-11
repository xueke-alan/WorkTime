"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const site = path.resolve(process.argv[2] || root);
const probe = `<!doctype html><base href="/"><script>window.WorkTimeApp={games:{},data:{},services:{assets:{script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});}}}};</script><script src="assets/js/games/gomoku-rules.js"></script><script src="assets/js/games/gomoku-engine.js"></script>`;
const binaries = /\/assets\/vendor\/rapfi\/[^/?]+\.(wasm|lz4|bin)$/;

async function waitForStorage(page, condition) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(condition)) return;
    await delay(50);
  }
  throw Error("Rapfi storage did not finish");
}

async function verifyPrefetch(browser, origin, interceptBinaries) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const fetchAsset = window.fetch.bind(window);
    window.rapfiRequests = [];
    window.workers = 0;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.type === "init" && message.classical) window.workers++;
      return postMessage.call(this, message, ...args);
    };
    window.fetch = (url, options) => {
      if (/\/rapfi\/[^/?]+\.(wasm|lz4|bin)(\?|$)/.test(String(url)))
        window.rapfiRequests.push({
          priority: options.priority,
          ready: document.readyState === "complete",
          revealed: !document.documentElement.classList.contains("app-loading"),
        });
      return fetchAsset(url, options);
    };
    window.rapfiCacheCount = async () =>
      (await (await caches.open("worktime-rapfi-binaries-v1")).keys()).length;
    window.rapfiDirectory = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle("dependencies", { create: true });
    };
    document.addEventListener("worktime:ready", () => {
      const writable = new URL(location.href).searchParams.has("directory");
      WorkTimeApp.services.runtimeFolder.withDependencies = async (action) =>
        writable ? action(await window.rapfiDirectory()) : null;
    });
    window.playRapfi = async () => {
      await WorkTimeApp.games.load("game-gomoku");
      const engine = WorkTimeApp.games.createGomokuEngine();
      try {
        const board = Array(225).fill(0);
        board[112] = 1;
        return await engine.search({ board, path: [112] }, "normal");
      } finally {
        engine.dispose();
      }
    };
  });
  try {
    const entry = origin + "/index.html";
    let failures = 3;
    interceptBinaries(() => (failures-- > 0 ? 503 : undefined));
    await page.goto(entry);
    await page.waitForFunction(() => window.rapfiRequests.length === 3);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitForStorage(
      page,
      async () => (await window.rapfiCacheCount()) === 3,
    );
    const first = await page.evaluate(() => ({
      requests: window.rapfiRequests,
      workers: window.workers,
    }));
    assert.equal(first.requests.length, 6, "one background retry");
    assert.ok(
      first.requests.every(
        (request) =>
          request.ready && request.revealed && request.priority === "low",
      ),
      "background requests begin after load and reveal, at low priority",
    );
    assert.equal(first.workers, 0, "prefetch never starts an engine");
    assert.deepEqual(errors, [], "background failure stays silent");

    await page.goto(entry + "?directory");
    await waitForStorage(page, async () => {
      const root = await window.rapfiDirectory();
      const folder = await root.getDirectoryHandle("rapfi").catch(() => null);
      if (!folder || (await window.rapfiCacheCount()) !== 0) return false;
      const manifest = WorkTimeApp.games.rapfiAssets;
      for (const { name, size } of [
        manifest.wasm,
        manifest.model,
        manifest.classical,
      ]) {
        const handle = await folder.getFileHandle(name).catch(() => null);
        if (!handle || (await handle.getFile()).size !== size) return false;
      }
      return true;
    });
    assert.equal(await page.evaluate(() => window.workers), 0);
    assert.equal(
      (await page.evaluate(() => window.playRapfi())).engine,
      "Rapfi",
    );
    assert.equal(
      await page.evaluate(() => window.rapfiRequests.length),
      0,
      "migration and first move reuse cached binaries",
    );
    await page.evaluate(async () => {
      const directory = await window.rapfiDirectory();
      await directory.removeEntry("rapfi", { recursive: true });
    });

    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    interceptBinaries(() => hold);
    try {
      await page.goto(entry + "?directory");
      await page.waitForFunction(() => window.rapfiRequests.length === 3);
      await page.evaluate(() => {
        const resources = WorkTimeApp.games.rapfiResources;
        const load = resources.load;
        resources.load = () => {
          window.joinedPrefetch = true;
          return load();
        };
        window.firstMove = window.playRapfi();
      });
      await page.waitForFunction(() => window.joinedPrefetch);
    } finally {
      release();
    }
    assert.equal((await page.evaluate(() => window.firstMove)).engine, "Rapfi");
    assert.equal(
      await page.evaluate(() => window.rapfiRequests.length),
      3,
      "overlapping prefetch and first move share the same downloads",
    );
    console.log(
      "Idle Rapfi prefetch, online retry, disk migration and first move reuse passed.",
    );
  } finally {
    interceptBinaries(null);
    await page.close();
  }
}

async function verifyForbidden(page) {
  const result = await page.evaluate(async () => {
    const assets = WorkTimeApp.services.assets;
    await assets.script("assets/vendor/rapfi/worker-source.js");
    let bytes;
    if (location.protocol === "file:") {
      await assets.script("assets/vendor/rapfi/offline.js");
      bytes = Object.fromEntries(
        Object.entries(WorkTimeApp.games.rapfiAssets.offline)
          .filter(([key]) => key !== "model")
          .map(([key, value]) => [
            key,
            Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer,
          ]),
      );
    } else bytes = await WorkTimeApp.games.rapfiResources.load(true);
    const source =
      WorkTimeApp.games.rapfiAssets.worker.replace(
        "function output(line) {",
        'function output(line) { if (line.startsWith("FORBID ")) { self.postMessage({type:"forbid",line}); return; }',
      ) +
      `
      const originalHandler = self.onmessage;
      self.onmessage = (event) => {
        if (event.data.type !== "check") return originalHandler(event);
        engine.sendCommand("INFO rule 4");
        engine.sendCommand("START 15");
        engine.sendCommand("YXBOARD\\n" + event.data.stones.join("\\n") + "\\nDONE");
        engine.sendCommand("YXSHOWFORBID");
      };`;
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    const receive = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Forbidden oracle timed out")),
          30000,
        );
        worker.onmessage = ({ data }) => {
          if (
            data.type === "ready" ||
            data.type === "forbid" ||
            data.type === "error"
          ) {
            clearTimeout(timer);
            if (data.type === "error") reject(Error(data.message));
            else resolve(data);
          }
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(Error(event.message));
        };
      });
    try {
      const ready = receive();
      worker.postMessage(
        { type: "init", forbidden: true, ...bytes },
        Object.values(bytes),
      );
      await ready;
      let seed = 83957;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      let checked = 0;
      for (let sample = 0; sample < 32; sample++) {
        const board = Array(225).fill(0);
        const count = 8 + (sample % 24);
        for (const side of [1, 2]) {
          for (let n = 0; n < count; n++) {
            let p;
            do {
              p = (3 + (random() % 9)) * 15 + 3 + (random() % 9);
            } while (board[p]);
            board[p] = side;
          }
        }
        const stones = [1, 2].flatMap((side) =>
          board.flatMap((s, p) =>
            s === side ? [`${p % 15},${Math.floor(p / 15)},${side}`] : [],
          ),
        );
        const response = receive();
        worker.postMessage({ type: "check", stones });
        const { line } = await response;
        const expected = new Set();
        for (const match of line.slice(7, -1).matchAll(/(\d{2})(\d{2})/g))
          expected.add(Number(match[2]) * 15 + Number(match[1]));
        for (let p = 0; p < 225; p++) {
          if (board[p]) continue;
          const actual = WorkTimeApp.games.gomokuRules.forbiddenReason(
            board,
            p,
          );
          if (!!actual !== expected.has(p))
            throw Error(
              JSON.stringify({
                sample,
                p,
                actual,
                expected: [...expected],
                board,
              }),
            );
          checked++;
        }
      }
      return checked;
    } finally {
      worker.terminate();
    }
  });
  console.log("Rapfi forbidden-point differential checks passed:", result);
}

async function main() {
  const requests = [];
  let beforeBinary;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/probe") return res.end(probe);
    const file = path.resolve(site, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(site + path.sep)) return res.writeHead(403).end();
    if (binaries.test(url.pathname)) {
      requests.push(url.pathname);
      const status = await beforeBinary?.();
      if (status) return res.writeHead(status).end();
    }
    fs.readFile(file, (error, bytes) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".css")
              ? "text/css"
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
    await verifyPrefetch(
      browser,
      `http://127.0.0.1:${server.address().port}`,
      (intercept) => {
        beforeBinary = intercept;
      },
    );
    requests.length = 0;
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
        const run = async (path, difficulty, forbidden = false) => {
          const board = Array(225).fill(0);
          path.forEach((p, i) => (board[p] = (i % 2) + 1));
          const snapshot = [...board];
          const result = await engine.search(
            { board, path },
            difficulty,
            undefined,
            forbidden,
          );
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
        for (const difficulty of ["normal", "hard", "master"]) {
          const opening = await run([], difficulty, true);
          const midgame = await run(
            [112, 113, 97, 127, 96, 128],
            difficulty,
            true,
          );
          const win = await run(
            [105, 104, 106, 0, 107, 2, 108, 4],
            difficulty,
            true,
          );
          const block = await run(
            [105, 104, 106, 0, 107, 2, 108],
            difficulty,
            true,
          );
          const whiteWin = await run(
            [104, 105, 0, 106, 2, 107, 4, 108, 6],
            difficulty,
            true,
          );
          const avoidsForbidden = await run(
            [111, 0, 113, 2, 97, 4, 127, 6],
            difficulty,
            true,
          );
          if (avoidsForbidden.move === 112)
            throw Error("AI played double three");
          const whiteTrap = await run(
            [107, 108, 97, 109, 127, 110, 96, 0, 128],
            difficulty,
            true,
          );
          if (whiteTrap.move !== 111)
            throw Error(
              "White missed forced win through forbidden defense: " +
                whiteTrap.move,
            );
          out.push({
            difficulty,
            forbidden: true,
            opening,
            midgame,
            win,
            block,
            whiteWin,
          });
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
        assert.equal(
          result.win.model,
          result.forbidden
            ? "mix9svqrenju_bs15_black"
            : "mix9svqfreestyle_bsmix",
        );
        if (result.forbidden)
          assert.equal(result.whiteWin.model, "mix9svqrenju_bs15_white");
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
          5,
          "binary cache avoids repeat downloads",
        );
        await page.evaluate(async () => {
          const cache = await caches.open("worktime-rapfi-binaries-v1");
          const key = (await cache.keys()).find((key) =>
            key.url.includes("mix9svqfreestyle"),
          );
          await cache.put(key, new Response(new Uint8Array([0])));
          const engine = WorkTimeApp.games.createGomokuEngine();
          await engine.load();
          engine.dispose();
        });
        assert.equal(
          requests.length,
          6,
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
      await verifyForbidden(page);
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
