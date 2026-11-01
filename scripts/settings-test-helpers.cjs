"use strict";
/** Exercise settings through the public entry and tabs, including return toggles. */
async function clickSettingsControl(page, selector) {
  const targets = {
    "#pageSettingsOpen": "#settingsGeneralTab",
    "#settingsWorkTab": "#settingsWorkTab",
    "#settingsPersonalTab": "#settingsPersonalTab",
  };
  const tab = targets[selector];
  if (!tab) return page.locator(selector).click();
  const open = await page.locator("#settingsPane").isVisible();
  if (
    open &&
    (await page.locator(tab).getAttribute("aria-selected")) === "true"
  ) {
    await page.locator("#pageSettingsOpen").click();
    return;
  }
  if (!open) await page.locator("#pageSettingsOpen").click();
  await page.locator(tab).click();
}
module.exports = { clickSettingsControl };
