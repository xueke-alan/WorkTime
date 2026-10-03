"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { versionHtml } = require("../scripts/version-site.cjs");
const root = path.resolve(__dirname, "..");
const original = fs.readFileSync(path.join(root, "index.html"), "utf8");
const oldController = `WorkUI.createImportController = function () {
  return { bind() { document.getElementById("previewImport").onclick = () => {}; }, dispose() {} };
};`;
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const versioned of [false, true]) {
    const context = await browser.newContext();
    let staleUsed = false;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(
        url.pathname.replace(/^\/WorkTime\//, ""),
      );
      if (!relative)
        return route.fulfill({
          contentType: "text/html",
          body: versioned ? versionHtml(original, root) : original,
        });
      if (
        relative === "assets/js/controllers/imports.js" &&
        !url.searchParams.has("v")
      ) {
        staleUsed = true;
        return route.fulfill({
          contentType: "text/javascript",
          body: oldController,
        });
      }
      const file = path.resolve(root, relative);
      if (
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file) ||
        fs.statSync(file).isDirectory()
      )
        return route.abort();
      const contentType = relative.endsWith(".css")
        ? "text/css"
        : relative.endsWith(".js")
          ? "text/javascript"
          : "application/octet-stream";
      return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    const page = await context.newPage();
    const saved = JSON.stringify({
      sentinel: "Existing browser records must not be cleared",
    });
    await page.addInitScript(
      (saved) => localStorage.setItem("cache-regression-records", saved),
      saved,
    );
    await page.goto("https://xueke-alan.github.io/WorkTime/");
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.appState === expected,
      versioned ? "ready" : "failed",
    );
    assert.equal(staleUsed, !versioned);
    if (!versioned)
      assert(
        (await page.locator("#startupFailure").textContent()).includes(
          "Cannot set properties of null (setting 'onclick')",
        ),
      );
    else {
      assert.equal(await page.locator("#startupFailure").count(), 0);
      await page.locator("#settingsOpen").click();
      await page.locator("#workCity").focus();
      assert.equal(
        await page.locator("#workCityOptions [data-city]").count(),
        6,
      );
    }
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("cache-regression-records"),
      ),
      saved,
    );
    await context.close();
  }
  console.log(
    "Site browser: unversioned stale controller reproduces onclick failure; content-versioned assets start normally without clearing storage.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
