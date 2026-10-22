"use strict";
WorkTimeApp.games.register({
  id: "game-link",
  nameKey: "games.link.name",
  descriptionKey: "games.link.description",
  icon: "game-link",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.linkRules,
      key = "worktime.games.link.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.link." + name, params);
    const node = (tag, className, parent) => {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    };
    const listen = (element, event, callback) =>
      element.addEventListener(event, callback, { signal });
    let state = null,
      selected = -1,
      combo = 0,
      lastMatch = 0,
      paused = true,
      suspended = false,
      disposed = false,
      busy = false,
      timer = null,
      lastTick = performance.now(),
      hintPair = null,
      feedback = "ready",
      saveFailed = false,
      confirming = false,
      transposed = false,
      swapMode = false,
      connectionPath = null;
    let best = { zen: 0, quest: 0, tide: 0 };
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      state = rules.restore(saved?.state);
      for (const mode of Object.keys(best))
        if (
          Number.isInteger(saved?.best?.[mode]) &&
          saved.best[mode] >= 0 &&
          saved.best[mode] <= 10000000
        )
          best[mode] = saved.best[mode];
    } catch {
      saveFailed = true;
    }
    const root = node("section", "game-link game-session", container);
    container.classList.add("game-content-link");
    const hud = node("div", "link-hud game-hud", root);
    const heading = node("h3", "game-title", hud);
    const objective = node("span", "link-objective", hud);
    const controls = node("div", "link-controls", hud);
    function button(parent, name, callback) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.linkAction = name;
      listen(element, "click", () => {
        if (!disposed && !signal.aborted && !suspended) callback();
      });
      return element;
    }
    const restart = button(controls, "restart", () => {
      if (state?.phase === "playing") {
        confirming = true;
        setPaused(true);
        render();
        primary.focus();
      } else {
        state = null;
        save();
        render();
        modeButtons[0].element.focus();
      }
    });
    const catalog = node("div", "link-catalog", root);
    const modes = node("div", "link-modes", catalog);
    const modeButtons = ["zen", "quest", "tide"].map((mode) => {
      const element = button(modes, mode, () => start(mode));
      return { element, mode };
    });
    const play = node("div", "link-play", root);
    const meters = node("div", "link-meters", play);
    const stats = ["score", "time", "pairs", "combo"].map((name) => {
      const box = node("div", "game-stat", meters);
      return {
        name,
        label: node("span", "", box),
        value: node("strong", "", box),
      };
    });
    const arena = node("div", "link-arena", play);
    const scroll = node("div", "link-scroll", arena);
    const stage = node("div", "link-stage", scroll);
    const board = node("div", "link-board", stage);
    board.setAttribute("role", "group");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    line.classList.add("link-path");
    line.setAttribute("aria-hidden", "true");
    stage.append(line);
    const cover = node("div", "link-cover", arena);
    const coverTitle = node("h3", "", cover),
      coverText = node("p", "", cover);
    const primary = button(cover, "primary", () => {
      if (confirming) {
        confirming = false;
        state = null;
        save();
        render();
        modeButtons[0].element.focus();
      } else if (state.phase === "cleared") next();
      else if (["won", "lost"].includes(state.phase)) {
        state = null;
        save();
        render();
        modeButtons[0].element.focus();
      } else {
        setPaused(false);
        render();
        focusTile();
      }
    });
    const cancel = button(cover, "cancel", () => {
      confirming = false;
      render();
      primary.focus();
    });
    const actions = node("div", "link-actions game-controls", play);
    const hint = button(actions, "hint", () => {
      if (!active() || (state.mode !== "zen" && !state.hints)) return;
      tick();
      if (!active()) return;
      hintPair = rules.find(state.board, state.cols);
      swapMode = false;
      if (state.mode !== "zen") state.hints--;
      combo = 0;
      feedback = "hinted";
      save();
      render();
      hint.focus();
    });
    const shuffle = button(actions, "shuffle", () => {
      if (!active() || (state.mode !== "zen" && !state.shuffles)) return;
      tick();
      if (!active()) return;
      if (state.mode !== "zen") state.shuffles--;
      state.board = rules.shuffle(state.board, Math.random, state.cols);
      swapMode = false;
      selected = -1;
      hintPair = null;
      combo = 0;
      feedback = "shuffled";
      save();
      render();
      shuffle.focus();
    });
    const pause = button(actions, "pause", () => {
      if (state?.phase === "playing") {
        setPaused(true);
        render();
        primary.focus();
      }
    });
    const swapButton = button(actions, "swap", () => {
      tick();
      if (!active() || state.energy < 3) return;
      swapMode = !swapMode;
      selected = -1;
      hintPair = null;
      feedback = swapMode ? "swapPick" : "ready";
      render();
      if (swapMode) focusTile();
    });
    actions.insertBefore(swapButton, pause);
    const notice = node("p", "link-notice", play);
    notice.setAttribute("role", "status");
    const warning = node("p", "link-warning", root);
    warning.setAttribute("role", "status");
    const help = WorkTimeApp.games.createHelp({
      root,
      controls,
      signal,
      text: () => t("help"),
      onChange(open) {
        if (open && state?.phase === "playing") {
          setPaused(true);
          render();
        }
      },
    });
    const colors = [
      "#ae701b",
      "#6476b4",
      "#ab762a",
      "#bf6470",
      "#638baf",
      "#39876d",
      "#6b7790",
      "#a8669c",
      "#7e72aa",
      "#4b8c9d",
      "#ad7151",
      "#8b9148",
    ];
    function save() {
      try {
        localStorage.setItem(key, JSON.stringify({ state, best }));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      warning.textContent = saveFailed ? t("saveFailed") : "";
    }
    function start(mode) {
      state = {
        mode,
        level: 0,
        cols: rules.size(0).cols,
        board: rules.create(0),
        phase: "playing",
        score: 0,
        remaining: 150000,
        hints: 3,
        shuffles: 2,
        energy: 3,
        target: 0,
        targetProgress: 0,
        tideStep: 0,
        missions: 0,
      };
      confirming = false;
      paused = false;
      combo = 0;
      selected = -1;
      hintPair = null;
      feedback = "ready";
      lastTick = performance.now();
      save();
      render();
      focusTile();
    }
    function next() {
      state.level++;
      state.cols = rules.size(state.level).cols;
      state.board = rules.create(state.level);
      state.phase = "playing";
      state.remaining = Math.min(240000, state.remaining + 45000);
      state.hints = 3;
      state.shuffles = 2;
      state.energy = 3;
      state.target = state.level % 4;
      state.targetProgress = 0;
      state.tideStep = 0;
      combo = 0;
      selected = -1;
      hintPair = null;
      paused = false;
      lastTick = performance.now();
      feedback = "ready";
      save();
      render();
      focusTile();
    }
    function active() {
      return (
        state?.phase === "playing" &&
        !paused &&
        !suspended &&
        !busy &&
        !help.isOpen() &&
        !signal.aborted &&
        !disposed
      );
    }
    function tick() {
      const now = performance.now(),
        elapsed = now - lastTick;
      lastTick = now;
      if (state?.phase !== "playing" || paused || suspended || help.isOpen())
        return;
      if (combo && now - lastMatch > 6000) {
        combo = 0;
        paintStats();
      }
      if (state.mode === "zen") return;
      state.remaining = Math.max(0, state.remaining - elapsed);
      if (!state.remaining) {
        state.phase = "lost";
        clearMotion();
        save();
        render();
      } else paintStats();
    }
    function setPaused(value) {
      if (value) {
        tick();
        clearMotion();
        combo = 0;
        swapMode = false;
        selected = -1;
      }
      paused = value;
      lastTick = performance.now();
      save();
    }
    function clearMotion() {
      clearTimeout(timer);
      timer = null;
      busy = false;
      connectionPath = null;
      line.replaceChildren();
    }
    function ensureMove() {
      if (state.board.some(Boolean) && !rules.find(state.board, state.cols)) {
        state.board = rules.shuffle(state.board, Math.random, state.cols);
        feedback = "rescued";
      }
    }
    function choose(index) {
      if (!active() || !state.board[index]) return;
      tick();
      if (!active()) return;
      hintPair = null;
      if (selected === index) {
        selected = -1;
        renderBoard();
        board.children[index]?.focus({ preventScroll: true });
        return;
      }
      if (swapMode) {
        if (selected >= 0 && rules.swap(state, selected, index)) {
          swapMode = false;
          selected = -1;
          combo = 0;
          feedback = "swapped";
          ensureMove();
          save();
          render();
          focusTile(index);
        } else {
          const alreadySelected = selected >= 0;
          selected = index;
          renderBoard();
          notice.textContent = t(alreadySelected ? "sameSwap" : "swapPick");
          board.children[index]?.focus({ preventScroll: true });
        }
        return;
      }
      const path =
        selected >= 0
          ? rules.route(state.board, selected, index, state.cols)
          : null;
      if (!path) {
        feedback = selected >= 0 ? "blocked" : "ready";
        selected = index;
        renderBoard();
        board.children[index]?.focus({ preventScroll: true });
        notice.textContent = feedback === "blocked" ? t(feedback) : "";
        return;
      }
      const previous = selected;
      selected = -1;
      const now = performance.now();
      combo = now - lastMatch <= 6000 ? Math.min(combo + 1, 5) : 1;
      lastMatch = now;
      const result = rules.match(state, previous, index, combo);
      feedback = result.completedMission ? "missionDone" : "matched";
      if (state.phase !== "playing") {
        if (state.phase === "won")
          best[state.mode] = Math.max(best[state.mode], state.score);
      } else ensureMove();
      save();
      paintStats();
      const polyline = document.createElementNS(line.namespaceURI, "polyline");
      connectionPath = path;
      line.append(polyline);
      drawPath();
      busy = true;
      timer = setTimeout(
        () => {
          clearMotion();
          render();
          if (state.phase === "playing") focusTile(index);
          else primary.focus({ preventScroll: true });
        },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220,
      );
    }
    function focusTile(from = 0) {
      const tiles = [...board.children];
      (
        tiles.find((tile, i) => i >= from && !tile.disabled) ||
        tiles.find((tile) => !tile.disabled)
      )?.focus({ preventScroll: true });
    }
    function drawPath() {
      if (!connectionPath) return;
      line
        .querySelector("polyline")
        ?.setAttribute(
          "points",
          connectionPath
            .map(([x, y]) =>
              transposed ? `${y + 0.5},${x + 0.5}` : `${x + 0.5},${y + 0.5}`,
            )
            .join(" "),
        );
    }
    function positionTile(tile, index) {
      const x = (index % state.cols) + 1,
        y = Math.floor(index / state.cols) + 1;
      tile.style.gridColumn = String(transposed ? y : x);
      tile.style.gridRow = String(transposed ? x : y);
      tile.setAttribute(
        "aria-label",
        t("tile", {
          row: transposed ? x : y,
          col: transposed ? y : x,
          symbol: state.board[index]
            ? t("symbol" + state.board[index])
            : t("empty"),
        }),
      );
    }
    function fit() {
      if (!state || disposed) return;
      const width = scroll.clientWidth,
        height = scroll.clientHeight;
      if (!width || !height) return;
      const cols = state.cols,
        rows = state.board.length / cols;
      const normal = Math.min(width / (cols + 1), height / (rows + 1));
      const rotated = Math.min(width / (rows + 1), height / (cols + 1));
      const next = rotated > normal;
      if (next !== transposed) {
        transposed = next;
        [...board.children].forEach(positionTile);
        paintObjective();
      }
      const visualCols = transposed ? rows : cols,
        visualRows = transposed ? cols : rows;
      const cell = Math.min(
        width / (visualCols + 1),
        height / (visualRows + 1),
      );
      stage.style.setProperty("--link-cols", String(visualCols));
      stage.style.setProperty("--link-rows", String(visualRows));
      stage.style.setProperty("--link-gap", Math.min(4, cell * 0.07) + "px");
      stage.style.setProperty("--link-radius", Math.min(8, cell * 0.13) + "px");
      stage.style.width = Math.floor(cell * (visualCols + 1)) + "px";
      stage.style.height = Math.floor(cell * (visualRows + 1)) + "px";
      line.setAttribute(
        "viewBox",
        `0.5 0.5 ${visualCols + 1} ${visualRows + 1}`,
      );
      drawPath();
    }
    function renderBoard() {
      board.replaceChildren();
      board.inert =
        paused || suspended || state.phase !== "playing" || confirming;
      state.board.forEach((value, index) => {
        const tile = node("button", "link-tile", board);
        tile.type = "button";
        tile.dataset.index = index;
        tile.disabled = !value;
        tile.tabIndex = value ? 0 : -1;
        if (value) {
          const animal = node("span", "link-animal", tile);
          animal.setAttribute("aria-hidden", "true");
          const local = (value - 1) % 12;
          animal.dataset.sheet = ["home", "forest", "ocean", "savanna"][
            rules.family(value)
          ];
          animal.style.backgroundPosition = `${(local % 4) * (100 / 3)}% ${Math.floor(local / 4) * 50}%`;
        }
        tile.style.setProperty(
          "--link-color",
          colors[(value - 1) % colors.length] || "transparent",
        );
        positionTile(tile, index);
        tile.setAttribute("aria-pressed", String(selected === index));
        tile.classList.toggle(
          "is-hint",
          !!hintPair && [hintPair.a, hintPair.b].includes(index),
        );
        tile.classList.toggle(
          "is-target",
          !!value && rules.family(value) === state.target,
        );
      });
    }
    function paintObjective() {
      const direction = transposed
        ? [3, 2, 1, 0][state.tideStep]
        : state.tideStep;
      const gravity = ["↓", "←", "↑", "→"][direction];
      objective.textContent =
        t("family" + state.target) +
        " · " +
        state.targetProgress +
        "/3" +
        (state.mode === "tide" ? " · " + gravity : "");
      objective.title =
        t("objective", {
          family: t("family" + state.target),
          n: state.targetProgress,
        }) + (state.mode === "tide" ? " · " + t("gravity" + direction) : "");
      objective.setAttribute("aria-label", objective.title);
    }
    function paintStats() {
      if (!state) return;
      const seconds = Math.ceil(state.remaining / 1000);
      const values = [
        state.score,
        state.mode === "zen"
          ? "∞"
          : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
        state.board.filter(Boolean).length / 2,
        "×" + combo,
      ];
      stats.forEach((stat, i) => {
        stat.label.textContent = t(stat.name);
        stat.value.textContent = values[i];
      });
    }
    function render() {
      heading.textContent = state
        ? t("round", { mode: t(state.mode), n: state.level + 1 })
        : t("name");
      restart.textContent = t("new");
      restart.hidden = !state;
      objective.hidden = !state;
      modeButtons.forEach(({ mode, element }) => {
        element.textContent = t(mode);
      });
      catalog.hidden = !!state;
      play.hidden = !state;
      help.refresh();
      warning.textContent = saveFailed ? t("saveFailed") : "";
      if (!state) return;
      paintObjective();
      board.setAttribute("aria-label", t("name"));
      renderBoard();
      paintStats();
      hint.textContent =
        t("hint") + " · " + (state.mode === "zen" ? "∞" : state.hints);
      shuffle.textContent =
        t("shuffle") + " · " + (state.mode === "zen" ? "∞" : state.shuffles);
      pause.textContent = t("pause");
      swapButton.textContent = t("swap") + " · " + state.energy;
      swapButton.title = t("swapHelp");
      swapButton.setAttribute("aria-pressed", String(swapMode));
      swapButton.disabled = !active() || state.energy < 3;
      hint.disabled = !active() || (state.mode !== "zen" && !state.hints);
      shuffle.disabled = !active() || (state.mode !== "zen" && !state.shuffles);
      pause.disabled = !active();
      notice.textContent = [
        "blocked",
        "hinted",
        "shuffled",
        "rescued",
        "swapPick",
        "swapped",
        "missionDone",
      ].includes(feedback)
        ? t(feedback)
        : "";
      cover.hidden = state.phase === "playing" && !paused && !confirming;
      coverTitle.textContent = t(
        confirming ? "new" : state.phase === "playing" ? "paused" : state.phase,
      );
      coverText.textContent = confirming
        ? t("confirm")
        : state.phase === "playing"
          ? t("resumeText")
          : t("result", { n: state.score });
      primary.textContent = t(
        confirming
          ? "changeMode"
          : state.phase === "playing"
            ? "resume"
            : state.phase === "cleared"
              ? "next"
              : "again",
      );
      cancel.hidden = !confirming;
      cancel.textContent = t("cancel");
      fit();
    }
    listen(board, "click", (event) => {
      const tile = event.target.closest(".link-tile");
      if (tile) choose(Number(tile.dataset.index));
    });
    listen(board, "keydown", (event) => {
      const index = Number(event.target.dataset.index);
      if (!Number.isInteger(index) || !active()) return;
      const delta = {
        ArrowLeft: transposed ? -state.cols : -1,
        ArrowRight: transposed ? state.cols : 1,
        ArrowUp: transposed ? -1 : -state.cols,
        ArrowDown: transposed ? 1 : state.cols,
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      for (
        let i = index + delta;
        i >= 0 && i < state.board.length;
        i += delta
      ) {
        if (
          Math.abs(delta) === 1 &&
          Math.floor(i / state.cols) !== Math.floor(index / state.cols)
        )
          break;
        if (state.board[i]) {
          board.children[i].focus();
          break;
        }
      }
    });
    listen(document, "worktime:languagechange", render);
    if (state?.phase === "playing") ensureMove();
    render();
    const observer = new ResizeObserver(fit);
    observer.observe(arena);
    const interval = setInterval(tick, 200);
    return {
      resize: fit,
      pause() {
        if (disposed) return;
        setPaused(true);
        suspended = true;
        render();
      },
      resume() {
        suspended = false;
        lastTick = performance.now();
        render();
      },
      dispose() {
        if (disposed) return;
        setPaused(true);
        disposed = true;
        clearInterval(interval);
        observer.disconnect();
        clearMotion();
        root.remove();
        container.classList.remove("game-content-link");
      },
    };
  },
});
