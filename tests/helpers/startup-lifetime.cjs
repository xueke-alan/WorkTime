"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
// Exercise the actual startup module in an isolated browser document. No app storage.
module.exports = async function checkStartupLifetime(context) {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../assets/js/startup.js"),
    "utf8",
  );
  const rows = [];
  for (const phase of [
    "fonts",
    "initializing",
    "first-frame",
    "second-frame",
    "number-timer",
    "healthy",
  ]) {
    const page = await context.newPage();
    await page.setContent(
      '<div class="workspace"><div class="panel"></div></div><div class="summary-sidebar"></div>',
    );
    const result = await page.evaluate(
      async ({ source, phase }) => {
        const calls = { alignment: 0, motion: 0, numbers: 0, notifications: 0 };
        const frames = new Map();
        let nextFrame = 0,
          fontRelease;
        const originalRequest = requestAnimationFrame,
          originalCancel = cancelAnimationFrame;
        window.requestAnimationFrame = (callback) => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        };
        window.cancelAnimationFrame = (id) => frames.delete(id);
        const runFrame = () => {
          const [id, callback] = frames.entries().next().value;
          frames.delete(id);
          callback(performance.now());
        };
        Object.defineProperty(document.fonts, "ready", {
          value: new Promise((resolve) => (fontRelease = resolve)),
          configurable: true,
        });
        document.documentElement.dataset.appState =
          phase === "initializing" ? "initializing" : "ready";
        window.UIAlignment = { refresh: () => calls.alignment++ };
        window.WorkMotion = { play: () => calls.motion++ };
        window.SummaryNumbers = { reveal: () => calls.numbers++ };
        window.NotificationMotion = { reveal: () => calls.notifications++ };
        const script = document.createElement("script");
        script.textContent = source;
        document.body.append(script);
        if (phase === "fonts") dispatchEvent(new Event("pagehide"));
        fontRelease();
        await Promise.resolve();
        if (phase === "initializing") {
          dispatchEvent(new Event("pagehide"));
          document.dispatchEvent(new Event("worktime:ready"));
          await Promise.resolve();
        }
        if (["second-frame", "number-timer", "healthy"].includes(phase))
          runFrame();
        if (["number-timer", "healthy"].includes(phase)) runFrame();
        const before = { ...calls };
        if (phase !== "healthy") {
          dispatchEvent(new Event("pagehide"));
          dispatchEvent(new Event("pagehide"));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        const result = {
          phase,
          before,
          after: { ...calls },
          pendingFrames: frames.size,
        };
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
        return result;
      },
      { source, phase },
    );
    if (phase === "healthy")
      assert.deepEqual(result.after, {
        alignment: 1,
        motion: 1,
        numbers: 1,
        notifications: 1,
      });
    else
      assert.deepEqual(
        result.after,
        result.before,
        `${phase}: no callback after exit`,
      );
    assert.equal(result.pendingFrames, 0, `${phase}: no retained frame`);
    if (["fonts", "initializing", "first-frame"].includes(phase))
      assert.deepEqual(result.after, {
        alignment: 0,
        motion: 0,
        numbers: 0,
        notifications: 0,
      });
    rows.push(result);
    await page.close();
  }
  return rows;
};
