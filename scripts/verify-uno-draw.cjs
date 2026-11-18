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
const site = path.resolve(process.argv[2] || root);
const scope = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/uno-rules.js"), "utf8"),
  scope,
);
const R = scope.WorkTimeApp.games.unoRules;
const id = (color, value) =>
  R.cards.find((c) => c.color === color && c.value === value).id;
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "no-preference",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    await launchGame(page, "game-uno");
    const setupOutput = path.join(root, "test-results/uno");
    fs.mkdirSync(setupOutput, { recursive: true });
    assert.equal(
      await page.locator(".uno-setup select.game-native-select").count(),
      2,
    );
    assert.equal(
      await page.locator(".uno-setup .game-select-trigger").count(),
      2,
    );
    assert.equal(
      await page.locator('[data-uno-setting="discard-limit"]').count(),
      0,
    );
    assert.equal(await page.locator("#uno-targetScore").count(), 0);
    assert.equal(await page.locator(".uno-rule-section").count(), 0);
    assert.match(
      await page.locator(".uno-rank-summary").innerText(),
      /黑铁 III/,
    );
    await page.locator('[data-uno-action="viewRules"]').click();
    await page.locator(".uno-rule-section").first().waitFor();
    assert.equal(await page.locator(".uno-rule-section").count(), 6);
    const setupBox = await page.locator(".uno-setup").boundingBox(),
      rulesBox = await page.locator(".uno-setup-rules").boundingBox();
    assert.ok(
      rulesBox.x > setupBox.x + setupBox.width &&
        Math.abs(rulesBox.y - setupBox.y) < 2,
    );
    for (const locale of ["en", "zh-TW", "zh-HK", "ko", "ja", "zh-CN"]) {
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        locale,
      );
      assert.equal(
        await page.locator(".uno-setup .game-select-trigger").count(),
        2,
      );
      assert.ok(
        (await page.locator(".uno-setup-rules").innerText()).includes("500"),
      );
      assert.ok(
        !(await page.locator(".uno-setup-layout").innerText()).includes(
          "games.uno.",
        ),
      );
    }
    await page.screenshot({
      path: path.join(setupOutput, "setup-desktop.png"),
    });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(150);
    const mobileForm = await page.locator(".uno-setup").boundingBox(),
      mobileRules = await page.locator(".uno-setup-rules").boundingBox();
    assert.ok(mobileRules.y >= mobileForm.y + mobileForm.height);
    assert.ok(
      await page
        .locator(".game-uno")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({ path: path.join(setupOutput, "setup-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    await page.locator('[data-uno-action="backToRecords"]').click();
    const modeSwitch = page.locator(".uno-mode-switch");
    assert.equal(await modeSwitch.getAttribute("aria-checked"), "false");
    assert.equal(
      await modeSwitch.evaluate(
        (el) => el.nextElementSibling.dataset.unoAction,
      ),
      "start",
    );
    await modeSwitch.press("Space");
    assert.equal(await modeSwitch.getAttribute("aria-checked"), "true");
    assert.equal(await page.locator("#uno-players").inputValue(), "4");
    assert.equal(await page.locator("#uno-difficulty").inputValue(), "easy");
    assert.ok(await page.locator("#uno-playersTrigger").isDisabled());
    assert.ok(await page.locator("#uno-difficultyTrigger").isDisabled());
    await page.locator('[data-uno-action="viewRules"]').click();
    assert.equal(await modeSwitch.getAttribute("aria-checked"), "true");
    await page.locator('[data-uno-action="backToRecords"]').click();
    await page.locator('[data-uno-action="start"]').click();
    const readSave = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")),
      );
    const ranked = await readSave();
    assert.equal(ranked.state.targetScore, 500);
    assert.equal(ranked.match.mode, "ranked");
    assert.equal(ranked.state.difficulty, "easy");
    assert.match(
      await page
        .locator("#gameShell .game-content")
        .evaluate((el) => getComputedStyle(el).backgroundImage),
      /repeating-conic-gradient/,
    );
    const settingsButton = page.locator(
      '.uno-corner-controls [data-uno-action="exit"]',
    );
    assert.equal(await page.locator(".uno-corner-controls button").count(), 1);
    assert.equal(await settingsButton.locator("svg").count(), 1);
    await settingsButton.click();
    const quitDialog = page.getByRole("dialog", { name: "确定退出排位吗？" });
    assert.ok(
      await quitDialog.getByRole("img", { name: "扣除 15 段位分" }).isVisible(),
    );
    assert.ok(
      await quitDialog
        .getByRole("button", { name: "取消" })
        .evaluate((el) => el === document.activeElement),
    );
    await page.locator('.uno-confirm [data-uno-action="cancel"]').click();
    assert.deepEqual(await readSave(), ranked);
    await settingsButton.click();
    await page.locator('.uno-confirm [data-uno-action="exit"]').click();
    assert.equal((await readSave()).state, null);
    assert.equal(await page.locator('[data-uno-action="continue"]').count(), 0);
    assert.equal((await readSave()).profile.rating, 0);
    assert.match(
      await page.locator(".uno-history-delta").innerText(),
      /^[−-]15$/,
    );
    assert.equal(await page.locator(".uno-history-card details").count(), 0);
    assert.equal(await page.locator(".uno-rank-progress-label").count(), 0);
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => WorkTimeApp.services.assets.whenIdle());
    if (!(await modeSwitch.isVisible())) await launchGame(page, "game-uno");
    assert.equal(await modeSwitch.getAttribute("aria-checked"), "true");
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    await page.locator('[data-uno-action="start"]').click();
    const restarted = await readSave();
    assert.notEqual(restarted.match.id, ranked.match.id);
    assert.equal(restarted.profile.history.length, 1);
    assert.equal(restarted.profile.history[0].result, "abandoned");
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "false";
    });
    async function reopen(save, extra = {}) {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
      assert.ok(R.restore(save), "fixture must be a valid save");
      await page.evaluate(
        (payload) =>
          localStorage.setItem(
            "worktime.games.uno.v1",
            JSON.stringify(payload),
          ),
        JSON.parse(JSON.stringify({ version: 1, state: save, ...extra })),
      );
      await launchGame(page, "game-uno");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
    }
    function fixture(count) {
      const s = R.create(2, "normal", 771);
      s.hands = [
        [id("red", 1), id("blue", 2)],
        [id("green", 3), id("yellow", 4)],
      ];
      s.turn = 0;
      s.direction = 1;
      s.color = "red";
      s.openingColor = false;
      s.drawn = null;
      s.actions = 0;
      s.log = [];
      s.scores = [24, 13];
      const used = new Set(s.hands.flat());
      const pool = R.cards
        .map((c) => c.id)
        .filter((n) => !used.has(n) && n !== id("red", 5));
      s.deck = pool.splice(0, count);
      s.discard = [...pool, id("red", 5)];
      return s;
    }
    // Finish a real ranked turn through the UI, then reopen the same save.
    const finalRound = fixture(10);
    finalRound.hands = [
      [id("red", 1)],
      [id("blue", 8)],
      [id("green", 8)],
      [id("yellow", 8)],
    ];
    finalRound.round = 2;
    finalRound.difficulty = ranked.state.difficulty;
    finalRound.scores = [490, 0, 0, 0];
    const used = [...finalRound.hands.flat(), ...finalRound.discard.slice(-1)];
    finalRound.discard = finalRound.discard.slice(-1);
    finalRound.deck = R.cards
      .map((card) => card.id)
      .filter((card) => !used.includes(card));
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "true"),
    );
    await reopen(finalRound, {
      profile: {
        rating: 190,
        history: [
          {
            ...restarted.profile.history[0],
            before: 205,
            after: 190,
            delta: -15,
          },
        ],
      },
      match: { ...restarted.match, completedRounds: 1, decisive: 1, wins: 1 },
    });
    const rankName = page.locator(".uno-own-info .uno-name-line > strong");
    assert.equal(await rankName.textContent(), "我（黑铁 2）");
    await page.locator(".uno-hand .uno-legal").click();
    const finished = await readSave();
    assert.equal(finished.state.matchWinner, 0);
    assert.equal(finished.profile.rating, 222);
    assert.equal(finished.profile.history.length, 2);
    assert.equal(finished.match.settled, true);
    assert.equal(await rankName.textContent(), "我（黑铁 1）");
    await reopen(finished.state, {
      profile: finished.profile,
      match: finished.match,
    });
    assert.deepEqual(await readSave(), finished);
    await settingsButton.click();
    assert.equal(await page.locator(".uno-history-card").count(), 2);
    assert.match(await page.locator(".uno-rank-summary").innerText(), /222/);
    const openingBadge = page
      .locator(".uno-history-card")
      .first()
      .locator(".uno-rank-badge");
    assert.equal(await openingBadge.getAttribute("aria-label"), "黑铁 II");
    assert.ok(
      await openingBadge.evaluate((el) => {
        const badge = el.getBoundingClientRect();
        const row = el.parentElement.getBoundingClientRect();
        return (
          Math.abs(badge.left + badge.width / 2 - row.left - row.width / 2) < 1
        );
      }),
    );
    const historyHeight = (await page.locator(".uno-history").boundingBox())
      .height;
    await page.locator('[data-uno-action="viewRules"]').click();
    assert.equal(
      (await page.locator(".uno-setup-rules").boundingBox()).height,
      historyHeight,
    );
    await page.locator('[data-uno-action="backToRecords"]').click();
    assert.match(
      await page.locator(".uno-history-delta").first().innerText(),
      /\+32/,
    );
    await page.screenshot({
      path: path.join(setupOutput, "ranked-history.png"),
    });

    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator(".uno-rank-summary").scrollIntoViewIfNeeded();
    const historyPanel = await page.locator(".uno-history").boundingBox();
    const rankedForm = await page.locator(".uno-setup").boundingBox();
    assert.ok(historyPanel.y >= rankedForm.y + rankedForm.height);
    assert.ok(
      historyPanel.x >= 0 && historyPanel.x + historyPanel.width <= 360,
    );
    await page.screenshot({
      path: path.join(setupOutput, "ranked-history-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    const archiveCheck = await page.evaluate(async () => {
      const service = WorkTimeApp.services.gameArchive;
      const exported = service.exportArchive();
      const decoded = await service.decode(await service.encode(exported));
      const preview = service.preview(decoded, { "game-uno": "incoming" });
      await service.commit(preview);
      return {
        status: preview.rows.find((row) => row.id === "game-uno").status,
        save: decoded.games["game-uno"],
      };
    });
    assert.equal(archiveCheck.status, "unchanged");
    assert.deepEqual(archiveCheck.save, finished);
    assert.deepEqual(await readSave(), finished);

    // Starting over at a nonzero rating applies the full penalty once.
    await reopen(finalRound, {
      profile: finished.profile,
      match: {
        ...restarted.match,
        id: "pending-ranked",
        completedRounds: 1,
        decisive: 1,
        wins: 1,
      },
    });
    await settingsButton.click();
    await page.locator('.uno-confirm [data-uno-action="exit"]').click();
    const penaltySave = await readSave();
    assert.equal(penaltySave.profile.rating, finished.profile.rating - 15);
    assert.equal(penaltySave.profile.history[0].delta, -15);
    assert.equal(penaltySave.profile.history[0].id, "pending-ranked");
    assert.equal(penaltySave.state, null);
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await launchGame(page, "game-uno");
    assert.equal(await page.locator('[data-uno-action="continue"]').count(), 0);
    assert.match(
      await page.locator(".uno-rank-summary").innerText(),
      new RegExp(String(penaltySave.profile.rating)),
    );
    const profileOnly = await page.evaluate(
      () => WorkTimeApp.services.gameArchive.exportArchive().games["game-uno"],
    );
    assert.deepEqual(profileOnly, penaltySave);

    const legacy = fixture(10);
    legacy.targetScore = 200;
    await reopen(legacy);
    await settingsButton.click();
    assert.equal(await modeSwitch.getAttribute("aria-checked"), "true");
    await page.locator('[data-uno-action="continue"]').click();
    assert.equal((await readSave()).state.targetScore, 200);
    assert.equal((await readSave()).match.mode, "normal");
    await page.evaluate(
      () => (document.documentElement.dataset.reducedMotion = "false"),
    );
    const drawn = fixture(10);
    drawn.drawn = drawn.hands[0][0];
    await reopen(drawn);
    const output = path.join(root, "test-results/uno");
    fs.mkdirSync(output, { recursive: true });
    for (const [width, height] of [
      [1280, 900],
      [390, 844],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const skip = page.locator('.uno-hand-actions [data-uno-action="pass"]');
      assert.equal(await skip.innerText(), "结束回合");
      assert.ok(
        await skip.evaluate(
          (el) =>
            parseFloat(
              getComputedStyle(el.querySelector(".uno-action-frame path"))
                .strokeWidth,
            ) >= 3,
        ),
      );
      assert.equal(
        await page.locator('.uno-own-header [data-uno-action="pass"]').count(),
        0,
      );
      const box = await skip.boundingBox(),
        hand = await page.locator(".uno-hand").boundingBox(),
        lastCard = await page
          .locator(".uno-hand .uno-card")
          .last()
          .boundingBox();
      assert.ok(
        (width > 700
          ? box.x >= lastCard.x + lastCard.width + 6 &&
            box.x <= lastCard.x + lastCard.width + 22
          : box.y >= lastCard.y + lastCard.height &&
            lastCard.x + lastCard.width <= hand.x + hand.width + 1) &&
          box.width > box.height &&
          box.height >= 44 &&
          box.x + box.width <= width - 8,
        JSON.stringify({ width, box, hand }),
      );
      const identity = await page.locator(".uno-own-info").boundingBox();
      const firstCard = await page
        .locator(".uno-hand .uno-card")
        .first()
        .boundingBox();
      const deck = await page.locator(".uno-draw-dock").boundingBox(),
        counter = await page.locator(".uno-pile-caption").boundingBox();
      assert.ok(
        counter.x >= deck.x + deck.width + 12 &&
          counter.y > deck.y + deck.height / 2 &&
          identity.x >= deck.x + deck.width + 24 &&
          (identity.x >= counter.x + counter.width + 8 ||
            identity.y + identity.height + 8 <= counter.y),
        JSON.stringify({ width, identity, deck, counter }),
      );
      assert.ok(
        identity.x + identity.width + 4 <= firstCard.x &&
          Math.abs(
            identity.y +
              identity.height / 2 -
              (firstCard.y + firstCard.height / 2),
          ) <= 3,
        JSON.stringify({ width, identity, firstCard }),
      );
      const rank = page.locator(".uno-own-info .uno-name-line > strong");
      assert.equal(await rank.textContent(), "我（黑铁 3）");
      assert.ok(await rank.evaluate((el) => el.scrollWidth <= el.clientWidth));
      await page.screenshot({
        path: path.join(output, `hand-skip-${width}.png`),
      });
    }
    const hover = page.locator(".uno-hand .uno-legal").first();
    const originalHoverBox = await hover.boundingBox();
    await page.mouse.move(
      originalHoverBox.x + originalHoverBox.width / 2,
      originalHoverBox.y + originalHoverBox.height - 5,
    );
    await page.waitForTimeout(300);
    const heldTransform = await hover.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    await page.waitForTimeout(350);
    assert.equal(
      await hover.evaluate((el) => getComputedStyle(el).transform),
      heldTransform,
      "bottom-edge hover cannot repeatedly raise and retract the card",
    );
    assert.equal(
      await hover.evaluate((el) => getComputedStyle(el, "::after").opacity),
      "1",
    );
    assert.equal(
      await page.locator(".uno-own-header .uno-drawn-hint").count(),
      0,
    );
    assert.ok(
      (await page.locator(".uno-drawn-hint").boundingBox()).y >=
        (await page.locator(".uno-hand").boundingBox()).y + 50,
    );
    assert.equal(await page.locator(".uno-sidebar").count(), 0);
    assert.ok(
      await page
        .locator(".uno-corner-controls button")
        .evaluateAll(
          (buttons) =>
            buttons.length === 2 &&
            buttons.every(
              (el) =>
                el.textContent === "" &&
                el.getAttribute("aria-label") &&
                el.getBoundingClientRect().width >= 48,
            ),
        ),
    );
    await page.mouse.click(
      originalHoverBox.x + originalHoverBox.width / 2,
      originalHoverBox.y + originalHoverBox.height - 5,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("worktime.games.uno.v1"),
          ).state.log.at(-1).card,
      ),
      drawn.hands[0][0],
      "the original bottom hit area still clicks the raised card",
    );
    await reopen(drawn);
    for (const [locale, label] of [
      ["en", "End turn"],
      ["zh-TW", "結束回合"],
      ["zh-HK", "結束回合"],
      ["ko", "차례 종료"],
      ["ja", "ターン終了"],
      ["zh-CN", "结束回合"],
    ]) {
      await page.evaluate(
        (locale) => WorkTimeApp.i18n.setLanguage(locale),
        locale,
      );
      assert.equal(
        await page
          .locator('.uno-hand-actions [data-uno-action="pass"]')
          .innerText(),
        label,
      );
    }
    await page.locator('.uno-hand-actions [data-uno-action="pass"]').click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.drawn,
      ),
      null,
    );
    const wildFixture = fixture(10),
      wildId = id("wild", 13),
      oldHandCard = wildFixture.hands[0][0];
    wildFixture.hands[0][0] = wildId;
    wildFixture.discard = wildFixture.discard.filter((n) => n !== wildId);
    wildFixture.discard.splice(wildFixture.discard.length - 1, 0, oldHandCard);
    await reopen(wildFixture);
    const wildFace = page.locator(`.uno-hand [data-card="${wildId}"]`);
    assert.equal(await wildFace.locator(".uno-wild-colors path").count(), 4);
    assert.equal(
      await wildFace
        .locator(".uno-wild-colors path")
        .evaluateAll(
          (paths) => new Set(paths.map((el) => el.getAttribute("fill"))).size,
        ),
      4,
    );
    await wildFace.hover();
    await page.screenshot({ path: path.join(output, "wild-four-colors.png") });
    const ending = fixture(10);
    ending.discard.splice(ending.discard.length - 1, 0, ending.hands[0].pop());
    const won = R.apply(ending, {
      type: "play",
      card: ending.hands[0][0],
      color: "red",
    });
    await reopen(won);
    const ready = page.locator(
      '.uno-hand-actions [data-uno-action="nextRound"]',
    );
    assert.equal(await ready.innerText(), "下一回合");
    assert.equal(
      await page.locator('.uno-sidebar [data-uno-action="nextRound"]').count(),
      0,
    );
    await page.screenshot({ path: path.join(output, "hand-ready-mobile.png") });
    await ready.click();
    await page.waitForFunction(
      () =>
        document.querySelector(".game-uno").dataset.handPhase === "collecting",
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.round,
      ),
      1,
    );
    assert.equal(await ready.isDisabled(), true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(1200);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.round,
      ),
      1,
      "cancelled collection cannot start a late round",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.locator("[data-uno-hidden]").count(), 0);
    await page.evaluate(() => {
      window.unoRoundPhases = [];
      const root = document.querySelector(".game-uno");
      window.unoRoundObserver = new MutationObserver(() => {
        if (
          root.dataset.handPhase &&
          window.unoRoundPhases.at(-1) !== root.dataset.handPhase
        )
          window.unoRoundPhases.push(root.dataset.handPhase);
      });
      window.unoRoundObserver.observe(root, {
        attributes: true,
        attributeFilter: ["data-hand-phase"],
      });
    });
    await ready.click();
    await page.waitForFunction(
      () =>
        document.querySelector(".game-uno").dataset.handPhase ===
          "collecting" &&
        document.querySelector(".uno-draw-dock").dataset.count === "108",
    );
    assert.equal(
      await page.locator(".uno-flight").count(),
      0,
      "all cards land before the next deal",
    );
    await page.screenshot({ path: path.join(output, "round-collected.png") });
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .round === 2,
    );
    await page.locator('.game-uno[data-hand-phase="dealing"]').waitFor();
    assert.deepEqual(
      await page.evaluate(() => {
        window.unoRoundObserver.disconnect();
        return window.unoRoundPhases.slice(0, 3);
      }),
      ["collecting", "countdown", "dealing"],
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.round,
      ),
      2,
    );
    const eight = R.create(8, "normal", 771);
    const winningCard = id("red", 1),
      topCard = id("red", 5);
    const pack = R.cards
      .filter((c) => c.value <= 9 && c.id !== winningCard && c.id !== topCard)
      .map((c) => c.id);
    eight.hands = Array.from({ length: 8 }, (_, i) =>
      i === 4 ? [winningCard] : pack.splice(0, 7),
    );
    eight.discard = [topCard];
    eight.deck = R.cards
      .map((c) => c.id)
      .filter((n) => n !== topCard && !eight.hands.flat().includes(n));
    Object.assign(eight, {
      turn: 4,
      color: "red",
      direction: 1,
      drawn: null,
      blocked: 0,
      actions: 0,
      log: [],
      openingColor: false,
    });
    const eightEnded = R.apply(eight, {
      type: "play",
      card: winningCard,
      color: "red",
    });
    assert.equal(eightEnded.matchWinner, null);
    await reopen(eightEnded);
    await page.locator('[data-uno-action="nextRound"]').click();
    await page.waitForFunction(
      () => document.querySelectorAll(".uno-hand [data-uno-hidden]").length > 0,
    );
    assert.equal(
      await page.locator(".game-uno").getAttribute("data-hand-phase"),
      "collecting",
    );
    await page.screenshot({
      path: path.join(output, "round-collecting-eight.png"),
    });
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.waitForTimeout(1300);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state.round,
      ),
      1,
      "exit cancels collection without a late deal",
    );
    await launchGame(page, "game-uno");
    await page.waitForFunction(
      () => !document.querySelector(".workspace.is-game-transitioning"),
    );
    await page.locator('[data-uno-action="nextRound"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector(".game-uno").dataset.handPhase ===
          "collecting" &&
        document.querySelector(".uno-draw-dock").dataset.count === "108",
    );
    assert.equal(await page.locator(".uno-flight").count(), 0);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .round === 2,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const count of [1, 2, 3, 4, 10]) {
      await reopen(fixture(count));
      assert.equal(
        await page.locator(".uno-deck-under").count(),
        Math.min(3, Math.max(0, count - 1)),
      );
      assert.equal(
        await page.locator(".uno-draw-dock").getAttribute("data-count"),
        String(count),
      );
      assert.ok((await page.locator(".uno-pile-caption svg path").count()) > 0);
      const counterBox = await page.locator(".uno-pile-caption").boundingBox();
      const deckBox = await page
        .locator(".uno-draw-dock > button")
        .boundingBox();
      assert.ok(
        counterBox.x >= deckBox.x + deckBox.width + 5 &&
          counterBox.y > deckBox.y + deckBox.height / 2,
        "vector deck count sits at the original bottom right",
      );
      assert.equal(
        await page.locator(".uno-corner-controls button").count(),
        2,
      );
      assert.equal(
        await page
          .locator('.uno-corner-controls [data-uno-action="exit"]')
          .getAttribute("aria-label"),
        "退出",
      );
      assert.equal(
        await page
          .locator(
            '.uno-sidebar [data-uno-action="pause"], .uno-sidebar [data-uno-action="rules"], .uno-scores',
          )
          .count(),
        0,
      );
      assert.deepEqual(
        await page.locator(".uno-seat-info,.uno-own-info").evaluateAll((els) =>
          els.map((el) => ({
            score: el.querySelector(".uno-player-stats .uno-seat-score").dataset
              .score,
            avatarFirst: el.firstElementChild.classList.contains("uno-avatar"),
            countVisible: !!el.querySelector(".uno-seat-count,.uno-own-count"),
            framed:
              parseFloat(
                getComputedStyle(el.querySelector(".uno-avatar")).borderWidth,
              ) > 0,
            vector: !!el.querySelector(".uno-seat-score svg path"),
          })),
        ),
        [
          {
            score: "13",
            avatarFirst: true,
            countVisible: false,
            framed: true,
            vector: true,
          },
          {
            score: "24",
            avatarFirst: true,
            countVisible: false,
            framed: true,
            vector: true,
          },
        ],
      );
      assert.equal(
        await page.locator(".uno-avatar > .uno-dealer svg").count(),
        1,
      );
      assert.equal(await page.locator(".uno-name-line .uno-dealer").count(), 0);
      assert.equal(
        await page.locator(".uno-score-leading").getAttribute("data-score"),
        "24",
      );
    }
    const tied = fixture(10);
    tied.scores = [13, 13];
    await reopen(tied);
    assert.equal(await page.locator(".uno-score-leading").count(), 2);
    const overtake = fixture(10);
    overtake.discard.splice(
      overtake.discard.length - 1,
      0,
      overtake.hands[0].pop(),
    );
    overtake.scores = [0, 1];
    await reopen(overtake);
    assert.equal(await page.locator(".uno-seat .uno-score-leading").count(), 1);
    await page
      .locator(`.uno-hand [data-card="${overtake.hands[0][0]}"]`)
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    assert.equal(await page.locator(".uno-seat .uno-score-leading").count(), 0);
    assert.equal(
      await page
        .locator(".uno-own-info .uno-score-leading")
        .getAttribute("data-score"),
      "7",
    );
    await page.screenshot({
      path: path.join(output, "portrait-score-winner.png"),
    });
    const drawOnly = fixture(10);
    const greenTop = id("green", 9);
    const redTop = drawOnly.discard.pop();
    const source = drawOnly.deck.includes(greenTop)
      ? drawOnly.deck
      : drawOnly.discard;
    source[source.indexOf(greenTop)] = redTop;
    drawOnly.discard.push(greenTop);
    drawOnly.color = "green";
    await reopen(drawOnly);
    assert.equal(
      await page.locator(".uno-own > .uno-drawn-hint").textContent(),
      "没有可以打出的牌，请摸一张。",
    );
    await page.locator('[data-uno-action="draw"]').click();
    await page.locator(".uno-flight-back").first().waitFor();
    const flip = await page
      .locator(".uno-flight-back")
      .first()
      .evaluate((el) => el.getAnimations()[0].effect.getKeyframes());
    assert.ok(
      flip.some((f) => f.offset <= 0.45 && f.transform === "rotateY(180deg)"),
    );
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    const empty = fixture(0),
      top = empty.discard.at(-1);
    const autoSkip = fixture(10),
      blueEight = id("blue", 8);
    const replacedDraw = autoSkip.deck.pop();
    autoSkip.discard = autoSkip.discard.filter((n) => n !== blueEight);
    autoSkip.discard.splice(autoSkip.discard.length - 1, 0, replacedDraw);
    autoSkip.deck.push(blueEight);
    await reopen(autoSkip);
    await page.locator('[data-uno-action="draw"]').click();
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    const drawnFace = page.locator(`.uno-hand [data-card="${blueEight}"]`);
    const tone = () => drawnFace.evaluate((el) => getComputedStyle(el).filter);
    await page.waitForFunction(
      () => document.querySelector(".uno-table")?.dataset.current === "1",
    );
    assert.equal(
      await tone(),
      "none",
      "an unplayable draw passes in its normal color",
    );
    await page.waitForFunction(
      () => document.querySelector(".uno-table")?.dataset.current === "0",
    );
    await page.waitForFunction((id) => {
      const card = document.querySelector(`.uno-hand [data-card="${id}"]`);
      return (
        card?.classList.contains("uno-muted") &&
        getComputedStyle(card).filter === "saturate(0.75) brightness(0.88)"
      );
    }, blueEight);
    await reopen(empty);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".uno-flight-back")].some((el) =>
        el
          .getAnimations()
          .some(
            (a) => a.effect.getKeyframes()[0].transform === "rotateY(180deg)",
          ),
      ),
    );
    assert.equal(
      await page.locator(`.uno-discard [data-card="${top}"]`).count(),
      1,
      "top discard is retained throughout recycling",
    );
    await page.screenshot({ path: path.join(output, "recycling.png") });
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state,
    );
    assert.equal(
      await page.locator(".uno-pile-caption").getAttribute("data-count"),
      String(saved.deck.length),
    );
    assert.equal(saved.discard.length, 1);
    assert.equal(
      saved.actions,
      0,
      "restoring an empty deck refills without waiting for a draw",
    );
    assert.deepEqual(saved.hands, JSON.parse(JSON.stringify(empty.hands)));
    assert.equal(
      new Set([...saved.deck, ...saved.discard, ...saved.hands.flat()]).size,
      108,
    );
    await reopen(fixture(1));
    await page.locator('[data-uno-action="draw"]').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".uno-flight-back")].some((el) =>
        el
          .getAnimations()
          .some(
            (a) => a.effect.getKeyframes()[0].transform === "rotateY(180deg)",
          ),
      ),
    );
    const pass = page.locator('.uno-hand-actions [data-uno-action="pass"]');
    assert.equal(
      await pass.isDisabled(),
      true,
      "play/pass waits until immediate recycling finishes",
    );
    await pass.evaluate((el) => el.click());
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
            .actions,
      ),
      1,
    );
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    assert.equal(await pass.isEnabled(), true);
    assert.ok(
      Number(
        await page.locator(".uno-pile-caption").getAttribute("data-count"),
      ) > 0,
    );
    const penalty = fixture(1);
    const plusTwo = id("red", 12),
      replaced = penalty.hands[0][0];
    penalty.hands[0][0] = plusTwo;
    penalty.discard = penalty.discard.filter((n) => n !== plusTwo);
    penalty.discard.splice(penalty.discard.length - 1, 0, replaced);
    await reopen(penalty);
    await page.locator(`.uno-hand [data-card="${plusTwo}"]`).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".uno-flight-back")].some((el) =>
        el
          .getAnimations()
          .some(
            (a) => a.effect.getKeyframes()[0].transform === "rotateY(180deg)",
          ),
      ),
    );
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    const penalized = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state,
    );
    assert.equal(
      penalized.hands[1].length,
      4,
      "penalty draws continue across a deck refill",
    );
    assert.equal(
      await page.locator(".uno-pile-caption").getAttribute("data-count"),
      String(penalized.deck.length),
    );
    assert.deepEqual(penalized.discard, [plusTwo]);
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "draw-mobile.png") });
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.evaluate(() => localStorage.removeItem("worktime.games.uno.v1"));
    await page.setViewportSize({ width: 1280, height: 900 });
    await launchGame(page, "game-uno");
    await page.evaluate(() => {
      const flipped = new Set();
      const observer = new MutationObserver(() => {
        const game = document.querySelector(
          '.game-uno[data-hand-phase="dealing"]',
        );
        for (const back of game?.querySelectorAll(".uno-flight-back") ?? []) {
          if (
            back
              .getAnimations()[0]
              ?.effect.getKeyframes()
              .some(
                (frame) =>
                  frame.offset <= 0.45 && frame.transform === "rotateY(180deg)",
              )
          )
            flipped.add(back.parentElement.dataset.card);
        }
        if (flipped.size === 7) observer.disconnect();
      });
      window.unoFlippedDuringDeal = flipped;
      observer.observe(document.querySelector(".game-uno"), {
        childList: true,
        subtree: true,
      });
    });
    await page.locator('[data-uno-action="start"]').click();
    await page.waitForFunction(
      () => window.unoFlippedDuringDeal.size === 7,
      null,
      { timeout: 25000 },
    );
    assert.deepEqual(
      [
        ...(await page.evaluate(() =>
          Array.from(window.unoFlippedDuringDeal, Number),
        )),
      ].sort((a, b) => a - b),
      [...(await readSave()).state.hands[0].slice(0, 7)].sort((a, b) => a - b),
    );
    await page.screenshot({ path: path.join(output, "deal-flipping.png") });
    await page.waitForFunction(
      () => !document.querySelector(".game-uno[data-visual-busy]"),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "UNO early flip, small/empty piles, animated recycling, scores and sidebar verified: " +
        site,
    );
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
