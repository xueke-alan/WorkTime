"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) || root,
);
const output = path.join(root, ".cache/typing-layout");
async function verify() {
  const browser = await chromium.launch({ headless: true });
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  fs.mkdirSync(output, { recursive: true });
  const checked = [];
  try {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.stack));
      await page.goto(
        (server?.url || pathToFileURL(path.join(site, "index.html")).href) +
          "#dev",
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async () => {
        const S = WorkTimeApp.services.typingStorage,
          data = S.defaults();
        data.unlocked = { en: 600, zh: 100 };
        data.settings.language = "zh"; // Legacy preference must open English courses.
        data.lessons["zh-001"] = { stars: 5, speed: 40, accuracy: 100 };
        data.articles = Array.from({ length: 100 }, (_, i) => ({
          id: crypto.randomUUID(),
          title: `Saved article ${i + 1} · A longer title for practice and review`,
          language: i % 2 ? "zh" : "en",
          text:
            i % 2
              ? "春天来了，我们沿着河边的小路散步。"
              : "A calm morning gives us time to read and practice.",
        }));
        data.attempts = Array.from({ length: 210 }, (_, i) => ({
          id: crypto.randomUUID(),
          mode: "custom",
          language: i % 2 ? "zh" : "en",
          text: "A calm morning.",
          lessonId: null,
          goal: 25,
          limit: 0,
          elapsed: 60000,
          speed: 30 + (i % 25),
          accuracy: 95 + (i % 5),
          stars: 2,
          date: "2026-11-22",
          ...(i >= 10
            ? { events: [{ t: 0, from: 0, insert: "A calm morning." }] }
            : {}),
        }));
        for (let i = 0; i < 28; i++) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          data.daily[key] = i * 60000;
        }
        data.weak.en = Object.fromEntries(
          Array.from("abcdefghijklmnopqrstuvwxyz").map((key, i) => [
            key,
            i + 1,
          ]),
        );
        data.weak.zh = Object.fromEntries(
          Array.from(
            "春天来了我们沿着河边的小路散步看见花园里许多美丽颜色不同叶子",
          ).map((key, i) => [key, i + 1]),
        );
        const saved = await S.save(data);
        if (!saved.persisted) throw saved.error;
      });
      if (!(await page.locator("#typingOpen").isVisible()))
        await page.locator("#date-tab-tools").click();
      await page.locator("#typingOpen").click();
      await page.locator('#typingDialog[data-state="open"]').waitFor();
      async function fit(name) {
        await page.waitForTimeout(80);
        const result = await page
          .locator(".typing-content")
          .evaluate((content) => {
            const rect = content.getBoundingClientRect();
            const header = document.querySelector(".typing-toolbar"),
              bounds = header.getBoundingClientRect();
            const headerClipped = [
              ...header.querySelectorAll("button,select,.typing-status"),
            ]
              .filter((el) => el.getClientRects().length)
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.left < bounds.left ||
                  r.right > bounds.right ||
                  r.top < bounds.top ||
                  r.bottom > bounds.bottom
                );
              })
              .map((el) => el.id || el.className);
            const controlBar = document.querySelector(".typing-section-bar"),
              controlBounds = controlBar.getBoundingClientRect();
            for (const el of controlBar.querySelectorAll(
              "button,select,.typing-status",
            )) {
              if (!el.getClientRects().length) continue;
              const r = el.getBoundingClientRect();
              if (
                r.left < controlBounds.left ||
                r.right > controlBounds.right ||
                r.top < controlBounds.top ||
                r.bottom > controlBounds.bottom
              )
                headerClipped.push(el.className);
            }
            const overflow = [
              ...content.querySelectorAll(
                ".typing-card,.typing-chapters,.typing-lesson-grid,.typing-history,.typing-article-list,.typing-guidance",
              ),
            ]
              .filter((el) => !el.hidden && el.getClientRects().length)
              .filter(
                (el) =>
                  el.scrollHeight > el.clientHeight + 2 ||
                  el.scrollWidth > el.clientWidth + 2,
              )
              .map((el) => ({
                name: el.className,
                height: el.clientHeight,
                scrollHeight: el.scrollHeight,
                width: el.clientWidth,
                scrollWidth: el.scrollWidth,
              }));
            const clipped = [
              ...content.querySelectorAll("button,input,select,textarea"),
            ]
              .filter(
                (el) =>
                  !el.hidden &&
                  el.getClientRects().length &&
                  !el.closest(".typing-text"),
              )
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.bottom > rect.bottom + 2 ||
                  r.top < rect.top - 2 ||
                  r.right > rect.right + 2 ||
                  r.left < rect.left - 2
                );
              })
              .map((el) => el.className || el.tagName);
            return {
              view: content.dataset.view,
              height: content.clientHeight,
              scrollHeight: content.scrollHeight,
              width: content.clientWidth,
              scrollWidth: content.scrollWidth,
              overflow,
              clipped: [...clipped, ...headerClipped],
            };
          });
        const file = `${viewport.width}x${viewport.height}-${name}.png`;
        if (
          process.argv.includes("--screenshot") ||
          result.scrollHeight > result.height + 2 ||
          result.overflow.length ||
          result.clipped.length
        )
          await page.screenshot({ path: path.join(output, file) });
        assert(
          result.scrollHeight <= result.height + 2 &&
            result.scrollWidth <= result.width + 2 &&
            !result.overflow.length &&
            !result.clipped.length,
          file + ": " + JSON.stringify(result),
        );
        checked.push(`${viewport.width}×${viewport.height} ${name}`);
      }
      assert.equal(await page.locator(".typing-placement").count(), 0);
      assert.equal(
        await page.locator("#typingDialog > .typing-status").count(),
        0,
        "No separate footer",
      );
      assert.equal(
        await page.locator(".typing-toolbar > #typingExitButton").count(),
        1,
      );
      assert.equal(
        await page.locator(".typing-toolbar .typing-navigation").count(),
        0,
      );
      assert.equal(await page.locator(".typing-status").count(), 0);
      assert.equal(await page.locator(".typing-navigation select").count(), 0);
      assert(await page.locator(".typing-notice").isHidden());
      assert.equal(
        await page.locator(".typing-hero h3,.typing-hero p").count(),
        0,
      );
      assert.equal(
        await page.locator(".typing-summary strong").first().textContent(),
        "0 / 600",
      );
      assert.deepEqual(
        await page.evaluate(() => Object.keys(WorkTimeApp.data.typingCatalog)),
        ["en"],
      );
      assert.equal(
        await page.locator("#typingExitButton").getAttribute("aria-label"),
        await page.evaluate(() =>
          WorkTimeApp.i18n.t("workspace.returnCalendar"),
        ),
      );
      assert.equal(
        await page
          .locator(".typing-hero .typing-section-bar .typing-navigation")
          .count(),
        1,
        "Navigation belongs to the overview banner",
      );
      for (const language of ["en"]) {
        for (const [index, name] of [
          "courses",
          "practice",
          "challenges",
          "statistics",
        ].entries()) {
          await page
            .locator(".typing-navigation .typing-button")
            .nth(index)
            .click();
          if (name === "courses")
            await page.locator(".typing-lesson").first().waitFor();
          await fit(language + "-" + name);
          if (name === "practice" || name === "statistics") {
            const list = page.locator(
              name === "practice" ? ".typing-article-list" : ".typing-history",
            );
            const previous = await list.innerText();
            await page
              .locator(
                name === "practice"
                  ? ".typing-article-library .typing-pagination button"
                  : ".typing-history-card .typing-pagination button",
              )
              .last()
              .click();
            assert.notEqual(
              await list.innerText(),
              previous,
              name + " changes page",
            );
            await fit(language + "-" + name + "-page2");
          }
        }
        await page.locator(".typing-history-row button").first().click();
        await fit(language + "-replay");
        await page.locator(".typing-navigation .typing-button").first().click();
        await page.locator(".typing-lesson").first().click();
        await fit(language + "-session");
        const layout = await page.evaluate(() => {
          const bounds = (selector) =>
            document.querySelector(selector).getBoundingClientRect().toJSON();
          return {
            toolbar: bounds(".typing-toolbar"),
            toolbarPadding: parseFloat(
              getComputedStyle(document.querySelector(".typing-toolbar"))
                .paddingTop,
            ),
            rootFontSize: parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            ),
            writing: bounds(".typing-writing"),
            rail: bounds(".typing-session-rail"),
            text: bounds(".typing-text"),
            guidance: bounds(".typing-guidance"),
            input: bounds("#typingInput"),
          };
        });
        assert.equal(
          layout.toolbarPadding,
          layout.rootFontSize,
          "Use the shared workspace toolbar height",
        );
        assert(
          layout.rail.left >= layout.writing.right,
          "Controls sit to the right",
        );
        assert(layout.input.width <= 2, "No separate large input box");
        if (language === "en") {
          assert(
            layout.text.bottom <= layout.guidance.top,
            "Text sits above keyboard",
          );
          assert.equal(
            await page
              .locator(".typing-character-cards > span:not([hidden])")
              .count(),
            7,
          );
          assert.equal(
            await page.locator(".typing-hand-finger.is-next").count(),
            1,
          );
          const target = await page.locator(".typing-text").textContent();
          await page.locator("#typingInput").fill(target.slice(0, 10));
          assert.equal(
            await page
              .locator(".typing-character-cards .is-cursor")
              .textContent(),
            target[10],
          );
          await page.locator("#typingInput").press("Backspace");
          assert.equal(
            await page
              .locator(".typing-character-cards .is-cursor")
              .textContent(),
            target[9],
          );
        }
        await page
          .locator(".typing-session-header .typing-button")
          .first()
          .click();
        await fit(language + "-paused");
        await page.locator(".typing-pause button").click();
        const text = await page.locator(".typing-text").textContent();
        await page.locator("#typingInput").fill(Array.from(text)[0]);
        await page.waitForTimeout(80);
        await page.locator("#typingInput").fill(text);
        await page.locator(".typing-result").waitFor();
        await fit(language + "-result");
      }
      // Long localized labels and alternate themes must retain the desktop fit.
      for (const locale of ["en", "ja", "ko", "zh-TW", "zh-HK"]) {
        await page.evaluate(async (lang) => {
          await WorkTimeApp.i18n.setLanguage(lang);
          document.documentElement.dataset.theme = "blue";
        }, locale);
        await page.locator(".typing-navigation .typing-button").nth(3).click();
        await fit(locale + "-statistics");
      }
      assert.deepEqual(errors, []);
      if (viewport.width === 1920) {
        await page.locator(".typing-navigation .typing-button").first().click();
        await page.locator(".typing-chapter").nth(6).click();
        await page.locator(".typing-lesson").first().click();
        assert.equal(
          await page.locator(".typing-key.is-next").count(),
          2,
          "Uppercase highlights the key and opposite Shift",
        );
        assert.equal(
          await page.locator(".typing-hand-finger.is-next").count(),
          2,
          "Both hands guide uppercase input",
        );
        await page.locator("#typingInput").pressSequentially("U");
        assert.equal(
          await page.locator(".typing-hand-finger.is-next").count(),
          1,
        );
        await page.locator(".typing-navigation .typing-button").first().click();
        await page.locator(".typing-chapter").first().click();
        await page.locator(".typing-lesson").first().click();
        for (const size of [
          { width: 1366, height: 768 },
          { width: 1024, height: 768 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(size);
          await page.waitForTimeout(150);
          const overflow = await page
            .locator("#typingDialog")
            .evaluate((dialog) => {
              const bounds = dialog.getBoundingClientRect();
              return [
                ...dialog.querySelectorAll(
                  "button,select,.typing-keyboard,.typing-text",
                ),
              ]
                .filter((el) => el.getClientRects().length)
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.left < bounds.left - 2 || r.right > bounds.right + 2;
                })
                .map((el) => el.className);
            });
          assert.deepEqual(
            overflow,
            [],
            "Responsive content fits at " + size.width,
          );
          await page.screenshot({
            path: path.join(
              output,
              `${size.width}x${size.height}-responsive-session.png`,
            ),
          });
          await page
            .locator(".typing-navigation .typing-button")
            .first()
            .click();
          const bannerFits = await page
            .locator(".typing-hero")
            .evaluate((banner) => {
              const bounds = banner.getBoundingClientRect();
              return [...banner.querySelectorAll("button,input")].every(
                (control) => {
                  const rect = control.getBoundingClientRect();
                  return (
                    rect.left >= bounds.left &&
                    rect.right <= bounds.right &&
                    rect.top >= bounds.top &&
                    rect.bottom <= bounds.bottom
                  );
                },
              );
            });
          assert(bannerFits, "Overview controls fit at " + size.width);
          await page.screenshot({
            path: path.join(
              output,
              `${size.width}x${size.height}-responsive-courses.png`,
            ),
          });
          await page.locator(".typing-lesson").first().click();
        }
      }
      await context.close();
    }
    console.log(
      `Typing desktop layouts: ${checked.length} populated pages verified at 1920×1080 and 2560×1440; no outer overflow or clipped controls; pagination, six locales, and blue theme passed.`,
    );
  } finally {
    await browser.close();
    await server?.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
