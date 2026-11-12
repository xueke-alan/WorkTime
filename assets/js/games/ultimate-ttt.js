"use strict";

WorkTimeApp.games.register({
  id: "game-ultimate-ttt",
  nameKey: "games.uttt.name",
  descriptionKey: "games.uttt.description",
  icon: "game-ultimate-ttt",
  create({ container, signal }) {
    const G = WorkTimeApp.games,
      R = G.ultimateTttRules;
    const archive = WorkTimeApp.services.gameArchive,
      storage = archive.session();
    const t = (key, params) => WorkTimeApp.i18n.t("games.uttt." + key, params);
    const compat = WorkTimeApp.ui.animationCompat;
    let matchHistory = null,
      replaySnapshot = null;
    const matchSave = {};
    let options = {
      mode: "ai",
      difficulty: "normal",
      human: 1,
      chain: false,
      path: [],
    };
    let state = R.create(),
      active = false,
      setupOpen = true,
      paused = false,
      covered = false;
    let checkedState = null,
      lockedWinner = null,
      continuedAt = 0;
    let thinking = false,
      engineError = false,
      failed = false,
      generation = 0,
      focus = 0,
      previewCell = -1,
      previewTimer = 0;
    let engine = null,
      disposed = false,
      animations = [];
    try {
      const raw = storage.getItem(archive.keys["game-ultimate-ttt"]);
      if (raw !== null) {
        const saved = archive.normalize("game-ultimate-ttt", JSON.parse(raw));
        options = saved.state;
        matchSave.matchHistory = saved.matchHistory ?? [];
        matchSave.matchSession =
          saved.matchSession ?? archive.newMatchSession();
        state = R.replay(options.path, options.chain);
        if (state.status !== "playing") matchSave.matchSession.recorded = true;
        active = true;
        setupOpen = false;
      }
    } catch {
      failed = true;
    }
    let draft = { ...options };
    function node(parent, tag, cls = "") {
      const el = document.createElement(tag);
      el.className = cls;
      parent.append(el);
      return el;
    }
    function paintMark(element, mark) {
      element.replaceChildren();
      if (!mark) return;
      if (mark !== "X" && mark !== "O") {
        element.textContent = mark;
        return;
      }
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "uttt-symbol");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = mark;
      const shape = document.createElementNS(
        svg.namespaceURI,
        mark === "O" ? "circle" : "path",
      );
      if (mark === "O") {
        shape.setAttribute("cx", "50");
        shape.setAttribute("cy", "50");
        shape.setAttribute("r", "35");
      } else shape.setAttribute("d", "M20 20 80 80M80 20 20 80");
      svg.append(title, shape);
      element.append(svg);
    }
    const root = node(container, "section", "game-ultimate-ttt game-session");
    const catalog = G.createLevelPage(root, "uttt-level-page", signal);
    catalog.categories.removeAttribute("aria-labelledby");
    const setup = node(catalog.entries, "section", "uttt-setup");
    const heading = node(setup, "h3");
    const intro = node(setup, "p", "uttt-muted");
    const buttons = [];
    function button(parent, action, key, callback) {
      const el = node(parent, "button", "game-button");
      el.type = "button";
      el.dataset.utttAction = action;
      el.addEventListener(
        "click",
        () => {
          if (!paused && !disposed) callback();
        },
        { signal },
      );
      if (key) buttons.push({ el, key });
      return el;
    }
    const modes = ["ai", "local"].map((mode) => {
      const control = button(catalog.categories, "mode-" + mode, mode, () => {
        if (draft.mode !== mode) catalog.entries.scrollTop = 0;
        draft.mode = mode;
        if (mode === "local") cancel();
        render();
        if (mode === "ai") warm();
      });
      control.setAttribute("aria-controls", catalog.entries.id);
      return { mode, control };
    });
    const difficulty = node(setup, "fieldset", "uttt-options");
    const difficultyLabel = node(difficulty, "legend");
    const difficultyRow = node(difficulty, "div", "uttt-actions");
    const difficulties = ["easy", "normal", "hard"].map((value) => ({
      value,
      control: button(difficultyRow, "difficulty-" + value, value, () => {
        draft.difficulty = value;
        render();
        warm();
      }),
    }));
    const chainOption = node(setup, "div", "uttt-chain-option");
    const chainLabel = node(chainOption, "label", "uttt-checkbox");
    const check = node(chainLabel, "span", "uttt-check");
    const chain = node(check, "input");
    chain.type = "checkbox";
    chain.dataset.utttOption = "chain";
    chain.setAttribute("aria-describedby", "uttt-chain-note");
    check.append(G.createIcon("check"));
    const chainName = node(chainLabel, "span");
    const chainNote = node(chainOption, "p", "uttt-muted");
    chainNote.id = "uttt-chain-note";
    chain.addEventListener(
      "change",
      () => {
        draft.chain = chain.checked;
      },
      { signal },
    );
    const side = node(setup, "fieldset", "uttt-options");
    const sideLabel = node(side, "legend");
    const sideRow = node(side, "div", "uttt-actions uttt-start-row");
    const localRow = node(setup, "div", "uttt-actions uttt-start-row");
    const startCards = [
      startCard(sideRow, "human-1", ["X"], "first", 1),
      startCard(sideRow, "human--1", ["O"], "second", -1),
      startCard(localRow, "start-local", ["X", "O"], "start"),
    ];
    const engineName = node(setup, "p", "uttt-muted");
    function startCard(parent, action, marks, key, human) {
      const control = button(parent, action, null, () => {
        if (human !== undefined) draft.human = human;
        if (active && state.path.length) prompt.open(control);
        else startMatch();
      });
      control.classList.add("uttt-start-card");
      const icons = node(control, "span", "uttt-start-icons");
      icons.setAttribute("aria-hidden", "true");
      for (const mark of marks) {
        const icon = node(icons, "span");
        icon.dataset.mark = mark;
        paintMark(icon, mark);
      }
      const label = node(control, "span");
      return { control, label, key };
    }
    function startMatch() {
      options = { ...draft, path: [] };
      active = true;
      setupOpen = false;
      restartMatch(options.mode === "ai");
      cells[focus].focus();
    }
    const play = node(root, "div", "uttt-play");
    const stage = node(play, "div", "uttt-stage");
    const board = node(stage, "div", "uttt-board");
    board.setAttribute("role", "group");
    const regions = Array.from({ length: 9 }, (_, r) => {
      const el = node(board, "div", "uttt-region");
      el.dataset.region = r;
      const marks = node(el, "div", "uttt-marks");
      const owner = node(el, "span", "uttt-owner");
      owner.setAttribute("aria-hidden", "true");
      return { el, marks, owner };
    });
    const cells = Array.from({ length: 81 }, (_, p) => {
      const el = node(regions[Math.floor(p / 9)].marks, "button", "uttt-cell");
      el.type = "button";
      el.dataset.cell = p;
      el.addEventListener(
        "pointerenter",
        (event) => {
          if (event.pointerType === "touch") return;
          clearPreview();
          previewCell = p;
          previewTimer = window.setTimeout(() => {
            previewTimer = 0;
            renderPreview();
          }, 100);
          renderPreview();
        },
        { signal },
      );
      el.addEventListener(
        "pointerleave",
        () => {
          clearPreview();
          renderPreview();
        },
        { signal },
      );
      el.addEventListener(
        "click",
        () => {
          if (
            !playable() ||
            thinking ||
            (options.mode === "ai" && state.turn !== options.human)
          )
            return;
          const next = R.move(state, p);
          if (next) accept(next);
        },
        { signal },
      );
      el.addEventListener(
        "focus",
        () => {
          cells[focus].tabIndex = -1;
          focus = p;
          el.tabIndex = 0;
          if (el.matches(":focus-visible")) {
            clearPreview();
            previewCell = p;
            renderPreview();
          }
        },
        { signal },
      );
      el.addEventListener(
        "keydown",
        (event) => {
          const offset = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -9,
            ArrowDown: 9,
          }[event.key];
          if (!offset) return;
          event.preventDefault();
          const flat = R.flat(p),
            next = flat + offset;
          if (
            next < 0 ||
            next >= 81 ||
            (Math.abs(offset) === 1 &&
              Math.floor(next / 9) !== Math.floor(flat / 9))
          )
            return;
          cells[R.flat(next)].focus();
        },
        { signal },
      );
      return el;
    });
    const resultLayer = node(board, "div", "uttt-result-layer");
    resultLayer.hidden = true;
    const resultCard = node(resultLayer, "div", "uttt-result-card");
    resultCard.setAttribute("role", "group");
    resultCard.setAttribute("aria-labelledby", "uttt-result-label");
    const resultSymbol = node(resultCard, "span", "uttt-result-symbol");
    resultSymbol.setAttribute("aria-hidden", "true");
    const resultLabel = node(resultCard, "strong");
    resultLabel.id = "uttt-result-label";
    const resultActions = node(resultCard, "div", "uttt-result-actions");
    const resultBack = button(
      resultActions,
      "result-back",
      "resultBack",
      () => {
        resultLayer.hidden = true;
        cells[focus].focus({ preventScroll: true });
      },
    );
    button(resultActions, "result-restart", "restart", () => {
      restartMatch();
      cells[focus].focus({ preventScroll: true });
    });
    const controls = node(play, "aside", "uttt-controls");
    const objective = node(controls, "header", "uttt-objective");
    const matchTitle = node(objective, "h3"),
      detail = node(objective, "p", "uttt-muted");
    const score = node(controls, "div", "uttt-score");
    const scoreRows = ["X", "O"].map((mark) => {
      const card = node(score, "div", "uttt-score-row");
      card.dataset.mark = mark;
      const symbol = node(card, "span", "uttt-score-symbol");
      paintMark(symbol, mark);
      return { label: node(card, "span"), value: node(card, "strong"), mark };
    });
    const status = node(controls, "p", "uttt-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const target = node(controls, "p", "uttt-muted");
    const previewNote = node(controls, "p", "uttt-preview-note");
    const thinkingIndicator = node(controls, "div", "uttt-thinking");
    thinkingIndicator.setAttribute("aria-hidden", "true");
    // Material Symbols Rounded Psychology, Apache-2.0; Google revision 737e3324305806514d7909874fa1818ae1808232.
    thinkingIndicator.innerHTML = `<svg class="uttt-thinking-icon" viewBox="0 -960 960 960" focusable="false">
      <path d="M240-252q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v40q0 17-11.5 28.5T560-80q-17 0-28.5-11.5T520-120v-80q0-17 11.5-28.5T560-240h120v-160q0-17 11.5-28.5T720-440h68l-38-155q-23-91-98-148t-172-57q-116 0-198 81t-82 197q0 60 24.5 114t69.5 96l26 24v168q0 17-11.5 28.5T280-80q-17 0-28.5-11.5T240-120v-132Zm254-188Z" />
      <path class="uttt-thinking-gear" d="m434-410 4 32q1 8 6.5 13t13.5 5h44q8 0 13.5-5t6.5-13l4-32q8-3 14.5-7t11.5-9l30 13q7 3 14 1t11-9l22-38q4-7 2.5-14t-7.5-12l-26-19q2-8 2-16t-2-16l26-19q6-5 7.5-12t-2.5-14l-22-38q-4-7-11-9t-14 1l-30 13q-5-5-11.5-9t-14.5-7l-4-32q-1-8-6.5-13t-13.5-5h-44q-8 0-13.5 5t-6.5 13l-4 32q-8 3-14.5 7t-11.5 9l-30-13q-7-3-14-1t-11 9l-22 38q-4 7-2.5 14t7.5 12l26 19q-2 8-2 16t2 16l-26 19q-6 5-7.5 12t2.5 14l22 38q4 7 11 9t14-1l30-13q5 5 11.5 9t14.5 7Zm46-50q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460Z" />
    </svg>`;
    const error = node(controls, "section", "uttt-engine-error");
    const errorText = node(error, "p");
    errorText.setAttribute("role", "alert");
    button(error, "retry", "retry", () => {
      cancel();
      engineError = false;
      advanceTurn();
      render();
    });
    const actions = node(controls, "div", "uttt-actions");
    const undo = button(actions, "undo", "undo", () => {
      resultLayer.hidden = true;
      cancel();
      engineError = false;
      let length = state.path.length - 1;
      if (options.mode === "ai")
        while (length > 0 && (length % 2 ? -1 : 1) !== options.human) length--;
      state = R.replay(state.path.slice(0, Math.max(0, length)), options.chain);
      if (state.path.length < continuedAt) continuedAt = 0;
      persist();
      render();
      advanceTurn();
    });
    const restart = button(actions, "restart", "restart", () =>
      prompt.open(restart),
    );
    const settings = button(actions, "settings", "settings", () => {
      resultLayer.hidden = true;
      cancel();
      draft = { ...options };
      setupOpen = true;
      render();
      if (draft.mode === "ai") warm();
    });
    const guide = node(controls, "section", "uttt-guide");
    const summary = node(guide, "h4");
    const rulesText = node(guide, "p");
    const chainRules = node(guide, "p");
    const saveError = node(root, "p", "uttt-save-error");
    saveError.setAttribute("role", "status");
    const prompt = G.createRestartPrompt({
      host: root,
      signal,
      onOpen() {
        covered = true;
        cancel({ keepEngine: setupOpen && draft.mode === "ai" });
      },
      onCancel() {
        covered = false;
        render();
        advanceTurn();
      },
      onConfirm() {
        covered = false;
        if (setupOpen) startMatch();
        else restartMatch();
      },
    });
    const lockedPrompt = G.createRestartPrompt({
      host: stage,
      signal,
      labels: () => ({
        title: lockedWinner
          ? t("lockedWin", { side: lockedWinner === 1 ? "X" : "O" })
          : t("lockedDraw"),
        cancel: t("continueMatch"),
        accept: t("restart"),
      }),
      onOpen() {
        covered = true;
        cancel();
        render();
      },
      onCancel() {
        covered = false;
        continuedAt = state.path.length;
        render();
        advanceTurn();
      },
      onConfirm() {
        covered = false;
        restartMatch();
        cells[focus].focus({ preventScroll: true });
      },
    });
    function restartMatch(keepEngine = false) {
      matchSave.matchSession = archive.newMatchSession();
      resultLayer.hidden = true;
      cancel({ keepEngine });
      state = R.create(options.chain);
      continuedAt = 0;
      engineError = false;
      persist();
      render();
      advanceTurn();
    }
    function playable() {
      return (
        !disposed &&
        !matchHistory?.active &&
        !paused &&
        !covered &&
        !setupOpen &&
        !document.hidden &&
        state.status === "playing"
      );
    }
    function clearPreview() {
      window.clearTimeout(previewTimer);
      previewTimer = 0;
      previewCell = -1;
    }
    function showResult() {
      const mark = state.winner === 1 ? "X" : state.winner === -1 ? "O" : "=";
      resultLayer.dataset.mark = mark;
      paintMark(resultSymbol, mark);
      resultLayer.hidden = false;
    }
    function cancel({ keepEngine = false } = {}) {
      clearPreview();
      generation++;
      thinking = false;
      if (!keepEngine) {
        engine?.dispose();
        engine = null;
      }
      animations.forEach((a) => a.cancel());
      animations = [];
      root.querySelectorAll(".uttt-ghost").forEach((el) => el.remove());
    }
    function warm() {
      if (disposed || paused || document.hidden || draft.mode !== "ai") return;
      engine ||= G.createUltimateTttEngine();
      const current = engine;
      current.load().catch(() => {
        if (engine !== current || disposed) return;
        engineError = true;
        render();
      });
    }
    function persist() {
      if (matchHistory?.active) return;
      options.path = state.path.slice();
      try {
        storage.setItem(
          archive.keys["game-ultimate-ttt"],
          JSON.stringify({ version: 1, state: options, ...matchSave }),
        );
        failed = false;
      } catch {
        failed = true;
      }
    }
    function accept(next) {
      if (matchHistory?.active) return;
      clearPreview();
      const erased = next.cleared.map((p) => ({ p, mark: state.board[p] }));
      state = next;
      if (state.status === "won")
        archive.recordMatch(
          matchSave,
          "game-ultimate-ttt",
          options,
          state.path,
        );
      if (state.status !== "playing") showResult();
      persist();
      render();
      if (!resultLayer.hidden && board.contains(document.activeElement))
        resultBack.focus({ preventScroll: true });
      if (!compat.preference().matches)
        for (const { p, mark } of erased) {
          const ghost = node(cells[p], "span", "uttt-ghost");
          paintMark(ghost, mark === 1 ? "X" : "O");
          ghost.dataset.side = mark;
          ghost.setAttribute("aria-hidden", "true");
          const animation = compat.animate(
            ghost,
            [{ opacity: 0.7 }, { opacity: 0, transform: "scale(.65)" }],
            { duration: 240 },
          );
          animations.push(animation);
          animation.finished.then(
            () => ghost.remove(),
            () => ghost.remove(),
          );
        }
      advanceTurn();
    }
    function advanceTurn() {
      if (!playable()) return;
      if (!continuedAt && checkedState !== state) {
        checkedState = state;
        lockedWinner = R.lockedResult(state);
      }
      if (!continuedAt && lockedWinner !== null) {
        const position = state;
        // Wait for the game shell to finish its initial focus handling.
        queueMicrotask(() => {
          if (state === position && playable()) lockedPrompt.open(cells[focus]);
        });
        return;
      }
      if (
        options.mode !== "ai" ||
        state.turn === options.human ||
        thinking ||
        engineError
      )
        return;
      thinking = true;
      const token = ++generation;
      engine ||= G.createUltimateTttEngine();
      render();
      engine
        .search(state, options.difficulty)
        .then((result) => {
          if (token !== generation || !playable()) return;
          thinking = false;
          root.dataset.engine = result.engine;
          root.dataset.simulations = result.simulations;
          const next = R.move(state, result.move);
          if (!next) throw Error("Illegal move");
          accept(next);
        })
        .catch(() => {
          if (token !== generation || disposed) return;
          cancel();
          engineError = true;
          render();
        });
    }
    function render() {
      matchHistory?.render();
      catalog.page.hidden = !setupOpen;
      play.hidden = setupOpen;
      catalog.refresh();
      catalog.setReturn(
        active
          ? () => {
              setupOpen = false;
              render();
              advanceTurn();
            }
          : null,
      );
      catalog.categories.setAttribute("aria-label", t("mode"));
      for (const { mode, control } of modes)
        control.setAttribute("aria-pressed", String(draft.mode === mode));
      heading.textContent = t(draft.mode);
      intro.textContent = t("description");
      for (const { el, key } of buttons) el.textContent = t(key);
      for (const [el, key, icon] of [
        [undo, "undo", "undo"],
        [restart, "restart", "restart-alt"],
        [settings, "settings", "grid-4x4"],
      ]) {
        el.replaceChildren(G.createIcon(icon));
        node(el, "span").textContent = t(key);
        el.setAttribute("aria-label", t(key));
      }
      difficultyLabel.textContent = t("difficulty");
      sideLabel.textContent = t("side");
      for (const { value, control } of difficulties)
        control.setAttribute(
          "aria-pressed",
          String(draft.difficulty === value),
        );
      for (const { control, label, key } of startCards) {
        label.textContent = t("startShort");
        control.setAttribute(
          "aria-label",
          key === "start" ? t(key) : t(key) + " · " + t("startShort"),
        );
      }
      const aiMode = draft.mode === "ai";
      difficulty.hidden = side.hidden = engineName.hidden = !aiMode;
      localRow.hidden = aiMode;
      chain.checked = draft.chain;
      chainName.textContent = t("chain");
      chainNote.textContent = t("chainRules");
      engineName.textContent = t("engine");
      matchTitle.textContent = t(options.mode);
      detail.textContent = [
        options.mode === "ai" ? t(options.difficulty) : "",
        options.chain ? t("chain") : t("classic"),
      ]
        .filter(Boolean)
        .join(" · ");
      const [x, o] = R.counts(state);
      scoreRows.forEach(({ label, value }, i) => {
        label.textContent = ":";
        value.textContent = String(i === 0 ? x : o);
      });
      status.textContent =
        state.status === "draw"
          ? t("draw")
          : state.status === "won"
            ? t(state.reason === "territory" ? "territoryWin" : "lineWin", {
                side: state.winner === 1 ? "X" : "O",
              })
            : engineError
              ? t("engineError")
              : thinking
                ? t("thinking")
                : t("turn", { side: state.turn === 1 ? "X" : "O" });
      status.dataset.thinking = String(thinking);
      if (!resultLayer.hidden) {
        const resultKey =
          state.status === "draw"
            ? "resultDraw"
            : options.mode === "local"
              ? "resultSide"
              : state.winner === options.human
                ? "resultWin"
                : "resultLoss";
        resultLabel.textContent = t(resultKey, {
          side: resultLayer.dataset.mark,
        });
      }
      thinkingIndicator.toggleAttribute(
        "data-active",
        thinking &&
          !setupOpen &&
          !paused &&
          !engineError &&
          state.status === "playing",
      );
      if (thinking)
        thinkingIndicator.dataset.side = state.turn === 1 ? "x" : "o";
      target.textContent =
        state.status !== "playing"
          ? ""
          : state.target === -1
            ? t("free")
            : t("target", { region: state.target + 1 });
      error.hidden = !engineError;
      errorText.textContent = t("engineError");
      undo.disabled =
        state.path.length <=
        (options.mode === "ai" && options.human === -1 ? 1 : 0);
      summary.textContent = t("rules");
      rulesText.textContent = t("shortRules");
      chainRules.textContent = t("shortChain");
      chainRules.hidden = !options.chain;
      saveError.hidden = !failed;
      saveError.textContent = t("saveError");
      board.setAttribute("aria-label", t("board"));
      board.setAttribute("aria-busy", String(thinking));
      const legal = new Set(R.legal(state));
      regions.forEach(({ el, owner }, r) => {
        el.dataset.owner = state.regions[r];
        el.classList.toggle(
          "is-active",
          state.status === "playing" &&
            !state.regions[r] &&
            (state.target === -1 || state.target === r),
        );
        const mark =
          state.regions[r] === 1
            ? "X"
            : state.regions[r] === -1
              ? "O"
              : state.regions[r] === 2
                ? "—"
                : "";
        if (owner.dataset.mark !== mark) {
          paintMark(owner, mark);
          owner.dataset.mark = mark;
        }
      });
      cells.forEach((el, p) => {
        const mark =
          state.board[p] === 1 ? "X" : state.board[p] === -1 ? "O" : "";
        if (el.dataset.mark !== mark) {
          paintMark(el, mark);
          el.dataset.mark = mark;
        }
        el.dataset.side = state.board[p];
        el.classList.toggle(
          "is-last",
          state.path.at(-1) === p && !!state.board[p],
        );
        el.setAttribute(
          "aria-disabled",
          String(!legal.has(p) || thinking || !playable()),
        );
        el.setAttribute(
          "aria-label",
          t("cell", {
            region: Math.floor(p / 9) + 1,
            cell: (p % 9) + 1,
            mark: mark || t("empty"),
          }),
        );
        el.tabIndex = focus === p ? 0 : -1;
      });
      root.dataset.status = state.status;
      renderPreview();
    }
    function renderPreview() {
      const canPreview =
        playable() &&
        !thinking &&
        !engineError &&
        (options.mode === "local" || state.turn === options.human);
      const next =
        canPreview && previewCell >= 0
          ? R.move(state, previewCell, false)
          : null;
      const playing = next?.status === "playing";
      regions.forEach(({ el }, r) => {
        el.classList.toggle(
          "is-preview",
          !previewTimer &&
            !!playing &&
            !next.regions[r] &&
            (next.target === -1 || next.target === r),
        );
      });
      board.dataset.preview = playing
        ? next.target === -1
          ? "free"
          : String(next.target)
        : "";
      previewNote.textContent = !next
        ? ""
        : !playing
          ? t("previewEnd")
          : next.target === -1
            ? t("previewFree")
            : t("previewTarget", { region: next.target + 1 });
    }
    document.addEventListener("worktime:languagechange", render, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          cancel();
          render();
        } else if (setupOpen) warm();
        else advanceTurn();
      },
      { signal },
    );
    signal.addEventListener("abort", cancel, { once: true });
    matchHistory = G.createCompletionHistory({
      root,
      host: catalog.categories,
      playbackHost: controls,
      kind: "match",
      signal,
      records: () => matchSave.matchHistory ?? [],
      title: (record, date) =>
        G.matchRecordTitle("game-ultimate-ttt", record, date),
      onStart(record) {
        replaySnapshot = {
          options,
          state,
          active,
          setupOpen,
          focus,
          resultHidden: resultLayer.hidden,
        };
        cancel();
        options = { ...record.config, path: [] };
        active = true;
        setupOpen = false;
        resultLayer.hidden = true;
      },
      onFrame(path) {
        state = R.replay(path, options.chain);
        render();
      },
      onExit() {
        ({ options, state, active, setupOpen, focus } = replaySnapshot);
        resultLayer.hidden = replaySnapshot.resultHidden;
        replaySnapshot = null;
        render();
        if (!setupOpen) advanceTurn();
      },
    });
    render();
    if (setupOpen) warm();
    else advanceTurn();
    return {
      pause() {
        matchHistory.pause();
        paused = true;
        cancel();
        render();
      },
      resume() {
        paused = false;
        render();
        if (setupOpen) warm();
        else advanceTurn();
      },
      resize({ width, height }) {
        root.dataset.compact = String(width < 800);
        root.style.setProperty(
          "--uttt-size",
          Math.max(
            180,
            Math.min(
              720,
              width < 800 ? width - 16 : width - 300,
              width < 800 ? Infinity : height - 30,
            ),
          ) + "px",
        );
      },
      dispose() {
        matchHistory.dispose();
        disposed = true;
        cancel();
        root.remove();
      },
    };
  },
});
