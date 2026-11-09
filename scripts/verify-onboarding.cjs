"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const root of [".", "_site"]) {
      const context = await browser.newContext();
      // Persist only the mocked folder availability across reloads/new tabs.
      await context.addInitScript(() => {
        document.addEventListener(
          "worktime:ready",
          () => {
            if (localStorage.getItem("test.onboardingInstalled") === "true")
              window.dispatchEvent(new Event("appinstalled"));
            if (localStorage.getItem("test.onboardingFolderReady") !== "true")
              return;
            Object.defineProperty(
              WorkTimeApp.services.autoBackupFolder,
              "state",
              {
                configurable: true,
                get: () => ({
                  status: "available",
                  supported: true,
                  name: "archive",
                }),
              },
            );
          },
          { once: true },
        );
      });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(root, "index.html")).href);
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(await page.locator(".onboarding-item").count(), 2);
      const dismissInstall = page.getByRole("checkbox", { name: "不再提示" });
      assert.equal(await dismissInstall.isChecked(), false);
      assert.equal(
        await page
          .locator(
            "#onboardingIntro, [data-onboarding-close], #onboardingDontRemind, [data-onboarding-skip]",
          )
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator('[data-stage="install"] [data-stage-title]')
          .innerText(),
        "推荐创建快捷启动",
      );
      assert.equal(
        await page.locator("[data-onboarding-install]").isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator('[data-stage="folder"]')
          .getAttribute("aria-current"),
        "step",
      );
      // Clicking static headings must preserve expansion and circle-relative text offsets.
      const nodeOffsets = () =>
        page.evaluate(async () => {
          await document.fonts.ready;
          for (let frame = 0; frame < 4; frame++)
            await new Promise((resolve) => requestAnimationFrame(resolve));
          return [...document.querySelectorAll(".onboarding-node-text")].map(
            (text) => {
              const box = text.getBoundingClientRect();
              const circle = text.parentElement.getBoundingClientRect();
              return {
                x: box.left + box.width / 2 - circle.left - circle.width / 2,
                y: box.top + box.height / 2 - circle.top - circle.height / 2,
              };
            },
          );
        });
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const before = await nodeOffsets();
        const controls = await page
          .locator(".onboarding-install-head")
          .evaluate((row) => {
            const title = row.querySelector("h3").getBoundingClientRect();
            const label = row.querySelector("label").getBoundingClientRect();
            const checkbox = row.querySelector("input").getBoundingClientRect();
            const box = row.getBoundingClientRect();
            const text = row.querySelector("label span");
            const style = getComputedStyle(text);
            const probe = document.createElement("i");
            probe.style.cssText =
              "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;font-size:0;line-height:0";
            text.append(probe);
            const baseline = probe.getBoundingClientRect().top;
            probe.remove();
            const context = document.createElement("canvas").getContext("2d");
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = context.measureText(text.textContent);
            const inkCenter =
              baseline +
              (metrics.actualBoundingBoxDescent -
                metrics.actualBoundingBoxAscent) /
                2;
            return {
              ordered: label.left >= title.right,
              aligned:
                Math.abs(
                  label.top + label.height / 2 - title.top - title.height / 2,
                ) < 1,
              rightAligned: Math.abs(label.right - box.right) < 1,
              inkAligned:
                Math.abs(inkCenter - checkbox.top - checkbox.height / 2) < 1,
              contained:
                label.right <= box.right + 1 && label.left >= box.left - 1,
            };
          });
        assert.equal(controls.contained, true);
        assert.equal(controls.rightAligned, true);
        assert.equal(
          controls.inkAligned,
          true,
          "Checkbox and visible label ink share a center",
        );
        if (width === 1280) {
          assert.equal(controls.ordered, true);
          assert.equal(controls.aligned, true);
        }

        // Verify visible ink, not just the stable (but potentially off-center) text box.
        for (const node of await page.locator(".onboarding-node").all()) {
          const white = await node.evaluate(
            (el) => getComputedStyle(el).color === "rgb(255, 255, 255)",
          );
          const data = (await node.screenshot({ scale: "css" })).toString(
            "base64",
          );
          const ink = await page.evaluate(
            async ({ data, white }) => {
              const image = new Image();
              image.src = "data:image/png;base64," + data;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d");
              context.drawImage(image, 0, 0);
              const pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
              let left = Infinity,
                right = -Infinity,
                top = Infinity,
                bottom = -Infinity;
              for (let y = 6; y < canvas.height - 6; y++) {
                for (let x = 6; x < canvas.width - 6; x++) {
                  const i = (y * canvas.width + x) * 4;
                  const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
                  if (
                    !(white ? Math.min(...rgb) > 210 : Math.max(...rgb) < 195)
                  )
                    continue;
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                  top = Math.min(top, y);
                  bottom = Math.max(bottom, y);
                }
              }
              return {
                x: (left + right + 1 - canvas.width) / 2,
                y: (top + bottom + 1 - canvas.height) / 2,
              };
            },
            { data, white },
          );
          assert.ok(
            Math.abs(ink.x) <= 1,
            `Visible digit ink off-center horizontally: ${ink.x}`,
          );
          assert.ok(
            Math.abs(ink.y) <= 1,
            `Visible digit ink off-center vertically: ${ink.y}`,
          );
        }

        for (let click = 0; click < 6; click++) {
          await page
            .locator(
              `[data-onboarding-heading="${click % 2 ? "folder" : "install"}"]`,
            )
            .click();
          for (const stage of ["folder", "install"]) {
            assert.equal(
              await page
                .locator(`[data-onboarding-step="${stage}"]`)
                .isVisible(),
              true,
            );
            assert.equal(
              await page
                .locator(`[data-onboarding-heading="${stage}"]`)
                .evaluate((el) => el.tagName),
              "H3",
            );
          }
          const after = await nodeOffsets();
          for (let node = 0; node < before.length; node++) {
            assert.ok(
              Math.abs(after[node].x - before[node].x) < 0.05,
              `Node ${node + 1} shifted horizontally at width ${width}: ${before[node].x} -> ${after[node].x}`,
            );
            assert.ok(
              Math.abs(after[node].y - before[node].y) < 0.05,
              `Node ${node + 1} shifted vertically at width ${width}`,
            );
          }
        }
      }
      await page.locator('[data-onboarding-heading="install"]').click();
      await page.locator('[data-onboarding-heading="folder"]').click();
      assert.equal(
        await page.locator('[data-onboarding-step="folder"]').isVisible(),
        true,
      );
      assert.equal(
        await page.locator("[data-onboarding-next]").isDisabled(),
        true,
      );
      assert.equal(
        await page.locator("#onboardingFolderRequired").innerText(),
        "请选择运行文件夹",
      );
      assert.equal(
        await page
          .locator("[data-onboarding-install]")
          .evaluate((el) => el.classList.contains("primary")),
        false,
      );
      await page.keyboard.press("Escape");
      await page.evaluate(() =>
        document
          .querySelector("[data-onboarding-next]")
          .dispatchEvent(new MouseEvent("click")),
      );
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      await page.evaluate(() => {
        WorkTimeApp.services.autoBackupFolder.choose = async () => false;
      });
      await page.locator(".onboarding-folder-button").click();
      assert.equal(
        await page.locator('[data-onboarding-step="folder"]').isVisible(),
        true,
      );
      await page.locator('[data-onboarding-heading="install"]').click();
      assert.equal(
        await page.locator('[data-onboarding-step="install"]').isVisible(),
        true,
      );
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {
          window.onboardingInstallActivation =
            navigator.userActivation.isActive;
          window.onboardingInstallCalls =
            (window.onboardingInstallCalls || 0) + 1;
        };
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      assert.equal(
        await page.locator("[data-onboarding-install]").innerText(),
        "安装应用",
      );
      await page.locator("[data-onboarding-install]").click();
      assert.equal(await page.evaluate(() => window.onboardingInstallCalls), 1);
      assert.equal(
        await page.evaluate(() => window.onboardingInstallActivation),
        true,
        "Native installation is invoked directly within the button click",
      );
      assert.equal(
        await page.locator("[data-onboarding-install]").isVisible(),
        true,
      );
      assert.equal(
        await page.locator("[data-onboarding-next]").isDisabled(),
        true,
      );
      await page.reload();
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "pending",
      );
      await page.evaluate(() => {
        let selections = 0;
        WorkTimeApp.services.autoBackupFolder.choose = async () => {
          const name =
            ++selections === 1 ? "archive" : "重选后的运行文件夹-".repeat(12);
          Object.defineProperty(
            WorkTimeApp.services.autoBackupFolder,
            "state",
            {
              configurable: true,
              get: () => ({
                status: "available",
                supported: true,
                name,
              }),
            },
          );
          return true;
        };
      });
      await page.locator(".onboarding-folder-button").click();
      const folderButton = page.locator(".onboarding-folder-button");
      assert.equal(await folderButton.innerText(), "已选择：archive");
      // The same button reopens the picker, and long names wrap within its full width.
      await folderButton.click();
      assert.equal(
        await folderButton.innerText(),
        "已选择：" + "重选后的运行文件夹-".repeat(12),
      );
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await folderButton.evaluate((button) => {
          const section = button.closest("section");
          const style = getComputedStyle(section);
          const width =
            section.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
          return {
            width: button.getBoundingClientRect().width,
            expected: width,
            overflow: button.scrollWidth > button.clientWidth + 1,
          };
        });
        assert.ok(Math.abs(geometry.width - geometry.expected) <= 1);
        assert.equal(geometry.overflow, false);
      }
      await page.evaluate(() => {
        WorkTimeApp.services.autoBackupFolder.choose = async () => false;
      });
      await folderButton.click();
      assert.equal(
        await folderButton.innerText(),
        "已选择：" + "重选后的运行文件夹-".repeat(12),
      );

      assert.equal(
        await page.locator('[data-onboarding-step="folder"]').isVisible(),
        true,
      );
      assert.equal(
        await page.locator('[data-onboarding-step="install"]').isVisible(),
        true,
      );
      assert.equal(
        await page.locator("[data-onboarding-next]").isEnabled(),
        true,
      );
      assert.equal(
        await page.locator("#onboardingFolderRequired").isHidden(),
        true,
      );
      // Escape remains blocked even after a folder is ready; finish is explicit.
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      const cancelled = await page.evaluate(() => {
        const event = new Event("cancel", { cancelable: true });
        document.querySelector("#onboardingDialog").dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(cancelled, true);
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      await page.locator("[data-onboarding-next]").click();
      await page.locator("#onboardingDialog").waitFor({ state: "detached" });
      // A completed welcome flow must not silence installation reminders next visit.
      await page.evaluate(() =>
        localStorage.setItem("test.onboardingFolderReady", "true"),
      );
      await page.reload();
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(await dismissInstall.isChecked(), false);
      assert.equal(
        await page.locator("[data-onboarding-next]").isEnabled(),
        true,
      );
      await page.locator("[data-onboarding-next]").click();
      const nextVisit = await context.newPage();
      await nextVisit.goto(
        pathToFileURL(path.resolve(root, "index.html")).href,
      );
      await nextVisit.locator("#onboardingDialog[open]").waitFor();
      assert.equal(
        await nextVisit.getByRole("checkbox", { name: "不再提示" }).isChecked(),
        false,
      );
      await nextVisit.close();
      // Already-installed apps suppress installation reminders without opt-out.
      await page.evaluate(() =>
        localStorage.setItem("test.onboardingInstalled", "true"),
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      await page.evaluate(() =>
        localStorage.removeItem("test.onboardingInstalled"),
      );
      await page.reload();
      await page.locator("#onboardingDialog[open]").waitFor();
      await page.locator("[data-onboarding-next]").click();

      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {};
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      await page
        .locator('#onboardingDialog[open] [data-onboarding-step="install"]')
        .waitFor();
      await dismissInstall.check();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.installReminder.dismissed.v1"),
        ),
        "true",
      );
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      assert.equal(
        await page.locator("[data-onboarding-install]").isVisible(),
        true,
      );
      // Opting out must leave manual native installation usable.
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {
          window.optedOutInstallCalls = (window.optedOutInstallCalls || 0) + 1;
        };
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      await page.locator("[data-onboarding-install]").click();
      assert.equal(await page.evaluate(() => window.optedOutInstallCalls), 1);
      await page.locator("[data-onboarding-next]").click();
      const offerInstall = () =>
        page.evaluate(() =>
          document.dispatchEvent(new Event("worktime:installavailable")),
        );
      await offerInstall();
      await page.evaluate(() => WorkTimeApp.ui.onboarding.mount());
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      // The preference survives refresh, new pages, and old queued install reminders.
      await page.evaluate(() =>
        localStorage.setItem("test.onboardingFolderReady", "true"),
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await offerInstall();
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      const reopened = await context.newPage();
      await reopened.goto(pathToFileURL(path.resolve(root, "index.html")).href);
      await reopened.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await reopened.evaluate(() =>
        document.dispatchEvent(new Event("worktime:installavailable")),
      );
      assert.equal(await reopened.locator("#onboardingDialog").count(), 0);
      await reopened.close();
      await page.evaluate(() =>
        localStorage.setItem("worktime.onboarding.v1", "pending-install"),
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "done",
      );
      // An opted-out profile with no runtime folder is still gated.
      await page.evaluate(() =>
        localStorage.removeItem("test.onboardingFolderReady"),
      );
      await page.reload();
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(await dismissInstall.isChecked(), true);
      assert.equal(
        await page.locator("[data-onboarding-next]").isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      await dismissInstall.uncheck();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.installReminder.dismissed.v1"),
        ),
        null,
      );
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      await page.evaluate(() => {
        Object.defineProperty(WorkTimeApp.services.autoBackupFolder, "state", {
          configurable: true,
          get: () => ({
            status: "available",
            supported: true,
            name: "archive",
          }),
        });
        document.dispatchEvent(new Event("worktime:languagechange"));
      });
      await page.locator("[data-onboarding-next]").click();
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      await offerInstall();
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(await dismissInstall.isChecked(), false);
      // Resetting a folder cannot be suppressed by the separate install preference.
      await dismissInstall.check();
      await page.locator("[data-onboarding-next]").click();
      await page.evaluate(() => {
        Object.defineProperty(WorkTimeApp.services.autoBackupFolder, "state", {
          configurable: true,
          get: () => ({
            status: "needsInitialization",
            supported: true,
            name: "",
          }),
        });
        return WorkTimeApp.services.autoBackupFolder.reset();
      });
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(
        await page.locator("[data-onboarding-next]").isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "pending",
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page
        .locator('#onboardingDialog[open] [data-onboarding-step="folder"]')
        .waitFor();
      page.once("dialog", async (dialog) => {
        assert.match(dialog.message(), /浏览器菜单/);
        await dialog.accept();
      });
      await page.evaluate(() =>
        document.querySelector("#appInstallButton").click(),
      );
      await page.evaluate(() => {
        window.installCalls = 0;
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {
          window.installCalls++;
        };
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
        document.querySelector("#appInstallButton").click();
      });
      await page.waitForFunction(
        () => !document.querySelector("#appInstallButton").disabled,
      );
      assert.equal(await page.evaluate(() => window.installCalls), 1);
      await page.evaluate(() =>
        window.dispatchEvent(new Event("appinstalled")),
      );
      assert.equal(await page.locator("#appInstallButton").isDisabled(), true);
      // Installing the optional app cannot bypass the mandatory folder selection.
      assert.equal(
        await page.locator("[data-onboarding-next]").isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "pending",
      );
      // Returning profiles cannot bypass required setup using old skip flags.
      for (const flag of ["done", "dismissed"]) {
        await page.evaluate(
          (flag) => localStorage.setItem("worktime.onboarding.v1", flag),
          flag,
        );
        await page.reload();
        await page.locator("#onboardingDialog[open]").waitFor();
        assert.equal(
          await page.locator("[data-onboarding-next]").isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#onboardingDialog[open]").count(), 1);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Mandatory folder setup, optional native install, stable digit ink, completion and source/release offline startup passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
