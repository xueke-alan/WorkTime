"use strict";
require("./lib/browser-test-setup.cjs");
const { choose } = require("./verify-vocabulary-settings.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root,
);
function unit() {
  const context = vm.createContext({
    WorkTimeApp: { services: {}, data: {} },
    structuredClone,
  });
  const run = (file) =>
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
      filename: file,
    });
  for (const file of [
    "assets/vendor/vocabulary/fsrs.js",
    "assets/js/vocabulary-engine.js",
    "assets/js/services/vocabulary-storage.js",
    "assets/data/vocabulary/catalog.js",
    "assets/vendor/vocabulary/manifest.js",
  ])
    run(file);
  const { vocabularyEngine: E, vocabularyStorage: S } =
    context.WorkTimeApp.services;
  const catalog = context.WorkTimeApp.data.vocabularyCatalog;
  require("./vocabulary/verify-content.cjs").verifyContent(catalog, S);
  assert.equal(
    new Set(catalog.entries.map((e) => e.id)).size,
    catalog.entries.length,
  );
  for (const book of ["daily", "cet6", "kaoyan", "toefl", "ielts"])
    assert(
      catalog.entries.filter((e) => e.books.includes(book)).length > 500,
      book,
    );
  assert.equal(catalog.entries.filter((e) => e.kind === "phrase").length, 100);
  const { adapt } = require("./vocabulary/build-pronunciation.cjs");
  const { rank } = require("./vocabulary/import-dictionary.cjs");
  assert.equal(
    rank({ ipa: "/wɜːd/", tags: ["Received-Pronunciation"] }, "uk"),
    3,
  );
  assert.equal(rank({ ipa: "/wɜːd/", tags: ["US"] }, "uk"), 0);
  assert.equal(rank({ ipa: "/wɜːd/" }, "uk"), 0);
  assert.equal(rank({ ipa: "/wɜːd/", tags: ["US", "obsolete"] }, "us"), 0);
  assert.equal(adapt("ˈprəʊ.ɡræm", "uk"), "ˈpɹəʊɡɹæm");
  assert.equal(adapt("wɜːd̩", "uk"), null);
  for (const item of catalog.entries)
    for (const accent of ["us", "uk"]) {
      assert(item.phonetics[accent], item.id + ": missing IPA " + accent);
      assert(item.speech[accent], item.id + ": missing speech " + accent);
      assert(
        ["manual", "dictionary", "generated"].includes(
          item.pronunciationSource[accent],
        ),
      );
      assert.equal(adapt(item.speech[accent], accent), item.speech[accent]);
    }
  const program = catalog.entries.find((e) => e.word === "program");
  const experience = catalog.entries.find((e) => e.id === "experience");
  assert.equal(experience.phonetics.us, "ɪkˈspɪr.i.əns");
  assert.equal(experience.phonetics.uk, "ɪkˈspɪə.ri.əns");
  assert.equal(experience.pronunciationSource.us, "manual");
  assert.equal(experience.pronunciationSource.uk, "manual");
  assert.notEqual(program.phonetics.us, program.phonetics.uk);
  assert.notEqual(program.speech.us, program.speech.uk);
  assert.equal(program.pronunciationSource.uk, "dictionary");
  const now = Date.parse("2026-11-22T10:00:00+08:00"),
    base = S.defaults(),
    entry = catalog.entries.find((e) => e.books.includes("daily"));
  assert.equal(E.queue(base, catalog.entries, now).fresh.length, 20);
  let data = base;
  const intervals = [];
  for (let grade = 1; grade <= 4; grade++) {
    data = E.review(base, entry, "recall", grade, now);
    assert.equal(data.logs.length, 1);
    assert.equal(S.validate(data).cards[E.key(entry.id, "recall")].reps, 1);
    intervals.push(Date.parse(data.cards[E.key(entry.id, "recall")].due));
  }
  assert(intervals[0] < intervals[2] && intervals[2] <= intervals[3]);
  data = E.review(data, entry, "spelling", 1, now + 1000);
  assert.equal(
    Object.keys(data.cards).length,
    2,
    "Practice states are separate",
  );
  assert.equal(data.logs.length, 2);
  const report = E.analysis(data, now + 1000);
  assert.equal(report.days.length, 35);
  assert.equal(report.days.at(-1).fresh, 1);
  assert.equal(report.days.at(-1).reviews, 1);
  assert.equal(report.feedback[0], 1);
  assert.equal(report.total, 2);
  assert.equal(
    E.statistics(data, now).learned,
    1,
    "Unique entries across modes",
  );
  assert(
    E.queue(data, catalog.entries, now + 86400000 * 365).due.some(
      (e) => e.id === entry.id,
    ),
  );
  assert(E.correct({ word: "color", variants: ["colour"] }, " Colour "));
  assert(!E.correct({ word: "cat" }, "cats"));
  const phrase = catalog.entries.find((e) => e.kind === "phrase");
  assert(E.correct(phrase, phrase.word.toUpperCase()));
  const wrapped = S.attach({}, data);
  assert.equal(
    JSON.stringify(S.validateModule(S.find(wrapped))),
    JSON.stringify(data),
  );
  for (const mutate of [
    (d) => {
      d.settings.dailyNew = 0;
    },
    (d) => {
      d.cards.bad = {};
    },
    (d) => {
      d.logs[0].grade = 9;
    },
    (d) => {
      d.draft = { id: "x" };
    },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    assert.throws(() => S.validate(invalid));
  }
  assert.throws(() => S.validate(JSON.parse('{"version":1,"__proto__":{}}')));
  const manifest = context.WorkTimeApp.data.vocabularySpeech;
  for (const file of Object.values(manifest.files)) {
    if (file.url) {
      assert(file.url.startsWith("https://huggingface.co/"));
      assert.match(file.url, /\/resolve\/[a-f0-9]{40}\//);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert(!file.parts);
      continue;
    }
    const chunks = file.parts.map((part) => {
      context.WorkTimeApp.data.vocabularyChunks = [];
      run(part);
      return Buffer.from(
        context.WorkTimeApp.data.vocabularyChunks[0],
        "base64",
      );
    });
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, file.bytes);
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
    );
  }
  console.log(
    "Vocabulary unit: books, content, FSRS grades, overdue reviews, separate modes, spelling, archives and all model checksums passed.",
  );
}
async function browser() {
  const browser = await chromium.launch({ headless: true });
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [],
      external = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error(e.message);
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.error(m.text().slice(0, 500));
    });
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1")
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(
      server?.url || pathToFileURL(path.join(site, "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.evaluate(() => !!WorkTimeApp.services.vocabularySpeech),
      false,
      "Speech stays out of startup",
    );
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-card").waitFor();
    assert.equal(
      await page.locator(".vocabulary-header h2").innerText(),
      "摸摸背单词",
    );
    assert.equal(await page.locator(".vocabulary-header-book").count(), 0);
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "20",
      "Initial page shows the planned count before starting",
    );
    async function assertSidebar() {
      // Calendar controls now minimize vocabulary; restore it before checking
      // the full-sidebar geometry in each calendar/agenda layout.
      await page.evaluate(() => WorkTimeApp.ui.vocabulary.open());
      await page.waitForFunction(() => {
        const e = document
          .querySelector(".workspace > .editor")
          .getBoundingClientRect();
        const h = document
          .getElementById("vocabularyPanel")
          .getBoundingClientRect();
        const t = document
          .querySelector(".editor > .notification-tabs")
          .getBoundingClientRect();
        return (
          h.left >= e.left &&
          h.right <= e.right + 1 &&
          h.top >= e.top &&
          h.bottom <= t.top + 1
        );
      });
      const geometry = await page.evaluate(() => {
        const editor = document.querySelector(".workspace > .editor");
        const area = editor.querySelector(".date-info-area");
        const host = document.getElementById("vocabularyPanel");
        const tabs = editor.querySelector(".notification-tabs");
        const e = editor.getBoundingClientRect(),
          a = area.getBoundingClientRect(),
          h = host.getBoundingClientRect(),
          t = tabs.getBoundingClientRect();
        return {
          contained:
            h.left >= e.left &&
            h.right <= e.right + 1 &&
            h.top >= e.top &&
            h.bottom <= t.top + 1,
          fullHeight: a.height > e.height - t.height - 8,
          scrolling:
            getComputedStyle(document.querySelector(".vocabulary-page"))
              .overflowY === "auto",
          tabs: t.height > 0,
          formHidden:
            getComputedStyle(editor.querySelector(".editor-content"))
              .display === "none",
          modal: !!document.querySelector("#vocabularyDialog"),
          locked: !!document.querySelector(".workspace.is-game-expanded"),
          inert: document.querySelector(".workspace > section.panel").inert,
        };
      });
      assert.deepEqual(geometry, {
        contained: true,
        fullHeight: true,
        scrolling: true,
        tabs: true,
        formHidden: true,
        modal: false,
        locked: false,
        inert: false,
      });
    }
    await assertSidebar();
    const calendarMonth = await page.locator("#monthTitle").innerText();
    await page.locator("#prevMonth").click();
    assert.notEqual(
      await page.locator("#monthTitle").innerText(),
      calendarMonth,
      "Calendar remains interactive",
    );
    await page.locator("#todayButton").click();
    await page
      .locator(".vocabulary-mini-expand")
      .click({ position: { x: 10, y: 100 } });
    await page.locator('[data-page="books"]').click();
    assert.equal(await page.locator(".vocabulary-book").count(), 5);
    await page.locator('[data-book="kaoyan"]').click();
    assert((await page.locator(".vocabulary-row").count()) > 0);
    await page.locator('[data-action="use-book"]').click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.book ===
        "kaoyan",
    );
    await page.locator('[data-page="books"]').click();
    assert(
      (await page.locator('[data-book="kaoyan"]').innerText()).includes(
        "正在学习",
      ),
    );
    await page.locator('[data-book="daily"]').click();
    await page
      .locator('.vocabulary-library input[type="search"]')
      .fill("state");
    assert((await page.locator(".vocabulary-row").count()) > 0);
    await page.locator('[data-action="use-book"]').click();
    // Real cold generation: no stubs, no existing cache, and all remote requests blocked.
    if (
      process.argv.includes("--cold-voice") &&
      !process.argv.includes("--no-voice") &&
      !process.argv.includes("--no-cold-voice")
    ) {
      const metrics = await page.evaluate(async () => {
        const speech = WorkTimeApp.services.vocabularySpeech;
        await speech.clear();
        const us = await speech.synthesize({ word: "government" }, "us");
        const uk = await speech.synthesize({ word: "government" }, "uk");
        const cached = await speech.synthesize({ word: "government" }, "us");
        return {
          us: us.size,
          uk: uk.size,
          cached: cached.size,
          sampleRate: new DataView(await us.arrayBuffer()).getUint32(24, true),
        };
      });
      assert(metrics.us > 1000 && metrics.uk > 1000);
      assert.equal(metrics.us, metrics.cached);
      assert.equal(metrics.sampleRate, 44100);
      console.log("Cold offline fixed Supertonic / Piper speech", metrics);
    }

    await page.locator(".vocabulary-card h3").waitFor();
    await page.waitForFunction(
      () => !!WorkTimeApp.services.vocabularyStorage.read().draft,
    );
    await page.locator('[data-action="reveal"]').waitFor();
    await page.evaluate(() => {
      window.stableVocabularyNav = document.querySelector(
        ".vocabulary-navigation",
      );
      window.stableVocabularyTabs = [...window.stableVocabularyNav.children];
      window.autoReadCalls = [];
      window.wordDividerBeforeReveal = document
        .querySelector(".vocabulary-word-header")
        .getBoundingClientRect().bottom;
      WorkTimeApp.services.vocabularySpeech.play = async (entry) => {
        window.autoReadCalls.push(entry.id);
        return true;
      };
    });
    assert.equal(await page.locator('[data-action="check"]').count(), 0);
    assert.equal(
      await page.locator(".vocabulary-study-toolbar button").count(),
      0,
    );
    assert.equal(
      await page
        .locator(".vocabulary-study-favorite, .vocabulary-favorites")
        .count(),
      0,
      "Vocabulary favorites have been removed",
    );
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "20",
    );
    assert.deepEqual(
      await page
        .locator(".vocabulary-nav-item > span:first-of-type")
        .allTextContents(),
      ["复习", "选词", "统计", "设置"],
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const page = document.querySelector(".vocabulary-page");
        const card = document.querySelector(".vocabulary-card");
        const prompt = document.querySelector(".vocabulary-recall-prompt");
        const pageRect = page.getBoundingClientRect();
        const promptRect = prompt.getBoundingClientRect();
        return {
          background: getComputedStyle(card).backgroundColor,
          promptCentered:
            Math.abs(
              (promptRect.left +
                promptRect.right -
                pageRect.left -
                pageRect.right) /
                2,
            ) < 1,
          promptBelowWord:
            promptRect.top >=
            document
              .querySelector(".vocabulary-word-header")
              .getBoundingClientRect().bottom,
          promptVisible: promptRect.bottom <= pageRect.bottom + 1,
          generated: document
            .querySelector(".vocabulary-phonetic")
            .textContent.includes("自动生成"),
        };
      });
      assert.equal(layout.background, "rgba(0, 0, 0, 0)");
      assert(
        layout.promptCentered && layout.promptBelowWord && layout.promptVisible,
        JSON.stringify(layout),
      );
      assert.equal(layout.generated, false);
      assert.equal(
        await page.locator(".vocabulary-recall-prompt h4").innerText(),
        "请回忆单词发音和释义",
      );
      if (width === 390 && process.argv.includes("--screenshot")) {
        await page.locator("#vocabularyPanel").scrollIntoViewIfNeeded();
        await page.locator("#vocabularyPanel").screenshot({
          path: path.join(root, "artifacts/vocabulary-recall-mobile.png"),
        });
        await page.locator(".vocabulary-pronunciation").screenshot({
          path: path.join(root, "artifacts/vocabulary-pronunciation.png"),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-study.png"),
      });
    await page
      .locator('[data-action="reveal"]')
      .click({ position: { x: 10, y: 250 } });
    await page.locator('[data-grade="3"]:not(:disabled)').waitFor();
    assert.equal(
      await page.evaluate(() => window.autoReadCalls.length),
      1,
      "Reveal reads the word once by default",
    );
    assert(
      await page.evaluate(
        () =>
          window.stableVocabularyNav ===
            document.querySelector(".vocabulary-navigation") &&
          window.stableVocabularyTabs.every(
            (tab, i) => tab === window.stableVocabularyNav.children[i],
          ),
      ),
      "Reveal preserves navigation nodes",
    );
    const wordLayout = await page.evaluate(() => {
      const header = document
        .querySelector(".vocabulary-word-header")
        .getBoundingClientRect();
      const title = document
        .querySelector(".vocabulary-word-header h3")
        .getBoundingClientRect();
      const pronunciation = document
        .querySelector(".vocabulary-pronunciation")
        .getBoundingClientRect();
      const label = document.querySelector(
        ".vocabulary-pronunciation-play span",
      );
      const style = getComputedStyle(label);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = context.measureText(label.textContent);
      const probe = document.createElement("i");
      probe.style.cssText =
        "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;font-size:0;line-height:0";
      label.append(probe);
      const inkCenter =
        probe.getBoundingClientRect().top +
        (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) /
          2;
      probe.remove();
      const icon = document
        .querySelector(".vocabulary-pronunciation-play svg")
        .getBoundingClientRect();
      return {
        centered:
          Math.abs(
            (title.top + pronunciation.bottom - header.top - header.bottom) / 2,
          ) < 1,
        aligned: Math.abs(inkCenter - (icon.top + icon.bottom) / 2) < 1,
        border: getComputedStyle(
          document.querySelector(".vocabulary-word-header"),
        ).borderBottomWidth,
      };
    });
    assert.deepEqual(wordLayout, {
      centered: true,
      aligned: true,
      border: "1px",
    });
    assert(
      await page.evaluate(
        () =>
          Math.abs(
            document
              .querySelector(".vocabulary-word-header")
              .getBoundingClientRect().bottom - window.wordDividerBeforeReveal,
          ) < 1,
      ),
      "The word divider stays in place when revealing an answer",
    );
    assert.equal(await page.locator(".vocabulary-ratings button").count(), 3);
    assert.deepEqual(
      await page.locator(".vocabulary-rating strong").allTextContents(),
      ["认识", "模糊", "忘记"],
    );
    assert.deepEqual(
      await page
        .locator('[data-grade="2"] small, [data-grade="1"] small')
        .allTextContents(),
      ["今天", "今天"],
    );
    assert.equal(await page.locator(".vocabulary-detail-section").count(), 2);
    const exampleCount = await page.evaluate(() => {
      const id = WorkTimeApp.services.vocabularyStorage.read().draft.id;
      return WorkTimeApp.data.vocabularyCatalog.entries.find(
        (entry) => entry.id === id,
      ).examples.length;
    });
    assert.equal(
      await page.locator(".vocabulary-example").count(),
      exampleCount,
    );
    assert.equal(
      await page.locator(".vocabulary-example mark").count(),
      exampleCount,
    );
    assert.equal(await page.locator(".vocabulary-example-source").count(), 0);
    assert.equal(await page.locator(".vocabulary-source-link").count(), 0);
    assert.equal(
      await page
        .locator(".vocabulary-pronunciation small, .vocabulary-pronunciation a")
        .count(),
      0,
    );
    assert(
      !(
        await page.locator(".vocabulary-phonetic").first().innerText()
      ).includes("\n"),
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const ratings = [
          ...document.querySelectorAll(".vocabulary-ratings button"),
        ].map((el) => el.getBoundingClientRect());
        const footer = document
          .querySelector(".vocabulary-study-actions")
          .getBoundingClientRect();
        const nav = document
          .querySelector(".vocabulary-navigation")
          .getBoundingClientRect();
        const page = document.querySelector(".vocabulary-page");
        return {
          row: ratings.every((r) => Math.abs(r.top - ratings[0].top) < 1),
          docked: Math.abs(footer.bottom - nav.top) < 1,
          aligned:
            getComputedStyle(document.querySelector(".vocabulary-meaning"))
              .textAlign === "left",
          wordCentered:
            getComputedStyle(document.querySelector(".vocabulary-card h3"))
              .textAlign === "center",
          fits: page.scrollWidth <= page.clientWidth + 1,
        };
      });
      assert.deepEqual(layout, {
        row: true,
        docked: true,
        aligned: true,
        wordCentered: true,
        fits: true,
      });
      if (width === 390 && process.argv.includes("--screenshot")) {
        await page.locator("#vocabularyPanel").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(root, "artifacts/vocabulary-study-mobile.png"),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-study-answer.png"),
      });
    await page.evaluate(() => {
      const S = WorkTimeApp.services.vocabularyStorage;
      const save = S.save;
      S.save = async () => ({ persisted: false });
      window.vocabularyOriginalSave = save;
    });
    await page.locator('[data-grade="3"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector(".vocabulary-save-status")
        .textContent.includes("尚未保存"),
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyStorage.read().logs.length,
      ),
      0,
    );
    await page.evaluate(() => {
      WorkTimeApp.services.vocabularyStorage.save =
        window.vocabularyOriginalSave;
    });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(
      () => WorkTimeApp.services.vocabularyStorage.read().logs.length === 1,
    );
    await page.locator('[data-action="reveal"]').waitFor();
    await page.locator('[data-page="learning"]').click();
    await page.locator('[data-page="preferences"]').click();
    const autoReadToggle = page.locator('[data-setting="autoRead"]');
    assert(await autoReadToggle.isChecked());
    await autoReadToggle.uncheck();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.autoRead ===
        false,
    );
    assert(
      await page.evaluate(
        () =>
          window.stableVocabularyNav ===
          document.querySelector(".vocabulary-navigation"),
      ),
      "Grading preserves navigation nodes",
    );
    await choose(page, "练习方式", "spelling");
    await page.locator('[data-page="learning"]:not(:disabled)').click();
    await page.locator(".vocabulary-answer:not(:disabled)").waitFor();
    const spelling = await page.evaluate(() => {
      const id = WorkTimeApp.services.vocabularyStorage.read().draft.id;
      return WorkTimeApp.data.vocabularyCatalog.entries.find((e) => e.id === id)
        .word;
    });
    await page.locator(".vocabulary-answer").fill(spelling);
    const accentDraft = await page.evaluate(
      () => WorkTimeApp.services.vocabularyStorage.read().draft.id,
    );
    await page.locator('[data-page="preferences"]').click();
    await page.locator('[data-setting="accent"]').click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.accent === "uk",
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const data = WorkTimeApp.services.vocabularyStorage.read();
        return [data.draft.id, data.draft.answer];
      }),
      [accentDraft, spelling],
      "Switching accent preserves unfinished input",
    );
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-accent-settings.png"),
        fullPage: true,
      });
    await page.locator('[data-page="analysis"]').click();
    await page.locator('[data-page="learning"]:not(:disabled)').click();
    await page.waitForFunction(
      (value) => document.querySelector(".vocabulary-answer")?.value === value,
      spelling,
    );
    const draftID = await page.evaluate(
      () => WorkTimeApp.services.vocabularyStorage.read().draft.id,
    );
    await page.locator('.notification-tab[data-tab="notifications"]').click();
    assert(await page.locator(".editor-content").isVisible());
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.waitForFunction(
      (value) => document.querySelector(".vocabulary-answer")?.value === value,
      spelling,
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyStorage.read().draft.id,
      ),
      draftID,
    );
    await page.locator("#pageSettingsOpen").click();
    assert(await page.locator("#settingsPane").isVisible());
    assert.equal(
      await page.evaluate(() => WorkTimeApp.ui.vocabulary.isMini),
      true,
    );
    assert.equal(await page.locator("#vocabularyContent").isVisible(), false);
    await page.locator("#personalSettingsCancel").click();
    await page
      .locator(".vocabulary-mini-expand")
      .click({ position: { x: 10, y: 100 } });
    await page.waitForFunction(
      (value) => document.querySelector(".vocabulary-answer")?.value === value,
      spelling,
    );
    await page.locator(".vocabulary-page").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator('[data-action="check"]').click();
    await page.locator(".vocabulary-right").waitFor();
    assert.equal(
      await page.evaluate(() => window.autoReadCalls.length),
      1,
      "Disabling automatic reading prevents reveal playback",
    );
    await page.locator('[data-grade="3"]:not(:disabled)').click();
    await page.locator('[data-action="check"]:not(:disabled)').waitFor();
    let expectedLogs = 2;
    if (!process.argv.includes("--no-voice")) {
      await page.locator('[data-page="learning"]').click();
      await page.locator('[data-page="preferences"]').click();
      await choose(page, "练习方式", "dictation");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.mode ===
            "dictation" && !document.getElementById("vocabularyPage").inert,
      );
      await page.locator('[data-page="learning"]:not(:disabled)').click();
      await page
        .locator(".vocabulary-answer:not(:disabled)")
        .waitFor({ timeout: 120000 });
      await page.locator(".vocabulary-answer").fill("zzzz-wrong-answer");
      await page.locator('[data-action="check"]').click();
      await page.locator(".vocabulary-wrong").waitFor();
      assert(await page.locator('[data-grade="3"]').isDisabled());
      await page.locator('[data-grade="1"]:not(:disabled)').click();
      await page
        .locator(".vocabulary-answer:not(:disabled)")
        .waitFor({ timeout: 120000 });
      expectedLogs = 3;
    }
    const checks = await page.evaluate(async () => {
      const S = WorkTimeApp.services,
        V = S.vocabularyStorage,
        A = S.archive;
      const saved = V.read(),
        initial = A.migrate(WorkTimeApp.domain.state.defaultState());
      let fail = false;
      const owner = S.application.createState({
        state: initial,
        core: {},
        persistence: {
          commit: async () => ({ persisted: true }),
          restore: async () => ({ persisted: !fail }),
        },
      });
      await owner.saveVocabulary(saved);
      const storage = S.indexedStorage.create({
        key: "vocabulary-test",
        defaultState: WorkTimeApp.domain.state.defaultState,
        getStorage: () => localStorage,
      });
      const exported = await storage.export(owner.state),
        roundtrip = A.migrate(exported);
      const same =
        JSON.stringify(V.validateModule(V.find(roundtrip))) ===
        JSON.stringify(saved);
      const changes = await storage.exportChanges(owner.state, {
        vocabulary: true,
      });
      const patchIncluded = changes.some((m) => m.id === V.ID);
      await owner.restore(initial);
      const preserved = !!V.find(owner.state);
      fail = true;
      const before = JSON.stringify(owner.state);
      await owner.restore(V.attach(initial, V.defaults()));
      return {
        same,
        patchIncluded,
        preserved,
        rollback: before === JSON.stringify(owner.state),
      };
    });
    assert.deepEqual(checks, {
      same: true,
      patchIncluded: true,
      preserved: true,
      rollback: true,
    });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-card").waitFor();
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyStorage.read().settings.accent,
      ),
      "uk",
      "Accent survives backup restoration and reload",
    );
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyStorage.read().logs.length,
      ),
      expectedLogs,
    );
    const reloadedRemaining = await page.evaluate(() => {
      const data = WorkTimeApp.services.vocabularyStorage.read();
      const planned = new Set(
        WorkTimeApp.services.vocabularyEngine
          .queue(data, WorkTimeApp.data.vocabularyCatalog.entries)
          .items.map((entry) => entry.id),
      );
      if (data.draft) planned.add(data.draft.id);
      return String(planned.size);
    });
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      reloadedRemaining,
      "Reload restores planned count without requiring a session",
    );
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate(async (lang) => {
        await WorkTimeApp.i18n.setLanguage(lang);
        WorkTimeApp.ui.vocabulary.refresh();
      }, language);
      assert(
        !/vocabulary\./.test(
          await page.locator("#vocabularyContent").innerText(),
        ),
      );
    }
    await page.locator("#monthTitle").click();
    await page.waitForFunction(
      () =>
        !!document.querySelector("[data-year-date]") &&
        !document.getElementById("panelContent").inert,
    );
    await assertSidebar();
    await page.locator("#monthTitle").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-year-date]") &&
        !document.getElementById("panelContent").inert,
    );
    if (
      !(await page
        .locator(".workspace")
        .evaluate((el) => el.classList.contains("agenda-mode")))
    )
      await page.locator("#agendaMode").click();
    await page.waitForFunction(() =>
      document.querySelector(".workspace").classList.contains("agenda-mode"),
    );
    await assertSidebar();
    await page.locator("#pageSettingsOpen").click();
    assert.equal(
      await page.evaluate(() => WorkTimeApp.ui.vocabulary.isMini),
      true,
    );
    assert.equal(await page.locator("#vocabularyContent").isVisible(), false);
    await page.locator("#personalSettingsCancel").click();
    await assertSidebar();
    await page.locator("#agendaMode").click();
    await page
      .locator(".vocabulary-mini-expand")
      .click({ position: { x: 10, y: 100 } });
    await page.locator(".vocabulary-page").evaluate((el) => {
      el.scrollTop = 0;
    });
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-desktop.png"),
      });
    await page.locator('[data-page="analysis"]').click();
    assert.equal(await page.locator(".vocabulary-heatmap span").count(), 35);
    assert.equal(await page.locator(".vocabulary-chart rect").count(), 60);
    assert.equal(
      await page.locator(".vocabulary-feedback progress").count(),
      4,
    );
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-analysis.png"),
      });
    await page.locator('[data-page="books"]').click();
    const previousCards = await page.evaluate(() =>
      JSON.stringify(WorkTimeApp.services.vocabularyStorage.read().cards),
    );
    await page.locator('[data-book="cet6"]').click();
    await page.locator('[data-action="use-book"]').click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.book ===
          "cet6" &&
        document.getElementById("vocabularyContent").dataset.page === "study",
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(WorkTimeApp.services.vocabularyStorage.read().cards),
      ),
      previousCards,
    );
    await page.locator('[data-page="books"]:not(:disabled)').click();
    await page.locator('[data-book="daily"]').click();
    await page.locator('[data-action="use-book"]').click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.book ===
          "daily" &&
        document.getElementById("vocabularyContent").dataset.page === "study",
    );
    await page.locator('[data-page="books"]:not(:disabled)').click();
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-books.png"),
      });
    await page.locator('[data-page="learning"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertSidebar();
    await page.locator("#vocabularyPanel").scrollIntoViewIfNeeded();
    assert(
      await page
        .locator("#vocabularyContent")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    if (process.argv.includes("--screenshot"))
      await page.screenshot({
        path: path.join(root, "artifacts/vocabulary-mobile.png"),
        fullPage: false,
      });
    assert.deepEqual(errors, []);
    await page.locator('[data-page="preferences"]').click();
    await choose(page, "练习方式", "recall");
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.mode ===
        "recall",
    );
    await page
      .locator(
        '.vocabulary-page:not([inert]) .vocabulary-controls input[type="number"]',
      )
      .fill("1");
    await page
      .locator(
        '.vocabulary-page:not([inert]) .vocabulary-controls input[type="number"]',
      )
      .press("Tab");
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.dailyNew === 1,
    );
    await page.locator('[data-page="learning"]:not(:disabled)').click();
    await page.locator(".vocabulary-hero").waitFor();
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "0",
    );
    assert.equal(
      await page
        .locator(
          ".vocabulary-page button,.vocabulary-page .vocabulary-library,.vocabulary-current-book",
        )
        .count(),
      0,
      "Summary only contains streak and today's learning",
    );
    assert.deepEqual(
      await page.locator(".vocabulary-page > h3").allTextContents(),
      ["今日学习"],
    );
    assert.equal(await page.locator(".vocabulary-stats > div").count(), 3);
    if (process.argv.includes("--screenshot"))
      await page.locator("#vocabularyPanel").screenshot({
        path: path.join(root, "artifacts/vocabulary-summary.png"),
      });
    await page.locator('[data-page="learning"]').click();
    assert(
      await page.locator(".vocabulary-hero").isVisible(),
      "Completed review stays on summary",
    );
    await page.locator('[data-page="preferences"]').click();
    await page
      .locator(
        '.vocabulary-page:not([inert]) .vocabulary-controls input[type="number"]',
      )
      .fill("2");
    await page
      .locator(
        '.vocabulary-page:not([inert]) .vocabulary-controls input[type="number"]',
      )
      .press("Tab");
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.dailyNew === 2,
    );
    await page.locator('[data-page="learning"]:not(:disabled)').click();
    await page.locator(".vocabulary-card").waitFor();
    assert.equal(
      await page.locator(".vocabulary-hero").count(),
      0,
      "New work opens a card directly",
    );
    await page
      .locator('[data-action="reveal"]')
      .click({ position: { x: 10, y: 250 } });
    await page.locator('[data-grade="3"]:not(:disabled)').click();
    await page.locator(".vocabulary-hero").waitFor();
    assert.equal(
      await page.locator(".vocabulary-review-badge").innerText(),
      "0",
      "Finishing the last card automatically opens summary",
    );
    console.log(
      "Vocabulary browser: lazy loading, grading failure/retry, backup roundtrip, incremental export, legacy restore, reload, six languages and mobile passed. Model transport is verified separately.",
    );
    console.log("Blocked unrelated remote requests:", external.length);
    await context.close();
  } finally {
    await browser.close();
    await server?.close();
  }
}
if (!process.argv.includes("--ui-only")) unit();
if (!process.argv.includes("--unit"))
  browser().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
