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
    const maps = levels.map(rules.parse);
    const key = "worktime.games.sokoban.v1";
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    let animations = [],
      pendingMoves = [],
      moving = false,
      motionRevision = 0;
    function stopMotion(clearQueue = true) {
      motionRevision++;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      moving = false;
      if (clearQueue) pendingMoves = [];
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
          saved.chapter < 3
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
    const skins = ["forest", "desert", "space"];
    const skinArt = {
      forest: {
        wall: '<rect x="2" y="5" width="60" height="56" rx="10" fill="#71836a"/><path d="M4 32h56M26 7v24m16 2v27" stroke="#b2bca1" stroke-width="3"/><path d="M3 17V9q0-7 9-7h40q10 0 10 9v8l-9-6-9 6-11-7-12 7-9-5Z" fill="#4e7744"/><path d="m10 8 8-2m21 1 10 1" stroke="#8fac62" stroke-width="3" stroke-linecap="round"/>',
        box: forestBox,
        player:
          '<ellipse cx="32" cy="58" rx="20" ry="4" fill="#354c3d" opacity=".2"/><path d="M20 47h10v13H17zm14 0h10l3 13H34" fill="#344c40"/><rect x="14" y="31" width="36" height="23" rx="9" fill="#c79049"/><path d="M23 34v16m18-16v16" stroke="#576e40" stroke-width="5"/><circle cx="11" cy="43" r="5" fill="#f4d4ac"/><circle cx="53" cy="43" r="5" fill="#f4d4ac"/><rect x="17" y="12" width="30" height="26" rx="12" fill="#f4d4ac"/><path d="M18 18 22 5h20l5 13" fill="#57783f"/><path d="M11 19h42" stroke="#37523c" stroke-width="5" stroke-linecap="round"/><path d="m37 11 9-8" stroke="#d0dca1" stroke-width="3"/><path d="M25 26v2m14-2v2" stroke="#344c40" stroke-width="3" stroke-linecap="round"/><path d="m27 34 5 7 5-7" fill="#a44f36"/>',
        goal: '<circle cx="32" cy="32" r="17" fill="#d9e7b5" stroke="#476a3b" stroke-width="3"/><path d="m17 26 8-9m14 0 8 9m0 12-8 9m-14 0-8-9" stroke="#7c984b" stroke-width="6" stroke-linecap="round"/><path d="m32 24 3 5 6 3-6 3-3 5-3-5-6-3 6-3Z" fill="#476a3b"/>',
      },
      desert: {
        wall: '<path d="M3 8 13 3h40l8 8v49H3Z" fill="#b87961"/><path d="M5 12h54v18H5zm0 22h25v23H5zm29 0h25v23H34Z" fill="#dda88d"/><path d="m40 15-6 7 7 3m-24 15 5 5-6 7" fill="none" stroke="#be8068" stroke-width="3"/><path d="M5 59h54" stroke="#9e604f" stroke-width="4"/>',
        box: '<rect x="7" y="7" width="50" height="50" rx="4" fill="#356f70"/><rect x="11" y="11" width="42" height="42" rx="2" fill="#72b9af"/><path d="M12 25h40M12 39h40" stroke="#55978f" stroke-width="2"/><path d="M17 9v46M47 9v46" stroke="#d8e8d5" stroke-width="7"/><path d="M17 16v1m0 30v1m30-32v1m0 30v1" stroke="#356f70" stroke-width="3" stroke-linecap="round"/><path d="m32 23 7 9-7 9-7-9Z" fill="#347b75"/>',
        player:
          '<ellipse cx="32" cy="58" rx="20" ry="4" fill="#356f70" opacity=".2"/><path d="M20 48h10v12H16zm14 0h10l4 12H34" fill="#4e4a62"/><path d="M19 31h26l8 23H11Z" fill="#666c9c"/><path d="M23 34h18l-3 20H26Z" fill="#cbd4ea"/><circle cx="12" cy="44" r="5" fill="#dba77b"/><circle cx="52" cy="44" r="5" fill="#dba77b"/><path d="M15 37V17Q15 3 32 3t17 14v23l-8-6H23Z" fill="#7778b2"/><rect x="20" y="16" width="24" height="20" rx="9" fill="#dba77b"/><path d="M17 17h30" stroke="#4e527d" stroke-width="5"/><path d="M26 25v2m12-2v2" stroke="#593f35" stroke-width="3" stroke-linecap="round"/><path d="M21 32h22l-5 9H26Z" fill="#514e83"/>',
        goal: '<path d="m32 10 22 22-22 22L10 32Z" fill="#d9eee3" stroke="#367e79" stroke-width="3"/><path d="m32 19 13 13-13 13-13-13Z" fill="none" stroke="#6aa997" stroke-width="2"/><path d="M26 32h12m-6-6v12" stroke="#367e79" stroke-width="3"/>',
      },
      space: {
        wall: '<rect x="2" y="2" width="60" height="60" rx="5" fill="#a7bac2"/><path d="M7 7h50v19H7zm0 23h50v27H7Z" fill="#edf2ef"/><path d="m9 9 7 7h32l7-7M9 54l8-8h30l8 8" fill="none" stroke="#c3d1d2" stroke-width="2"/><path d="M12 34h18m-18 5h18" stroke="#9eb4bc" stroke-width="3"/><path d="M43 35h9" stroke="#60aaa3" stroke-width="3" stroke-linecap="round"/>',
        box: '<rect x="6" y="6" width="52" height="52" rx="9" fill="#b8795c"/><path d="M13 10h38l3 12v20l-3 12H13l-3-12V22Z" fill="#edac8a"/><path d="M15 13h34M15 51h34" stroke="#ffe5bd" stroke-width="3"/><path d="m32 17 13 8v15l-13 8-13-8V25Z" fill="#fff1d8" stroke="#c58260" stroke-width="2"/><path d="m34 22-9 12h7l-2 9 10-14h-8Z" fill="#b7764e"/>',
        player:
          '<ellipse cx="32" cy="59" rx="21" ry="4" fill="#7f9ba6" opacity=".35"/><rect x="10" y="27" width="44" height="22" rx="7" fill="#849daf"/><path d="M20 46h11v14H17zm13 0h11l3 14H33" fill="#638499"/><rect x="17" y="30" width="30" height="24" rx="8" fill="#db776b"/><rect x="25" y="36" width="14" height="10" rx="2" fill="#f4ded0"/><path d="M28 40h8" stroke="#a85450" stroke-width="3"/><circle cx="12" cy="46" r="6" fill="#638499"/><circle cx="52" cy="46" r="6" fill="#638499"/><rect x="13" y="3" width="38" height="33" rx="15" fill="#db776b"/><rect x="18" y="10" width="28" height="20" rx="9" fill="#547e92"/><path d="M23 16h13" stroke="#d4efed" stroke-width="4" stroke-linecap="round"/><path d="M39 22h2" stroke="#fff9ed" stroke-width="3"/>',
        goal: '<rect x="12" y="12" width="40" height="40" rx="8" fill="#e2f0dc" stroke="#609c87" stroke-width="2"/><path d="M12 23V12h11m18 0h11v11m0 18v11H41m-18 0H12V41" fill="none" stroke="#4a8877" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="none" stroke="#609c87" stroke-width="3"/><circle cx="32" cy="32" r="2" fill="#4a8877"/>',
      },
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
    const chapterNames = ["easy", "medium", "hard"];
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
    const meters = node("div", "sokoban-meters", sidebar);
    const stats = ["moves", "pushes", "best"].map((name) => {
      const element = node("div", "game-stat", meters);
      return {
        name,
        label: node("span", "", element),
        value: node("strong", "", element),
      };
    });
    const stage = node("div", "sokoban-stage", play);
    const goalCard = node("div", "game-stat sokoban-goal-progress", meters);
    const goalLabel = node("span", "", goalCard);
    const goalProgress = node("strong", "", goalCard);
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
    const next = button(feedback, "next", () => {
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
      return (drafts[levels[current].id] ||= rules.create());
    }
    function save() {
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
    function move(direction) {
      if (
        choosing ||
        confirming ||
        suspended ||
        disposed ||
        signal.aborted ||
        document.hidden
      )
        return;
      if (moving) {
        if (pendingMoves.length < 8) pendingMoves.push(direction);
        return;
      }
      const changed =
        direction === "undo"
          ? rules.undo(state())
          : rules.move(maps[current], state(), direction);
      if (!changed) return;
      if (rules.won(maps[current], state())) {
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
          element.textContent = t(chapterNames[index]);
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
      const record = completed[levels[current].id];
      stats.forEach(({ name, label, value: element }) => {
        label.textContent = t(name);
        WorkTimeApp.games.paintCounter(
          element,
          name === "best" ? (record?.pushes ?? "—") : value[name],
        );
      });
      const won = rules.won(map, value);
      root.classList.toggle("is-won", won);
      goalLabel.textContent = t("goalsLabel");
      goalProgress.textContent = `${position.boxes.filter((box) => map.goals.has(box)).length} / ${map.goals.size}`;
      undo.disabled = !value.moves;
      next.disabled = !won;
      next.setAttribute("aria-hidden", String(!won));
      next.tabIndex = won ? 0 : -1;
      next.textContent =
        current === levels.length - 1 ? t("finish") : t("next");
      status.textContent = won
        ? Object.keys(completed).length === levels.length
          ? t("allWon")
          : t("won")
        : rules.deadlocked(map, value)
          ? t("deadlock")
          : "";
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
                duration: 120,
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
          while (pendingMoves.length && !moving) move(pendingMoves.shift());
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
        // Buffer only one OS repeat so a held key stops promptly on release.
        if (event.repeat && moving && pendingMoves.length) return;
        move(direction);
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
    render();
    return {
      pause() {
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
        disposed = true;
        stopMotion();
        releasePreference();
        save();
        root.remove();
      },
    };
  },
});
