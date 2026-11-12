"use strict";

WorkTimeApp.games.register({
  id: "game-gomoku",
  nameKey: "games.gomoku.name",
  descriptionKey: "games.gomoku.description",
  icon: "game-gomoku",
  create({ container, signal }) {
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    let resultEffect = null;
    const resultImages = Object.fromEntries(
      ["win", "loss", "draw", "solve"].map((outcome) => {
        const image = new Image();
        image.src = "assets/images/gomoku/" + outcome + "-brush.png";
        return [outcome, image];
      }),
    );
    const archive = WorkTimeApp.services.gameArchive;
    let history = null,
      replaySnapshot = null;
    let matchHistory = null,
      matchReplaySnapshot = null;
    const replaying = () => history?.active || matchHistory?.active;
    const storage = archive.session(),
      key = archive.keys["game-gomoku"];
    const rules = WorkTimeApp.games.gomokuRules,
      levels = WorkTimeApp.data.gomoku;
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.gomoku." + name, params);
    let save = { version: 1, current: null, drafts: {}, completed: {} },
      saveFailed = false;
    try {
      const raw = storage.getItem(key);
      if (raw !== null)
        save = archive.normalize("game-gomoku", JSON.parse(raw));
    } catch {
      saveFailed = true;
    }
    let level = levels.find(({ id }) => id === save.current);
    let returnLevel = level ?? (save.match ? { id: "ai", group: "ai" } : null);
    let match = save.match ?? { difficulty: "normal", human: 1, path: [] };
    const engine = WorkTimeApp.games.createGomokuEngine();
    let thinking = false,
      aiFailed = false;
    let thought = null,
      searchGeneration = 0;
    const isMatch = () => level?.id === "ai";
    if (!level && save.match) level = { id: "ai", group: "ai" };
    let state = isMatch()
      ? rules.restoreMatch(match)
      : level
        ? rules.restore(level, save.drafts[level.id].path)
        : null;
    let renderedBoard = state?.board.slice() ?? null;
    save.matchSession ||= archive.newMatchSession();
    if (save.match && rules.restoreMatch(save.match).status !== "playing")
      save.matchSession.recorded = true;
    let group = level?.group ?? "easy",
      focus = state?.path.at(-1) ?? 112,
      paused = false,
      preview = null;
    function node(parent, tag, className) {
      const element = document.createElement(tag);
      element.className = className;
      parent.append(element);
      return element;
    }
    function button(parent, action, callback) {
      const element = node(parent, "button", "game-button");
      element.type = "button";
      element.dataset.gomokuAction = action;
      element.addEventListener(
        "click",
        (event) => {
          if (!paused && !signal.aborted) callback(event.detail === 0);
        },
        { signal },
      );
      return element;
    }
    const root = node(container, "section", "game-gomoku game-session");
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "gomoku-level-page",
      signal,
    );
    const groups = ["easy", "medium", "hard", "ai"].map((name) => ({
      name,
      control: button(catalog.categories, name, () => {
        group = name;
        render();
      }),
      entries: node(catalog.entries, "div", "gomoku-levels game-level-grid"),
    }));
    const categoryDivider = node(
      catalog.categories,
      "div",
      "gomoku-category-divider",
    );
    categoryDivider.setAttribute("role", "separator");
    groups.find((entry) => entry.name === "ai").control.before(categoryDivider);
    const levelButtons = levels.map((entry, index) =>
      button(
        groups.find(({ name }) => name === entry.group).entries,
        entry.id,
        (keyboard) => start(index, keyboard),
      ),
    );
    const setup = groups.find((entry) => entry.name === "ai").entries;
    setup.className = "gomoku-match-setup";
    const setupTitle = node(setup, "h3", "gomoku-level-title");
    let selectedDifficulty = match.difficulty;
    let selectedForbidden = save.forbidden ?? false;
    let forbiddenNotice = null;
    const difficultyOptions = node(setup, "div", "gomoku-difficulties");
    difficultyOptions.setAttribute("role", "group");
    const difficultyButtons = ["normal", "hard", "master"].map(
      (difficulty) => ({
        difficulty,
        control: button(difficultyOptions, "difficulty-" + difficulty, () => {
          selectedDifficulty = difficulty;
          render();
        }),
      }),
    );
    const forbiddenCard = node(setup, "div", "gomoku-forbidden-option");
    const forbiddenLabel = node(forbiddenCard, "label", "gomoku-checkbox");
    const check = node(forbiddenLabel, "span", "gomoku-check");
    const forbidden = node(check, "input");
    forbidden.type = "checkbox";
    forbidden.dataset.gomokuOption = "forbidden";
    forbidden.setAttribute("aria-describedby", "gomoku-forbidden-note");
    check.append(WorkTimeApp.games.createIcon("check"));
    const forbiddenName = node(forbiddenLabel, "span");
    const forbiddenNote = node(forbiddenCard, "p", "gomoku-detail");
    forbiddenNote.id = "gomoku-forbidden-note";
    forbidden.addEventListener(
      "change",
      () => {
        selectedForbidden = forbidden.checked;
        save.forbidden = selectedForbidden;
        persist();
        render();
      },
      { signal },
    );
    const startTitle = node(setup, "h4", "gomoku-start-title");
    const startOptions = node(setup, "div", "gomoku-start-options");
    const startButtons = [1, 2].map((human) => ({
      human,
      control: button(
        startOptions,
        human === 1 ? "start-black" : "start-red",
        (keyboard) => {
          match = {
            difficulty: selectedDifficulty,
            human,
            forbidden: selectedForbidden,
            path: [],
          };
          save.matchSession = archive.newMatchSession();
          openMatch(keyboard);
        },
      ),
    }));
    function openMatch(keyboard) {
      settle();
      level = { id: "ai", group: "ai" };
      returnLevel = level;
      group = "ai";
      state = rules.restoreMatch(match);
      renderedBoard = state.board.slice();
      focus = state.path.at(-1) ?? 112;
      update();
      render();
      scheduleAI();
      if (keyboard) cells[focus].focus();
    }
    const engineName = node(setup, "p", "gomoku-detail");
    const play = node(root, "div", "gomoku-play");
    const stage = node(play, "div", "gomoku-stage");
    const board = node(stage, "div", "gomoku-board");
    board.setAttribute("role", "group");
    const art = node(board, "div", "gomoku-art");
    art.setAttribute("aria-hidden", "true");
    const grid = Array.from(
      { length: 15 },
      (_, i) => `M${i + 0.5} .5v14M.5 ${i + 0.5}h14`,
    ).join("");
    art.innerHTML = `<svg viewBox="0 0 15 15" focusable="false"><path d="${grid}"/>${[48, 56, 112, 168, 176].map((p) => `<circle cx="${(p % 15) + 0.5}" cy="${Math.floor(p / 15) + 0.5}" r=".075"/>`).join("")}</svg>`;
    let hoveredSquare = null;
    const cells = Array.from({ length: 225 }, (_, p) => {
      const cell = node(board, "button", "gomoku-cell");
      cell.type = "button";
      cell.dataset.square = p;
      const stone = node(cell, "span", "gomoku-stone");
      stone.setAttribute("aria-hidden", "true");
      cell.addEventListener(
        "focus",
        () => {
          focus = p;
          updateBlockedHint(p);
        },
        { signal },
      );
      cell.addEventListener(
        "pointerenter",
        () => {
          hoveredSquare = p;
          updateBlockedHint(p);
        },
        { signal },
      );
      cell.addEventListener(
        "pointerleave",
        () => {
          hoveredSquare = null;
        },
        { signal },
      );
      cell.addEventListener("click", () => attempt(p), { signal });
      return cell;
    });
    function updateBlockedHint(p) {
      const reason =
        isMatch() &&
        match.forbidden &&
        match.human === 1 &&
        !paused &&
        !thinking &&
        !preview &&
        state.status === "playing" &&
        state.path.length % 2 === 0 &&
        !state.board[p]
          ? rules.forbiddenReason(state.board, p)
          : null;
      const cell = cells[p];
      if (!reason) {
        delete cell.dataset.forbidden;
        cell.removeAttribute("aria-description");
        return;
      }
      cell.dataset.forbidden = reason;
      cell.setAttribute("aria-description", t(reason));
    }
    const controls = node(play, "div", "gomoku-controls");
    const resultLayer = node(board, "div", "gomoku-result");
    resultLayer.hidden = true;
    resultLayer.setAttribute("aria-hidden", "true");
    const resultFrame = node(resultLayer, "div", "gomoku-result-frame");
    const resultWash = node(resultFrame, "div", "gomoku-result-wash");
    const resultSplash = node(resultFrame, "div", "gomoku-result-splash");
    const resultArt = node(resultFrame, "img", "gomoku-result-art");
    resultArt.alt = "";
    resultArt.draggable = false;
    const objective = node(controls, "div", "gomoku-objective");
    const title = node(objective, "h3", "gomoku-level-title");
    const goalText = node(objective, "p", "gomoku-detail");
    const played = node(objective, "p", "gomoku-detail");
    const feedback = node(controls, "div", "gomoku-feedback");
    const status = node(feedback, "p", "gomoku-status");
    status.setAttribute("role", "status");
    const thinkingIndicator = node(controls, "div", "gomoku-thinking");
    thinkingIndicator.setAttribute("aria-hidden", "true");
    // Material Symbols Rounded Psychology, Apache-2.0; Google revision 737e3324305806514d7909874fa1818ae1808232.
    thinkingIndicator.innerHTML = `<svg class="gomoku-thinking-icon" viewBox="0 -960 960 960" focusable="false">
      <path d="M240-252q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v40q0 17-11.5 28.5T560-80q-17 0-28.5-11.5T520-120v-80q0-17 11.5-28.5T560-240h120v-160q0-17 11.5-28.5T720-440h68l-38-155q-23-91-98-148t-172-57q-116 0-198 81t-82 197q0 60 24.5 114t69.5 96l26 24v168q0 17-11.5 28.5T280-80q-17 0-28.5-11.5T240-120v-132Zm254-188Z" />
      <path class="gomoku-thinking-gear" d="m434-410 4 32q1 8 6.5 13t13.5 5h44q8 0 13.5-5t6.5-13l4-32q8-3 14.5-7t11.5-9l30 13q7 3 14 1t11-9l22-38q4-7 2.5-14t-7.5-12l-26-19q2-8 2-16t-2-16l26-19q6-5 7.5-12t-2.5-14l-22-38q-4-7-11-9t-14 1l-30 13q-5-5-11.5-9t-14.5-7l-4-32q-1-8-6.5-13t-13.5-5h-44q-8 0-13.5 5t-6.5 13l-4 32q-8 3-14.5 7t-11.5 9l-30-13q-7-3-14-1t-11 9l-22 38q-4 7-2.5 14t7.5 12l26 19q-2 8-2 16t2 16l-26 19q-6 5-7.5 12t2.5 14l22 38q4 7 11 9t14-1l30-13q5 5 11.5 9t14.5 7Zm46-50q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460Z" />
    </svg>`;
    const actions = node(controls, "div", "gomoku-actions");
    const undo = button(actions, "undo", (keyboard) => {
      settle();
      if (isMatch()) {
        const path = [...state.path];
        do {
          path.pop();
        } while (path.length && (path.length % 2) + 1 !== match.human);
        match.path = path;
        state = rules.restoreMatch(match);
        renderedBoard = state.board.slice();
        update();
        render();
        scheduleAI();
        if (keyboard) cells[focus].focus();
        return;
      }
      const path = state.path.slice(
        0,
        state.path.length - (state.path.length % 2 ? 1 : 2),
      );
      state = rules.restore(level, path);
      renderedBoard = state.board.slice();
      update();
      render();
      if (keyboard) cells[focus].focus();
    });
    const restart = button(actions, "restart", (keyboard) => {
      if (isMatch()) {
        restartPrompt.open(restart);
        return;
      }
      settle();
      state = rules.create(level);
      renderedBoard = state.board.slice();
      update();
      render();
      scheduleAI();
      if (keyboard) cells[focus].focus();
    });
    const restartPrompt = WorkTimeApp.games.createRestartPrompt({
      host: stage,
      signal,
      onOpen() {
        paused = true;
        settle();
      },
      onCancel() {
        paused = false;
        render();
        scheduleAI();
      },
      onConfirm() {
        paused = false;
        save.matchSession = archive.newMatchSession();
        match.path = [];
        state = rules.restoreMatch(match);
        renderedBoard = state.board.slice();
        update();
        render();
        scheduleAI();
        cells[focus].focus({ preventScroll: true });
      },
    });
    const next = button(actions, "next", (keyboard) =>
      start(levels.indexOf(level) + 1, keyboard),
    );
    actions.prepend(next);
    const choose = button(actions, "choose", () => {
      settle();
      const index = levels.indexOf(level);
      level = null;
      save.current = null;
      persist();
      render();
      if (index < 0)
        groups.find((entry) => entry.name === "ai").control.focus();
      else levelButtons[index].focus();
    });
    const warning = node(root, "p", "gomoku-warning");
    warning.setAttribute("role", "status");
    function persist() {
      if (replaying()) return;
      try {
        storage.setItem(key, JSON.stringify(save));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }
    function update(record = false) {
      if (replaying()) return;
      if (isMatch()) {
        match.path = [...state.path];
        save.match = { ...match, path: [...match.path] };
        if (["won", "lost"].includes(state.status))
          archive.recordMatch(save, "game-gomoku", match, state.path);
        save.current = null;
        persist();
        return;
      }
      if (state.status === "won") {
        if (record) archive.addCompletion(save, level.id, state.path);
        save.completed[level.id] ??= { path: [...state.path] };
        delete save.drafts[level.id];
        save.current = null;
      } else {
        save.drafts[level.id] = { path: [...state.path] };
        save.current = level.id;
      }
      persist();
    }
    function settle() {
      forbiddenNotice = null;
      searchGeneration++;
      thought?.cancel();
      thought = null;
      clearResult();
      engine.cancel();
      thinking = false;
      preview = null;
      board.removeAttribute("data-replying");
    }
    function thinkFor(board) {
      return WorkTimeApp.games.createThinkTurn({
        simple:
          board.filter(Boolean).length < 4 ||
          board.filter((stone) => !stone).length === 1 ||
          rules.threats(board, 1, isMatch() && match.forbidden).length > 0 ||
          rules.threats(board, 2, isMatch() && match.forbidden).length > 0,
        advanced: isMatch()
          ? match.difficulty !== "normal"
          : level.group === "hard",
      });
    }
    function clearResult() {
      const effect = resultEffect;
      resultEffect = null;
      clearTimeout(effect?.timer);
      effect?.decode?.cancel();
      effect?.animations.forEach((animation) => animation.cancel());
      resultLayer.hidden = true;
      delete resultLayer.dataset.result;
    }
    function showResult() {
      if (replaying()) return;
      if (
        paused ||
        signal.aborted ||
        document.hidden ||
        preview ||
        !level ||
        state.status === "playing"
      )
        return;
      clearResult();
      const outcome =
        state.status === "won"
          ? isMatch()
            ? "win"
            : "solve"
          : state.status === "lost"
            ? "loss"
            : "draw";
      const effect = { animations: [], decode: null, timer: null };
      resultEffect = effect;
      resultArt.src = resultImages[outcome].src;
      effect.decode = compat.decode(resultArt);
      effect.decode.finished.then(() => {
        if (resultEffect !== effect) return;
        if (
          paused ||
          signal.aborted ||
          document.hidden ||
          !resultArt.naturalWidth
        ) {
          clearResult();
          return;
        }
        resultLayer.dataset.result = outcome;
        resultLayer.hidden = false;
        const animated =
          !reduced.matches && typeof resultArt.animate === "function";
        resultWash.hidden = resultSplash.hidden = !animated;
        if (animated) {
          const track = (element, frames, duration, delay = 0) =>
            effect.animations.push(
              compat.animate(element, frames, {
                duration,
                delay,
                fill: "both",
                easing: "ease-in-out",
              }),
            );
          track(
            resultArt,
            [
              { opacity: 0, transform: "scale(1.06)", offset: 0 },
              { opacity: 1, transform: "scale(1)", offset: 400 / 2200 },
              { opacity: 1, transform: "scale(1)", offset: 1700 / 2200 },
              { opacity: 0, transform: "scale(1)", offset: 1 },
            ],
            2200,
          );
          track(
            resultWash,
            [
              { opacity: 0, transform: "scale(.82)", offset: 0 },
              { opacity: 0.35, transform: "scale(.94)", offset: 0.3 },
              { opacity: 0.2, transform: "scale(1)", offset: 0.7 },
              { opacity: 0, transform: "scale(1.06)", offset: 1 },
            ],
            2100,
          );
          track(
            resultSplash,
            [
              { opacity: 0, transform: "scale(.9)", offset: 0 },
              { opacity: 0.15, transform: "scale(.98)", offset: 0.35 },
              { opacity: 0, transform: "scale(1.04)", offset: 1 },
            ],
            1600,
            150,
          );
        }
        effect.timer = setTimeout(
          () => {
            if (resultEffect === effect) clearResult();
          },
          animated ? 2200 : 1800,
        );
      });
    }
    function start(index, keyboard) {
      if (!levels[index]) return;
      settle();
      level = levels[index];
      returnLevel = level;
      group = level.group;
      state = rules.restore(level, save.drafts[level.id]?.path ?? []);
      renderedBoard = state.board.slice();
      focus = 112;
      update();
      render();
      if (keyboard) cells[focus].focus();
    }
    function attempt(p) {
      if (paused || signal.aborted || preview || thinking || !level) return;
      if (isMatch()) {
        if (
          state.status !== "playing" ||
          (state.path.length % 2) + 1 !== match.human ||
          state.board[p]
        )
          return;
        const reason =
          match.forbidden && match.human === 1
            ? rules.forbiddenReason(state.board, p)
            : null;
        if (reason) {
          forbiddenNotice = reason;
          render();
          return;
        }
        forbiddenNotice = null;
        state = rules.restoreMatch({ ...match, path: [...state.path, p] });
        focus = p;
        update();
        render();
        scheduleAI();
        showResult();
        return;
      }
      const black = rules.placeStone(state, p, 1);
      if (!black) return;
      focus = p;
      const white =
        black.status === "playing" ? rules.puzzleReply(level, black) : null;
      if (black.status === "playing" && white == null) {
        state = black;
        searchPuzzleReply();
        return;
      }
      state = white == null ? black : rules.placeStone(black, white, 2);
      update(true);
      if (white != null) {
        preview = black.board;
        const generation = searchGeneration;
        thought = thinkFor(preview);
        thought.wait(() => {
          if (generation !== searchGeneration || paused || signal.aborted)
            return;
          thought = null;
          preview = null;
          render();
          showResult();
        });
      }
      render();
      if (!preview) showResult();
    }
    function afterStonePaint() {
      // Let the board paint before a cold engine can occupy the main thread.
      return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }
    async function searchPuzzleReply() {
      if (replaying() || paused || document.hidden || signal.aborted) return;
      const generation = searchGeneration;
      const position = state;
      thinking = true;
      thought = thinkFor(position.board);
      render();
      await afterStonePaint();
      if (generation !== searchGeneration || signal.aborted) return;
      // Bound worker startup as well as the search so offline play can continue.
      const deadline = setTimeout(() => engine.cancel(), 4000);
      let white;
      try {
        ({ move: white } = await engine.search(position, "hard", level.board));
      } catch {
        // Use the local tactical defense if the engine is unavailable.
      } finally {
        clearTimeout(deadline);
      }
      if (generation !== searchGeneration || signal.aborted) return;
      thought.wait(() => {
        if (generation !== searchGeneration || paused || signal.aborted) return;
        const reply = white ?? rules.vctFallbackReply(level, position);
        state = rules.placeStone(position, reply, 2);
        thought = null;
        thinking = false;
        update();
        render();
        showResult();
      });
    }
    async function scheduleAI() {
      if (replaying()) return;
      if (restartPrompt.isOpen()) return;
      if (
        !isMatch() ||
        paused ||
        document.hidden ||
        signal.aborted ||
        thinking ||
        state.status !== "playing" ||
        (state.path.length % 2) + 1 === match.human
      )
        return;
      aiFailed = false;
      thinking = true;
      const generation = searchGeneration;
      const wins = rules.threats(state.board, 3 - match.human, match.forbidden);
      const blocks = rules.threats(state.board, match.human, match.forbidden);
      const forced =
        wins[0] ??
        (blocks.length === 1 &&
        rules.legalMove(
          state.board,
          blocks[0],
          3 - match.human,
          match.forbidden,
        )
          ? blocks[0]
          : null);
      const quick = forced !== null || state.path.length === 1;
      thought = quick ? null : thinkFor(state.board);
      render();
      await afterStonePaint();
      if (generation !== searchGeneration || paused || signal.aborted) return;
      try {
        if (forced !== null) {
          // Keep decisive replies brisk while leaving a short, natural pause.
          await new Promise((resolve) =>
            setTimeout(resolve, 220 + Math.random() * 130),
          );
        }
        const p =
          forced ??
          (
            await engine.search(
              state,
              match.difficulty,
              undefined,
              match.forbidden,
            )
          ).move;
        if (generation !== searchGeneration || paused || signal.aborted) return;
        const nextState = rules.restoreMatch({
          ...match,
          path: [...state.path, p],
        });
        if (!nextState) throw Error("Invalid AI move");
        const finish = () => {
          thought = null;
          thinking = false;
          state = nextState;
          update();
          render();
          showResult();
        };
        if (thought) thought.wait(finish);
        else finish();
      } catch {
        if (generation !== searchGeneration || signal.aborted) return;
        settle();
        aiFailed = true;
        render();
      }
    }
    function render() {
      history?.render();
      matchHistory?.render();
      root.dataset.category = group;
      catalog.setReturn(
        returnLevel
          ? () =>
              returnLevel.id === "ai"
                ? openMatch(true)
                : start(levels.indexOf(returnLevel), true)
          : null,
      );
      catalog.page.hidden = !!level;
      play.hidden = !level;
      root.dataset.playing = String(!!level);
      warning.hidden = !saveFailed && !forbiddenNotice;
      warning.textContent = forbiddenNotice
        ? t(forbiddenNotice)
        : t("saveFailed");
      (level ? feedback : root).append(warning);
      if (!level) {
        setupTitle.textContent = t("ai");
        forbidden.checked = selectedForbidden;
        forbiddenName.textContent = t("forbidden");
        forbiddenNote.textContent = t("forbiddenNote");
        engineName.textContent = t("engineName");
        difficultyOptions.setAttribute("aria-label", t("difficulty"));
        difficultyButtons.forEach(({ difficulty, control }) => {
          control.textContent = t("ai" + difficulty);
          control.setAttribute(
            "aria-pressed",
            String(selectedDifficulty === difficulty),
          );
        });
        startTitle.textContent = t("startMatch");
        startButtons.forEach(({ human, control }) => {
          control.replaceChildren();
          const heading = node(control, "strong", "gomoku-start-heading");
          heading.textContent = t("start");
          const side = node(control, "span", "gomoku-start-side");
          side.textContent = t(human === 1 ? "first" : "second");
        });
        catalog.refresh();
        catalog.selectCategory(group);
        catalog.categories.setAttribute("aria-label", t("categories"));
        for (const entry of groups) {
          entry.control.textContent = t(entry.name);
          entry.control.setAttribute(
            "aria-pressed",
            String(entry.name === group),
          );
          entry.entries.hidden = entry.name !== group;
        }
        levelButtons.forEach((control, index) =>
          WorkTimeApp.games.paintLevelCard(control, {
            number: index + 1,
            label: t("level", { number: index + 1 }),
            complete: Object.hasOwn(save.completed, levels[index].id),
            draft: !!save.drafts[levels[index].id]?.path.length,
          }),
        );
        return;
      }
      title.textContent = t("level", { number: levels.indexOf(level) + 1 });
      WorkTimeApp.games.paintDetailNumbers(
        goalText,
        t(level.vct ? "vctObjective" : "objective", {
          goal: level.goal,
        }),
      );
      WorkTimeApp.games.paintDetailNumbers(
        played,
        t("played", {
          played: Math.ceil(state.path.length / 2),
        }),
      );
      status.textContent = t(
        preview || thinking
          ? "replying"
          : state.status === "playing"
            ? "turn"
            : state.status,
      );
      if (isMatch()) {
        title.textContent = t("ai") + " · " + t("ai" + match.difficulty);
        goalText.textContent =
          t(match.human === 1 ? "first" : "second") +
          " · " +
          t(match.forbidden ? "forbidden" : "freestyle");
        played.textContent = t("matchPlayed", { played: state.path.length });
        status.textContent = t(
          aiFailed
            ? "aiFailed"
            : thinking
              ? match.human === 1
                ? "replying"
                : "blackThinking"
              : state.status === "playing"
                ? "matchTurn"
                : "match" + state.status,
        );
      }
      thinkingIndicator.dataset.side =
        isMatch() && match.human === 2 ? "black" : "white";
      thinkingIndicator.toggleAttribute(
        "data-active",
        !paused && !aiFailed && (thinking || !!preview),
      );
      for (const [control, name, icon] of [
        [undo, "undo", "undo"],
        [restart, "restart", "restart-alt"],
        [next, "next", "play-arrow"],
        [choose, "choose", "grid-4x4"],
      ]) {
        control.replaceChildren(WorkTimeApp.games.createIcon(icon));
        const label = node(control, "span", "gomoku-action-label");
        label.textContent = t(name);
        control.setAttribute("aria-label", t(name));
      }
      undo.disabled =
        state.path.length <= (isMatch() && match.human === 2 ? 1 : 0);
      next.hidden =
        isMatch() ||
        state.status !== "won" ||
        !!preview ||
        level === levels.at(-1);
      board.setAttribute(
        "aria-label",
        isMatch()
          ? t("ai") + " · " + t(match.human === 1 ? "first" : "second")
          : t("board"),
      );
      board.toggleAttribute("data-replying", !!preview || thinking);
      const displayed = preview ?? state.board;
      const previousBoard = renderedBoard;
      cells.forEach((cell, p) => {
        cell.dataset.stone = displayed[p];
        delete cell.dataset.forbidden;
        cell.removeAttribute("aria-description");
        if (
          previousBoard &&
          previousBoard[p] === 0 &&
          displayed[p] !== 0 &&
          !reduced.matches
        ) {
          const stone = cell.querySelector(".gomoku-stone");
          if (typeof stone?.animate === "function")
            stone.animate(
              [
                { transform: "scale(.86)" },
                { transform: "scale(1.04)", offset: 0.72 },
                { transform: "scale(1)" },
              ],
              { duration: 140, easing: "cubic-bezier(.2,.75,.25,1)" },
            );
        }
        cell.tabIndex = focus === p ? 0 : -1;
        cell.classList.toggle(
          "is-last",
          (preview ? state.path.at(-2) : state.path.at(-1)) === p,
        );
        cell.classList.toggle("is-winning", !preview && state.line.includes(p));
        cell.setAttribute(
          "aria-disabled",
          String(
            !!displayed[p] ||
              !!preview ||
              thinking ||
              (isMatch() && (state.path.length % 2) + 1 !== match.human) ||
              state.status !== "playing",
          ),
        );
        cell.setAttribute(
          "aria-label",
          t("square", {
            row: Math.floor(p / 15) + 1,
            column: (p % 15) + 1,
            piece: t(
              displayed[p] === 1
                ? "black"
                : displayed[p] === 2
                  ? "white"
                  : "empty",
            ),
          }),
        );
      });
      for (const p of new Set([focus, hoveredSquare]))
        if (p !== null) updateBlockedHint(p);
      renderedBoard = displayed.slice();
    }
    board.addEventListener(
      "keydown",
      (event) => {
        if (paused || signal.aborted) return;
        const offset = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!offset) return;
        event.preventDefault();
        const x = Math.max(0, Math.min(14, (focus % 15) + offset[0]));
        const y = Math.max(0, Math.min(14, Math.floor(focus / 15) + offset[1]));
        cells[focus].tabIndex = -1;
        focus = y * 15 + x;
        cells[focus].tabIndex = 0;
        cells[focus].focus();
      },
      { signal },
    );
    document.addEventListener("worktime:languagechange", render, { signal });
    const unlistenResult = compat.listen(reduced, clearResult);
    signal.addEventListener("abort", unlistenResult, { once: true });
    signal.addEventListener("abort", settle, { once: true });
    matchHistory = WorkTimeApp.games.createCompletionHistory({
      root,
      host: catalog.categories,
      playbackHost: controls,
      kind: "match",
      signal,
      records: () => save.matchHistory ?? [],
      title: (record, date) =>
        WorkTimeApp.games.matchRecordTitle("game-gomoku", record, date),
      onStart(record) {
        matchReplaySnapshot = {
          state,
          focus,
          level,
          returnLevel,
          group,
          match,
        };
        settle();
        match = { ...record.config, path: [] };
        level = { id: "ai", group: "ai" };
        group = "ai";
      },
      onFrame(path) {
        state = rules.restoreMatch({ ...match, path });
        render();
      },
      onExit() {
        ({ state, focus, level, returnLevel, group, match } =
          matchReplaySnapshot);
        matchReplaySnapshot = null;
        renderedBoard = state?.board.slice() ?? null;
        render();
        if (level) scheduleAI();
      },
    });
    history = WorkTimeApp.games.createCompletionHistory({
      root,
      host: controls,
      before: actions,
      signal,
      records: () =>
        !level || isMatch() ? null : (save.completionHistory?.[level.id] ?? []),
      steps: (path) => Math.ceil(path.length / 2),
      onStart() {
        replaySnapshot = { state, focus };
        settle();
      },
      onFrame(path) {
        state = rules.create(level);
        path.forEach((p, index) => {
          state = rules.placeStone(state, p, (index % 2) + 1);
        });
        render();
      },
      onExit() {
        ({ state, focus } = replaySnapshot);
        replaySnapshot = null;
        render();
        if (
          !paused &&
          !document.hidden &&
          state.status === "playing" &&
          state.path.length % 2
        )
          searchPuzzleReply();
      },
    });
    render();
    return {
      pause() {
        history.pause();
        matchHistory.pause();
        paused = true;
        if (isMatch()) settle();
        else {
          thought?.pause();
          clearResult();
        }
        render();
      },
      resume() {
        paused = false;
        thought?.resume();
        scheduleAI();
      },
      dispose() {
        history.dispose();
        matchHistory.dispose();
        settle();
        root.remove();
      },
    };
  },
});
