"use strict";
const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  baseline = path.join(
    root,
    "tests/fixtures/styles-date-info-contract.json.gz",
  ),
  record = process.argv.includes("--record");
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
  "overflowX",
  "overflowY",
  "outlineStyle",
  "outlineWidth",
];
let browser;
(async () => {
  if (record && fs.existsSync(baseline))
    throw Error("Refusing to replace existing component baseline");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const samples = [];
  for (const width of [
    390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
    await page.goto(
      require("node:url").pathToFileURL(path.join(root, "index.html")).href,
    );
    await page.locator("#date-tab-history").waitFor({ state: "visible" });
    for (const height of [700, 1000]) {
      await page.setViewportSize({ width, height });
      for (const mode of ["history", "festivals", "almanac", "countdown"]) {
        await page.locator("#date-tab-" + mode).click();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => window.UIAlignment.refresh());
        await page.clock.fastForward(2000);
        await page.mouse.move(0, 0);
        const values = await page.evaluate((properties) => {
          if (
            document.querySelector(
              "#editorInfo .notification-tabs, #editorInfo .notification-tab, .almanac-month, .almanac-day, .almanac-seal, #dateInfoPanel h3",
            )
          )
            throw Error("Obsolete date info structure reintroduced");
          const containers = [
            document.querySelector(".notification-tabs"),
            document.getElementById("dateInfoPanel"),
          ];
          return containers.map((container) => {
            const origin = container.getBoundingClientRect();
            return [...container.querySelectorAll("*"), container]
              .filter(
                (e) =>
                  e.getClientRects().length &&
                  getComputedStyle(e).visibility !== "hidden",
              )
              .map((e, i) => {
                const s = getComputedStyle(e),
                  r = e.getBoundingClientRect();
                return {
                  key: e.id || `${e.tagName}:${e.className}:${i}`,
                  styles: Object.fromEntries(properties.map((p) => [p, s[p]])),
                  rect: [r.width, r.height, r.x - origin.x, r.y - origin.y].map(
                    (n) => Math.round(n * 1000) / 1000,
                  ),
                };
              });
          });
        }, properties);
        samples.push({ width, height, mode, values });
      }
    }
    await page.locator("#date-tab-history").click();
    await page.locator("#date-tab-history").press("ArrowRight");
    assert.equal(
      await page.locator("#date-tab-festivals").getAttribute("aria-selected"),
      "true",
    );
    const focus = await page.locator("#date-tab-festivals").evaluate((e) => ({
      active: e === document.activeElement,
      outline: getComputedStyle(e).outlineStyle,
      width: getComputedStyle(e).outlineWidth,
    }));
    assert.deepEqual(focus, { active: true, outline: "none", width: "0px" });
    await page.locator("#date-tab-festivals").press("Home");
    assert.equal(
      await page
        .locator("#dateInfoPanel")
        .evaluate((e) => e.hidden && getComputedStyle(e).display === "none"),
      true,
    );
    await page.evaluate(() => {
      window.DateInfo.register({
        id: "long-layout",
        label: "长文本",
        getContent: () => ({
          title: "长文本",
          events: [
            {
              year: 2000,
              text: "中文和English".repeat(150),
              sourceUrl: "https://example.com/source",
            },
          ],
          rows: [
            ["LongUnbrokenLabel".repeat(5), "LongUnbrokenValue".repeat(100)],
          ],
        }),
      });
      window.DateInfoUI.refreshTabs();
    });
    await page.locator("#date-tab-long-layout").click();
    const overflow = await page
      .locator("#dateInfoPanel")
      .evaluate((e) => e.scrollWidth - e.clientWidth);
    assert(
      overflow <= 1,
      `Long date info text overflowed by ${overflow}px at width ${width}`,
    );
    if (width === 390) {
      await page.locator("#dateInfoPanel").evaluate((e) => {
        e.scrollTop +=
          e.querySelector("dt").getBoundingClientRect().top -
          e.getBoundingClientRect().top;
      });
      await page.locator("#dateInfoPanel").screenshot({
        path: path.join(root, "docs/refactor-date-info-long-label.png"),
      });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Date info style captured width " + width);
  }
  if (record)
    fs.writeFileSync(baseline, zlib.gzipSync(JSON.stringify(samples)));
  else {
    const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(baseline))),
      differences = [];
    assert.equal(samples.length, old.length);
    samples.forEach((current, i) => {
      assert.equal(current.width, old[i].width);
      assert.equal(current.height, old[i].height);
      assert.equal(current.mode, old[i].mode);
      const same =
        current.values.length === old[i].values.length &&
        current.values.every(
          (group, j) =>
            group.length === old[i].values[j].length &&
            group.every((value, k) => {
              const previous = old[i].values[j][k];
              if (JSON.stringify(value) === JSON.stringify(previous))
                return true;
              // Keep the old fixture; only the explicitly requested focus outline
              // removal on these four tabs is an intentional visual change.
              if (
                value.key !== previous.key ||
                ![
                  "date-tab-history",
                  "date-tab-festivals",
                  "date-tab-almanac",
                  "date-tab-countdown",
                ].includes(value.key) ||
                !(
                  (previous.styles.outlineStyle === "solid" &&
                    previous.styles.outlineWidth === "2px") ||
                  (previous.styles.outlineStyle === "none" &&
                    previous.styles.outlineWidth === "3px")
                )
              )
                return false;
              const expected = structuredClone(previous);
              expected.styles.outlineStyle = "none";
              expected.styles.outlineWidth = "0px";
              return JSON.stringify(value) === JSON.stringify(expected);
            }),
        );
      if (!same)
        differences.push({
          width: current.width,
          height: current.height,
          mode: current.mode,
          before: old[i].values,
          after: current.values,
        });
    });
    fs.writeFileSync(
      path.join(root, "docs/date-info-style-differences.json"),
      JSON.stringify(differences, null, 2) + "\n",
    );
    assert.equal(
      differences.length,
      0,
      "Date info styles/geometry changed; inspect component differences",
    );
  }
  console.log(
    `${samples.length} component states ${record ? "recorded" : "unchanged"}.`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
