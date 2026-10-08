"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  crypto = require("node:crypto");
const { versionHtml } = require("../scripts/version-site.cjs");
const root = path.resolve(__dirname, ".."),
  entryPath = "tools/convert-backup.html";
const html = fs.readFileSync(path.join(root, entryPath), "utf8");
const fixture = fs.readFileSync(
  path.join(root, "tests/fixtures/legacy-oracle-2026-10-04.js.gz"),
);
const provenance = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "tests/fixtures/legacy-oracle-2026-10-04.js.gz.source.json",
    ),
    "utf8",
  ),
);
const oldLegacy = zlib.gunzipSync(fixture);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(fixture), provenance.fixtureSha256);
assert.equal(sha(oldLegacy), provenance.sourceSha256);
const input = fs.readFileSync(
  path.join(root, "tests/fixtures/legacy-schema1.json"),
  "utf8",
);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const versioned of [false, true]) {
    const context = await browser.newContext();
    let staleUsed = false;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url()),
        relative = decodeURIComponent(url.pathname.slice(1));
      assert.equal(
        url.origin,
        "https://converter-cache.test",
        "No external requests",
      );
      if (relative === entryPath)
        return route.fulfill({
          contentType: "text/html",
          body: versioned ? versionHtml(html, root, { entryPath }) : html,
        });
      if (relative === "tools/legacy-v2.js" && !url.searchParams.has("v")) {
        staleUsed = true;
        return route.fulfill({
          contentType: "text/javascript",
          body: oldLegacy,
        });
      }
      const file = path.resolve(root, relative);
      if (
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      )
        return route.abort();
      return route.fulfill({
        contentType: relative.endsWith(".css") ? "text/css" : "text/javascript",
        body: fs.readFileSync(file),
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        "conversion-cache-sentinel",
        "preserve existing records",
      ),
    );
    await page.goto("https://converter-cache.test/" + entryPath);
    await page.locator("#backupInput").fill(input);
    await page.locator("#convert").click();
    if (versioned) {
      await page.waitForFunction(
        () => document.getElementById("backupOutput").value.length > 0,
      );
      const result = JSON.parse(
        await page.locator("#backupOutput").inputValue(),
      );
      assert.equal(result.schemaVersion, 3);
      assert.equal(result.imports[0].records.length, 2);
      assert.equal(result.days["2026-09-28"].oa.raw, "09/28\n08:00\n18:00");
      assert.equal(await page.locator("#download").isEnabled(), true);
    } else {
      await page.waitForFunction(() =>
        document.getElementById("status").textContent.startsWith("转换失败"),
      );
      assert.match(
        await page.locator("#status").textContent(),
        /acceptedRecords/,
      );
      assert.equal(await page.locator("#backupOutput").inputValue(), "");
      assert.equal(await page.locator("#download").isEnabled(), false);
    }
    assert.equal(staleUsed, !versioned);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("conversion-cache-sentinel"),
      ),
      "preserve existing records",
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Converter cache passed: mixed old facade/new converter failure reproduced; versioned relative shared/local dependencies convert normally and preserve storage.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
