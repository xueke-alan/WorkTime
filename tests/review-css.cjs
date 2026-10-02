"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
const out = path.resolve(__dirname, "../docs");
const cssFiles = [
  ...fs
    .readFileSync(path.resolve(__dirname, "../index.html"), "utf8")
    .matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(assets\/css\/[^"]+)"/g),
].map((match) => match[1]);
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = {
    samples: [],
    cascade: {},
    notes: [
      "deviceScaleFactor tests raster density; it is not a substitute for actual Windows/browser zoom tests.",
    ],
  };
  for (const dsf of [1, 1.25, 1.5, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: dsf,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator("#batchToggle").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.UIAlignment.refresh());
    async function measure() {
      return page.evaluate(() => {
        const round = (n) => Math.round(n * 1000) / 1000;
        return ["batchToggle", "settingsOpen", "backup", "restore"].map(
          (id) => {
            const button = document.getElementById(id),
              label = [...button.children].find(
                (e) =>
                  e.tagName === "SPAN" &&
                  !e.classList.contains("backup-icon-slot"),
              );
            const svg = button.querySelector("svg"),
              b = button.getBoundingClientRect(),
              l = label.getBoundingClientRect(),
              i = svg.getBoundingClientRect(),
              s = getComputedStyle(label),
              bs = getComputedStyle(button);
            const range = document.createRange();
            range.selectNodeContents(label);
            const t = range.getBoundingClientRect();
            const c = document.createElement("canvas").getContext("2d");
            c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
            const m = c.measureText(label.textContent);
            return {
              id,
              text: label.textContent,
              buttonY: round(b.y),
              buttonHeight: round(b.height),
              labelY: round(l.y),
              labelHeight: round(l.height),
              textRangeY: round(t.y),
              textRangeHeight: round(t.height),
              labelCenterRelative: round(
                l.y + l.height / 2 - b.y - b.height / 2,
              ),
              iconCenterRelative: round(
                i.y + i.height / 2 - b.y - b.height / 2,
              ),
              font: s.font,
              fontSize: s.fontSize,
              lineHeight: s.lineHeight,
              transform: s.transform,
              translate: s.translate,
              offset: s.getPropertyValue("--ui-ink-offset"),
              padding: [bs.paddingTop, bs.paddingBottom],
              glyphAscent: m.actualBoundingBoxAscent,
              glyphDescent: m.actualBoundingBoxDescent,
            };
          },
        );
      });
    }
    const corrected = await measure();
    await page.addStyleTag({
      content:
        ".calendar-toolbar-actions .button-label{translate:none!important}",
    });
    const native = await measure();
    results.samples.push({ deviceScaleFactor: dsf, corrected, native });
    if (dsf === 1) {
      await page.screenshot({
        path: path.join(out, "review-css-current-toolbar-native.png"),
        clip: await page.locator(".calendar-toolbar-actions").boundingBox(),
      });
      await page.evaluate(() =>
        document.querySelectorAll("style").forEach((e) => {
          if (e.textContent.includes(".calendar-toolbar-actions .button-label"))
            e.remove();
        }),
      );
      await page.screenshot({
        path: path.join(out, "review-css-current-toolbar.png"),
        clip: await page.locator(".calendar-toolbar-actions").boundingBox(),
      });
      results.cascade = await page.evaluate(
        (sources) => {
          const rules = [],
            counts = { styleRules: 0, importantDeclarations: 0, emptyRules: 0 },
            duplicates = new Map();
          function visit(list, file) {
            for (const r of list) {
              if (r.style && typeof r.selectorText === "string") {
                counts.styleRules++;
                if (!r.style.length) counts.emptyRules++;
                for (const p of r.style)
                  if (r.style.getPropertyPriority(p) === "important")
                    counts.importantDeclarations++;
                duplicates.set(
                  r.selectorText,
                  (duplicates.get(r.selectorText) || 0) + 1,
                );
                if (
                  ["batchToggle", "settingsOpen"].some((id) => {
                    try {
                      return document
                        .getElementById(id)
                        .matches(r.selectorText);
                    } catch {
                      return false;
                    }
                  })
                )
                  rules.push({
                    file,
                    selector: r.selectorText,
                    css: r.style.cssText,
                  });
              }
              if (r.cssRules) visit(r.cssRules, file);
            }
          }
          for (const source of sources) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(source.text);
            visit(sheet.cssRules, source.file);
          }
          return {
            counts,
            toolbarMatchingRules: rules,
            mostRepeatedSelectors: [...duplicates]
              .filter((x) => x[1] > 1)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20),
          };
        },
        cssFiles.map((file) => ({
          file,
          text: fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"),
        })),
      );
      for (const width of [
        390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.UIAlignment.refresh());
        const metrics = await measure();
        results.samples.push({ width, metrics });
        assert(
          Math.abs(metrics[0].buttonHeight - metrics[1].buttonHeight) < 0.1,
          "shared toolbar button height at " + width,
        );
      }
    }
    await context.close();
  }
  fs.writeFileSync(
    path.join(out, "review-css-current-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        samples: results.samples.length,
        counts: results.cascade.counts,
        first: results.samples[0],
        repeated: results.cascade.mostRepeatedSelectors.slice(0, 6),
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
