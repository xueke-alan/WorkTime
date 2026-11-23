"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function choose(page, label, value) {
  const trigger = page
    .getByRole("button", { name: label })
    .filter({ has: page.locator(".language-chevron") });
  const id = await trigger.getAttribute("aria-controls");
  await trigger.click();
  const field = trigger.locator("..");
  const name = await field
    .locator("select")
    .evaluate(
      (select, value) =>
        [...select.options].find((o) => o.value === value).textContent,
      String(value),
    );
  await page
    .locator(`#${id}`)
    .getByRole("option", { name, exact: true })
    .click();
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: "no-preference",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveMotionMode("full");
        await WorkTimeApp.services.vocabularyIdle.load();
        WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
        const S = WorkTimeApp.services.vocabularyStorage;
        const d = S.defaults();
        d.settings.autoRead = false;
        await S.save(d);
      });
      await page.locator("#date-tab-tools").click();
      await page.locator("#vocabularyOpen").click();
      await page.locator(".vocabulary-card").waitFor();
      await page
        .locator('.vocabulary-nav-item[data-page="preferences"]')
        .click();
      await page.locator(".shared-select-trigger").first().waitFor();
      const centeredLabels = await page
        .locator(".vocabulary-preferences .shared-select-trigger")
        .evaluateAll((buttons) =>
          buttons.every((button) => {
            const style = getComputedStyle(button);
            const box = button.getBoundingClientRect();
            const label = button.querySelector(".button-label");
            const textBox = label.getBoundingClientRect();
            const arrow = button
              .querySelector(".ui-icon")
              .getBoundingClientRect();
            const start =
              box.left +
              parseFloat(style.borderLeftWidth) +
              parseFloat(style.paddingLeft);
            const end = arrow.left - parseFloat(style.columnGap);
            return (
              getComputedStyle(label).textAlign === "center" &&
              Math.abs(textBox.left - start) < 1 &&
              Math.abs(textBox.right - end) < 1
            );
          }),
        );
      assert(
        centeredLabels,
        "Select text centers within the area before its arrow",
      );
      const native = page.locator(".vocabulary-preferences select");
      assert.deepEqual(
        await native.nth(1).locator("option").allTextContents(),
        ["自动", "1", "2", "4", "8"],
      );
      assert.deepEqual(
        await native.nth(2).locator("option").allTextContents(),
        ["5 GiB", "15 GiB", "20 GiB", "不限制"],
      );
      const equal = await page.evaluate(() => {
        const widths = (s) =>
          [...document.querySelectorAll(s)].map(
            (e) => e.getBoundingClientRect().width,
          );
        const pairs = [
          widths(".vocabulary-controls > *"),
          widths(".vocabulary-resource-settings > .vocabulary-field"),
          widths(".vocabulary-cache-actions > *"),
        ];
        return {
          pairs,
          heights: [
            ...document.querySelectorAll(
              ".vocabulary-switch-row [role=switch]",
            ),
          ].map((e) => e.getBoundingClientRect().height),
          overflow:
            document.querySelector(".vocabulary-page").scrollWidth >
            document.querySelector(".vocabulary-page").clientWidth,
        };
      });
      assert(equal.pairs.every(([a, b]) => Math.abs(a - b) < 1));
      assert(equal.heights.every((h) => h === 26));
      assert.equal(equal.overflow, false);
      const accent = page.locator('[data-setting="accent"]');
      const handle = await accent.elementHandle();
      await accent.click();
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.accent ===
          "uk",
      );
      assert(
        await handle.evaluate((e) => e.isConnected),
        "Settings save preserves the animated switch node",
      );
      assert.notEqual(
        await accent.evaluate(
          (e) => getComputedStyle(e, "::before").transitionDuration,
        ),
        "0s",
      );
      await page.waitForTimeout(260);
      await accent.focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.vocabularyStorage.read().settings.accent ===
          "us",
      );
      await choose(page, "Worker 池大小", "8");
      await choose(page, "发音缓存上限", Number.MAX_SAFE_INTEGER);
      assert.deepEqual(
        await page.evaluate(() => {
          const s = JSON.parse(
            localStorage.getItem("worktime.vocabulary.audio-settings"),
          );
          return [s.poolSize, s.limit];
        }),
        [8, Number.MAX_SAFE_INTEGER],
      );
      const mode = page.getByRole("button", { name: "练习方式" });
      await mode.focus();
      await page.keyboard.press("ArrowDown");
      await page
        .getByRole("option", { name: "记忆卡", exact: true })
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      assert.equal(await mode.getAttribute("aria-expanded"), "false");
      await page
        .locator("#vocabularyPanel")
        .screenshot({ path: `vocabulary-settings-shared-${width}.png` });
      await mode.click();
      await page
        .locator("#vocabularyPanel")
        .screenshot({ path: `vocabulary-menu-shared-${width}.png` });
      await page.keyboard.press("Escape");
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveMotionMode("reduce");
      });
      assert.equal(
        await accent.evaluate(
          (e) => getComputedStyle(e, "::before").transitionDuration,
        ),
        "0s",
      );
      assert.equal(
        await page
          .locator('[data-setting="autoRead"]')
          .evaluate((e) => getComputedStyle(e, "::before").transitionDuration),
        "0s",
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.vocabularyIdle.load();
      });
      assert.deepEqual(
        await page.evaluate(() => {
          const settings = WorkTimeApp.services.vocabularyIdle.settings;
          return [settings.poolSize, settings.limit];
        }),
        [8, Number.MAX_SAFE_INTEGER],
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Shared vocabulary menus, equal columns, animated switches and unlimited cache persistence passed at 1440/390px.",
    );
  } finally {
    await browser.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { choose };
