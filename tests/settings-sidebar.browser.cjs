const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const results = [];
    for (const width of [2250, 390]) {
      const p = await b.newPage({
        viewport: { width, height: width === 2250 ? 1244 : 884 },
        reducedMotion: "reduce",
      });
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(pathToFileURL(path.resolve("index.html")).href);
      await p.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      const editorEdges = await p
        .locator("#dayForm .time-fields")
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right };
        });
      await p.locator("#settingsOpen").click();
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "settingsOpen",
      );
      const settingsLayout = await p
        .locator("#settingsForm")
        .evaluate((form) => {
          const time = form
              .querySelector(".settings-work-time")
              .getBoundingClientRect(),
            fields = [...form.querySelectorAll(".settings-requirement")].map(
              (e) => e.getBoundingClientRect(),
            ),
            goal = form.querySelector(".settings-goal").getBoundingClientRect(),
            employment = form
              .querySelector(".settings-employment")
              .getBoundingClientRect();
          return {
            left: time.left,
            right: time.right,
            paired:
              fields[0].top === fields[1].top &&
              fields[1].top === fields[2].top &&
              fields[3].top === fields[4].top,
            employmentAfterGoal: employment.top >= goal.bottom,
          };
        });
      assert(
        Math.abs(settingsLayout.left - editorEdges.left) < 1 &&
          Math.abs(settingsLayout.right - editorEdges.right) < 1,
      );
      assert(settingsLayout.paired && settingsLayout.employmentAfterGoal);
      const geometry = await p.locator("#settingsDialog").evaluate((e) => {
        const r = e.getBoundingClientRect(),
          parent = e.closest(".editor").getBoundingClientRect();
        return {
          nonmodal: !e.matches(":modal"),
          inside: r.left >= parent.left - 1 && r.right <= parent.right + 1,
          overflow: e.scrollWidth > e.clientWidth,
          bodyOverflow:
            e.querySelector(".dialog-body").scrollWidth >
            e.querySelector(".dialog-body").clientWidth,
          footerVisible: e.querySelector(".dialog-foot") === null,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          tabsReserved:
            e.getBoundingClientRect().bottom <=
            e
              .closest(".editor")
              .querySelector(".notification-tabs")
              .getBoundingClientRect().top +
              1,
          infoReserved:
            e.getBoundingClientRect().bottom <=
            e
              .closest(".editor")
              .querySelector(".date-info-area")
              .getBoundingClientRect().top +
              1,
        };
      });
      console.log(width, geometry);
      assert(
        geometry.nonmodal &&
          geometry.inside &&
          !geometry.overflow &&
          !geometry.bodyOverflow &&
          geometry.footerVisible &&
          geometry.tabsReserved &&
          geometry.infoReserved &&
          !geometry.pageOverflow,
      );
      assert(await p.locator("#dayEditor").isHidden());
      assert(await p.locator(".notification-tabs").isVisible());
      assert(await p.locator(".date-info-area").isVisible());
      await p.locator("#date-tab-countdown").click();
      assert(await p.locator("#settingsDialog").isVisible());
      assert.equal(await p.locator(".settings-standard-summary").count(), 0);
      await p.screenshot({
        path: `docs/settings-sidebar-${width}.png`,
        fullPage: true,
      });
      await p.locator("#overtimeRequirement0").fill("1.2");
      assert(await p.locator("#settingsDialog").isVisible());
      assert.equal(
        await p.evaluate(
          () =>
            JSON.parse(localStorage.getItem("worktime-local-v1"))
              .targetAverageMinutes,
        ),
        72,
      );
      await p.locator("#calendar button.day[data-date]").first().click();
      assert(await p.locator("#dayEditor").isVisible());
      assert(await p.locator("#settingsDialog").isHidden());
      await p.locator("#settingsOpen").click();
      assert.equal(
        await p.locator("#overtimeRequirement0").inputValue(),
        "1.2",
      );
      await p.locator("#overtimeRequirement0").fill("2.4");
      await p.locator("#standardStart").fill("0900");
      assert.equal(await p.locator("#standardStart").inputValue(), "09:00");
      const savedSettings = () =>
        p.evaluate(
          () => JSON.parse(localStorage.getItem("worktime-local-v1")).settings,
        );
      assert.equal((await savedSettings()).workStart, "09:00");
      await p.locator("#standardStart").fill("23:00");
      assert.equal((await savedSettings()).workStart, "09:00");
      assert.match(await p.locator("#settingsError").textContent(), /晚于/);
      await p.locator("#standardStart").fill("09:00");
      assert.equal(await p.locator("#settingsError").textContent(), "");
      await p.locator("#employmentDate").fill("20241014");
      assert.equal((await savedSettings()).employmentDate, "2024-10-14");
      const breaksBefore = (await savedSettings()).breaks.length;
      await p.locator("#breaksList button").first().click();
      assert.equal((await savedSettings()).breaks.length, breaksBefore - 1);
      await p.keyboard.press("Escape");
      await p.locator("#settingsOpen").click();
      assert.equal(
        await p.locator("#overtimeRequirement0").inputValue(),
        "2.4",
      );
      await p.locator("#batchToggle").click();
      assert(await p.locator("#settingsDialog").isHidden());
      assert(await p.locator("#batchBar").isVisible());
      await p.locator("#calendar button.day[data-date]").first().click();
      assert.equal(await p.locator("#calendar .batchselected").count(), 1);
      await p.locator("#settingsOpen").click();
      assert(await p.locator("#settingsDialog").isVisible());
      assert(await p.locator("#batchBar").isHidden());
      assert.equal(
        await p.locator("#batchToggle").getAttribute("aria-pressed"),
        "false",
      );
      assert.equal(await p.locator("#calendar .batchselected").count(), 0);
      await p.locator("#batchToggle").click();
      assert(await p.locator("#settingsDialog").isHidden());
      assert(await p.locator("#batchBar").isVisible());
      assert.equal(
        await p.locator("#settingsOpen").getAttribute("aria-pressed"),
        "false",
      );
      assert.equal(
        await p.locator("#batchToggle").getAttribute("aria-pressed"),
        "true",
      );
      await p.reload();
      await p.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await p.locator("#settingsOpen").click();
      assert.equal(await p.locator("#standardStart").inputValue(), "09:00");
      assert.equal(
        await p.locator("#employmentDate").inputValue(),
        "2024-10-14",
      );
      assert.equal(
        await p.locator("#overtimeRequirement0").inputValue(),
        "2.4",
      );
      assert.deepEqual(errors, []);
      results.push({ width, geometry, saveCancelReturn: true });
      await p.close();
    }
    fs.writeFileSync(
      "docs/settings-sidebar-results.json",
      JSON.stringify({ complete: true, results }, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
