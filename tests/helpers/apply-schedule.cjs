"use strict";
/** Explicitly apply a schedule draft; old automatic-save tests use whole-history replacement. */
module.exports = async function applySchedule(page, choice = "all") {
  await page.locator("#scheduleApplyOpen").click();
  await page.locator("#scheduleRangeChoice").selectOption(choice);
  await page.locator("#scheduleRangeForm button[type=submit]").click();
  await page.locator("#scheduleRangeDialog").waitFor({ state: "hidden" });
};
