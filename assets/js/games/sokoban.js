"use strict";
WorkTimeApp.games.register({
  id: "game-sokoban",
  nameKey: "games.sokoban.name",
  descriptionKey: "games.sokoban.description",
  icon: "game-sokoban",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.sokobanRules;
    const bank = WorkTimeApp.data.sokoban;
    const levels = bank.levels;
    const chaptersConfig = bank.chapters;
    const maps = levels.map(rules.parse);
    const key = "worktime.games.sokoban.v1";
    let history = null,
      replayState = null;
    const historySave = { completionHistory: {} };
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    let animations = [],
      pendingMove = null,
      moving = false,
      motionRevision = 0;
    const stepDuration = 120;
    let heldKey = null,
      repeatTimer;
    function releaseKey() {
      clearTimeout(repeatTimer);
      heldKey = null;
      if (pendingMove?.repeat) pendingMove = null;
    }
    function repeatMove() {
      if (!heldKey) return;
      move(heldKey.direction, true);
      repeatTimer = setTimeout(repeatMove, stepDuration);
    }
    function stopMotion(clearQueue = true) {
      motionRevision++;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      moving = false;
      if (clearQueue) {
        releaseKey();
        pendingMove = null;
      }
    }
    const releasePreference = compat.listen(reduced, () => stopMotion());
    signal.addEventListener("abort", () => stopMotion(), { once: true });
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.sokoban." + name, params);
    let current = 0,
      chapter = 0,
      choosing = true,
      hasOpenGame = false,
      suspended = false;
    let disposed = false,
      confirming = false,
      saveFailed = false;
    const drafts = {},
      completed = {};
    try {
      const saved = JSON.parse(gameStorage.getItem(key));
      if (saved?.version === 1) {
        historySave.completionHistory =
          WorkTimeApp.services.gameArchive.normalizeHistory(
            "game-sokoban",
            saved.completionHistory,
          );
        levels.forEach((level, index) => {
          const record = rules.restore(
            maps[index],
            saved.completed?.[level.id],
          );
          if (record && rules.won(maps[index], record))
            completed[level.id] = record;
          const draft = rules.restore(maps[index], saved.drafts?.[level.id]);
          if (draft) drafts[level.id] = draft;
        });
        if (
          Number.isInteger(saved.chapter) &&
          saved.chapter >= 0 &&
          saved.chapter < chaptersConfig.length
        )
          chapter = saved.chapter;
        const index = levels.findIndex((level) => level.id === saved.current);
        if (index >= 0 && drafts[levels[index].id]) {
          current = index;
          chapter = Math.floor(index / 20);
          choosing = false;
          hasOpenGame = true;
        }
      }
    } catch {
      saveFailed = true;
    }
    const node = (tag, className, parent) => {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    };
    const listen = (element, event, callback, options = {}) =>
      element.addEventListener(event, callback, { ...options, signal });
    const root = node("section", "game-sokoban game-session", container);
    // Small, original vector sprites stay crisp on every tile size and work offline.
    const forestBox =
      '<rect x="7" y="7" width="50" height="50" rx="6" fill="var(--soko-wood-edge)"/><rect x="11" y="11" width="42" height="42" rx="3" fill="var(--soko-wood)"/><path d="M12 25h40M12 39h40" stroke="var(--soko-wood-edge)" stroke-width="2"/><path d="m14 14 36 36m0-36L14 50" stroke="var(--soko-wood-edge)" stroke-width="8"/><path d="m14 14 36 36m0-36L14 50" stroke="var(--soko-wood-brace)" stroke-width="5"/><path d="M15 15h.1M49 15h.1M15 49h.1M49 49h.1" stroke="var(--soko-wood-edge)" stroke-width="3" stroke-linecap="round"/>';
    const skins = chaptersConfig.map((entry) => entry.skin);
    const skinArt = {
      forest: {
        wall: '<rect x="2" y="5" width="60" height="56" rx="10" fill="#a5b697"/><path d="M4 32h56M26 7v24m16 2v27" stroke="#d8e0c9" stroke-width="3"/><path d="M3 17V9q0-7 9-7h40q10 0 10 9v8l-9-6-9 6-11-7-12 7-9-5Z" fill="#8bac79"/><path d="m10 8 8-2m21 1 10 1" stroke="#c5d9a8" stroke-width="3" stroke-linecap="round"/>',
        box: forestBox,
        player:
          '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#344C40"/><rect x="16" y="31" width="32" height="23" rx="8" fill="#C79049"/><path d="M24 32h16v22H24Z" fill="#6D8752"/><circle cx="13" cy="43" r="4" fill="#F4D4AC"/><circle cx="51" cy="43" r="4" fill="#F4D4AC"/><circle cx="32" cy="25" r="12" fill="#F4D4AC"/><path d="m15 18 7-12h20l7 12H15Z" fill="#6D8752"/><path d="M13 19h38M27 26v1m10-1v1" stroke="#344C40" stroke-width="2.5" stroke-linecap="round"/>',
        goal: '<circle cx="32" cy="32" r="13" fill="#E8EFCF" stroke="#587843" stroke-width="2.5"/><path d="M27 37q-3-12 10-11 1 12-10 11Z" fill="#6F8D52"/>',
      },
      desert: {
        wall: '<path d="M3 8 13 3h40l8 8v49H3Z" fill="#d3a28d"/><path d="M5 12h54v18H5zm0 22h25v23H5zm29 0h25v23H34Z" fill="#f0cdb8"/><path d="m40 15-6 7 7 3m-24 15 5 5-6 7" fill="none" stroke="#bd8c75" stroke-width="3"/><path d="M5 59h54" stroke="#b7816c" stroke-width="4"/>',
        box: '<rect x="7" y="7" width="50" height="50" rx="4" fill="#356f70"/><rect x="11" y="11" width="42" height="42" rx="2" fill="#72b9af"/><path d="M12 25h40M12 39h40" stroke="#55978f" stroke-width="2"/><path d="M17 9v46M47 9v46" stroke="#d8e8d5" stroke-width="7"/><path d="M17 16v1m0 30v1m30-32v1m0 30v1" stroke="#356f70" stroke-width="3" stroke-linecap="round"/><path d="m32 23 7 9-7 9-7-9Z" fill="#347b75"/>',
        player:
          '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#4E4A62"/><path d="M20 32h24l8 23H12Z" fill="#7778B2"/><path d="m26 34 6 9 6-9" fill="#DCE2EF"/><circle cx="14" cy="44" r="4" fill="#DBA77B"/><circle cx="50" cy="44" r="4" fill="#DBA77B"/><path d="M16 35V19a16 16 0 0 1 32 0v16Z" fill="#7778B2"/><rect x="21" y="15" width="22" height="21" rx="9" fill="#DBA77B"/><path d="M27 25v1m10-1v1" stroke="#593F35" stroke-width="2.5" stroke-linecap="round"/>',
        goal: '<path d="m32 18 14 14-14 14-14-14Z" fill="#E5F1E9" stroke="#367E79" stroke-width="2.5"/><circle cx="32" cy="32" r="3" fill="#367E79"/>',
      },
      space: {
        wall: '<rect x="2" y="2" width="60" height="60" rx="5" fill="#a7bac2"/><path d="M7 7h50v19H7zm0 23h50v27H7Z" fill="#edf2ef"/><path d="m9 9 7 7h32l7-7M9 54l8-8h30l8 8" fill="none" stroke="#c3d1d2" stroke-width="2"/><path d="M12 34h18m-18 5h18" stroke="#9eb4bc" stroke-width="3"/><path d="M43 35h9" stroke="#60aaa3" stroke-width="3" stroke-linecap="round"/>',
        box: '<rect x="6" y="6" width="52" height="52" rx="9" fill="#b8795c"/><path d="M13 10h38l3 12v20l-3 12H13l-3-12V22Z" fill="#edac8a"/><path d="M15 13h34M15 51h34" stroke="#ffe5bd" stroke-width="3"/><path d="m32 17 13 8v15l-13 8-13-8V25Z" fill="#fff1d8" stroke="#c58260" stroke-width="2"/><path d="m34 22-9 12h7l-2 9 10-14h-8Z" fill="#b7764e"/>',
        player:
          '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#638499"/><rect x="17" y="31" width="30" height="23" rx="7" fill="#DB776B"/><circle cx="13" cy="44" r="5" fill="#638499"/><circle cx="51" cy="44" r="5" fill="#638499"/><rect x="14" y="5" width="36" height="31" rx="14" fill="#DB776B"/><rect x="20" y="12" width="24" height="18" rx="8" fill="#547E92"/><path d="M25 18h10" stroke="#D4EFED" stroke-width="3" stroke-linecap="round"/>',
        goal: '<rect x="18" y="18" width="28" height="28" rx="5" fill="#E8F3E3" stroke="#4A8877" stroke-width="2.5"/><circle cx="32" cy="32" r="3" fill="#4A8877"/>',
      },
    };
    skinArt.glacier = {
      wall: '<path d="M3 12 13 3h39l9 12-3 46H4Z" fill="#94B5D5"/><path d="m14 4 12 18-8 17 13 21m-5-38 18-5 13 11M18 39 5 44m26-8 12 8 15-6" fill="none" stroke="#DDEBF6" stroke-width="3"/><path d="m38 5 6 12-3 12" fill="none" stroke="#F8FCFF" stroke-width="2"/>',
      box: '<rect x="7" y="7" width="50" height="50" rx="3" fill="#98642D"/><rect x="11" y="11" width="42" height="42" rx="2" fill="#D69A50"/><path d="M12 25h40M12 39h40" stroke="#98642D" stroke-width="2"/><path d="m14 14 36 36m0-36L14 50" stroke="#FFF0CB" stroke-width="6"/><path d="M16 16h1m30 0h1m-32 32h1m30 0h1" stroke="#98642D" stroke-width="3" stroke-linecap="round"/>',
      goal: '<path d="m32 18 14 14-14 14-14-14Z" fill="#F3EDFB" stroke="#7655A3" stroke-width="2.5"/><path d="m32 27 5 5-5 5-5-5Z" fill="#7655A3"/>',
      player:
        '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#235A63"/><rect x="16" y="31" width="32" height="24" rx="8" fill="#4E969C"/><circle cx="13" cy="44" r="4" fill="#4E969C"/><circle cx="51" cy="44" r="4" fill="#4E969C"/><rect x="16" y="5" width="32" height="33" rx="15" fill="#4E969C" stroke="#D8EFF2" stroke-width="2"/><rect x="22" y="14" width="20" height="20" rx="8" fill="#FFE8CC"/><path d="M27 24v1m10-1v1" stroke="#235A63" stroke-width="2.5" stroke-linecap="round"/>',
    };
    skinArt.forge = {
      wall: '<rect x="2" y="2" width="60" height="60" rx="3" fill="#BAA9A4"/><path d="M4 32h56M32 4v26M20 34v26" stroke="#E7DAD0" stroke-width="2"/><path d="m9 15 7 6-3 6m31 19 5 5-2 7" fill="none" stroke="#D98957" stroke-width="2"/><g fill="#8E7F84"><circle cx="9" cy="9" r="2"/><circle cx="55" cy="9" r="2"/><circle cx="9" cy="55" r="2"/><circle cx="55" cy="55" r="2"/></g>',
      box: '<path d="M13 6h38l7 7v38l-7 7H13l-7-7V13Z" fill="#3F7D88"/><rect x="11" y="11" width="42" height="42" rx="3" fill="#72B3B9"/><path d="M17 10v44m30-44v44" stroke="#E6F4E7" stroke-width="5"/><path d="m32 21 9 11-9 11-9-11Z" fill="#3F7D88" stroke="#E6F4E7" stroke-width="2"/><g fill="#E1F2ED"><circle cx="17" cy="17" r="2"/><circle cx="47" cy="17" r="2"/><circle cx="17" cy="47" r="2"/><circle cx="47" cy="47" r="2"/></g>',
      goal: '<circle cx="32" cy="32" r="14" fill="#FCEAE1" stroke="#A95246" stroke-width="3"/>',
      player:
        '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#4B4A52"/><rect x="17" y="31" width="30" height="24" rx="7" fill="#FFD46A"/><path d="M25 33h14v22H25Z" fill="#A88B58"/><circle cx="13" cy="43" r="4" fill="#FFD46A"/><circle cx="51" cy="43" r="4" fill="#FFD46A"/><rect x="21" y="14" width="22" height="22" rx="9" fill="#FFE9CD"/><path d="M16 18v-3a16 11 0 0 1 32 0v3Z" fill="#FFD46A" stroke="#8C703F" stroke-width="2"/><path d="M13 19h38" stroke="#8C703F" stroke-width="3" stroke-linecap="round"/><rect x="25" y="24" width="14" height="5" rx="2" fill="#4B4A52"/>',
    };
    skinArt.greenhouse = {
      wall: '<rect x="3" y="3" width="58" height="58" rx="7" fill="#95BCAA"/><rect x="7" y="7" width="50" height="50" rx="4" fill="#D3EADF"/><path d="M32 6v52M6 32h52" stroke="#95BCAA" stroke-width="4"/><path d="m11 11 13 13m15 15 13 13M12 42l9 9" stroke="#F5FCF6" stroke-width="4" stroke-linecap="round"/><path d="M7 58h50" stroke="#78A28E" stroke-width="3"/>',
      box: '<rect x="7" y="8" width="50" height="49" rx="5" fill="#AD7743"/><rect x="11" y="12" width="42" height="41" rx="2" fill="#E3B979"/><path d="M12 25h40M12 40h40" stroke="#C79658" stroke-width="2"/><path d="M17 11v43m30-43v43" stroke="#FFF0CF" stroke-width="5"/><path d="M32 45V24m0 11q-11 0-11-10 11 0 11 10m0 4q11 0 11-10-11 0-11 10" fill="#678D61" stroke="#496C4B" stroke-width="1.5"/>',
      goal: '<path d="M32 26C24 14 14 24 26 32C14 40 24 50 32 38C40 50 50 40 38 32C50 24 40 14 32 26Z" fill="#F5CCC3" stroke="#B45C58" stroke-width="2.5"/><circle cx="32" cy="32" r="2.5" fill="#B45C58"/>',
      player:
        '<path d="M21 47h9v13H18zm13 0h9l3 13H34" fill="#425F60"/><rect x="17" y="31" width="30" height="24" rx="7" fill="#CF8996"/><path d="M25 33h14v22H25Z" fill="#FFF2D9"/><circle cx="13" cy="43" r="4" fill="#FFE6CB"/><circle cx="51" cy="43" r="4" fill="#FFE6CB"/><circle cx="32" cy="25" r="12" fill="#FFE6CB"/><path d="m13 19 8-3 3-10h16l3 10 8 3Z" fill="#F4DCA2" stroke="#C09B5D" stroke-width="2" stroke-linejoin="round"/><path d="M27 26v1m10-1v1" stroke="#6E5144" stroke-width="2.5" stroke-linecap="round"/>',
    };
    skinArt.palace = {
      wall: '<rect x="3" y="3" width="58" height="58" rx="4" fill="#D8CDBA"/><path d="M8 12h48v39H8Z" fill="#F4EFE3"/><path d="M15 14v34m8-34v34m18-34v34m8-34v34" stroke="#E1D7C5" stroke-width="2"/><path d="M5 5h54v8H5Zm0 46h54v8H5Z" fill="#E5D3A2"/><path d="M8 7h48M8 54h48" stroke="#FFF7DE" stroke-width="2"/><path d="M29 15h6v33h-6Z" fill="#D5BC7C"/><path d="m27 25 5-5 5 5-5 5Z" fill="#FFF7DE"/>',
      box: '<rect x="6" y="6" width="52" height="52" rx="7" fill="#456E99"/><rect x="10" y="10" width="44" height="44" rx="4" fill="#83AFD3"/><path d="M11 20v-9h9m24 0h9v9m0 24v9h-9m-24 0h-9v-9" fill="none" stroke="#F6DFA5" stroke-width="5"/><path d="M12 30h40" stroke="#456E99" stroke-width="2"/><rect x="27" y="23" width="10" height="18" rx="3" fill="#F6DFA5" stroke="#A78443" stroke-width="1.5"/><circle cx="32" cy="30" r="2" fill="#456E99"/>',
      goal: '<path d="m32 18 14 14-14 14-14-14Z" fill="#FFFAE8" stroke="#B58B3F" stroke-width="2.5"/><circle cx="32" cy="32" r="3.5" fill="#5E98A7"/>',
      player:
        '<path d="M23 49h7v11h-7zm11 0h7v11h-7Z" fill="#507492"/><path d="M22 32q10-5 20 0l9 23q-9 4-19-1-10 5-19 1Z" fill="#FFF4D9" stroke="#C8B477" stroke-width="1.5" stroke-linejoin="round"/><rect x="20" y="32" width="24" height="23" rx="7" fill="#83AFD3"/><circle cx="32" cy="25" r="12" fill="#FFE6CF"/><path d="m24 15-1-7 5 3 4-6 4 6 5-3-1 7Z" fill="#D9B861"/><path d="M27 25v1m10-1v1" stroke="#5B6272" stroke-width="2.5" stroke-linecap="round"/>',
    };
    function sprite(parent, name, skin = root.dataset.skin) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 64 64");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.classList.add("sokoban-sprite");
      const art = skinArt[skin];
      svg.innerHTML =
        name === "boxGoal"
          ? art.box +
            '<g class="sokoban-solved-mark"><circle cx="45" cy="45" r="13" fill="#245f48" stroke="#fff" stroke-width="2"/><path d="m38 45 5 5 9-10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>'
          : art[name];
      parent.append(svg);
    }
    function button(parent, action, callback) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.sokobanAction = action;
      listen(element, "click", () => {
        if (!disposed && !signal.aborted && !suspended) callback();
      });
      return element;
    }
    function toolbarButton(parent, action, icon, callback) {
      const element = button(parent, action, callback);
      element.classList.add("sokoban-toolbar-button");
      element.append(WorkTimeApp.games.createIcon(icon));
      element.actionLabel = node("span", "", element);
      return element;
    }
    const hud = node("div", "sokoban-hud game-hud", root);
    const title = node("h3", "game-title", hud);
    const controls = node("div", "sokoban-controls", hud);
    const choose = toolbarButton(controls, "choose", "grid-4x4", () => {
      choosing = true;
      save();
      render();
      chapterButtons[chapter].focus();
    });
    const undo = toolbarButton(controls, "undo", "undo", () => {
      releaseKey();
      move("undo");
      board.focus({ preventScroll: true });
    });
    const restart = toolbarButton(
      controls,
      "restart",
      "restart-alt",
      requestRestart,
    );
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "sokoban-level-page",
      signal,
    );
    catalog.page.classList.add("sokoban-catalog");
    const chapters = catalog.categories;
    chapters.setAttribute("role", "group");
    const chapterNames = chaptersConfig.map((entry) => entry.id);
    const chapterButtons = chapterNames.map((_, index) =>
      button(chapters, "chapter-" + index, () => {
        chapter = index;
        save();
        render();
      }),
    );
    const grid = node("div", "sokoban-levels game-level-grid", catalog.entries);
    const levelButtons = Array.from({ length: 20 }, (_, index) =>
      button(grid, "level-" + index, () => open(chapter * 20 + index)),
    );
    const play = node("div", "sokoban-play", root);
    const sidebar = node("div", "sokoban-sidebar", play);
    sidebar.append(hud);
    const theorySection = node("div", "sokoban-theory-section", sidebar);
    const theoryCard = node("div", "sokoban-theory-card", theorySection);
    const theoryStats = ["moves", "pushes"].map((name) => {
      const element = node("div", "game-stat", theoryCard);
      return {
        name,
        label: node("span", "", element),
        value: node("strong", "", element),
      };
    });
    const meters = node("div", "sokoban-meters", sidebar);
    const stats = ["moves", "pushes"].map((name) => {
      const element = node("div", "game-stat", meters);
      return {
        name,
        label: node("span", "", element),
        value: node("strong", "", element),
      };
    });
    const stage = node("div", "sokoban-stage", play);
    const board = node("div", "sokoban-board", stage);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const actions = node("div", "sokoban-actions", play);
    const directions = node("div", "sokoban-directions", play);
    const directionButtons = Object.keys(rules.directions).map((direction) => {
      const element = button(directions, direction, () => move(direction));
      element.append(
        WorkTimeApp.games.createIcon(
          {
            u: "arrow-upward",
            r: "arrow-forward",
            d: "arrow-downward",
            l: "arrow-back",
          }[direction],
        ),
      );
      return { direction, element };
    });
    const feedback = node("div", "sokoban-feedback", play);
    const status = node("p", "sokoban-status", feedback);
    status.setAttribute("role", "status");
    const next = toolbarButton(feedback, "next", "arrow-forward", () => {
      if (current < levels.length - 1) open(current + 1);
      else {
        choosing = true;
        save();
        render();
        chapterButtons[chapter].focus();
      }
    });
    // Keep level information above the controls in the shared game sidebar.
    sidebar.append(controls, actions);
    actions.append(directions);
    actions.append(feedback);
    const footer = node("div", "sokoban-footer", root);
    const warning = node("p", "sokoban-warning", footer);
    warning.setAttribute("role", "status");
    const confirm = node("div", "sokoban-confirm", stage);
    confirm.hidden = true;
    confirm.setAttribute("role", "dialog");
    confirm.setAttribute("aria-modal", "true");
    const confirmText = node("p", "", confirm);
    const confirmActions = node("div", "sokoban-actions", confirm);
    const cancel = button(confirmActions, "cancel", () => closeConfirm());
    const reset = button(confirmActions, "reset", () => {
      drafts[levels[current].id] = rules.create();
      closeConfirm();
      save();
      render();
      board.focus({ preventScroll: true });
    });
    const paintRestartCover = WorkTimeApp.games.createRestartCover({
      cover: confirm,
      cancel,
      accept: reset,
      signal,
    });
    let savedInert = [];
    function state() {
      if (replayState) return replayState;
      return (drafts[levels[current].id] ||= rules.create());
    }
    function save() {
      if (history?.active) return;
      try {
        const serialize = (records) =>
          Object.fromEntries(
            Object.entries(records).map(([id, value]) => [
              id,
              { path: value.path },
            ]),
          );
        gameStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            current: choosing ? null : levels[current].id,
            chapter,
            drafts: serialize(drafts),
            completed: serialize(completed),
            completionHistory: historySave.completionHistory,
          }),
        );
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      warning.textContent = saveFailed ? t("saveFailed") : "";
    }
    function open(index) {
      hasOpenGame = true;
      current = index;
      chapter = Math.floor(index / 20);
      choosing = false;
      state();
      save();
      render();
      board.focus({ preventScroll: true });
    }
    function move(direction, repeat = false) {
      if (
        choosing ||
        history?.active ||
        confirming ||
        suspended ||
        disposed ||
        signal.aborted ||
        document.hidden
      )
        return;
      if (moving) {
        // Throttle to one step per animation, retaining only the latest tap.
        // Explicit taps take priority over held repeats; undo cannot be overwritten.
        if (
          (!repeat || !pendingMove) &&
          (direction === "undo" || pendingMove?.direction !== "undo")
        )
          pendingMove = { direction, repeat };
        return;
      }
      const changed =
        direction === "undo"
          ? rules.undo(state())
          : rules.move(maps[current], state(), direction);
      if (!changed) return;
      if (rules.won(maps[current], state())) {
        WorkTimeApp.services.gameArchive.addCompletion(
          historySave,
          levels[current].id,
          state().path,
        );
        const previous = completed[levels[current].id];
        if (
          !previous ||
          state().pushes < previous.pushes ||
          (state().pushes === previous.pushes && state().moves < previous.moves)
        )
          completed[levels[current].id] = rules.restore(maps[current], {
            path: state().path,
          });
      }
      save();
      render(true);
    }
    function requestRestart() {
      stopMotion();
      confirming = true;
      savedInert = [board, sidebar].map((child) => [child, child.inert]);
      savedInert.forEach(([child]) => (child.inert = true));
      confirm.hidden = false;
      paintRestartCover(true);
      cancel.focus({ preventScroll: true });
    }
    function closeConfirm() {
      confirming = false;
      confirm.hidden = true;
      paintRestartCover(false);
      savedInert.forEach(([child, inert]) => (child.inert = inert));
      savedInert = [];
      restart.focus({ preventScroll: true });
    }
    listen(confirm, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeConfirm();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        (document.activeElement === cancel ? reset : cancel).focus();
      }
    });
    const cells = [],
      pieceNodes = new Map();
    function render(animateMove = false) {
      history?.render();
      // Read layout once, before writes. Stable pieces share one tile geometry.
      const bounds =
        animateMove && !reduced.matches ? board.getBoundingClientRect() : null;
      const previous = new Map(
        [...pieceNodes].map(([id, piece]) => [id, piece.index]),
      );
      stopMotion(!animateMove);
      if (!animateMove) {
        root.dataset.skin =
          skins[choosing ? chapter : Math.floor(current / 20)];
        root.dataset.playing = String(!choosing);
        catalog.page.hidden = !choosing;
        hud.hidden = choosing;
        play.hidden = choosing;
        choose.hidden = choosing;
        title.textContent = t("level", {
          n: current + 1,
          total: levels.length,
        });
        choose.actionLabel.textContent = t("choose");
        catalog.setReturn(hasOpenGame ? () => open(current) : null);
        catalog.refresh();
        catalog.selectCategory(chapter);
        chapters.setAttribute("aria-label", t("catalog"));
        chapterButtons.forEach((element, index) => {
          element.replaceChildren();
          node("span", "sokoban-category-difficulty", element).textContent = t(
            chapterNames[index],
          );
          node("span", "sokoban-category-scene", element).textContent = t(
            chaptersConfig[index].skin,
          );
          element.setAttribute(
            "aria-label",
            t(chapterNames[index]) + " · " + t(chaptersConfig[index].skin),
          );
          element.setAttribute("aria-pressed", String(index === chapter));
        });
        const chapterLevels = levels.slice(chapter * 20, (chapter + 1) * 20);
        levelButtons.forEach((element, index) => {
          const number = chapter * 20 + index + 1;
          const { id } = chapterLevels[index];
          WorkTimeApp.games.paintLevelCard(element, {
            number,
            label: t("level", { n: number, total: levels.length }),
            complete: !!completed[id],
            draft: !!drafts[id]?.moves,
            current: current === number - 1 && Object.hasOwn(drafts, id),
          });
          let motif = element.querySelector(".sokoban-card-motif");
          if (!motif) motif = node("span", "sokoban-card-motif", element);
          motif.replaceChildren();
          sprite(motif, "goal");
        });
        undo.actionLabel.textContent = t("undo");
        restart.actionLabel.textContent = t("restart");
        cancel.textContent = t("cancel");
        reset.textContent = t("reset");
        confirmText.textContent = t("confirm");
        confirm.setAttribute("aria-label", t("restart"));
        paintRestartCover(confirming);
        warning.textContent = saveFailed ? t("saveFailed") : "";
        directionButtons.forEach(({ direction, element }) => {
          element.setAttribute("aria-label", t(direction));
          element.title = t(direction);
        });
      }
      if (choosing) return;
      const map = maps[current],
        value = state(),
        position = rules.position(map, value);
      theoryCard.title = t(
        bank.optima?.[levels[current].id]?.moves?.basis === "public-record"
          ? "publicOptimaHelp"
          : "optimaHelp",
      );
      theoryStats.forEach(({ name, label, value: element }) => {
        label.textContent = t(name === "moves" ? "minMoves" : "minPushes");
        const minimum =
          name === "moves"
            ? bank.optima?.[levels[current].id]?.moves?.value
            : bank.optima?.[levels[current].id]?.moves?.pushes;
        element.textContent =
          minimum == null ? t("unverified") : String(minimum);
        element.classList.toggle("is-unverified", minimum == null);
      });
      stats.forEach(({ name, label, value: element }) => {
        label.textContent = t(name);
        WorkTimeApp.games.paintCounter(element, value[name]);
      });
      const won = rules.won(map, value);
      root.classList.toggle("is-won", won);
      undo.disabled = !value.moves;
      next.disabled = !won;
      next.setAttribute("aria-hidden", String(!won));
      next.tabIndex = won ? 0 : -1;
      next.actionLabel.textContent =
        current === levels.length - 1 ? t("finish") : t("next");
      status.textContent =
        !won && rules.deadlocked(map, value) ? t("deadlock") : "";
      directionButtons.forEach(({ element }) => (element.disabled = won));
      board.style.setProperty("--columns", map.width);
      board.style.setProperty("--rows", map.height);
      board.setAttribute("aria-label", t("board", { n: current + 1 }));
      if (!animateMove) {
        cells.length = 0;
        pieceNodes.clear();
        const fragment = document.createDocumentFragment();
        for (let y = 0; y < map.height; y++)
          for (let x = 0; x < map.width; x++) {
            const index = y * map.width + x;
            const cell = node("span", "sokoban-cell", fragment);
            cells[index] = cell;
            cell.style.gridColumn = String(x + 1);
            cell.style.gridRow = String(y + 1);
            const wall = levels[current].rows[y][x] === "#";
            cell.classList.toggle("is-wall", wall);
            cell.classList.toggle("is-floor", map.floors.has(index));
            cell.classList.toggle("is-goal", map.goals.has(index));
            if (wall) sprite(cell, "wall");
            if (map.goals.has(index)) sprite(cell, "goal");
            if (map.floors.has(index)) cell.setAttribute("role", "img");
            else cell.setAttribute("aria-hidden", "true");
          }
        for (const [id, index] of [
          ["player", position.player],
          ...position.boxes.map((index, i) => ["box-" + i, index]),
        ]) {
          const player = id === "player";
          const element = node(
            "span",
            player ? "sokoban-player" : "sokoban-box",
            fragment,
          );
          element.dataset.piece = id;
          element.setAttribute("aria-hidden", "true");
          sprite(element, player ? "player" : "boxGoal");
          pieceNodes.set(id, { element, index });
        }
        board.replaceChildren(fragment);
      }
      const changedCells = new Set();
      pieceNodes.forEach((piece, id) => {
        const index =
          id === "player"
            ? position.player
            : position.boxes[Number(id.slice(4))];
        if (!animateMove || piece.index !== index) {
          changedCells.add(piece.index);
          changedCells.add(index);
          piece.element.style.gridColumn = String((index % map.width) + 1);
          piece.element.style.gridRow = String(
            Math.floor(index / map.width) + 1,
          );
          piece.element.classList.toggle("on-goal", map.goals.has(index));
          piece.index = index;
        }
      });
      // Empty and occupied floor labels stay correct without rebuilding SVGs.
      const labels = animateMove ? changedCells : map.floors;
      labels.forEach((index) => {
        const box = position.boxes.includes(index);
        cells[index].setAttribute(
          "aria-label",
          t("cell", {
            row: Math.floor(index / map.width) + 1,
            col: (index % map.width) + 1,
            value: t(
              position.player === index
                ? "player"
                : box
                  ? map.goals.has(index)
                    ? "boxGoal"
                    : "box"
                  : map.goals.has(index)
                    ? "goal"
                    : "floor",
            ),
          }),
        );
      });
      const token = motionRevision;
      const startTime = document.timeline?.currentTime;
      if (bounds && !suspended && !document.hidden)
        pieceNodes.forEach(({ element: piece, index }, id) => {
          const before = previous.get(id);
          if (before === undefined || before === index) return;
          const x =
              (((before % map.width) - (index % map.width)) * bounds.width) /
              map.width,
            y =
              ((Math.floor(before / map.width) -
                Math.floor(index / map.width)) *
                bounds.height) /
              map.height;
          if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;
          animations.push(
            compat.animate(
              piece,
              [
                { transform: `translate(${x}px, ${y}px)` },
                { transform: "translate(0px, 0px)" },
              ],
              {
                duration: stepDuration,
                easing: "linear",
                fill: "both",
              },
              startTime,
            ),
          );
        });
      moving = animations.length > 0;
      if (moving)
        void Promise.all(
          animations.map((animation) => animation.finished),
        ).then(() => {
          if (token !== motionRevision || disposed || signal.aborted) return;
          animations = [];
          moving = false;
          if (pendingMove) {
            const entry = pendingMove;
            pendingMove = null;
            move(entry.direction, entry.repeat);
          }
        });
    }
    listen(root, "keydown", (event) => {
      if (
        event.altKey ||
        choosing ||
        confirming ||
        event.target.closest("a, button, input, select, textarea")
      )
        return;
      const keyName = event.key.toLowerCase();
      const direction = {
        arrowup: "u",
        w: "u",
        arrowright: "r",
        d: "r",
        arrowdown: "d",
        s: "d",
        arrowleft: "l",
        a: "l",
      }[keyName];
      if (direction && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        // Own the repeat cadence instead of mixing OS timing with animation timing.
        if (event.repeat) return;
        releaseKey();
        move(direction);
        heldKey = { key: keyName, direction };
        repeatTimer = setTimeout(repeatMove, 180);
      } else if (keyName === "z" && !event.repeat) {
        event.preventDefault();
        undo.click();
      } else if (
        keyName === "r" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.repeat
      ) {
        event.preventDefault();
        restart.click();
      }
    });
    listen(window, "keyup", (event) => {
      if (event.key.toLowerCase() === heldKey?.key) releaseKey();
    });
    listen(window, "blur", releaseKey);
    listen(root, "focusout", (event) => {
      if (!board.contains(event.relatedTarget)) releaseKey();
    });
    listen(document, "visibilitychange", () => {
      if (document.hidden) releaseKey();
    });
    let touch = null;
    listen(board, "pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      touch = { x: event.clientX, y: event.clientY, id: event.pointerId };
      board.setPointerCapture(event.pointerId);
    });
    listen(board, "pointerup", (event) => {
      if (!touch || touch.id !== event.pointerId) return;
      const x = event.clientX - touch.x,
        y = event.clientY - touch.y;
      touch = null;
      if (Math.max(Math.abs(x), Math.abs(y)) >= 18)
        move(
          Math.abs(x) > Math.abs(y) ? (x > 0 ? "r" : "l") : y > 0 ? "d" : "u",
        );
    });
    listen(board, "pointercancel", () => (touch = null));
    listen(document, "worktime:languagechange", () => render());
    history = WorkTimeApp.games.createCompletionHistory({
      root,
      host: sidebar,
      signal,
      records: () =>
        choosing
          ? null
          : (historySave.completionHistory[levels[current].id] ?? []),
      steps: (path) => path.length,
      onStart() {
        stopMotion();
        touch = null;
      },
      onFrame(path) {
        replayState = rules.restore(maps[current], { path });
        render();
      },
      onExit() {
        replayState = null;
        render();
      },
    });
    render();
    return {
      pause() {
        history.pause();
        stopMotion();
        suspended = true;
        touch = null;
        save();
      },
      resume() {
        suspended = false;
      },
      resize() {
        stopMotion();
      },
      dispose() {
        history.dispose();
        disposed = true;
        stopMotion();
        releasePreference();
        save();
        root.remove();
      },
    };
  },
});
