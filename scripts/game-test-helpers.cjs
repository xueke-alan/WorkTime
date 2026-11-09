"use strict";

async function launchGame(
  page,
  id,
  { menu = "#gamesPanel", touch = false } = {},
) {
  const list = page.locator(menu);
  if (menu === "#gamesPanel") {
    if (await page.locator("#gameShell").isVisible()) {
      await page.locator("#gameExitButton").click();
      await page.locator("#gameShell").waitFor({ state: "hidden" });
    }
    if (!(await list.isVisible()))
      await page.locator("#date-tab-games").click();
  }
  const entry = list.locator(`[data-game="${id}"]`);
  const play = list.locator(".game-menu-play");
  if (touch) {
    await entry.tap();
    await play.tap();
  } else {
    await entry.click();
    await play.click();
  }
  await page.waitForFunction(() => {
    const content = document.querySelector("#gameShell .game-content");
    return (
      content &&
      !content.hasAttribute("aria-busy") &&
      content.childElementCount > 0
    );
  });
}

async function continueGame(page, game, action = "start") {
  const prefix = game === "minesweeper" ? "mine" : game;
  const paused = await page
    .locator(`.game-${game} .game-pause-cover:not(.game-pause-outgoing)`)
    .isVisible();
  await page
    .locator(`[data-${prefix}-action="${paused ? "pause" : action}"]`)
    .click();
}
module.exports = { launchGame, continueGame };
