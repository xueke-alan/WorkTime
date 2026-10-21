"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const output = path.resolve("test-results/button-layout");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"]) {
      const context = await browser.newContext({
        locale: language,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [];
      const checked = new Set();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      const backup = await page.evaluate((locale) => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.preferences.language = locale;
        state.settings.configured = true;
        return JSON.stringify(
          WorkTimeApp.domain.validation.validateBackup(state),
        );
      }, language);
      await page.locator("#backupFile").setInputFiles({
        name: "buttons.json",
        mimeType: "application/json",
        buffer: Buffer.from(backup),
      });
      await page.locator("#confirmRestore").click();
      for (const width of [320, 390, 1440, 1920, 2560]) {
        await page.setViewportSize({ width, height: 1080 });
        async function audit(scene) {
          await page.evaluate(() => document.fonts.ready);
          const result = await page.evaluate(() => {
            const issues = [];
            if (document.documentElement.scrollWidth > innerWidth + 1)
              issues.push("page overflows viewport");
            const checked = [];
            const hosts = [
              ...document.querySelectorAll("button.ui-button"),
              document.querySelector("#importOpen .import-main"),
            ];
            for (const host of hosts) {
              if (!host.checkVisibility({ checkVisibilityCSS: true })) continue;
              const [icon, label] = host.children;
              if (
                host.children.length !== 2 ||
                !icon.matches(".ui-icon,.oa-icon-slot") ||
                !label.matches(".button-label,#importOpen .import-main > span")
              )
                continue;
              if (!label.checkVisibility({ opacityProperty: true })) continue;
              const id = host.id || host.parentElement.id;
              checked.push(id);
              const style = getComputedStyle(host);
              const box = host.getBoundingClientRect();
              if (box.left < -1 || box.right > innerWidth + 1)
                issues.push(id + ": button outside viewport");
              const left =
                box.left +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.paddingLeft);
              const right =
                box.right -
                parseFloat(style.borderRightWidth) -
                parseFloat(style.paddingRight);
              const iconBox = icon.getBoundingClientRect();
              const labelBox = label.getBoundingClientRect();
              const labelLeft = iconBox.right + parseFloat(style.columnGap);
              const inset =
                parseFloat(
                  getComputedStyle(document.documentElement).fontSize,
                ) * 0.714286;
              if (Math.abs(parseFloat(style.paddingLeft) - inset) > 1)
                issues.push(id + ": inconsistent icon inset");
              if (Math.abs(iconBox.left - left) > 1)
                issues.push(id + ": icon moved away from left inset");
              if (host.matches("#importOpen .import-main")) {
                const button = host.parentElement;
                const buttonLeft =
                  button.getBoundingClientRect().left +
                  parseFloat(getComputedStyle(button).borderLeftWidth);
                if (Math.abs(iconBox.left - buttonLeft - inset) > 1)
                  issues.push(id + ": OA icon moved away from button edge");
              }
              if (
                Math.abs(labelBox.left - labelLeft) > 1 ||
                Math.abs(labelBox.right - right) > 1
              )
                issues.push(id + ": label does not fill remaining space");
              const range = document.createRange();
              range.selectNodeContents(label);
              const text = range.getBoundingClientRect();
              if (
                Math.abs((text.left + text.right - labelLeft - right) / 2) > 1
              )
                issues.push(id + ": text is not centered in remaining space");
              if (text.left < labelLeft - 1 || text.right > right + 1)
                issues.push(id + ": text overflows its slot");
            }
            return { issues, checked };
          });
          assert.deepEqual(result.issues, [], `${language}/${width}/${scene}`);
          for (const id of result.checked) checked.add(id);
        }
        await audit("day");
        await page.locator("#dayLeaveToggle").click();
        await audit("leave");
        await page.locator("#dayLeave").fill("1");
        await page.locator("#dayLeaveDone").click();
        await audit("leave-selected");
        await page.locator("#batchToggle").click();
        await audit("batch-disabled");
        await page.locator("#batchCancel").click();
        for (const [open, close] of [
          ["#settingsOpen", "#workSettingsCancel"],
          ["#personalSettingsOpen", "#profileSettingsCancel"],
          ["#pageSettingsOpen", "#personalSettingsCancel"],
        ]) {
          await page.locator(open).click();
          await audit(open);
          if (
            language === "zh-CN" &&
            width === 1440 &&
            open === "#pageSettingsOpen"
          )
            await page.screenshot({ path: path.join(output, "settings.png") });
          await page.locator(close).click();
        }
        await page.locator("#importOpen").click();
        await audit("import-disabled-and-return-label");
        await page.locator("#pasteText").fill("10/19\n周一\n08:00\n19:30");
        await page.waitForFunction(
          () => !document.querySelector("#commitImport").disabled,
        );
        await audit("import-enabled");
        const shortcut = page.locator("#oaShortcut");
        await shortcut.scrollIntoViewIfNeeded();
        await shortcut.hover();
        await page.mouse.down();
        try {
          await audit("oa-holding");
        } finally {
          // Release outside the control to cancel without opening the OA site.
          await page.mouse.move(0, 0);
          await page.mouse.up();
        }
        if (language === "zh-CN" && width === 1440)
          await page.screenshot({ path: path.join(output, "import.png") });
        await page.locator("#pasteText").fill("");
        await page.locator("#importOpen").click();
      }
      for (const id of [
        "importOpen",
        "oaShortcut",
        "commitImport",
        "batchReset",
        "batchCancel",
        "batchSave",
        "dayLeaveFull",
        "dayLeaveDone",
        "recoveryOpen",
        "workSettingsCancel",
        "profileSettingsCancel",
        "personalSettingsCancel",
      ])
        assert.ok(checked.has(id), language + ": missing coverage for " + id);
      assert.deepEqual(errors, [], language);
      await context.close();
      console.log(
        language + ": button geometry verified at five viewport widths.",
      );
    }
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
