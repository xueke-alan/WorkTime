"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
process.env.WORKTIME_TEST_CLIPBOARD = "1";
require("./lib/browser-test-setup.cjs");
let browser;
const entry = pathToFileURL(
  path.resolve(process.env.WORKTIME_TEST_ROOT || ".", "index.html"),
).href;
(async () => {
  browser = await require("playwright").chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  for (const state of [
    "granted",
    "prompt",
    "denied",
    "unsupported",
    "background",
    "rejected",
    "skipped",
  ]) {
    const page = await browser.newPage();
    await page.addInitScript((state) => {
      window.permissionQueries = 0;
      window.permissionReads = 0;
      window.permissionFocused = state !== "background";
      document.hasFocus = () => window.permissionFocused;
      navigator.permissions.query = async () => {
        window.permissionQueries++;
        if (state === "unsupported")
          throw new TypeError("Unsupported permission");
        return {
          state: ["background", "rejected", "skipped"].includes(state)
            ? "prompt"
            : state,
        };
      };
      Object.defineProperty(navigator, "clipboard", {
        value: {
          async readText() {
            window.permissionReads++;
            if (state === "rejected")
              throw new DOMException("Denied", "NotAllowedError");
            return "10/09\n08:00\n18:00";
          },
        },
        configurable: true,
      });
    }, state);
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    if (state === "background") {
      assert.equal(await page.evaluate(() => window.permissionQueries), 0);
      await page.evaluate(() => {
        window.permissionFocused = true;
        window.dispatchEvent(new Event("focus"));
      });
    }
    await page.waitForFunction(() => window.permissionQueries === 1);
    if (["prompt", "background", "rejected", "skipped"].includes(state)) {
      await page.locator("#startupPermissionsDialog").waitFor();
      assert.equal(await page.evaluate(() => window.permissionReads), 0);
      if (state === "skipped")
        await page.locator("#clipboardPermissionSkip").click();
      else {
        await page.locator("#clipboardPermissionAllow").click();
        await page.waitForFunction(() => window.permissionReads === 1);
      }
      await page
        .locator("#startupPermissionsDialog")
        .waitFor({ state: "hidden" });
    } else
      assert.equal(await page.locator("#startupPermissionsDialog").count(), 0);
    assert.equal(
      await page.evaluate(() => window.permissionReads),
      ["prompt", "background", "rejected"].includes(state) ? 1 : 0,
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.permissionQueries), 1);
    assert.equal(await page.locator("#pasteText").inputValue(), "");
    assert.equal(
      await page.locator("#importDialog").evaluate((el) => el.open),
      false,
    );
    await page.close();
  }
  for (const width of [1920, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1080 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const loaded = new Promise((resolve) => {
        window.releaseImportLoad = resolve;
      });
      document.addEventListener(
        "worktime:ready",
        () => {
          const assets = WorkTimeApp.services.assets,
            script = assets.script;
          assets.script = (url, ...args) =>
            url.includes("secondary-runtime")
              ? loaded.then(() => script.call(assets, url, ...args))
              : script.call(assets, url, ...args);
        },
        { once: true },
      );
      window.readCount = 0;
      navigator.permissions.query = async () => ({ state: "granted" });
      window.clipboardText = "10/09\n08:00\n18:00";
      window.clipboardDenied = false;
      window.deferClipboard = false;
      window.oaFocused = true;
      document.hasFocus = () => window.oaFocused;
      window.open = () => {
        window.oaFocused = false;
        window.dispatchEvent(new Event("blur"));
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async readText() {
            window.readCount++;
            if (window.deferClipboard)
              await new Promise((resolve) => {
                window.resolveClipboard = resolve;
              });
            if (window.clipboardDenied)
              throw new DOMException("Denied", "NotAllowedError");
            return window.clipboardText;
          },
        },
      });
    });
    await page.goto(entry);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const input = page.locator("#pasteText");
    const site = page.locator("#importOASite");
    const resume = () =>
      page.evaluate(() => {
        window.oaFocused = true;
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
    await resume();
    assert.equal(await page.evaluate(() => window.readCount), 0);
    await site.click();
    assert.equal(await page.evaluate(() => window.readCount), 0);
    await resume();
    assert.equal(await page.evaluate(() => window.readCount), 0);
    await page.evaluate(() => window.releaseImportLoad());
    await page.waitForFunction(() =>
      document.querySelector("#pasteText").value.includes("10/09"),
    );
    await page.waitForFunction(
      () => !document.querySelector("#commitImport").disabled,
    );
    const notice = page.locator("#importClipboardNotice");
    assert.equal(await notice.isVisible(), true);
    const noticeBox = await notice.boundingBox(),
      pasteBox = await page.locator("#pasteOAClipboard").boundingBox();
    assert.ok(Math.abs(noticeBox.height - pasteBox.height) < 1);
    assert.ok(Math.abs(noticeBox.y - pasteBox.y) < 1);
    assert.ok(noticeBox.x + noticeBox.width < pasteBox.x);
    assert.equal(
      await page.locator("#importHistoryList [data-view-import]").count(),
      0,
    );
    await resume();
    assert.equal(await page.evaluate(() => window.readCount), 1);
    // Existing text prevents even a read.
    await site.evaluate((button) => button.click());
    await resume();
    assert.equal(await page.evaluate(() => window.readCount), 1);
    await input.fill("");
    assert.equal(await notice.isVisible(), false);
    await site.evaluate((button) => button.click());
    await page.evaluate(() => {
      window.clipboardText = "";
    });
    await resume();
    await page.waitForFunction(() => window.readCount === 2);
    assert.equal(await input.inputValue(), "");
    await page.evaluate(() => {
      window.clipboardDenied = true;
    });
    await site.evaluate((button) => button.click());
    await resume();
    await page.waitForFunction(() => window.readCount === 3);
    assert.equal(await input.inputValue(), "");
    await resume();
    assert.equal(await page.evaluate(() => window.readCount), 3);
    // Editing and then clearing while awaiting the clipboard still cancels it.
    await page.evaluate(() => {
      window.clipboardDenied = false;
      window.deferClipboard = true;
      window.clipboardText = "10/10\n08:00\n18:00";
    });
    await site.evaluate((button) => button.click());
    await resume();
    await page.waitForFunction(() => !!window.resolveClipboard);
    await input.fill("my draft");
    await input.fill("");
    await page.evaluate(() => window.resolveClipboard());
    await page.waitForTimeout(300);
    assert.equal(await input.inputValue(), "");
    // Closing and reopening the pane invalidates an outstanding read.
    await page.evaluate(() => {
      window.resolveClipboard = null;
    });
    await site.evaluate((button) => button.click());
    await resume();
    await page.waitForFunction(() => !!window.resolveClipboard);
    await page.evaluate(() => document.querySelector("#importDialog").close());
    await page.locator("#importOpen").click();
    await page.evaluate(() => window.resolveClipboard());
    await page.waitForTimeout(300);
    assert.equal(await input.inputValue(), "");
    // The left entry also arms a single return read; unrelated text stays out.
    await page.evaluate(() => {
      window.deferClipboard = false;
      window.clipboardText = "unrelated clipboard text";
      window.oaFocused = false;
      window.dispatchEvent(new Event("blur"));
    });
    const beforeInvalid = await page.evaluate(() => window.readCount);
    await resume();
    await page.waitForFunction(
      (count) => window.readCount > count,
      beforeInvalid,
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(await notice.isVisible(), false);
    await page.locator("#pasteOAClipboard").click();
    assert.equal(await input.inputValue(), "");
    await page.evaluate(() => document.querySelector("#importDialog").close());
    await page.locator("#importOpen").click();
    await page.evaluate(() => {
      window.clipboardText = "10/11\n08:00\n18:00";
      window.oaFocused = false;
      window.dispatchEvent(new Event("blur"));
    });
    await resume();
    await page.waitForFunction(() =>
      document.querySelector("#pasteText").value.includes("10/11"),
    );
    assert.equal(await notice.isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(() => {
    navigator.permissions.query = async () => ({ state: "granted" });
  });
  await page.context().route(/^https?:/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>OA test</title>",
    }),
  );
  await page.goto(entry);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#importOASite").focus();
  const popupReady = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const popup = await popupReady;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).hostname, "hr.huawei.com");
  await popup.close();
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector("#importDialog").open,
  );
  await page.close();
  console.log(
    "OA return clipboard: once per visit, preview only, draft protection, empty/denied reads and close cancellation passed at desktop/mobile widths.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
  });
