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
async function setDocumentHidden(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
const scope = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/js/games/uno-rules.js"), "utf8"),
  scope,
);
const R = scope.WorkTimeApp.games.unoRules;
const card = (color, value) =>
  R.cards.find((c) => c.color === color && c.value === value).id;
function fixture(hands) {
  const s = R.create(hands.length, "normal", 12345);
  s.hands = hands;
  s.turn = 0;
  s.direction = 1;
  s.openingColor = false;
  s.log = [];
  s.discard = [card("red", 5)];
  const used = new Set([...hands.flat(), ...s.discard]);
  s.deck = R.cards.map((c) => c.id).filter((id) => !used.has(id));
  s.color = "red";
  assert.ok(R.restore(s));
  return s;
}
async function verifyMotion(site = root) {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "no-preference",
    });
    await context.route(/^https?:/, (route) => route.abort());
    page = await context.newPage();
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
    await page.waitForFunction(
      () => !document.querySelector(".workspace.is-game-transitioning"),
    );
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "false";
    });
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state,
      );
    const idle = () =>
      page.waitForFunction(
        () => !document.querySelector(".game-uno[data-visual-busy]"),
      );
    const exit = async () => {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
    };
    const reopen = async (save) => {
      if (await page.locator("#gameShell").isVisible()) await exit();
      await page.evaluate(
        (s) =>
          localStorage.setItem(
            "worktime.games.uno.v1",
            JSON.stringify({ version: 1, state: s }),
          ),
        JSON.parse(JSON.stringify(save)),
      );
      await setDocumentHidden(page, false);
      await launchGame(page, "game-uno");
      await page.waitForFunction(
        () => !document.querySelector(".workspace.is-game-transitioning"),
      );
    };
    const output = path.join(root, "test-results/uno");
    fs.mkdirSync(output, { recursive: true });
    let openingSeed = 1;
    while (R.cards[R.create(6, "normal", openingSeed).discard[0]].value !== 11)
      openingSeed++;
    await page.evaluate((seed) => {
      window.unoOriginalRandom = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (array) => {
        array[0] = seed;
        return array;
      };
    }, openingSeed);
    await page.locator("#uno-playersTrigger").click();
    await page.locator('#uno-playersOptions [data-game-option="6"]').click();
    await page.evaluate(() =>
      document
        .querySelector(".game-uno")
        .closest(".workspace")
        .classList.add("is-game-transitioning"),
    );
    await page.locator('[data-uno-action="start"]').click();
    assert.equal(
      await page.locator(".uno-flight").count(),
      0,
      "dealing waits for the expanding shell to settle",
    );
    await page.waitForTimeout(100);
    await page.evaluate(() =>
      document
        .querySelector(".game-uno")
        .closest(".workspace")
        .classList.remove("is-game-transitioning"),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".uno-flight").length === 42,
      null,
      { polling: "raf" },
    );
    await page.setViewportSize({ width: 1260, height: 880 });
    await page.waitForTimeout(60);
    assert.ok(
      (await page.locator(".uno-flight").count()) > 0,
      "resize notifications do not cancel initial dealing",
    );
    await page.evaluate(() => {
      crypto.getRandomValues = window.unoOriginalRandom;
      window.unoOpening = [];
      window.unoOpeningObserver = new MutationObserver(() => {
        if (document.querySelector(".game-uno").dataset.handPhase !== "opening")
          return;
        const top = document.querySelector(".uno-stack-top");
        if (top && window.unoOpening.at(-1) !== Number(top.dataset.card))
          window.unoOpening.push(Number(top.dataset.card));
      });
      window.unoOpeningObserver.observe(document.querySelector(".uno-piles"), {
        childList: true,
        subtree: true,
      });
    });
    assert.equal(
      await page.locator(".uno-discard-card").count(),
      0,
      "the center remains empty while dealing",
    );
    assert.equal((await read()).actions, 0);
    assert.deepEqual(
      await page
        .locator(".uno-hand .uno-card")
        .evaluateAll((els) => els.map((el) => Number(el.dataset.card))),
      (await read()).hands[0],
      "initial cards arrive in their dealt order",
    );
    await page.waitForTimeout(250);
    assert.ok((await page.locator(".uno-card[data-uno-hidden]").count()) > 0);
    assert.equal((await read()).actions, 0, "AI cannot act during dealing");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".uno-seat .uno-mini-back")].some(
          (el) => el.getAnimations().length > 0,
        ),
      null,
      { polling: "raf" },
    );
    await page.screenshot({ path: path.join(output, "dealing.png") });
    await page.waitForFunction(
      () => document.querySelector(".game-uno").dataset.handPhase !== "dealing",
    );
    const sortedHand = (await read()).hands[0].slice().sort((a, b) => a - b);
    assert.deepEqual(
      await page
        .locator(".uno-hand .uno-card")
        .evaluateAll((els) => els.map((el) => Number(el.dataset.card))),
      sortedHand,
      "the hand sorts only after all dealt cards arrive",
    );
    assert.ok(
      await page
        .locator(".uno-hand .uno-card")
        .evaluateAll((els) =>
          els.some((el) =>
            el
              .getAnimations()
              .some((a) =>
                a.effect
                  .getKeyframes()
                  .some((f) => f.transform && !f.transform.includes("NaN")),
              ),
          ),
        ),
      "sorting uses valid animated positions rather than NaN translations",
    );
    await page.screenshot({ path: path.join(output, "sorting.png") });
    await idle();
    assert.deepEqual(
      await page.evaluate(() => {
        window.unoOpeningObserver.disconnect();
        return window.unoOpening;
      }),
      (await read()).discard,
      "opening reveals the actual Reverse card without skipping action cards",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await setDocumentHidden(page, true);
    assert.equal((await read()).actions, 0);
    assert.equal(await page.locator(".uno-flight").count(), 0);
    const saved = await read();
    assert.ok(saved.hands.every((h) => h.length === 7));
    const names = await page
      .locator(".uno-seat .uno-seat-labels strong")
      .allTextContents();
    const portraits = await page
      .locator(".uno-seat .uno-avatar")
      .evaluateAll((els) => els.map((el) => el.innerHTML));
    assert.equal(new Set(names).size, 5);
    assert.equal(new Set(portraits).size, 5);
    assert.equal(await page.locator(".uno-seat .uno-avatar > svg").count(), 5);
    assert.equal(await page.locator(".uno-avatar .uno-dealer svg").count(), 1);
    assert.ok(
      await page
        .locator(".uno-seat")
        .evaluateAll((els) =>
          els.every(
            (el) =>
              el
                .querySelector(".uno-seat-hand")
                .compareDocumentPosition(el.querySelector(".uno-seat-info")) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ),
    );
    await reopen(saved);
    assert.deepEqual(
      await page.locator(".uno-seat .uno-seat-labels strong").allTextContents(),
      names,
    );
    assert.deepEqual(
      await page
        .locator(".uno-seat .uno-avatar")
        .evaluateAll((els) => els.map((el) => el.innerHTML)),
      portraits,
    );

    const reverse = fixture([
      [card("red", 11), card("red", 1)],
      [card("blue", 1), card("blue", 2)],
    ]);
    await reopen(reverse);
    await page.locator(`.uno-hand [data-card="${card("red", 11)}"]`).click();
    const centerFx = await page
      .locator(".uno-effect-center")
      .evaluate((el) => ({
        delay: el.getAnimations()[0].effect.getTiming().delay,
        frames: el.getAnimations()[0].effect.getKeyframes(),
      }));
    assert.equal(centerFx.delay, 0);
    assert.ok(
      await page
        .locator(".uno-effect-center")
        .evaluate(
          (el) =>
            el.parentElement.classList.contains("game-uno") &&
            Number(getComputedStyle(el).zIndex) >
              Number(
                getComputedStyle(document.querySelector(".uno-flight")).zIndex,
              ),
        ),
      "central effects sit above flying cards outside the isolated table",
    );
    assert.ok(
      centerFx.frames.every((f) => !f.transform),
      "central reverse effect fades without moving",
    );
    assert.ok((await page.locator(".uno-flight").count()) > 0);
    await page.locator(".uno-toast").waitFor();
    const sharedUno = await page.evaluate(() => ({
      toast: document.querySelector(".uno-toast svg").outerHTML,
      tag: document.querySelector(".uno-call").getAttribute("aria-label"),
      besideName: [...document.querySelectorAll(".uno-call")].every((el) =>
        el.parentElement.matches(".uno-name-line,.uno-own-info"),
      ),
      markerFill: getComputedStyle(document.querySelector(".uno-call svg"))
        .fill,
      border: getComputedStyle(document.querySelector(".uno-toast"))
        .borderTopWidth,
      text: document.querySelector(".uno-toast").textContent,
    }));
    assert.equal(sharedUno.tag, "1!");
    assert.equal(sharedUno.besideName, true);
    assert.equal(sharedUno.markerFill, "rgb(216, 75, 67)");
    assert.ok(sharedUno.toast.includes("<path"));
    assert.equal(sharedUno.border, "0px");
    assert.equal(sharedUno.text, "");
    assert.equal((await read()).direction, -1);
    const headBefore = await page
      .locator(".uno-direction-head-a")
      .getAttribute("transform");
    await page.waitForTimeout(120);
    assert.notEqual(
      await page.locator(".uno-direction-head-a").getAttribute("transform"),
      headBefore,
      "a single solid head changes direction geometrically",
    );
    assert.equal(
      await page
        .locator(".uno-direction-forward, .uno-direction-backward")
        .count(),
      0,
    );
    assert.ok(
      await page
        .locator(".uno-direction, .uno-player-pointer")
        .evaluateAll((els) =>
          els.every((el) => getComputedStyle(el).opacity === "1"),
        ),
    );
    assert.equal(
      await page.locator(".uno-direction").getAttribute("data-direction"),
      "-1",
    );
    await page.screenshot({ path: path.join(output, "uno-reminder.png") });
    await idle();
    assert.equal(await page.locator(".uno-toast").count(), 0);
    const angleBefore = await page
      .locator(".uno-direction")
      .evaluate(
        (el) =>
          (Math.atan2(
            new DOMMatrix(getComputedStyle(el).transform).b,
            new DOMMatrix(getComputedStyle(el).transform).a,
          ) *
            180) /
          Math.PI,
      );
    await page.waitForTimeout(120);
    const angleAfter = await page
      .locator(".uno-direction")
      .evaluate(
        (el) =>
          (Math.atan2(
            new DOMMatrix(getComputedStyle(el).transform).b,
            new DOMMatrix(getComputedStyle(el).transform).a,
          ) *
            180) /
          Math.PI,
      );
    assert.ok(
      ((angleAfter - angleBefore + 540) % 360) - 180 < 0,
      "the ring keeps rotating counterclockwise after a reverse",
    );
    assert.equal(
      await page.locator(".uno-card-color, .uno-card-label").count(),
      0,
      "card faces omit duplicate labels",
    );
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    assert.equal(
      await page.locator(".uno-hand-actions:not([hidden])").count(),
      0,
      "winning card lands before the result opens",
    );
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    assert.equal(await page.locator(".uno-flight").count(), 0);

    const draw = fixture([
      [card("red", 1), card("blue", 1)],
      [card("green", 1), card("blue", 2)],
    ]);
    const drawn = card("red", 8);
    draw.deck.splice(draw.deck.indexOf(drawn), 1);
    draw.deck.push(drawn);
    await reopen(draw);
    const deck = await page.locator(".uno-draw-dock").boundingBox(),
      hand = await page.locator(".uno-hand").boundingBox();
    assert.ok(
      deck.x + deck.width <= hand.x + 1,
      "the complete draw pile is beside the hand at bottom left",
    );
    const deckButton = page.locator(
      '.uno-draw-dock > button[data-uno-action="draw"]',
    );
    const deckStyle = () =>
      deckButton.evaluate((el) => ({
        background: getComputedStyle(el).backgroundImage,
        filter: getComputedStyle(el).filter,
        color: getComputedStyle(el).backgroundColor,
        transform: getComputedStyle(el).transform,
      }));
    const restingDeck = await deckStyle();
    for (let i = 0; i < 3; i++) {
      await deckButton.hover({ position: { x: 20, y: 20 } });
      assert.deepEqual(
        await deckStyle(),
        restingDeck,
        "deck hover never revives stripes or shifts the hit target",
      );
      await page.mouse.move(0, 0);
    }
    await page.evaluate(() => {
      const pointer = document.querySelector(".uno-player-pointer");
      window.unoMotionAnchor = {
        table: document.querySelector(".uno-table"),
        ring: document.querySelector(".uno-direction"),
        pointer,
        float: pointer.querySelector("svg").getAnimations()[0],
        box: document
          .querySelector(".uno-table")
          .getBoundingClientRect()
          .toJSON(),
      };
    });
    await page.locator('[data-uno-action="draw"]').click();
    assert.ok((await page.locator(".uno-flight").count()) > 0);
    assert.ok(
      await page
        .locator(".uno-draw-dock .uno-pile-caption")
        .evaluate(
          (el) =>
            /^\d+$/.test(el.dataset.count) &&
            !!el.querySelector("svg path") &&
            getComputedStyle(el).display !== "none",
        ),
    );
    const continuity = await page.evaluate(() => {
      const old = window.unoMotionAnchor,
        table = document.querySelector(".uno-table"),
        pointer = document.querySelector(".uno-player-pointer"),
        box = table.getBoundingClientRect();
      return {
        same:
          old.table === table &&
          old.ring === document.querySelector(".uno-direction") &&
          old.pointer === pointer,
        clock: old.float === pointer.querySelector("svg").getAnimations()[0],
        shift: Math.abs(old.box.y - box.y) + Math.abs(old.box.x - box.x),
      };
    });
    assert.ok(
      continuity.same && continuity.clock,
      "center nodes and float clock survive rendering without remounts",
    );
    assert.ok(
      continuity.shift < 0.5,
      "the drawn-card hint cannot move the table",
    );
    assert.equal(
      await page.locator(".uno-action-effect").count(),
      0,
      "ordinary draws never display plus one",
    );
    const drawFlight = page.locator(".uno-draw-flight");
    assert.equal(
      await drawFlight.evaluate((el) => getComputedStyle(el).zIndex),
      await page
        .locator(`.uno-hand [data-card="${drawn}"]`)
        .evaluate((el) => getComputedStyle(el).zIndex),
      "the flight uses its destination hand layer from the outset",
    );
    assert.equal(
      await drawFlight.locator(".uno-flight-back .uno-back-art").count(),
      1,
    );
    assert.ok(
      await drawFlight.evaluate((el) =>
        el.getAnimations().some((a) => a.effect.getTiming().duration >= 500),
      ),
    );
    await page.setViewportSize({ width: 1280, height: 880 });
    await page.waitForTimeout(180);
    assert.ok(
      await drawFlight.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return (
          b.top < innerHeight &&
          b.bottom > 0 &&
          getComputedStyle(el).visibility === "visible"
        );
      }),
      "the draw flight remains visible",
    );
    await page.screenshot({ path: path.join(output, "drawing.png") });
    assert.ok(
      await page
        .locator(".uno-hand .uno-card")
        .evaluateAll((els) => els.some((el) => el.getAnimations().length > 0)),
      "existing hand cards move aside for the drawn card",
    );
    assert.equal(
      await page
        .locator(`.uno-hand [data-card="${drawn}"]`)
        .evaluate((el) => getComputedStyle(el).visibility),
      "hidden",
      "the new card appears in the hand only when its flight lands",
    );
    await idle();
    assert.equal((await read()).drawn, drawn);
    await page.setViewportSize({ width: 1280, height: 900 });
    const disabledDeck = await deckStyle();
    await deckButton.hover({ position: { x: 20, y: 20 } });
    assert.deepEqual(
      await deckStyle(),
      disabledDeck,
      "a disabled draw pile also retains its colors on hover",
    );
    await page.mouse.move(0, 0);
    const looks = await page.locator(".uno-hand button").evaluateAll((els) =>
      els.map((el) => ({
        disabled: el.disabled,
        opacity: getComputedStyle(el).opacity,
        filter: getComputedStyle(el).filter,
        background: getComputedStyle(el).backgroundColor,
        alpha: (() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d");
          context.fillStyle = getComputedStyle(el).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3];
        })(),
      })),
    );
    assert.ok(
      looks.every((v) => v.opacity === "1" && v.alpha === 255),
      "muted cards use opaque backgrounds, so underlying cards never show through",
    );
    assert.equal(
      await page
        .locator(".uno-own")
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
      "0px",
    );
    await page.locator('[data-uno-action="pass"]').click();
    await setDocumentHidden(page, true);

    await reopen(draw);
    const playable = page.locator(".uno-hand .uno-legal").first();
    await page.mouse.move(0, 0);
    const layer = () =>
      playable.evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        z: getComputedStyle(el).zIndex,
      }));
    const beforeHover = await layer();
    await playable.hover({ position: { x: 15, y: 45 } });
    await page.waitForTimeout(180);
    const afterHover = await layer();
    assert.equal(
      afterHover.z,
      beforeHover.z,
      "hover preserves the card's original stacking layer",
    );
    assert.notEqual(
      afterHover.transform,
      beforeHover.transform,
      "hover straightens and draws out the card",
    );
    assert.equal(
      await playable.evaluate((el) => {
        const a = el.getBoundingClientRect(),
          next = el.nextElementSibling;
        const b = next.getBoundingClientRect();
        const x = Math.min(a.right, b.right) - 10;
        const y = Math.max(a.top, b.top) + Math.min(a.height, b.height) * 0.6;
        return document.elementFromPoint(x, y)?.closest(".uno-card") === next;
      }),
      true,
      "the extracted card still stays behind the neighboring card in the overlap",
    );
    assert.ok(
      await page
        .locator(".uno-seat-hand")
        .evaluateAll((els) =>
          els.every(
            (el) =>
              getComputedStyle(el).opacity === "1" &&
              getComputedStyle(el.querySelector(".uno-mini-back"))
                .backgroundColor === "rgb(174, 191, 196)",
          ),
        ),
    );
    assert.ok(
      await page.locator(".uno-table").evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          style.backgroundColor === "rgba(0, 0, 0, 0)" &&
          style.borderTopWidth === "0px" &&
          style.boxShadow === "none"
        );
      }),
    );
    assert.ok(
      await page
        .locator(".uno-status, .uno-current-color, .uno-direction-caption")
        .evaluateAll((els) =>
          els.every(
            (el) =>
              getComputedStyle(el).position === "absolute" &&
              el.getBoundingClientRect().width <= 1,
          ),
        ),
    );
    const aiPlay = fixture([
      [card("red", 1), card("green", 1)],
      [card("blue", 12), card("green", 2)],
    ]);
    aiPlay.deck.splice(aiPlay.deck.indexOf(card("blue", 5)), 1);
    aiPlay.deck.push(aiPlay.discard[0]);
    aiPlay.discard = [card("blue", 5)];
    aiPlay.color = "blue";
    aiPlay.turn = 1;
    await reopen(aiPlay);
    assert.equal(
      await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(".uno-seat.uno-active .uno-seat-hand"),
          ).opacity,
      ),
      "1",
    );
    const flyingPlus = page.locator(
      `.uno-flight[data-card="${card("blue", 12)}"]`,
    );
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`.uno-flight[data-card="${id}"]`);
        return (
          el &&
          getComputedStyle(el).visibility === "visible" &&
          el.getBoundingClientRect().width > 0
        );
      },
      card("blue", 12),
      { polling: "raf" },
    );
    assert.ok(
      await page
        .locator('.uno-seat[data-seat="1"] .uno-mini-back')
        .evaluateAll((els) => els.some((el) => el.getAnimations().length > 0)),
      "remaining AI cards animate inward after an edge card is played",
    );
    assert.ok(
      await page
        .locator('.uno-seat[data-seat="1"] .uno-mini-back')
        .evaluateAll((els) =>
          els.some((el) =>
            el
              .getAnimations()
              .some(
                (a) =>
                  a.effect.getTiming().delay >= 160 &&
                  a.effect.getKeyframes().some((f) => f.transform),
              ),
          ),
        ),
      "AI fan waits for the outgoing card to clear it",
    );
    assert.ok(
      (await page.locator(".uno-action-effect svg path").count()) > 0,
      "penalty, play and count-change effects use drawn outlines",
    );
    assert.equal(
      await page
        .locator(".uno-action-effect")
        .evaluateAll((els) => els.map((el) => el.textContent).join("")),
      "",
    );
    assert.equal(
      await page.locator(".uno-previous-top").getAttribute("data-card"),
      String(card("blue", 5)),
    );
    assert.equal(
      await page
        .locator(".uno-previous-top")
        .evaluate((el) => getComputedStyle(el).visibility),
      "visible",
      "the previous table card remains visible during the outgoing card flight",
    );
    const vectorFace = await flyingPlus.evaluate((el) => ({
      glyphs: el.querySelectorAll("svg path").length,
      text: el.textContent,
      marks: [...el.querySelectorAll("svg")].every(
        (e) =>
          e.getBoundingClientRect().height <= el.getBoundingClientRect().height,
      ),
    }));
    assert.ok(vectorFace.glyphs > 0 && vectorFace.marks);
    assert.equal(
      vectorFace.text,
      "",
      "all face symbols are vector outlines, never text",
    );
    await page.screenshot({ path: path.join(output, "ai-play.png") });
    await idle();
    assert.equal(await page.locator(".uno-previous-top").count(), 0);
    await setDocumentHidden(page, true);

    const turnChange = fixture([
      [card("red", 1), card("green", 1)],
      [card("blue", 1), card("green", 2), card("yellow", 2)],
      [card("blue", 12), card("green", 3)],
    ]);
    turnChange.deck.splice(turnChange.deck.indexOf(card("blue", 5)), 1);
    turnChange.deck.push(turnChange.discard[0]);
    turnChange.discard = [card("blue", 5)];
    turnChange.color = "blue";
    turnChange.turn = 1;
    await reopen(turnChange);
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`.uno-flight[data-card="${id}"]`);
        return el && getComputedStyle(el).visibility === "visible";
      },
      card("blue", 1),
      { polling: "raf" },
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        shown: document.querySelector(".uno-table").dataset.current,
        active: document.querySelector(".uno-seat.uno-active").dataset.seat,
        logical: JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .turn,
      })),
      { shown: "1", active: "1", logical: 2 },
      "the outgoing player remains highlighted until its card lands",
    );
    await idle();
    assert.equal(
      await page.locator(".uno-table").getAttribute("data-current"),
      "2",
    );
    await setDocumentHidden(page, true);

    // Presentation polish: real discard history and a display-only limit.
    const stacked = fixture([
      [card("red", 2), card("green", 1)],
      [card("blue", 1), card("green", 2)],
    ]);
    const history = [
      card("red", 3),
      card("yellow", 4),
      card("green", 5),
      card("blue", 6),
    ];
    for (const id of history) stacked.deck.splice(stacked.deck.indexOf(id), 1);
    stacked.discard = [...history, ...stacked.discard];
    stacked.discardLimit = 3;
    assert.ok(R.restore(stacked));
    await reopen(stacked);
    const visibleDiscards = () =>
      page
        .locator(".uno-discard-card")
        .evaluateAll((els) => els.map((el) => Number(el.dataset.card)));
    assert.deepEqual(await visibleDiscards(), stacked.discard.slice(-10));
    assert.equal(
      await page
        .locator(".uno-discard")
        .evaluate((el) => getComputedStyle(el, "::before").content),
      "none",
    );
    assert.equal(
      await page
        .locator(".uno-direction .uno-arrow-shape")
        .first()
        .getAttribute("d"),
      await page
        .locator(".uno-player-pointer .uno-arrow-shape")
        .getAttribute("d"),
    );
    const tones = await page.evaluate(() =>
      [".uno-direction", ".uno-player-pointer"].map(
        (selector) => getComputedStyle(document.querySelector(selector)).color,
      ),
    );
    assert.equal(tones[0], tones[1]);
    const spinBefore = await page
      .locator(".uno-direction")
      .evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(160);
    assert.notEqual(
      await page
        .locator(".uno-direction")
        .evaluate((el) => getComputedStyle(el).transform),
      spinBefore,
    );
    await page.screenshot({ path: path.join(output, "discard-stack.png") });
    await setDocumentHidden(page, true);
    const frozenRing = await page
      .locator(".uno-direction")
      .evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(180);
    assert.equal(
      await page
        .locator(".uno-direction")
        .evaluate((el) => getComputedStyle(el).transform),
      frozenRing,
    );
    await page
      .locator('.uno-corner-controls [data-uno-action="settings"]')
      .click();
    assert.equal(
      await page.locator('[data-uno-setting="discard-limit"]').count(),
      0,
    );
    await page.locator('[data-uno-action="continue"]').click();
    await setDocumentHidden(page, false);
    assert.deepEqual(await visibleDiscards(), stacked.discard.slice(-10));
    assert.equal((await read()).discardLimit, 10);
    assert.equal(
      (await read()).discard.length,
      5,
      "display limits never truncate the real deck",
    );
    await reopen(await read());
    assert.equal(await page.locator(".uno-discard-card").count(), 5);

    // A newly drawn unplayable card fades its entire opaque face and lettering.
    const unavailable = fixture([
      [card("red", 2), card("green", 1)],
      [card("blue", 1), card("green", 2)],
    ]);
    const unavailableId = card("blue", 9);
    unavailable.deck.splice(unavailable.deck.indexOf(unavailableId), 1);
    unavailable.deck.push(unavailableId);
    await reopen(unavailable);
    await page.locator('[data-uno-action="draw"]').click();
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`.uno-hand [data-card="${id}"]`);
        return el && getComputedStyle(el).visibility === "visible";
      },
      unavailableId,
      { polling: "raf" },
    );
    await idle();
    assert.ok(
      await page
        .locator(".uno-hand .uno-card")
        .evaluateAll((els) =>
          els.every(
            (el) =>
              !el.classList.contains("uno-muted") &&
              (getComputedStyle(el).filter.match(/[\d.]+/g) || [])
                .map(Number)
                .every((n) => n >= 0.995),
          ),
        ),
      "all human cards retain normal colors while an AI acts",
    );
    await setDocumentHidden(page, true);

    // Handoff animates the orbit pointer and restores playable card colors.
    const handoff = fixture([
      [card("red", 2), card("blue", 3)],
      [card("red", 1), card("green", 2)],
    ]);
    handoff.turn = 1;
    await reopen(handoff);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
          .actions > 0,
    );
    await idle();
    assert.ok(
      await page
        .locator(".uno-mini-back")
        .evaluateAll((els) =>
          els.some((el) =>
            el
              .getAnimations()
              .some((a) =>
                a.effect.getKeyframes().some((f) => f.backgroundColor),
              ),
          ),
        ),
      "AI colors animate at turn handoff",
    );
    const pointerStart = await page
      .locator(".uno-player-pointer")
      .evaluate((el) =>
        Math.atan2(
          new DOMMatrix(getComputedStyle(el).transform).f,
          new DOMMatrix(getComputedStyle(el).transform).e,
        ),
      );
    await page.waitForTimeout(60);
    const pointerEnd = await page
      .locator(".uno-player-pointer")
      .evaluate((el) =>
        Math.atan2(
          new DOMMatrix(getComputedStyle(el).transform).f,
          new DOMMatrix(getComputedStyle(el).transform).e,
        ),
      );
    assert.ok(
      Math.abs(pointerEnd - pointerStart) > 0.01,
      "the pointer glides to the next player without resetting",
    );
    assert.ok(
      await page
        .locator(`.uno-hand [data-card="${card("blue", 3)}"]`)
        .evaluate((el) =>
          el
            .getAnimations()
            .some((a) => a.effect.getKeyframes().some((f) => f.filter)),
        ),
    );
    await page.waitForTimeout(360);
    assert.equal(
      await page
        .locator(`.uno-hand [data-card="${card("red", 2)}"]`)
        .evaluate((el) => el.classList.contains("uno-muted")),
      false,
    );
    assert.equal(
      await page
        .locator(`.uno-hand [data-card="${card("blue", 3)}"]`)
        .evaluate((el) => el.classList.contains("uno-muted")),
      true,
    );
    assert.equal(
      await page
        .locator(".uno-stack-top")
        .evaluate((el) => el.getAnimations().length),
      0,
      "no concurrent landing bounce can twitch the discard face",
    );

    assert.ok(
      await page
        .locator(".uno-mini-back")
        .evaluateAll((els) =>
          els.every((el) => getComputedStyle(el).opacity === "1"),
        ),
    );
    // Three-player skips force an orbit longer than 180 degrees in the actual game direction.
    for (const direction of [1, -1]) {
      const routed =
        direction === 1
          ? fixture([
              [card("red", 2), card("blue", 3)],
              [card("red", 10), card("green", 2)],
              [card("blue", 1), card("green", 3)],
            ])
          : fixture([
              [card("red", 2), card("blue", 3)],
              [card("blue", 1), card("green", 2)],
              [card("red", 10), card("green", 3)],
            ]);
      routed.direction = direction;
      routed.turn = direction === 1 ? 1 : 2;
      await reopen(routed);
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.uno.v1")).state
            .actions > 0,
      );
      await idle();
      const start = await page
        .locator(".uno-player-pointer")
        .evaluate((el) =>
          Math.atan2(
            new DOMMatrix(getComputedStyle(el).transform).f,
            new DOMMatrix(getComputedStyle(el).transform).e,
          ),
        );
      await page.waitForTimeout(70);
      const end = await page
        .locator(".uno-player-pointer")
        .evaluate((el) =>
          Math.atan2(
            new DOMMatrix(getComputedStyle(el).transform).f,
            new DOMMatrix(getComputedStyle(el).transform).e,
          ),
        );
      assert.ok(
        (end - start) * direction > 0,
        "pointer follows the ring even when the correct route is longer than a half turn",
      );
      await setDocumentHidden(page, true);
    }
    // Sidebar, face-color glow, hidden captions and quick wild color selection.
    const glow = fixture([
      [card("green", 5), card("blue", 5)],
      [card("red", 1), card("green", 2)],
    ]);
    await reopen(glow);
    assert.equal(await page.locator(".game-uno h2").count(), 0);
    assert.equal(
      await page.locator("#gameShell .workspace-toolbar h2").isVisible(),
      true,
    );
    assert.equal(await page.locator(".uno-corner-controls button").count(), 2);
    assert.equal(await page.locator(".uno-sidebar").count(), 0);
    assert.ok(
      await page
        .locator(".uno-own-info")
        .evaluate((el) =>
          el.firstElementChild.classList.contains("uno-avatar"),
        ),
    );
    const glows = await page
      .locator(".uno-hand .uno-legal")
      .evaluateAll((els) =>
        els.map((el) => ({
          color: getComputedStyle(el).backgroundColor,
          border: getComputedStyle(el).borderColor,
        })),
      );
    assert.notEqual(glows[0].color, glows[1].color);
    assert.ok(glows.every((v) => v.border === "rgb(255, 255, 255)"));
    await page.locator(".uno-hand .uno-legal").first().hover();
    assert.ok(
      await page
        .locator(".uno-hand .uno-legal")
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return (
            style.borderColor === "rgb(255, 255, 255)" &&
            getComputedStyle(el, "::after").borderWidth === "4px" &&
            getComputedStyle(el, "::after").transitionProperty === "opacity"
          );
        }),
      "hover outline leaves a gap outside the white card edge",
    );
    assert.equal(
      await page.locator('.uno-sidebar [data-uno-action="rules"]').count(),
      0,
    );

    const wild = fixture([
      [card("red", 1), card("wild", 13)],
      [card("blue", 1), card("blue", 2)],
    ]);
    await reopen(wild);
    await page.locator(`.uno-hand [data-card="${card("wild", 13)}"]`).hover();
    await page.locator(".uno-color-swatches").waitFor();
    assert.ok(
      await page
        .locator(".uno-color-swatches")
        .evaluate((el) =>
          el
            .getAnimations()
            .some((a) =>
              a.effect.getKeyframes().some((f) => f.opacity === "0"),
            ),
        ),
      "swatches animate in",
    );
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () => document.querySelector(".uno-swatches-leaving"),
      null,
      { polling: "raf" },
    );
    await page.waitForFunction(
      () => !document.querySelector(".uno-color-swatches"),
    );
    await page.locator(`.uno-hand [data-card="${card("wild", 13)}"]`).hover();
    await page.locator(".uno-color-swatches").waitFor();
    assert.equal(await page.locator(".uno-color-swatch").count(), 4);
    assert.ok(
      await page
        .locator(".uno-color-swatch")
        .evaluateAll((els) =>
          els.every(
            (el) =>
              getComputedStyle(el).borderTopWidth === "0px" &&
              el.querySelector("svg path"),
          ),
        ),
    );
    await page.screenshot({ path: path.join(output, "wild-colors.png") });
    const wildCard = page.locator(
      `.uno-hand [data-card="${card("wild", 13)}"]`,
    );
    const untouchedWild = JSON.stringify(await read());
    await wildCard.click();
    assert.equal(
      JSON.stringify(await read()),
      untouchedWild,
      "clicking the wild face never plays it",
    );
    const swatches = await page.locator(".uno-color-swatches").boundingBox();
    const wildBox = await wildCard.boundingBox();
    await page.mouse.move(
      wildBox.x + wildBox.width / 2,
      swatches.y + swatches.height - 5,
    );
    await page.waitForTimeout(240);
    assert.ok(
      await wildCard.evaluate((el) => el.classList.contains("uno-wild-open")),
      "the bridge to the swatches preserves the extracted card",
    );
    assert.ok(
      await page
        .locator(".uno-color-swatch")
        .evaluateAll((els) =>
          els.every((el) => el.offsetWidth >= 34 && el.offsetHeight >= 44),
        ),
    );
    assert.ok(
      await page
        .locator(".uno-color-swatches")
        .evaluate(
          (el) =>
            getComputedStyle(el).gridTemplateColumns.split(" ").length === 2,
        ),
    );
    assert.ok(
      Math.abs(
        (await page.locator(".uno-color-swatches").boundingBox()).width -
          (await wildCard.boundingBox()).width,
      ) < 1,
      "2 by 2 swatches align to the upright card width",
    );
    const choiceShapes = await page
      .locator(".uno-color-swatch svg path:first-child")
      .evaluateAll((els) => els.map((el) => el.getAttribute("d")));
    assert.equal(new Set(choiceShapes).size, 4);
    await page.locator('.uno-color-swatch[data-uno-color="green"]').hover();
    await page.waitForTimeout(180);
    assert.equal(
      await wildCard.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(38, 128, 83)",
    );
    assert.equal(
      JSON.stringify(await read()),
      untouchedWild,
      "preview does not play the wild",
    );
    await page.locator('.uno-color-swatch[data-uno-color="yellow"]').hover();
    await page.waitForTimeout(180);
    assert.equal(
      await wildCard.evaluate((el) => getComputedStyle(el).color),
      "rgb(58, 44, 6)",
      "yellow preview uses matching dark glyph ink",
    );
    await page.locator('.uno-color-swatch[data-uno-color="blue"]').click();
    assert.equal((await read()).color, "blue");
    assert.equal(await page.locator(".uno-color-choice").count(), 0);
    const flyingWild = page.locator(".uno-flight.uno-wild");
    assert.ok(
      await flyingWild.evaluate((el) =>
        el.getAnimations().some((a) => {
          const frames = a.effect.getKeyframes();
          return (
            frames[0].backgroundColor &&
            frames[0].backgroundColor !== frames.at(-1).backgroundColor
          );
        }),
      ),
      "wild color starts changing during the flight",
    );
    await page.waitForTimeout(140);
    assert.notEqual(
      await flyingWild.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(105, 112, 120)",
    );
    await idle();
    assert.equal(
      await page
        .locator(".uno-stack-top")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(46, 106, 177)",
    );
    await setDocumentHidden(page, true);

    // AI draw penalties grow the fan at its end and ease existing cards aside.
    const aiReceive = fixture([
      [card("red", 12), card("red", 1)],
      [card("blue", 1), card("green", 1)],
    ]);
    await reopen(aiReceive);
    await page.locator(`.uno-hand [data-card="${card("red", 12)}"]`).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".uno-flight.uno-back").length === 2,
    );
    const drawTiming = await page
      .locator(".uno-flight.uno-back")
      .evaluateAll((els) =>
        Promise.all(
          els.map(async (el) => {
            const animation = el
              .getAnimations()
              .find((a) => a.effect.getKeyframes().some((f) => f.transform));
            await animation.ready;
            return {
              z: Number(el.style.zIndex),
              start: animation.startTime + animation.effect.getTiming().delay,
            };
          }),
        ),
      );
    assert.equal(drawTiming.length, 2);
    assert.ok(
      drawTiming[1].start - drawTiming[0].start >= 150 &&
        drawTiming[1].z > drawTiming[0].z,
      "multiple draws have predefined increasing layers and staggered departures: " +
        JSON.stringify(drawTiming),
    );
    await page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll(
            '.uno-seat[data-seat="1"] .uno-mini-back',
          ),
        ].some((el) => el.getAnimations().length > 0),
      null,
      { polling: "raf" },
    );
    assert.equal((await read()).hands[1].length, 4);
    assert.equal(
      await page.locator(".uno-effect-center").count(),
      0,
      "penalty counts belong to the hand only",
    );
    await idle();
    assert.equal(
      await page.locator('.uno-seat[data-seat="1"] .uno-mini-back').count(),
      4,
    );
    await setDocumentHidden(page, true);

    assert.ok(
      await page.locator(".uno-seat").evaluateAll((seats) =>
        seats.every((seat) => {
          const info = seat
            .querySelector(".uno-seat-info")
            .getBoundingClientRect();
          return [...seat.querySelectorAll(".uno-mini-back")].every(
            (card) => card.getBoundingClientRect().bottom <= info.top + 1,
          );
        }),
      ),
      "names, avatars and counts are below the full fan bounds",
    );
    // Back art is identical, textual decoration is absent, and only the lower pile is clipped.
    const art = await page.evaluate(() => ({
      ai: document.querySelector(".uno-mini-back .uno-back-art").outerHTML,
      deck: document.querySelector(".uno-draw-dock button .uno-back-art")
        .outerHTML,
      deckText: document.querySelector(".uno-draw-dock button").textContent,
      shadows: getComputedStyle(document.querySelector(".uno-player-pointer"))
        .filter,
      paths: document.querySelector(".uno-hand .uno-card-symbol").tagName,
    }));
    assert.equal(art.ai, art.deck);
    assert.equal(art.deckText, "");
    assert.equal(art.shadows, "none");
    assert.equal(art.paths, "svg");

    const deepPile = fixture([
      [card("red", 1), card("blue", 1)],
      [card("green", 1), card("blue", 2)],
    ]);
    const held = new Set(deepPile.hands.flat());
    deepPile.discard = R.cards
      .filter((c) => c.color === "red" && !held.has(c.id))
      .slice(0, 15)
      .map((c) => c.id);
    deepPile.discardLimit = 15;
    deepPile.deck = R.cards
      .map((c) => c.id)
      .filter((id) => !held.has(id) && !deepPile.discard.includes(id));
    await reopen(deepPile);
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".uno-stack-under")].some((el) =>
          el
            .getAnimations()
            .some((a) =>
              a.effect.getKeyframes().some((f) => f.opacity === "0"),
            ),
        ),
      null,
      { polling: "raf" },
    );
    await idle();
    assert.equal(await page.locator(".uno-discard-card").count(), 10);
    assert.equal((await read()).discard.length, 16);
    await setDocumentHidden(page, true);

    // Winning never changes the table geometry or hides the opponents behind a dialog.
    const ending = fixture([
      [card("red", 1)],
      R.cards
        .filter((c) => c.color === "blue")
        .slice(0, 10)
        .map((c) => c.id),
    ]);
    await reopen(ending);
    const seatBefore = await page.locator(".uno-seat-info").boundingBox();
    const fanBefore = await page.locator(".uno-mini-back").evaluateAll((els) =>
      els.map((el) => ({
        x: el.getBoundingClientRect().x,
        y: el.getBoundingClientRect().y,
        transform: getComputedStyle(el).transform,
      })),
    );
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    assert.equal(
      await page.locator(".uno-action-effect").count(),
      0,
      "normal plays do not show minus one",
    );
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    await page.waitForTimeout(800);
    const seatAfter = await page.locator(".uno-seat-info").boundingBox();
    const fanAfter = await page.locator(".uno-mini-back").evaluateAll((els) =>
      els.slice(0, 7).map((el) => ({
        x: el.getBoundingClientRect().x,
        y: el.getBoundingClientRect().y,
        transform: getComputedStyle(el).transform,
      })),
    );
    assert.ok(
      fanBefore.every(
        (p, i) =>
          Math.abs(p.y - fanAfter[i].y) < 0.5 &&
          p.transform === fanAfter[i].transform,
      ),
      "end reveal preserves original fan angles and vertical positions",
    );
    assert.ok(
      Math.abs(seatBefore.y - seatAfter.y) < 1,
      "opponent positions do not move down at game end",
    );
    assert.equal(await page.locator(".uno-overlay").count(), 0);
    assert.equal(
      await page.locator(".uno-final-hands,.uno-result,.uno-scores").count(),
      0,
    );
    assert.equal(
      await page.locator(".uno-revealed-face").count(),
      10,
      "every opponent card is revealed, including cards beyond the seven-card back preview",
    );
    assert.ok(
      await page.locator('.uno-own [data-uno-action="nextRound"]').isVisible(),
    );
    assert.equal(await page.locator(".uno-own .uno-win svg path").count(), 2);
    const trayBefore = await page.locator(".uno-revealed").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      overflow: getComputedStyle(el).overflowX,
    }));
    await page.locator(".uno-revealed .uno-mini-back").first().hover();
    const trayAfter = await page.locator(".uno-revealed").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      overflow: getComputedStyle(el).overflowX,
      gap:
        parseFloat(getComputedStyle(el.children[1]).marginLeft) +
        el.children[1].offsetWidth,
    }));
    assert.equal(trayBefore.height, trayAfter.height);
    assert.equal(
      trayBefore.overflow,
      trayAfter.overflow,
      "hover cannot change the reveal clipping mode",
    );
    assert.ok(trayAfter.gap >= 28, "flipped cards have roomier spacing");
    await page.screenshot({ path: path.join(output, "revealed-hands.png") });
    assert.ok(
      await page
        .locator(".uno-revealed")
        .evaluate(
          (el) =>
            getComputedStyle(el).overflowX === "visible" &&
            !el.hasAttribute("tabindex"),
        ),
      "revealed fans have neither a clipping viewport nor a focus frame",
    );
    assert.ok(
      await page
        .locator(".uno-revealed .uno-mini-back")
        .evaluateAll((cards) => {
          const area = document
            .querySelector(".uno-arena")
            .getBoundingClientRect();
          return cards.every((card) => {
            const r = card.getBoundingClientRect();
            return r.left >= area.left - 1 && r.right <= area.right + 1;
          });
        }),
      "every revealed card is within the board, including both end cards",
    );

    const aiEnding = fixture([
      [card("blue", 1), card("green", 1)],
      [card("red", 1)],
      [card("blue", 2), card("blue", 3)],
      [card("green", 2), card("green", 3)],
      [card("yellow", 2), card("yellow", 3)],
      [card("yellow", 4), card("yellow", 5)],
    ]);
    aiEnding.turn = 1;
    await reopen(aiEnding);
    const seatsBefore = await page
      .locator(".uno-seat-info")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y));
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    const seatsAfter = await page
      .locator(".uno-seat-info")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y));
    assert.ok(
      seatsBefore.every((y, i) => Math.abs(y - seatsAfter[i]) < 1),
      "a winning AI also leaves all five seats fixed",
    );
    assert.equal(await page.locator(".uno-revealed-face").count(), 8);
    assert.equal(
      await page.locator('.uno-seat[data-seat="1"] .uno-win').count(),
      1,
    );
    assert.equal(await page.locator(".uno-overlay").count(), 0);

    const endingPool = R.cards
      .map((c) => c.id)
      .filter((id) => id !== card("red", 1) && id !== card("red", 5));
    const endingHands = [[card("red", 1)]];
    for (let i = 1; i < 8; i++) endingHands.push(endingPool.splice(0, 7));
    await reopen(fixture(endingHands));
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    await page.waitForTimeout(800);
    assert.equal(await page.locator(".uno-revealed-face").count(), 49);
    assert.ok(
      await page.locator(".uno-revealed").evaluateAll((trays) =>
        trays.every((tray) => {
          const board = document
              .querySelector(".uno-arena")
              .getBoundingClientRect(),
            style = getComputedStyle(tray);
          return (
            style.overflowX === "visible" &&
            [...tray.querySelectorAll(".uno-mini-back")].every((card) => {
              const r = card.getBoundingClientRect();
              return r.left >= board.left - 1 && r.right <= board.right + 1;
            })
          );
        }),
      ),
      "all seven opponent fans expand without clipping their first or last cards",
    );
    await page.screenshot({
      path: path.join(output, "revealed-eight-players.png"),
    });

    // Stopping a deal reveals the already-saved full state without late callbacks.
    await exit();
    await page.evaluate(() => localStorage.removeItem("worktime.games.uno.v1"));
    await setDocumentHidden(page, false);
    await launchGame(page, "game-uno");
    await page.locator('[data-uno-action="start"]').click();
    await setDocumentHidden(page, true);
    const frozen = JSON.stringify(await read());
    assert.equal(await page.locator(".uno-flight").count(), 0);
    await page.waitForTimeout(2200);
    assert.equal(JSON.stringify(await read()), frozen);
    assert.equal(await page.locator("[data-uno-hidden]").count(), 0);
    await setDocumentHidden(page, false);
    await page.locator('[data-uno-action="restart"]').click();
    await page.locator('.uno-confirm [data-uno-action="restart"]').click();
    const beforeExit = JSON.stringify(await read());
    await exit();
    await page.waitForTimeout(1800);
    assert.equal(JSON.stringify(await read()), beforeExit);
    assert.equal(await page.locator(".uno-flight").count(), 0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    await reopen(
      fixture([[card("red", 1)], [card("blue", 1), card("blue", 2)]]),
    );
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    assert.equal(await page.locator(".uno-flight, .uno-toast").count(), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "false";
    });
    const live = R.create(6, "normal", 20261113);
    live.turn = 0;
    await reopen(live);
    await page.screenshot({ path: path.join(output, "table-live.png") });
    await page.locator('[data-uno-action="restart"]').click();
    await page.locator('.uno-confirm [data-uno-action="restart"]').click();
    // Headless Chromium keeps tabs visible; exercise the real visibility handler
    // with a deterministic hidden-document fixture.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenSave = JSON.stringify(await read());
    await page.waitForTimeout(2000);
    assert.equal(
      JSON.stringify(await read()),
      hiddenSave,
      "backgrounding stops deal and pending AI",
    );
    assert.equal(await page.locator(".uno-flight").count(), 0);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await reopen(
      fixture([[card("red", 1)], [card("blue", 1), card("blue", 2)]]),
    );
    await page.evaluate(() => {
      Element.prototype.animate = undefined;
    });
    await page.locator(`.uno-hand [data-card="${card("red", 1)}"]`).click();
    await page.locator(".uno-hand-actions:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".uno-call").count(),
      0,
      "finished games hide all last-card markers",
    );
    assert.equal(
      await page.locator(".uno-flight").count(),
      0,
      "optional animation API cannot block a turn",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
    console.log(
      "UNO deal/play/draw/reverse/UNO animations, typography, hover, turn highlighting, stable identities and cancellation verified: " +
        site,
    );
  } catch (error) {
    await page?.screenshot({ path: path.join(root, "_uno-motion-error.png") });
    throw error;
  } finally {
    await browser.close();
  }
}
module.exports = { verifyMotion };
if (require.main === module)
  verifyMotion(path.resolve(process.argv[2] || root)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
