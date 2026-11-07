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
    const groupFor = ({ goal }) => Math.min(goal, 4);
    const groupLabel = (group) => t(group === 4 ? "classics" : "goal" + group);
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
    let selectedGroup = level ? groupFor(level) : 1;
    let path = save.drafts[save.current]?.path ?? [];
    let position = level ? rules.restore(level, path) : null;
    let selected = null;
    let suggested = null;
    let focus = position?.board.search(/[AEHRCPK]/) ?? 0;
    let message = null;
    let paused = false;
    let presentation = null;
    let pointer = null;
    let suppressClick = false;

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
    const heading = node(root, "h3", "game-title");
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "xiangqi-level-page",
      signal,
    );
    const progress = node(catalog.summary, "span", "xiangqi-progress");
    const groupProgress = node(catalog.summary, "span", "game-level-progress");
    const categories = catalog.categories;
    categories.setAttribute("role", "group");
    const groups = [1, 2, 3, 4].map((group) => ({
      group,
      control: button(categories, "goal" + group, () => {
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
    const play = node(root, "div", "xiangqi-play");
    const objective = node(play, "p", "xiangqi-objective");
    const board = node(play, "div", "xiangqi-board");
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
          if (paused || signal.aborted || presentation || pointer?.dragging)
            return;
          setFocus(square);
          activate(square);
        });
        return { cell, piece };
      },
    );
    const ghost = node(board, "span", "xiangqi-piece xiangqi-ghost");
    ghost.hidden = true;
    ghost.setAttribute("aria-hidden", "true");
    const status = node(play, "p", "xiangqi-status");
    status.setAttribute("role", "status");
    const actions = node(play, "div", "xiangqi-actions");
    const hint = button(actions, "hint", showHint);
    const undo = button(actions, "undo", undoRound);
    const restart = button(actions, "restart", (keyboard) => {
      clearPointer();
      stopPresentation();
      path = [];
      updatePosition();
      render();
      if (keyboard) focusBoard();
    });
    const next = button(actions, "next", (keyboard) =>
      start(levels.indexOf(level) + 1, keyboard),
    );
    const choose = button(actions, "choose", () => {
      clearPointer();
      stopPresentation();
      const index = levels.indexOf(level);
      level = null;
      save.current = null;
      persist();
      render();
      levelButtons[index].focus();
    });
    const help = node(play, "p", "xiangqi-help");
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
      selected = suggested = message = null;
      persist();
    }

    function stopPresentation() {
      const current = presentation;
      if (!current) return;
      presentation = null;
      clearTimeout(current.timer);
      current.animation?.cancel();
    }

    function showRound(before, move, reply, dragged) {
      if (reduced.matches || typeof ghost.animate !== "function") {
        render();
        return;
      }
      const redBoard = rules.apply(before, move);
      const round = {
        board: redBoard,
        red: rules.decode(move),
        black: [],
        waiting: reply !== null,
      };
      presentation = round;
      render();

      function slide([from, to], duration, done) {
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
      }

      function afterRed() {
        if (reply === null) {
          finish();
          return;
        }
        round.timer = setTimeout(() => {
          round.board = position.board;
          round.black = rules.decode(reply);
          render();
          slide(round.black, 150, finish);
        }, 100);
      }

      if (dragged) afterRed();
      else slide(round.red, 110, afterRed);
    }

    function start(index, keyboard) {
      clearPointer();
      stopPresentation();
      level = levels[index];
      selectedGroup = groupFor(level);
      path = save.drafts[level.id]?.path ?? [];
      updatePosition();
      focus = position.board.search(/[AEHRCPK]/);
      render();
      board.toggleAttribute("data-pointer-entry", !keyboard);
      focusBoard();
    }

    function undoRound(keyboard) {
      clearPointer();
      stopPresentation();
      path = path.slice(0, path.length % 2 ? -1 : -2);
      updatePosition();
      render();
      if (keyboard || undo.disabled) focusBoard();
    }

    function showHint() {
      if (presentation || pointer?.dragging || position?.status !== "playing")
        return;
      const move = position.node
        ? Number(Object.keys(position.node[1])[0])
        : rules.suggest(position.board, true);
      const [from, to] = rules.decode(move);
      if (selected === from && (message === "hintPiece" || suggested === to)) {
        suggested = to;
        message = "hintTarget";
      } else {
        selected = from;
        suggested = null;
        message = "hintPiece";
      }
      setFocus(from);
      render();
    }

    function activate(square) {
      if (position.status !== "playing") return;
      suggested = message = null;
      if (rules.side(position.board[square])) {
        selected = selected === square ? null : square;
        render();
      } else if (selected !== null) attempt(square);
      else render();
    }

    function attempt(square, dragged = false) {
      const before = position.board;
      const move = rules.encode(selected, square);
      const nextPosition = rules.playRound(position, move);
      suggested = null;
      if (!nextPosition) {
        message = "illegal";
        render();
      } else {
        const { defense } = nextPosition;
        path = defense === null ? [...path, move] : [...path, move, defense];
        updatePosition(nextPosition);
        showRound(before, move, defense, dragged);
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

    function clearPointer() {
      const current = pointer;
      pointer = null;
      if (!current?.dragging) return;
      cells[current.drop]?.cell.classList.remove("is-drop");
      ghost.hidden = true;
      if (board.hasPointerCapture(current.id))
        board.releasePointerCapture(current.id);
    }

    listen(board, "pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || pointer) return;
      suppressClick = false;
      if (paused || presentation || position?.status !== "playing") return;
      const cell = event.target.closest(".xiangqi-cell.is-draggable");
      if (!cell) return;
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: Number(cell.dataset.square),
        drop: null,
        dragging: false,
      };
    });
    function dropSquare(event) {
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(".xiangqi-cell");
      return cell && board.contains(cell) ? Number(cell.dataset.square) : null;
    }
    listen(window, "pointermove", (event) => {
      if (pointer?.id !== event.pointerId) return;
      if (!pointer.dragging) {
        if (
          Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 6
        )
          return;
        const { piece } = cells[pointer.from];
        const size = piece.getBoundingClientRect().width;
        ghost.style.width = size + "px";
        ghost.textContent = piece.textContent;
        pointer.dragging = true;
        suppressClick = true;
        board.setPointerCapture(event.pointerId);
        ghost.hidden = false;
        render();
      }
      const bounds = board.getBoundingClientRect();
      ghost.style.left = event.clientX - bounds.left - board.clientLeft + "px";
      ghost.style.top = event.clientY - bounds.top - board.clientTop + "px";
      const target = dropSquare(event);
      if (target !== pointer.drop) {
        cells[pointer.drop]?.cell.classList.remove("is-drop");
        cells[target]?.cell.classList.add("is-drop");
        pointer.drop = target;
      }
    });
    listen(window, "pointerup", (event) => {
      if (pointer?.id !== event.pointerId) return;
      const { dragging, from } = pointer;
      const target = dragging ? dropSquare(event) : null;
      clearPointer();
      if (!dragging) return;
      if (target === null) {
        render();
        return;
      }
      selected = from;
      suggested = message = null;
      setFocus(target);
      if (board.contains(document.activeElement)) focusBoard();
      if (target === from) render();
      else attempt(target, true);
    });
    function cancelPointer(event) {
      if (pointer?.id !== event.pointerId) return;
      clearPointer();
      render();
    }
    listen(window, "pointercancel", cancelPointer);
    listen(board, "lostpointercapture", (event) => {
      // Touch initially captures on the pressed button, then transfers to the board.
      if (event.target === board) cancelPointer(event);
    });
    board.addEventListener(
      "click",
      (event) => {
        if (!suppressClick || event.detail === 0) return;
        event.stopImmediatePropagation();
        suppressClick = false;
      },
      { capture: true, signal },
    );

    listen(root, "keydown", (event) => {
      if (paused || signal.aborted) return;
      board.removeAttribute("data-pointer-entry");
      if (event.key === "Escape" && (pointer || presentation)) {
        event.preventDefault();
        event.stopPropagation();
        settle();
        return;
      }
      if (event.key === "Escape" && selected !== null) {
        event.preventDefault();
        event.stopPropagation();
        selected = suggested = message = null;
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
      if (presentation || pointer?.dragging) return;
      const x = (focus % rules.columns) + offset[0];
      const y = Math.floor(focus / rules.columns) + offset[1];
      if (x >= 0 && x < rules.columns && y >= 0 && y < rules.rows) {
        setFocus(y * rules.columns + x);
        focusBoard();
      }
    });

    function settle() {
      clearPointer();
      stopPresentation();
      render();
    }

    function levelLabel(entry, index) {
      const number = t("level", { number: index + 1 });
      return entry.title ? number + " · " + entry.title : number;
    }

    function render() {
      catalog.page.hidden = !!level;
      heading.hidden = !level;
      root.dataset.playing = String(!!level);
      play.hidden = !level;
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
      heading.textContent = t("name");
      if (!level) {
        catalog.refresh();
        catalog.selectCategory(selectedGroup);
        categories.setAttribute("aria-label", t("categories"));
        const groupLevels = levels.filter(
          (entry) => groupFor(entry) === selectedGroup,
        );
        groupProgress.textContent =
          groupLabel(selectedGroup) +
          " · " +
          t("progress", {
            completed: groupLevels.filter(({ id }) =>
              Object.hasOwn(save.completed, id),
            ).length,
            total: groupLevels.length,
          });
        progress.textContent = t("progress", {
          completed: Object.keys(save.completed).length,
          total: levels.length,
        });
        for (const { group, control, entries } of groups) {
          const active = group === selectedGroup;
          control.textContent = groupLabel(group);
          control.setAttribute("aria-pressed", String(active));
          entries.hidden = !active;
        }
        levelButtons.forEach((element, index) => {
          const entry = levels[index];
          const { id } = entry;
          WorkTimeApp.games.paintLevelCard(element, {
            number: index + 1,
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
      const blackTurn = !!presentation?.waiting;
      const active = pointer?.dragging ? pointer.from : selected;
      const redTurn = presentation
        ? presentation.black.length > 0
        : path.length % 2 === 0;
      const checkedSquare = rules.checked(displayed, redTurn)
        ? displayed.indexOf(redTurn ? "K" : "k")
        : -1;
      objective.textContent = t("objective", {
        level: levelLabel(level, index),
        goal:
          level.goal <= 3
            ? t("goal" + level.goal)
            : t("longGoal", { number: level.goal }),
        played: Math.ceil(path.length / 2),
      });
      status.textContent = t(
        message ??
          (blackTurn
            ? "replying"
            : ended && !presentation
              ? position.status
              : redTurn && checkedSquare !== -1
                ? "inCheck"
                : "turn"),
      );
      board.setAttribute("aria-label", t("board"));
      board.toggleAttribute("data-replying", blackTurn);
      help.textContent = t("help");
      hint.textContent = t("hint");
      undo.textContent = t("undo");
      restart.textContent = t("restart");
      next.textContent = t("next");
      choose.textContent = t("choose");
      hint.disabled = ended || !!presentation || !!pointer?.dragging;
      undo.disabled = path.length === 0;
      next.hidden = !won || !!presentation || index === levels.length - 1;

      const legal = new Set(
        active === null || presentation
          ? []
          : rules
              .destinations(displayed, true, active)
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
        cell.classList.toggle("is-draggable", own && !ended && !presentation);
        cell.classList.toggle(
          "is-drag-origin",
          !!pointer?.dragging && pointer.from === square,
        );
        cell.classList.toggle("is-selected", active === square);
        cell.classList.toggle("is-legal", legal.has(square));
        cell.classList.toggle(
          "is-capture",
          legal.has(square) && occupant !== ".",
        );
        cell.classList.toggle(
          "is-suggested",
          !pointer?.dragging && suggested === square,
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
        cell.setAttribute("aria-disabled", String(ended || !!presentation));
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
    }
    listen(document, "worktime:languagechange", render);
    listen(window, "blur", settle);
    const unlisten = compat.listen(reduced, settle);
    signal.addEventListener(
      "abort",
      () => {
        clearPointer();
        stopPresentation();
        unlisten();
      },
      { once: true },
    );
    render();
    return {
      pause() {
        paused = true;
        settle();
      },
      resume() {
        paused = false;
      },
      resize() {
        if (pointer || presentation) settle();
      },
      dispose() {
        root.remove();
      },
    };
  },
});
