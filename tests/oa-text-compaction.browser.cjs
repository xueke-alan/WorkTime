"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=DomainTest",
  realm,
);
const C = realm.C;
const raw =
  "姓名：测试\n部门：研发\n10/08\n周四\n查看详情\n08:00\n18:00\n退出登录\n10/09\n08:00\n12:00\n18:00";
const state = C.defaultState();
const records = C.parseText(raw, 2026, "clipboard").records;
state.imports.push({
  id: "old",
  at: "2026-10-08T10:00:00Z",
  year: 2026,
  sources: [{ name: "clipboard", raw }],
  records,
  count: records.length,
});
for (const record of records) C.applyObservation(state, record, "old");
const original = JSON.stringify(state);
const compact = C.compactOAText(raw);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const errors = [];
  for (const width of [2250, 390])
    for (const fail of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-10-12T12:00:00+08:00") });
      await page.addInitScript(
        ({ original, fail }) => {
          localStorage.setItem("worktime-local-v1", original);
          window.failOAWrite = fail;
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === "worktime-local-v1" && window.failOAWrite)
              throw new DOMException("test full", "QuotaExceededError");
            return set.call(this, key, value);
          };
        },
        { original, fail },
      );
      await page.goto(
        require("node:url").pathToFileURL(
          path.resolve(__dirname, "../index.html"),
        ).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.clock.runFor(500);
      const stored = () =>
        page.evaluate(() => localStorage.getItem("worktime-local-v1"));
      if (fail) {
        assert.equal(await stored(), original);
        assert.equal(
          await page
            .locator("#storageNotice")
            .evaluate((el) => el.classList.contains("hidden")),
          false,
        );
        assert(await page.locator("#storageNotice").isVisible());
        assert.match(
          await page.locator("#storageNoticeText").textContent(),
          /更改未保存/,
        );
      } else
        assert.equal(
          JSON.parse(await stored()).imports[0].sources[0].raw,
          compact,
        );
      await page.locator('[data-date="2026-10-08"]').click();
      await page.locator("#sourceOpen").click();
      assert.equal(
        await page.locator("#importDetailRawText").inputValue(),
        compact,
      );
      assert.equal(
        await page.locator(".import-detail-raw-label").textContent(),
        "核心打卡文本",
      );
      assert.equal(
        await page.locator("#importDetailRawText").getAttribute("aria-label"),
        "核心打卡文本",
      );
      assert.equal(
        await page
          .locator("#sourceBody")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      if (!fail)
        await page.screenshot({
          path: path.resolve(
            __dirname,
            `../test-results/oa-core-text-${width}.png`,
          ),
        });
      if (fail) {
        await page.evaluate(() => {
          window.failOAWrite = false;
        });
        await page.locator("#retryStorage").click();
        await page.waitForFunction(() =>
          document.getElementById("storageNotice").classList.contains("hidden"),
        );
        assert.equal(
          JSON.parse(await stored()).imports[0].sources[0].raw,
          compact,
        );
      }
      // Both new clipboard and pasted imports must compact only at the save boundary.
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: { readText: async () => "菜单\n10/10\n08:00\n18:00\n退出" },
          configurable: true,
        });
      });
      await page.locator("[data-import-clipboard]").first().click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1")).imports
            .length === 2,
      );
      assert.equal(
        JSON.parse(await stored()).imports[1].sources[0].raw,
        "10/10\n08:00\n18:00",
      );
      await page.locator("#importOpen").click();
      await page
        .locator("#pasteText")
        .fill("部门：研发\n10/11\n08:00\n18:00\n菜单");
      await page.clock.runFor(500);
      await page.locator("#commitImport").click();
      assert.equal(
        JSON.parse(await stored()).imports[2].sources[0].raw,
        "10/11\n08:00\n18:00",
      );
      await context.close();
    }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "OA compaction browser passed: desktop/mobile startup migration, quota/retry, core text detail and clipboard imports.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
