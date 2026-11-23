"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const site = path.resolve(process.argv[2] || path.join(__dirname, ".."));
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.addInitScript(() => {
        localStorage.setItem(
          "worktime.vocabulary.audio-settings",
          JSON.stringify({ enabled: false }),
        );
      });
      await context.route(/^https?:\/\//u, (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(site, "index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const expected = await page.evaluate(async () => {
        await WorkTimeApp.services.vocabularyIdle.load();
        const entries = WorkTimeApp.data.vocabularyCatalog.entries;
        const bank = entries.find((entry) => entry.id === "bank");
        bank.books = ["daily"];
        entries.splice(0, entries.length, bank);
        globalThis.__exampleAudio = [];
        WorkTimeApp.services.vocabularySpeech.play = async (entry) => {
          globalThis.__exampleAudio.push(entry.word);
          return true;
        };
        return bank.examples.map((example) => ({
          en: example.en,
          zh: example.zh,
        }));
      });
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page
        .locator("[data-action=reveal]")
        .click({ position: { x: 10, y: 250 } });
      await page.locator(".vocabulary-example").first().waitFor();
      await page.evaluate(() => {
        WorkTimeApp.services.vocabularySpeech.recordBatch({
          count: 0,
          milliseconds: 0,
          cold: false,
          lag: 0,
        });
      });
      assert.equal(
        await page.locator(".vocabulary-speech-status").textContent(),
        await page.evaluate(() =>
          WorkTimeApp.i18n.t(
            "vocabulary." + WorkTimeApp.services.vocabularySpeech.status,
          ),
        ),
        "Speech notifications read the current status instead of undefined",
      );
      assert.equal(
        await page.locator(".vocabulary-speech-status").isVisible(),
        false,
        "Idle speech status stays hidden",
      );
      assert.equal(
        await page.locator(".vocabulary-example").count(),
        expected.length,
      );
      assert(
        expected.length >= 4,
        "A common polysemous word has additional examples",
      );
      const actual = await page
        .locator(".vocabulary-example")
        .evaluateAll((items) =>
          items.map((item) => ({
            en: item.querySelector("p").textContent,
            zh: item.querySelector(".vocabulary-example-translation")
              .textContent,
          })),
        );
      assert.deepEqual(
        actual,
        expected,
        "Every complete example and translation is displayed without truncation",
      );
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector("#vocabularyPage");
        const header = document.querySelector(".vocabulary-study-header");
        const meaning = header.querySelector(".vocabulary-meaning");
        const before = [header, meaning].map(
          (element) => element.getBoundingClientRect().top,
        );
        panel.scrollTop = panel.scrollHeight;
        return {
          before,
          after: [header, meaning].map(
            (element) => element.getBoundingClientRect().top,
          ),
          scrolled: panel.scrollTop,
          icons: [
            ...document.querySelectorAll(".vocabulary-example-play"),
          ].every(
            (button) =>
              button.parentElement.tagName === "P" &&
              button === button.parentElement.firstChild &&
              getComputedStyle(button).verticalAlign === "middle" &&
              button.querySelector("svg").getBoundingClientRect().width ===
                15 &&
              button.innerHTML ===
                document.querySelector(".vocabulary-pronunciation-play svg")
                  .outerHTML,
          ),
        };
      });
      assert(layout.scrolled > 0, "Detailed content has its own scroll area");
      assert.deepEqual(
        layout.after,
        layout.before,
        "Word and meaning stay fixed",
      );
      assert(
        layout.icons,
        "Each sentence starts with a smaller centered speaker icon",
      );
      await page.evaluate(() => {
        globalThis.__exampleAudio = [];
      });
      for (let index = 0; index < expected.length; index++) {
        await page.locator(".vocabulary-example-play").nth(index).click();
        await page.waitForFunction(
          () => !document.querySelector(".vocabulary-example-play")?.disabled,
        );
      }
      assert.deepEqual(
        await page.evaluate(() => globalThis.__exampleAudio),
        expected.map((example) => example.en),
      );
      assert(
        await page
          .locator(".vocabulary-example")
          .evaluateAll((items) =>
            items.every((item) => item.scrollWidth <= item.clientWidth + 2),
          ),
        "Examples wrap within the mobile and desktop cards",
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Offline vocabulary examples: full bilingual lists, exact playback text and desktop/mobile wrapping passed.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
