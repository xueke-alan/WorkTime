"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.setContent(`<style>.ui-aligned-text{display:inline-block;line-height:1.3;transform:translateY(var(--ui-ink-offset,0px))}</style>
    <div class="workspace"><section class="calendar"><button class="day" id="day-one"><div class="day-date"><span class="daynum-text">12</span></div></button><button class="day" id="day-two"><div class="day-date"><span class="daynum-text">13</span></div></button></section>
    <div class="calendar-footer"><span id="calendarFoot">本月0天记录</span></div><section class="summary-sidebar"><article class="card" id="card-one"><div class="metric">12</div></article><article class="card" id="card-two"><div class="metric">25</div></article></section><section class="editor"></section></div><div id="unrelated">背景</div>`);
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/ui-alignment.js"),
  });
  const result = await page.evaluate(async () => {
    const tick = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    await tick();
    const reads = {
      calendar: 0,
      summary: 0,
      otherCard: 0,
      otherDay: 0,
      footer: 0,
    };
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (this.closest(".calendar")) reads.calendar++;
      if (this.closest(".summary-sidebar")) reads.summary++;
      if (this.closest("#card-two")) reads.otherCard++;
      if (this.closest("#day-two")) reads.otherDay++;
      if (this.closest(".calendar-footer")) reads.footer++;
      return original.apply(this, args);
    };
    document.querySelector(".metric").textContent = "123";
    await tick();
    const local = { ...reads };
    const label = document.querySelector(".metric .ui-aligned-text");
    const offset = label.style.getPropertyValue("--ui-ink-offset");
    UIAlignment.refresh();
    const sameOffset =
      offset === label.style.getPropertyValue("--ui-ink-offset");
    for (const key of Object.keys(reads)) reads[key] = 0;
    document.querySelector("#unrelated").textContent = "无关文字更新";
    await tick();
    const unrelated = { ...reads };
    document.querySelector("#calendarFoot").textContent = "本月1天记录";
    await tick();
    const footerLocal = { ...reads };
    for (const key of Object.keys(reads)) reads[key] = 0;
    document.querySelector("#day-one .daynum-text").textContent = "14";
    await tick();
    const dayLocal = { ...reads };
    const dayLabel = document.querySelector("#day-one .daynum-text");
    const dayOffset = dayLabel.style.getPropertyValue("--ui-ink-offset");
    UIAlignment.refresh();
    const sameDayOffset =
      dayOffset === dayLabel.style.getPropertyValue("--ui-ink-offset");
    document.querySelector(".editor").innerHTML = "<button>新增按钮</button>";
    await tick();
    const wrapped = Boolean(
      document.querySelector(".editor button.ui-button .button-label"),
    );
    for (const key of Object.keys(reads)) reads[key] = 0;
    const workspace = document.querySelector(".workspace");
    workspace.classList.add("motion-startup");
    workspace.style.setProperty("--motion-delay", "45ms");
    await tick();
    const motionAdded = { ...reads };
    const offsets = () =>
      [...document.querySelectorAll(".ui-aligned-text")].map((element) =>
        element.style.getPropertyValue("--ui-ink-offset"),
      );
    const beforeMotionFull = offsets();
    UIAlignment.refresh();
    const motionEquivalent =
      JSON.stringify(beforeMotionFull) === JSON.stringify(offsets());
    for (const key of Object.keys(reads)) reads[key] = 0;
    workspace.classList.remove("motion-startup");
    workspace.style.removeProperty("--motion-delay");
    await tick();
    const motionRemoved = { ...reads };
    for (const key of Object.keys(reads)) reads[key] = 0;
    workspace.style.setProperty("--motion-delay", "60ms");
    workspace.style.fontSize = "18px";
    await tick();
    const combinedMotionFont = { ...reads };
    for (const key of Object.keys(reads)) reads[key] = 0;
    document.documentElement.style.fontSize = "20px";
    await tick();
    const global = { ...reads };
    UIAlignment.dispose();
    Element.prototype.getBoundingClientRect = original;
    return {
      local,
      sameOffset,
      footerLocal,
      dayLocal,
      sameDayOffset,
      unrelated,
      wrapped,
      global,
      motionAdded,
      motionRemoved,
      motionEquivalent,
      combinedMotionFont,
    };
  });
  assert.equal(
    result.local.calendar,
    0,
    "Summary update does not measure calendar",
  );
  assert(result.local.summary > 0, "Changed summary is measured");
  assert(
    result.sameOffset,
    "Local and complete passes produce the same offset",
  );
  assert.deepEqual(
    result.unrelated,
    { calendar: 0, summary: 0, otherCard: 0, otherDay: 0, footer: 0 },
    "Unrelated subtree is not observed",
  );
  assert.equal(
    result.local.otherCard,
    0,
    "Unchanged summary card is not measured",
  );
  assert(result.footerLocal.footer > 0, "Changed footer is measured");
  assert.equal(
    result.footerLocal.calendar,
    0,
    "Footer update does not scan calendar",
  );
  assert.equal(
    result.footerLocal.summary,
    0,
    "Footer update does not scan summary",
  );
  assert(result.dayLocal.calendar > 0, "Changed date is measured");
  assert.equal(result.dayLocal.otherDay, 0, "Unchanged day is not measured");
  assert.equal(
    result.dayLocal.summary,
    0,
    "Date update does not measure summary",
  );
  assert(
    result.sameDayOffset,
    "Single-day and complete passes produce the same offset",
  );
  assert.deepEqual(
    result.motionAdded,
    result.unrelated,
    "Startup motion metadata does not scan text",
  );
  assert.deepEqual(
    result.motionRemoved,
    result.unrelated,
    "Startup cleanup does not scan text",
  );
  assert(
    result.motionEquivalent,
    "Skipping startup metadata equals full calibration",
  );
  assert(
    result.combinedMotionFont.calendar > 0 &&
      result.combinedMotionFont.summary > 0,
    "Font changes combined with motion metadata still refresh text",
  );
  assert(result.wrapped, "Dynamically added controls retain label wrapping");
  assert(
    result.global.calendar > 0 && result.global.summary > 0,
    "Root typography refreshes both components",
  );
  console.log("Local alignment passed:", result);
  const saved = await require("./helpers/saved-alignment-equivalence.cjs")(
    browser,
  );
  console.log("Saved alignment exact comparison passed:", saved);
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
