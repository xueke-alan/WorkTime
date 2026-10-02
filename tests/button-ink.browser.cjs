"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
const tag = process.argv[2] || "";
assert(!tag || /^[a-z0-9-]+$/.test(tag), "Safe output tag");
const suffix = tag ? `-${tag}` : "";
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const evidence = [];
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [
      390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920, 1921, 2043,
      2044, 2048, 2053, 2054, 2160, 2240, 2319, 2320, 2400, 2560, 3840,
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ["toolbar", "import", "template"]) {
        if (mode === "import") await page.locator("#importOpen").click();
        if (mode === "template") await page.locator("#addTimeTemplate").click();
        await page.evaluate(() => UIAlignment.refresh());
        const selector =
          mode === "toolbar"
            ? "#importOpen .import-main > span, #batchToggle .button-label, #settingsOpen .button-label"
            : mode === "import"
              ? "#importDialog .dialog-foot .button-label"
              : "#timeTemplateDialog .dialog-foot .button-label";
        const values = await page.evaluate((selector) => {
          const measure = () =>
            [...document.querySelectorAll(selector)]
              .filter((label) => label.getClientRects().length)
              .map((label) => {
                const s = getComputedStyle(label),
                  b = label.closest("button"),
                  box = b.getBoundingClientRect();
                const probe = document.createElement("i");
                probe.style.cssText =
                  "display:inline-block;width:0;height:0;vertical-align:baseline";
                label.append(probe);
                const baseline = probe.getBoundingClientRect().top;
                probe.remove();
                const c = document.createElement("canvas").getContext("2d");
                c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
                const ink = c.measureText(label.textContent.trim());
                return {
                  text: label.textContent.trim(),
                  fontSize: parseFloat(s.fontSize),
                  baseline,
                  error:
                    baseline +
                    (ink.actualBoundingBoxDescent -
                      ink.actualBoundingBoxAscent) /
                      2 -
                    box.y -
                    box.height / 2,
                  rect: [box.x, box.y, box.width, box.height],
                  icons: [...b.querySelectorAll("svg")].map((icon) => {
                    const r = icon.getBoundingClientRect();
                    return [r.x, r.y, r.width, r.height];
                  }),
                };
              });
          const beforeStyle = document.createElement("style");
          beforeStyle.textContent =
            "body button.ui-button:not(.notification-tab) .button-label, body #importOpen .import-main > span {translate:none} body #importOpen .import-main > span {line-height:1}";
          document.head.append(beforeStyle);
          const before = measure();
          beforeStyle.remove();
          return { before, after: measure() };
        }, selector);
        assert(values.after.length >= 2, `${mode} labels found`);
        values.after.forEach((value, i) => {
          assert(
            Math.abs(value.error) <= 0.85,
            `${width} DPR ${dpr} ${value.text}: ink error ${value.error}`,
          );
          assert.deepEqual(
            value.rect,
            values.before[i].rect,
            "Button hit area unchanged",
          );
          assert.deepEqual(
            value.icons,
            values.before[i].icons,
            "Icons unchanged",
          );
          assert(
            Math.abs(value.error) < Math.abs(values.before[i].error),
            `${width} DPR ${dpr} ${value.text}: after ${value.error}, native ${values.before[i].error}`,
          );
        });
        if (mode === "import") {
          values.after.forEach((a) =>
            values.after.forEach((b) => {
              if (Math.abs(a.rect[1] - b.rect[1]) < 0.1)
                assert(
                  Math.abs(a.baseline - b.baseline) < 0.1,
                  "Import footer labels on the same row share a baseline",
                );
            }),
          );
        }
        evidence.push({ width, dpr, mode, values });
        if (dpr === 1 && [390, 1600].includes(width)) {
          const screenshotSelector =
            mode === "toolbar"
              ? ".sidebar-actions"
              : mode === "import"
                ? "#importDialog .dialog-foot"
                : "#timeTemplateDialog .dialog-foot";
          await page.locator(screenshotSelector).screenshot({
            path: path.resolve(
              __dirname,
              `../docs/button-font-profile${suffix}-${mode}-${width}.png`,
            ),
          });
        }
        if (mode !== "toolbar") await page.keyboard.press("Escape");
      }
    }
    await context.close();
  }
  fs.writeFileSync(
    path.resolve(__dirname, `../docs/button-font-profile${suffix}-review.json`),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "Button ink passed: 3 button groups × 24 widths × 4 DPR; common baseline, centered ink, unchanged hit areas and icons.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
