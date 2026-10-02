const { chromium } = require("playwright"),
  vm = require("node:vm"),
  path = require("node:path");
(async () => {
  const realm = vm.createContext({});
  vm.runInContext(
    require("../tests/helpers/core-source.cjs").readCoreSource() +
      ";globalThis.C=WorkTime",
    realm,
  );
  const state = realm.C.defaultState();
  state.days["2026-09-14"] = {
    actual: {
      start: "08:00",
      end: "20:00",
      nextDay: false,
      effectiveMinutes: null,
    },
    leaveMinutes: 120,
  };
  state.days["2026-09-15"] = { leaveMinutes: 480 };
  state.days["2026-09-16"] = {
    oa: {
      date: "2026-09-16",
      start: "08:00",
      end: "",
      nextDay: false,
      status: "pending",
      source: "fixture",
      raw: "09/16\n08:00",
    },
  };
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [390, 1600]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    await page.clock.install({ time: new Date("2026-09-15T12:00:00+08:00") });
    await page.addInitScript(
      (s) => localStorage.setItem("worktime-local-v1", JSON.stringify(s)),
      JSON.parse(JSON.stringify(state)),
    );
    await page.goto(
      require("node:url").pathToFileURL(path.resolve("index.html")).href,
    );
    await page.locator("#monthTitle").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.UIAlignment.refresh());
    await page.clock.fastForward(3000);
    await page.mouse.move(0, 0);
    const clipping = await page.locator(".daystatus .pill").evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect(),
          d = e.closest(".day"),
          dr = d.getBoundingClientRect(),
          s = getComputedStyle(d);
        return {
          date: d.dataset.date,
          text: e.textContent,
          pillWidth: r.width,
          cellWidth: dr.width,
          paddingLeft: s.paddingLeft,
          paddingRight: s.paddingRight,
          overflow: getComputedStyle(d).overflow,
          whiteSpace: getComputedStyle(e).whiteSpace,
          clippedRightPixels: Math.max(0, r.right - dr.right),
          clippedLeftPixels: Math.max(0, dr.left - r.left),
        };
      }),
    );
    if (clipping.length)
      require("node:fs").writeFileSync(
        "docs/calendar-clipping-" + width + ".json",
        JSON.stringify(
          { viewportWidth: width, syntheticData: true, labels: clipping },
          null,
          2,
        ),
      );
    await page
      .locator("#calendar")
      .locator("..")
      .screenshot({ path: "docs/refactor-calendar-month-" + width + ".png" });
    if (width === 1600) {
      await page.locator("#monthTitle").click();
      await page.locator("#prevMonth").click();
      await page.locator("#prevMonth").click();
      await page.evaluate(() => window.UIAlignment.refresh());
      await page.clock.fastForward(3000);
      await page.mouse.move(0, 0);
      const clipping = await page
        .locator(".daystatus .pill")
        .evaluateAll((es) =>
          es.map((e) => {
            const r = e.getBoundingClientRect(),
              d = e.closest(".day"),
              dr = d.getBoundingClientRect(),
              s = getComputedStyle(d);
            return {
              date: d.dataset.date,
              text: e.textContent,
              pillWidth: r.width,
              cellWidth: dr.width,
              paddingLeft: s.paddingLeft,
              paddingRight: s.paddingRight,
              overflow: getComputedStyle(d).overflow,
              whiteSpace: getComputedStyle(e).whiteSpace,
              clippedRightPixels: Math.max(0, r.right - dr.right),
              clippedLeftPixels: Math.max(0, dr.left - r.left),
            };
          }),
        );
      if (clipping.length)
        require("node:fs").writeFileSync(
          "docs/calendar-clipping-" + width + ".json",
          JSON.stringify(
            { viewportWidth: width, syntheticData: true, labels: clipping },
            null,
            2,
          ),
        );
      await page
        .locator("#calendar")
        .locator("..")
        .screenshot({ path: "docs/refactor-calendar-year-1600.png" });
    }
    await context.close();
  }
  await browser.close();
  console.log("Calendar screenshots captured.");
})();
