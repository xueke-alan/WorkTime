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
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(root, "index.html")).href);
      await page.locator("#onboardingDialog[open]").waitFor();
      await page.evaluate(() => {
        WorkTimeApp.services.autoBackupFolder.choose = async () => false;
      });
      await page.locator(".onboarding-folder-button").click();
      assert.equal(
        await page.locator('[data-onboarding-step="folder"]').isVisible(),
        true,
      );
      await page.locator("[data-onboarding-next]").click();
      assert.equal(
        await page.locator('[data-onboarding-step="install"]').isVisible(),
        true,
      );
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {};
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      assert.equal(
        await page.locator("[data-onboarding-next]").innerText(),
        "安装应用",
      );
      await page.locator("[data-onboarding-next]").click();
      await page.locator("[data-onboarding-next]").click();
      await page.locator("#onboardingDialog").waitFor({ state: "detached" });
      await page.reload();
      await page.locator("#onboardingDialog[open]").waitFor();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "pending",
      );
      await page.evaluate(() => {
        WorkTimeApp.services.autoBackupFolder.choose = async () => {
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
          return true;
        };
      });
      await page.locator(".onboarding-folder-button").click();
      await page.locator("[data-onboarding-next]").click();
      await page.locator("#onboardingDialog").waitFor({ state: "detached" });
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {};
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      await page
        .locator('#onboardingDialog[open] [data-onboarding-step="install"]')
        .waitFor();
      await page.locator("[data-onboarding-skip]").click();
      await page.evaluate(() => WorkTimeApp.services.autoBackupFolder.reset());
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
      await page.locator("#onboardingDontRemind").check();
      await page.locator("[data-onboarding-next]").click();
      await page.locator("[data-onboarding-next]").click();
      await page.locator("#onboardingDialog").waitFor({ state: "detached" });
      await page.evaluate(() =>
        document.dispatchEvent(new Event("worktime:folderreset")),
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("worktime.onboarding.v1"),
        ),
        "dismissed",
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      await page.evaluate(() =>
        document.dispatchEvent(new Event("worktime:installavailable")),
      );
      assert.equal(await page.locator("#onboardingDialog").count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "First-run, cancel, skip, native install dismissal, completion, reload and source/release offline startup passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
