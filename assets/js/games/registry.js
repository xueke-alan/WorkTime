"use strict";
/** Classic-script game catalog. Factories own only their supplied container.
 * create({container, signal}) returns {dispose, resize?, pause?, resume?}.
 * dispose is required; signal is aborted before dispose on every departure.
 * resize receives {width, height} in CSS pixels. Games may persist their own
 * state separately; the shell never reads or writes work records or game saves.
 */
WorkTimeApp.games = (() => {
  const entries = new Map();
  const definitions = new Map();
  const usageKey = "worktime.games.usage.v1";
  let usage = {};
  try {
    const saved = JSON.parse(localStorage.getItem(usageKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      usage = Object.fromEntries(
        Object.entries(saved).filter(
          ([, value]) =>
            value &&
            Number.isSafeInteger(value.count) &&
            value.count > 0 &&
            Number.isSafeInteger(value.lastPlayed) &&
            value.lastPlayed >= 0,
        ),
      );
  } catch {
    // Storage restrictions must not prevent opening the game library.
  }
  async function load(id, rulesOnly = false) {
    const definition = definitions.get(id);
    if (!definition) {
      if (entries.has(id)) return entries.get(id);
      throw Error("Unknown game: " + id);
    }
    await WorkTimeApp.services.assets.scripts(definition.rules);
    if (!rulesOnly)
      await Promise.all([
        WorkTimeApp.services.assets.style(definition.style),
        WorkTimeApp.services.assets.script(definition.source),
      ]);
    return entries.get(id);
  }
  // Minimal menu artwork: a shared 32px grid and uniform rounded outlines.
  // Inline SVG keeps the offline entry self-contained and crisp at any scale.
  const gameIcons = {
    "game-gomoku": `<path d="M4 10h2m8 0h14M4 22h14m8 0h2M10 4v2m0 8v14M22 4v14m0 8v2"/><circle cx="10" cy="10" r="4" fill="currentColor"/><circle cx="22" cy="22" r="4"/>`,
    "game-tank": `<rect x="5" y="15" width="22" height="11" rx="4"/><path d="M10 15v-5h10l3 5M17 10V5h10M10 21h12"/><circle cx="10" cy="21" r="1"/><circle cx="22" cy="21" r="1"/>`,
    "game-garden": `<path d="M8 23a5 5 0 0 1-4-8 5 5 0 0 1 3-8 5 5 0 0 1 8-2 5 5 0 0 1 8 4M9 23v5m10-5v5"/><path d="M20 13c-5-5-8-1-5 2m10-2c5-5 7-1 4 2M17 14h10v5a5 5 0 0 1-10 0Zm3 3v1m4-1v1M8 23h12"/>`,
    "game-link": `<rect x="3" y="5" width="10" height="13" rx="2"/><rect x="19" y="14" width="10" height="13" rx="2"/><path d="M8 22v5h7m9-17V5h-7"/>`,
    "game-2048": `<rect x="5" y="5" width="9" height="9" rx="2"/><rect x="18" y="5" width="9" height="9" rx="2"/>
      <rect x="5" y="18" width="9" height="9" rx="2"/><rect x="18" y="18" width="9" height="9" rx="2"/>`,
    "game-minesweeper": `<circle cx="16" cy="16" r="7"/>
      <path d="M16 4v3m0 18v3M4 16h3m18 0h3M7.5 7.5l2 2m13 13 2 2m-17 0 2-2m13-13 2-2"/>`,
    "game-snake": `<path d="M18 9h-5a5 5 0 0 0 0 10h5a4 4 0 0 1 0 8H6" stroke-width="4"/><rect x="18" y="5" width="10" height="8" rx="3"/><circle cx="23" cy="8" r="1" fill="currentColor" stroke="none"/><path d="M28 10h2"/>`,
    "game-sudoku": `<rect x="5" y="5" width="22" height="22" rx="2"/>
      <path d="M12.5 5v22M20 5v22M5 12.5h22M5 20h22"/>`,
    "game-jump": `<circle cx="10" cy="9" r="2.5"/>
      <path d="m8.5 15-2 8h7l-2-8zM4 27h12m5-9h7"/>`,
    "game-sokoban": `<rect x="6" y="6" width="20" height="20" rx="2"/>
      <path d="m10 10 12 12m0-12L10 22"/>`,
    "game-xiangqi": `<circle cx="16" cy="16" r="12"/><path d="M10 10h12M11 13h10v7H11zM11 16.5h10M9 23h14M16 8v17" stroke-width="1.7"/>`,
  };
  return {
    define(catalog) {
      for (const definition of catalog) {
        if (definitions.has(definition.id) || entries.has(definition.id))
          throw Error("Duplicate game definition");
        definitions.set(definition.id, Object.freeze(definition));
        entries.set(
          definition.id,
          Object.freeze({ ...definition, lazy: true }),
        );
      }
    },
    load,
    prepareArchive: (ids = [...definitions.keys()]) =>
      Promise.all(ids.map((id) => load(id, true))),
    register(entry) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !/^[a-z][a-z0-9-]*$/.test(entry.id) ||
        typeof entry.nameKey !== "string" ||
        !entry.nameKey ||
        typeof entry.descriptionKey !== "string" ||
        !entry.descriptionKey ||
        typeof entry.create !== "function" ||
        (entries.has(entry.id) && !entries.get(entry.id).lazy)
      )
        throw Error("Invalid or duplicate game registration");
      entries.set(entry.id, Object.freeze({ ...entry }));
    },
    list: () =>
      [...entries.values()].sort(
        (a, b) =>
          (usage[b.id]?.count || 0) - (usage[a.id]?.count || 0) ||
          (usage[b.id]?.lastPlayed || 0) - (usage[a.id]?.lastPlayed || 0),
      ),
    recordPlay(id) {
      if (!entries.has(id)) return;
      usage[id] = {
        count: Math.min(Number.MAX_SAFE_INTEGER, (usage[id]?.count || 0) + 1),
        lastPlayed: Date.now(),
      };
      try {
        localStorage.setItem(usageKey, JSON.stringify(usage));
      } catch {
        // Keep the current session's order when persistence is unavailable.
      }
    },
    get: (id) => entries.get(id),
    createIcon(icon = "sports-esports") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "ui-icon");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      if (Object.hasOwn(gameIcons, icon)) {
        svg.classList.add("game-menu-icon");
        svg.setAttribute("viewBox", "0 0 32 32");
        svg.dataset.gameIcon = icon;
        svg.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${gameIcons[icon]}</g>`;
        return svg;
      }
      const use = document.createElementNS(svg.namespaceURI, "use");
      use.setAttribute("href", "#ms-" + icon);
      svg.append(use);
      return svg;
    },
  };
})();
