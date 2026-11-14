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
const scope = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/uno-rules.js"), "utf8"),
  scope,
);
const R = scope.WorkTimeApp.games.unoRules;
const id = (color, value) =>
  R.cards.find((c) => c.color === color && c.value === value).id;
async function run() {
  fs.mkdirSync(path.join(root, "test-results/uno"), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: "no-preference",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(
      pathToFileURL(
        path.join(
          root,
          process.argv.includes("--published") ? "_site" : "",
          "index.html",
        ),
      ).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-uno");
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    const pointerTest = process.argv.includes("--pointer");
    const dense = pointerTest || process.argv.includes("--dense");
    const s = R.create(dense ? 8 : 2, "normal", 771);
    const keep = R.cards
      .filter((c) => c.color === "red" && (c.value === 10 || c.value === 11))
      .map((c) => c.id);
    s.hands = [keep, [id("blue", 1)]];
    s.discard = [id("red", 5)];
    s.color = "red";
    s.turn = 0;
    s.direction = 1;
    s.openingColor = false;
    s.direction = 1;
    s.openingColor = false;
    s.log = [];
    s.deck = R.cards
      .map((c) => c.id)
      .filter(
        (n) => !keep.includes(n) && n !== s.hands[1][0] && n !== s.discard[0],
      );
    if (dense) {
      const top = id("red", 5),
        human = id("wild", 13);
      const pool = R.cards
        .filter((c) => c.id !== top && c.id !== human && c.value <= 9)
        .map((c) => c.id);
      s.hands = [[human]];
      if (pointerTest) s.hands[0] = pool.splice(0, 7);
      for (let player = 1; player < 8; player++)
        s.hands.push(pool.splice(0, 7));
      s.deck = R.cards
        .map((c) => c.id)
        .filter((n) => n !== top && !s.hands.flat().includes(n));
      s.turn = 1;
      if (process.argv.includes("--counterclockwise")) s.direction = -1;
    }
    s.scores = s.hands.map(() => 0);
    await page.evaluate(
      (state) =>
        localStorage.setItem(
          "worktime.games.uno.v1",
          JSON.stringify({ version: 1, state }),
        ),
      JSON.parse(JSON.stringify(s)),
    );
    if (pointerTest)
      await page.evaluate(() => {
        const animate = Element.prototype.animate;
        window.pointerRoutes = [];
        let seat = "1";
        Element.prototype.animate = function (frames, options) {
          if (this.matches(".uno-player-pointer")) {
            const next = this.closest(".uno-table").dataset.current;
            const angles = frames.map((f) =>
              Number(f.transform.match(/^rotate\(([-.\d]+)deg\)/)[1]),
            );
            window.pointerRoutes.push({
              sameSeat: next === seat,
              delta: angles[1] - angles[0],
              seat: next,
              direction: Number(
                this.closest(".uno-table").querySelector(".uno-direction")
                  .dataset.direction,
              ),
            });
            seat = next;
          }
          return animate.call(this, frames, options);
        };
      });
    await launchGame(page, "game-uno");
    await page.waitForFunction(
      () => !document.querySelector(".workspace.is-game-transitioning"),
    );
    if (pointerTest) {
      const deadline = Date.now() + 90000;
      for (;;) {
        const live = await page.evaluate(() => ({
          state: JSON.parse(localStorage.getItem("worktime.games.uno.v1"))
            .state,
          busy: !!document.querySelector(".game-uno[data-visual-busy]"),
        }));
        if (Date.now() >= deadline) {
          await page.screenshot({
            path: path.join(root, "_uno-pointer-error.png"),
          });
          throw new Error("multi-lap game stopped: " + JSON.stringify(live));
        }
        assert.equal(live.state.status, "playing");
        if (live.state.actions >= 28 && !live.busy) break;
        if (!live.busy && live.state.turn === 0) {
          const actions = R.legal(live.state);
          const action = actions.find((a) => a.type === "play") || actions[0];
          if (action.type === "play") {
            const card = page.locator(`.uno-hand [data-card="${action.card}"]`);
            if (R.cards[action.card].color === "wild") {
              await card.hover();
              await page
                .locator(`.uno-color-swatch.uno-color-${action.color}`)
                .click();
            } else await card.click();
          } else
            await page.locator(`[data-uno-action="${action.type}"]`).click();
        }
        await page.waitForTimeout(100);
      }
      const routes = await page.evaluate(() => window.pointerRoutes);
      const bad = routes.filter((r) => r.sameSeat && Math.abs(r.delta) > 5);
      assert.deepEqual(
        bad,
        [],
        "drawing/rerendering the same seat cannot add a lap",
      );
      assert.ok(routes.filter((r) => !r.sameSeat).length >= 16);
      assert.ok(
        routes
          .filter((r) => !r.sameSeat)
          .every((r) => r.delta * r.direction > 0),
      );
      console.log(
        "Multi-lap pointer routes verified: " +
          JSON.stringify({ direction: s.direction, routes: routes.length }),
      );
      return;
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate((dense) => {
      const host = document.querySelector(".game-uno");
      const probe = (window.unoPerf = {
        reads: 0,
        styles: 0,
        removed: 0,
        reset: 0,
        motionWrites: 0,
        frames: [],
        last: performance.now(),
      });
      const rect = Element.prototype.getBoundingClientRect,
        style = window.getComputedStyle;
      Element.prototype.getBoundingClientRect = function () {
        if (this.closest?.(".game-uno")) probe.reads++;
        return rect.call(this);
      };
      window.getComputedStyle = function (el, ...args) {
        if (el.closest?.(".game-uno")) probe.styles++;
        return style.call(this, el, ...args);
      };
      probe.selector = dense
        ? ".uno-own-info .uno-call svg"
        : '.uno-seat[data-seat="1"] .uno-call svg';
      probe.badge = host.querySelector(probe.selector);
      probe.ringClock = host
        .querySelector(".uno-direction")
        .getAnimations()
        .find((a) => a.effect.getTiming().iterations === Infinity);
      probe.clock = probe.badge.getAnimations()[0];
      probe.observer = new MutationObserver((records) => {
        for (const r of records) {
          if (
            r.type === "attributes" &&
            r.target.matches(".uno-direction,.uno-player-pointer")
          )
            probe.motionWrites++;
          for (const n of r.removedNodes)
            if (n.nodeType === 1)
              probe.removed += n.matches(".uno-card,.uno-mini-back")
                ? 1
                : n.querySelectorAll(".uno-card,.uno-mini-back").length;
        }
      });
      probe.observer.observe(host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
      const tick = (t) => {
        probe.frames.push(t - probe.last);
        probe.last = t;
        probe.raf = requestAnimationFrame(tick);
      };
      probe.raf = requestAnimationFrame(tick);
    }, dense);
    const tracing = process.argv.includes("--trace");
    if (tracing)
      await cdp.send("Tracing.start", {
        categories:
          "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing",
        transferMode: "ReturnAsStream",
      });
    const before = (await cdp.send("Performance.getMetrics")).metrics;
    if (dense) {
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
            .actions >= 4,
      );
      await page.waitForFunction(
        () => !document.querySelector(".game-uno[data-visual-busy]"),
      );
      await page.evaluate(() => {
        const p = window.unoPerf,
          b = document.querySelector(p.selector);
        if (b !== p.badge || b.getAnimations()[0] !== p.clock) p.reset++;
      });
    } else
      for (let n = 0; n < 4; n++) {
        await page.locator(".uno-hand .uno-legal").first().click();
        await page.waitForFunction(
          () => !document.querySelector(".game-uno[data-visual-busy]"),
        );
        await page.evaluate(() => {
          const p = window.unoPerf,
            b = document.querySelector(p.selector);
          if (document.querySelector(".uno-hand-actions:not([hidden])")) {
            if (b)
              throw new Error("last-card markers must disappear at game end");
            return;
          }
          if (b !== p.badge || b.getAnimations()[0] !== p.clock) p.reset++;
        });
      }
    const after = (await cdp.send("Performance.getMetrics")).metrics;
    if (tracing) {
      const done = new Promise((resolve) =>
        cdp.once("Tracing.tracingComplete", resolve),
      );
      await cdp.send("Tracing.end");
      const { stream } = await done;
      let raw = "";
      for (;;) {
        const part = await cdp.send("IO.read", { handle: stream });
        raw += part.data;
        if (part.eof) break;
      }
      await cdp.send("IO.close", { handle: stream });
      const events = JSON.parse(raw).traceEvents.filter(
        (e) => e.ph === "X" && e.dur > 1000,
      );
      const top = events
        .filter((e) =>
          [
            "FunctionCall",
            "Layout",
            "UpdateLayoutTree",
            "Paint",
            "EventDispatch",
          ].includes(e.name),
        )
        .sort((a, b) => b.dur - a.dur)
        .slice(0, 35)
        .map((e) => ({ name: e.name, ms: e.dur / 1000, data: e.args }));
      fs.writeFileSync(
        path.join(root, "test-results/uno/performance-trace-summary.json"),
        JSON.stringify(top, null, 2),
      );
      console.log(JSON.stringify(top.slice(0, 8)));
    }
    const results = await page.evaluate(() => {
      const p = window.unoPerf;
      cancelAnimationFrame(p.raf);
      p.observer.disconnect();
      const sorted = p.frames.slice().sort((a, b) => a - b);
      return {
        rectReads: p.reads,
        styleReads: p.styles,
        removedCards: p.removed,
        badgeResets: p.reset,
        motionStyleWrites: p.motionWrites,
        ringPreserved:
          p.ringClock ===
          document
            .querySelector(".uno-direction")
            .getAnimations()
            .find((a) => a.effect.getTiming().iterations === Infinity),
        frames: sorted.length,
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
        maxFrameMs: Math.max(...sorted),
        framesOver50ms: sorted.filter((n) => n > 50).length,
      };
    });
    for (const key of [
      "LayoutCount",
      "RecalcStyleCount",
      "LayoutDuration",
      "RecalcStyleDuration",
      "ScriptDuration",
    ])
      results[key] =
        after.find((m) => m.name === key).value -
        before.find((m) => m.name === key).value;
    const output = path.join(
      root,
      "test-results/uno",
      `performance-${dense ? "dense-" : ""}${process.argv.includes("--baseline") ? "before" : "after"}.json`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    if (!process.argv.includes("--baseline")) {
      if (dense)
        assert.ok(
          results.motionStyleWrites < 60,
          "compositor cruise must not rewrite transforms every animation frame",
        );
      assert.equal(
        results.badgeResets,
        0,
        "unaffected 1! nodes and animation clocks survive all four turns",
      );
      assert.equal(
        results.ringPreserved,
        true,
        "the compositor rotation clock remains the same across turn updates",
      );
      assert.ok(
        results.removedCards < (dense ? 30 : 25),
        "turn changes cannot remove and rebuild whole hands",
      );
    }
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
