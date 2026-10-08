"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  url = pathToFileURL(path.join(root, "index.html")).href,
  key = "worktime.pageTheme",
  themes = ["green", "blue", "purple", "orange", "rose", "slate"];
let browser;
async function ready(page) {
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function choose(page, theme) {
  await page.locator(`.theme-card:has(input[value="${theme}"])`).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
  assert.equal(await page.locator(`input[value="${theme}"]`).isChecked(), true);
}
async function appearance(page, theme) {
  const styles = await page.evaluate(() => {
    const style = (selector) =>
      getComputedStyle(document.querySelector(selector));
    const rootStyle = style("html");
    const ratio = (a, b) => {
      const luminance = (text) => {
        const rgb = text.startsWith("color(srgb")
          ? text
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
          : text
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map((v) => Number(v) / 255);
        const linear = rgb.map((v) =>
          v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
        );
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const selected = style(".theme-card:has(input:checked)");
    const swatch = style(".theme-card:has(input:checked) .theme-swatch");
    const button = style("#pageSettingsOpen");
    const pane = document.querySelector("#pageSettingsPane");
    const cardRects = [...pane.querySelectorAll(".theme-card")].map((el) =>
      el.getBoundingClientRect(),
    );
    return {
      accent: rootStyle.getPropertyValue("--accent").trim(),
      icon: style("#prevMonth .ui-icon").color,
      favicon: document.querySelector('link[rel="icon"]').getAttribute("href"),
      background: style("body").backgroundImage,
      border: style("#dayStart").borderColor,
      selectedContrast: ratio(swatch.backgroundColor, selected.backgroundColor),
      buttonContrast: ratio(button.color, button.backgroundColor),
      helpRemoved: !pane.querySelector(".theme-help"),
      buttonSize: [...pane.querySelectorAll(".theme-card")].every((card) => {
        const rect = card.getBoundingClientRect(),
          reference = document
            .querySelector("#todayButton")
            .getBoundingClientRect();
        return (
          Math.abs(rect.height - reference.height) < 1 &&
          getComputedStyle(card).borderRadius ===
            style("#todayButton").borderRadius
        );
      }),
      overflow: pane.scrollWidth - pane.clientWidth,
      squares: cardRects.every((r) => Math.abs(r.width - r.height) < 1),
      columns: cardRects.every((r) => Math.abs(r.top - cardRects[0].top) < 1),
      swatches: [...pane.querySelectorAll(".theme-card")].every((card) => {
        const outer = card.getBoundingClientRect(),
          inner = card.querySelector(".theme-swatch").getBoundingClientRect(),
          cardStyle = getComputedStyle(card),
          innerStyle = getComputedStyle(card.querySelector(".theme-swatch")),
          checked = card.querySelector("input").checked;
        return (
          Math.abs(inner.width - inner.height) < 1 &&
          inner.width > outer.width * 0.45 &&
          inner.width < outer.width * 0.65 &&
          parseFloat(innerStyle.borderRadius) > 0 &&
          Math.abs(inner.x + inner.width / 2 - outer.x - outer.width / 2) < 1 &&
          Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2) <
            1 &&
          (checked
            ? innerStyle.backgroundColor === cardStyle.borderTopColor
            : cardStyle.backgroundColor === "rgb(255, 255, 255)" &&
              innerStyle.backgroundColor !== cardStyle.borderTopColor)
        );
      }),
    };
  });
  assert.ok(styles.selectedContrast >= 3, JSON.stringify({ theme, styles }));
  assert.ok(styles.buttonContrast >= 4.5, JSON.stringify({ theme, styles }));
  assert.ok(
    styles.helpRemoved && styles.buttonSize,
    JSON.stringify({ theme, styles }),
  );
  assert.ok(
    styles.overflow <= 1 && styles.squares && styles.columns && styles.swatches,
    JSON.stringify({ theme, styles }),
  );
  return styles;
}
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [390, 1600]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      timezoneId: "Asia/Shanghai",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await ready(page);
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "green",
    );
    const workBefore = await page.evaluate(() =>
      localStorage.getItem(WorkTimeApp.domain.state.KEY),
    );
    await page.locator("#pageSettingsOpen").click();
    const samples = [];
    for (const theme of [
      "blue",
      "purple",
      "orange",
      "rose",
      "slate",
      "green",
    ]) {
      await choose(page, theme);
      samples.push(await appearance(page, theme));
      assert.equal(
        await page.evaluate((k) => localStorage.getItem(k), key),
        theme,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem(WorkTimeApp.domain.state.KEY),
        ),
        workBefore,
      );
      await page.screenshot({
        path: path.join(root, `test-results/theme-${theme}-${width}.png`),
      });
    }
    assert.equal(new Set(samples.map((s) => s.background)).size, 6);
    assert.equal(new Set(samples.map((s) => s.border)).size, 6);
    assert.equal(new Set(samples.map((s) => s.icon)).size, 6);
    assert.equal(new Set(samples.map((s) => s.favicon)).size, 6);
    const second = await context.newPage();
    await ready(second);
    await second.locator("#pageSettingsOpen").click();
    await choose(page, "blue");
    await second.waitForFunction(
      () => document.documentElement.dataset.theme === "blue",
    );
    assert.equal(await second.locator('input[value="blue"]').isChecked(), true);
    await choose(second, "purple");
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "purple",
    );
    await second.close();
    await choose(page, "orange");
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "orange",
    );
    await page.locator("#pageSettingsOpen").click();
    assert.equal(await page.locator('input[value="orange"]').isChecked(), true);
    // Current backups explicitly restore their appearance preferences.
    const backup = await page.evaluate(() =>
      JSON.stringify({
        ...WorkTimeApp.domain.state.defaultState(),
        preferences: { pageTheme: "orange" },
      }),
    );
    await page.locator("#backupFile").setInputFiles({
      name: "theme-restore.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
    await page.locator("#restoreDialog").waitFor({ state: "visible" });
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#backupBeforeRestore").click();
    const downloaded = await downloadEvent;
    const exported = JSON.parse(
      fs.readFileSync(await downloaded.path(), "utf8"),
    );
    assert.equal(JSON.stringify(exported).includes(key), false);
    assert.equal(exported.preferences.pageTheme, "orange");
    await page.locator("#confirmRestore").click();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "orange",
    );
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), key),
      "orange",
    );
    // Test the same-origin event contract, including removal and clear.
    await page.evaluate((k) => {
      localStorage.setItem(k, "purple");
      dispatchEvent(
        new StorageEvent("storage", {
          key: k,
          newValue: "purple",
          storageArea: localStorage,
        }),
      );
    }, key);
    assert.equal(await page.locator('input[value="purple"]').isChecked(), true);
    await page.evaluate((k) => {
      sessionStorage.setItem(k, "blue");
      dispatchEvent(
        new StorageEvent("storage", {
          key: k,
          newValue: "blue",
          storageArea: sessionStorage,
        }),
      );
    }, key);
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "purple",
    );
    await page.evaluate((k) => {
      localStorage.removeItem(k);
      dispatchEvent(
        new StorageEvent("storage", {
          key: k,
          newValue: null,
          storageArea: localStorage,
        }),
      );
    }, key);
    assert.equal(await page.locator('input[value="green"]').isChecked(), true);
    await page.evaluate((k) => localStorage.setItem(k, "invalid"), key);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "green",
    );
    const disposed = await page.evaluate(() => {
      const host = document.createElement("div");
      const picker = WorkTimeApp.ui.theme.mount(host);
      picker.dispose();
      WorkTimeApp.ui.theme.apply("blue");
      const unchanged = host.querySelector('input[value="green"]').checked;
      host
        .querySelector('input[value="purple"]')
        .dispatchEvent(new Event("change", { bubbles: true }));
      return unchanged && document.documentElement.dataset.theme === "blue";
    });
    assert.equal(
      disposed,
      true,
      "Disposed pickers must neither listen nor save",
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Storage failures are scoped to appearance; the work record store still works.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.addInitScript((k) => {
    const read = Storage.prototype.getItem,
      write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === k) throw Error("blocked");
      return read.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === k) throw Error("blocked");
      return write.call(this, name, value);
    };
  }, key);
  const page = await context.newPage();
  await ready(page);
  await page.locator("#pageSettingsOpen").click();
  await choose(page, "blue");
  assert.equal(
    await page.locator(".theme-save-notice").textContent(),
    "主题已应用，但未能保存，刷新后可能恢复默认",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "green");
  await context.close();
  await browser.close();
  browser = null;
  // Native browser zoom, using isolated temporary profiles.
  for (const factor of [1.25, 1.5]) {
    const profile = fs.mkdtempSync(
      path.join(os.tmpdir(), "worktime-theme-zoom-"),
    );
    let zoomContext;
    try {
      fs.mkdirSync(path.join(profile, "Default"));
      fs.writeFileSync(
        path.join(profile, "Default", "Preferences"),
        JSON.stringify({
          partition: {
            default_zoom_level: { x: Math.log(factor) / Math.log(1.2) },
          },
        }),
      );
      zoomContext = await chromium.launchPersistentContext(profile, {
        channel: "msedge",
        headless: true,
        viewport: null,
        args: ["--window-size=1600,1000"],
        reducedMotion: "reduce",
      });
      const zoomPage = zoomContext.pages()[0];
      await ready(zoomPage);
      await zoomPage.locator("#pageSettingsOpen").click();
      for (const theme of themes) {
        await choose(zoomPage, theme);
        await appearance(zoomPage, theme);
      }
      await zoomPage.screenshot({
        path: path.join(root, `test-results/theme-zoom-${factor}.png`),
      });
    } finally {
      await zoomContext?.close();
      assert.ok(
        path
          .resolve(profile)
          .startsWith(
            path.resolve(os.tmpdir()) + path.sep + "worktime-theme-zoom-",
          ),
      );
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
  console.log(
    "Themes: six palettes, contrast, keyboard companion coverage, responsive layout, native zoom, persistence, explicit preference restore, storage errors and synchronization passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());
