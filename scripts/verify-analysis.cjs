"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function assertDailyConnections(page) {
  const result = await page.evaluate(() => {
    const near = (left, right) => Math.abs(left - right) < 0.001,
      groups = [...document.querySelectorAll(".analysis-range")],
      lanes = [...document.querySelectorAll(".analysis-lane")];
    const directions = lanes.map((lane) => {
      const ticks = [...lane.querySelectorAll(".analysis-grid text")].map(
        (el) => ({
          y: Number(el.getAttribute("y")),
          time: el.textContent,
        }),
      );
      return ticks.every(
        (tick, index) => index === 0 || tick.y - ticks[index - 1].y >= 21.99,
      );
    });
    const paired = groups.every((group) => {
      const line = group.querySelector(".analysis-connector"),
        start = group.querySelector('[data-lane="start"]'),
        end = group.querySelector('[data-lane="end"]').getBBox();
      return (
        line &&
        group.querySelectorAll(".analysis-connector").length === 1 &&
        near(
          Number(line.getAttribute("x1")),
          Number(line.getAttribute("x2")),
        ) &&
        near(
          Number(line.getAttribute("x1")),
          Number(start.getAttribute("cx")),
        ) &&
        near(
          Number(line.getAttribute("y1")),
          Number(start.getAttribute("cy")),
        ) &&
        near(Number(line.getAttribute("x2")), end.x + end.width / 2) &&
        near(Number(line.getAttribute("y2")), end.y + end.height / 2) &&
        Number(line.getAttribute("y1")) < Number(line.getAttribute("y2"))
      );
    });
    const upperTicks = [
        ...lanes[0].querySelectorAll(".analysis-grid line"),
      ].map((el) => Number(el.getAttribute("y1"))),
      lowerTicks = [...lanes[1].querySelectorAll(".analysis-grid line")].map(
        (el) => Number(el.getAttribute("y1")),
      ),
      plot = document.querySelector("#analysisPlot").getBoundingClientRect(),
      metrics = document
        .querySelector("#analysisMetrics")
        .getBoundingClientRect();
    return {
      directions,
      references: lanes.map((lane) =>
        [...lane.querySelectorAll(".analysis-grid-reference")].map((grid) => ({
          minute: Number(grid.dataset.minute),
          labeled: Boolean(grid.querySelector("text")),
        })),
      ),
      paired,
      count: groups.length,
      crossDate: document.querySelectorAll(".analysis-series").length,
      emptyGap: Math.max(...upperTicks) < Math.min(...lowerTicks),
      inlineStats: document.querySelectorAll(
        ".analysis-lane-median, .analysis-late-label",
      ).length,
      secondaryRemoved: !document.querySelector("#analysisSecondary"),
      topMetrics: metrics.bottom <= plot.top,
    };
  });
  assert.deepEqual(
    result.directions,
    [true, true],
    "Both tracks progress from early at top to late at bottom",
  );
  assert.deepEqual(result.references, [
    [480, 540].map((minute) => ({ minute, labeled: true })),
    [1050, 1230].map((minute) => ({ minute, labeled: true })),
  ]);
  assert.equal(
    result.paired,
    true,
    "Each unbroken vertical connector joins only one date's arrival and departure",
  );
  assert.equal(result.crossDate, 0, "No connections across dates");
  assert.equal(
    result.emptyGap,
    true,
    "Track scales and grid leave a middle gap",
  );
  assert.equal(result.inlineStats, 0);
  assert.equal(result.secondaryRemoved, true);
  assert.equal(
    result.topMetrics,
    true,
    "Keep the preview's primary summary at the top",
  );
}

