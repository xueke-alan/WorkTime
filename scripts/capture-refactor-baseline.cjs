"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { fixBusinessDate } = require("./lib/fixed-business-date.cjs");
const root = path.resolve(__dirname, "..");
const compare = process.argv.includes("--compare");
const stable = process.argv.includes("--stable");
const snapshot = process.argv.includes("--snapshot");
const runId = process.argv.find((arg) => arg.startsWith("--run-id="))?.slice(9);
const paint = process.argv.includes("--paint");
const nativeClock = process.argv.includes("--native-clock");
const cdp = process.argv.includes("--cdp");
if (cdp && !stable) throw Error("CDP capture requires --stable");
if (runId && !/^[a-z0-9-]+$/.test(runId))
  throw Error(
    "Capture run identifier must contain lowercase letters, digits or hyphens",
  );
if (snapshot && !stable) throw Error("Snapshot capture requires --stable");
const sourceRoot = snapshot
  ? path.join(
      root,
      ".refactor-backups/workspace-2026-10-04T03-32-53-659Z/files",
    )
  : root;
const output = path.join(
  root,
  compare ? "test-results" : ".refactor-backups",
  (stable
    ? snapshot
      ? "visual-stable-baseline-2026-10-04"
      : "visual-stable-current-2026-10-04"
    : compare
      ? "visual-current-2026-10-04"
      : "visual-baseline-2026-10-04") + (runId ? `-${runId}` : ""),
);
const themes = ["green", "blue", "purple", "orange", "rose", "slate"];
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}
const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main() {
  if (fs.existsSync(output))
    throw Error(
      "Baseline already exists; preserve it before capturing a new baseline.",
    );
  fs.mkdirSync(output, { recursive: true });
  const runnerIdentity = {
    path: "scripts/capture-refactor-baseline.cjs",
    sha256: sha256(__filename),
  };
  const fingerprints = [
    path.join(sourceRoot, "index.html"),
    ...sourceFiles(path.join(sourceRoot, "assets")),
  ].map((file) => ({
    path: path.relative(sourceRoot, file).replaceAll(path.sep, "/"),
    sha256: sha256(file),
  }));
  if (snapshot) {
    const original = JSON.parse(
        fs.readFileSync(path.join(sourceRoot, "../manifest.json"), "utf8"),
      ),
      expected = new Map(
        original.files.map((file) => [file.path, file.sha256]),
      );
    for (const file of fingerprints)
      if (expected.get(file.path) !== file.sha256)
        throw Error("Protected source changed: " + file.path);
  }
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const samples = [];
  try {
    for (const width of [390, 1600, 2250]) {
      for (const theme of themes) {
        const context = await browser.newContext({
          viewport: { width, height: 1244 },
          timezoneId: "Asia/Shanghai",
          reducedMotion: "reduce",
        });
        await context.route(/^https?:/, (route) => route.abort());
        try {
          const page = await context.newPage();
          await page.addInitScript((theme) => {
            localStorage.setItem("worktime.pageTheme", theme);
            let seed = 20261004;
            addEventListener("resize", () => {
              seed = 20261004;
            });
            Math.random = () => {
              seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
              return seed / 4294967296;
            };
          }, theme);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          if (nativeClock)
            await fixBusinessDate(page, "2026-10-04T12:00:00+08:00");
          else
            await page.clock.install({
              time: new Date("2026-10-04T12:00:00+08:00"),
            });
          const advance = (milliseconds, runFrames = false) =>
            nativeClock
              ? page.waitForTimeout(milliseconds)
              : runFrames
                ? page.clock.runFor(milliseconds)
                : page.clock.fastForward(milliseconds);
          await page.goto(
            pathToFileURL(path.join(sourceRoot, "index.html")).href,
          );
          await page.waitForFunction(
            () =>
              document.documentElement.dataset.appState === "ready" &&
              !document.documentElement.classList.contains("app-loading"),
          );
          await page.evaluate(() => document.fonts.ready);
          const session = cdp ? await context.newCDPSession(page) : null;
          if (cdp)
            await page.addStyleTag({
              content: "input,textarea{caret-color:transparent!important}",
            });
          await page.locator("#pageSettingsOpen").click();
          await page
            .locator(`.theme-card:has(input[value="${theme}"])`)
            .click();
          const capture = async (view) => {
            if (stable) {
              await advance(1000);
              await page.evaluate(() =>
                window.scrollTo({ top: 0, behavior: "instant" }),
              );
              await advance(500);
              await advance(100, true);
              await page.waitForFunction(() => {
                const footer = document.querySelector(".calendar-footer"),
                  tabs = document.querySelector(".editor>.notification-tabs");
                return (
                  Math.abs(
                    footer.getBoundingClientRect().height -
                      tabs.getBoundingClientRect().height,
                  ) < 0.01
                );
              });
            }
            if (paint) {
              await page.evaluate(() => document.fonts.ready);
              await page.waitForTimeout(200);
              // A full-page capture can leave stale compositor tiles on Edge.
              // Paint the same unmodified scene once, then let real frames settle.
              await page.screenshot({ fullPage: true, animations: "disabled" });
              await advance(1000, true);
              await page.waitForTimeout(500);
            }
            const file = `${theme}-${width}-${view}.png`;
            const geometry = await page.evaluate(() => {
              const header = document.querySelector(".sidebar-header"),
                box = header.getBoundingClientRect(),
                sidebar = header.closest(".summary-sidebar");
              return {
                scrollY,
                sidebarScrollTop: sidebar.scrollTop,
                header: {
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: box.height,
                },
              };
            });
            if (
              stable &&
              (geometry.scrollY !== 0 ||
                geometry.sidebarScrollTop !== 0 ||
                geometry.header.y < 0)
            )
              throw Error("Unsettled or clipped header: " + file);
            const paintHashes = [];
            if (cdp) {
              const layout = await session.send("Page.getLayoutMetrics");
              const clip = {
                x: 0,
                y: 0,
                width,
                height: layout.cssContentSize.height,
                scale: 1,
              };
              let previous = null,
                png = null,
                settled = false;
              for (let attempt = 0; attempt < 8; attempt++) {
                await advance(100, true);
                await page.waitForTimeout(300);
                const capture = await session.send("Page.captureScreenshot", {
                  format: "png",
                  fromSurface: true,
                  captureBeyondViewport: true,
                  clip,
                });
                png = Buffer.from(capture.data, "base64");
                const hash = crypto
                  .createHash("sha256")
                  .update(png)
                  .digest("hex");
                paintHashes.push(hash);
                if (hash === previous) {
                  settled = true;
                  break;
                }
                previous = hash;
              }
              if (!settled) throw Error("Unstable full-page paint: " + file);
              fs.writeFileSync(path.join(output, file), png, { flag: "wx" });
            } else
              await page.screenshot({
                path: path.join(output, file),
                fullPage: true,
                animations: paint ? "disabled" : "allow",
              });
            samples.push({
              theme,
              width,
              view,
              file,
              geometry,
              errors: [...errors],
              paintHashes,
            });
          };
          await capture("personal");
          await page.locator("#pageSettingsOpen").click();
          await capture("month");
          await page.locator("#settingsOpen").click();
          await capture("schedule");
          await page.locator("#settingsOpen").click();
          await page.locator("#importOpen").click();
          await capture("import");
          await page.locator("#importOpen").click();
          await page.locator("#monthTitle").click();
          await capture("year");
          await page.locator("#monthTitle").click();
          await session?.detach();
          if (errors.length) throw Error(errors.join("\n"));
        } finally {
          await context.close();
        }
      }
    }
    for (const file of fingerprints)
      if (sha256(path.join(sourceRoot, file.path)) !== file.sha256)
        throw Error("Capture source changed during run: " + file.path);
    if (sha256(__filename) !== runnerIdentity.sha256)
      throw Error("Capture runner changed during run");
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      JSON.stringify(
        {
          date: "2026-10-04",
          timezone: "Asia/Shanghai",
          sourceRoot,
          fingerprints,
          runnerIdentity,
          stable,
          paint,
          nativeClock,
          cdp,
          isolatedThemeContexts: true,
          fullPagePaintWarmup: paint,
          randomSeed: 20261004,
          resetRandomSeedOnResize: true,
          samples,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`${samples.length} screenshots captured in ${output}`);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
