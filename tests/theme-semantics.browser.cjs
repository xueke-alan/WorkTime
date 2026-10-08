"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  reference = fs.readFileSync(
    path.join(__dirname, "fixtures/tokens-before-semantic-consolidation.css"),
    "utf8",
  );
const tokenNames = [
  ...new Set(
    [...reference.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
  ),
];
assert.equal(
  crypto.createHash("sha256").update(reference).digest("hex"),
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "fixtures/tokens-before-semantic-consolidation.css.source.json",
      ),
      "utf8",
    ),
  ).sha256,
  "Frozen token source must remain byte-identical",
);
const realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=DomainTest",
  realm,
);
let browser;
async function capture(width, theme, original) {
  const context = await browser.newContext({
    viewport: { width, height: 1244 },
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  try {
    let referenceLoads = 0;
    await context.route(/^https?:/, (route) => route.abort());
    if (original)
      await context.route("**/assets/css/tokens.css", (route) => {
        referenceLoads++;
        return route.fulfill({ contentType: "text/css", body: reference });
      });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = realm.C.defaultState();
    state.preferences.pageTheme = theme;
    await page.addInitScript((fixture) => {
      localStorage.setItem("worktime-local-v1", JSON.stringify(fixture));
      localStorage.setItem("worktime.pageTheme", fixture.preferences.pageTheme);
    }, state);
    await page.clock.install({ time: new Date("2026-10-04T12:00:00+08:00") });
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => document.fonts.ready);
    await page.clock.fastForward(3000);
    await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
    await page.clock.runFor(100);
    await page.waitForFunction(() => {
      const footer = document.querySelector(".calendar-footer");
      const tabs = document.querySelector(".editor > .notification-tabs");
      return (
        !document.documentElement.classList.contains("app-loading") &&
        Math.abs(
          tabs.getBoundingClientRect().height -
            footer.getBoundingClientRect().height,
        ) < 0.02
      );
    });
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    if (original)
      assert.equal(
        referenceLoads,
        1,
        "Original token stylesheet must actually replace the current source",
      );
    const values = await page.evaluate(() =>
      [...document.querySelectorAll("body, body *")]
        .filter(
          (element) =>
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== "hidden",
        )
        .map((element, index) => {
          const style = getComputedStyle(element),
            rect = element.getBoundingClientRect();
          return {
            key:
              element.id ||
              `${element.tagName}:${element.getAttribute("class") || ""}:${index}`,
            styles: Object.fromEntries(
              [
                "color",
                "backgroundColor",
                "backgroundImage",
                "borderColor",
                "boxShadow",
                "fill",
                "stroke",
                "fontFamily",
                "fontSize",
                "lineHeight",
                "display",
                "gridTemplateColumns",
                "gap",
                "outline",
                "transform",
              ].map((property) => [property, style[property]]),
            ),
            rect: [rect.x, rect.y, rect.width, rect.height].map(
              (value) => Math.round(value * 1000) / 1000,
            ),
          };
        }),
    );
    const tokens = await page.evaluate((names) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        names.map((name) => [
          name,
          style.getPropertyValue(name).replace(/\s+/g, " ").trim(),
        ]),
      );
    }, tokenNames);
    assert.deepEqual(errors, []);
    return { tokens, values };
  } finally {
    await context.close();
  }
}
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  let cases = 0,
    nodes = 0;
  for (const width of [390, 1600, 2250])
    for (const theme of [
      "green",
      "blue",
      "purple",
      "orange",
      "rose",
      "slate",
    ]) {
      const before = await capture(width, theme, true),
        after = await capture(width, theme, false);
      assert.deepEqual(
        after,
        before,
        `${width}/${theme}: every visible node must retain its colors and layout`,
      );
      cases++;
      nodes += after.values.length;
    }
  console.log(
    `Theme semantics passed: ${cases} theme/width pairs, ${tokenNames.length} resolved tokens per pair and ${nodes} visible nodes strictly equal to frozen token source.`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
