"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setRange = require("./lib/agenda-test-range.cjs");

async function compactHint(page, trigger) {
  const hint = page.locator("#siteHint");
  await hint.waitFor({ state: "visible" });
  assert.equal(await trigger.getAttribute("aria-describedby"), "siteHint");
  const style = await hint.evaluate((node) => {
    const surface = getComputedStyle(node);
    const arrow = getComputedStyle(node, "::after");
    return {
      fontSize: surface.fontSize,
      padding: surface.padding,
      textAlign: surface.textAlign,
      borderColor: surface.borderTopColor,
      radius: surface.borderRadius,
      shadow: surface.boxShadow,
      background: surface.backgroundColor,
      arrowBackground: arrow.backgroundColor,
      arrowWidth: arrow.width,
      side: node.dataset.popArrowSide,
      arrowCenter: parseFloat(arrow.top) + node.clientTop,
      height: node.offsetHeight,
    };
  });
  const { side, arrowCenter, height, ...appearance } = style;
  assert.ok(["top", "bottom"].includes(side));
  assert.ok(Math.abs(arrowCenter - (side === "top" ? 0 : height)) < 1);
  assert.equal(style.arrowBackground, style.background);
  assert.equal(style.arrowWidth, "10px");
  assert.equal(style.textAlign, "center");
  assert.equal(style.fontSize, "12px");
  assert.equal(style.padding, "6px 10px");
  return appearance;
}

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const mode of ["native", "missing-api", "missing-selector"]) {
      for (const width of [1480, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          locale: "zh-CN",
          reducedMotion: "reduce",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/^https?:/, (route) => route.abort());
        await page.addInitScript((mode) => {
          localStorage.setItem("worktime.onboarding.v1", "dismissed");
          if (mode === "missing-api") {
            HTMLElement.prototype.showPopover = undefined;
            HTMLElement.prototype.hidePopover = undefined;
          }
          if (mode !== "native") {
            for (const [prototype, key] of [
              [Element.prototype, "matches"],
              [Element.prototype, "querySelector"],
              [Document.prototype, "querySelector"],
            ]) {
              const original = prototype[key];
              prototype[key] = function (selector) {
                if (selector.includes(":popover-open"))
                  throw new DOMException(
                    "Unsupported :popover-open",
                    "SyntaxError",
                  );
                return original.call(this, selector);
              };
            }
          }
        }, mode);
        await page.goto(
          pathToFileURL(path.resolve(process.argv[2] || ".", "index.html"))
            .href,
        );
        await page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );

        const marker = page.locator("#calendar .date-markers").first();
        // Finish the narrow layout's scroll before opening a scroll-dismissed hint.
        await marker.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        const hintText = await marker.getAttribute("data-date-marker-hint");
        await marker.hover();
        await page.locator("#siteHint").waitFor({ state: "visible" });
        assert.equal(await page.locator("#siteHint").textContent(), hintText);
        const markerAppearance = await compactHint(page, marker);
        assert.equal(
          await marker.getAttribute("title"),
          null,
          "The custom hint is the only marker tooltip",
        );
        const hintBox = await page.locator("#siteHint").boundingBox();
        assert.ok(hintBox.x >= 0 && hintBox.x + hintBox.width <= width);
        await page.mouse.move(0, 0);
        await page.locator("#siteHint").waitFor({ state: "hidden" });
        await page.waitForFunction(() => !document.querySelector(".pop-arrow"));
        await marker.focus();
        await page.locator("#siteHint").waitFor({ state: "visible" });
        await page.keyboard.press("Escape");
        await page.locator("#siteHint").waitFor({ state: "hidden" });
        const hint = page.locator("#siteHint");
        for (const [id, label] of [
          ["prevMonth", "上个月"],
          ["monthTitle", "年视图"],
          ["nextMonth", "下个月"],
          ["todayButton", "当日"],
          ["analysisToggle", "作息分析"],
          ["agendaMode", "日程"],
          ["batchToggle", "批量填写"],
          ["restore", "导入备份"],
          ["pageSettingsOpen", "设置"],
        ]) {
          const control = page.locator("#" + id);
          const title = await control.getAttribute("title");
          await control.hover();
          assert.deepEqual(await compactHint(page, control), markerAppearance);
          assert.equal(await hint.textContent(), label, id);
          await page.keyboard.press("Escape");
          await hint.waitFor({ state: "hidden" });
          assert.equal(await control.getAttribute("title"), title, id);
        }
        await page.locator("#monthTitle").focus();
        await hint.waitFor({ state: "visible" });
        assert.equal(await hint.textContent(), "年视图");
        await page.keyboard.press("Escape");
        await hint.waitFor({ state: "hidden" });
        const today = page.locator("#todayButton");
        await page.locator("#prevMonth").click();
        await page.waitForFunction(
          () => document.getElementById("todayButton").ariaLabel === "当月",
        );
        await today.hover();
        await hint.waitFor({ state: "visible" });
        assert.equal(await hint.textContent(), "当月");
        await today.click();
        await page.waitForFunction(
          () => document.getElementById("todayButton").ariaLabel === "当日",
        );
        await page.mouse.move(0, 0);
        await hint.waitFor({ state: "hidden" });
        const nextDay = page.locator("#dayNextToggle");
        const nextDayText = await nextDay.getAttribute("title");
        await nextDay.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        await nextDay.focus();
        assert.deepEqual(await compactHint(page, nextDay), markerAppearance);
        assert.equal(
          await page.locator("#siteHint").textContent(),
          nextDayText,
        );
        await page.keyboard.press("Escape");
        await page.locator("#siteHint").waitFor({ state: "hidden" });
        await page.evaluate(() => {
          const fixture = document.createElement("div");
          fixture.id = "hintFixture";
          fixture.style.cssText = "position:fixed;top:0;left:0;z-index:9999";
          fixture.innerHTML =
            '<button id="redundantHint" title="擦除">擦除</button><button id="usefulHint" data-hint="detail" title="擦除所选单元格，保留题目数字">擦除</button><button id="iconHint" title="更多操作" aria-label="更多操作">⋯</button><button id="errorHint" data-hint="detail" title="加载失败，点击重试" aria-label="加载失败，点击重试">!</button><button id="clippedHint" style="width:50px;overflow:hidden;white-space:nowrap" title="非常长的完整文件名称" aria-label="非常长的完整文件名称">非常长的完整文件名称</button><button id="oaHint" title="打开 OA 导入" aria-label="OA记录">OA记录</button><span id="musicHint" tabindex="0" title="本地音乐" aria-label="本地音乐">♫</span><h2 id="libraryHint" tabindex="0" title="你的音乐库">音乐库</h2><button id="songsHint" title="歌曲列表"><span>♫</span></button>';
          document.body.append(fixture);
        });
        await page.locator("#redundantHint").hover();
        assert.equal(await page.locator("#siteHint").isVisible(), false);
        assert.equal(
          await page.locator("#redundantHint").getAttribute("title"),
          "",
        );
        await page.locator("#iconHint").hover();
        await page.waitForTimeout(300);
        assert.equal(await page.locator("#siteHint").isVisible(), false);
        await page.locator("#iconHint").focus();
        await page.waitForTimeout(50);
        assert.equal(await page.locator("#siteHint").isVisible(), false);
        assert.equal(
          await page.locator("#iconHint").getAttribute("aria-label"),
          "更多操作",
        );
        for (const id of ["oaHint", "musicHint", "libraryHint", "songsHint"]) {
          const control = page.locator("#" + id);
          await control.hover();
          await page.waitForTimeout(300);
          assert.equal(await page.locator("#siteHint").isVisible(), false, id);
          assert.equal(await control.getAttribute("title"), "", id);
          await control.focus();
          await page.waitForTimeout(50);
          assert.equal(await page.locator("#siteHint").isVisible(), false, id);
        }
        for (const id of ["usefulHint", "errorHint", "clippedHint"]) {
          await page.locator("#" + id).hover();
          await page.locator("#siteHint").waitFor({ state: "visible" });
        }
        await page.mouse.move(0, 200);
        await page.evaluate(() =>
          document.getElementById("hintFixture").remove(),
        );

        const bottomTabs = page.locator(
          ".editor > .notification-tabs .notification-tab",
        );
        assert.ok((await bottomTabs.count()) >= 7);
        for (const tab of await bottomTabs.all()) {
          const name = await tab.getAttribute("aria-label");
          await tab.scrollIntoViewIfNeeded();
          await page.waitForTimeout(100);
          // Status details must also obey the navigation's no-hint rule.
          await tab.evaluate((node) => (node.dataset.hint = "detail"));
          await tab.hover();
          await page.waitForTimeout(300);
          assert.equal(await page.locator("#siteHint").isVisible(), false);
          assert.equal(await tab.getAttribute("title"), "");
          await tab.focus();
          await page.waitForTimeout(50);
          assert.equal(await page.locator("#siteHint").isVisible(), false);
          assert.equal(await tab.getAttribute("aria-label"), name);
          await tab.evaluate((node) => delete node.dataset.hint);
        }
        await page.mouse.move(0, 200);

        // Exercise the standalone picker inside a modal and a clipped container.
        await page.evaluate(() => {
          const dialog = document.createElement("dialog");
          dialog.id = "compatFixture";
          dialog.innerHTML =
            '<div style="overflow:hidden;height:40px"><input id="compatDate" type="date" min="1900-01-01" max="9999-12-31" value="2026-10-27"><button id="compatOpen">日期</button></div>';
          document.body.append(dialog);
          dialog.showModal();
          window.compatPicker = WorkTimeApp.ui.createDatePicker({
            input: dialog.querySelector("input"),
            button: dialog.querySelector("button"),
          });
        });
        await page.locator("#compatOpen").click();
        const pickerArrow = page.locator(".pop-arrow");
        await pickerArrow.waitFor({ state: "visible" });
        const pickerAppearance = await page
          .locator("#compatDatePicker")
          .evaluate((node) => {
            const style = getComputedStyle(node);
            return [
              style.backgroundColor,
              style.borderTopColor,
              style.borderRadius,
              style.boxShadow,
            ];
          });
        assert.deepEqual(pickerAppearance, [
          markerAppearance.background,
          markerAppearance.borderColor,
          markerAppearance.radius,
          markerAppearance.shadow,
        ]);
        const pickerBox = await page.locator("#compatDatePicker").boundingBox();
        const arrowBox = await pickerArrow.boundingBox();
        const arrowSide = await pickerArrow.getAttribute("data-pop-arrow-side");
        assert.ok(["top", "bottom"].includes(arrowSide));
        assert.ok(
          Math.abs(
            arrowBox.y +
              arrowBox.height / 2 -
              (pickerBox.y + (arrowSide === "top" ? 0 : pickerBox.height)),
          ) < 1,
        );
        await page
          .locator(
            '#compatDatePicker [data-picker-date="2026-10-28"]:not(.is-adjacent)',
          )
          .click();
        assert.equal(
          await page.locator("#compatDate").inputValue(),
          "2026-10-28",
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector("#compatOpen")
              .getAttribute("aria-expanded") === "false",
        );
        assert.equal(
          await page.locator("#compatOpen").getAttribute("aria-expanded"),
          "false",
        );
        await page.locator("#compatOpen").click();
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page.evaluate(() => document.activeElement.dataset.pickerDate),
          "2026-10-29",
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .locator("#compatOpen")
            .evaluate((node) => node === document.activeElement),
          true,
        );
        assert.equal(
          await page.locator("#compatFixture").evaluate((node) => node.open),
          true,
        );
        if (mode !== "native") {
          await page.locator("#compatOpen").click();
          await page.evaluate(() =>
            document.querySelector("#compatFixture").close(),
          );
          await page.waitForFunction(() => !WorkTimeApp.ui.popover.anyOpen());
          assert.equal(await page.locator(".popover-compat-host").count(), 0);
        }
        await page.evaluate(() => {
          window.compatPicker.dispose();
          document.querySelector("#compatFixture").remove();
        });

        await page.locator("#agendaMode").click();
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill("兼容性回归");
        const trigger = page.locator("#agendaScheduleOpen");
        const popup = page.locator("#agendaSchedulePopup");
        await trigger.click();
        await setRange(page, "2026-10-27", "2026-10-28");
        await popup.locator("[data-schedule-close]").click();
        await trigger.click();
        await popup
          .locator('[data-picker-date="2026-10-29"]:not(.is-adjacent)')
          .click();
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("#agendaEndDateInput").inputValue(),
          "2026-10-28",
        );
        assert.equal(
          await page.locator("#agendaDateInput").inputValue(),
          "2026-10-27",
        );
        assert.equal(await page.locator("#agendaForm").isVisible(), true);
        await trigger.click();
        if (
          mode === "missing-api" &&
          width === 390 &&
          process.env.WORKTIME_POPOVER_SCREENSHOT
        )
          await page.screenshot({
            path: process.env.WORKTIME_POPOVER_SCREENSHOT,
          });
        await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
        const box = await popup.boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= width + 1,
          JSON.stringify(box),
        );
        const point = { x: box.x + box.width / 2, y: box.y + 15 };
        assert.equal(
          await popup.evaluate(
            (node, point) =>
              node.contains(document.elementFromPoint(point.x, point.y)),
            point,
          ),
          true,
        );
        await popup.locator('[role="switch"]').uncheck();
        await page.locator("#agendaStart").fill("09:00");
        await page.locator("#agendaEnd").fill("10:00");
        await page.keyboard.press("Control+Enter");
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
        const statusTrigger = page
          .locator("#agendaList [data-agenda-status]")
          .first();
        await statusTrigger.click();
        await page
          .locator('#agendaStatusMenu [data-agenda-status-choice="completed"]')
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector("#agendaList [data-agenda-status]")?.dataset
              .status === "completed",
        );
        await statusTrigger.click();
        await page.mouse.click(2, 2);
        await page.waitForFunction(() => !WorkTimeApp.ui.popover.anyOpen());
        await page.waitForFunction(
          () =>
            document
              .querySelector("#agendaList [data-agenda-status]")
              ?.getAttribute("aria-expanded") === "false",
        );
        assert.equal(
          await statusTrigger.getAttribute("aria-expanded"),
          "false",
        );
        await page.keyboard.press("Escape");

        if (mode !== "native") {
          // Nested popovers keep their parent; unrelated ones dismiss the stack.
          const result = await page.evaluate(() => {
            const clipped = document.createElement("div");
            clipped.innerHTML =
              '<button>parent</button><div popover="auto"><button>child</button><div popover="auto">child popup</div></div><div popover="auto">other</div>';
            document.body.append(clipped);
            const [a, b, c] = clipped.querySelectorAll("[popover]");
            const original = a.parentNode;
            const parent = WorkTimeApp.ui.popover.create(a, {
              trigger: () => clipped.querySelector("button"),
            });
            const child = WorkTimeApp.ui.popover.create(b, {
              trigger: () => a.querySelector("button"),
            });
            const other = WorkTimeApp.ui.popover.create(c);
            parent.show();
            child.show();
            const nested = parent.isOpen() && child.isOpen();
            other.show();
            const dismissed =
              !parent.isOpen() && !child.isOpen() && other.isOpen();
            [parent, child, other].forEach((item) => item.destroy());
            const restored = a.parentNode === original && a.contains(b);
            clipped.remove();
            return {
              nested,
              dismissed,
              restored,
              hosts: document.querySelectorAll(".popover-compat-host").length,
            };
          });
          assert.deepEqual(result, {
            nested: true,
            dismissed: true,
            restored: true,
            hosts: 0,
          });
        }
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`Popover verified: ${mode}, ${width}px`);
      }
    }
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
