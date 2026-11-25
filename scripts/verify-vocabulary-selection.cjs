"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const { choose } = require("./verify-vocabulary-settings.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root,
);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:\/\//, (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      await page.goto(
        server?.url || pathToFileURL(path.join(site, "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.vocabularyIdle.load();
        WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
        const S = WorkTimeApp.services.vocabularyStorage;
        const E = WorkTimeApp.services.vocabularyEngine;
        let data = S.defaults();
        data.settings.autoRead = false;
        data.settings.dailyTotal = 3;
        const words = WorkTimeApp.data.vocabularyCatalog.entries
          .filter((e) => e.books.includes("daily"))
          .slice(0, 4);
        for (const [index, word] of words.entries()) {
          data = E.review(data, word, "recall", 3, Date.now() - 86400000 * 60);
          const card = data.cards[E.key(word.id, "recall")];
          card.due = new Date(Date.now() - 1000).toISOString();
          card.state = 2;
          card.scheduled_days = [6, 7, 29, 30][index];
        }
        await S.save(data);
      });
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page.locator(".vocabulary-card").waitFor();
      const books = () =>
        page.locator('.vocabulary-nav-item[data-page="books"]').click();
      await books();
      assert.equal(await page.locator(".vocabulary-book").count(), 5);
      assert.equal(
        await page
          .locator('.vocabulary-search-field use[href="#ms-search"]')
          .count(),
        1,
      );
      assert.equal(await page.locator("#ms-search path").count(), 1);
      assert.equal(
        await page
          .locator(".vocabulary-current-book .vocabulary-book-cover")
          .count(),
        1,
      );
      assert(
        await page.locator(".vocabulary-book-selection").evaluate((panel) => {
          const prefix = panel
            .querySelector('[data-setting-field="dailyTotal"] > span')
            .getBoundingClientRect();
          const input = panel
            .querySelector('[data-setting-field="dailyTotal"] input')
            .getBoundingClientRect();
          const total = panel
            .querySelector('[data-setting-field="dailyTotal"]')
            .getBoundingClientRect();
          const mode = panel
            .querySelector(".shared-select-trigger")
            .getBoundingClientRect();
          const counts = [
            ...panel.querySelectorAll(".vocabulary-plan-counts > div"),
          ];
          const covers = [...panel.querySelectorAll(".vocabulary-book-cover")];
          return (
            Math.abs(total.top - mode.top) < 1 &&
            Math.abs(total.height - mode.height) < 1 &&
            Math.abs(
              (prefix.top + prefix.bottom - input.top - input.bottom) / 2,
            ) < 2 &&
            counts.every((item) => {
              const label = item.querySelector("span").getBoundingClientRect();
              const value = item
                .querySelector("strong")
                .getBoundingClientRect();
              return (
                Math.abs(
                  (label.top + label.bottom - value.top - value.bottom) / 2,
                ) < 2
              );
            }) &&
            covers.every((cover) => {
              const text = cover
                .querySelector("strong")
                .getBoundingClientRect();
              const box = cover.getBoundingClientRect();
              return (
                text.left >= box.left &&
                text.right <= box.right &&
                box.width >=
                  (cover.closest(".vocabulary-current-book") ? 34 : 56)
              );
            })
          );
        }),
      );
      assert.equal(await page.locator(".vocabulary-plan-control").count(), 2);
      assert.equal(
        await page.locator(".vocabulary-book-info > span").count(),
        1,
      );
      assert(
        await page.locator(".vocabulary-book-selection").evaluate((panel) => {
          const styles = [
            ...panel.querySelectorAll(".vocabulary-plan-control"),
          ].map((item) => {
            const style = getComputedStyle(item);
            return [
              style.height,
              style.borderRadius,
              style.borderColor,
              style.backgroundColor,
              style.fontSize,
            ].join(";");
          });
          const current = panel.querySelector(".vocabulary-current-book");
          const cover = current
            .querySelector(".vocabulary-book-cover")
            .getBoundingClientRect();
          const caption = current
            .querySelector(".vocabulary-current-book-info > small")
            .getBoundingClientRect();
          const title = current
            .querySelector(".vocabulary-current-book-info > strong")
            .getBoundingClientRect();
          if (new Set(styles).size !== 1) throw Error(JSON.stringify(styles));
          return (
            new Set(styles).size === 1 &&
            Math.abs(cover.top - caption.top) < 1 &&
            Math.abs(cover.bottom - title.bottom) < 1 &&
            cover.left > title.right
          );
        }),
      );
      await page.locator('.vocabulary-book[data-book="cet6"]').click();
      assert.equal(await page.locator(".vocabulary-row p").count(), 0);
      assert(await page.locator(".vocabulary-book-back").isVisible());
      assert.equal(
        await page.locator(".vocabulary-use-book.primary").count(),
        0,
      );
      await page.locator(".vocabulary-book-back").click();
      const initialEstimate = await page
        .locator(".vocabulary-learning-estimate")
        .innerText();
      assert(/预计还需约 \d+ 个学习日/.test(initialEstimate));
      assert.deepEqual(
        await page.locator(".vocabulary-plan-counts strong").allTextContents(),
        ["3 / 4", "0", "0"],
      );
      assert.deepEqual(
        await page
          .locator(".vocabulary-distribution-legend > span")
          .allTextContents()
          .then((labels) => labels.slice(0, 3)),
        ["熟悉 1", "一般 2", "不熟 1"],
      );
      assert(
        await page.locator(".vocabulary-book-selection").evaluate((panel) => {
          const selectors = [
            ".vocabulary-global-search",
            ".vocabulary-controls",
            ".vocabulary-plan-counts",
            ".vocabulary-current-book",
            ".vocabulary-books",
          ];
          const rects = selectors.map((selector) =>
            panel.querySelector(selector).getBoundingClientRect(),
          );
          return (
            rects.every((rect, i) => !i || rect.top >= rects[i - 1].bottom) &&
            panel.scrollWidth <= panel.clientWidth + 1
          );
        }),
      );
      const search = page.locator(".vocabulary-global-search input");
      const outside = await page.evaluate(
        () =>
          WorkTimeApp.data.vocabularyCatalog.entries.find(
            (entry) => !entry.books.includes("daily"),
          ).word,
      );
      await search.fill(outside);
      assert.equal(
        await page.locator(".vocabulary-books-overview").isVisible(),
        false,
      );
      const words = await page
        .locator(".vocabulary-word-open strong")
        .allTextContents();
      assert(
        words.includes(outside),
        "Search includes words outside current book",
      );
      assert.equal(new Set(words).size, words.length);
      await page.locator(".vocabulary-word-open").first().click();
      await page.locator(".vocabulary-word-back").click();
      assert.equal(await search.inputValue(), outside);
      if (width === 1440) {
        await search.fill("a");
        await page
          .getByRole("button", { name: "显示更多", exact: true })
          .click();
        assert.equal(await page.locator(".vocabulary-word-open").count(), 80);
        await page.locator(".vocabulary-word-open").last().click();
        await page.locator(".vocabulary-word-back").click();
        assert.equal(await search.inputValue(), "a");
        assert.equal(await page.locator(".vocabulary-word-open").count(), 80);
        const chinese = await page.evaluate(
          () =>
            WorkTimeApp.data.vocabularyCatalog.entries
              .find((entry) => /[\u4e00-\u9fff]/.test(entry.zh))
              .zh.match(/[\u4e00-\u9fff]+/)[0],
        );
        await search.fill(chinese);
        assert((await page.locator(".vocabulary-word-open").count()) > 0);
      }
      await search.fill("zzzz_no_matching_word_zzzz");
      assert.equal(
        await page
          .locator(".vocabulary-global-search .vocabulary-list")
          .innerText(),
        "没有匹配的词条",
      );
      await search.fill("");
      assert.equal(
        await page.locator(".vocabulary-books-overview").isVisible(),
        true,
      );
      await page.evaluate(() => {
        window.modeSelectionNodes = [
          ...document.querySelectorAll(
            ".vocabulary-book-selection, .vocabulary-book-selection *",
          ),
        ];
        window.modeSelectionScroll = document.querySelector(
          ".vocabulary-book-selection",
        ).scrollTop;
      });
      await choose(page, "练习方式", "spelling");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.mode ===
          "spelling",
      );
      await page.waitForFunction(
        () => !document.querySelector(".vocabulary-book-selection").inert,
      );
      assert(
        await page.evaluate(() => {
          const panel = document.querySelector(".vocabulary-book-selection");
          const trigger = panel.querySelector(
            '[data-setting-field="mode"] .shared-select-trigger',
          );
          const box = trigger.getBoundingClientRect();
          const style = getComputedStyle(trigger);
          const label = trigger.querySelector(".button-label");
          const text = label.getBoundingClientRect();
          const icon = trigger
            .querySelector(".ui-icon")
            .getBoundingClientRect();
          return (
            window.modeSelectionNodes.every((node) => node.isConnected) &&
            panel.scrollTop === window.modeSelectionScroll &&
            getComputedStyle(label).textAlign === "center" &&
            Math.abs(
              text.left -
                box.left -
                parseFloat(style.borderLeftWidth) -
                parseFloat(style.paddingLeft),
            ) < 1 &&
            Math.abs(text.right - icon.left + parseFloat(style.columnGap)) < 1
          );
        }),
        "Mode switches preserve page nodes and center text before the arrow",
      );
      assert.deepEqual(
        await page.locator(".vocabulary-plan-counts strong").allTextContents(),
        ["0 / 0", "3", "0"],
      );
      const freshIds = () =>
        page.evaluate(() =>
          WorkTimeApp.services.vocabularyEngine
            .queue(
              WorkTimeApp.services.vocabularyStorage.read(),
              WorkTimeApp.data.vocabularyCatalog.entries,
            )
            .fresh.map((entry) => entry.id),
        );
      const orderedIds = await freshIds();
      const cardsBeforeOrder = await page.evaluate(() =>
        JSON.stringify(WorkTimeApp.services.vocabularyStorage.read().cards),
      );
      const orderSwitch = page.getByRole("switch", { name: "新词顺序" });
      await page.evaluate(() => {
        window.orderSelectionNodes = [
          ...document.querySelectorAll(
            ".vocabulary-book-selection, .vocabulary-book-selection *",
          ),
        ];
        window.orderSelectionScroll = document.querySelector(
          ".vocabulary-book-selection",
        ).scrollTop;
      });
      await orderSwitch.click();
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.wordOrder ===
          "random",
      );
      await page.waitForFunction(
        () =>
          !document.querySelector(".vocabulary-book-selection").inert &&
          document
            .querySelector(".vocabulary-order-switch")
            .getAttribute("aria-checked") === "true",
      );
      const randomIds = await freshIds();
      assert.notDeepEqual(randomIds, orderedIds);
      assert.deepEqual(
        await freshIds(),
        randomIds,
        "Random allocation stays stable on rendering",
      );
      assert.equal(await orderSwitch.getAttribute("aria-checked"), "true");
      assert(
        await page.evaluate(() => {
          const panel = document.querySelector(".vocabulary-book-selection");
          const order = panel.querySelector(".vocabulary-order-switch");
          const title = panel
            .querySelector(".vocabulary-current-book-info > strong")
            .getBoundingClientRect();
          const style = getComputedStyle(order);
          return (
            window.orderSelectionNodes.every((node) => node.isConnected) &&
            panel.scrollTop === window.orderSelectionScroll &&
            document.activeElement === order &&
            style.borderRadius === "6px" &&
            Math.abs(order.getBoundingClientRect().bottom - title.bottom) < 1
          );
        }),
        "Switching updates the existing page in place and preserves scroll and focus",
      );
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify(WorkTimeApp.services.vocabularyStorage.read().cards),
        ),
        cardsBeforeOrder,
      );
      await page.locator('.vocabulary-nav-item[data-page="learning"]').click();
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.vocabularyStorage.read().draft.id,
        ),
        randomIds[0],
      );
      await books();
      await orderSwitch.click();
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.wordOrder ===
            "ordered" &&
          !document.querySelector(".vocabulary-book-selection").inert,
      );
      assert.deepEqual(await freshIds(), orderedIds);
      if (width === 1440) {
        await page.evaluate(() => {
          window.orderOriginalSave =
            WorkTimeApp.services.vocabularyStorage.save;
          WorkTimeApp.services.vocabularyStorage.save = async () => {
            throw Error("Simulated order save failure");
          };
        });
        await orderSwitch.click();
        await page.locator(".vocabulary-save-status:not([hidden])").waitFor();
        assert.equal(await orderSwitch.getAttribute("aria-checked"), "false");
        assert.deepEqual(await freshIds(), orderedIds);
        await page.evaluate(() => {
          WorkTimeApp.services.vocabularyStorage.save =
            window.orderOriginalSave;
        });
        await page.getByRole("button", { name: "重试", exact: true }).click();
        await page.waitForFunction(
          () =>
            WorkTimeApp.services.vocabularyStorage.read().settings.wordOrder ===
            "random",
        );
        await orderSwitch.click();
        await page.waitForFunction(
          () =>
            WorkTimeApp.services.vocabularyStorage.read().settings.wordOrder ===
              "ordered" &&
            !document.querySelector(".vocabulary-book-selection").inert,
        );
      }
      const goal = page.getByRole("spinbutton", { name: "每日学习量" });
      await goal.fill("2");
      await goal.press("Tab");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.dailyTotal ===
            2 &&
          !document.querySelector('.vocabulary-controls input[type="number"]')
            .disabled,
      );
      assert.notEqual(
        await page.locator(".vocabulary-learning-estimate").innerText(),
        initialEstimate,
      );
      assert.equal(
        await page.locator(".vocabulary-plan-counts strong").nth(1).innerText(),
        "2",
      );
      await choose(page, "练习方式", "recall");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.mode ===
          "recall",
      );
      await page.locator('.vocabulary-nav-item[data-page="learning"]').click();
      await page.locator('[data-action="reveal"]').click();
      await page.locator('[data-grade="3"]:not(:disabled)').click();
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage
            .read()
            .logs.filter(
              (log) =>
                WorkTimeApp.services.vocabularyEngine.day(log.at) ===
                WorkTimeApp.services.vocabularyEngine.day(Date.now()),
            ).length === 1,
      );
      await books();
      assert.deepEqual(
        await page.locator(".vocabulary-plan-counts strong").allTextContents(),
        ["1 / 3", "0", "0"],
      );
      await goal.fill("1");
      await goal.press("Tab");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.dailyTotal ===
            1 &&
          !document.querySelector('.vocabulary-controls input[type="number"]')
            .disabled,
      );
      await page.locator('.vocabulary-nav-item[data-page="learning"]').click();
      await page.locator(".vocabulary-hero").waitFor();
      assert.equal(
        await page.locator(".vocabulary-review-badge").innerText(),
        "0",
      );
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.vocabularyStorage.read().draft,
        ),
        null,
      );
      const preferences = () =>
        page.locator('.vocabulary-nav-item[data-page="preferences"]').click();
      const accent = page.locator('[data-setting="accent"]');
      await preferences();
      await accent.click();
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.accent ===
          "uk",
      );
      await books();
      await preferences();
      assert.equal(await accent.getAttribute("aria-checked"), "false");
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await preferences();
      assert.equal(await accent.getAttribute("aria-checked"), "false");
      await books();
      assert.equal(await goal.inputValue(), "1");
      assert.deepEqual(
        await page.locator(".vocabulary-plan-counts strong").allTextContents(),
        ["0 / 3", "0", "0"],
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
        assert(
          await page
            .locator(".vocabulary-book-selection")
            .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
        );
      }
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveTheme("slate");
      });
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "slate",
      );
      if (process.argv.includes("--screenshot")) {
        fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
        await page.locator("#vocabularyPanel").screenshot({
          path: path.join(root, `artifacts/vocabulary-selection-${width}.png`),
        });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Vocabulary selection: layout at 1440/390/320, global search and return, mode/total persistence, overdue limits and completion passed.",
    );
  } finally {
    await browser.close();
    await server?.close();
  }
}
module.exports = { verifySelection: main };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
