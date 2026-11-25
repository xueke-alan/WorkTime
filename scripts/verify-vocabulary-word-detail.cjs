"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const site = process.argv[2] || path.resolve(__dirname, "..");
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
      await page.goto(pathToFileURL(path.join(site, "index.html")).href);
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
        const E = WorkTimeApp.services.vocabularyEngine;
        const words = WorkTimeApp.data.vocabularyCatalog.entries.filter(
          (entry) => entry.books.includes("cet6"),
        );
        const { id } = words[5];
        const time = (offset, hour = 12) => {
          const date = new Date();
          date.setHours(hour, 0, 0, 0);
          date.setDate(date.getDate() + offset);
          return date.toISOString();
        };
        const recall = { id, mode: "recall", first: false };
        d.logs = [
          { ...recall, at: time(-10), grade: 1, first: true },
          { ...recall, at: time(-10, 13), grade: 2, practice: true },
          ...Array.from({ length: 24 }, () => ({
            ...recall,
            at: time(-8),
            grade: 3,
          })),
          { id, mode: "spelling", at: time(-3), grade: 4, first: false },
          { ...recall, id: words[0].id, at: time(-50), grade: 3 },
        ];
        for (const [mode, offset, due] of [
          ["recall", -8, -2],
          ["spelling", -3, width === 390 ? 2 : 0],
        ]) {
          const card = E.schedule(undefined, 3, time(offset)).card;
          card.due = time(due, 23);
          d.cards[E.key(id, mode)] = card;
        }
        await S.save(E.review(d, words[5], "dictation", 1, time(-9)));
        window.wordDetailCopies = [];
        Object.defineProperty(navigator, "clipboard", {
          value: {
            async writeText(word) {
              if (window.rejectWordCopy) throw Error("Clipboard write denied");
              window.wordDetailCopies.push(word);
            },
          },
        });
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
      const copy = page.locator(".vocabulary-word-copy");
      const copyStatus = page.locator(".vocabulary-word-copy-status");
      await copy.hover();
      assert.equal(
        await copy.evaluate(
          (button) => getComputedStyle(button).textDecorationLine,
        ),
        "none",
      );
      await copy.click();
      await copyStatus
        .getByText("已复制", { exact: true })
        .waitFor({ state: "attached" });
      assert.equal(
        await copyStatus.evaluate(
          (status) => getComputedStyle(status).clipPath,
        ),
        "inset(50%)",
      );
      assert.deepEqual(await page.evaluate(() => window.wordDetailCopies), [
        word,
      ]);
      await page.evaluate(() => {
        window.rejectWordCopy = true;
      });
      await copy.click();
      await copyStatus.getByText("复制失败", { exact: true }).waitFor();
      assert.equal(
        await copyStatus.evaluate(
          (status) => getComputedStyle(status).clipPath,
        ),
        "none",
      );
      assert.deepEqual(await page.evaluate(() => window.wordDetailPlays), [
        word,
      ]);
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
      const history = page.locator(".vocabulary-memory-history");
      const attempts = history.getByRole("listitem");
      assert.equal(
        await page.locator("#vocabularyPage").getByRole("combobox").count(),
        0,
      );
      assert.match(
        await history.locator("p").first().innerText(),
        /→.*作答 28 次/,
      );
      assert.equal(await attempts.count(), 24);
      assert.equal(await attempts.first().innerText(), "D3 · 认识 · 记忆卡");
      assert.equal(await attempts.last().innerText(), "D8 · 轻松 · 拼写");
      await history
        .getByText("记忆卡 · 已逾期 2 天", { exact: true })
        .waitFor();
      await history.getByText("听写 · 待巩固", { exact: true }).waitFor();
      assert.match(
        await history.getByText(/^拼写 · /).innerText(),
        width === 390 ? /^拼写 · 下次复习 / : /^拼写 · 今日到期$/,
      );
      const earlier = history.getByRole("button", { name: "显示更早记录" });
      await earlier.click();
      assert.equal(await attempts.count(), 28);
      assert.deepEqual((await attempts.allTextContents()).slice(0, 4), [
        "D1 · 忘记 · 记忆卡",
        "D1 · 模糊 · 记忆卡",
        "D2 · 忘记 · 听写",
        "D3 · 认识 · 记忆卡",
      ]);
      assert.equal(await earlier.isVisible(), false);
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
      const words = page.locator(".vocabulary-word-open");
      await words.first().click();
      assert.deepEqual(await attempts.allTextContents(), ["D1 · 认识"]);
      await page.locator(".vocabulary-word-back").click();
      await words.nth(1).click();
      await history.getByText("暂无记忆记录", { exact: true }).waitFor();
      assert.equal(await attempts.count(), 0);
      await page.locator(".vocabulary-word-back").click();
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
      "Word reference pages: browsing, playback, shared memory history, and review preservation passed at 1440/390px.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
