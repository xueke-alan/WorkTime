"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
const key = "worktime.games.jump.best.v1";
function verifyRules() {
  const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js/games/jump-rules.js"), "utf8"),
    sandbox,
  );
  const rules = sandbox.WorkTimeApp.games.jumpRules;
  const random = () => 0.5;
  let state = rules.create(random);
  const initial = JSON.stringify(state);
  assert.equal(rules.distance(-100), 40);
  assert.equal(rules.distance(5000), rules.distance(1300));
  const holdFor = (s, offset = 0) =>
    (Math.hypot(
      s.platforms.at(-1).x - s.position.x,
      s.platforms.at(-1).z - s.position.z,
    ) +
      offset -
      40) /
    0.32;
  const short = rules.jump(state, 0, random);
  assert.equal(short.state.status, "playing");
  assert.equal(short.gain, 0);
  assert.equal(
    JSON.stringify(state),
    initial,
    "a jump never mutates its input",
  );
  assert.equal(rules.jump(state, 1300, random).state.status, "lost");
  assert.equal(rules.jump(state, NaN), null);
  for (const gain of [2, 4, 6, 8, 10, 10]) {
    const result = rules.jump(state, holdFor(state), random);
    assert.equal(result.gain, gain);
    assert.ok(result.perfect);
    state = result.state;
  }
  assert.equal(state.score, 40);
  assert.ok(state.platforms.length <= 5, "old platforms are bounded");
  const offCenter = rules.jump(state, holdFor(state, 25), random);
  assert.equal(offCenter.gain, 1);
  assert.equal(offCenter.state.combo, 0);
  assert.equal(
    rules.jump(offCenter.state, holdFor(offCenter.state), random).gain,
    2,
  );
  assert.equal(rules.jump({ ...state, status: "lost" }, 500), null);
  assert.ok(
    rules.contains({ x: 0, z: 0, kind: "box", size: 100 }, { x: 49, z: 49 }),
  );
  assert.ok(
    !rules.contains({ x: 0, z: 0, kind: "round", size: 100 }, { x: 49, z: 49 }),
  );
  // Long runs remain reachable through both turns and minimum-sized platforms.
  for (let i = 0; i < 200; i++) {
    const result = rules.jump(state, holdFor(state));
    assert.equal(result.state.status, "playing");
    assert.equal(result.perfect, true);
    state = result.state;
  }
  console.log(
    "Jump rules: distance limits, landings, misses, center streaks, immutability and 200 reachable platforms verified.",
  );
}
async function verifyUI(browser, viewport, reducedMotion) {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    locale: "zh-CN",
    hasTouch: true,
    deviceScaleFactor: viewport.width < 500 ? 3 : 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(entry).href);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.evaluate(() => WorkTimeApp.games.load("game-jump", true));
  await page.evaluate(() => {
    localStorage.setItem("worktime.games.jump.best.v1", "{invalid");
    const rules = WorkTimeApp.games.jumpRules;
    const create = rules.create,
      jump = rules.jump;
    rules.create = () => create(() => 0.5);
    rules.jump = (...args) => {
      const result = jump(...args);
      window.jumpTestResult = result;
      return result;
    };
  });
  await page.locator("#date-tab-games").click();
  await page.locator('[data-game="game-jump"]').click();
  await page
    .locator('[data-game="game-jump"]')
    .locator('xpath=ancestor::div[contains(@class,"game-library")]')
    .locator(".game-menu-play")
    .click();
  await page.waitForFunction(
    () => document.querySelector("#gameShell").dataset.state === "open",
  );
  const clockTime = new Date();
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(new Date(clockTime.getTime() + 1000));
  const game = page.locator(".game-jump");
  const stage = page.locator(".jump-stage");
  const start = page.locator('[data-jump-action="start"]');
  const score = game.locator(".game-stat strong").first();
  const best = game.locator(".game-stat strong").nth(1);
  await start.click();
  assert.equal(await game.getAttribute("data-mode"), "playing");
  await page.clock.runFor(100);
  await stage.evaluate((element) => {
    window.jumpAnimationProbe = { layouts: 0, paints: 0 };
    const bounds = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = () => {
      window.jumpAnimationProbe.layouts++;
      return bounds();
    };
    const ctx = element.querySelector("canvas").getContext("2d");
    const clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args) => {
      window.jumpAnimationProbe.paints++;
      return clear(...args);
    };
  });
  await stage.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(540);
  if (viewport.width === 1440)
    await page.screenshot({
      path: path.join(root, "test-results/jump/charge.png"),
    });
  await page.keyboard.up("Space");
  await page.clock.runFor(240);
  if (viewport.width === 1440)
    await page.screenshot({
      path: path.join(root, "test-results/jump/flight.png"),
    });
  await page.clock.runFor(280);
  if (viewport.width === 1440)
    await page.screenshot({
      path: path.join(root, "test-results/jump/landing.png"),
    });
  await page.clock.runFor(1130);
  const probe = await page.evaluate(() => ({ ...window.jumpAnimationProbe }));
  assert.equal(probe.layouts, 0, "animation frames must not read stage layout");
  assert.ok(probe.paints > 30, "motion is rendered across successive frames");
  await page.clock.runFor(400);
  assert.equal(
    await page.evaluate(() => window.jumpAnimationProbe.paints),
    probe.paints,
    "idle scenes stop requesting animation frames",
  );
  assert.equal(await score.textContent(), "2");
  assert.equal(await best.textContent(), "2");
  assert.equal(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key),
    2,
  );
  // A second accurate jump follows the new platform and adds a streak bonus.
  const hold = await page.evaluate(() => {
    const s = window.jumpTestResult.state,
      target = s.platforms.at(-1);
    return (
      (Math.hypot(target.x - s.position.x, target.z - s.position.z) - 40) /
        0.32 +
      17
    );
  });
  const bounds = await stage.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height * 0.65,
  );
  await page.mouse.down();
  await page.clock.runFor(hold);
  await page.mouse.up();
  await page.clock.runFor(850);
  assert.equal(await score.textContent(), "6");
  // Interrupted charging must not become an accidental jump.
  await stage.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(300);
  await page.locator('[data-jump-action="pause"]').click();
  await page.keyboard.up("Space");
  await page.clock.runFor(1500);
  assert.equal(await score.textContent(), "6");
  assert.ok(await page.locator(".jump-cover").isVisible());
  await start.click();
  assert.equal(await game.getAttribute("data-phase"), "idle");
  // Use a real touch stream so pointer capture follows browser behavior.
  const touch = await context.newCDPSession(page);
  const touchPoint = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height * 0.65,
    id: 21,
  };
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint],
  });
  await page.clock.runFor(100);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  assert.equal(await game.getAttribute("data-phase"), "idle");
  await game.locator("[data-game-help]").click();
  assert.equal(await game.locator(".game-help-screen").isVisible(), true);
  await game.locator("[data-game-help-close]").click();
  await start.click();
  await page.screenshot({
    path: path.join(root, `test-results/jump/${viewport.width}.png`),
  });
  const geometry = await game.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const stage = element.querySelector(".jump-stage").getBoundingClientRect();
    return {
      right: bounds.right,
      stageBottom: stage.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  assert.ok(geometry.right <= geometry.viewportWidth + 1);
  assert.ok(geometry.stageBottom <= geometry.viewportHeight);
  // Freeze a flight, then resume at the same score and complete it.
  await stage.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(1400);
  await page.keyboard.up("Space");
  await page.clock.runFor(150);
  await page.locator('[data-jump-action="pause"]').click();
  await page.clock.runFor(1800);
  assert.equal(await game.getAttribute("data-mode"), "playing");
  await start.click();
  await page.clock.runFor(1000);
  assert.equal(await game.getAttribute("data-mode"), "over");
  assert.equal(await best.textContent(), "6");
  await start.click();
  assert.equal(await score.textContent(), "0");
  assert.equal(await best.textContent(), "6");
  for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
    await page.evaluate(
      (language) => WorkTimeApp.i18n.setLanguage(language),
      language,
    );
    assert.ok(!(await stage.getAttribute("aria-label")).includes("games.jump"));
  }
  await page.locator("#gameExitButton").click();
  await page.clock.runFor(500);
  assert.equal(await game.count(), 0);
  await page.locator('[data-game="game-jump"]').click();
  await page
    .locator('[data-game="game-jump"]')
    .locator('xpath=ancestor::div[contains(@class,"game-library")]')
    .locator(".game-menu-play")
    .click();
  await page.clock.runFor(600);
  assert.equal(await best.textContent(), "6");
  assert.equal(await score.textContent(), "0");
  await start.click();
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint],
  });
  await page.clock.runFor(540);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.clock.runFor(850);
  assert.equal(
    await score.textContent(),
    "2",
    "touch hold and release scores a center jump",
  );
  await page.locator('[data-jump-action="restart"]').click();
  // Storage failures leave a playable game and a visible status message.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("blocked storage");
    };
  });
  await stage.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(1400);
  await page.keyboard.up("Space");
  await page.clock.runFor(1000);
  assert.equal(await game.getAttribute("data-mode"), "over");
  assert.ok((await game.locator(".game-notice").textContent()).length > 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    `Jump UI: ${viewport.width}px, ${reducedMotion}, no per-frame layout reads, idle rendering stops, keyboard/mouse/touch, streak scoring, pause/help, persistence and storage failure verified.`,
  );
}
async function main() {
  verifyRules();
  fs.mkdirSync(path.join(root, "test-results/jump"), { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    await verifyUI(browser, { width: 1440, height: 1000 }, "no-preference");
    await verifyUI(browser, { width: 390, height: 844 }, "reduce");
    await verifyUI(browser, { width: 390, height: 844 }, "no-preference");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
