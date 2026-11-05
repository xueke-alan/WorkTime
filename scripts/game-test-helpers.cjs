"use strict";

async function launchGame(
  page,
  id,
  { menu = "#gamesPanel", touch = false } = {},
) {
  const list = page.locator(menu);
  const entry = list.locator(`[data-game="${id}"]`);
  const play = list.locator(".game-menu-play");
  if (touch) {
    await entry.tap();
    await play.tap();
  } else {
    await entry.click();
    await play.click();
  }
}

module.exports = { launchGame };
