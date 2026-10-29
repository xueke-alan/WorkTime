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
    "game-tank": `<rect x="5" y="15" width="22" height="11" rx="4"/><path d="M10 15v-5h10l3 5M17 10V5h10M10 21h12"/><circle cx="10" cy="21" r="1"/><circle cx="22" cy="21" r="1"/>`,
    "game-garden": `<rect x="4" y="12" width="14" height="15" rx="3"/><path d="M11 8V6a2 2 0 0 1 2-2h12a3 3 0 0 1 3 3v12a2 2 0 0 1-2 2h-3"/><path d="M11 23v-7m0 4c-4 0-4-4-4-4 4 0 4 4 4 4Zm0 0c4 0 4-4 4-4-4 0-4 4-4 4Z"/>`,
    "game-link": `<rect x="3" y="5" width="10" height="13" rx="2"/><rect x="19" y="14" width="10" height="13" rx="2"/><path d="M8 22v5h7m9-17V5h-7"/>`,
    "game-2048": `<rect x="5" y="5" width="9" height="9" rx="2"/><rect x="18" y="5" width="9" height="9" rx="2"/>
      <rect x="5" y="18" width="9" height="9" rx="2"/><rect x="18" y="18" width="9" height="9" rx="2"/>`,
    "game-minesweeper": `<circle cx="16" cy="16" r="7"/>
      <path d="M16 4v3m0 18v3M4 16h3m18 0h3M7.5 7.5l2 2m13 13 2 2m-17 0 2-2m13-13 2-2"/>`,
    "game-snake": `<path d="M6 26h12a5 5 0 0 0 0-10h-4a5 5 0 0 1 0-10h12"/>`,
    "game-sudoku": `<rect x="5" y="5" width="22" height="22" rx="2"/>
      <path d="M12.5 5v22M20 5v22M5 12.5h22M5 20h22"/>`,
    "game-jump": `<circle cx="10" cy="9" r="2.5"/>
      <path d="m8.5 15-2 8h7l-2-8zM4 27h12m5-9h7"/>`,
    "game-sokoban": `<rect x="6" y="6" width="20" height="20" rx="2"/>
      <path d="m10 10 12 12m0-12L10 22"/>`,
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
    list: () => [...entries.values()],
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
