"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const [, file] of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g))
  assert(fs.existsSync(path.join(root, file)), "Missing local asset: " + file);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await context.setOffline(true);
  const page = await context.newPage(),
    errors = [],
    network = [],
    failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.goto(
    require("node:url").pathToFileURL(path.join(root, "index.html")).href,
  );
  await page.locator("#dayStart").waitFor({ state: "visible" });
  assert.deepEqual(
    await page.evaluate(() => ({
      facade: typeof WorkTime,
      testAssembly: typeof DomainTest,
      modules: Object.keys(WorkTimeApp.domain).sort(),
    })),
    {
      facade: "undefined",
      testAssembly: "undefined",
      modules: [
        "calendar",
        "observations",
        "payday",
        "preferences",
        "records",
        "schedule",
        "state",
        "statistics",
        "time",
        "validation",
      ],
    },
    "Offline production entry exports domain modules without the old facade or test assembly",
  );
  assert.equal(
    await page.evaluate(() => typeof WorkTimeApp.ui.theme.save),
    "undefined",
    "Theme view must not export storage operations",
  );
  assert(
    await page.evaluate(() =>
      Object.isFrozen(WorkTimeApp.services.preferences.page.state),
    ),
    "Preference snapshots are immutable",
  );
  await page.locator("#monthTitle").click();
  assert.equal(await page.locator(".year-month").count(), 12);
  await page.locator("[data-year-date]").first().click();
  await page.locator("#settingsOpen").click();
  assert(await page.locator("#settingsDialog").evaluate((e) => e.open));
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  assert.deepEqual(failed, []);
  console.log(
    "Offline entry passed: all referenced local assets present; file:// starts and renders year/settings with network disabled and no remote requests.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
