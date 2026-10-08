"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  url = require("node:url").pathToFileURL(path.join(root, "index.html")).href,
  manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "assets/icons/material-symbols.json"),
      "utf8",
    ),
  );
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2265, 1500, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1244 },
      offline: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      remote = [],
      errors = [],
      failed = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remote.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => failed.push(request.url()));
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    // Hash each embedded path against the manifest captured from Google's official SVGs.
    for (const icon of manifest.icons.filter(
      (item) => item.id !== "ms-local-cafe",
    )) {
      const data = await page.locator("#" + icon.id).evaluate((element) => ({
        box: element.getAttribute("viewBox"),
        content:
          '<path d="' + element.querySelector("path").getAttribute("d") + '"/>',
      }));
      assert.equal(data.box, "0 -960 960 960");
      assert.equal(
        crypto.createHash("sha256").update(data.content).digest("hex"),
        icon.sha256,
        icon.id,
      );
    }
    async function audit() {
      const result = await page.evaluate(() => {
        const missing = [...document.querySelectorAll("use")]
          .filter((element) => {
            const reference = element.getAttribute("href");
            return (
              !reference?.startsWith("#ms-") ||
              !document.querySelector(reference)
            );
          })
          .map((element) => element.outerHTML);
        const custom = [...document.querySelectorAll("svg:not(.icon-sprite)")]
          .filter(
            (element) =>
              !element.querySelector("use") &&
              !element.matches(
                ".month-title-divider,.countdown-icon,.schedule-range-chevron,.target-divider svg",
              ),
          )
          .map((element) => element.outerHTML);
        return { missing, custom };
      });
      assert.deepEqual(result, { missing: [], custom: [] });
      assert.deepEqual(
        await page.locator(".schedule-range-chevron").evaluate((svg) => ({
          box: svg.getAttribute("viewBox"),
          path: svg.querySelector("path").getAttribute("d"),
        })),
        { box: "0 0 24 24", path: "m7 10 5 5 5-5" },
        "The local schedule chevron has an explicit audited path",
      );
    }
    assert.equal(await page.locator(".target-divider svg").count(), 1);
    assert.deepEqual(
      await page.locator(".target-divider svg").evaluate((svg) => ({
        hidden: svg.closest(".target-divider").getAttribute("aria-hidden"),
        box: svg.getAttribute("viewBox"),
        ratio: svg.getAttribute("preserveAspectRatio"),
        paths: [...svg.querySelectorAll("path")].map((path) =>
          path.getAttribute("d"),
        ),
      })),
      {
        hidden: "true",
        box: "0 0 100 100",
        ratio: "none",
        paths: ["M0 100 H85 C94 100 91 0 100 0"],
      },
      "The decorative target divider has an explicit audited local path",
    );
    async function equalSizes(selectors) {
      const sizes = await Promise.all(
        selectors.map((selector) =>
          page
            .locator(selector)
            .first()
            .evaluate((element) => {
              const box = element.getBoundingClientRect();
              return [box.width, box.height].map(
                (size) => Math.round(size * 100) / 100,
              );
            }),
        ),
      );
      sizes.forEach((size) => {
        assert.deepEqual(size, sizes[0]);
        assert(size[0] > 0);
      });
    }
    await audit();
    const weekendBackground = await page
      .locator(".day.weekend:not([data-holiday])")
      .first()
      .evaluate((element) => ({
        background: getComputedStyle(element, "::before").backgroundImage,
        mask: getComputedStyle(element, "::before").maskImage,
      }));
    assert.equal(weekendBackground.mask, "none");
    assert(
      weekendBackground.background.includes("data:image/svg+xml,"),
      "Weekend illustration is embedded for offline use",
    );
    const weekendSvg = decodeURIComponent(
      weekendBackground.background.match(/data:image\/svg\+xml,([^"\)]+)/)[1],
    );
    assert.equal(
      weekendSvg,
      fs.readFileSync(
        path.resolve(__dirname, "../assets/images/weekend-rest.svg"),
        "utf8",
      ),
    );
    await equalSizes([
      "#prevMonth .ui-icon",
      "#nextMonth .ui-icon",
      "#todayButton .ui-icon",
      "#batchToggle .ui-icon",
      "#settingsOpen .ui-icon",
      "#backup .ui-icon",
      "#restore .ui-icon",
    ]);
    await equalSizes([
      ".notification-tab[data-tab=notifications] svg",
      ".notification-tab[data-tab=history] svg",
      ".notification-tab[data-tab=weather] svg",
    ]);
    const timeIcon = await page
      .locator("#dayNextToggle svg")
      .evaluate((element) => element.getBoundingClientRect().width);
    await page.locator("#settingsOpen").click();
    assert.equal(
      await page
        .locator("#settingsForm .breakrow button svg")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
      timeIcon,
    );
    await audit();
    await page.locator("#batchToggle").click();
    await audit();
    await equalSizes([
      "#batchNextToggle svg",
      "#batchCalculateEnd svg",
      "#batchAddTimeTemplate svg",
    ]);
    await page.locator("#importOpen").click();
    await audit();
    await equalSizes(["#oaShortcut .oa-link-icon", "#commitImport svg"]);
    const café = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = "assets/images/weekend-rest.svg";
        }),
    );
    assert(café, "Custom weekend illustration loads from disk while offline");
    assert.deepEqual(remote, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    console.log(
      `${width}px: official icon hashes, offline rendering, icon references and size groups passed.`,
    );
    await context.close();
  }
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
