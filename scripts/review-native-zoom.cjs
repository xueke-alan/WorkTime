"use strict";
// Isolated Chromium profile preferences apply native page zoom; no DPR emulation or CSS zoom.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let context;
const tag = process.argv[2] || "";
assert(!tag || /^[a-z0-9-]+$/.test(tag), "Safe output tag");
const suffix = tag ? `-${tag}` : "";
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect.getComputedTiming().endTime))
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
(async () => {
  const output = path.join(root, `docs/native-zoom-review${suffix}.json`);
  assert(!fs.existsSync(output), "Refusing to replace existing review");
  const rows = [];
  for (const width of [1600, 1920]) {
    let physicalContent;
    for (const factor of [1, 1.25, 1.5]) {
      const profile = fs.mkdtempSync(
        path.join(root, ".refactor-backups/native-review-"),
      );
      fs.mkdirSync(path.join(profile, "Default"));
      fs.writeFileSync(
        path.join(profile, "Default/Preferences"),
        JSON.stringify({
          partition: {
            default_zoom_level: { x: Math.log(factor) / Math.log(1.2) },
          },
        }),
      );
      context = await chromium.launchPersistentContext(profile, {
        channel: "msedge",
        headless: true,
        viewport: null,
        args: [`--window-size=${width},1000`],
        reducedMotion: "no-preference",
        timezoneId: "Asia/Shanghai",
      });
      const page = context.pages()[0];
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      for (const mode of [
        "month",
        "year",
        "settings",
        "template",
        "import",
        "history",
      ]) {
        if (mode === "year") await page.locator("#monthTitle").click();
        if (mode === "settings") {
          await page.locator("#monthTitle").click();
          await page.locator("#settingsOpen").click();
        }
        if (mode === "template") await page.locator("#addTimeTemplate").click();
        if (mode === "import" || mode === "history")
          await page.locator("#importOpen").click();
        if (mode === "history")
          await page.locator("#importHistoryOpen").click();
        await settle(page);
        const values = await page.evaluate(() => {
          const modal = document.querySelector("dialog[open]");
          const scope =
            modal || document.querySelector(".calendar-toolbar-actions");
          const labels = [...scope.querySelectorAll(".button-label")]
            .filter((e) => e.getClientRects().length)
            .map((label) => {
              const style = getComputedStyle(label),
                button = label.closest("button"),
                box = button.getBoundingClientRect();
              const probe = document.createElement("i");
              probe.style.cssText =
                "display:inline-block;width:0;height:0;vertical-align:baseline";
              label.append(probe);
              const baseline = probe.getBoundingClientRect().top;
              probe.remove();
              const c = document.createElement("canvas").getContext("2d");
              c.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * devicePixelRatio}px ${style.fontFamily}`;
              const ink = c.measureText(label.textContent.trim());
              return {
                text: label.textContent.trim(),
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                classes: button.className,
                error:
                  baseline +
                  (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) /
                    (2 * devicePixelRatio) -
                  box.y -
                  box.height / 2,
                outline: getComputedStyle(button).outlineWidth,
                outlineStyle: getComputedStyle(button).outlineStyle,
              };
            });
          return {
            dpr: devicePixelRatio,
            width: innerWidth,
            outerWidth,
            scale: visualViewport.scale,
            zoom: getComputedStyle(document.documentElement).zoom,
            overflow: document.documentElement.scrollWidth - innerWidth,
            labels,
            modal: modal
              ? { id: modal.id, width: modal.getBoundingClientRect().width }
              : null,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          };
        });
        if (factor === 1 && mode === "month") physicalContent = values.width;
        assert(Math.abs(values.dpr - factor) < 0.01, "Native zoom DPR");
        assert(
          Math.abs(values.width * factor - physicalContent) < 2,
          "Native zoom CSS viewport",
        );
        assert.equal(values.scale, 1);
        assert.equal(values.zoom, "1");
        assert.equal(values.reduced, false);
        assert(values.overflow <= 1, "No page horizontal overflow");
        if (values.modal)
          assert(
            values.modal.width <= values.width,
            "Dialog fits CSS viewport",
          );
        for (const label of values.labels) {
          assert(
            Math.abs(label.error) <= 0.85,
            `${mode}: ${JSON.stringify(label)}`,
          );
          assert(
            label.outline === "0px" || label.outlineStyle === "none",
            "No visible outer outline",
          );
        }
        assert.deepEqual(errors, []);
        const screenshot = `native-zoom${suffix}-${width}-${Math.round(factor * 100)}-${mode}.png`;
        const session = await context.newCDPSession(page);
        const capture = await session.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        await session.detach();
        const png = Buffer.from(capture.data, "base64");
        assert(
          Math.abs(png.readUInt32BE(16) - values.width * factor) <= 2,
          "Capture covers native physical viewport",
        );
        fs.writeFileSync(path.join(root, "docs", screenshot), png);
        rows.push({ windowWidth: width, factor, mode, values, screenshot });
        if (mode === "history") await page.keyboard.press("Escape");
        if (["settings", "template", "import", "history"].includes(mode))
          await page.keyboard.press("Escape");
        console.log(`Reviewed ${width} zoom ${factor} ${mode}`);
      }
      await context.close();
      context = null;
    }
  }
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        browser: "msedge",
        osScale: "User reports Windows 100%; not changed by automation",
        motion: "normal",
        complete: true,
        rows,
      },
      null,
      2,
    ),
  );
})().catch(async (error) => {
  console.error(error);
  await context?.close();
  process.exitCode = 1;
});
