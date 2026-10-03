"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  for (const width of [2250, 390]) {
    const page = await browser.newPage({
        viewport: { width, height: width === 2250 ? 1244 : 884 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
    const fixture = buildPerformanceFixture(1).state;
    await page.addInitScript(
      (s) => localStorage.setItem("worktime-local-v1", JSON.stringify(s)),
      fixture,
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    const calendarBefore = await page.locator("#calendar").boundingBox();
    const persistentGeometry = () =>
      page.locator(".summary-sidebar").evaluate((sidebar) => {
        const origin = sidebar.getBoundingClientRect();
        return [".sidebar-header", "#importOpen", ".summary-divider"].map(
          (selector) => {
            const element = sidebar.querySelector(selector),
              rect = element.getBoundingClientRect();
            return {
              selector,
              visible: element.getClientRects().length > 0,
              x: rect.x - origin.x,
              y: rect.y - origin.y,
              width: rect.width,
              height: rect.height,
            };
          },
        );
      });
    const headerBefore = await persistentGeometry();
    const importLabelGeometry = () =>
      page.locator("#importOpen").evaluate((button) => {
        const origin = button.getBoundingClientRect();
        return [
          ...button.querySelectorAll(
            ".import-main > .ui-icon, .import-main > span",
          ),
        ].map((element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x - origin.x, width: rect.width };
        });
      });
    const labelBefore = await importLabelGeometry();
    await page.locator("#importOpen").click();
    assert.deepEqual(await importLabelGeometry(), labelBefore);
    assert.deepEqual(await persistentGeometry(), headerBefore);
    assert.equal(await page.locator("#previewImport").count(), 0);
    assert.equal(await page.locator("#importDialog .dialog-head").count(), 0);
    assert.equal(
      await page.locator("#pasteText").getAttribute("placeholder"),
      "粘贴 OA 记录文本",
    );
    const actionTops = await page
      .locator("#importDialog .dialog-foot button:not([hidden])")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => button.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
          .map((rect) => rect.top),
      );
    assert.equal(actionTops.length, 2);
    assert.equal(
      await page.locator("#importOpen .import-main > span").textContent(),
      "返回概览",
    );
    assert.match(
      await page.locator("#importHistoryCount").textContent(),
      new RegExp("^共 " + fixture.imports.length + " 条记录 · "),
    );
    assert.equal(
      await page.locator("[data-view-import]").first().textContent(),
      "",
    );
    assert.equal(
      await page.locator("[data-delete-import]").first().textContent(),
      "",
    );
    const historyActions = await page
      .locator("#importHistoryList .import-history-item")
      .first()
      .evaluate((card) => {
        const buttons = [...card.querySelectorAll("button")];
        return {
          plain: buttons.every((button) => {
            const style = getComputedStyle(button);
            return (
              style.borderTopWidth === "0px" &&
              style.boxShadow === "none" &&
              style.backgroundColor === "rgba(0, 0, 0, 0)"
            );
          }),
          gap:
            buttons[1].getBoundingClientRect().left -
            buttons[0].getBoundingClientRect().right,
        };
      });
    assert(historyActions.plain && historyActions.gap >= 9);
    assert.equal(Math.max(...actionTops) - Math.min(...actionTops), 0);
    const alignedEdges = await page
      .locator("#importDialog")
      .evaluate((pane) => {
        const top = document
            .getElementById("importOpen")
            .getBoundingClientRect(),
          input = document.getElementById("pasteText").getBoundingClientRect(),
          oa = document.getElementById("oaShortcut").getBoundingClientRect(),
          confirm = pane.querySelector("#commitImport").getBoundingClientRect();
        return [
          input.left - top.left,
          input.right - top.right,
          oa.left - top.left,
          confirm.right - top.right,
        ];
      });
    assert(alignedEdges.every((difference) => Math.abs(difference) < 1));
    assert(
      await page
        .locator("#importDialog")
        .evaluate((e) => e.closest(".summary-sidebar") && !e.matches(":modal")),
    );
    assert.equal(await page.locator("dialog:modal").count(), 0);
    assert(await page.locator("#cards").isHidden());
    const draft = "10/08\n08:00\n20:00";
    assert.deepEqual(await persistentGeometry(), headerBefore);
    assert(await page.locator("#importHistoryList").isVisible());
    await page.locator("[data-view-import]").first().click();
    assert(await page.locator("#sourceDialog").isVisible());
    assert.equal(
      await page.locator("#importOpen .import-main > span").textContent(),
      "返回导入",
    );
    assert.deepEqual(await persistentGeometry(), headerBefore);
    assert.equal(await page.locator("dialog:modal").count(), 0);
    assert.match(
      await page.locator("#sourceBody").textContent(),
      /\d+ 条记录 · \d+ 条异常/,
    );
    assert(
      await page.locator("#sourceDialog .dialog-head [data-close]").isHidden(),
    );
    assert(await page.locator("#sourceBody .import-parsed-list").isVisible());
    assert(await page.locator('[data-detail-step="-1"]').isDisabled());
    const firstTitle = await page.locator("#sourceDialog h2").textContent();
    await page.locator('[data-detail-step="1"]').click();
    assert.notEqual(
      await page.locator("#sourceDialog h2").textContent(),
      firstTitle,
    );
    await page.locator('[data-detail-step="-1"]').click();
    assert.equal(
      await page.locator("#sourceDialog h2").textContent(),
      firstTitle,
    );
    await page.locator("[data-detail-toggle]").click();
    assert(await page.locator("#sourceBody pre").first().isVisible());
    assert.equal(
      await page.locator("#sourceBody .import-source-heading").count(),
      0,
    );
    const rawScroll = await page.locator("#sourceBody").evaluate((body) => {
      const pre = body.querySelector("pre"),
        toolbar = body.querySelector(".import-detail-toolbar"),
        before = toolbar.getBoundingClientRect().top;
      pre.scrollTop = pre.scrollHeight;
      return {
        innerScrolled: pre.scrollTop > 0,
        outerScroll: body.scrollTop,
        toolbarStable: toolbar.getBoundingClientRect().top === before,
      };
    });
    assert(
      rawScroll.innerScrolled &&
        rawScroll.outerScroll === 0 &&
        rawScroll.toolbarStable,
    );
    await page.locator("[data-detail-toggle]").click();
    assert(await page.locator("#sourceBody .import-parsed-list").isVisible());
    await page.screenshot({
      path: path.resolve(__dirname, `../docs/oa-sidebar-detail-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.locator("#importDialog").waitFor({ state: "visible" });
    await page.locator("#pasteText").fill(draft);
    await page.waitForFunction(
      () => !document.getElementById("commitImport").disabled,
    );
    assert.equal(
      await page.locator("#importResultsTitle").textContent(),
      "记录解析结果",
    );
    assert.equal(
      await page.locator("#importHistoryCount").textContent(),
      "共 1 条记录 · 0 条异常记录",
    );
    assert(await page.locator("#importHistoryList").isHidden());
    assert.equal(await page.locator("#importRows > article").count(), 1);
    assert.equal(await page.locator("#commitImport").isEnabled(), true);
    const geometry = await page.locator("#importDialog").evaluate((e) => {
      const sidebar = e.closest(".summary-sidebar").getBoundingClientRect(),
        rect = e.getBoundingClientRect();
      return {
        inside:
          rect.left >= sidebar.left - 1 && rect.right <= sidebar.right + 1,
        bodyScrollable: getComputedStyle(e.querySelector(".dialog-body"))
          .overflowY,
        footerVisible:
          e.querySelector(".dialog-foot").getBoundingClientRect().bottom <=
          sidebar.bottom + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        belowDivider:
          rect.top >=
          e
            .closest(".summary-sidebar")
            .querySelector(".summary-divider")
            .getBoundingClientRect().bottom,
      };
    });
    const historyLayout = await page
      .locator(".sidebar-history-scroll")
      .evaluate((e) => ({
        scrollable: getComputedStyle(e).overflowY === "auto",
        height: e.clientHeight,
        contentHeight: e.scrollHeight,
        belowActions:
          e.getBoundingClientRect().top >=
          document
            .querySelector("#importDialog .dialog-foot")
            .getBoundingClientRect().bottom,
      }));
    assert(
      historyLayout.scrollable &&
        historyLayout.height > 0 &&
        historyLayout.belowActions,
    );
    await page.locator(".sidebar-history-scroll").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    if (historyLayout.contentHeight > historyLayout.height)
      assert(
        await page
          .locator(".sidebar-history-scroll")
          .evaluate((e) => e.scrollTop > 0),
      );
    await page.locator(".sidebar-history-scroll").evaluate((e) => {
      e.scrollTop = 0;
    });
    assert(
      geometry.inside &&
        geometry.footerVisible &&
        !geometry.pageOverflow &&
        geometry.belowDivider,
    );
    if (width === 2250) {
      const after = await page.locator("#calendar").boundingBox();
      assert.deepEqual(
        after,
        calendarBefore,
        "Calendar stays in its existing column",
      );
    }
    await page.screenshot({
      path: path.resolve(__dirname, `../docs/oa-sidebar-import-${width}.png`),
      fullPage: true,
    });
    await page.locator("#commitImport").click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".summary-sidebar")
          .classList.contains("is-oa-open"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1")).days[
            "2026-10-08"
          ].oa.end,
      ),
      "20:00",
    );
    assert(await page.locator("#cards").isVisible());
    assert.equal(
      await page.locator("#importOpen .import-main > span").textContent(),
      "OA记录",
    );
    await page.locator("#importOpen").click();
    await page.locator("[data-delete-import]").first().click();
    assert(
      await page
        .locator("#deleteImportDialog")
        .evaluate((e) => e.matches(":modal")),
    );
    await page.locator("#confirmDeleteImport").click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1")).imports.length,
      ),
      fixture.imports.length,
    );
    await page.locator("#importOpen .import-main").click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".summary-sidebar")
          .classList.contains("is-oa-open"),
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      geometry,
      historyLayout,
      importAndDelete: true,
      nestedBackRetainedDraft: true,
      noModalOA: true,
      persistentHeaderAndDivider: true,
      pageErrors: errors,
    });
    await page.close();
  }
  fs.writeFileSync(
    path.resolve(__dirname, "../docs/oa-sidebar-results.json"),
    JSON.stringify({ complete: true, results }, null, 2),
  );
  console.log(
    "OA sidebar passed: 2250/390, inline views, nested draft return, import/delete, no overflow and calendar preserved.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});
