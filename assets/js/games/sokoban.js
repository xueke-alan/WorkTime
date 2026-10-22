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
      suspended = false;
    let disposed = false,
      confirming = false,
      saveFailed = false;
    const drafts = {},
      completed = {};
    const unlocked = (index) =>
      index === 0 ||
      !!completed[levels[index - 1].id] ||
      !!completed[levels[index].id];
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
        if (index >= 0 && unlocked(index) && drafts[levels[index].id]) {
          current = index;
          chapter = Math.floor(index / 20);
          choosing = false;
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
    const artwork = {
      wall: '<rect x="3" y="4" width="58" height="56" rx="9" fill="var(--soko-stone)"/><path d="M5 29h54M26 5v23m17 2v29" fill="none" stroke="var(--soko-mortar)" stroke-width="3"/><path d="M12 11h9m13 27h8M11 48h7" fill="none" stroke="var(--soko-stone-mark)" stroke-width="3" stroke-linecap="round"/>',
      box: '<rect x="7" y="7" width="50" height="50" rx="6" fill="var(--soko-wood-edge)"/><rect x="11" y="11" width="42" height="42" rx="3" fill="var(--soko-wood)"/><path d="M12 25h40M12 39h40" stroke="var(--soko-wood-edge)" stroke-width="2"/><path d="m14 14 36 36m0-36L14 50" stroke="var(--soko-wood-edge)" stroke-width="8"/><path d="m14 14 36 36m0-36L14 50" stroke="var(--soko-wood-brace)" stroke-width="5"/><path d="M15 15h.1M49 15h.1M15 49h.1M49 49h.1" stroke="var(--soko-wood-edge)" stroke-width="3" stroke-linecap="round"/>',
      boxGoal:
        '<rect x="7" y="7" width="50" height="50" rx="6" fill="var(--accent)"/><rect x="11" y="11" width="42" height="42" rx="3" fill="var(--soko-solved)"/><path d="M12 25h40M12 39h40" stroke="var(--accent)" stroke-opacity=".22" stroke-width="2"/><circle cx="32" cy="32" r="15" fill="var(--accent)"/><path d="m24 32 6 6 11-12" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
      player:
        '<path d="M18 50h12v10H17q-3-5 1-10m16 0h12l1 10H34Z" fill="var(--soko-ink)"/><rect x="12" y="32" width="40" height="23" rx="10" fill="var(--accent)"/><path d="M23 33v11h18V33M32 44v11" fill="none" stroke="var(--soko-overalls)" stroke-width="6"/><rect x="15" y="13" width="34" height="26" rx="12" fill="#f4d4ac"/><path d="M15 22v-7Q16 4 32 4t17 11v7Z" fill="var(--accent)"/><path d="M18 21h35" stroke="var(--soko-ink)" stroke-width="5" stroke-linecap="round"/><path d="M25 27v2m14-2v2" stroke="var(--soko-ink)" stroke-width="3" stroke-linecap="round"/><path d="M29 33q3 3 6 0" fill="none" stroke="#a06f50" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="44" r="5" fill="#f4d4ac"/><circle cx="52" cy="44" r="5" fill="#f4d4ac"/>',
    };
    function sprite(parent, name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 64 64");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.classList.add("sokoban-sprite");
      svg.innerHTML = artwork[name];
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
    const hud = node("div", "sokoban-hud game-hud", root);
    const title = node("h3", "game-title", hud);
    const controls = node("div", "sokoban-controls", hud);
    const choose = button(controls, "choose", () => {
      choosing = true;
      save();
      render();
      chapterButtons[chapter].focus();
    });
    const catalog = node("div", "sokoban-catalog", root);
    const chapters = node("div", "sokoban-chapters", catalog);
    const chapterButtons = [0, 1, 2].map((index) =>
      button(chapters, "chapter-" + index, () => {
        chapter = index;
        save();
        render();
      }),
    );
    const progress = node("p", "sokoban-progress", catalog);
    const grid = node("div", "sokoban-levels", catalog);
    const levelButtons = Array.from({ length: 20 }, (_, index) =>
      button(grid, "level-" + index, () => open(chapter * 20 + index)),
    );
    const play = node("div", "sokoban-play", root);
    const meters = node("div", "sokoban-meters", play);
    const stats = ["moves", "pushes", "best"].map((name) => {
      const element = node("div", "game-stat", meters);
      return {
        name,
        label: node("span", "", element),
        value: node("strong", "", element),
      };
    });
    const stage = node("div", "sokoban-stage", play);
    const goalProgress = node("div", "sokoban-goal-progress", stage);
    const board = node("div", "sokoban-board", stage);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const actions = node("div", "sokoban-actions", play);
    const undo = button(actions, "undo", () => {
      move("undo");
      board.focus({ preventScroll: true });
    });
    const restart = button(actions, "restart", requestRestart);
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
    // Keep touch controls alongside undo/restart, below the board feedback.
    play.append(actions);
    actions.append(directions);
    actions.append(feedback);
    const footer = node("div", "sokoban-footer", root);
    const warning = node("p", "sokoban-warning", footer);
    warning.setAttribute("role", "status");
    const confirm = node("div", "sokoban-confirm", root);
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
    let savedInert = [];
    const help = WorkTimeApp.games.createHelp({
      root,
      controls,
      signal,
      text: () => t("help") + "\n\n" + t("source"),
      onChange: () => stopMotion(),
    });
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
      if (!unlocked(index)) return;
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
        help.isOpen() ||
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
      savedInert = [...root.children]
        .filter((child) => child !== confirm)
        .map((child) => [child, child.inert]);
      savedInert.forEach(([child]) => (child.inert = true));
      confirm.hidden = false;
      cancel.focus({ preventScroll: true });
    }
    function closeConfirm() {
      confirming = false;
      confirm.hidden = true;
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
    function render(animateMove = false) {
      // Measure before cancelling a track, so interrupted frames never snap back.
      const previous = new Map();
      if (animateMove && !reduced.matches)
        board
          .querySelectorAll("[data-piece]")
          .forEach((piece) =>
            previous.set(piece.dataset.piece, piece.getBoundingClientRect()),
          );
      stopMotion(!animateMove);
      catalog.hidden = !choosing;
      play.hidden = choosing;
      choose.hidden = choosing;
      title.textContent = choosing
        ? t("catalog")
        : t("level", { n: current + 1, total: levels.length });
      choose.textContent = t("choose");
      chapterButtons.forEach((element, index) => {
        element.textContent = t(["easy", "medium", "hard"][index]);
        element.setAttribute("aria-pressed", String(index === chapter));
      });
      progress.textContent = t("progress", {
        n: Object.keys(completed).length,
        total: levels.length,
      });
      levelButtons.forEach((element, index) => {
        const number = chapter * 20 + index,
          done = !!completed[levels[number].id];
        element.textContent = String(number + 1) + (done ? " ✓" : "");
        element.disabled = !unlocked(number);
        element.classList.toggle("is-complete", done);
        element.title = element.disabled
          ? t("locked")
          : t("level", { n: number + 1, total: levels.length });
        element.setAttribute(
          "aria-label",
          element.title + (done ? " · " + t("complete") : ""),
        );
      });
      undo.textContent = t("undo");
      restart.textContent = t("restart");
      undo.prepend(WorkTimeApp.games.createIcon("undo"));
      cancel.textContent = t("cancel");
      reset.textContent = t("reset");
      confirmText.textContent = t("confirm");
      confirm.setAttribute("aria-label", t("restart"));
      warning.textContent = saveFailed ? t("saveFailed") : "";
      help.refresh();
      directionButtons.forEach(({ direction, element }) => {
        element.setAttribute("aria-label", t(direction));
        element.title = t(direction);
      });
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
      goalProgress.textContent = t("goals", {
        n: position.boxes.filter((box) => map.goals.has(box)).length,
        total: map.goals.size,
      });
      undo.disabled = !value.moves;
      next.disabled = !won;
      next.setAttribute("aria-hidden", String(!won));
      next.tabIndex = won ? 0 : -1;
      next.textContent =
        current === levels.length - 1 ? t("finish") : t("next");
      status.textContent = won
        ? current === levels.length - 1
          ? t("allWon")
          : t("won")
        : rules.deadlocked(map, value)
          ? t("deadlock")
          : "";
      directionButtons.forEach(({ element }) => (element.disabled = won));
      board.style.setProperty("--columns", map.width);
      board.style.setProperty("--rows", map.height);
      board.setAttribute("aria-label", t("board", { n: current + 1 }));
      const fragment = document.createDocumentFragment();
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          const index = y * map.width + x,
            cell = node("span", "sokoban-cell", fragment);
          const wall = levels[current].rows[y][x] === "#",
            floor = map.floors.has(index);
          const box = position.boxes.includes(index),
            player = position.player === index;
          cell.classList.toggle("is-wall", wall);
          cell.classList.toggle("is-floor", floor);
          cell.classList.toggle("is-goal", map.goals.has(index));
          if (wall) sprite(cell, "wall");
          if (box || player) {
            const piece = node(
              "span",
              box ? "sokoban-box" : "sokoban-player",
              cell,
            );
            piece.classList.toggle("on-goal", map.goals.has(index));
            piece.dataset.piece = player
              ? "player"
              : "box-" + position.boxes.indexOf(index);
            sprite(
              piece,
              player ? "player" : map.goals.has(index) ? "boxGoal" : "box",
            );
          }
          if (floor) {
            cell.setAttribute("role", "img");
            cell.setAttribute(
              "aria-label",
              t("cell", {
                row: y + 1,
                col: x + 1,
                value: t(
                  player
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
          } else cell.setAttribute("aria-hidden", "true");
        }
      board.replaceChildren(fragment);
      const token = motionRevision;
      const startTime = document.timeline?.currentTime;
      if (!suspended && !document.hidden)
        board.querySelectorAll("[data-piece]").forEach((piece) => {
          const before = previous.get(piece.dataset.piece);
          if (!before) return;
          const after = piece.getBoundingClientRect();
          const x = before.left - after.left,
            y = before.top - after.top;
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
                easing: "cubic-bezier(0.2, 0.65, 0.35, 1)",
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
        help.isOpen() ||
        event.target.closest("a, input, select, textarea")
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