async function verifyViewMotion(browser, url, state) {
  const context = await browser.newContext({
    reducedMotion: "no-preference",
    viewport: { width: 1920, height: 1080 },
  });
  await context.route(/^https?:/, (route) => route.abort());
  await context.addInitScript((state) => {
    localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    const animate = Element.prototype.animate;
    window.viewMotions = [];
    window.monthMotions = [];
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (
        options.duration === 260 &&
        frames.some((frame) => /translateX\(-?18px\)/.test(frame.transform))
      )
        window.monthMotions.push({ id: this.id, frames, animation });
      if (
        [140, 220].includes(options.duration) &&
        (this.id === "panelContent" ||
          this.parentElement?.classList.contains("calendar-footer"))
      ) {
        animation.pause();
        window.viewMotions.push({ id: this.id, frames, options, animation });
      }
      return animation;
    };
  }, state);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
  await page.goto(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  const phase = async (duration, offset) => {
    await page.waitForFunction(
      (duration) =>
        window.viewMotions.some(
          (motion) => motion.options.duration === duration,
        ),
      duration,
    );
    const motions = await page.evaluate(() =>
      window.viewMotions.map(({ id, frames, options }) => ({
        id,
        frames,
        options,
      })),
    );
    assert.equal(
      motions.filter((motion) => motion.id === "panelContent").length,
      1,
    );
    assert.equal(motions.length, 4, "One body movement and three footer fades");
    for (const motion of motions) {
      assert.ok(motion.frames.every((frame) => !("clipPath" in frame)));
      assert.equal(motion.options.duration, duration);
      if (motion.id === "panelContent")
        assert.equal(
          motion.frames[duration === 140 ? 1 : 0].transform,
          `translateY(${offset}px)`,
        );
      else
        assert.ok(
          motion.frames.every((frame) => !("transform" in frame)),
          "Footer content only fades",
        );
      assert.equal(motion.frames[duration === 140 ? 1 : 0].opacity, 0);
    }
    assert.equal(
      await page
        .locator(".calendar-footer")
        .evaluate(
          (footer) =>
            !footer.closest("#panelContent") &&
            footer.getAnimations().length === 0,
        ),
      true,
      "The footer surface stays outside the moving body and has no animation",
    );
  };
  const finish = () =>
    page.evaluate(() => {
      const motions = window.viewMotions.splice(0);
      for (const motion of motions) motion.animation.finish();
    });
  const settled = () =>
    page.waitForFunction(() =>
      ["panelContent", "calendar", "analysisPage"].every((id) => {
        const element = document.getElementById(id);
        return (
          !element.inert &&
          !element
            .getAnimations()
            .some((animation) =>
              [140, 220].includes(animation.effect.getTiming().duration),
            )
        );
      }),
    );
  for (const width of [1920, 2560, 390]) {
    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
    for (const entering of [true, false]) {
      await page.locator("#analysisToggle").focus();
      await page.keyboard.press("Enter");
      await phase(140, entering ? -24 : 24);
      // Repeated activation must not reverse or restart a transition.
      await page.locator("#analysisToggle").dispatchEvent("click");
      assert.equal(
        await page.locator("#analysisToggle").getAttribute("aria-pressed"),
        String(!entering),
      );
      await finish();
      await phase(220, entering ? 24 : -24);
      assert.equal(
        await page.locator("#analysisToggle").getAttribute("aria-pressed"),
        String(entering),
      );
      if (width === 1920 && entering) {
        await page.evaluate(() => {
          for (const motion of window.viewMotions)
            motion.animation.currentTime = 110;
        });
        fs.mkdirSync("test-results/analysis", { recursive: true });
        await page.screenshot({
          path: "test-results/analysis/view-transition.png",
        });
      }
      await finish();
      await settled();
      assert.equal(await page.locator("#analysisPage").isVisible(), entering);
      assert.equal(
        await page
          .locator("#analysisToggle")
          .evaluate((element) => element === document.activeElement),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      if (entering && width > 1150)
        await assertFullscreen(page, "animated " + width);
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const analysis of [false, true]) {
    if (analysis) {
      await page.locator("#analysisToggle").click();
      await phase(140, -24);
      await finish();
      await phase(220, 24);
      await finish();
      await settled();
    }
    const motion = await page.evaluate(() => {
      window.monthMotions = [];
      // Exercise interruption before the preceding entrance has completed.
      document.getElementById("nextMonth").click();
      document.getElementById("nextMonth").click();
      document.getElementById("prevMonth").click();
      return window.monthMotions.map(({ id, frames, animation }) => ({
        id,
        offset: frames[0].transform,
        state: animation.playState,
      }));
    });
    assert.deepEqual(
      motion.map((item) => item.id),
      analysis ? [] : Array(3).fill("calendar"),
    );
    assert.deepEqual(
      motion.map((item) => item.offset),
      analysis
        ? []
        : ["translateX(18px)", "translateX(18px)", "translateX(-18px)"],
    );
    assert.deepEqual(
      motion.slice(0, 2).map((item) => item.state),
      analysis ? [] : ["idle", "idle"],
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    const quiet = await page.evaluate(() => {
      window.monthMotions = [];
      document.getElementById("prevMonth").click();
      return window.monthMotions.length;
    });
    assert.equal(quiet, 0, "Reduced motion skips month entrance animations");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#analysisToggle").click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#monthTitle").click();
  await page.locator("#analysisToggle").click();
  await phase(140, -24);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settled();
  assert.equal(await page.locator("#analysisPage").isVisible(), true);
  await page.locator("#analysisToggle").click();
  assert.equal(await page.locator("#calendar").isVisible(), true);
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate((element) => element.classList.contains("year-calendar")),
    false,
  );
  // Missing optional animation APIs must still reach the requested view.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Element.prototype.animate = undefined;
  });
  await page.locator("#nextMonth").click();
  await page.locator("#analysisToggle").click();
  await settled();
  assert.equal(await page.locator("#analysisPage").isVisible(), true);
  assert.equal(await page.locator("#analysisEmpty").isVisible(), true);
  assert.deepEqual(errors, []);
  await context.close();
}

async function verifyComponentMotion(browser, url, input) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1920, height: 1080 },
  });
  await context.route(/^https?:/, (route) => route.abort());
  await context.addInitScript((input) => {
    const state = structuredClone(input);
    state.days = {};
    for (const month of [
      "2026-01",
      "2026-02",
      "2026-04",
      "2026-09",
      "2026-10",
      "2024-02",
    ]) {
      const date = month + "-01";
      state.days[date] = {
        kind: "work",
        oa: {
          date,
          start: month.endsWith("09") ? "07:30" : "08:30",
          end: month.endsWith("09") ? "00:30" : "20:00",
          nextDay: month.endsWith("09"),
          status: "complete",
          source: "test",
          raw: "",
        },
      };
    }
    state.days["2026-10-02"] = {
      kind: "work",
      sourcePriority: "manual",
      actual: {
        start: "09:00",
        end: "21:30",
        nextDay: false,
        effectiveMinutes: null,
      },
    };
    state.days["2026-10-03"] = structuredClone(state.days["2026-10-01"]);
    state.days["2026-10-03"].oa.date = "2026-10-03";
    state.days["2026-09-02"] = structuredClone(state.days["2026-09-01"]);
    Object.assign(state.days["2026-09-02"].oa, {
      date: "2026-09-02",
      start: "08:45",
      end: "19:30",
      nextDay: false,
    });
    state.days["2026-09-03"] = structuredClone(state.days["2026-09-01"]);
    state.days["2026-09-03"].oa.date = "2026-09-03";
    localStorage.setItem("worktime-local-v1", JSON.stringify(state));
  }, input);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-21T04:00:00Z") });
  await page.goto(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await page.locator("#analysisToggle").click();
  await page.clock.runFor(100);
  await page.clock.pauseAt(new Date("2026-10-21T04:01:00Z"));
  await page.evaluate(() => {
    window.keptSvg = document.querySelector(".analysis-plot");
    window.keptMetric = document.querySelector(".analysis-metric-value");
    window.keptDate = document.querySelector('[data-key="date-0"]');
    window.keptDay = document.querySelector(".analysis-day");
    window.keptRestBand = document.querySelector(".analysis-rest-band");
    window.restBandX = window.keptRestBand.getAttribute("x");
    window.restBandWidth = window.keptRestBand.getAttribute("width");
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const initial = await page.evaluate(() => ({
    x: Number(document.querySelector('[data-key="date-0"]').getAttribute("x")),
    y: Number(document.querySelector(".analysis-connector").getAttribute("y2")),
    pointY: Number(
      document
        .querySelector('.analysis-point[data-lane="start"]')
        .getAttribute("cy"),
    ),
    width: parseFloat(document.querySelector(".analysis-day").style.width),
    bandWidth: parseFloat(
      document.querySelector(".analysis-longest-band").style.width,
    ),
    lastDateX: Number(
      document.querySelector('[data-key="date-30"]').getAttribute("x"),
    ),
    lastDayLeft: parseFloat(
      document.querySelector('.analysis-day[data-date$="-31"]').style.left,
    ),
  }));
  await page.evaluate(() => document.getElementById("prevMonth").click());
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    "true",
  );
  assert.equal(
    await page.evaluate(
      () => document.getElementById("analysisPage").getAnimations().length,
    ),
    0,
  );
  assert.ok(
    await page
      .locator(
        ".analysis-metric .number-roll-up, .analysis-metric .number-roll-down",
      )
      .count(),
  );
  await page.clock.runFor(32);
  assert.equal(
    await page.evaluate(() => {
      const tracks = [
        ...document.querySelectorAll(
          ".analysis-metric .number-roll-up, .analysis-metric .number-roll-down",
        ),
      ];
      const boxesFit = [
        ...document.querySelectorAll(".analysis-metric-value"),
      ].every(
        (value) =>
          value.getBoundingClientRect().bottom <=
          value
            .closest(".analysis-metric")
            .querySelector(".analysis-metric-footer")
            .getBoundingClientRect().top +
            0.5,
      );
      return (
        boxesFit &&
        tracks.length > 0 &&
        tracks.every((track) => {
          if (track.style.animationPlayState !== "running") return false;
          const animation = track.getAnimations()[0];
          if (!animation) return false;
          animation.pause();
          animation.currentTime = 160;
          const transform = getComputedStyle(track).transform;
          const translated = new DOMMatrixReadOnly(transform).m42;
          return (
            Math.abs(translated) > 1 &&
            Boolean(track.querySelector(".summary-number-outgoing"))
          );
        })
      );
    }),
    true,
    "Numeric tracks start after rendering and visibly translate old and new rows",
  );
  await page.clock.runFor(38);
  assert.equal(
    await page
      .locator(".analysis-metric-footer .analysis-text-changing")
      .first()
      .evaluate((element) => {
        const incoming = element.querySelector(".analysis-text-incoming"),
          outgoing = element.querySelector(".analysis-text-outgoing");
        return (
          Boolean(incoming && outgoing) &&
          getComputedStyle(incoming).fontSize ===
            getComputedStyle(outgoing).fontSize &&
          getComputedStyle(incoming).lineHeight ===
            getComputedStyle(outgoing).lineHeight &&
          Math.abs(
            Number(getComputedStyle(incoming).opacity) +
              Number(getComputedStyle(outgoing).opacity) -
              1,
          ) < 0.01
        );
      }),
    true,
    "Text changes use a balanced crossfade rather than dimming both layers",
  );
  assert.equal(
    await page.evaluate(() =>
      Number(document.querySelector('[data-key="date-0"]').getAttribute("x")),
    ),
    initial.x,
  );
  assert.equal(
    await page.evaluate(() =>
      parseFloat(document.querySelector(".analysis-day").style.width),
    ),
    initial.width,
  );
  await page.clock.runFor(100);
  const middle = await page.evaluate(() => ({
    x: Number(document.querySelector('[data-key="date-0"]').getAttribute("x")),
    y: Number(document.querySelector(".analysis-connector").getAttribute("y2")),
    pointY: Number(
      document
        .querySelector('.analysis-point[data-lane="start"]')
        .getAttribute("cy"),
    ),
    width: parseFloat(document.querySelector(".analysis-day").style.width),
  }));
  assert.notEqual(middle.x, initial.x, "Chart starts after the numeric layer");
  assert.equal(
    middle.y,
    initial.y,
    "Outgoing connectors stay still while fading out",
  );
  const fadingOpacity = await page
    .locator(".analysis-connector")
    .first()
    .evaluate((element) => Number(element.style.opacity));
  assert.ok(
    fadingOpacity > 0 && fadingOpacity < 0.8,
    "Connectors fade before changing geometry",
  );
  assert.equal(
    middle.pointY,
    initial.pointY,
    "Outgoing endpoints stay still while fading out",
  );
  const pointOpacity = await page
    .locator('.analysis-point[data-lane="start"]')
    .first()
    .evaluate((element) => Number(element.style.opacity));
  assert.ok(
    Math.abs(pointOpacity - fadingOpacity / 0.8) < 0.001,
    "Endpoints fade in sync with their connector",
  );
  const wave = await page
    .locator(".analysis-range:not([data-exiting])")
    .evaluateAll((groups) =>
      groups
        .filter(
          (group) =>
            Number(group.querySelector(".analysis-connector").style.opacity) >
            0,
        )
        .slice(0, 2)
        .map((group) => {
          const line = group.querySelector(".analysis-connector"),
            points = [
              ...group.querySelectorAll(
                ".analysis-point,.analysis-point-alternate",
              ),
            ];
          return {
            opacity: Number(line.style.opacity) / 0.8,
            points: points
              .filter((point) => point.getAttribute("opacity") !== "0")
              .map((point) => Number(point.style.opacity)),
          };
        }),
    );
  assert.ok(
    wave[1].opacity > wave[0].opacity,
    "Later dates start fading slightly after earlier dates: " +
      JSON.stringify(wave),
  );
  for (const group of wave)
    assert.ok(
      group.points.every(
        (opacity) => Math.abs(opacity - group.opacity) < 0.001,
      ),
      "Each day's two endpoints and connector fade as one unit",
    );
  assert.equal(middle.width, initial.width, "Timeline waits for its own layer");
  await page.clock.runFor(130);
  const exitingDates = await page.evaluate(() => {
    const date = document.querySelector(
        '.analysis-date[data-exiting][data-key="date-30"]',
      ),
      day = document.querySelector(
        '.analysis-day[data-exiting][data-date$="-31"]',
      );
    return {
      x: Number(date.getAttribute("x")),
      dateOpacity: Number(date.style.opacity),
      left: parseFloat(day.style.left),
      dayOpacity: Number(day.style.opacity),
    };
  });
  assert.ok(
    exitingDates.x > initial.lastDateX,
    "Chart day 31 moves right with the remaining dates before removal",
  );
  assert.ok(
    exitingDates.left > initial.lastDayLeft,
    "Distribution day 31 moves right with the remaining dates before removal",
  );
  assert.ok(exitingDates.dateOpacity > 0 && exitingDates.dateOpacity < 1);
  assert.ok(exitingDates.dayOpacity > 0 && exitingDates.dayOpacity < 1);
  const hiddenMarks = await page
    .locator(".analysis-range")
    .first()
    .evaluate((group) =>
      [
        ...group.querySelectorAll(
          ".analysis-connector,.analysis-point,.analysis-point-alternate",
        ),
      ].every((element) => Number(getComputedStyle(element).opacity) === 0),
    );
  assert.ok(
    hiddenMarks,
    "Both endpoint shapes and connector fully disappear before the incoming phase",
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.keptRestBand.getAttribute("x") === window.restBandX &&
        window.keptRestBand.getAttribute("width") === window.restBandWidth,
    ),
    "Rest-day background bands do not slide or stretch while fading",
  );
  const movingBand = await page
    .locator(".analysis-longest-band")
    .evaluate((element) => ({
      width: parseFloat(element.style.width),
      opacity: Number(getComputedStyle(element).opacity),
    }));
  assert.ok(
    movingBand.width > Math.min(initial.bandWidth, 10) &&
      movingBand.width < Math.max(initial.bandWidth, 10),
    "Longest streak width interpolates toward three days in September",
  );
  assert.equal(
    movingBand.opacity,
    1,
    "Longest streak stays visible while moving and resizing",
  );
  assert.equal(
    await page.locator(".analysis-grid").evaluateAll((grids) =>
      grids.every((grid) => {
        const y = Number(grid.querySelector("line").getAttribute("y1")) + 4;
        return [...grid.querySelectorAll("text")].every(
          (label) => Math.abs(Number(label.getAttribute("y")) - y) < 0.01,
        );
      }),
    ),
    true,
    "Incoming and outgoing axis labels remain attached to their moving grid lines",
  );
  assert.equal(
    await page
      .locator('.analysis-marker-shape[data-state="missing"]')
      .evaluateAll((markers) =>
        markers.every((marker) => {
          const style = getComputedStyle(marker);
          return style.width === style.height;
        }),
      ),
    true,
    "Timeline circles remain circular throughout state transitions",
  );
  assert.equal(
    await page
      .locator(".analysis-rest-band")
      .evaluateAll((bands) =>
        bands.every((band) => Number(getComputedStyle(band).opacity) <= 0.0251),
      ),
    true,
    "Rest-day bands retain their subtle opacity during animation",
  );
  assert.notEqual(
    await page.evaluate(() =>
      parseFloat(document.querySelector(".analysis-day").style.width),
    ),
    initial.width,
  );
  await page.screenshot({ path: "test-results/analysis/component-motion.png" });
  // Interrupt at the visible frame; the new target must start at that exact x.
  const continuous = await page.evaluate(() => {
    const node = document.querySelector('[data-key="date-0"]'),
      before = node.getAttribute("x"),
      band = document.querySelector(".analysis-longest-band"),
      bandBefore = band.style.cssText;
    document.getElementById("nextMonth").click();
    return (
      before === node.getAttribute("x") && bandBefore === band.style.cssText
    );
  });
  assert.equal(continuous, true);
  await page.clock.runFor(700);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
  );
  assert.equal(await page.locator("[data-exiting]").count(), 0);
  assert.equal(await page.locator(".analysis-date").count(), 31);
  assert.equal(
    await page
      .locator(".analysis-longest-band")
      .evaluate((element) => parseFloat(element.style.width)),
    initial.bandWidth,
    "Interrupted streak animation reaches the new target width",
  );
  for (const [button, incomingEmpty] of [
    ["nextMonth", true],
    ["prevMonth", false],
  ]) {
    await page.evaluate((id) => document.getElementById(id).click(), button);
    await page.clock.runFor(32);
    const emptyTransition = await page
      .locator(".analysis-metric-value")
      .evaluateAll((values, incomingEmpty) => {
        const changing = values.filter((value) => {
          const outgoing = value.querySelector(".summary-number-outgoing");
          return (
            !value.hidden &&
            outgoing &&
            (incomingEmpty
              ? value.dataset.value === "—"
              : outgoing.textContent === "—")
          );
        });
        return (
          changing.length >= 6 &&
          changing.every((value) => {
            const track = value.querySelector(".summary-number-track"),
              animation = track.getAnimations()[0];
            if (!animation) return false;
            animation.pause();
            animation.currentTime = 160;
            const outgoing = track.querySelector(".summary-number-outgoing");
            return (
              track.closest(".summary-number-word") &&
              Math.abs(
                new DOMMatrixReadOnly(getComputedStyle(track).transform).m42,
              ) > 1 &&
              Number(getComputedStyle(value).opacity) === 1 &&
              outgoing.scrollWidth <= track.getBoundingClientRect().width + 1
            );
          })
        );
      }, incomingEmpty);
    assert.ok(
      emptyTransition,
      "Empty and populated metrics roll as whole values in both directions without clipping",
    );
    await page.clock.runFor(700);
    assert.equal(
      await page
        .locator(".analysis-metric-value .summary-number-outgoing")
        .count(),
      0,
    );
  }
  assert.equal(
    await page.evaluate(
      () =>
        window.keptSvg === document.querySelector(".analysis-plot") &&
        window.keptMetric ===
          document.querySelector(".analysis-metric-value") &&
        window.keptDate === document.querySelector('[data-key="date-0"]') &&
        window.keptDay === document.querySelector(".analysis-day"),
    ),
    true,
  );
  await page.evaluate(() => {
    const control = document.getElementById("analysisManual");
    control.checked = true;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.clock.runFor(700);
  assert.equal(await page.locator(".analysis-range.is-manual").count(), 1);
  await page
    .locator(".analysis-metric details summary")
    .first()
    .evaluate((element) => element.click());
  assert.equal(
    await page
      .locator(".analysis-metric details[open] p")
      .evaluate((element) =>
        element
          .getAnimations()
          .some((animation) => animation.effect.getTiming().duration === 140),
      ),
    true,
    "Tied-date popup has a short entrance",
  );
  await page
    .locator(".analysis-metric details summary")
    .first()
    .evaluate((element) => element.click());
  const manual = page.locator(".analysis-range.is-manual");
  await manual.focus();
  assert.equal(
    await page
      .locator("#analysisHover")
      .evaluate((element) =>
        element
          .getAnimations()
          .some((animation) => animation.effect.getTiming().duration === 140),
      ),
    true,
    "Tooltip has a lightweight entrance",
  );
  await page.evaluate(() => document.getElementById("prevMonth").click());
  await page.clock.runFor(220);
  const fadedLine = await page
    .locator('.analysis-range[data-date="2026-09-02"] .analysis-connector')
    .evaluate((element) => ({
      opacity: Number(element.style.opacity),
      blended: element.style.stroke.includes("color-mix"),
    }));
  assert.ok(
    fadedLine.opacity < 0.8,
    "Connector color changes fade out before revealing the new line",
  );
  assert.equal(
    fadedLine.blended,
    false,
    "Connector colors switch while hidden",
  );
  await page.clock.runFor(500);
  await page.evaluate(() => document.getElementById("nextMonth").click());
  await page.clock.runFor(700);
  await manual.focus();
  await page.evaluate(() => {
    const control = document.getElementById("analysisManual");
    control.checked = false;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.clock.runFor(700);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "analysisChart",
  );
  // 31 -> 28, 30, and leap February: no orphan nodes after each transition.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    for (let n = 0; n < 8; n++) document.getElementById("prevMonth").click();
  });
  await page.clock.runFor(50);
  assert.equal(await page.locator(".analysis-date").count(), 28);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => document.getElementById("prevMonth").click());
  const incomingStart = await page.evaluate(() => ({
    x: Number(document.querySelector('[data-key="date-30"]').getAttribute("x")),
    left: parseFloat(
      document.querySelector('.analysis-day[data-date$="-31"]').style.left,
    ),
  }));
  await page.clock.runFor(330);
  const incomingMiddle = await page.evaluate(() => ({
    x: Number(document.querySelector('[data-key="date-30"]').getAttribute("x")),
    left: parseFloat(
      document.querySelector('.analysis-day[data-date$="-31"]').style.left,
    ),
    opacity: Number(
      document.querySelector('[data-key="date-30"]').style.opacity,
    ),
  }));
  assert.ok(
    incomingMiddle.x < incomingStart.x,
    "New chart dates fade in while moving left",
  );
  assert.ok(
    incomingMiddle.left < incomingStart.left,
    "New distribution dates fade in while moving left",
  );
  assert.ok(incomingMiddle.opacity > 0 && incomingMiddle.opacity < 1);
  await page.clock.runFor(370);
  assert.equal(await page.locator(".analysis-date").count(), 31);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    for (let n = 0; n < 23; n++) document.getElementById("prevMonth").click();
  });
  await page.clock.runFor(50);
  assert.equal(await page.locator(".analysis-date").count(), 29);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => document.getElementById("nextMonth").click());
  await page.clock.runFor(180);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(50);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
  );
  assert.equal(await page.locator(".analysis-date").count(), 31);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      await page.clock.runFor(50);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => document.getElementById("nextMonth").click());
      await page.clock.runFor(300);
      await assertFullscreen(
        page,
        "Component animation midpoint " + width + ", " + language,
      );
      await page.clock.runFor(400);
      await assertFullscreen(
        page,
        "Component animation endpoint " + width + ", " + language,
      );
    }
  }
  await page.evaluate(() => document.getElementById("prevMonth").click());
  await page.clock.runFor(180);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.runFor(50);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
    "Resizing settles geometry",
  );
  await page.evaluate(() => document.getElementById("prevMonth").click());
  await page.clock.runFor(180);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
    "Backgrounding settles all tracks",
  );
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    document.getElementById("prevMonth").click();
  });
  await page.clock.runFor(180);
  await page.evaluate(() => document.getElementById("analysisToggle").click());
  await page.clock.runFor(900);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
    "Leaving the view cleans up component animations",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.getElementById("analysisToggle").click());
  await page.clock.runFor(50);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
    "Re-entry renders directly",
  );
  await page.evaluate(() => document.getElementById("todayButton").click());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Element.prototype.animate = undefined;
    document.getElementById("nextMonth").click();
  });
  await page.clock.runFor(50);
  assert.equal(await page.locator(".analysis-date").count(), 30);
  assert.equal(
    await page.locator("#analysisPage").getAttribute("data-animating"),
    null,
  );
  assert.deepEqual(errors, []);
  await context.close();
}

