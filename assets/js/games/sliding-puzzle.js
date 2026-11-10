"use strict";
WorkTimeApp.games.register({
  id: "game-sliding-puzzle",
  nameKey: "games.sliding.name",
  descriptionKey: "games.sliding.description",
  icon: "game-sliding-puzzle",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.slidingPuzzleRules;
    const celebration = WorkTimeApp.games.createCelebration(signal);
    const reduced = WorkTimeApp.ui.animationCompat.preference();
    let winPending = false,
      winRevision = 0,
      coverMotion = null,
      winRecord = false;
    const storage = WorkTimeApp.services.gameArchive.session();
    const key = "worktime.games.sliding-puzzle.v1";
    const t = (name) => WorkTimeApp.i18n.t("games.sliding." + name);
    let data,
      failed = false,
      paused = false,
      disposed = false,
      confirmation = null,
      pointer = null,
      stamp = performance.now(),
      animation = null;
    let suppressClickUntil = 0;
    let visible = !document.hidden;
    try {
      data = rules.restore(JSON.parse(storage.getItem(key)));
    } catch {
      failed = true;
    }
    data ||= {
      version: 1,
      size: 4,
      sessions: { 4: rules.create(4) },
      best: {},
    };
    if (!rules.sizes.includes(data.size)) {
      data.size = 4;
      data.sessions[4] ||= rules.create(4);
    }
    data.sessions = { [data.size]: data.sessions[data.size] };
    const state = () => data.sessions[data.size];
    function node(tag, className, parent) {
      const el = document.createElement(tag);
      el.className = className;
      parent?.append(el);
      return el;
    }
    const root = node("section", "game-sliding-puzzle game-session", container);
    const header = node("div", "sliding-header game-hud", root);
    const actions = node("div", "sliding-actions game-controls", root);
    const selectHost = node("div", "sliding-difficulty", actions);
    const selectLabel = node("label", "game-sr-only", selectHost);
    selectLabel.id = "slidingSizeLabel";
    const select = node("select", "sliding-select", selectHost);
    select.id = "slidingSize";
    for (const size of rules.sizes) {
      const option = node("option", "", select);
      option.value = String(size);
    }
    const stats = node("div", "sliding-stats", header);
    function stat() {
      const box = node("div", "game-stat", stats);
      return { label: node("span", "", box), value: node("strong", "", box) };
    }
    const steps = stat(),
      time = stat(),
      best = stat();
    const difficulty = WorkTimeApp.games.createSelect({
      host: selectHost,
      select,
      label: selectLabel,
      signal,
    });
    function button(parent, action, fn) {
      const el = node("button", "game-button", parent);
      el.type = "button";
      el.dataset.slidingAction = action;
      el.addEventListener(
        "click",
        () => {
          if (!paused && !disposed) fn();
        },
        { signal },
      );
      return el;
    }
    const undo = button(actions, "undo", () => {
      tick();
      stopMotion();
      rules.undo(state());
      save();
      render();
      board.focus();
    });
    const restart = button(actions, "restart", () => request("restart"));
    const shuffle = button(actions, "shuffle", () => request("shuffle"));
    for (const [el, icon] of [
      [undo, "undo"],
      [restart, "restart-alt"],
      [shuffle, "shuffle"],
    ]) {
      el.classList.add("game-icon-button");
      el.append(WorkTimeApp.games.createIcon(icon));
    }
    const board = node("div", "sliding-board", root);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const tiles = node("div", "sliding-tiles", board);
    const cover = node("div", "sliding-cover", board);
    cover.hidden = true;
    const coverTitle = node("h3", "", cover),
      result = node("p", "", cover);
    const coverActions = node("div", "sliding-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirmation = null;
      stamp = performance.now();
      render();
      board.focus();
    });
    const accept = button(coverActions, "accept", () => {
      tick();
      stopMotion();
      data.sessions[data.size] =
        confirmation === "restart"
          ? rules.restart(state())
          : rules.create(data.size);
      confirmation = null;
      stamp = performance.now();
      save();
      render();
      board.focus();
    });
    const status = node("p", "game-sr-only", root);
    status.setAttribute("role", "status");
    const warning = node("p", "sliding-warning", root);
    warning.setAttribute("role", "status");
    function tick() {
      const now = performance.now();
      if (
        !paused &&
        visible &&
        !confirmation &&
        state().started &&
        !rules.solved(state().board)
      )
        state().elapsed += Math.max(0, Math.round(now - stamp));
      stamp = now;
    }
    function save() {
      try {
        storage.setItem(key, JSON.stringify(data));
        failed = false;
      } catch {
        failed = true;
      }
    }
    function clock(ms) {
      const seconds = Math.floor(ms / 1000);
      return (
        Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
      );
    }
    function stopMotion() {
      winRevision++;
      winPending = false;
      celebration.stop();
      coverMotion?.cancel();
      coverMotion = null;
      animation?.cancel();
      animation = null;
    }
    async function finishWin(revision, movement) {
      try {
        await movement?.finished;
        if (revision !== winRevision || disposed || paused) return;
        await celebration.play(board);
        if (revision !== winRevision || disposed || paused) return;
        winPending = false;
        render();
        if (!reduced.matches)
          coverMotion = cover.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 380,
            easing: "ease-out",
          });
        accept.focus({ preventScroll: true });
      } catch {
        // Cancellation is owned by the session lifecycle or another action.
      }
    }
    function request(action) {
      tick();
      stopMotion();
      if (state().started) {
        confirmation = action;
        save();
        render();
        cancel.focus();
      } else {
        data.sessions[data.size] =
          action === "restart"
            ? rules.restart(state())
            : rules.create(data.size);
        save();
        render();
      }
    }
    function play(index) {
      if (paused || disposed || document.hidden || confirmation || animation)
        return;
      tick();
      const blank = state().board.indexOf(0),
        value = state().board[index];
      if (!rules.move(state(), index, data.size)) return;
      let newRecord = false;
      if (rules.solved(state().board)) {
        const previous = data.best[data.size];
        newRecord =
          !previous ||
          state().history.length < previous.moves ||
          state().elapsed < previous.time;
        data.best[data.size] = {
          moves: Math.min(previous?.moves ?? Infinity, state().history.length),
          time: Math.min(previous?.time ?? Infinity, state().elapsed),
        };
        state().awarded = true;
      }
      const won = rules.solved(state().board);
      winRecord = newRecord;
      winPending = won;
      save();
      render();
      if (!reduced.matches) {
        const tile = tiles.querySelector('[data-tile="' + value + '"]');
        const rect = tile.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(tiles).gap);
        animation = tile.animate(
          [
            {
              transform: `translate(${((index % data.size) - (blank % data.size)) * (rect.width + gap)}px, ${(Math.floor(index / data.size) - Math.floor(blank / data.size)) * (rect.height + gap)}px)`,
            },
            { transform: "translate(0, 0)" },
          ],
          { duration: 120, easing: "ease-out" },
        );
        animation.onfinish = () => {
          animation = null;
        };
      }
      if (won) void finishWin(++winRevision, animation);
    }
    function renderStats() {
      steps.label.textContent = t("moves");
      steps.value.textContent = state().history.length;
      time.label.textContent = t("time");
      time.value.textContent = clock(state().elapsed);
      const record = data.best[data.size];
      best.label.textContent = t("best");
      best.value.textContent = record
        ? record.moves + " / " + clock(record.time)
        : "—";
    }
    function render() {
      select.value = String(data.size);
      select.setAttribute("aria-label", t("size"));
      selectLabel.textContent = t("size");
      [...select.options].forEach((option) => {
        option.textContent =
          option.value +
          " × " +
          option.value +
          " · " +
          t("size" + option.value);
      });
      for (const [el, name] of [
        [undo, "undo"],
        [restart, "restart"],
        [shuffle, "shuffle"],
      ]) {
        el.setAttribute("aria-label", t(name));
        el.title = t(name);
      }
      cancel.textContent = t("cancel");
      undo.disabled = !state().history.length || !!confirmation;
      select.disabled = !!confirmation;
      difficulty.sync();
      warning.textContent = failed ? t("saveFailed") : "";
      board.setAttribute(
        "aria-label",
        t("name") + " " + data.size + " × " + data.size,
      );
      tiles.style.setProperty("--sliding-n", data.size);
      tiles.replaceChildren();
      for (const value of state().board) {
        const tile = node(
          value ? "button" : "div",
          value ? "sliding-tile" : "sliding-empty",
          tiles,
        );
        if (!value) {
          tile.setAttribute("aria-label", t("empty"));
          continue;
        }
        tile.type = "button";
        tile.textContent = String(value);
        tile.dataset.tile = String(value);
        tile.dataset.tone = String(
          Math.floor((Math.floor((value - 1) / data.size) * 3) / data.size),
        );
        tile.dataset.movable = String(
          rules.adjacent(
            state().board.indexOf(value),
            state().board.indexOf(0),
            data.size,
          ),
        );
        tile.setAttribute("aria-label", t("tile") + " " + value);
        tile.addEventListener("click", () => {
          if (performance.now() < suppressClickUntil) return;
          play(state().board.indexOf(value));
          board.focus({ preventScroll: true });
        });
      }
      const won = rules.solved(state().board);
      cover.hidden = !confirmation && (!won || winPending);
      cancel.hidden = !confirmation;
      coverTitle.textContent = t(confirmation ? "confirm" : "won");
      result.textContent = confirmation
        ? t(confirmation) + "?"
        : t("moves") +
          " " +
          state().history.length +
          " · " +
          clock(state().elapsed);
      if (won && winRecord && !confirmation)
        result.textContent += " · " + t("record");
      accept.textContent = t(confirmation ? "accept" : "again");
      tiles.inert = !cover.hidden || winPending;
      status.textContent = won && !winPending ? t("won") : "";
      renderStats();
    }
    select.addEventListener(
      "change",
      () => {
        tick();
        stopMotion();
        data.size = Number(select.value);
        data.sessions = { [data.size]: rules.create(data.size) };
        pointer = null;
        stamp = performance.now();
        save();
        render();
      },
      { signal },
    );
    board.addEventListener(
      "keydown",
      (event) => {
        if (event.target.closest(".sliding-cover")) return;
        const direction = {
          ArrowLeft: [0, -1],
          a: [0, -1],
          ArrowRight: [0, 1],
          d: [0, 1],
          ArrowUp: [-1, 0],
          w: [-1, 0],
          ArrowDown: [1, 0],
          s: [1, 0],
        }[event.key];
        if (!direction || event.altKey || event.ctrlKey || event.metaKey)
          return;
        event.preventDefault();
        const blank = state().board.indexOf(0),
          row = Math.floor(blank / data.size) - direction[0],
          col = (blank % data.size) - direction[1];
        if (row >= 0 && row < data.size && col >= 0 && col < data.size)
          play(row * data.size + col);
      },
      { signal },
    );
    board.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest(".sliding-cover")) return;
        pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      },
      { signal },
    );
    board.addEventListener(
      "pointerup",
      (event) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.x,
          dy = event.clientY - pointer.y;
        pointer = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        suppressClickUntil = performance.now() + 400;
        event.preventDefault();
        const keyName =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "ArrowRight"
              : "ArrowLeft"
            : dy > 0
              ? "ArrowDown"
              : "ArrowUp";
        board.dispatchEvent(
          new KeyboardEvent("keydown", { key: keyName, bubbles: true }),
        );
      },
      { signal },
    );
    board.addEventListener(
      "pointercancel",
      () => {
        pointer = null;
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        tick();
        visible = !document.hidden;
        stopMotion();
        render();
        pointer = null;
        save();
      },
      { signal },
    );
    document.addEventListener("worktime:languagechange", render, { signal });
    const timer = setInterval(() => {
      tick();
      renderStats();
      save();
      warning.textContent = failed ? t("saveFailed") : "";
    }, 1000);
    function dispose() {
      if (disposed) return;
      tick();
      paused = true;
      disposed = true;
      clearInterval(timer);
      stopMotion();
      celebration.dispose();
      unlistenReduced();
      save();
    }
    signal.addEventListener("abort", dispose, { once: true });
    const unlistenReduced = WorkTimeApp.ui.animationCompat.listen(
      reduced,
      () => {
        if (reduced.matches) {
          stopMotion();
          render();
        }
      },
    );
    save();
    render();
    return {
      pause() {
        tick();
        difficulty.close();
        paused = true;
        stopMotion();
        render();
        pointer = null;
        save();
      },
      resume() {
        stamp = performance.now();
        paused = false;
      },
      resize() {
        difficulty.close();
        stopMotion();
        render();
        pointer = null;
      },
      dispose,
    };
  },
});
