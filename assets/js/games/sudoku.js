"use strict";
WorkTimeApp.games.register({
  id: "game-sudoku",
  nameKey: "games.sudoku.name",
  descriptionKey: "games.sudoku.description",
  icon: "game-sudoku",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.sudokuRules;
    const groups = WorkTimeApp.data.sudoku.groups;
    const key = "worktime.games.sudoku.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.sudoku." + name, params);
    const puzzles = new Map(
      groups.flatMap((g) => g.puzzles.map((p) => [p.id, p])),
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
    let availableSize = null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key));
      if (saved?.version === 1) {
        for (const [id, puzzle] of puzzles) {
          const draft = rules.restore(puzzle, saved.drafts?.[id]);
          if (draft) drafts[id] = draft;
          const record = saved.completed?.[id];
          if (
            record &&
            Number.isFinite(record.elapsed) &&
            record.elapsed >= 0 &&
            record.elapsed <= 315360000 &&
            Number.isInteger(record.hints) &&
            record.hints >= 0 &&
            record.hints <= 1000000
          )
            completed[id] = record;
        }
        if (groups.some((g) => g.id === saved.group))
          selectedGroup = saved.group;
        const puzzle = puzzles.get(saved.current);
        const group = groups.find((g) => g.puzzles.includes(puzzle));
        if (
          puzzle &&
          drafts[puzzle.id] &&
          unlocked(group, group.puzzles.indexOf(puzzle))
        ) {
          current = puzzle;
          state = drafts[puzzle.id];
          selectedGroup = group.id;
          choosing = false;
          manualPaused = true;
        }
      }
    } catch {
      saveFailed = true;
    }
    function unlocked(group, index) {
      return (
        index === 0 ||
        !!completed[group.puzzles[index - 1].id] ||
        !!completed[group.puzzles[index].id]
      );
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
    const meters = ["time"].map((name) => {
      const box = node("div", "sudoku-time", sessionMeta);
      return {
        name,
        label: node("span", "", box),
        value: node("strong", "", box),
      };
    });
    const options = node("details", "sudoku-options", hud);
    const optionsToggle = node(
      "summary",
      "game-button game-icon-button",
      options,
    );
    optionsToggle.append(WorkTimeApp.games.createIcon("more-horiz"));
    const controls = node("div", "sudoku-controls", options);
    function button(parent, action, callback) {
      const b = node("button", "game-button", parent);
      b.type = "button";
      b.dataset.sudokuAction = action;
      listen(b, "click", () => {
        if (!disposed && !signal.aborted && !suspended) callback();
      });
      return b;
    }
    const choose = button(controls, "choose", () => {
      options.open = false;
      choosing = true;
      syncClock();
      save();
      render();
      groupButtons.get(selectedGroup).focus();
    });
    const pause = button(sessionMeta, "pause", () => {
      manualPaused = !manualPaused;
      syncClock();
      save();
      render();
      if (!manualPaused) cells[selected].focus();
    });
    const restart = button(controls, "restart", () => {
      options.open = false;
      confirming = true;
      syncClock();
      render();
      cancel.focus();
    });
    const catalog = node("div", "sudoku-catalog", root);
    const categoryTitle = node("h3", "", catalog);
    const categoryList = node("div", "sudoku-categories", catalog);
    const groupButtons = new Map(
      groups.map((group) => {
        const b = button(categoryList, group.id, () => {
          selectedGroup = group.id;
          save();
          render();
        });
        return [group.id, b];
      }),
    );
    const progress = node("p", "sudoku-progress", catalog);
    const levels = node("div", "sudoku-levels", catalog);
    const levelButtons = Array.from({ length: 20 }, (_, i) =>
      button(levels, "level-" + (i + 1), () =>
        open(groups.find((g) => g.id === selectedGroup).puzzles[i]),
      ),
    );
    const play = node("div", "sudoku-play", root);
    const tools = node("div", "sudoku-tools", play);
    const ruleText = node("p", "sudoku-rule", tools);
    const stage = node("div", "sudoku-stage", play);
    const board = node("div", "sudoku-board", stage);
    board.setAttribute("role", "group");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 90 90");
    svg.classList.add("sudoku-thermos");
    svg.setAttribute("aria-hidden", "true");
    board.append(svg);
    const cells = Array.from({ length: 81 }, (_, index) => {
      const cell = button(board, "cell-" + index, () => {
        selected = index;
        renderBoard();
      });
      cell.className = "sudoku-cell";
      cell.dataset.cell = index;
      if (index % 9 === 2 || index % 9 === 5)
        cell.classList.add("sudoku-box-right");
      if (Math.floor(index / 9) === 2 || Math.floor(index / 9) === 5)
        cell.classList.add("sudoku-box-bottom");
      node("span", "sudoku-digit", cell);
      node("span", "sudoku-notes", cell);
      listen(cell, "focus", () => {
        if (selected !== index) {
          selected = index;
          renderBoard();
        }
      });
      return cell;
    });
    const cover = node("div", "sudoku-cover", stage);
    const coverTitle = node("h3", "", cover);
    const coverDescription = node("p", "", cover);
    const coverActions = node("div", "sudoku-cover-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirming = false;
      syncClock();
      render();
      optionsToggle.focus();
    });
    const accept = button(coverActions, "accept", () => {
      if (confirming) {
        state = rules.create(current);
        drafts[current.id] = state;
        confirming = false;
        manualPaused = false;
        selected = current.givens.indexOf("0");
      } else if (isWon()) {
        next();
        return;
      } else manualPaused = false;
      syncClock();
      save();
      render();
      cells[selected].focus();
    });
    const actions = node("div", "sudoku-actions", tools);
    tools.prepend(actions);
    const notes = button(actions, "notes", () => {
      pencil = !pencil;
      render();
    });
    const erase = button(actions, "erase", () => input(0));
    const undo = button(actions, "undo", () => {
      if (canInput() && rules.undo(state)) changed();
    });
    const hint = button(actions, "hint", () => {
      if (!canInput()) return;
      let index = selected;
      if (
        current.givens[index] !== "0" ||
        state.values[index] === Number(current.solution[index])
      )
        index = state.values.findIndex(
          (n, i) => n !== Number(current.solution[i]),
        );
      if (index < 0) return;
      selected = index;
      if (rules.enter(current, state, index, Number(current.solution[index]))) {
        state.hints++;
        changed();
      }
    });
    const keypad = node("div", "sudoku-keypad", play);
    const digits = Array.from({ length: 9 }, (_, i) => {
      const b = button(keypad, "digit-" + (i + 1), () => input(i + 1));
      b.textContent = i + 1;
      return b;
    });
    play.append(stage, tools);
    tools.append(keypad, actions, ruleText);
    const feedback = node("p", "sudoku-feedback", root);
    feedback.setAttribute("role", "status");
    const source = node("a", "sudoku-source", controls);
    source.href = WorkTimeApp.data.sudoku.repository;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    const help = WorkTimeApp.games.createHelp({
      root,
      controls,
      signal,
      text: () =>
        t("classicRule") +
        "\n" +
        t("parityRule") +
        "\n" +
        t("thermoRule") +
        "\n\n" +
        t("help"),
      onChange(open) {
        options.open = false;
        if (!open)
          queueMicrotask(() => optionsToggle.focus({ preventScroll: true }));
        syncClock();
        save();
      },
    });
    controls.append(source);
    function labelButton(element, label, icon) {
      element.replaceChildren(WorkTimeApp.games.createIcon(icon));
      const text = node("span", "sudoku-action-label", element);
      text.textContent = label;
      element.title = label;
      element.setAttribute("aria-label", label);
    }
    const isWon = () => !!state && rules.won(current, state);
    function canInput() {
      return (
        !!state &&
        !choosing &&
        !manualPaused &&
        !suspended &&
        !confirming &&
        !help.isOpen() &&
        !disposed &&
        !signal.aborted &&
        !isWon()
      );
    }
    function active() {
      return (
        !!state &&
        !choosing &&
        !manualPaused &&
        !suspended &&
        !confirming &&
        !help.isOpen() &&
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
      if (active()) {
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
            },
          ]),
        );
        window.localStorage.setItem(
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
    function open(puzzle) {
      settle();
      if (current) drafts[current.id] = state;
      current = puzzle;
      state = drafts[puzzle.id] || rules.create(puzzle);
      drafts[puzzle.id] = state;
      selected = Math.max(0, puzzle.givens.indexOf("0"));
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
      const groupIndex = groups.findIndex((g) => g.puzzles.includes(current));
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
        changed();
    }
    function changed() {
      settle();
      if (isWon()) {
        const record = completed[current.id];
        if (
          !record ||
          state.hints < record.hints ||
          (state.hints === record.hints && state.elapsed < record.elapsed)
        )
          completed[current.id] = {
            elapsed: state.elapsed,
            hints: state.hints,
          };
      }
      syncClock();
      save();
      render();
      if (isWon()) accept.focus();
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
      const values = [
        time(state?.elapsed || 0),
        (state?.values.filter(Boolean).length || 0) + "/81",
        state?.hints || 0,
      ];
      meters.forEach((meter, i) => {
        meter.label.textContent = t(meter.name);
        WorkTimeApp.games.paintCounter(meter.value, values[i]);
      });
    }
    function drawThermos() {
      svg.replaceChildren();
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
    }
    function renderBoard() {
      if (!state) return;
      const invalid = rules.conflicts(current, state),
        value = state.values[selected];
      cells.forEach((cell, i) => {
        const digit = state.values[i];
        cell.tabIndex = i === selected ? 0 : -1;
        cell.disabled = !canInput();
        cell.classList.toggle("is-given", current.givens[i] !== "0");
        cell.classList.toggle("is-selected", i === selected);
        cell.classList.toggle("is-peer", rules.peers[selected].includes(i));
        cell.classList.toggle("is-same", !!value && digit === value);
        cell.classList.toggle("is-conflict", invalid[i]);
        cell.setAttribute("aria-pressed", String(i === selected));
        cell.setAttribute("aria-invalid", String(invalid[i]));
        cell.dataset.parity = current.parity?.[i] || "";
        cell.querySelector(".sudoku-digit").textContent = digit || "";
        const candidates = Array.from({ length: 9 }, (_, n) =>
          state.notes[i] & (1 << n) ? String(n + 1) : "",
        );
        cell.querySelector(".sudoku-notes").replaceChildren(
          ...candidates.map((text) => {
            const span = document.createElement("span");
            span.textContent = text;
            return span;
          }),
        );
        const description =
          digit ||
          (state.notes[i]
            ? t("noted", { digits: candidates.filter(Boolean).join(", ") })
            : t("empty"));
        cell.setAttribute(
          "aria-label",
          t("cell", {
            row: Math.floor(i / 9) + 1,
            col: (i % 9) + 1,
            value: description,
          }) +
            (current.parity?.[i]
              ? ", " + t(current.parity[i] === "o" ? "odd" : "even")
              : ""),
        );
      });
    }
    function render() {
      root.dataset.playing = String(!choosing);
      const group = groups.find((g) => g.id === selectedGroup);
      title.textContent = choosing
        ? t("name")
        : t(group.id) +
          " · " +
          t("level", { n: group.puzzles.indexOf(current) + 1 });
      paintMeters();
      for (const [id, b] of groupButtons) {
        b.textContent = t(id);
        b.setAttribute("aria-pressed", String(id === selectedGroup));
      }
      categoryTitle.textContent = t("categories");
      progress.textContent = t("completed", {
        n: group.puzzles.filter((p) => completed[p.id]).length,
        total: group.puzzles.length,
      });
      levelButtons.forEach((b, i) => {
        const p = group.puzzles[i],
          record = completed[p.id];
        b.disabled = !unlocked(group, i);
        b.textContent =
          String(i + 1).padStart(2, "0") +
          (record ? " ✓" : drafts[p.id] ? " ·" : "");
        b.title =
          t("level", { n: i + 1 }) +
          (b.disabled
            ? " · " + t("locked")
            : record
              ? " · " +
                time(record.elapsed) +
                " · " +
                t("hints") +
                " " +
                record.hints
              : "");
        b.setAttribute("aria-label", b.title);
        b.classList.toggle("is-complete", !!record);
      });
      catalog.hidden = !choosing;
      sessionMeta.hidden = choosing;
      play.hidden = choosing;
      choose.hidden = choosing;
      pause.hidden = choosing;
      restart.hidden = choosing;
      choose.textContent = t("choose");
      labelButton(
        pause,
        t(manualPaused ? "resume" : "pause"),
        manualPaused ? "play-arrow" : "pause",
      );
      pause.classList.add("game-icon-button");
      pause.querySelector("span").classList.add("game-sr-only");
      optionsToggle.setAttribute("aria-label", t("more"));
      optionsToggle.title = t("more");
      restart.textContent = t("restart");
      pause.disabled = isWon() || confirming;
      restart.disabled = !state || confirming;
      ruleText.hidden = !current?.parity && !current?.thermos;
      ruleText.textContent = current?.parity
        ? t("parityRule")
        : current?.thermos
          ? t("thermoRule")
          : "";
      board.setAttribute("aria-label", t("board"));
      const covered = manualPaused || suspended || confirming || isWon();
      cover.hidden = !covered;
      board.inert = covered;
      if (covered) {
        coverTitle.textContent = t(
          confirming ? "restart" : isWon() ? "won" : "paused",
        );
        coverDescription.textContent = confirming
          ? t("confirm")
          : isWon()
            ? t("time") +
              " " +
              time(state.elapsed) +
              " · " +
              t("hints") +
              " " +
              state.hints
            : "";
        cancel.hidden = !confirming;
        cancel.textContent = t("cancel");
        accept.textContent = t(
          confirming ? "reset" : isWon() ? "next" : "resume",
        );
        accept.disabled = suspended;
      }
      for (const [b, name, icon] of [
        [notes, "notes", "event-note"],
        [erase, "erase", "delete-outline"],
        [undo, "undo", "undo"],
        [hint, "hint", "help"],
      ]) {
        labelButton(b, t(name), icon);
        b.disabled = !canInput();
      }
      undo.disabled = !canInput() || !state.history.length;
      notes.setAttribute("aria-pressed", String(pencil));
      digits.forEach((b) => {
        b.disabled = !canInput();
      });
      feedback.textContent = t(saveFailed ? "saveFailed" : "saved");
      feedback.hidden = !saveFailed;
      source.textContent = t("source");
      help.refresh();
      const helpButton = controls.querySelector("[data-game-help]");
      helpButton.classList.remove("game-icon-button");
      labelButton(helpButton, WorkTimeApp.i18n.t("games.help"), "help");
      renderBoard();
      fit();
    }
    function fit() {
      if (!availableSize || choosing) return;
      const { width, height } = availableSize;
      const wide = width >= 700 && height >= 440;
      root.dataset.layout = wide ? "wide" : "compact";
      if (!wide) return;
      const style = window.getComputedStyle(play);
      const columns = style.gridTemplateColumns.split(" ").map(parseFloat);
      const gap = parseFloat(style.columnGap) || 0;
      const boardWidth = width - columns[1] - gap;
      const rootGap = parseFloat(window.getComputedStyle(root).rowGap) || 0;
      const boardHeight =
        height -
        hud.offsetHeight -
        feedback.offsetHeight -
        rootGap * (saveFailed ? 2 : 1);
      root.style.setProperty(
        "--sudoku-size",
        Math.floor(Math.max(260, Math.min(boardWidth, boardHeight))) + "px",
      );
    }
    listen(document, "pointerdown", (event) => {
      if (!options.contains(event.target)) options.open = false;
    });
    listen(options, "keydown", (event) => {
      if (event.key === "Escape" && options.open) {
        event.preventDefault();
        event.stopPropagation();
        options.open = false;
        optionsToggle.focus();
      }
    });
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
        const row = Math.floor(selected / 9),
          col = selected % 9;
        selected =
          event.key === "ArrowLeft"
            ? row * 9 + ((col + 8) % 9)
            : event.key === "ArrowRight"
              ? row * 9 + ((col + 1) % 9)
              : (selected + offsets[event.key] + 81) % 81;
        renderBoard();
        cells[selected].focus();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (rules.undo(state)) changed();
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
        optionsToggle.focus();
      }
      if (event.key === "Tab" && confirming) {
        event.preventDefault();
        (document.activeElement === cancel ? accept : cancel).focus();
      }
    });
    listen(document, "worktime:languagechange", render);
    signal.addEventListener(
      "abort",
      () => {
        suspended = true;
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
        syncClock();
        save();
        root.remove();
      },
    };
  },
});
