"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label))
  throw Error("Supply a unique lowercase output label");
const output = path.join(
  root,
  "test-results",
  "date-controls-" + label + ".json",
);
if (fs.existsSync(output)) throw Error("Refusing to replace existing evidence");
async function main() {
  const browser = await chromium.launch({
      channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    samples = [];
  try {
    for (const width of [390, 1600, 2250]) {
      const context = await browser.newContext({
        viewport: { width, height: 1244 },
        reducedMotion: "reduce",
        timezoneId: "Asia/Shanghai",
      });
      try {
        await context.route(/^https?:/, (route) => route.abort());
        const page = await context.newPage();
        await page.clock.install({
          time: new Date("2026-10-04T12:00:00+08:00"),
        });
        await page.goto(pathToFileURL(path.join(root, "index.html")).href);
        await page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        await page.evaluate(() => document.fonts.ready);
        for (const theme of [
          "green",
          "blue",
          "purple",
          "orange",
          "rose",
          "slate",
        ]) {
          await page.locator("#pageSettingsOpen").click();
          await page
            .locator(`.theme-card:has(input[value="${theme}"])`)
            .click();
          await page.locator("#pageSettingsOpen").click();
          await page.locator("#date-tab-history").click();
          for (const view of ["history", "festivals", "almanac"]) {
            await page.locator("#date-context-" + view).click();
            for (const state of ["normal", "hover", "focus"]) {
              await page.mouse.move(0, 0);
              await page
                .locator("#date-context-" + view)
                .evaluate((button) => button.blur());
              if (state === "hover")
                await page.locator("#date-context-" + view).hover();
              if (state === "focus")
                await page.locator("#date-context-" + view).focus();
              await page.clock.fastForward(500);
              const controls = await page.evaluate(() => {
                const header = document
                  .querySelector(".date-context-header")
                  .getBoundingClientRect();
                return [
                  ...document.querySelectorAll(
                    ".date-context-switch button,.notification-tabs button",
                  ),
                ].map((button) => {
                  const box = button.getBoundingClientRect(),
                    styles = getComputedStyle(button);
                  return {
                    id: button.id,
                    selected: button.getAttribute("aria-selected"),
                    rect: [
                      box.x - header.x,
                      box.y - header.y,
                      box.width,
                      box.height,
                    ].map((n) => Math.round(n * 1000) / 1000),
                    styles: Object.fromEntries(
                      [
                        "display",
                        "align-items",
                        "justify-content",
                        "gap",
                        "font-family",
                        "font-size",
                        "font-weight",
                        "line-height",
                        "color",
                        "background-color",
                        "border-width",
                        "border-radius",
                        "padding",
                        "height",
                        "min-height",
                        "max-height",
                        "min-width",
                        "box-shadow",
                        "outline",
                        "outline-offset",
                        "transition-duration",
                      ].map((key) => [key, styles.getPropertyValue(key)]),
                    ),
                  };
                });
              });
              samples.push({ width, theme, view, state, controls });
            }
          }
        }
      } finally {
        await context.close();
      }
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(samples, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      `Captured ${samples.length} theme/width/view/interaction samples in ${path.relative(root, output)}.`,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
