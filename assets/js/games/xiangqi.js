"use strict";

WorkTimeApp.games.register({
  id: "game-xiangqi",
  nameKey: "games.xiangqi.name",
  descriptionKey: "games.xiangqi.description",
  icon: "game-xiangqi",
  create({ container, signal }) {
    const archive = WorkTimeApp.services.gameArchive;
    const storage = archive.session();
    const key = archive.keys["game-xiangqi"];
    const rules = WorkTimeApp.games.xiangqiRules;
    const levels = WorkTimeApp.data.xiangqi;
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.xiangqi." + name, params);
    const groupFor = ({ goal }) =>
      goal <= 3 ? goal : goal <= 5 ? 4 : goal <= 8 ? 5 : 6;
    const groupLabel = (group) =>
      t(group <= 3 ? "goal" + group : "classics" + group);
    const glyphs = {
      K: "帥",
      A: "仕",
      E: "相",
      H: "馬",
      R: "車",
      C: "炮",
      P: "兵",
      k: "將",
      a: "士",
      e: "象",
      h: "馬",
      r: "車",
      c: "砲",
      p: "卒",
    };
    let save = { version: 1, current: null, drafts: {}, completed: {} };
    let saveFailed = false;
    try {
      const raw = storage.getItem(key);
      if (raw !== null)
        save = archive.normalize("game-xiangqi", JSON.parse(raw));
    } catch {
      saveFailed = true;
    }
    let level = levels.find(({ id }) => id === save.current);
    let returnLevel = level;
    let selectedGroup = level ? groupFor(level) : 1;
    let path = save.drafts[save.current]?.path ?? [];
    let position = level ? rules.restore(level, path) : null;
    let selected = null;
    let focus = position?.board.search(/[AEHRCPK]/) ?? 0;
    let message = null;
    let paused = false;
    let presentation = null;
    let resultEffect = null;
    const initialPosition =
      "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR";
    const versusLevel = { id: "versus", position: initialPosition };
    let versus = false;
    let difficulty = "normal";
    let humanRed = true;
    const humanTurn = () => (path.length % 2 === 0) === humanRed;
    let engine = null;
    let thinking = false;
    let renderedPathLength = 0;
    let engineError = false;
    let engineReady = false;
    let searchGeneration = 0;
    let thought = null;

    function node(parent, tag, className) {
      const element = document.createElement(tag);
      element.className = className;
      parent.append(element);
      return element;
    }
    function listen(target, type, callback) {
      target.addEventListener(type, callback, { signal });
    }
    function button(parent, action, callback) {
      const element = node(parent, "button", "game-button");
      element.type = "button";
      element.dataset.xiangqiAction = action;
      listen(element, "click", (event) => {
        if (!paused && !signal.aborted) callback(event.detail === 0);
      });
      return element;
    }
    const root = node(container, "section", "game-xiangqi game-session");
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "xiangqi-level-page",
      signal,
    );
    const categories = catalog.categories;
    categories.setAttribute("role", "group");
    const groups = [1, 2, 3, 4, 5, 6].map((group) => ({
      group,
      control: button(categories, "goal" + group, () => {
        versus = false;
        selectedGroup = group;
        render();
      }),
      entries: node(catalog.entries, "div", "xiangqi-levels game-level-grid"),
    }));
    const levelButtons = levels.map((entry, index) =>
      button(groups[groupFor(entry) - 1].entries, entry.id, (keyboard) =>
        start(index, keyboard),
      ),
    );
    groups.forEach(({ group, entries }) => {
      entries.classList.toggle("xiangqi-named-levels", group >= 4);
    });
    const divider = node(categories, "div", "xiangqi-category-divider");
    divider.setAttribute("role", "separator");
    const versusMode = button(categories, "versus", () => switchMode(true));
    const setup = node(catalog.entries, "div", "xiangqi-versus-setup");
    const setupTitle = node(setup, "h3", "xiangqi-setup-title");
    const difficultyOptions = node(setup, "div", "xiangqi-difficulties");
    difficultyOptions.setAttribute("role", "group");
    const difficultyButtons = ["normal", "hard", "master"].map((value) => ({
      value,
      control: button(difficultyOptions, "difficulty-" + value, () => {
        difficulty = value;
        render();
      }),
    }));
    const startTitle = node(setup, "h4", "xiangqi-start-title");
    const startOptions = node(setup, "div", "xiangqi-start-options");
    const startButtons = [true, false].map((red) => ({
      red,
      control: button(
        startOptions,
        red ? "start-red" : "start-black",
        (keyboard) => {
          humanRed = red;
          startVersus(keyboard);
        },
      ),
    }));
    const play = node(root, "div", "xiangqi-play");
    const stage = node(play, "div", "xiangqi-stage");
    const board = node(stage, "div", "xiangqi-board");
    board.setAttribute("role", "group");
    const art = node(board, "div", "xiangqi-art");
    art.setAttribute("aria-hidden", "true");
    art.innerHTML = `<svg viewBox="0 0 9 10" focusable="false">
      <path d="M.5 .5H8.5V9.5H.5Z M.5 1.5h8m-8 1h8m-8 1h8m-8 1h8
        m-8 1h8m-8 1h8m-8 1h8m-8 1h8
        M1.5 .5v4m1-4v4m1-4v4m1-4v4m1-4v4m1-4v4m1-4v4
        M1.5 5.5v4m1-4v4m1-4v4m1-4v4m1-4v4m1-4v4m1-4v4
        M3.5 .5l2 2m0-2-2 2m0 5 2 2m0-2-2 2"/>
      <text x="2.5" y="5.02">楚河</text><text x="6.5" y="5.02">漢界</text>
    </svg>`;
    const cells = Array.from(
      { length: rules.rows * rules.columns },
      (_, square) => {
        const cell = node(board, "button", "xiangqi-cell");
        cell.type = "button";
        cell.dataset.square = square;
        const piece = node(cell, "span", "xiangqi-piece");
        piece.setAttribute("aria-hidden", "true");
        listen(cell, "click", () => {
          if (paused || signal.aborted || presentation) return;
          setFocus(square);
          activate(square);
        });
        return { cell, piece };
      },
    );
    const resultLayer = node(board, "div", "xiangqi-result");
    resultLayer.hidden = true;
    resultLayer.setAttribute("aria-hidden", "true");
    const resultFrame = node(resultLayer, "div", "xiangqi-result-frame");
    const resultWash = node(resultFrame, "div", "xiangqi-result-wash");
    const resultSplash = node(resultFrame, "div", "xiangqi-result-splash");
    const resultArt = node(resultFrame, "img", "xiangqi-result-art");
    resultArt.alt = "";
    resultArt.draggable = false;
    for (const name of ["win", "loss", "stalemate"]) {
      const preload = new Image();
      preload.src = "assets/images/xiangqi/" + name + "-brush.png";
    }
    const controls = node(play, "div", "xiangqi-controls");
    const objective = node(controls, "div", "xiangqi-objective");
    const levelTitle = node(objective, "h3", "xiangqi-level-title");
    const fastest = node(objective, "p", "xiangqi-detail");
    const played = node(objective, "p", "xiangqi-detail");
    const status = node(controls, "p", "xiangqi-status");
    status.setAttribute("role", "status");
    const thinkingIndicator = node(controls, "div", "xiangqi-thinking");
    thinkingIndicator.setAttribute("aria-hidden", "true");
    // Material Symbols Rounded Psychology, Apache-2.0; Google revision 737e3324305806514d7909874fa1818ae1808232.
    thinkingIndicator.innerHTML = `<svg class="xiangqi-thinking-icon" viewBox="0 -960 960 960" focusable="false">
      <path d="M240-252q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v40q0 17-11.5 28.5T560-80q-17 0-28.5-11.5T520-120v-80q0-17 11.5-28.5T560-240h120v-160q0-17 11.5-28.5T720-440h68l-38-155q-23-91-98-148t-172-57q-116 0-198 81t-82 197q0 60 24.5 114t69.5 96l26 24v168q0 17-11.5 28.5T280-80q-17 0-28.5-11.5T240-120v-132Zm254-188Z" />
      <path class="xiangqi-thinking-gear" d="m434-410 4 32q1 8 6.5 13t13.5 5h44q8 0 13.5-5t6.5-13l4-32q8-3 14.5-7t11.5-9l30 13q7 3 14 1t11-9l22-38q4-7 2.5-14t-7.5-12l-26-19q2-8 2-16t-2-16l26-19q6-5 7.5-12t-2.5-14l-22-38q-4-7-11-9t-14 1l-30 13q-5-5-11.5-9t-14.5-7l-4-32q-1-8-6.5-13t-13.5-5h-44q-8 0-13.5 5t-6.5 13l-4 32q-8 3-14.5 7t-11.5 9l-30-13q-7-3-14-1t-11 9l-22 38q-4 7-2.5 14t7.5 12l26 19q-2 8-2 16t2 16l-26 19q-6 5-7.5 12t2.5 14l22 38q4 7 11 9t14-1l30-13q5 5 11.5 9t14.5 7Zm46-50q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460Z" />
    </svg>`;
    const actions = node(controls, "div", "xiangqi-actions");
    const undo = button(actions, "undo", undoRound);
    const restart = button(actions, "restart", (keyboard) => {
      if (versus) {
        restartPrompt.open(restart);
        return;
      }
      stopPresentation();
      path = [];
      updatePosition();
      render();
      if (keyboard) focusBoard();
    });
    const restartPrompt = WorkTimeApp.games.createRestartPrompt({
      host: stage,
      signal,
      onOpen() {
        paused = true;
        cancelSearch();
        settle();
      },
      onCancel() {
        paused = false;
        render();
        replyVersus();
      },
      onConfirm() {
        paused = false;
        startVersus(true);
      },
    });
    const next = button(actions, "next", (keyboard) =>
      start(levels.indexOf(level) + 1, keyboard),
    );
    actions.prepend(next);
    const choose = button(actions, "choose", () => {
      if (versus) {
        cancelSearch();
        level = null;
        render();
        versusMode.focus();
        return;
      }
      stopPresentation();
      const index = levels.indexOf(level);
      level = null;
      save.current = null;
      persist();
      render();
      levelButtons[index].focus();
    });
    const warning = node(root, "p", "xiangqi-warning");
    warning.setAttribute("role", "status");

    function persist() {
      try {
        storage.setItem(key, JSON.stringify(save));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }

    function cancelSearch(release = false) {
      searchGeneration++;
      thought?.cancel();
      thought = null;
      thinking = false;
      board.removeAttribute("data-replying");
      if (release || engine?.busy) {
        engine?.dispose();
        engine = null;
        engineReady = false;
      }
    }

    function switchMode(value) {
      cancelSearch(!value);
      stopPresentation();
      versus = value;
      level = null;
      position = null;
      path = [];
      selected = message = null;
      render();
      if (value) prepareEngine();
    }

    function startVersus(keyboard = false) {
      cancelSearch();
      stopPresentation();
      level = versusLevel;
      path = [];
      position = { board: rules.parse(initialPosition), status: "playing" };
      selected = message = null;
      engineError = false;
      focus = 76;
      if (!humanRed) focus = 13;
      render();
      if (keyboard) focusBoard();
      prepareEngine();
      if (!humanRed) replyVersus();
    }

    async function prepareEngine() {
      const generation = searchGeneration;
      try {
        engine ??= WorkTimeApp.games.createXiangqiEngine();
        await engine.load();
        if (generation !== searchGeneration || signal.aborted) return;
        engineError = false;
        engineReady = true;
        render();
      } catch {
        if (generation !== searchGeneration || signal.aborted) return;
        engineError = true;
        render();
      }
    }

    function versusPosition() {
      let value = rules.parse(initialPosition);
      for (const move of path) value = rules.apply(value, move);
      const redTurn = path.length % 2 === 0;
      const outcome = rules.result(value, redTurn);
      position = {
        board: value,
        status:
          outcome === "playing"
            ? "playing"
            : redTurn === humanRed
              ? "lost"
              : "won",
        outcome,
      };
      selected = message = null;
    }

    function fen(value) {
      value = value.replace(
        /[heHE]/g,
        (piece) => ({ h: "n", H: "N", e: "b", E: "B" })[piece],
      );
      return (
        Array.from({ length: 10 }, (_, row) =>
          value
            .slice(row * 9, row * 9 + 9)
            .replace(/\.+/g, (empty) => String(empty.length)),
        ).join("/") +
        (path.length % 2 === 0 ? " w" : " b") +
        " - - 0 1"
      );
    }

    async function replyVersus() {
      if (restartPrompt.isOpen()) return;
      if (
        thinking ||
        paused ||
        document.hidden ||
        signal.aborted ||
        !level ||
        !versus ||
        humanTurn() ||
        position.status !== "playing"
      )
        return;
      const generation = searchGeneration;
      thinking = true;
      engineError = false;
      const turn = WorkTimeApp.games.createThinkTurn({
        simple:
          path.length < 4 ||
          rules.legalMoves(position.board, !humanRed).length === 1,
        advanced: difficulty !== "normal",
      });
      thought = turn;
      render();
      try {
        engine ??= WorkTimeApp.games.createXiangqiEngine();
        const moveText = await engine.search(fen(position.board), difficulty);
        if (generation !== searchGeneration || signal.aborted) return;
        engineReady = true;
        if (!/^[a-i][0-9][a-i][0-9]$/.test(moveText))
          throw Error("Invalid engine move");
        const square = (file, rank) =>
          (9 - Number(rank)) * 9 + file.charCodeAt(0) - 97;
        const move = rules.encode(
          square(moveText[0], moveText[1]),
          square(moveText[2], moveText[3]),
        );
        if (!rules.legalMoves(position.board, !humanRed).includes(move))
          throw Error("Illegal engine move");
        turn.wait(() => {
          if (
            generation !== searchGeneration ||
            signal.aborted ||
            paused ||
            document.hidden
          )
            return;
          thought = null;
          path.push(move);
          versusPosition();
          thinking = false;
          render();
          if (position.status !== "playing") showResult();
        });
        return;
      } catch {
        if (generation !== searchGeneration || signal.aborted) return;
        turn.cancel();
        thought = null;
        engineError = true;
      }
      if (generation !== searchGeneration || signal.aborted) return;
      thinking = false;
      render();
      if (position.status !== "playing") showResult();
    }

    function updatePosition(nextPosition = rules.restore(level, path)) {
      position = nextPosition;
      if (position.status !== "won") {
        save.drafts[level.id] = { path };
        save.current = level.id;
      } else {
        save.completed[level.id] ??= { path };
        delete save.drafts[level.id];
        save.current = null;
      }
      selected = message = null;
      persist();
    }

    function stopPresentation() {
      clearResult();
      const current = presentation;
      if (!current) return;
      presentation = null;
      current.thought?.cancel();
      board.removeAttribute("data-replying");
      current.animation?.cancel();
    }

    function clearResult() {
      const effect = resultEffect;
      resultEffect = null;
      clearTimeout(effect?.timer);
      effect?.animations.forEach((animation) => animation.cancel());
      resultLayer.hidden = true;
      delete resultLayer.dataset.result;
    }

    function showResult() {
      clearResult();
      if (
        paused ||
        signal.aborted ||
        document.hidden ||
        position.status === "playing"
      )
        return;
      const outcome =
        position.status === "won"
          ? position.outcome === "stalemate"
            ? "stalemate"
            : "win"
          : "loss";
      const effect = { animations: [] };
      resultEffect = effect;
      resultLayer.dataset.result = outcome;
      resultArt.src = "assets/images/xiangqi/" + outcome + "-brush.png";
      resultLayer.hidden = false;
      const animated =
        !reduced.matches && typeof resultArt.animate === "function";
      resultWash.hidden = resultSplash.hidden = !animated;
      if (animated) {
        const track = (element, frames, options) => {
          effect.animations.push(
            compat.animate(element, frames, { fill: "both", ...options }),
          );
        };
        track(
          resultArt,
          [
            { opacity: 0, transform: "scale(1.55) rotate(-8deg)", offset: 0 },
            {
              opacity: 1,
              transform: "scale(0.97) rotate(-4deg)",
              offset: 0.122,
            },
            { opacity: 1, transform: "scale(1) rotate(-4deg)", offset: 0.19 },
            { opacity: 1, transform: "scale(1) rotate(-4deg)", offset: 0.75 },
            { opacity: 0, transform: "scale(1.04) rotate(-4deg)", offset: 1 },
          ],
          { duration: 1800, easing: "ease-out" },
        );
        track(
          resultFrame,
          [
            { transform: "translate(0, 0)" },
            { transform: "translate(-2px, 1px)" },
            { transform: "translate(2px, -1px)" },
            { transform: "translate(-1px, 0)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 100, delay: 170 },
        );
        track(
          resultWash,
          [
            { opacity: 0, transform: "scale(.45)", offset: 0 },
            { opacity: 0.8, transform: "scale(.85)", offset: 0.32 },
            { opacity: 0.5, transform: "scale(1)", offset: 0.6 },
            { opacity: 0, transform: "scale(1.1)", offset: 1 },
          ],
          { duration: 1550, delay: 100, easing: "ease-out" },
        );
        track(
          resultSplash,
          [
            { opacity: 0, transform: "scale(.4)", offset: 0 },
            { opacity: 0.75, transform: "scale(.85)", offset: 0.13 },
            { opacity: 0.45, transform: "scale(1)", offset: 0.4 },
            { opacity: 0, transform: "scale(1.07)", offset: 1 },
          ],
          { duration: 1250, delay: 150, easing: "ease-out" },
        );
      }
      effect.timer = setTimeout(() => {
        if (resultEffect === effect) clearResult();
      }, 1800);
    }

    function showRound(before, move, reply) {
      const redBoard = rules.apply(before, move);
      const round = {
        board: redBoard,
        red: rules.decode(move),
        black: [],
        waiting: reply !== null,
        thought:
          reply === null
            ? null
            : WorkTimeApp.games.createThinkTurn({
                simple: rules.legalMoves(redBoard, false).length === 1,
                advanced: groupFor(level) === 6,
              }),
      };
      presentation = round;
      render();

      function slide([from, to], duration, done) {
        if (reduced.matches || typeof cells[to].piece.animate !== "function") {
          done();
          return;
        }
        const source = cells[from].cell.getBoundingClientRect();
        const target = cells[to].cell.getBoundingClientRect();
        round.animation = compat.animate(
          cells[to].piece,
          [
            {
              transform: `translate(${source.x - target.x}px, ${source.y - target.y}px)`,
            },
            { transform: "none" },
          ],
          { duration, easing: "ease-out" },
        );
        round.animation.finished.then(() => {
          if (presentation === round) done();
        });
      }

      function finish() {
        stopPresentation();
        render();
        showResult();
      }

      function afterRed() {
        if (reply === null) {
          finish();
          return;
        }
        round.thought.wait(() => {
          if (
            presentation !== round ||
            paused ||
            document.hidden ||
            signal.aborted
          )
            return;
          round.board = position.board;
          round.black = rules.decode(reply);
          round.waiting = false;
          render();
          slide(round.black, 150, finish);
        });
      }

      slide(round.red, 110, afterRed);
    }

    function start(index, keyboard) {
      stopPresentation();
      level = levels[index];
      returnLevel = level;
      selectedGroup = groupFor(level);
      path = save.drafts[level.id]?.path ?? [];
      updatePosition();
      focus = position.board.search(/[AEHRCPK]/);
      render();
      board.toggleAttribute("data-pointer-entry", !keyboard);
      focusBoard();
    }

    function undoRound(keyboard) {
      stopPresentation();
      if (versus) cancelSearch();
      path = path.slice(
        0,
        versus ? (humanTurn() ? -2 : -1) : path.length % 2 ? -1 : -2,
      );
      if (versus) versusPosition();
      else updatePosition();
      render();
      if (versus) prepareEngine();
      if (keyboard || undo.disabled) focusBoard();
    }

    function activate(square) {
      if (versus && (thinking || !humanTurn())) return;
      if (position.status !== "playing") return;
      message = null;
      if (
        position.board[square] !== "." &&
        rules.side(position.board[square]) === (!versus || humanRed)
      ) {
        selected = selected === square ? null : square;
        render();
      } else if (selected !== null) attempt(square);
      else render();
    }

    function attempt(square) {
      const before = position.board;
      const move = rules.encode(selected, square);
      if (versus) {
        if (
          thinking ||
          !humanTurn() ||
          !rules.destinations(before, humanRed, selected).includes(move)
        ) {
          message = "illegal";
          render();
          return;
        }
        path.push(move);
        versusPosition();
        render();
        if (position.status !== "playing") showResult();
        else replyVersus();
        return;
      }
      const nextPosition = rules.playRound(position, move);
      if (!nextPosition) {
        message = "illegal";
        render();
      } else {
        const { defense } = nextPosition;
        path = defense === null ? [...path, move] : [...path, move, defense];
        updatePosition(nextPosition);
        showRound(before, move, defense);
      }
    }

    function setFocus(square) {
      cells[focus].cell.tabIndex = -1;
      focus = square;
      cells[focus].cell.tabIndex = 0;
    }
    function focusBoard() {
      cells[focus].cell.focus({ preventScroll: true });
    }
    listen(board, "focusin", (event) => {
      if (event.target.matches(".xiangqi-cell"))
        setFocus(Number(event.target.dataset.square));
    });
    listen(board, "focusout", () => {
      board.removeAttribute("data-pointer-entry");
    });

    listen(root, "keydown", (event) => {
      if (paused || signal.aborted) return;
      board.removeAttribute("data-pointer-entry");
      if (event.key === "Escape" && presentation) {
        event.preventDefault();
        event.stopPropagation();
        settle();
        return;
      }
      if (event.key === "Escape" && selected !== null) {
        event.preventDefault();
        event.stopPropagation();
        selected = message = null;
        render();
        return;
      }
      if (!board.contains(event.target)) return;
      const offset = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!Array.isArray(offset)) return;
      event.preventDefault();
      if (presentation) return;
      const x = (focus % rules.columns) + offset[0];
      const y = Math.floor(focus / rules.columns) + offset[1];
      if (x >= 0 && x < rules.columns && y >= 0 && y < rules.rows) {
        setFocus(y * rules.columns + x);
        focusBoard();
      }
    });

    function settle() {
      if (presentation?.waiting) {
        if (paused || document.hidden) presentation.thought.pause();
      } else stopPresentation();
      render();
    }

    function levelLabel(entry, index) {
      return entry.title ?? t("level", { number: index + 1 });
    }

    function render() {
      root.dataset.mode = versus ? "versus" : "puzzles";
      root.dataset.thinking = String(thinking || !!presentation?.waiting);
      root.dataset.plies = String(versus ? path.length : 0);
      root.dataset.category = versus ? "ai" : String(selectedGroup);
      setupTitle.textContent = t("aiVersus");
      difficultyOptions.setAttribute("aria-label", t("aiDifficulty"));
      difficultyButtons.forEach(({ value, control }) => {
        control.textContent = t("ai" + value);
        control.setAttribute("aria-pressed", String(difficulty === value));
      });
      startTitle.textContent = t("aiStartMatch");
      startButtons.forEach(({ red, control }) => {
        control.replaceChildren();
        node(control, "strong", "xiangqi-start-heading").textContent =
          t("aiStartButton");
        node(control, "span", "xiangqi-start-side").textContent = t(
          red ? "aiRed" : "aiBlack",
        );
      });
      versusMode.textContent = t("aiVersus");
      versusMode.setAttribute("aria-pressed", String(versus));
      setup.hidden = !versus || !!level;
      catalog.setReturn(
        !versus && returnLevel
          ? () => start(levels.indexOf(returnLevel), true)
          : null,
      );
      catalog.page.hidden = !!level;
      root.dataset.playing = String(!!level);
      play.hidden = !level;
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
      const warningParent = level ? controls : root;
      if (warning.parentElement !== warningParent)
        warningParent.append(warning);
      if (!level) {
        catalog.refresh();
        catalog.selectCategory(versus ? "ai" : selectedGroup);
        categories.setAttribute("aria-label", t("categories"));
        for (const { group, control, entries } of groups) {
          const active = !versus && group === selectedGroup;
          control.textContent =
            group >= 4
              ? groupLabel(group).replace(/\s*([（(])/u, "\n$1")
              : groupLabel(group);
          control.setAttribute("aria-pressed", String(active));
          entries.hidden = !active;
        }
        levelButtons.forEach((element, index) => {
          const entry = levels[index];
          const { id } = entry;
          WorkTimeApp.games.paintLevelCard(element, {
            number: index + 1,
            text: entry.title,
            label: levelLabel(entry, index),
            complete: Object.hasOwn(save.completed, id),
            draft: !!save.drafts[id]?.path.length,
          });
        });
        return;
      }
      const index = levels.indexOf(level);
      const won = position.status === "won";
      const ended = position.status !== "playing";
      const displayed = presentation?.board ?? position.board;
      const blackTurn =
        !!presentation?.waiting || (versus && !humanTurn() && !ended);
      const active = selected;
      const redTurn = presentation
        ? presentation.black.length > 0
        : path.length % 2 === 0;
      const checkedSquare = rules.checked(displayed, redTurn)
        ? displayed.indexOf(redTurn ? "K" : "k")
        : -1;
      levelTitle.textContent = versus
        ? t("aiVersus") + " · " + t("ai" + difficulty)
        : levelLabel(level, index);
      fastest.hidden = false;
      WorkTimeApp.games.paintDetailNumbers(
        fastest,
        versus
          ? t(humanRed ? "aiRed" : "aiBlack")
          : t("fastest", {
              goal: t("longGoal", { number: level.goal }),
            }),
      );
      WorkTimeApp.games.paintDetailNumbers(
        played,
        t(versus ? "aiPlayed" : "played", {
          played: versus ? path.length : Math.ceil(path.length / 2),
        }),
      );
      const loading = versus && !engineReady && !engineError && !ended;
      status.textContent =
        versus && engineError
          ? t("aiError")
          : loading
            ? t("aiLoading")
            : versus
              ? t(
                  message ??
                    (ended
                      ? won
                        ? "aiWon"
                        : "aiLost"
                      : blackTurn
                        ? humanRed
                          ? "replying"
                          : "redThinking"
                        : checkedSquare !== -1
                          ? "inCheck"
                          : "aiTurn"),
                )
              : t(
                  message ??
                    (blackTurn
                      ? "replying"
                      : ended && !presentation
                        ? won && position.outcome === "stalemate"
                          ? "blackStalemate"
                          : position.status
                        : redTurn && checkedSquare !== -1
                          ? "inCheck"
                          : "turn"),
                );
      thinkingIndicator.toggleAttribute(
        "data-active",
        versus &&
          !ended &&
          !engineError &&
          (loading || thinking || !!presentation?.waiting),
      );
      if (versus)
        thinkingIndicator.dataset.side = loading
          ? path.length % 2 === 0
            ? "red"
            : "black"
          : humanRed
            ? "black"
            : "red";
      else delete thinkingIndicator.dataset.side;
      board.setAttribute("aria-label", t("board"));
      board.toggleAttribute("data-replying", blackTurn);
      for (const [control, name, icon] of [
        [undo, "undo", "undo"],
        [restart, "restart", "restart-alt"],
        [next, "next", "play-arrow"],
        [choose, "choose", "grid-4x4"],
      ]) {
        control.replaceChildren(WorkTimeApp.games.createIcon(icon));
        const label = node(control, "span", "xiangqi-action-label");
        label.textContent = t(name);
        control.setAttribute("aria-label", t(name));
      }
      undo.disabled = path.length <= (versus && !humanRed ? 1 : 0);
      next.hidden =
        versus || !won || !!presentation || index === levels.length - 1;
      if (versus) {
        choose.querySelector("span.xiangqi-action-label").textContent =
          t("aiSettings");
        choose.setAttribute("aria-label", t("aiSettings"));
      }

      const legal = new Set(
        active === null || presentation
          ? []
          : rules
              .destinations(displayed, versus ? humanRed : true, active)
              .map((move) => rules.decode(move)[1]),
      );
      const singleMove = path.length % 2 === 1;
      const red =
        presentation?.red ??
        (path.length ? rules.decode(path.at(singleMove ? -1 : -2)) : []);
      const black =
        presentation?.black ??
        (path.length >= (singleMove ? 3 : 2)
          ? rules.decode(path.at(singleMove ? -2 : -1))
          : []);
      cells.forEach(({ cell, piece }, square) => {
        const occupant = displayed[square];
        const own = rules.side(occupant);
        piece.textContent = glyphs[occupant] ?? "";
        cell.tabIndex = square === focus ? 0 : -1;
        cell.classList.toggle("is-red", own);
        cell.classList.toggle("is-selected", active === square);
        cell.classList.toggle("is-legal", legal.has(square));
        cell.classList.toggle(
          "is-capture",
          legal.has(square) && occupant !== ".",
        );
        cell.classList.toggle(
          "is-last-from",
          red[0] === square || black[0] === square,
        );
        cell.classList.toggle(
          "is-last-to",
          red[1] === square || black[1] === square,
        );
        cell.classList.toggle("is-last-red", red.includes(square));
        cell.classList.toggle("is-check", checkedSquare === square);
        cell.setAttribute("aria-pressed", String(active === square));
        cell.setAttribute(
          "aria-disabled",
          String(ended || !!presentation || thinking),
        );
        cell.setAttribute(
          "aria-label",
          t("square", {
            column: (square % rules.columns) + 1,
            row: Math.floor(square / rules.columns) + 1,
            piece:
              occupant === "."
                ? t("empty")
                : t(own ? "red" : "black", {
                    piece: t("piece" + occupant.toLowerCase()),
                  }),
          }),
        );
      });
      if (path.length < renderedPathLength) renderedPathLength = path.length;
      if (path.length > renderedPathLength) {
        const [from, to] = rules.decode(path.at(-1));
        const movingPiece = cells[to].piece;
        const fromRect = cells[from].cell.getBoundingClientRect();
        const toRect = cells[to].cell.getBoundingClientRect();
        renderedPathLength = path.length;
        if (
          !reduced.matches &&
          typeof movingPiece.animate === "function" &&
          fromRect.width > 0 &&
          toRect.width > 0
        ) {
          movingPiece.animate(
            [
              {
                transform: `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px)`,
              },
              { transform: "translate(0, 0)" },
            ],
            { duration: 240, easing: "cubic-bezier(.2,.75,.25,1)" },
          );
        }
      }
    }
    listen(document, "worktime:languagechange", render);
    listen(window, "blur", settle);
    listen(document, "visibilitychange", () => {
      if (document.hidden) {
        if (versus) cancelSearch(true);
        settle();
      } else if (versus) {
        prepareEngine();
        replyVersus();
      } else presentation?.thought?.resume();
    });
    const unlisten = compat.listen(reduced, settle);
    signal.addEventListener(
      "abort",
      () => {
        stopPresentation();
        cancelSearch(true);
        unlisten();
      },
      { once: true },
    );
    render();
    return {
      pause() {
        paused = true;
        if (versus) cancelSearch(true);
        settle();
      },
      resume() {
        paused = false;
        presentation?.thought?.resume();
        if (versus) {
          prepareEngine();
          replyVersus();
        }
      },
      resize() {
        if (presentation) settle();
      },
      dispose() {
        cancelSearch(true);
        stopPresentation();
        root.remove();
      },
    };
  },
});
