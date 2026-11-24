"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async (width) => {
        await WorkTimeApp.services.vocabularyIdle.load();
        WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
        const S = WorkTimeApp.services.vocabularyStorage;
        const d = S.defaults();
        d.settings.autoRead = false;
        d.settings.mode = width === 390 ? "spelling" : "recall";
        await S.save(d);
        window.wordDetailPlays = [];
        WorkTimeApp.services.vocabularySpeech.play = async (entry) => {
          window.wordDetailPlays.push(entry.word);
          return true;
        };
      }, width);
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page.locator(".vocabulary-card").waitFor();
      const state = () =>
        page.evaluate(() =>
          structuredClone(WorkTimeApp.services.vocabularyStorage.read()),
        );
      const initial = await state();
      await page.locator('.vocabulary-nav-item[data-page="books"]').click();
      await page.locator('.vocabulary-book[data-book="cet6"]').click();
      await page.locator(".vocabulary-word-open").first().waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "‹ 全部词库", exact: true })
          .count(),
        0,
      );
      const heading = await page
        .locator(".vocabulary-book-heading")
        .evaluate((el) => {
          const box = el.getBoundingClientRect();
          const button = el
            .querySelector(".vocabulary-use-book")
            .getBoundingClientRect();
          const title = el.querySelector("h3").getBoundingClientRect();
          return {
            right: Math.abs(box.right - button.right),
            sameRow:
              button.top < el.getBoundingClientRect().bottom &&
              title.right < button.left,
          };
        });
      assert(heading.right < 1 && heading.sameRow);
      await page
        .locator("#vocabularyPanel")
        .screenshot({ path: `vocabulary-library-refined-${width}.png` });
      const row = page.locator(".vocabulary-row").nth(5);
      const fixedTop = await page
        .locator(".vocabulary-book-heading")
        .evaluate((el) => el.getBoundingClientRect().top);
      await row.scrollIntoViewIfNeeded();
      assert.equal(
        await page.locator("#vocabularyPage").evaluate((el) => el.scrollTop),
        0,
      );
      assert.equal(
        await page
          .locator(".vocabulary-book-heading")
          .evaluate((el) => el.getBoundingClientRect().top),
        fixedTop,
      );
      const word = await row.locator(".vocabulary-word-open").innerText();
      const entry = await page.evaluate(
        (word) =>
          WorkTimeApp.data.vocabularyCatalog.entries.find(
            (e) => e.word === word,
          ),
        word,
      );
      const inline = await row
        .locator(".vocabulary-list-pronunciation")
        .evaluate((el) => {
          const phonetic = el.querySelector("small").getBoundingClientRect();
          const button = el.querySelector("button").getBoundingClientRect();
          const word = el.parentElement
            .querySelector(".vocabulary-word-open")
            .getBoundingClientRect();
          return (
            Math.abs(
              (phonetic.top + phonetic.bottom - button.top - button.bottom) / 2,
            ) < 1 &&
            button.left >= phonetic.right &&
            phonetic.left >= word.right &&
            Math.abs(
              (word.top + word.bottom - button.top - button.bottom) / 2,
            ) < 1 &&
            !!el.querySelector("svg path")
          );
        });
      assert(inline);
      await row.locator(".vocabulary-list-play").click();
      assert.equal(
        await page.locator("#vocabularyContent").getAttribute("data-page"),
        "book",
      );
      assert.deepEqual(await page.evaluate(() => window.wordDetailPlays), [
        word,
      ]);
      const scroll = await page
        .locator(".vocabulary-list")
        .evaluate((e) => e.scrollTop);
      await row.locator(".vocabulary-word-open").click();
      await page.locator('#vocabularyContent[data-page="word"]').waitFor();
      assert.equal(
        await page.locator(".vocabulary-word-header h3").innerText(),
        word,
      );
      assert.equal(
        await page.locator(".vocabulary-meaning").innerText(),
        entry.zh,
      );
      assert.equal(
        await page
          .locator(
            "[data-grade], .vocabulary-study-actions, .vocabulary-answer",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator(".vocabulary-example").count(),
        entry.examples?.length || 0,
      );
      await page.locator(".vocabulary-pronunciation-play").click();
      if (entry.examples?.length)
        await page.locator(".vocabulary-example-play").first().click();
      await page.locator("body").click({ position: { x: 2, y: 2 } });
      for (const key of [
        "Space",
        "ArrowLeft",
        "ArrowDown",
        "ArrowRight",
        "ArrowUp",
      ])
        await page.keyboard.press(key);
      assert.deepEqual(
        await state(),
        initial,
        "Browsing and playing reference words cannot grade or replace the review draft",
      );
      await page
        .locator("#vocabularyPanel")
        .screenshot({ path: `vocabulary-word-detail-${width}.png` });
      await page.locator(".vocabulary-word-back").click();
      assert.equal(
        await page.locator("#vocabularyContent").getAttribute("data-page"),
        "book",
      );
      assert(
        Math.abs(
          (await page
            .locator(".vocabulary-list")
            .evaluate((e) => e.scrollTop)) - scroll,
        ) < 1,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.word),
        entry.id,
      );
      const search = page.locator(".vocabulary-library input[type=search]");
      await search.fill(word);
      await page.locator(".vocabulary-word-open").first().click();
      await page.locator(".vocabulary-word-back").click();
      assert.equal(await search.inputValue(), word);
      await page.locator('.vocabulary-nav-item[data-page="learning"]').click();
      assert.deepEqual(
        await state(),
        initial,
        "Returning to review preserves learning progress and its draft",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Word reference pages: aligned book action, inline speakers, full details without grading, list return and review preservation passed at 1440/390px.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
