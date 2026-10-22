"use strict";
WorkTimeApp.games.register({
  id: "game-minesweeper",
  nameKey: "games.mine.name",
  descriptionKey: "games.mine.description",
  icon: "game-minesweeper",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.minesweeperRules;
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    const key = "worktime.games.minesweeper.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.mine." + name, params);
    let state = rules.create(),
      stats = rules.emptyStats(),
      elapsed = 0;
    let manualPaused = false,
      suspended = false,
      disposed = false,
      saveFailed = false;
    let runningSince = null,
      ticker = null,
      pointer = null,
      hold = null;
    let confirmation = null,
      focusIndex = 0,
      cells = [];
    let lastTouch = -Infinity,
      lastSaved = 0;
    let boardMotion = null,
      motionRevision = 0,
      changingBoard = false;
    let newRecord = false,
      previewIndex = null,
      chordHint = false;
    let resultMotion = null,
      celebration = null,
      confettiMotions = [];
    try {
      const saved = rules.restore(JSON.parse(gameStorage.getItem(key)));
      if (saved) ({ state, stats, elapsed, manualPaused } = saved);
    } catch {
      saveFailed = true;
    }
    function node(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    }
    const root = node("section", "game-minesweeper game-session", container);
    const header = node("div", "mine-header game-hud", root);
    const counters = node("div", "mine-counters", header);
    function counter(name) {
      const box = node("div", "game-stat", counters);
      const label = node("span", "", box);
      const value = node("strong", "", box);
      value.dataset.mineCounter = name;
      return { label, value };
    }
    const remaining = counter("remaining"),
      time = counter("time"),
      best = counter("best"),
      wins = counter("wins");
    time.value.setAttribute("aria-live", "off");
    const toolbar = node("div", "mine-toolbar game-controls", root);
    const levelLabel = node("div", "mine-difficulty", toolbar);
    const levelText = node("label", "game-sr-only", levelLabel);
    levelText.id = "mineDifficultyLabel";
    const select = node("select", "", levelLabel);
    select.id = "mineDifficulty";
    const options = Object.keys(rules.levels).map((level) => {
      const option = node("option", "", select);
      option.value = level;
      return option;
    });
    const difficulty = WorkTimeApp.games.createSelect({
      host: levelLabel,
      select,
      label: levelText,
      signal,
    });
    difficulty.trigger.dataset.mineAction = "difficulty";
    function button(parent, action, callback) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.mineAction = action;
      element.addEventListener(
        "click",
        () => {
          if (!disposed && !suspended && !signal.aborted) callback();
        },
        { signal },
      );
      return element;
    }
    const pauseButton = button(toolbar, "pause", () => {
      manualPaused = !manualPaused;
      syncClock();
      save();
      render();
    });
    const restart = button(toolbar, "restart", () =>
      requestNew(state.difficulty),
    );
    pauseButton.classList.add("game-icon-button");
    restart.classList.add("game-icon-button");
    const stage = node("div", "mine-stage", root);
    const scroller = node("div", "mine-scroller", stage);
    const arrangement = node("div", "mine-arrangement", scroller);
    const boardFrame = node("div", "mine-board-frame", arrangement);
    const board = node("div", "mine-board", boardFrame);
    board.setAttribute("role", "grid");
    const cover = node("div", "mine-cover", boardFrame);
    const coverTitle = node("h3", "", cover);
    const coverHint = node("p", "", cover);
    const coverActions = node("div", "mine-cover-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirmation = null;
      syncClock();
      render();
      restart.focus();
    });
    const confirm = button(coverActions, "confirm", () =>
      newGame(confirmation),
    );
    const resume = button(coverActions, "resume", () => {
      manualPaused = false;
      syncClock();
      save();
      render();
      cells[focusIndex].focus({ preventScroll: true });
    });
    cancel.append(WorkTimeApp.games.createIcon("close"));
    const cancelLabel = node("span", "button-label", cancel);
    confirm.append(WorkTimeApp.games.createIcon("restart-alt"));
    const confirmLabel = node("span", "button-label", confirm);
    resume.append(WorkTimeApp.games.createIcon("play-arrow"));
    const resumeLabel = node("span", "button-label", resume);
    const feedback = node("div", "mine-feedback", arrangement);
    const result = node("div", "mine-result", feedback);
    result.setAttribute("role", "status");
    const resultIcon = node("span", "mine-result-icon", result);
    resultIcon.setAttribute("aria-hidden", "true");
    const resultCopy = node("div", "mine-result-copy", result);
    const resultTitle = node("strong", "", resultCopy);
    const resultText = node("span", "", resultCopy);
    const again = button(result, "again", () => newGame(state.difficulty));
    const footer = node("div", "mine-footer", root);
    const status = node("p", "mine-status game-sr-only", footer);
    status.setAttribute("role", "status");
    const notice = node("div", "game-notice", footer);
    const warning = node("p", "mine-save-warning", notice);
    warning.setAttribute("role", "status");
    const ended = () => ["won", "lost"].includes(state.status);
    const blocked = () =>
      disposed ||
      signal.aborted ||
      suspended ||
      changingBoard ||
      manualPaused ||
      confirmation !== null;
    const currentElapsed = () =>
      elapsed +
      (runningSince === null
        ? 0
        : Math.max(0, performance.now() - runningSince));
    function formatTime(ms) {
      const seconds = Math.floor(ms / 1000);
      return `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    }
    function syncClock() {
      const shouldRun = state.status === "playing" && !blocked();
      if (!shouldRun && runningSince !== null) {
        elapsed = currentElapsed();
        runningSince = null;
      } else if (shouldRun && runningSince === null)
        runningSince = performance.now();
      if (!shouldRun && ticker !== null) {
        window.clearInterval(ticker);
        ticker = null;
      } else if (shouldRun && ticker === null) {
        ticker = window.setInterval(() => {
          WorkTimeApp.games.paintCounter(
            time.value,
            formatTime(currentElapsed()),
          );
          if (performance.now() - lastSaved >= 5000) save();
        }, 250);
      }
    }
    function save() {
      try {
        gameStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            state,
            stats,
            elapsed: Math.floor(currentElapsed()),
            manualPaused,
          }),
        );
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      lastSaved = performance.now();
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
    }
    function requestNew(difficulty) {
      clearPointer();
      select.value = state.difficulty;
      if (state.status === "playing") {
        confirmation = difficulty;
        syncClock();
        render();
        cancel.focus();
      } else newGame(difficulty);
    }
    function newGame(difficulty) {
      if (!difficulty) return;
      const from = board.getBoundingClientRect();
      stopCelebration();
      stopBoardMotion();
      clearPointer();
      // Settle the old clock before replacing the board and elapsed time.
      suspended = true;
      syncClock();
      suspended = false;
      state = rules.create(difficulty);
      elapsed = 0;
      manualPaused = false;
      confirmation = null;
      focusIndex = 0;
      newRecord = false;
      chordHint = false;
      clearPreview();
      buildBoard();
      render();
      save();
      scroller.scrollLeft = scroller.scrollTop = 0;
      animateBoardChange(from);
    }
    function stopBoardMotion() {
      motionRevision++;
      boardMotion?.cancel();
      boardMotion = null;
      resultMotion?.cancel();
      resultMotion = null;
      changingBoard = false;
      delete root.dataset.boardChanging;
      board.inert = manualPaused || suspended || confirmation !== null;
    }
    function animateBoardChange(from) {
      const to = board.getBoundingClientRect();
      if (
        reduced.matches ||
        document.hidden ||
        suspended ||
        disposed ||
        signal.aborted ||
        !from.width ||
        !to.width ||
        (Math.abs(from.width - to.width) < 1 &&
          Math.abs(from.height - to.height) < 1 &&
          Math.abs(from.left - to.left) < 1 &&
          Math.abs(from.top - to.top) < 1)
      ) {
        cells[0].focus({ preventScroll: true });
        return;
      }
      const revision = motionRevision;
      changingBoard = true;
      root.dataset.boardChanging = "";
      board.inert = true;
      boardMotion = compat.animate(
        board,
        [
          {
            transformOrigin: "0 0",
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            opacity: 0.65,
          },
          { transformOrigin: "0 0", transform: "none", opacity: 1 },
        ],
        {
          duration: 300,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
      void boardMotion.finished.then(() => {
        if (revision !== motionRevision || disposed || signal.aborted) return;
        stopBoardMotion();
        if (!suspended && document.activeElement === difficulty.trigger)
          cells[0].focus({ preventScroll: true });
      });
    }
    function animateOutcome(from) {
      stopBoardMotion();
      if (reduced.matches || document.hidden || suspended || disposed) return;
      const to = board.getBoundingClientRect();
      const options = {
        duration: 520,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      };
      boardMotion = compat.animate(
        board,
        [
          {
            transformOrigin: "0 0",
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          },
          { transformOrigin: "0 0", transform: "none" },
        ],
        options,
      );
      resultMotion = compat.animate(
        result,
        [
          { opacity: 0, transform: "translateX(48px)" },
          { opacity: 1, transform: "none" },
        ],
        options,
      );
    }
    function stopCelebration() {
      confettiMotions.forEach((motion) => motion.cancel());
      confettiMotions = [];
      celebration?.remove();
      celebration = null;
    }
    function celebrate() {
      stopCelebration();
      if (
        reduced.matches ||
        document.hidden ||
        suspended ||
        disposed ||
        signal.aborted
      )
        return;
      const layer = node("div", "mine-celebration", document.body);
      layer.setAttribute("aria-hidden", "true");
      celebration = layer;
      const colors = [
        "#168b72",
        "#f2bb47",
        "#e57a80",
        "#6a9fe0",
        "#a583cd",
        "#f4d779",
      ];
      const width = window.innerWidth,
        height = window.innerHeight;
      for (let i = 0; i < 120; i++) {
        const piece = node("i", "mine-confetti", layer);
        piece.style.background = colors[i % colors.length];
        piece.style.borderRadius = i % 3 === 0 ? "50%" : "2px";
        const side = i % 2,
          startX = side ? width + 12 : -12;
        const targetX = width * (0.08 + Math.random() * 0.84);
        const startY = height * (0.7 + Math.random() * 0.2);
        const peakY = height * (0.02 + Math.random() * 0.28);
        const rotation = (Math.random() - 0.5) * 1440;
        const frames = Array.from({ length: 9 }, (_, step) => {
          const p = step / 8;
          const x = startX + (targetX - startX) * p;
          const y =
            startY * (1 - p) +
            (height + 40) * p -
            ((startY + height + 40) / 2 - peakY) * 4 * p * (1 - p);
          return {
            transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotation * p}deg) rotateY(${p * 720}deg)`,
            opacity: p > 0.75 ? (1 - p) * 4 : 1,
          };
        });
        confettiMotions.push(
          compat.animate(piece, frames, {
            duration: 2300 + Math.random() * 700,
            delay: Math.floor(i / 40) * 220,
            easing: "linear",
            fill: "both",
          }),
        );
      }
      void Promise.all(confettiMotions.map((motion) => motion.finished)).then(
        () => {
          if (celebration === layer) stopCelebration();
        },
      );
    }
    function buildBoard() {
      const { columns, rows } = rules.levels[state.difficulty];
      root.dataset.difficulty = state.difficulty;
      board.replaceChildren();
      board.style.setProperty("--mine-columns", columns);
      board.setAttribute("aria-rowcount", rows);
      board.setAttribute("aria-colcount", columns);
      cells = [];
      for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const row = node("div", "mine-row", board);
        row.setAttribute("role", "row");
        for (let column = 0; column < columns; column++) {
          const cell = node("button", "mine-cell", row);
          cell.type = "button";
          cell.setAttribute("role", "gridcell");
          cell.setAttribute("aria-rowindex", rowIndex + 1);
          cell.setAttribute("aria-colindex", column + 1);
          cell.dataset.mineCell = cells.length;
          cells.push(cell);
        }
      }
      fit();
    }
    function fit() {
      const style = window.getComputedStyle(container);
      const height =
        container.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      root.style.setProperty("--mine-height", Math.max(360, height) + "px");
      const { columns, rows } = rules.levels[state.difficulty];
      const sideResult = ended() && window.innerWidth > 700;
      const availableWidth = scroller.clientWidth - 4 - (sideResult ? 284 : 0);
      const availableHeight =
        scroller.clientHeight - 4 - (ended() && !sideResult ? 190 : 0);
      // Phones retain usable touch targets; desktop boards use both dimensions.
      const min = sideResult
        ? 8
        : window.innerWidth <= 540
          ? state.difficulty === "easy"
            ? 24
            : 32
          : 16;
      board.style.setProperty(
        "--mine-cell",
        Math.max(
          min,
          Math.min(
            48,
            Math.floor((availableWidth - 22 - (columns - 1) * 3) / columns),
            Math.floor((availableHeight - 22 - (rows - 1) * 3) / rows),
          ),
        ) + "px",
      );
      arrangement.style.setProperty(
        "--mine-board-height",
        board.offsetHeight + "px",
      );
    }
    function render() {
      const { columns, rows, count } = rules.levels[state.difficulty];
      root.dataset.status = state.status;
      root.dataset.difficulty = state.difficulty;
      remaining.label.textContent = t("remaining");
      WorkTimeApp.games.paintCounter(
        remaining.value,
        state.status === "won"
          ? 0
          : count - state.flagged.filter(Boolean).length,
      );
      time.label.textContent = t("time");
      WorkTimeApp.games.paintCounter(time.value, formatTime(currentElapsed()));
      best.label.textContent = t("bestLabel");
      wins.label.textContent = t("winsLabel");
      best.label.title = t("bestLabel");
      wins.label.title = t("winsLabel");
      levelText.textContent = t("difficulty");
      options.forEach((option) => {
        const level = rules.levels[option.value];
        option.textContent = `${t(option.value)} · ${level.columns}×${level.rows} / ${level.count}`;
      });
      select.value = state.difficulty;
      select.disabled = confirmation !== null;
      difficulty.sync();
      WorkTimeApp.games.setIcon(
        pauseButton,
        manualPaused ? "play-arrow" : "pause",
      );
      pauseButton.title = t(manualPaused ? "resume" : "pause");
      pauseButton.setAttribute("aria-label", pauseButton.title);
      pauseButton.disabled =
        state.status !== "playing" || confirmation !== null;
      pauseButton.setAttribute("aria-pressed", String(manualPaused));
      WorkTimeApp.games.setIcon(restart, "restart-alt");
      restart.title = t("restart");
      restart.setAttribute("aria-label", t("restart"));
      restart.disabled = confirmation !== null;
      const covered = manualPaused || suspended || confirmation !== null;
      if (covered) {
        clearPointer();
        clearPreview();
      }
      cover.hidden = !covered;
      board.inert = covered || changingBoard;
      board.setAttribute("aria-hidden", String(covered));
      board.classList.toggle("mine-board-covered", covered);
      board.setAttribute("aria-label", t("board", { columns, rows }));
      coverTitle.textContent = t(
        confirmation !== null ? "confirmTitle" : "paused",
      );
      coverHint.textContent = t(
        confirmation !== null ? "confirmHint" : "pauseHint",
      );
      cancel.hidden = confirm.hidden = confirmation === null;
      resume.hidden = confirmation !== null || suspended;
      cancelLabel.textContent = t("cancel");
      confirmLabel.textContent = t("confirm");
      resumeLabel.textContent = t("resume");
      cells.forEach((cell, index) => {
        const shown = state.revealed[index],
          flagged = state.flagged[index];
        const mine = ended() && state.mines[index] === 1;
        const wrong = ended() && flagged && !state.mines[index];
        const number = shown && !mine ? rules.adjacent(state, index) : 0;
        const secured = state.status === "won" && mine;
        const kind = wrong
          ? "wrong"
          : flagged || secured
            ? "flag"
            : mine
              ? "bomb"
              : "";
        if (cell.dataset.kind !== kind) {
          cell.replaceChildren(
            ...(kind
              ? [WorkTimeApp.games.createIcon(wrong ? "flag" : kind)]
              : []),
          );
          if (wrong) {
            const marker = WorkTimeApp.games.createIcon("close");
            marker.classList.add("mine-incorrect-icon");
            cell.append(marker);
          }
          cell.dataset.kind = kind;
        }
        if (!kind) cell.textContent = number || "";
        cell.dataset.number = number;
        cell.classList.toggle("is-open", shown || mine);
        cell.classList.toggle("is-flagged", flagged || secured);
        cell.classList.toggle("is-exploded", index === state.exploded);
        cell.classList.toggle("is-wrong", wrong);
        cell.tabIndex = index === focusIndex ? 0 : -1;
        cell.setAttribute(
          "aria-label",
          t("cell", {
            row: Math.floor(index / columns) + 1,
            column: (index % columns) + 1,
            value: t(
              wrong
                ? "wrong"
                : mine
                  ? "mine"
                  : flagged
                    ? "flagged"
                    : shown
                      ? number
                        ? "number"
                        : "empty"
                      : "covered",
              { count: number },
            ),
          }),
        );
      });
      result.hidden = !ended();
      root.dataset.record = String(newRecord);
      WorkTimeApp.games.setIcon(
        resultIcon,
        state.status === "won" ? "check" : "bomb",
      );
      resultTitle.textContent = t(
        state.status === "won" ? (newRecord ? "newRecord" : "won") : "lost",
      );
      resultText.textContent = t(
        state.status === "won" ? "wonHint" : "lostHint",
        { time: formatTime(currentElapsed()) },
      );
      again.textContent = t("again");
      WorkTimeApp.games.paintCounter(
        best.value,
        stats[state.difficulty].best === null
          ? "—"
          : formatTime(stats[state.difficulty].best),
      );
      WorkTimeApp.games.paintCounter(wins.value, stats[state.difficulty].wins);
      status.textContent = t(
        covered
          ? "paused"
          : ended()
            ? state.status
            : state.status === "ready"
              ? "ready"
              : "playing",
      );
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
      fit();
    }
    function play(index, action = "reveal") {
      if (blocked() || ended()) return;
      const from = board.getBoundingClientRect();
      const previous = state;
      const next =
        action === "flag"
          ? rules.flag(state, index)
          : state.revealed[index]
            ? rules.chord(state, index)
            : rules.reveal(state, index);
      clearPreview();
      chordHint =
        next === previous &&
        action !== "flag" &&
        state.revealed[index] &&
        rules.adjacent(state, index) > 0;
      if (next === previous) {
        render();
        if (chordHint) status.textContent = t("chordHint");
        return;
      }
      state = next;
      focusIndex = index;
      syncClock();
      if (state.status === "won") {
        const record = stats[state.difficulty],
          duration = Math.floor(currentElapsed());
        record.wins++;
        newRecord = record.best === null || duration < record.best;
        record.best =
          record.best === null ? duration : Math.min(record.best, duration);
      }
      render();
      if (ended()) {
        animateOutcome(from);
        if (state.status === "won") celebrate();
      }
      cells.forEach((cell, cellIndex) => {
        if (state.revealed[cellIndex] && !previous.revealed[cellIndex]) {
          cell.classList.remove("mine-just-opened");
          // Animation is cosmetic; game state is committed synchronously.
          cell.classList.add("mine-just-opened");
          const columns = rules.levels[state.difficulty].columns;
          const distance = Math.max(
            Math.abs((cellIndex % columns) - (index % columns)),
            Math.abs(
              Math.floor(cellIndex / columns) - Math.floor(index / columns),
            ),
          );
          cell.style.setProperty(
            "--mine-delay",
            Math.min(distance * 18, 180) + "ms",
          );
        }
        if (state.flagged[cellIndex] !== previous.flagged[cellIndex]) {
          cell.classList.remove("mine-just-flagged");
          cell.classList.add("mine-just-flagged");
        }
      });
      save();
    }
    function cellIndex(target) {
      const cell = target.closest?.("[data-mine-cell]");
      return cell && board.contains(cell)
        ? Number(cell.dataset.mineCell)
        : null;
    }
    function clearPointer() {
      window.clearTimeout(hold);
      hold = null;
      pointer = null;
      cells.forEach((cell) => cell.classList.remove("is-holding"));
    }
    function clearPreview() {
      previewIndex = null;
      cells.forEach((cell) =>
        cell.classList.remove("is-neighbor", "is-chord-ready"),
      );
    }
    function preview(index) {
      if (index === previewIndex) return;
      clearPreview();
      if (
        index === null ||
        blocked() ||
        ended() ||
        !state.revealed[index] ||
        !rules.adjacent(state, index)
      )
        return;
      previewIndex = index;
      const neighbors = rules.neighbors(state, index);
      const ready =
        neighbors.filter((cell) => state.flagged[cell]).length ===
        rules.adjacent(state, index);
      cells[index].classList.toggle("is-chord-ready", ready);
      neighbors.forEach((cell) => {
        if (!state.revealed[cell] && !state.flagged[cell])
          cells[cell].classList.add("is-neighbor");
      });
    }
    const listen = (element, name, callback, options = {}) =>
      element.addEventListener(name, callback, { ...options, signal });
    listen(select, "change", () => requestNew(select.value));
    listen(board, "click", (event) => {
      if (performance.now() - lastTouch < 800) return;
      const index = cellIndex(event.target);
      if (index !== null) play(index);
    });
    listen(board, "contextmenu", (event) => {
      event.preventDefault();
      if (performance.now() - lastTouch < 800) return;
      const index = cellIndex(event.target);
      if (index !== null) play(index, "flag");
    });
    listen(board, "focusin", (event) => {
      const index = cellIndex(event.target);
      if (index === null) return;
      cells[focusIndex].tabIndex = -1;
      focusIndex = index;
      cells[index].tabIndex = 0;
      preview(index);
    });
    listen(board, "pointerover", (event) => {
      if (event.pointerType === "mouse") preview(cellIndex(event.target));
    });
    listen(board, "pointerleave", clearPreview);
    listen(board, "focusout", clearPreview);
    listen(board, "keydown", (event) => {
      const { columns, rows } = rules.levels[state.difficulty];
      let target = focusIndex;
      const x = target % columns,
        y = Math.floor(target / columns);
      if (event.key === "ArrowLeft") target -= x > 0 ? 1 : 0;
      else if (event.key === "ArrowRight") target += x < columns - 1 ? 1 : 0;
      else if (event.key === "ArrowUp") target -= y > 0 ? columns : 0;
      else if (event.key === "ArrowDown") target += y < rows - 1 ? columns : 0;
      else if (event.key.toLowerCase() === "f") play(target, "flag");
      else if (event.key === "Enter" || event.key === " ")
        play(target, "reveal");
      else return;
      event.preventDefault();
      if (target !== focusIndex) {
        cells[target].focus({ preventScroll: true });
        cells[target].scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    listen(board, "pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      clearPointer();
      lastTouch = performance.now();
      const index = cellIndex(event.target);
      if (!event.isPrimary || index === null || blocked() || ended()) return;
      pointer = {
        id: event.pointerId,
        index,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        held: false,
      };
      cells[index].classList.add("is-holding");
      hold = window.setTimeout(() => {
        if (!pointer || pointer.moved) return;
        pointer.held = true;
        play(pointer.index, "flag");
      }, 450);
    });
    listen(board, "pointermove", (event) => {
      if (pointer?.id !== event.pointerId) return;
      if (
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8
      ) {
        pointer.moved = true;
        window.clearTimeout(hold);
        cells[pointer.index].classList.remove("is-holding");
      }
    });
    listen(window, "pointerup", (event) => {
      if (pointer?.id !== event.pointerId) return;
      const touch = pointer;
      clearPointer();
      lastTouch = performance.now();
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (
        !touch.moved &&
        !touch.held &&
        cellIndex(target || event.target) === touch.index
      )
        play(touch.index);
    });
    listen(window, "pointercancel", () => {
      lastTouch = performance.now();
      clearPointer();
    });
    listen(
      scroller,
      "scroll",
      () => {
        if (pointer) {
          pointer.moved = true;
          window.clearTimeout(hold);
        }
      },
      { passive: true },
    );
    listen(board, "animationend", (event) => {
      event.target
        .closest(".mine-cell")
        ?.classList.remove("mine-just-opened", "mine-just-flagged");
    });
    listen(document, "worktime:languagechange", render);
    listen(window, "pagehide", save);
    const unlistenMotion = compat.listen(reduced, () => {
      if (reduced.matches) {
        stopBoardMotion();
        stopCelebration();
      }
    });
    signal.addEventListener(
      "abort",
      () => {
        suspended = true;
        stopCelebration();
        stopBoardMotion();
        clearPointer();
        syncClock();
        save();
      },
      { once: true },
    );
    buildBoard();
    render();
    syncClock();
    return {
      resize() {
        stopBoardMotion();
        clearPointer();
        difficulty.close();
        fit();
      },
      pause() {
        suspended = true;
        stopCelebration();
        stopBoardMotion();
        difficulty.close();
        clearPointer();
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
        disposed = true;
        stopCelebration();
        stopBoardMotion();
        unlistenMotion();
        clearPointer();
        syncClock();
        save();
        root.remove();
      },
    };
  },
});
