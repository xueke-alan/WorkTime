"use strict";
require("./lib/browser-test-setup.cjs");
const { choose } = require("./verify-vocabulary-settings.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) ||
    path.resolve(__dirname, ".."),
);

(async () => {
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      server?.url || pathToFileURL(path.join(site, "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      await WorkTimeApp.services.vocabularyIdle.load();
      WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
      const storage = WorkTimeApp.services.vocabularyStorage;
      const data = storage.defaults();
      data.settings.autoRead = false;
      await storage.save(data);
    });
    const open = async () => {
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page.locator(".vocabulary-card").waitFor();
    };
    const ready = () =>
      page
        .locator(
          "#vocabularyContent .vocabulary-pronunciation-play:not(:disabled), #vocabularyContent .vocabulary-answer:not(:disabled)",
        )
        .waitFor();
    const state = () =>
      page.evaluate(() =>
        structuredClone(WorkTimeApp.services.vocabularyStorage.read()),
      );
    const mini = page.locator(".vocabulary-mini");
    const expand = page.locator(".vocabulary-mini-expand");
    await open();
    await ready();
    const initial = await state();
    const word = await page.locator(".vocabulary-word-header h3").innerText();
    const month = await page.locator("#monthTitle").innerText();
    await page.locator("#nextMonth").click();
    await mini.waitFor();
    assert.notEqual(await page.locator("#monthTitle").innerText(), month);
    assert.equal(await page.locator(".vocabulary-mini-word").innerText(), word);
    assert.equal(await page.locator(".editor.is-vocabulary-open").count(), 0);
    assert.equal(await page.locator("#toolsPanel").isVisible(), false);
    assert.equal(await page.locator("#vocabularyContent").isVisible(), false);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    assert.deepEqual(
      await state(),
      initial,
      "Mini mode cannot reveal or grade",
    );
    await expand.focus();
    await page.keyboard.press("Enter");
    await ready();
    assert.equal(await mini.isVisible(), false);
    assert.equal(await page.locator(".editor.is-vocabulary-open").count(), 1);
    assert.deepEqual(await state(), initial);
    await page.keyboard.press("Space");
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    const revealed = await state();
    await page.locator("#nextMonth").click();
    await mini.waitFor();
    await expand.click();
    assert.deepEqual(
      await state(),
      revealed,
      "Expanded answer stays revealed without grading",
    );
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();

    for (const view of ["books", "analysis", "preferences"]) {
      await page.locator(`.vocabulary-nav-item[data-page="${view}"]`).click();
      await page
        .locator(".summary-sidebar")
        .click({ position: { x: 8, y: 8 } });
      await mini.waitFor();
      await expand.click();
      assert.equal(
        await page.locator("#vocabularyContent").getAttribute("data-page"),
        "study",
        "Expanding the mini view always returns to review from " + view,
      );
    }
    await page.waitForFunction(
      () => !document.querySelector(".vocabulary-drawer-snapshot"),
    );
    const morph = await page.evaluate(async () => {
      const prefs = WorkTimeApp.services.preferences.page;
      await prefs.saveMotionMode("full");
      const appearance = (root) => {
        const header = root.querySelector(".vocabulary-word-header");
        return [
          "h3",
          ".vocabulary-phonetic",
          ".vocabulary-pronunciation-play",
          ".vocabulary-pronunciation-play svg",
        ].map((selector) => {
          const element = header.querySelector(selector);
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            text: element.textContent,
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            color: style.color,
            width: selector.endsWith("svg") ? style.width : null,
            height: selector.endsWith("svg") ? style.height : null,
          };
        });
      };
      const fullAppearance = JSON.stringify(
        appearance(document.getElementById("vocabularyContent")),
      );
      const originalTitle = document.querySelector(
        "#vocabularyContent .vocabulary-header h2",
      );
      const originalTitleTop = originalTitle.getBoundingClientRect().top;
      const originalTitleStyle = getComputedStyle(originalTitle);
      const titleMetrics = Object.fromEntries(
        [
          "fontSize",
          "lineHeight",
          "fontWeight",
          "fontFamily",
          "letterSpacing",
        ].map((name) => [name, originalTitleStyle[name]]),
      );
      titleMetrics.top = originalTitleTop;
      document.getElementById("prevMonth").click();
      const oldTitle = document.querySelector(
        ".vocabulary-drawer-snapshot > .vocabulary-header h2",
      );
      const titleAligned =
        Math.abs(oldTitle.getBoundingClientRect().top - originalTitleTop) < 1;
      const body = document.querySelector(
        ".vocabulary-drawer-snapshot > .vocabulary-drawer-body",
      );
      const meaning = body.querySelector(".vocabulary-meaning");
      const meaningAnimation = meaning?.getAnimations()[0];
      const meaningFades =
        meaningAnimation?.effect.getKeyframes().at(-1).opacity === "0" &&
        !body.querySelector(".vocabulary-revealing");
      body.getAnimations()[0].pause();
      await oldTitle.getAnimations()[0]?.finished.catch(() => {});
      await Promise.resolve();
      const noTitleFlash =
        !oldTitle.isConnected || getComputedStyle(oldTitle).opacity === "0";
      await prefs.saveMotionMode("reduce");
      const mini = document.querySelector(".vocabulary-mini");
      const identicalMini = fullAppearance === JSON.stringify(appearance(mini));
      const miniRect = mini.getBoundingClientRect();
      const wordRect = mini
        .querySelector(".vocabulary-card")
        .getBoundingClientRect();
      const compactViewport = mini.querySelector(".vocabulary-study-header");
      const centeredBox =
        wordRect.height > miniRect.height
          ? compactViewport.getBoundingClientRect()
          : wordRect;
      const centeredMini =
        Math.abs(
          (miniRect.top + miniRect.bottom) / 2 -
            (centeredBox.top + centeredBox.bottom) / 2,
        ) < 1 &&
        (wordRect.height <= miniRect.height ||
          compactViewport.scrollHeight > compactViewport.clientHeight);
      const hidesMeaning = !mini.querySelector(".vocabulary-meaning");
      const cleanMini =
        !mini.querySelector(".vocabulary-study-favorite") &&
        getComputedStyle(mini.querySelector(".vocabulary-word-header"))
          .borderBottomWidth === "0px";
      const speech = WorkTimeApp.services.vocabularySpeech;
      const originalPlay = speech.play;
      let plays = 0;
      speech.play = async () => {
        plays++;
        return true;
      };
      mini.querySelector(".vocabulary-pronunciation-play").click();
      await Promise.resolve();
      speech.play = originalPlay;
      const playInMini = plays === 1 && WorkTimeApp.ui.vocabulary.isMini;
      await prefs.saveMotionMode("full");
      const ordinaryTitle = document.getElementById("editorDate");
      const ordinaryBox = ordinaryTitle.getBoundingClientRect();
      const editorTitleTop = ordinaryBox.top;
      WorkTimeApp.ui.vocabulary.open();
      const fadingDate = document.querySelector(
        ".vocabulary-drawer-snapshot .editor-day-header .editor-date",
      );
      const dateAligned =
        Math.abs(fadingDate.getBoundingClientRect().top - editorTitleTop) < 1;
      const reviewTitle = document.querySelector(
        "#vocabularyContent .vocabulary-header h2",
      );
      const reviewStyle = getComputedStyle(reviewTitle);
      const sameTitle =
        Math.abs(reviewTitle.getBoundingClientRect().top - titleMetrics.top) <
          1 &&
        [
          "fontSize",
          "lineHeight",
          "fontWeight",
          "fontFamily",
          "letterSpacing",
        ].every((name) => reviewStyle[name] === titleMetrics[name]);
      const titleFrames = reviewTitle.getAnimations()[0]?.effect.getKeyframes();
      const titleTiming = reviewTitle.getAnimations()[0]?.effect.getTiming();
      const sameTitleMotion =
        parseFloat(titleFrames?.[0].translate) ===
          parseFloat(WorkTimeApp.ui.motion.title.enterFrom.translate) &&
        titleTiming?.duration === WorkTimeApp.ui.motion.title.duration &&
        titleTiming?.easing === WorkTimeApp.ui.motion.title.easing;
      await new Promise((resolve) => setTimeout(resolve, 420));
      const target = document.querySelector(
        "#vocabularyContent .vocabulary-word-header h3",
      );
      const header = document.querySelector(
        "#vocabularyContent .vocabulary-header",
      );
      const visible = getComputedStyle(target).visibility === "visible";
      WorkTimeApp.ui.vocabulary.refresh();
      return {
        noTitleFlash,
        meaningFades,
        sameTitle,
        sameTitleMotion,
        titleAligned,
        dateAligned,
        identicalMini,
        hidesMeaning,
        centeredMini,
        cleanMini,
        playInMini,
        noMorph: !document.querySelector(".vocabulary-shared-element"),
        visible,
        stableHeader:
          header ===
          document.querySelector("#vocabularyContent .vocabulary-header"),
      };
    });
    for (const key of [
      "noTitleFlash",
      "meaningFades",
      "sameTitle",
      "sameTitleMotion",
      "titleAligned",
      "dateAligned",
      "identicalMini",
      "hidesMeaning",
      "centeredMini",
      "cleanMini",
      "playInMini",
      "noMorph",
      "visible",
      "stableHeader",
    ])
      assert.equal(morph[key], true, key);
    await page.locator('.vocabulary-nav-item[data-page="preferences"]').click();
    // Switching mode clears the active card; the mini view must not start a session.
    await choose(page, "练习方式", "spelling");
    await page.waitForFunction(
      () => !WorkTimeApp.services.vocabularyStorage.read().draft,
    );
    await page.locator("#prevMonth").click();
    await mini.waitFor();
    assert.equal(
      await page.locator(".vocabulary-mini-word").innerText(),
      "暂无学习中的单词",
    );
    assert.equal((await state()).draft, null);
    await expand.click();
    await page.locator('.vocabulary-nav-item[data-page="learning"]').click();
    await ready();
    await page.locator(".vocabulary-answer").fill("unfinished answer");
    await page.locator("#prevMonth").click();
    await mini.waitFor();
    await expand.click();
    assert.equal(
      await page.locator(".vocabulary-answer").inputValue(),
      "unfinished answer",
    );
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().draft?.answer ===
        "unfinished answer",
    );

    for (const width of [1440, 1000, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#prevMonth").click();
      await mini.waitFor();
      const bounds = await page.locator("#vocabularyPanel").boundingBox();
      const area = await page.locator(".date-info-area").boundingBox();
      assert(bounds.width > 0 && bounds.height > 0);
      assert(
        Math.abs(bounds.x - area.x) <= 1 &&
          Math.abs(bounds.width - area.width) <= 2,
      );
      await mini.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.resolve(__dirname, `../.cache/vocabulary-mini-${width}.png`),
      });
      await page.locator(".vocabulary-mini-back").click();
      assert.equal(await page.locator(".tools-cards").isVisible(), true);
      assert.equal(await mini.isVisible(), false);
      await page.locator("#vocabularyOpen").click();
      await ready();
      assert.equal(await page.locator(".editor.is-vocabulary-open").count(), 1);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const transition = await page.evaluate(async () => {
      const preferences = WorkTimeApp.services.preferences.page;
      await preferences.saveMotionMode("full");
      const before = JSON.stringify(
        WorkTimeApp.services.vocabularyStorage.read(),
      );
      const content = document.getElementById("vocabularyContent");
      const mini = document.querySelector(".vocabulary-mini");
      const originalWordTop = content
        .querySelector(".vocabulary-word-header")
        .getBoundingClientRect().top;
      document.getElementById("prevMonth").click();
      const outgoing = document.querySelector(
        ".vocabulary-drawer-snapshot > .vocabulary-drawer-body",
      );
      const withinEditor = () => {
        const editor = document.querySelector(".workspace > .editor");
        const bounds = editor.getBoundingClientRect();
        return [
          ...document.querySelectorAll(".vocabulary-drawer-snapshot"),
        ].every((frame) => {
          const rect = frame.getBoundingClientRect();
          return (
            frame.offsetParent === editor &&
            rect.left >= bounds.left - 1 &&
            rect.right <= bounds.right + 1
          );
        });
      };
      const closingInRightColumn = withinEditor();
      const collapse = outgoing?.getAnimations()[0];
      const down = collapse?.effect.getKeyframes().at(-1).transform;
      const downDistance = Number(down.match(/translateY\(([\d.]+)px\)/)[1]);
      const destinationTop = mini
        .querySelector(".vocabulary-word-header")
        .getBoundingClientRect().top;
      const landsOnMini =
        Math.abs(originalWordTop + downDistance - destinationTop) < 1;
      const backdropFade = document
        .querySelector(".editor-content")
        .getAnimations()
        .some((animation) => {
          const frames = animation.effect.getKeyframes();
          return (
            frames[0].opacity === "0" &&
            frames.at(-1).opacity === "1" &&
            !frames[0].transform
          );
        });
      const headerStill = !document
        .querySelector(".vocabulary-header")
        .getAnimations()
        .some((animation) =>
          animation.effect.getKeyframes().some((frame) => frame.transform),
        );
      // Reverse before the first animation completes.
      WorkTimeApp.ui.vocabulary.open();
      const surface = content.querySelector(".vocabulary-drawer-body");
      const expand = surface.getAnimations()[0];
      const up = expand?.effect.getKeyframes().at(-1).transform;
      const openingInRightColumn = withinEditor();
      const clipped =
        getComputedStyle(document.getElementById("vocabularyPanel"))
          .overflowY === "hidden" &&
        getComputedStyle(surface.parentElement).overflowY === "clip";
      const cancelled = collapse?.playState === "idle";
      await preferences.saveMotionMode("reduce");
      const stopped =
        surface.getAnimations().length === 0 &&
        !document.querySelector(".vocabulary-drawer-snapshot");
      document.getElementById("prevMonth").click();
      const reduced = mini.getAnimations().length === 0;
      WorkTimeApp.ui.vocabulary.open();
      return {
        down,
        up,
        closingInRightColumn,
        openingInRightColumn,
        landsOnMini,
        backdropFade,
        cancelled,
        headerStill,
        clipped,
        stopped,
        reduced,
        stable:
          before ===
          JSON.stringify(WorkTimeApp.services.vocabularyStorage.read()),
        full: !WorkTimeApp.ui.vocabulary.isMini && !content.hidden,
      };
    });
    assert.match(transition.down, /^translateY\([1-9][\d.]*px\)$/);
    assert.equal(transition.up, "translateY(0px)");
    for (const key of [
      "cancelled",
      "closingInRightColumn",
      "openingInRightColumn",
      "landsOnMini",
      "backdropFade",
      "headerStill",
      "clipped",
      "stopped",
      "reduced",
      "stable",
      "full",
    ])
      assert.equal(transition[key], true, key);
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const contained = await page.evaluate(async () => {
        const prefs = WorkTimeApp.services.preferences.page;
        await prefs.saveMotionMode("full");
        const inside = () => {
          const editor = document.querySelector(".workspace > .editor");
          const box = editor.getBoundingClientRect();
          return [
            ...document.querySelectorAll(".vocabulary-drawer-snapshot"),
          ].every((frame) => {
            const rect = frame.getBoundingClientRect();
            return (
              frame.offsetParent === editor &&
              rect.left >= box.left - 1 &&
              rect.right <= box.right + 1
            );
          });
        };
        // Expanding preserves the vocabulary title, which shares settings typography.
        const normal = document.querySelector(".vocabulary-header h2");
        const titleTop = (element) =>
          element.getBoundingClientRect().top -
          element.closest(".editor").getBoundingClientRect().top;
        const normalTop = titleTop(normal);
        const normalFont = getComputedStyle(normal).fontSize;
        document.getElementById("prevMonth").click();
        const closing = inside();
        WorkTimeApp.ui.vocabulary.open();
        const opening = inside();
        const vocabularyTitle = document.querySelector(
          "#vocabularyContent .vocabulary-header h2",
        );
        const sameTitle =
          Math.abs(titleTop(vocabularyTitle) - normalTop) < 1 &&
          getComputedStyle(vocabularyTitle).fontSize === normalFont;
        await prefs.saveMotionMode("reduce");
        return {
          ok: closing && opening && sameTitle,
          closing,
          opening,
          sameTitle,
          normalTop,
          reviewTop: titleTop(vocabularyTitle),
          normalFont,
          reviewFont: getComputedStyle(vocabularyTitle).fontSize,
        };
      });
      assert.equal(
        contained.ok,
        true,
        "Drawer stays in the editor at " +
          width +
          "px: " +
          JSON.stringify(contained),
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "Vocabulary mini mode passed (1440/1000/390px): " + (server?.url || site),
    );
  } finally {
    await browser.close();
    await server?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