async function assertFullscreen(page, label) {
  await page.waitForFunction(() => {
    const plot = document.querySelector("#analysisPlot"),
      svg = plot.querySelector("svg");
    if (!svg) return false;
    const rect = plot.getBoundingClientRect(),
      box = svg.viewBox.baseVal;
    return (
      Math.abs(box.width - rect.width) <= 1 &&
      Math.abs(box.height - rect.height) <= 1
    );
  });
  const issues = await page.evaluate(() => {
    const issues = [],
      root = document.documentElement;
    if (
      root.scrollWidth > innerWidth + 1 ||
      root.scrollHeight > innerHeight + 1
    )
      issues.push("document scrolls");
    for (const selector of [
      "#analysisPage",
      "#analysisChart",
      "#analysisPlot",
      ".analysis-streak-dates",
      ".analysis-streak",
    ]) {
      const el = document.querySelector(selector),
        box = el.getBoundingClientRect();
      if (
        (el.scrollWidth > el.clientWidth + 1 &&
          getComputedStyle(el).overflowX !== "clip") ||
        (el.scrollHeight > el.clientHeight + 1 &&
          getComputedStyle(el).overflowY !== "clip")
      )
        issues.push(selector + " scrolls");
      if (
        box.left < 0 ||
        box.right > innerWidth + 1 ||
        box.top < 0 ||
        box.bottom > innerHeight + 1
      )
        issues.push(selector + " leaves viewport");
    }
    const page = document
      .querySelector("#analysisPage")
      .getBoundingClientRect();
    for (const selector of [
      "#analysisMetrics",
      "#analysisHover",
      ".analysis-streak-heading",
      "#analysisStreak",
    ]) {
      const element = document.querySelector(selector);
      if (!element.getClientRects().length) continue;
      const box = element.getBoundingClientRect();
      if (box.top < page.top - 1 || box.bottom > page.bottom + 1)
        issues.push(selector + " is clipped");
    }
    const distribution = document.querySelector(".analysis-streak"),
      distributionStyle = getComputedStyle(distribution);
    if (
      distributionStyle.overflowX !== "clip" ||
      distributionStyle.overflowY !== "clip"
    )
      issues.push("distribution can show transient scrollbars");
    const svg = document.querySelector(".analysis-plot");
    for (const label of svg.querySelectorAll(
      ".analysis-grid text, .analysis-date, .analysis-lane-title, .analysis-lane-median, .analysis-late-label",
    )) {
      // Entering/exiting labels deliberately travel beyond the scale while fading.
      if (label.closest("[data-exiting],[data-entering]")) continue;
      const box = label.getBBox();
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > svg.viewBox.baseVal.width + 1 ||
        box.y + box.height > svg.viewBox.baseVal.height + 1
      )
        issues.push("chart label clipped: " + label.textContent);
    }
    return issues;
  });
  assert.deepEqual(issues, [], label);
  await assertDailyConnections(page);
}

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    const url = pathToFileURL(
      path.resolve(process.argv[2] || ".", "index.html"),
    ).href;
    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await page.goto(url);
    await ready();
    await page.locator("#analysisToggle").click();
    assert.equal(await page.locator("#analysisEmpty").isVisible(), true);
    assert.equal(await page.locator(".analysis-range").count(), 0);
    assert.equal(await page.locator(".analysis-lane").count(), 2);
    assert.equal(await page.locator(".analysis-day").count(), 31);
    assert.equal(await page.locator(".analysis-metric").count(), 8);
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      await assertFullscreen(
        page,
        "No records: full empty chart at " + width + "×" + height,
      );
    }
    fs.mkdirSync("test-results/analysis", { recursive: true });
    await page
      .locator(".workspace > section.panel")
      .screenshot({ path: "test-results/analysis/empty-preview.png" });
    // Saving a schedule must redraw even when no attendance records change.
    await page.locator("#settingsOpen").click();
    for (const [start, end, minutes] of [
      ["08:10", "18:20", [490, 550, 1100, 1280]],
      ["09:05", "22:10", [545, 605, 1330, 1510]],
      ["08:00", "17:30", [480, 540, 1050, 1230]],
    ]) {
      await page.locator("#standardStart").fill(start);
      await page.locator("#standardEnd").fill(end);
      await page.locator("#scheduleApplyOpen").click();
      await page.locator("#scheduleRangeChoice").selectOption("all", {
        force: true,
      });
      await page.locator('#scheduleRangeForm button[type="submit"]').click();
      await page.waitForFunction(
        () => !document.querySelector("#scheduleRangeDialog").open,
      );
      assert.deepEqual(
        await page.locator(".analysis-grid-reference").evaluateAll((grids) =>
          grids.map((grid) => ({
            minute: Number(grid.dataset.minute),
            text: grid.querySelector("text")?.textContent,
          })),
        ),
        minutes.map((minute) => ({
          minute,
          text:
            (minute >= 1440 ? "次日 " : "") +
            String(Math.floor((minute % 1440) / 60)).padStart(2, "0") +
            ":" +
            String(minute % 60).padStart(2, "0"),
        })),
        "Reference lines and labels follow the saved schedule, including next-day times",
      );
    }
    await page.locator("#settingsOpen").click();
    const results = await page.evaluate(() => {
      const D = WorkTimeApp.domain,
        state = D.state.defaultState(),
        analyze = (input = state, manual = false, month = "2026-10") =>
          D.statistics.monthlyAnalysis(input, month, "2026-10-21", manual),
        oa = (date, start = "08:30", end = "20:00", nextDay = false) => ({
          date,
          start,
          end,
          nextDay,
          status: end ? "complete" : "pending",
          source: "test",
          raw: "",
        }),
        manual = (start = "08:30", end = "20:00") => ({
          start,
          end,
          nextDay: false,
          effectiveMinutes: null,
        });
      state.days = {
        "2026-09-30": { oa: oa("2026-09-30") },
        "2026-10-01": { oa: oa("2026-10-01"), kind: "work" },
        "2026-10-02": { oa: oa("2026-10-02"), kind: "work" },
        "2026-10-03": { actual: manual(), kind: "work" },
        "2026-10-04": {
          oa: oa("2026-10-04", "08:30", ""),
          actual: manual(),
          kind: "work",
        },
        "2026-10-05": {
          oa: oa("2026-10-05"),
          sourcePriority: "manual",
          actual: manual("08:12"),
          kind: "work",
        },
        "2026-10-06": { estimate: manual(), kind: "work" },
        "2026-10-07": { oa: oa("2026-10-07", "08:30", ""), kind: "work" },
        "2026-10-08": {
          actual: { start: "", end: "", nextDay: false, effectiveMinutes: 600 },
          kind: "work",
        },
        "2026-10-09": { oa: oa("2026-10-09", "08:12", "21:00"), kind: "work" },
        "2026-10-10": {
          oa: oa("2026-10-10", "08:12", "00:35", true),
          kind: "rest",
        },
        "2026-10-11": { oa: oa("2026-10-11", "08:30", "08:30"), kind: "rest" },
        "2026-10-12": { oa: oa("2026-10-12", "08:00", "17:30"), kind: "work" },
        "2026-10-13": { oa: oa("2026-10-13"), kind: "work" },
        "2026-10-14": { oa: oa("2026-10-14"), kind: "work" },
        "2026-10-22": {
          oa: oa("2026-10-22", "07:00", "02:00", true),
          kind: "work",
        },
      };
      const before = JSON.stringify(state),
        base = analyze(),
        included = analyze(state, true);
      const medianState = D.state.defaultState();
      medianState.days = {
        "2026-10-01": { oa: oa("2026-10-01", "08:00", "23:00"), kind: "work" },
        "2026-10-02": {
          oa: oa("2026-10-02", "09:01", "00:30", true),
          kind: "work",
        },
      };
      const averageState = D.state.cloneState(medianState);
      averageState.days["2026-10-03"] = {
        oa: oa("2026-10-03", "06:00", "18:00"),
        kind: "work",
      };
      const changedSchedule = D.state.cloneState(state);
      changedSchedule.scheduleRanges = [
        {
          start: "2026-10-13",
          end: null,
          schedule: {
            workStart: "09:00",
            workEnd: "18:30",
            standardMinutes: 480,
            breaks: [{ start: 720, end: 810 }],
          },
        },
      ];
      const scheduleResult = analyze(changedSchedule);
      const zeroState = D.state.cloneState(state);
      zeroState.days["2026-10-01"] = {
        sourcePriority: "manual",
        actual: { ...manual(), effectiveMinutes: 0 },
      };
      const ties = D.state.defaultState();
      ties.days = {
        "2026-10-01": {
          oa: oa("2026-10-01", "08:00", "00:30", true),
          kind: "work",
        },
        "2026-10-02": {
          oa: oa("2026-10-02", "08:00", "00:30", true),
          kind: "work",
        },
      };
      const overridden = D.state.defaultState();
      overridden.days = {
        "2026-10-01": {
          oa: oa("2026-10-01"),
          sourcePriority: "manual",
          draft: { start: "08:00", end: "", nextDay: false },
        },
      };
      return {
        state,
        base,
        included,
        median: analyze(medianState),
        average: analyze(averageState),
        empty: analyze(D.state.defaultState()),
        future: analyze(state, true, "2026-11"),
        unchanged: before === JSON.stringify(state),
        schedule: scheduleResult.calendarDays.filter((day) =>
          ["2026-10-12", "2026-10-13"].includes(day.date),
        ),
        zeroDates: analyze(zeroState, true).days.map((day) => day.date),
        ties: analyze(ties),
        overridden: analyze(overridden, true),
      };
    });
    assert.equal(results.unchanged, true, "Analysis must be pure");
    assert.equal(results.base.count, 7);
    assert.equal(results.base.overtimeDays, 6);
    assert.deepEqual(results.base.earliest, {
      minutes: 480,
      dates: ["2026-10-12"],
    });
    assert.equal(results.base.latest.minutes, 1475);
    assert.equal(results.base.lateDays, 1, "Exactly 21:00 is not after 21:00");
    assert.deepEqual(
      results.base.longest.dates,
      ["2026-10-01", "2026-10-02"],
      "Earliest tied streak wins; month boundary excluded",
    );
    assert.equal(results.included.count, 11);
    assert.equal(results.included.manualDays, 4);
    assert.equal(results.included.longest.count, 6);
    assert.equal(
      results.included.days.some((day) => day.date === "2026-10-22"),
      false,
    );
    assert.equal(
      results.included.days.some((day) => day.date === "2026-10-08"),
      false,
    );
    assert.equal(results.median.medianStart, 510.5);
    assert.equal(results.median.medianEnd, 1425);
    assert.equal(results.average.averageStart, (480 + 541 + 360) / 3);
    assert.equal(results.average.averageEnd, (1380 + 1470 + 1080) / 3);
    assert.equal(results.average.latestStart.minutes, 541);
    assert.deepEqual(results.average.latestStart.dates, ["2026-10-02"]);
    assert.equal(results.average.earliestEnd.minutes, 1080);
    assert.deepEqual(results.average.earliestEnd.dates, ["2026-10-03"]);
    assert.equal(results.empty.count, 0);
    assert.equal(results.empty.earliest, null);
    assert.equal(results.empty.averageStart, null);
    assert.equal(results.empty.averageEnd, null);
    assert.equal(results.empty.latestStart, null);
    assert.equal(results.empty.earliestEnd, null);
    assert.equal(results.future.count, 0);
    assert.deepEqual(
      results.schedule.map((day) => day.workEnd),
      [1050, 1110],
    );
    assert.deepEqual(
      results.schedule.map((day) => day.workStart),
      [480, 540],
    );
    assert.equal(results.zeroDates.includes("2026-10-01"), false);
    assert.equal(
      results.overridden.count,
      0,
      "Do not fall back to OA when manual priority is incomplete",
    );
    assert.deepEqual(results.ties.earliest.dates, ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(results.ties.latest.dates, ["2026-10-01", "2026-10-02"]);

    // Seed only this isolated browser context, never the user's saved database.
    await context.close();
    const seeded = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    await seeded.route(/^https?:/, (route) => route.abort());
    await seeded.addInitScript(
      (state) =>
        localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
      results.state,
    );
    const view = await seeded.newPage();
    view.on("pageerror", (error) => errors.push(error.message));
    await view.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await view.goto(url);
    const waitReady = () =>
      view.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await waitReady();
    assert.equal(
      await view.locator("#todayButton + #analysisToggle").count(),
      1,
    );
    const calendarFooter = await view.locator("#calendarFoot").textContent();
    assert.equal(
      await view.locator("#analysisToggle use").getAttribute("href"),
      "#ms-calendar",
    );
    await view.locator("#analysisToggle").click();
    assert.equal(
      await view.locator("#analysisToggle use").getAttribute("href"),
      "#ms-table-chart-view",
    );
    assert.equal(await view.locator("#analysisPage").isVisible(), true);
    assert.equal(
      await view
        .locator("#analysisToggle .ui-icon")
        .evaluate(
          (el) =>
            getComputedStyle(el).color ===
            getComputedStyle(document.querySelector("#analysisToggle")).color,
        ),
      true,
      "Active toggle icon must remain readable",
    );
    assert.equal(await view.locator("#calendar").isVisible(), false);
    assert.equal(await view.locator("#analysisManual").isChecked(), false);
    assert.equal(await view.locator("#batchToggle").isDisabled(), true);
    assert.equal(await view.locator(".analysis-range").count(), 7);
    assert.equal(await view.locator(".analysis-range.is-manual").count(), 0);
    await view.locator("#analysisToggle").click();
    assert.equal(
      await view.locator("#calendarFoot").textContent(),
      calendarFooter,
    );
    await view.locator("#analysisToggle").click();
    assert.equal(
      await view.locator("#monthTitle").getAttribute("aria-disabled"),
      "true",
    );
    assert.equal(
      await view.locator("#calendarFoot").textContent(),
      await view.evaluate(() => WorkTimeApp.i18n.t("analysis.footer")),
    );
    await view.locator("#monthTitle").dispatchEvent("click");
    assert.equal(await view.locator("#analysisPage").isVisible(), true);
    await view.locator("#analysisManual").check();
    assert.equal(await view.locator(".analysis-range").count(), 11);
    assert.equal(await view.locator(".analysis-range.is-manual").count(), 4);
    assert.equal(
      await view.evaluate(() => {
        const color = getComputedStyle(
          document.querySelector(".analysis-legend-manual"),
        ).backgroundColor;
        return [
          ...document.querySelectorAll(".analysis-range.is-manual"),
        ].every(
          (group) =>
            getComputedStyle(group.querySelector(".analysis-connector"))
              .stroke === color &&
            [...group.querySelectorAll(".analysis-point")].every(
              (point) => getComputedStyle(point).fill === color,
            ),
        );
      }),
      true,
      "Manual and manually completed records use orange connectors and endpoints",
    );
    assert.equal(await view.locator(".analysis-lane").count(), 2);
    assert.equal(await view.locator(".analysis-point").count(), 22);
    assert.equal(await view.locator(".analysis-point.is-late").count(), 1);
    assert.equal(await view.locator(".analysis-day").count(), 31);
    assert.equal(await view.locator(".analysis-day.is-longest").count(), 6);
    assert.equal(await view.locator(".analysis-metric").count(), 8);
    assert.equal(await view.locator("#analysisHover").isVisible(), false);
    assert.equal(await view.locator("#analysisHover").textContent(), "");
    const structure = await view.evaluate(() => {
      const headings = [
        ...document.querySelectorAll(
          "#analysisHeading, .analysis-chart-heading h2, .analysis-streak-heading h2",
        ),
      ].map((element) => {
        const style = getComputedStyle(element);
        return {
          size: style.fontSize,
          weight: style.fontWeight,
          lineHeight: style.lineHeight,
        };
      });
      return {
        headings,
        legendInHeading: !!document.querySelector(
          ".analysis-streak-heading #analysisTimelineLegend",
        ),
        distributionHeight: document
          .querySelector(".analysis-distribution-body")
          .getBoundingClientRect().height,
        gutter: Number(
          document.querySelector(".analysis-grid line").getAttribute("x1"),
        ),
      };
    });
    assert.equal(structure.headings.length, 3);
    assert.deepEqual(structure.headings[1], structure.headings[0]);
    assert.deepEqual(structure.headings[2], structure.headings[0]);
    assert.equal(structure.legendInHeading, true);
    const opticalOffsets = await view
      .locator(".analysis-metric-ratio")
      .evaluate((ratio) => {
        const icon = ratio.querySelector("svg").getBoundingClientRect(),
          context = document.createElement("canvas").getContext("2d");
        return [...ratio.querySelectorAll(".analysis-metric-value")].map(
          (value) => {
            const digit = value.querySelector(".summary-number-digit"),
              style = getComputedStyle(digit),
              probe = document.createElement("span");
            probe.style.cssText =
              "display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline";
            digit.append(probe);
            context.font =
              style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
            const metrics = context.measureText("0123456789"),
              baseline = probe.getBoundingClientRect().top;
            probe.remove();
            return (
              baseline +
              (metrics.actualBoundingBoxDescent -
                metrics.actualBoundingBoxAscent) /
                2 -
              (icon.top + icon.bottom) / 2
            );
          },
        );
      });
    assert.ok(
      // Font fallback and hinted glyph metrics differ across Windows/Linux.
      // Preserve a one-CSS-pixel optical bound rather than subpixel equality.
      opticalOffsets.every((offset) => Math.abs(offset) <= 1),
      "Ratio divider matches digit ink centers: " + opticalOffsets.join(", "),
    );
    assert.ok(structure.distributionHeight >= 65);
    assert.equal(
      await view
        .locator(".analysis-streak-heading #analysisStreakSummary")
        .count(),
      1,
    );
    assert.equal(
      await view.locator(".analysis-distribution-summary").count(),
      0,
    );
    assert.ok(
      structure.gutter < 108,
      "Axis gutter should fit its labels rather than reserve a fixed blank column",
    );
    for (const state of ["workedOvertime", "recorded", "missing", "future"])
      assert.ok(
        await view.locator('.analysis-day[data-state="' + state + '"]').count(),
      );
    await assertDailyConnections(view);
    const hoverRange = view.locator(".analysis-range").first();
    await hoverRange.hover();
    assert.equal(await view.locator("#analysisHover").isVisible(), true);
    await hoverRange.click();
    assert.equal(
      await hoverRange.evaluate(
        (element) => element === document.activeElement,
      ),
      false,
      "Pointer clicks do not pin the line through focus",
    );
    await view.locator("#analysisHeading").hover();
    assert.equal(await view.locator("#analysisHover").isVisible(), false);
    assert.equal(await view.locator(".analysis-range.is-selected").count(), 0);
    const layoutSnapshot = async () => {
      await view.evaluate(async () => {
        await document.fonts.ready;
        WorkTimeApp.ui.alignment.refresh();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      return view.evaluate(() => ({
        blocks: [
          ...document.querySelectorAll(
            ".analysis-heading, .analysis-metric, .analysis-chart-heading, #analysisPlot, .analysis-streak-heading, .analysis-distribution-body",
          ),
        ].map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return [x, y, width, height].map(
            (value) => Math.round(value * 10) / 10,
          );
        }),
        gutter: document
          .querySelector(".analysis-grid line")
          .getAttribute("x1"),
      }));
    };
    const populatedLayout = await layoutSnapshot();
    assert.equal(
      await view.evaluate(() =>
        [...document.querySelectorAll(".analysis-metric details")].every(
          (details) => {
            const card = details.closest(".analysis-metric"),
              footer = details.parentElement.getBoundingClientRect(),
              date = details.previousElementSibling.getBoundingClientRect(),
              link = details.querySelector("summary").getBoundingClientRect(),
              before = card.getBoundingClientRect();
            details.open = true;
            const after = card.getBoundingClientRect();
            details.open = false;
            return (
              Math.abs(link.right - footer.right) < 1 &&
              Math.abs(link.top - date.top) < 1 &&
              before.width === after.width &&
              before.height === after.height
            );
          },
        ),
      ),
      true,
      "Date links share the footer row, align right, and never resize cards",
    );
    await view.locator("#nextMonth").click();
    assert.equal(await view.locator("#analysisEmpty").isVisible(), true);
    assert.equal(await view.locator("#analysisDetails").isVisible(), true);
    assert.equal(await view.locator(".analysis-lane").count(), 2);
    assert.equal(await view.locator(".analysis-range").count(), 0);
    assert.equal(await view.locator(".analysis-date").count(), 30);
    assert.equal(
      await view.locator(".analysis-ratio-divider").isVisible(),
      false,
    );
    await assertFullscreen(
      view,
      "Empty month keeps both tracks and the monthly structure",
    );
    assert.deepEqual(
      await layoutSnapshot(),
      populatedLayout,
      "October records with tied dates and next-day clocks keep the same layout as empty November",
    );
    await view.locator("#todayButton").click();
    assert.equal(await view.locator(".analysis-range").count(), 11);
    assert.equal(
      await view.locator(".analysis-ratio-divider").isVisible(),
      true,
    );
    assert.equal(
      await view
        .locator('.analysis-metric-ratio [data-key="denominator"]')
        .isVisible(),
      true,
    );
    await view.locator('.analysis-range[data-date="2026-10-10"]').focus();
    assert.match(
      await view.locator("#analysisHover").textContent(),
      /次日 00:35/,
    );
    assert.equal(await view.locator(".analysis-range.is-selected").count(), 1);
    assert.equal(
      await view.evaluate(() => {
        const tooltip = document
            .getElementById("analysisHover")
            .getBoundingClientRect(),
          chart = document
            .getElementById("analysisChart")
            .getBoundingClientRect(),
          point = document
            .querySelector('.analysis-range.is-selected [data-lane="start"]')
            .getBoundingClientRect();
        return (
          tooltip.width <= 220 &&
          tooltip.left >= chart.left &&
          tooltip.right <= chart.right &&
          tooltip.bottom <= point.top - 8
        );
      }),
      true,
      "Compact floating tooltip sits above the selected line within chart edges",
    );
    await view.screenshot({
      path: "test-results/analysis/floating-tooltip.png",
    });
    assert.equal(
      await view
        .locator(".analysis-range.is-selected .analysis-halo")
        .evaluateAll((halos) =>
          halos.every((el) => getComputedStyle(el).visibility === "visible"),
        ),
      true,
    );
    await view.keyboard.press("ArrowLeft");
    assert.equal(
      await view
        .locator(".analysis-range.is-selected")
        .getAttribute("data-date"),
      "2026-10-09",
    );
    await view.keyboard.press("Home");
    assert.equal(
      await view
        .locator(".analysis-range.is-selected")
        .getAttribute("data-date"),
      "2026-10-01",
    );
    await view.keyboard.press("Escape");
    assert.equal(await view.locator(".analysis-range.is-selected").count(), 0);
    await view
      .locator('.analysis-range[data-date="2026-10-10"] .analysis-hit')
      .hover();
    assert.match(
      await view.locator("#analysisHover").textContent(),
      /次日 00:35/,
    );
    await view.mouse.move(0, 0);
    await view.locator('.analysis-range[data-date="2026-10-10"]').focus();
    await view.setViewportSize({ width: 2560, height: 1440 });
    await assertFullscreen(view, "Keyboard focus after resize");
    assert.equal(
      await view.evaluate(() => document.activeElement.dataset.date),
      "2026-10-10",
    );
    assert.match(
      await view.locator("#analysisHover").textContent(),
      /次日 00:35/,
    );
    fs.mkdirSync("test-results/analysis", { recursive: true });
    await view.locator("#analysisToggle").focus();
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await view.setViewportSize({ width, height });
      await assertFullscreen(view, width + "×" + height);
      const alignment = await view.evaluate(() => {
        const heading = document
            .querySelector(".analysis-streak-heading")
            .getBoundingClientRect(),
          markers = [
            ...document.querySelectorAll(".analysis-day .analysis-marker"),
          ],
          first = markers[0].getBoundingClientRect(),
          last = markers.at(-1).getBoundingClientRect();
        return {
          left: Math.abs(heading.left - first.left),
          right: Math.abs(heading.right - last.right),
        };
      });
      assert.ok(
        alignment.left < 1 && alignment.right < 1,
        "Visible distribution marker edges share both boundaries with the section heading at " +
          width,
      );
      await view.screenshot({
        path: "test-results/analysis/fullscreen-" + height + ".png",
        fullPage: true,
      });
      if (width === 1920)
        await view
          .locator(".workspace > section.panel")
          .screenshot({ path: "test-results/analysis/trends-preview.png" });
    }
    await view.screenshot({
      path: "test-results/analysis/desktop.png",
      fullPage: true,
    });
    for (const width of [1440, 1151, 850, 390, 320]) {
      await view.setViewportSize({ width, height: 900 });
      assert.equal(
        await view.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "Page overflow at " + width,
      );
      assert.equal(await view.locator("#analysisToggle").isVisible(), true);
      await view.screenshot({
        path: "test-results/analysis/width-" + width + ".png",
        fullPage: true,
      });
    }
    await view.setViewportSize({ width: 1440, height: 1000 });
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await view.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(await view.locator(".analysis-range").count(), 11);
      assert.equal(
        (await view.locator("#analysisHeading").textContent()).includes(
          "analysis.",
        ),
        false,
      );
      assert.equal(
        await view.locator("#analysisHeading").textContent(),
        await view.evaluate(() => WorkTimeApp.i18n.t("analysis.title")),
      );
      if (language === "en")
        await view.screenshot({
          path: "test-results/analysis/english.png",
          fullPage: true,
        });
    }
    await view.locator("#analysisToggle").click();
    await view.locator("#monthTitle").click();
    assert.equal(
      await view
        .locator("#calendar")
        .evaluate((el) => el.classList.contains("year-calendar")),
      true,
    );
    await view.locator("#analysisToggle").click();
    assert.equal(await view.locator("#analysisPage").isVisible(), true);
    assert.equal(await view.locator(".analysis-range").count(), 11);
    await view.reload();
    await waitReady();
    assert.equal(await view.locator("#analysisPage").isVisible(), false);
    await view.locator("#analysisToggle").click();
    assert.equal(await view.locator("#analysisManual").isChecked(), false);
    await view.locator("#analysisManual").check();
    await view.locator("#dayStart").fill("08:00");
    await view.locator("#dayEnd").fill("22:00");
    await view.locator("#dayEnd").blur();
    await view.waitForFunction(
      () => document.querySelectorAll(".analysis-range").length === 12,
    );
    assert.match(await view.locator("#analysisCoverage").textContent(), /12/);
    await view.locator("#analysisManual").uncheck();
    assert.equal(await view.locator(".analysis-range").count(), 7);
    // Crossing a business date refreshes the same selected month's analysis.
    await view.clock.setFixedTime(new Date("2026-10-22T04:00:00Z"));
    await view.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal(await view.locator(".analysis-range").count(), 8);
    assert.match(await view.locator("#analysisMetrics").textContent(), /02:00/);
    await view.setViewportSize({ width: 1920, height: 1280 });
    await view.locator("#analysisToggle").focus();
    await view.screenshot({
      path: "test-results/analysis/final.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await seeded.close();
    // A full month with tied extremes and a 31-day streak must also fit.
    const dense = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    await dense.route(/^https?:/, (route) => route.abort());
    await dense.addInitScript((input) => {
      const state = structuredClone(input);
      state.days = Object.fromEntries(
        Array.from({ length: 31 }, (_, index) => {
          const date = "2026-10-" + String(index + 1).padStart(2, "0");
          return [
            date,
            {
              kind: "work",
              oa: {
                date,
                start: "08:00",
                end: "00:30",
                nextDay: true,
                status: "complete",
                source: "test",
                raw: "",
              },
            },
          ];
        }),
      );
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, results.state);
    const full = await dense.newPage();
    full.on("pageerror", (error) => errors.push(error.message));
    await full.clock.setFixedTime(new Date("2026-10-31T04:00:00Z"));
    await full.goto(url);
    await full.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await full.locator("#analysisToggle").click();
    assert.equal(await full.locator(".analysis-range").count(), 31);
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await full.setViewportSize({ width, height });
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await full.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        await assertFullscreen(
          full,
          "31 days, " + width + "×" + height + ", " + language,
        );
      }
      await full.locator(".analysis-metric details summary").first().click();
      await assertFullscreen(
        full,
        "Expanded tied dates, " + width + "×" + height,
      );
      await full.locator(".analysis-metric details summary").first().click();
    }
    await verifyViewMotion(browser, url, results.state);
    await verifyComponentMotion(browser, url, results.state);
    await dense.close();
    assert.deepEqual(errors, []);
    console.log(
      "Monthly analysis rules, navigation, filters, keyboard access, six languages, responsive layout and scroll-free 1080p/1440p full-screen views (including 31-day streaks) verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
