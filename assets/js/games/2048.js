"use strict";
WorkTimeApp.games.register({
  id: "game-2048",
  nameKey: "games.puzzleName",
  descriptionKey: "games.puzzleDescription",
  icon: "game-2048",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.rules2048;
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    const key = "worktime.games.2048.v1";
    const t = (name) => WorkTimeApp.i18n.t("games.puzzle." + name);
    let state,
      previous = null,
      best = 0,
      saveFailed = false;
    let paused = false,
      disposed = false,
      confirming = false,
      pointer = null,
      moving = false,
      revision = 0,
      animations = [];
    try {
      const saved = rules.restore(JSON.parse(window.localStorage.getItem(key)));
      if (saved) ({ state, previous, best } = saved);
    } catch {
      saveFailed = true;
    }
    state ||= rules.create();
    function node(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    }
    const root = node("section", "game-2048 game-session", container);
    const header = node("div", "puzzle-header game-hud", root);
    const scores = node("div", "puzzle-scores", header);
    const scoreBox = node("div", "game-stat", scores);
    const scoreLabel = node("span", "", scoreBox);
    const score = node("strong", "", scoreBox);
    score.dataset.puzzleScore = "";
    const bestBox = node("div", "game-stat", scores);
    const bestLabel = node("span", "", bestBox);
    const bestValue = node("strong", "", bestBox);
    bestValue.dataset.puzzleBest = "";
    function button(parent, action, callback, iconName) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.puzzleAction = action;
      if (iconName) element.append(WorkTimeApp.games.createIcon(iconName));
      element.addEventListener(
        "click",
        () => {
          if (!paused && !disposed && !signal.aborted) callback();
        },
        { signal },
      );
      return element;
    }
    const actions = node("div", "puzzle-actions game-controls", root);
    const undo = button(actions, "undo", () => {
      if (confirming || !previous) return;
      stopMotion();
      state = rules.snapshot(previous);
      previous = null;
      save();
      render();
      board.focus({ preventScroll: true });
    });
    const restart = button(actions, "restart", () => {
      stopMotion();
      confirming = true;
      render();
      cancel.focus();
    });
    undo.classList.add("game-icon-button");
    restart.classList.add("game-icon-button");
    const confirmation = node("div", "puzzle-confirm", root);
    const confirmTitle = node("h3", "", confirmation);
    const confirmText = node("p", "", confirmation);
    const confirmActions = node("div", "puzzle-actions", confirmation);
    const cancel = button(
      confirmActions,
      "cancel",
      () => {
        confirming = false;
        render();
        restart.focus();
      },
      "close",
    );
    const cancelLabel = node("span", "button-label", cancel);
    const confirm = button(
      confirmActions,
      "confirm",
      () => {
        confirming = false;
        state = rules.create();
        previous = null;
        save();
        render();
        board.focus();
      },
      "restart-alt",
    );
    const confirmLabel = node("span", "button-label", confirm);
    const board = node("div", "puzzle-board", root);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const grid = node("div", "puzzle-grid", board);
    grid.setAttribute("role", "table");
    const cells = Array.from({ length: 4 }, () => {
      const row = node("div", "puzzle-row", grid);
      row.setAttribute("role", "row");
      return Array.from({ length: 4 }, () => {
        const cell = node("div", "puzzle-cell", row);
        cell.setAttribute("role", "cell");
        return cell;
      });
    }).flat();
    const layer = node("div", "puzzle-motion", board);
    layer.setAttribute("aria-hidden", "true");
    const overlay = node("div", "puzzle-overlay", board);
    board.append(confirmation);
    const endTitle = node("h3", "", overlay);
    const endHint = node("p", "", overlay);
    const endActions = node("div", "puzzle-actions", overlay);
    const keepGoing = button(endActions, "continue", () => {
      if (confirming) return;
      state.continued = true;
      save();
      render();
      board.focus();
    });
    keepGoing.append(WorkTimeApp.games.createIcon("play-arrow"));
    const keepGoingLabel = node("span", "button-label", keepGoing);
    const retry = button(endActions, "retry", () => {
      if (confirming) return;
      confirming = true;
      render();
      cancel.focus();
    });
    retry.append(WorkTimeApp.games.createIcon("restart-alt"));
    const retryLabel = node("span", "button-label", retry);
    const status = node("p", "puzzle-status game-sr-only", root);
    status.setAttribute("role", "status");
    const notice = node("div", "game-notice", root);
    const warning = node("p", "puzzle-save-warning", notice);
    warning.setAttribute("role", "status");
    function save() {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ version: 1, state, best, previous }),
        );
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }
    function paintTile(element, value) {
      element.textContent = value || "";
      element.dataset.value = value;
      element.dataset.level = value ? Math.min(11, Math.log2(value)) : 0;
      element.classList.toggle("puzzle-long-number", value >= 16384);
    }
    function render() {
      scoreLabel.textContent = t("score");
      bestLabel.textContent = t("best");
      WorkTimeApp.games.paintCounter(score, state.score);
      WorkTimeApp.games.paintCounter(bestValue, best);
      WorkTimeApp.games.setIcon(undo, "undo");
      undo.title = t("undo");
      undo.setAttribute("aria-label", t("undo"));
      WorkTimeApp.games.setIcon(restart, "restart-alt");
      restart.title = t("restart");
      restart.setAttribute("aria-label", t("restart"));
      cancelLabel.textContent = t("cancel");
      confirmLabel.textContent = t("confirm");
      confirmTitle.textContent = t("confirmTitle");
      confirmText.textContent = t("confirmHint");
      confirmation.hidden = !confirming;
      undo.disabled = !previous || confirming;
      restart.disabled = confirming;
      board.setAttribute("aria-label", t("board"));
      grid.setAttribute("aria-label", t("board"));
      grid.inert = confirming;
      cells.forEach((cell, index) => {
        paintTile(cell, state.board[index]);
        cell.setAttribute(
          "aria-label",
          state.board[index] ? String(state.board[index]) : t("empty"),
        );
      });
      const won = rules.won(state),
        lost = rules.lost(state.board);
      overlay.hidden = moving || confirming || (!won && !lost);
      overlay.dataset.result = won ? "won" : "lost";
      endTitle.textContent = t(won ? "won" : "lost");
      endHint.textContent = t(won ? "wonHint" : "lostHint");
      keepGoingLabel.textContent = t("continue");
      keepGoing.hidden = !won;
      retryLabel.textContent = t("restart");
      retry.disabled = false;
      keepGoing.disabled = false;
      status.textContent =
        t(won ? "won" : lost ? "lost" : "playing") +
        " · " +
        t("score") +
        " " +
        state.score;
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
    }
    function stopMotion() {
      revision++;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      layer.replaceChildren();
      cells.forEach((cell) => cell.classList.remove("puzzle-in-motion"));
      moving = false;
    }
    async function animateTurn(result) {
      if (reduced.matches || paused || !board.clientWidth) {
        render();
        return;
      }
      const token = revision;
      moving = true;
      render();
      const bounds = layer.getBoundingClientRect();
      const boxes = cells.map((cell) => cell.getBoundingClientRect());
      result.paths.forEach(({ from, to, value }) => {
        const ghost = node("div", "puzzle-cell puzzle-ghost", layer);
        paintTile(ghost, value);
        Object.assign(ghost.style, {
          left: boxes[from].left - bounds.left + "px",
          top: boxes[from].top - bounds.top + "px",
          width: boxes[from].width + "px",
          height: boxes[from].height + "px",
        });
        animations.push(
          compat.animate(
            ghost,
            [
              { transform: "translate(0, 0)" },
              {
                transform: `translate(${boxes[to].left - boxes[from].left}px, ${boxes[to].top - boxes[from].top}px)`,
              },
            ],
            { duration: 130, fill: "both", easing: "ease-out" },
          ),
        );
      });
      cells.forEach((cell) => cell.classList.add("puzzle-in-motion"));
      await Promise.all(animations.map((animation) => animation.finished));
      if (token !== revision || disposed) return;
      layer.replaceChildren();
      cells.forEach((cell) => cell.classList.remove("puzzle-in-motion"));
      animations = [];
      const merged = result.paths
        .filter((path) => path.merged)
        .map((path) => path.to);
      for (const index of new Set([...merged, result.spawned])) {
        animations.push(
          compat.animate(
            cells[index],
            [
              {
                transform: `scale(${index === result.spawned ? 0.8 : 1.08})`,
                opacity: index === result.spawned ? 0 : 1,
              },
              { transform: "scale(1)", opacity: 1 },
            ],
            { duration: 100, easing: "ease-out" },
          ),
        );
      }
      await Promise.all(animations.map((animation) => animation.finished));
      if (token !== revision || disposed) return;
      animations = [];
      moving = false;
      render();
    }
    function play(direction) {
      if (paused || disposed || signal.aborted || confirming) return;
      const result = rules.turn(state, direction);
      if (!result) return;
      stopMotion();
      state = result.state;
      previous = result.previous;
      best = Math.max(best, state.score);
      save();
      void animateTurn(result);
    }
    const keys = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
    };
    const shell = container.closest(".game-shell") || container;
    shell.addEventListener(
      "keydown",
      (event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.target.closest(
            "input, textarea, select, [contenteditable=true]",
          )
        )
          return;
        const direction = keys[event.key] || keys[event.key.toLowerCase()];
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          play(direction);
        }
      },
      { signal },
    );
    board.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          event.target.closest("button") ||
          paused ||
          confirming ||
          rules.won(state) ||
          rules.lost(state.board)
        )
          return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        board.setPointerCapture(event.pointerId);
        board.focus({ preventScroll: true });
      },
      { signal },
    );
    board.addEventListener(
      "pointerup",
      (event) => {
        if (pointer?.id !== event.pointerId) return;
        const dx = event.clientX - pointer.x,
          dy = event.clientY - pointer.y;
        pointer = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        play(
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "right"
              : "left"
            : dy > 0
              ? "down"
              : "up",
        );
      },
      { signal },
    );
    const clearPointer = () => {
      const id = pointer?.id;
      pointer = null;
      if (id !== undefined && board.hasPointerCapture(id))
        board.releasePointerCapture(id);
    };
    board.addEventListener("pointercancel", clearPointer, { signal });
    board.addEventListener("lostpointercapture", clearPointer, { signal });
    document.addEventListener("worktime:languagechange", render, { signal });
    const unlisten = compat.listen(reduced, () => {
      if (reduced.matches) {
        stopMotion();
        render();
      }
    });
    signal.addEventListener(
      "abort",
      () => {
        paused = true;
        clearPointer();
        stopMotion();
      },
      { once: true },
    );
    save();
    render();
    return {
      resize({ width, height }) {
        clearPointer();
        stopMotion();
        root.style.setProperty(
          "--puzzle-size",
          Math.max(180, Math.min(560, width, height - 200)) + "px",
        );
        render();
      },
      pause() {
        paused = true;
        clearPointer();
        stopMotion();
        render();
      },
      resume() {
        paused = false;
        render();
      },
      dispose() {
        disposed = true;
        clearPointer();
        stopMotion();
        unlisten();
        root.remove();
      },
    };
  },
});
