"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setRange = require("./lib/agenda-test-range.cjs");

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
