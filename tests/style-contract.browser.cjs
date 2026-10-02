"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const reviewedButtonChange = require("./helpers/button-style-change.cjs");
const root = path.resolve(__dirname, "..");
const url = require("node:url").pathToFileURL(
  path.join(root, "index.html"),
).href;
const baseline = path.join(
  root,
  process.argv.includes("--original")
    ? "tests/fixtures/styles-stage01-contract.json.gz"
    : "tests/fixtures/styles-responsive-contract.json.gz",
);
const zlib = require("node:zlib");
const record = process.argv.includes("--record");
const recordMissing = process.argv.includes("--record-missing-data");
const missingBaseline = path.join(
  root,
  "tests/fixtures/styles-missing-data-contract.json.gz",
);
const properties = [
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "borderTopWidth",
  "borderTopColor",
  "borderRadius",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "height",
  "minHeight",
  "maxHeight",
  "width",
  "gap",
  "alignItems",
  "justifyContent",
  "transform",
  "textAlign",
  "letterSpacing",
  "boxShadow",
];
const modes = [
  "month",
  "six-weeks",
  "year",
  "batch",
  "settings",
  "template",
  "import",
  "history",
  "festivals",
  "almanac",
  "countdown",
];
const widths = [390, 850, 1150, 1151, 1600, 1920];
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const samples = [];
  for (const width of widths) {
    for (const mode of recordMissing ? ["six-weeks"] : modes) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
      await page.addInitScript(() => {
        let seed = 123;
        Math.random = () =>
          ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      });
      await page.goto(url);
      await page.locator("#batchToggle").waitFor({ state: "visible" });
      if (mode === "year") await page.locator("#monthTitle").click();
      if (mode === "six-weeks") {
        await page.locator("#monthTitle").click();
        await page.locator('[data-year-date="2026-03-01"]').click();
      }
      if (mode === "batch") await page.locator("#batchToggle").click();
      if (mode === "settings") await page.locator("#settingsOpen").click();
      if (mode === "template") {
        await page.locator("#addTimeTemplate").click();
        await page.locator("#timeTemplateName").fill("较长的中文模板名称");
      }
      if (mode === "import") {
        await page.locator("#importOpen").click();
        await page.locator("#pasteText").fill("09/28\n08:00\n17:30");
        await page.waitForFunction(
          () => !document.getElementById("commitImport").disabled,
        );
        await page.locator("#previewImport").click();
      }
      if (mode === "history") {
        await page.locator("#importOpen").click();
        await page.locator("#importHistoryOpen").click();
      }
      if (["festivals", "almanac", "countdown"].includes(mode))
        await page.locator("#date-tab-" + mode).click();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => UIAlignment.refresh());
      await page.clock.fastForward(5000);
      const values = await page.evaluate((properties) => {
        if (
          document.querySelector(
            ".top,.brand,.logo,.eyebrow,.subtitle,.rangebar,.forecast,.batchbar,.detailgrid,.keyval,.checkline,.more-menu,.more-menu-items,.more-chevron,.sidebar-logo,.sidebar-status,.source,.empty",
          )
        )
          throw Error("Obsolete base/layout structure reintroduced");
        if (document.querySelector('input[type="time"]'))
          throw Error("Legacy native time field reintroduced");
        const selector =
          "button,input,select,textarea,.button-label,.time-template-chip,.daynum-text,.card-label,.metric,.target-value,.target-metric,.panel-head,.calendar-footer,.editor-date,.notification-tab,.almanac-date-text";
        return [...document.querySelectorAll(selector)]
          .filter(
            (e) =>
              e.getClientRects().length &&
              getComputedStyle(e).visibility !== "hidden",
          )
          .map((e, index) => {
            const s = getComputedStyle(e),
              rect = e.getBoundingClientRect();
            return {
              key: e.id || `${e.tagName}:${e.className}:${index}`,
              styles: Object.fromEntries(properties.map((p) => [p, s[p]])),
              rect: [rect.width, rect.height, rect.y].map(
                (n) => Math.round(n * 1000) / 1000,
              ),
            };
          });
      }, properties);
      samples.push({ width, mode, values });
      if (mode === "six-weeks") {
        const message = await page.locator("#targetResult").textContent();
        assert.match(message, /记录不完整.*已录入数据/);
        assert.equal(
          await page.locator("#targetTotalLabel").textContent(),
          "记录内差额",
        );
        if (recordMissing)
          await page.locator(".target-panel").screenshot({
            path: path.join(root, `docs/missing-data-six-weeks-${width}.png`),
          });
      }
      await context.close();
    }
    console.log("Style contract captured width " + width);
  }
  if (record || recordMissing) {
    const destination = recordMissing ? missingBaseline : baseline;
    if (fs.existsSync(destination))
      throw Error("Refusing to replace existing style baseline");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, zlib.gzipSync(JSON.stringify(samples)), {
      flag: "wx",
    });
  } else {
    const previous = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(baseline)).toString("utf8"),
      ),
      differences = [];
    const missingSamples = fs.existsSync(missingBaseline)
      ? JSON.parse(
          zlib.gunzipSync(fs.readFileSync(missingBaseline)).toString("utf8"),
        )
      : [];
    const expectedMissing = new Map(
      missingSamples.map((sample) => [
        sample.width + ":" + sample.mode,
        sample,
      ]),
    );
    if (missingSamples.length) {
      assert.equal(missingSamples.length, widths.length);
      assert.equal(expectedMissing.size, widths.length);
      for (const sample of missingSamples) {
        assert.equal(sample.mode, "six-weeks");
        assert(widths.includes(sample.width));
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const current = samples[i],
        old =
          expectedMissing.get(current.width + ":" + current.mode) ||
          previous[i];
      assert.equal(current.width, old.width);
      assert.equal(current.mode, old.mode);
      if (current.values.length !== old.values.length) {
        differences.push({
          width: current.width,
          mode: current.mode,
          error: "element count changed",
          before: old.values.length,
          after: current.values.length,
        });
        continue;
      }
      for (let j = 0; j < current.values.length; j++)
        if (
          JSON.stringify(current.values[j]) !== JSON.stringify(old.values[j]) &&
          !(
            !expectedMissing.has(current.width + ":" + current.mode) &&
            reviewedButtonChange(
              current.values[j],
              old.values[j],
              current,
              "page",
            )
          )
        )
          differences.push({
            width: current.width,
            mode: current.mode,
            before: old.values[j],
            after: current.values[j],
          });
    }
    fs.writeFileSync(
      path.join(root, "docs/style-contract-differences.json"),
      JSON.stringify(differences, null, 2) + "\n",
    );
    assert.equal(
      differences.length,
      0,
      "Unexpected styles/geometry changed; inspect docs/style-contract-differences.json",
    );
  }
  console.log(
    `${samples.length} style states ${record || recordMissing ? "recorded to a new baseline" : "unchanged"}.`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
