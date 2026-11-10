"use strict";
WorkTimeApp.games.register({
  id: "game-sudoku",
  nameKey: "games.sudoku.name",
  descriptionKey: "games.sudoku.description",
  icon: "game-sudoku",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.sudokuRules;
    const celebration = WorkTimeApp.games.createCelebration(signal);
    // Keep the four classic difficulties first; lead the variants with Killer.
    const categoryOrder = new Map(
      [
        "easy",
        "medium",
        "hard",
        "expert",
        "killer",
        "kropki",
        "arrow",
        "whispers",
        "renban",
        "thermo",
        "antiKnight",
        "jigsaw",
        "sandwich",
        "xsums",
        "skyscraper",
        "parity",
        "inequality",
        "extraRegion",
        "palindrome",
        "quadSum",
        "windmill",
        "flower",
        "triple",
        "tenBox",
      ].map((id, index) => [id, index]),
    );
    const groups = [...WorkTimeApp.data.sudoku.groups].sort(
      (a, b) =>
        (categoryOrder.get(a.id) ?? categoryOrder.size) -
        (categoryOrder.get(b.id) ?? categoryOrder.size),
    );
    const key = "worktime.games.sudoku.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.sudoku." + name, params);
    const groupPuzzles = (group) => [
      ...group.puzzles,
      ...(group.legacyPuzzles || []),
    ];
    const puzzles = new Map(
      groups.flatMap((g) => groupPuzzles(g).map((p) => [p.id, p])),
    );
    let drafts = {},
      completed = {},
      selectedGroup = groups[0].id,
      current = null,
      state = null;
    let selected = 0,
      pencil = false,
      choosing = true,
      manualPaused = false;
    let suspended = false,
      disposed = false,
      confirming = false,
      saveFailed = false;
    let timer = null,
      started = null;
    let replay = null,
      replayTimer = null;
    let availableSize = null;
    try {
      const saved = JSON.parse(gameStorage.getItem(key));
      if (saved?.version === 1) {
        for (const [id, puzzle] of puzzles) {
          const draft = rules.restore(puzzle, saved.drafts?.[id]);
          if (draft) {
            const log = saved.drafts[id].replay;
            if (!rules.won(puzzle, draft))
              draft.replay =
                log === null
                  ? null
                  : rules.restoreReplay(puzzle, log, draft) ||
                    rules.startReplay(puzzle, draft);
            drafts[id] = draft;
          }
          const record = saved.completed?.[id];
          if (
            record &&
            Number.isFinite(record.elapsed) &&
            record.elapsed >= 0 &&
            record.elapsed <= 315360000 &&
            Number.isInteger(record.hints) &&
            record.hints >= 0 &&
            record.hints <= 1000000
          ) {
            const log = rules.restoreReplay(puzzle, record.replay);
            completed[id] = { elapsed: record.elapsed, hints: record.hints };
            if (log) completed[id].replay = log;
          }
        }
        if (groups.some((g) => g.id === saved.group))
          selectedGroup = saved.group;
        const puzzle = puzzles.get(saved.current);
        const group = groups.find((g) => groupPuzzles(g).includes(puzzle));
        if (puzzle && drafts[puzzle.id]) {
          current = puzzle;
          state = drafts[puzzle.id];
          selected = firstCell();
          selectedGroup = group.id;
          choosing = false;
          manualPaused = true;
        }
      }
    } catch {
      saveFailed = true;
    }
    function node(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    }
    const listen = (target, event, callback) =>
      target.addEventListener(event, callback, { signal });
    const root = node("section", "game-sudoku game-session", container);
    const hud = node("div", "sudoku-hud game-hud", root);
    const title = node("h3", "game-title", hud);
    const sessionMeta = node("div", "sudoku-session-meta", hud);
    const timerBox = node("span", "sudoku-time");
    const timerLabel = node("span", "game-sr-only", timerBox);
    const timerValue = node("strong", "", timerBox);
    function button(parent, action, callback) {
      const b = node("button", "game-button", parent);
      b.type = "button";
      b.dataset.sudokuAction = action;
      listen(b, "click", () => {
        if (!disposed && !signal.aborted && !suspended) callback();
      });
      return b;
    }
    const pause = button(sessionMeta, "pause", () => {
      manualPaused = !manualPaused;
      syncClock();
      save();
      render();
      if (!manualPaused) cells[selected].focus();
    });
    const choose = button(sessionMeta, "choose", () => {
      paintPauseCover.reset();
      choosing = true;
      celebration.stop();
      syncClock();
      save();
      render();
      groupButtons.get(selectedGroup).focus();
    });
    const restart = button(sessionMeta, "restart", () => {
      confirming = true;
      celebration.stop();
      syncClock();
      render();
      cancel.focus();
    });
    const menuReplay = button(sessionMeta, "menu-replay", () =>
      openReplay(menuReplay),
    );
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "sudoku-level-page",
      signal,
    );
    catalog.page.classList.add("sudoku-catalog");
    const categoryList = catalog.categories;
    categoryList.classList.add("sudoku-categories");
    categoryList.setAttribute("role", "group");
    const difficulties = node("div", "sudoku-difficulties", categoryList);
    const variants = node("div", "sudoku-variants", categoryList);
    const multiVariants = node(
      "div",
      "sudoku-variants sudoku-multi-variants",
      categoryList,
    );
    const groupButtons = new Map(
      groups.map((group, index) => {
        const parent =
          index < 4
            ? difficulties
            : group.puzzles[0]?.grids || group.puzzles[0]?.tenBox
              ? multiVariants
              : variants;
        const b = button(parent, group.id, () => {
          selectedGroup = group.id;
          save();
          render();
        });
        return [group.id, b];
      }),
    );
    const levels = node(
      "div",
      "sudoku-levels game-level-grid",
      catalog.entries,
    );
    const levelButtons = Array.from(
      { length: Math.max(...groups.map((group) => group.puzzles.length)) },
      (_, i) =>
        button(levels, "level-" + (i + 1), () =>
          open(groups.find((g) => g.id === selectedGroup).puzzles[i]),
        ),
    );
    const play = node("div", "sudoku-play", root);
    play.append(hud);
    const tools = node("div", "sudoku-tools", play);
    const zoom = button(tools, "zoom", () => {
      field.classList.toggle("is-zoomed");
      zoom.textContent = t(
        field.classList.contains("is-zoomed") ? "zoomOut" : "zoomIn",
      );
      zoom.setAttribute(
        "aria-pressed",
        String(field.classList.contains("is-zoomed")),
      );
      if (field.classList.contains("is-zoomed"))
        cells[selected].scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    zoom.classList.add("sudoku-zoom");
    const stage = node("div", "sudoku-stage", play);
    const field = node("div", "sudoku-field", stage);
    const board = node("div", "sudoku-board", field);
    board.setAttribute("role", "group");
    const clueStrips = ["top", "left", "bottom", "right"].map((side) =>
      node("div", "sudoku-sky-clues sudoku-sky-" + side, field),
    );
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 90 90");
    svg.classList.add("sudoku-thermos");
    svg.setAttribute("aria-hidden", "true");
    board.append(svg);
    const overlay = document.createElementNS(svg.namespaceURI, "svg");
    overlay.setAttribute("viewBox", "0 0 90 90");
    overlay.classList.add("sudoku-variant-overlay");
    overlay.setAttribute("aria-hidden", "true");
    board.append(overlay);
    let cells = [];
    const cellPool = [];
    const cellViews = [];
    let cellLayout = "";
    let blockedCells = [];
    function buildCells() {
      const signature = JSON.stringify(
        current?.tenBox ? "tenBox" : current?.grids || [[0, 0]],
      );
      if (signature === cellLayout) return;
      cellLayout = signature;
      cells.forEach((cell) => cell.remove());
      blockedCells.forEach((cell) => cell.remove());
      blockedCells = [];
      const grid = current ? rules.layout(current) : rules.layout({});
      board.style.gridTemplateColumns = `repeat(${grid.width}, minmax(0, 1fr))`;
      board.style.gridTemplateRows = `repeat(${grid.height}, minmax(0, 1fr))`;
      board.style.aspectRatio = `${grid.width} / ${grid.height}`;
      board.classList.toggle("is-multi", !!(current?.grids || current?.tenBox));
      field.classList.toggle("is-multi", !!(current?.grids || current?.tenBox));
      field.classList.remove("is-zoomed");
      board.style.setProperty("--sudoku-columns", grid.width);
      for (const layer of [svg, overlay]) {
        layer.setAttribute("preserveAspectRatio", "xMidYMid meet");
        layer.setAttribute(
          "viewBox",
          `0 0 ${grid.width * 10} ${grid.height * 10}`,
        );
      }
      // Keep one bounded pool across shapes, and insert the board in one batch.
      const fragment = document.createDocumentFragment();
      cells = Array.from({ length: grid.positions.length }, (_, index) => {
        let cell = cellPool[index];
        if (!cell) {
          cell = button(fragment, "cell-" + index, () => {
            selected = index;
            renderBoard();
          });
          cell.className = "sudoku-cell";
          cell.dataset.cell = index;
          cellViews[index] = {
            digit: node("span", "sudoku-digit", cell),
            notes: node("span", "sudoku-notes", cell),
            noteMask: 0,
            noteDigits: null,
          };
          listen(cell, "focus", () => {
            if (selected !== index) {
              selected = index;
              renderBoard();
            }
          });
          listen(cell, "contextmenu", (event) => {
            event.preventDefault();
            if (!canInput()) return;
            selected = index;
            cell.focus({ preventScroll: true });
            renderBoard();
            input(0);
          });
          cellPool[index] = cell;
        }
        const [r, c] = grid.positions[index];
        cell.style.gridRow = r + 1;
        cell.style.gridColumn = c + 1;
        fragment.append(cell);
        return cell;
      });
      if (current?.tenBox) {
        const occupied = new Set(grid.positions.map((pos) => pos.join(",")));
        for (let r = 0; r < 10; r++)
          for (let c = 0; c < 10; c++)
            if (!occupied.has([r, c].join(","))) {
              const hole = node("span", "sudoku-blocked", fragment);
              hole.style.gridRow = r + 1;
              hole.style.gridColumn = c + 1;
              hole.setAttribute("aria-hidden", "true");
              blockedCells.push(hole);
            }
      }
      board.append(fragment);
    }
    const cover = node("div", "sudoku-cover", stage);
    const paintPauseCover = WorkTimeApp.games.createPauseCover(cover, signal);
    const coverTitle = node("h3", "", cover);
    const coverDescription = node("p", "", cover);
    const coverActions = node("div", "sudoku-cover-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirming = false;
      syncClock();
      render();
      restart.focus();
    });
    const accept = button(coverActions, "accept", () => {
      if (confirming) {
        state = fresh(current);
        drafts[current.id] = state;
        confirming = false;
        manualPaused = false;
        selected = firstCell();
      } else if (isWon()) {
        next();
        return;
      } else manualPaused = false;
      syncClock();
      save();
      render();
      cells[selected].focus();
    });
    const coverReplay = button(coverActions, "replay", () =>
      openReplay(coverReplay),
    );
    const paintRestartCover = WorkTimeApp.games.createRestartCover({
      cover: cover,
      cancel: cancel,
      accept: accept,
      signal,
    });
    const actions = node("div", "sudoku-actions", tools);
    tools.prepend(actions);
    const undo = button(actions, "undo", undoEdit);
    const notes = button(actions, "notes", () => {
      pencil = !pencil;
      render();
    });
    const erase = button(actions, "erase", () => input(0));
    const keypad = node("div", "sudoku-keypad", tools);
    const digits = Array.from({ length: 9 }, (_, i) => {
      const b = button(keypad, "digit-" + (i + 1), () => input(i + 1));
      b.textContent = i + 1;
      return b;
    });
    play.append(stage, tools);
    tools.append(keypad, actions);
    const replayPanel = node("section", "sudoku-replay", tools);
    const replayTitle = node("h4", "", replayPanel);
    const replayProgress = node("p", "", replayPanel);
    const replayBase = node("p", "", replayPanel);
    const replayActions = node("div", "sudoku-replay-actions", replayPanel);
    const replayToggle = button(replayActions, "replay-toggle", () => {
      if (replayTimer === null) playReplay();
      else pauseReplay();
    });
    const replayPrevious = button(replayActions, "replay-previous", () => {
      pauseReplay();
      seekReplay(replay.step - 1);
    });
    const replayNext = button(replayActions, "replay-next", () => {
      pauseReplay();
      seekReplay(replay.step + 1);
    });
    const replayRestart = button(replayActions, "replay-restart", () => {
      pauseReplay();
      seekReplay(0);
      playReplay();
    });
    const replayExit = button(replayActions, "replay-exit", closeReplay);
    const ruleText = node("p", "sudoku-rule", play);
    const feedback = node("p", "sudoku-feedback", root);
    feedback.setAttribute("role", "status");
    for (const control of [choose, restart, menuReplay])
      control.classList.add("game-icon-button");
    function labelButton(element, label, icon) {
      element.replaceChildren(WorkTimeApp.games.createIcon(icon));
      const text = node("span", "sudoku-action-label", element);
      text.textContent = label;
      if (element.classList.contains("game-icon-button"))
        text.classList.add("game-sr-only");
      element.title = element.classList.contains("game-icon-button")
        ? label
        : "";
      element.setAttribute("aria-label", label);
    }
    const isWon = () => !!state && rules.won(current, state);
    function canInput() {
      return (
        !!state &&
        !replay &&
        !choosing &&
        !manualPaused &&
        !suspended &&
        !confirming &&
        !disposed &&
        !signal.aborted &&
        !isWon()
      );
    }
    function settle() {
      if (started !== null && state)
        state.elapsed += (performance.now() - started) / 1000;
      started = null;
    }
    function syncClock() {
      settle();
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (canInput()) {
        started = performance.now();
        timer = window.setInterval(() => {
          settle();
          started = performance.now();
          paintMeters();
          save();
        }, 1000);
      }
    }
    function save() {
      if (current && state) drafts[current.id] = state;
      try {
        const clean = Object.fromEntries(
          Object.entries(drafts).map(([id, draft]) => [
            id,
            {
              values: draft.values,
              notes: draft.notes,
              elapsed: draft.elapsed,
              hints: draft.hints,
              replay: draft.replay,
            },
          ]),
        );
        gameStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            group: selectedGroup,
            current: current?.id,
            drafts: clean,
            completed,
          }),
        );
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      feedback.textContent = t(saveFailed ? "saveFailed" : "saved");
      feedback.hidden = !saveFailed;
    }
    function fresh(puzzle) {
      const draft = rules.create(puzzle);
      draft.replay = rules.startReplay(puzzle, draft);
      return draft;
    }
    function firstCell() {
      return Math.max(0, current.givens.indexOf("0"));
    }
    function open(puzzle) {
      paintPauseCover.reset();
      celebration.stop();
      settle();
      if (current) drafts[current.id] = state;
      current = puzzle;
      state = drafts[puzzle.id] || fresh(puzzle);
      drafts[puzzle.id] = state;
      selected = firstCell();
      choosing = false;
      manualPaused = false;
      confirming = false;
      drawThermos();
      syncClock();
      save();
      render();
      cells[selected].focus({ preventScroll: true });
    }
    function next() {
      celebration.stop();
      const groupIndex = groups.findIndex((g) =>
        groupPuzzles(g).includes(current),
      );
      const group = groups[groupIndex],
        index = group.puzzles.indexOf(current);
      if (index < group.puzzles.length - 1) open(group.puzzles[index + 1]);
      else {
        choosing = true;
        selectedGroup = groups[Math.min(groupIndex + 1, groups.length - 1)].id;
        syncClock();
        save();
        render();
        groupButtons.get(selectedGroup).focus();
      }
    }
    function input(digit) {
      if (canInput() && rules.enter(current, state, selected, digit, pencil))
        changed(selected, digit, pencil);
    }
    function undoEdit() {
      if (!canInput() || !rules.undo(state)) return;
      changed();
    }
    function changed(index, digit, usePencil) {
      state.replay = rules.recordEdit(state.replay, index, digit, usePencil);
      settle();
      const won = isWon();
      if (won) {
        const record = completed[current.id];
        // Preserve how assisted attempts from older saves rank.
        if (
          !record ||
          state.hints < record.hints ||
          (state.hints === record.hints && state.elapsed < record.elapsed)
        )
          completed[current.id] = {
            elapsed: state.elapsed,
            hints: state.hints,
            replay: record?.replay,
          };
        if (state.replay)
          completed[current.id].replay = {
            ...state.replay,
            finishedAt: Date.now(),
          };
        delete state.replay;
      }
      syncClock();
      save();
      render();
      if (won) {
        celebration.play(container.closest(".game-shell") || container);
        accept.focus();
      }
    }
    function openReplay(returnFocus) {
      const log = completed[current?.id]?.replay;
      if (!log) return;
      celebration.stop();
      replay = {
        log,
        board: rules.replayStart(current, log),
        step: 0,
        total: log.moves.length / 3,
        returnFocus,
      };
      syncClock();
      render();
      playReplay();
      replayToggle.focus({ preventScroll: true });
    }
    function paintReplay() {
      if (!replay) return;
      const focused = document.activeElement;
      replayProgress.textContent = t("replayProgress", {
        step: replay.step,
        total: replay.total,
      });
      replayToggle.textContent = t(
        replayTimer !== null ? "pause" : replay.step ? "resume" : "replayPlay",
      );
      replayToggle.disabled = replay.step === replay.total;
      replayPrevious.disabled = replay.step === 0;
      replayNext.disabled = replay.step === replay.total;
      if (
        (focused === replayToggle ||
          focused === replayPrevious ||
          focused === replayNext) &&
        focused.disabled
      )
        (replay.step === replay.total ? replayPrevious : replayNext).focus({
          preventScroll: true,
        });
    }
    function pauseReplay() {
      if (replayTimer !== null) window.clearInterval(replayTimer);
      replayTimer = null;
      paintReplay();
    }
    function seekReplay(step) {
      if (step < 0 || step > replay.total) return;
      if (step < replay.step) {
        replay.board = rules.replayStart(current, replay.log);
        replay.step = 0;
      }
      while (replay.step < step)
        rules.replayStep(
          current,
          replay.board,
          replay.log.moves,
          replay.step++,
        );
      if (replay.step === replay.total) pauseReplay();
      renderBoard();
      paintReplay();
    }
    function playReplay() {
      if (
        replayTimer !== null ||
        document.hidden ||
        suspended ||
        replay.step === replay.total
      )
        return;
      replayTimer = window.setInterval(() => seekReplay(replay.step + 1), 240);
      paintReplay();
    }
    function closeReplay() {
      pauseReplay();
      const { returnFocus } = replay;
      replay = null;
      syncClock();
      render();
      returnFocus.focus({ preventScroll: true });
    }
    function time(value) {
      const seconds = Math.floor(value);
      return (
        Math.floor(seconds / 60)
          .toString()
          .padStart(2, "0") +
        ":" +
        (seconds % 60).toString().padStart(2, "0")
      );
    }
    function paintMeters() {
      const value = time(state?.elapsed || 0);
      if (timerValue.textContent !== value) timerValue.textContent = value;
      timerValue.title = value;
    }
    function drawThermos() {
      buildCells();
      svg.replaceChildren();
      overlay.replaceChildren();
      for (const path of current?.thermos || []) {
        const line = document.createElementNS(svg.namespaceURI, "polyline");
        line.setAttribute(
          "points",
          path
            .map((i) => (i % 9) * 10 + 5 + "," + (Math.floor(i / 9) * 10 + 5))
            .join(" "),
        );
        const bulb = document.createElementNS(svg.namespaceURI, "circle");
        bulb.setAttribute("cx", (path[0] % 9) * 10 + 5);
        bulb.setAttribute("cy", Math.floor(path[0] / 9) * 10 + 5);
        bulb.setAttribute("r", "3.3");
        svg.append(line, bulb);
      }
      drawVariants();
    }
    function drawVariants() {
      function shape(parent, tag, attrs, className) {
        const el = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attrs))
          el.setAttribute(key, String(value));
        if (className) el.setAttribute("class", className);
        parent.append(el);
        return el;
      }
      const center = (i) => [(i % 9) * 10 + 5, Math.floor(i / 9) * 10 + 5];
      const line = (path, kind) =>
        shape(
          svg,
          "polyline",
          { points: path.map((i) => center(i).join(",")).join(" ") },
          "sudoku-line sudoku-" + kind,
        );
      for (const path of current?.whispers || []) line(path, "whispers");
      for (const path of current?.renbans || []) line(path, "renban");
      for (const path of current?.palindromes || []) line(path, "palindrome");
      for (const cells of current?.extraRegions || [])
        for (const i of cells)
          shape(
            svg,
            "rect",
            {
              x: (i % 9) * 10,
              y: Math.floor(i / 9) * 10,
              width: 10,
              height: 10,
            },
            "sudoku-extra-region",
          );
      for (const [a, b] of current?.inequalities || []) {
        const [x, y] = center(a),
          [u, v] = center(b);
        const dx = (u - x) / 10,
          dy = (v - y) / 10,
          mx = (x + u) / 2,
          my = (y + v) / 2;
        shape(
          overlay,
          "polyline",
          {
            points: [
              [mx - dx + dy, my - dy - dx],
              [mx + dx, my + dy],
              [mx - dx - dy, my - dy + dx],
            ]
              .map((p) => p.join(","))
              .join(" "),
          },
          "sudoku-inequality",
        );
      }
      for (const cells of current?.quadSums || []) {
        const points = cells.map(center);
        shape(
          overlay,
          "circle",
          {
            cx: points.reduce((a, p) => a + p[0], 0) / 4,
            cy: points.reduce((a, p) => a + p[1], 0) / 4,
            r: 1,
          },
          "sudoku-quad-sum",
        );
      }
      if (current?.tenBox) {
        const grid = rules.layout(current),
          regionAt = new Map();
        grid.regions.forEach((cells, n) =>
          cells.forEach((i) => regionAt.set(grid.positions[i].join(","), n)),
        );
        let d = "";
        for (const [key, region] of regionAt) {
          const [r, c] = key.split(",").map(Number);
          if (r === 0 || regionAt.get([r - 1, c].join(",")) !== region)
            d += `M${c * 10},${r * 10}h10`;
          if (c === 0 || regionAt.get([r, c - 1].join(",")) !== region)
            d += `M${c * 10},${r * 10}v10`;
          if (r === 9 || !regionAt.has([r + 1, c].join(",")))
            d += `M${c * 10},${(r + 1) * 10}h10`;
          if (c === 9 || !regionAt.has([r, c + 1].join(",")))
            d += `M${(c + 1) * 10},${r * 10}v10`;
        }
        shape(
          overlay,
          "path",
          { d: d + "M0,0H100V100H0Z" },
          "sudoku-multi-grid",
        );
      }
      if (current?.grids) {
        for (const [r, c] of current.grids)
          for (let n = 0; n <= 9; n += 3) {
            shape(
              overlay,
              "path",
              {
                d: `M${c * 10},${(r + n) * 10}h90 M${(c + n) * 10},${r * 10}v90`,
              },
              "sudoku-multi-grid",
            );
          }
      }
      for (const arrow of current?.arrows || []) {
        const [x, y] = center(arrow.circle);
        const radius = 2.9;
        const [nextX, nextY] = center(arrow.cells[0]);
        const distance = Math.hypot(nextX - x, nextY - y);
        // Start at the circle rim, leaving the digit inside it unobstructed.
        shape(
          svg,
          "polyline",
          {
            points: [
              [
                x + ((nextX - x) * radius) / distance,
                y + ((nextY - y) * radius) / distance,
              ],
              ...arrow.cells.map(center),
            ]
              .map((p) => p.join(","))
              .join(" "),
          },
          "sudoku-line sudoku-arrow",
        );
        shape(
          svg,
          "circle",
          { cx: x, cy: y, r: radius },
          "sudoku-arrow-circle",
        );
        const [ax, ay] = center(arrow.cells.at(-2)),
          [bx, by] = center(arrow.cells.at(-1));
        const dx = (bx - ax) / 10,
          dy = (by - ay) / 10;
        shape(
          svg,
          "polyline",
          {
            points: [
              [bx - dx * 2 - dy * 1.6, by - dy * 2 + dx * 1.6],
              [bx, by],
              [bx - dx * 2 + dy * 1.6, by - dy * 2 - dx * 1.6],
            ]
              .map((p) => p.join(","))
              .join(" "),
          },
          "sudoku-line sudoku-arrow",
        );
      }
      for (const cage of current?.cages || []) {
        let d = "";
        for (const i of cage.cells) {
          const x = (i % 9) * 10,
            y = Math.floor(i / 9) * 10;
          const top = cage.cells.includes(i - 9),
            bottom = cage.cells.includes(i + 9);
          const left = i % 9 > 0 && cage.cells.includes(i - 1),
            right = i % 9 < 8 && cage.cells.includes(i + 1);
          const x0 = x + (left ? 0 : 0.8),
            x1 = x + (right ? 10 : 9.2),
            y0 = y + (top ? 0 : 0.8),
            y1 = y + (bottom ? 10 : 9.2);
          if (!top) d += `M${x0},${y0}H${x1}`;
          if (!bottom) d += `M${x0},${y1}H${x1}`;
          if (!left) d += `M${x0},${y0}V${y1}`;
          if (!right) d += `M${x1},${y0}V${y1}`;
        }
        shape(overlay, "path", { d }, "sudoku-cage");
        const start = Math.min(...cage.cells),
          x = (start % 9) * 10 + 1.6,
          y = Math.floor(start / 9) * 10 + 3.4;
        const label = shape(overlay, "text", { x, y }, "sudoku-cage-sum");
        label.textContent = String(cage.sum);
      }
      for (const dot of current?.kropki || []) {
        const [a, b] = dot.cells.map(center);
        shape(
          overlay,
          "circle",
          { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: 0.9 },
          "sudoku-kropki sudoku-kropki-" + dot.kind,
        );
      }
    }
    function renderBoard() {
      if (!state) return;
      const view = replay?.board || state;
      const invalid = rules.conflicts(current, view);
      const editable = canInput();
      const value = replay ? 0 : view.values[selected];
      const related = new Set(rules.puzzlePeers(current)[selected]);
      const positions = rules.layout(current).positions;
      cells.forEach((cell, i) => {
        const digit = view.values[i];
        const noteMask = view.notes[i];
        const focused = !replay && i === selected;
        cell.tabIndex = focused ? 0 : -1;
        cell.disabled = !editable;
        cell.classList.toggle("is-given", current.givens[i] !== "0");
        cell.classList.toggle("is-selected", focused);
        cell.classList.toggle("is-peer", !replay && related.has(i));
        cell.classList.toggle("is-same", !!value && digit === value);
        cell.classList.toggle("is-conflict", invalid[i]);
        cell.setAttribute("aria-pressed", String(focused));
        cell.setAttribute("aria-invalid", String(invalid[i]));
        cell.dataset.parity = current.parity?.[i] || "";
        const regions = current.regions;
        cell.classList.toggle(
          "sudoku-box-right",
          i % 9 < 8 &&
            (regions
              ? regions[i] !== regions[i + 1]
              : i % 9 === 2 || i % 9 === 5),
        );
        cell.classList.toggle(
          "sudoku-box-bottom",
          i < 72 &&
            (regions
              ? regions[i] !== regions[i + 9]
              : Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5),
        );
        cell.classList.toggle(
          "has-cage-sum",
          !!current.cages?.some((c) => Math.min(...c.cells) === i),
        );
        const cellView = cellViews[i];
        const text = digit ? String(digit) : "";
        if (cellView.digit.textContent !== text)
          cellView.digit.textContent = text;
        const candidates = noteMask
          ? Array.from({ length: 9 }, (_, n) =>
              noteMask & (1 << n) ? String(n + 1) : "",
            )
          : [];
        // Empty notes need no grid items; reuse populated slots until the mask changes.
        if (cellView.noteMask !== noteMask) {
          if (!noteMask) cellView.notes.replaceChildren();
          else {
            if (!cellView.noteDigits)
              cellView.noteDigits = Array.from({ length: 9 }, () =>
                document.createElement("span"),
              );
            cellView.noteDigits.forEach((span, n) => {
              if (span.textContent !== candidates[n])
                span.textContent = candidates[n];
            });
            if (!cellView.noteMask)
              cellView.notes.replaceChildren(...cellView.noteDigits);
          }
          cellView.noteMask = noteMask;
        }
        const description =
          digit ||
          (noteMask
            ? t("noted", { digits: candidates.filter(Boolean).join(", ") })
            : t("empty"));
        cell.setAttribute(
          "aria-label",
          t("cell", {
            row: positions[i][0] + 1,
            col: positions[i][1] + 1,
            value:
              description +
              (current.regions
                ? ", " + t("region", { n: current.regions[i] + 1 })
                : "") +
              (current.cages?.find((c) => c.cells.includes(i))
                ? ", " +
                  t("cageSum", {
                    n: current.cages.find((c) => c.cells.includes(i)).sum,
                  })
                : ""),
          }) +
            (current.parity?.[i]
              ? ", " + t(current.parity[i] === "o" ? "odd" : "even")
              : ""),
        );
      });
    }
    function renderSkyClues() {
      field.classList.toggle(
        "is-skyscraper",
        !!(current?.skyscrapers || current?.sandwich || current?.xsums),
      );
      clueStrips.forEach((strip, side) => {
        const clues =
          current?.skyscrapers?.[side] ||
          current?.sandwich?.[side] ||
          current?.xsums?.[side];
        strip.hidden = !clues;
        strip.replaceChildren(
          ...(clues || []).map((clue, i) => {
            const label = node("span", "", null);
            label.textContent = current.skyscrapers ? clue || "" : (clue ?? "");
            if (current.skyscrapers ? !!clue : clue !== null) {
              label.title = t(
                (current.xsums
                  ? ["xsumsTop", "xsumsLeft"]
                  : current.sandwich
                    ? ["sandwichTop", "sandwichLeft"]
                    : ["skyTop", "skyLeft", "skyBottom", "skyRight"])[side],
                {
                  n: i + 1,
                  count: clue,
                },
              );
              label.setAttribute("role", "img");
              label.setAttribute("aria-label", label.title);
            }
            return label;
          }),
        );
      });
    }
    function render() {
      if (signal.aborted) return;
      root.dataset.playing = String(!choosing);
      const group = groups.find((g) => g.id === selectedGroup);
      const ruleKey =
        categoryOrder.get(group.id) < 4 ? "classicRule" : group.id + "Rule";
      ruleText.textContent = t(ruleKey);
      title.textContent =
        t(group.id) +
        " · " +
        t("level", {
          n:
            (group.puzzles.includes(current)
              ? group.puzzles
              : group.legacyPuzzles || []
            ).indexOf(current) + 1,
        });
      paintMeters();
      timerLabel.textContent = t("time");
      for (const [id, b] of groupButtons) {
        b.textContent = t(id);
        b.setAttribute("aria-pressed", String(id === selectedGroup));
      }
      categoryList.setAttribute("aria-label", t("categories"));
      catalog.setReturn(
        current && state
          ? () => {
              selectedGroup = groups.find((group) =>
                groupPuzzles(group).includes(current),
              ).id;
              choosing = false;
              syncClock();
              save();
              render();
              cells[selected].focus({ preventScroll: true });
            }
          : null,
      );
      catalog.refresh();
      catalog.selectCategory(selectedGroup);
      levelButtons.forEach((b, i) => {
        const p = group.puzzles[i];
        b.hidden = !p;
        if (!p) {
          b.querySelector(".sudoku-level-difficulty")?.remove();
          return;
        }
        const record = completed[p.id];
        WorkTimeApp.games.paintLevelCard(b, {
          number: i + 1,
          label:
            t("level", { n: i + 1 }) +
            (p.difficulty === "hard" ? " · " + t("hard") : "") +
            (record ? " · " + time(record.elapsed) : ""),
          complete: !!record,
          draft: !!drafts[p.id],
          current: p === current,
        });
        let difficulty = b.querySelector(".sudoku-level-difficulty");
        if (p.difficulty === "hard") {
          if (!difficulty) {
            difficulty = node("span", "sudoku-level-difficulty", b);
            difficulty.setAttribute("aria-hidden", "true");
          }
          difficulty.textContent = t("hard");
        } else difficulty?.remove();
      });
      catalog.page.hidden = !choosing;
      hud.hidden = choosing;
      timerBox.hidden = choosing || !!replay;
      play.hidden = choosing;
      choose.hidden = choosing || !!replay;
      pause.hidden = choosing || !!replay;
      restart.hidden = choosing || !!replay;
      const hasReplay = !!completed[current?.id]?.replay;
      menuReplay.hidden = choosing || !!replay || confirming || !hasReplay;
      labelButton(menuReplay, t("replay"), "play-arrow");
      labelButton(choose, t("choose"), "grid-4x4");
      labelButton(
        pause,
        t(manualPaused ? "resume" : "pause"),
        manualPaused ? "play-arrow" : "pause",
      );
      pause.classList.add("game-icon-button");
      pause.querySelector("span").classList.add("game-sr-only");
      pause.append(timerBox);
      labelButton(restart, t("restart"), "restart-alt");
      pause.disabled = isWon() || confirming;
      restart.disabled = !state || confirming;
      zoom.hidden = !(current?.grids || current?.tenBox);
      zoom.textContent = t(
        field.classList.contains("is-zoomed") ? "zoomOut" : "zoomIn",
      );
      zoom.setAttribute(
        "aria-pressed",
        String(field.classList.contains("is-zoomed")),
      );
      renderSkyClues();
      board.setAttribute("aria-label", t("board"));
      const covered =
        !choosing &&
        !replay &&
        (manualPaused || suspended || confirming || isWon());
      const pausedCover = covered && !confirming && !isWon();
      cover.classList.toggle("is-paused", pausedCover);
      paintPauseCover(pausedCover, t("paused"));
      cover.hidden = !covered;
      field.inert = covered;
      coverReplay.hidden = confirming || !isWon() || !hasReplay;
      coverReplay.disabled = suspended;
      coverReplay.textContent = t("replay");
      if (covered) {
        coverTitle.textContent = t(
          confirming ? "restart" : isWon() ? "won" : "paused",
        );
        coverDescription.textContent = confirming
          ? t("confirm")
          : isWon()
            ? t("time") + " " + time(state.elapsed)
            : "";
        cancel.hidden = !confirming;
        cancel.textContent = t("cancel");
        accept.textContent = t(
          confirming ? "reset" : isWon() ? "next" : "resume",
        );
        accept.disabled = suspended;
      }
      paintRestartCover(confirming);
      for (const [b, name, icon] of [
        [undo, "undo", "undo"],
        [notes, "notes", "event-note"],
        [erase, "erase", "delete-outline"],
      ]) {
        labelButton(b, t(name), icon);
        b.disabled = !canInput();
      }
      undo.disabled = !canInput() || !state.history.length;
      notes.setAttribute("aria-pressed", String(pencil));
      actions.hidden = !!replay;
      keypad.hidden = !!replay;
      digits.forEach((b) => {
        b.disabled = !canInput();
      });
      replayPanel.hidden = !replay;
      replayTitle.textContent = t("replay");
      replayBase.hidden = !replay?.log.base;
      replayBase.textContent = t("replayBase");
      replayPrevious.textContent = t("replayPrevious");
      replayNext.textContent = t("replayNext");
      replayRestart.textContent = t("replayRestart");
      replayExit.textContent = t("replayExit");
      paintReplay();
      feedback.textContent = t(saveFailed ? "saveFailed" : "saved");
      feedback.hidden = !saveFailed;
      renderBoard();
      fit();
    }
    function fit() {
      if (!availableSize || choosing) return;
      const { width, height } = availableSize;
      const wide = width >= 700 && height >= 440;
      root.dataset.layout = wide ? "wide" : "compact";
      const rootGap = parseFloat(window.getComputedStyle(root).rowGap) || 0;
      const boardHeight =
        height - feedback.offsetHeight - (saveFailed ? rootGap : 0);
      root.style.setProperty("--sudoku-height", Math.floor(boardHeight) + "px");
      if (!wide) return;
      const style = window.getComputedStyle(play);
      const columns = style.gridTemplateColumns.split(" ").map(parseFloat);
      const gap = parseFloat(style.columnGap) || 0;
      const boardWidth = width - columns[1] - gap;
      root.style.setProperty(
        "--sudoku-size",
        Math.floor(Math.max(260, Math.min(boardWidth, boardHeight))) + "px",
      );
    }
    listen(board, "keydown", (event) => {
      if (!canInput() || event.altKey) return;
      const offsets = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -9,
        ArrowDown: 9,
      };
      if (Object.hasOwn(offsets, event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const { positions, width, height } = rules.layout(current);
        const [r, c] = positions[selected],
          offset = offsets[event.key];
        const horizontal = Math.abs(offset) === 1,
          direction = Math.sign(offset);
        for (let step = 1; step <= (horizontal ? width : height); step++) {
          const row = horizontal ? r : (r + direction * step + height) % height;
          const col = horizontal ? (c + direction * step + width) % width : c;
          const next = positions.findIndex((p) => p[0] === row && p[1] === col);
          if (next >= 0) {
            selected = next;
            break;
          }
        }
        renderBoard();
        cells[selected].focus();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        undoEdit();
      } else if (!event.ctrlKey && !event.metaKey) {
        if (/^[1-9]$/.test(event.key)) {
          event.preventDefault();
          input(Number(event.key));
        } else if (["Backspace", "Delete", "0"].includes(event.key)) {
          event.preventDefault();
          input(0);
        } else if (event.key.toLowerCase() === "n") {
          event.preventDefault();
          pencil = !pencil;
          render();
        }
      }
    });
    listen(cover, "keydown", (event) => {
      if (event.key === "Escape" && confirming) {
        event.preventDefault();
        event.stopPropagation();
        confirming = false;
        syncClock();
        render();
        restart.focus();
      }
      if (event.key === "Tab" && confirming) {
        event.preventDefault();
        (document.activeElement === cancel ? accept : cancel).focus();
      }
    });
    listen(root, "keydown", (event) => {
      if (!replay || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeReplay();
    });
    listen(document, "worktime:languagechange", render);
    signal.addEventListener(
      "abort",
      () => {
        suspended = true;
        pauseReplay();
        syncClock();
        save();
      },
      { once: true },
    );
    drawThermos();
    render();
    syncClock();
    return {
      resize(size) {
        availableSize = size;
        fit();
      },
      pause() {
        suspended = true;
        celebration.stop();
        pauseReplay();
        syncClock();
        save();
        render();
      },
      resume() {
        suspended = false;
        syncClock();
        render();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        celebration.dispose();
        pauseReplay();
        syncClock();
        save();
        root.remove();
      },
    };
  },
});
