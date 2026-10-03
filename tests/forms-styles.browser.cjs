"use strict";
const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  baseline = path.join(root, "tests/fixtures/styles-forms-contract.json.gz"),
  record = process.argv.includes("--record"),
  realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  realm,
);
const state = realm.C.defaultState(),
  date = "2026-09-28";
const oa = {
  date,
  start: "08:00",
  end: "17:30",
  nextDay: false,
  status: "complete",
  source: "fixture",
  raw: "09/28\n08:00\n17:30",
  importId: "fixture",
};
state.days[date] = {
  oa,
  actual: {
    start: "08:00",
    end: "20:00",
    nextDay: false,
    effectiveMinutes: null,
  },
  leaveMinutes: 60,
  note: "测试备注",
};
state.timeTemplates = [
  {
    id: "fixture-template",
    name: "较长的中文时间模板名称用于审查布局",
    start: "08:00",
    end: "20:00",
    nextDay: false,
  },
];
state.imports = [
  {
    id: "fixture",
    at: "2026-09-28T10:00:00Z",
    year: 2026,
    sources: [{ name: "fixture", raw: oa.raw }],
    count: 1,
    records: [oa],
  },
];
const properties = [
  "display",
  "position",
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
  "overflowX",
  "overflowY",
  "gridTemplateColumns",
];
const modes = [
  "day-empty",
  "day-record",
  "day-invalid",
  "leave",
  "batch-empty",
  "batch-selected",
  "settings",
  "template-new",
  "template-edit",
  "import-preview",
  "import-history",
  "delete-import",
  "source",
  "restore",
  "help",
  "oa-link",
];
let browser;
(async () => {
  if (record && fs.existsSync(baseline))
    throw Error("Refusing to replace forms baseline");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const samples = [];
  for (const width of [
    390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
  ]) {
    for (const mode of modes) {
      const context = await browser.newContext({
          viewport: { width, height: 1000 },
          timezoneId: "Asia/Shanghai",
          reducedMotion: "reduce",
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
      await page.addInitScript(
        (s) => {
          localStorage.setItem("worktime-local-v1", JSON.stringify(s));
          let seed = 123;
          Math.random = () =>
            ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { readText: async () => JSON.stringify(s) },
          });
        },
        JSON.parse(JSON.stringify(state)),
      );
      await page.goto(
        require("node:url").pathToFileURL(path.join(root, "index.html")).href,
      );
      await page.locator("#monthTitle").waitFor({ state: "visible" });
      if (mode !== "day-empty") {
        await page.locator("#prevMonth").click();
        await page.locator(`[data-date="${date}"]`).click();
      }
      let selector = ".editor";
      if (mode === "day-invalid") await page.locator("#dayStart").fill("25:00");
      if (mode === "leave") await page.locator("#dayLeaveToggle").click();
      if (mode.startsWith("batch")) {
        await page.locator("#batchToggle").click();
        if (mode === "batch-selected") {
          await page.locator(`[data-date="${date}"]`).click();
          await page.locator("#batchCalcOvertime").fill("2.5");
          await page.locator("#batchCalculateEnd").click();
        }
      }
      if (mode === "settings") {
        await page.locator("#settingsOpen").click();
        selector = "#settingsDialog";
      }
      if (mode.startsWith("template")) {
        await page
          .locator(
            mode === "template-new"
              ? "#addTimeTemplate"
              : "[data-template-edit]",
          )
          .first()
          .click();
        if (mode === "template-new") {
          await page
            .locator("#timeTemplateName")
            .fill("新建模板及跨日填写测试");
          await page.locator("#timeTemplateStart").fill("20:00");
          await page.locator("#timeTemplateEnd").fill("08:00");
          await page.locator("#timeTemplateNextToggle").click();
        }
        selector = "#timeTemplateDialog";
      }
      if (
        [
          "import-preview",
          "import-history",
          "delete-import",
          "oa-link",
        ].includes(mode)
      ) {
        await page.locator("#importOpen").click();
        selector = "#importDialog";
        if (mode === "import-preview") {
          await page
            .locator("#pasteText")
            .fill("09/28\n08:00\n22:00\n09/29\n08:00\n17:30");
          await page.clock.fastForward(1000);
        }
        if (["import-history", "delete-import"].includes(mode)) {
          await page
            .locator("#importHistoryList")
            .waitFor({ state: "visible" });
          selector = "#importDialog";
        }
        if (mode === "delete-import") {
          await page.locator("[data-delete-import]").click();
          selector = "#deleteImportDialog";
        }
        if (mode === "oa-link") {
          await page.locator("#oaShortcut").click();
          selector = "#oaLinkDialog";
        }
      }
      if (mode === "source") {
        await page.locator("#sourceOpen").click();
        selector = "#sourceDialog";
      }
      if (mode === "restore") {
        await page.locator("#restore").click();
        selector = "#restoreDialog";
      }
      if (mode === "help") {
        await page.locator("#helpOpen").click();
        selector = "#helpDialog";
      }
      await page.locator(selector).waitFor({ state: "visible" });
      for (const height of [700, 1000]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => UIAlignment.refresh());
        await page.clock.fastForward(2000);
        await page.mouse.move(0, 0);
        const values = await page.evaluate(
          ({ selector, properties }) => {
            const container = document.querySelector(selector),
              origin = container.getBoundingClientRect();
            if (
              document.querySelector(
                ".leave-toggle,.upload-zone,.import-sources,.source-item,.remove-file,.settings-schedule>.help",
              )
            )
              throw Error("Obsolete form structure reintroduced");
            if (document.documentElement.scrollWidth > innerWidth + 1)
              throw Error("Page horizontal overflow");
            return [container, ...container.querySelectorAll("*")]
              .filter(
                (e) =>
                  e.getClientRects().length &&
                  getComputedStyle(e).visibility !== "hidden",
              )
              .map((e, i) => {
                const s = getComputedStyle(e),
                  r = e.getBoundingClientRect(),
                  p =
                    e.tagName === "DIALOG"
                      ? getComputedStyle(e, "::backdrop")
                      : null;
                return {
                  key:
                    e.id ||
                    `${e.tagName}:${typeof e.className === "string" ? e.className : e.className.baseVal}:${i}`,
                  styles: Object.fromEntries(properties.map((k) => [k, s[k]])),
                  rect: [r.width, r.height, r.x - origin.x, r.y - origin.y].map(
                    (n) => Math.round(n * 1000) / 1000,
                  ),
                  backdrop: p
                    ? {
                        backgroundColor: p.backgroundColor,
                        backdropFilter: p.backdropFilter,
                      }
                    : null,
                };
              });
          },
          { selector, properties },
        );
        samples.push({ width, height, mode, values });
      }
      if (selector !== ".editor") {
        assert(
          await page
            .locator(selector)
            .evaluate((e) => e.contains(document.activeElement)),
          "Modal owns initial focus: " + mode,
        );
        await page.keyboard.press("Tab");
        assert(
          await page
            .locator(selector)
            .evaluate((e) => e.contains(document.activeElement)),
          "Modal traps Tab: " + mode,
        );
        const storageBeforeCancel = await page.evaluate(() =>
          localStorage.getItem("worktime-local-v1"),
        );
        const clock = page.locator(selector + " input.clock-input").first();
        if (await clock.count()) await clock.fill("11:00");
        await page.keyboard.press("Escape");
        await page.locator(selector).waitFor({ state: "hidden" });
        assert.equal(
          await page.locator(selector).evaluate((e) => e.open),
          false,
          "Escape closes: " + mode,
        );
        assert.equal(
          await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
          storageBeforeCancel,
          "Modal cancellation does not save staged input: " + mode,
        );
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Forms style captured width " + width);
  }
  if (record)
    fs.writeFileSync(baseline, zlib.gzipSync(JSON.stringify(samples)));
  else {
    const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(baseline))),
      differences = [];
    assert.equal(samples.length, old.length);
    samples.forEach((s, i) => {
      assert.equal(s.width, old[i].width);
      assert.equal(s.height, old[i].height);
      assert.equal(s.mode, old[i].mode);
      const same =
        s.values.length === old[i].values.length &&
        s.values.every((value, j) => {
          const previous = old[i].values[j];
          if (
            JSON.stringify(value) === JSON.stringify(previous) ||
            require("./helpers/button-style-change.cjs")(
              value,
              previous,
              s,
              "forms",
            )
          )
            return true;
          // SVG <use> bounds inherit subpixel transforms. Keep the outer icon
          // and all styles exact; tolerate only the observed rounding boundary.
          return (
            value.key.startsWith("use:") &&
            value.key === previous.key &&
            JSON.stringify(value.styles) === JSON.stringify(previous.styles) &&
            JSON.stringify(value.backdrop) ===
              JSON.stringify(previous.backdrop) &&
            value.rect.every((n, k) => Math.abs(n - previous.rect[k]) <= 0.002)
          );
        });
      if (!same)
        differences.push({
          width: s.width,
          height: s.height,
          mode: s.mode,
          before: old[i].values,
          after: s.values,
        });
    });
    fs.writeFileSync(
      path.join(root, "docs/forms-style-differences.json"),
      JSON.stringify(differences, null, 2),
    );
    assert.equal(differences.length, 0, "Forms changed; inspect differences");
  }
  console.log(
    `${samples.length} forms states ${record ? "recorded" : "unchanged"}.`,
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
