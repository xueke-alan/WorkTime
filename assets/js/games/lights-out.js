"use strict";
WorkTimeApp.games.register({
  id: "game-lights-out",
  nameKey: "games.lights.name",
  descriptionKey: "games.lights.description",
  icon: "game-lights-out",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.lightsOutRules;
    const levels = WorkTimeApp.data.lightsOut;
    const storage = WorkTimeApp.services.gameArchive.session();
    const key = "worktime.games.lights-out.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.lights." + name, params);
    let failed = false,
      paused = false,
      disposed = false,
      confirming = false;
    let visible = !document.hidden,
      stamp = performance.now();
    let data;
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        data = rules.restore(JSON.parse(raw));
        if (!data) failed = true;
      }
    } catch {
      failed = true;
    }
    data ||= {
      version: 1,
      chapter: 0,
      current: null,
      drafts: {},
      completed: {},
    };
    let choosing = !data.current;
    if (data.current)
      data.chapter = Math.floor(
        levels.findIndex((l) => l.id === data.current) / rules.perChapter,
      );
    const level = () => levels.find((l) => l.id === data.current);
    const state = () => data.drafts[data.current];
    const node = (tag, className, parent) => {
      const el = document.createElement(tag);
      el.className = className;
      parent?.append(el);
      return el;
    };
    const root = node("section", "game-lights-out game-session", container);
    const playLayout = node("div", "lights-play", root);
    const sidebar = node("aside", "lights-sidebar", playLayout);
    const header = node("div", "lights-header", sidebar);
    const levelTitle = node("h3", "lights-level-title", header);
    const minimumInfo = node("div", "lights-minimum", header);
    const minimumLabel = node("span", "", minimumInfo);
    const minimumValue = node("strong", "", minimumInfo);
    const stats = node("div", "lights-stats", header);

    function stat(parent) {
      const box = node("div", "game-stat", parent);
      return { label: node("span", "", box), value: node("strong", "", box) };
    }
    const moves = stat(stats),
      time = stat(stats);
    const records = node("div", "lights-records", sidebar);
    const recordMoves = stat(records),
      recordTime = stat(records);
    const actions = node("div", "lights-actions game-controls", sidebar);
    function button(parent, action, callback, icon) {
      const el = node("button", "game-button", parent);
      el.type = "button";
      el.dataset.lightsAction = action;
      if (icon) {
        el.classList.add("game-icon-button");
        el.append(WorkTimeApp.games.createIcon(icon));
      }
      el.addEventListener(
        "click",
        () => {
          if (!paused && !disposed) callback();
        },
        { signal },
      );
      return el;
    }
    const choose = button(actions, "choose", showChooser, "grid-4x4");
    const undo = button(
      actions,
      "undo",
      () => {
        tick();
        rules.undo(state(), level().size);
        save();
        render();
      },
      "undo",
    );
    const restart = button(
      actions,
      "restart",
      () => {
        tick();
        if (state().started) {
          confirming = true;
          save();
          render();
          cancel.focus();
        } else reset();
      },
      "restart-alt",
    );
    const catalog = WorkTimeApp.games.createLevelPage(
      root,
      "lights-level-page",
      signal,
    );
    const chooser = catalog.page;
    chooser.classList.add("lights-chooser");
    const chapterButtons = rules.sizes.map((size, index) => {
      const el = button(catalog.categories, "chapter-" + index, () => {
        tick();
        data.chapter = index;
        save();
        render();
      });
      el.dataset.lightsChapter = String(index);
      el.setAttribute("aria-controls", catalog.entries.id);
      return el;
    });
    const levelGrid = node(
      "div",
      "lights-levels game-level-grid",
      catalog.entries,
    );
    const boardHost = node("div", "lights-board-host", playLayout);
    const board = node("div", "lights-board", boardHost);
    const cells = node("div", "lights-cells", board);
    cells.setAttribute("role", "group");
    const cover = node("div", "lights-cover", board);
    cover.hidden = true;
    cover.setAttribute("role", "group");
    const coverTitle = node("h3", "", cover);
    const result = node("p", "", cover);
    const resultStats = node("div", "lights-result-stats", cover);
    const resultMoves = node("div", "", resultStats);
    const resultMovesLabel = node("span", "", resultMoves);
    const resultMovesValue = node("strong", "", resultMoves);
    const resultTime = node("div", "", resultStats);
    const resultTimeLabel = node("span", "", resultTime);
    const resultTimeValue = node("strong", "", resultTime);
    const coverActions = node("div", "lights-cover-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirming = false;
      stamp = performance.now();
      render();
      restart.focus();
    });
    const accept = button(coverActions, "accept", reset);
    const next = button(coverActions, "next", () => {
      const index = levels.findIndex((l) => l.id === data.current);
      if (index < levels.length - 1) openLevel(levels[index + 1].id);
      else showChooser();
    });
    const back = button(coverActions, "back", showChooser);
    const warning = node("p", "lights-warning", root);
    warning.setAttribute("role", "status");
    const status = node("p", "game-sr-only", root);
    status.setAttribute("role", "status");
    const art = [
      '<circle class="lights-water-ring" cx="32" cy="32" r="25"/><circle class="lights-pearl" cx="32" cy="32" r="18"/><circle class="lights-pearl-core" cx="32" cy="32" r="11"/><path class="lights-glint" d="M21 29a12 12 0 0 1 11-9" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>',
      '<circle class="lights-orbit" cx="32" cy="32" r="25"/><path class="lights-star" d="m32 8 6 16 17 1-13 12 4 18-14-10-14 10 4-18L9 25l17-1Z"/><path class="lights-glint" d="m32 18 3 11 11 3-11 3-3 11-3-11-11-3 11-3Z"/>',
      '<path class="lights-crystal" d="m32 5 20 13-3 29-17 13-17-13-3-29Z"/><path class="lights-facet" d="m32 5 8 22-8 33-8-33Zm-20 13 12 9 16 0 12-9M15 47l9-20m16 0 9 20"/><path class="lights-glint" d="m27 17 4-5 2 9-4 6Z"/>',
      '<circle class="lights-battery-shell" cx="32" cy="32" r="27"/><circle class="lights-battery-scale" cx="32" cy="32" r="23"/><circle class="lights-battery-core" cx="32" cy="32" r="18"/><path class="lights-battery-shine" d="M9 25A24 24 0 0 1 25 9m17 44a24 24 0 0 0 11-11"/><path class="lights-circuit" d="M17 29v6m30-6v6M29 17h6m-6 30h6"/><path class="lights-energy" transform="translate(8 8) scale(.75)" d="M35 9 17 35h13l-2 20 19-29H34Z"/>',
    ];
    function tick() {
      const now = performance.now();
      if (
        !paused &&
        visible &&
        !choosing &&
        !confirming &&
        state()?.started &&
        !rules.won(state().board)
      )
        state().elapsed += Math.max(0, Math.round(now - stamp));
      stamp = now;
    }
    function save() {
      try {
        storage.setItem(
          key,
          JSON.stringify({ ...data, current: choosing ? null : data.current }),
        );
        failed = false;
      } catch {
        failed = true;
      }
      warning.textContent = failed ? t("saveFailed") : "";
    }
    function clock(ms) {
      const seconds = Math.floor(ms / 1000);
      return (
        Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
      );
    }
    function showChooser() {
      tick();
      confirming = false;
      choosing = true;
      save();
      render();
      chapterButtons[data.chapter].focus({ preventScroll: true });
    }
    function openLevel(id) {
      tick();
      data.current = id;
      data.chapter = Math.floor(
        levels.findIndex((l) => l.id === id) / rules.perChapter,
      );
      data.drafts[id] ||= rules.create(level());
      choosing = false;
      confirming = false;
      stamp = performance.now();
      save();
      render();
      cells.querySelector("button")?.focus({ preventScroll: true });
    }
    function reset() {
      data.drafts[data.current] = rules.create(level());
      confirming = false;
      stamp = performance.now();
      save();
      render();
      cells.querySelector("button")?.focus({ preventScroll: true });
    }
    function play(index) {
      if (paused || disposed || !visible || choosing || confirming) return;
      tick();
      if (!rules.move(state(), index, level().size)) return;
      const solved = rules.won(state().board);
      if (solved) {
        if (rules.better(state(), data.completed[data.current]))
          data.completed[data.current] = JSON.parse(JSON.stringify(state()));
      }
      save();
      render();
      if (solved) next.focus({ preventScroll: true });
    }
    function renderStats() {
      const record = data.completed[data.current];
      recordMoves.label.textContent = t("recordTitle");
      recordMoves.value.textContent = record ? String(record.path.length) : "—";
      recordTime.label.textContent = t("bestTime");
      recordTime.value.textContent = record ? clock(record.elapsed) : "—";
      levelTitle.textContent = data.current
        ? t("level", {
            number: levels.findIndex((l) => l.id === data.current) + 1,
          })
        : "";
      minimumLabel.textContent = t("minimum");
      minimumValue.textContent = level() ? String(level().minimum) : "—";
      const values = [
        [moves, "moves", state() ? String(state().path.length) : "—"],
        [time, "time", state() ? clock(state().elapsed) : "—"],
      ];
      for (const [entry, name, value] of values) {
        entry.label.textContent = t(name);
        entry.label.title = t(name);
        entry.value.textContent = value;
      }
    }
    function render() {
      root.dataset.theme = String(data.chapter);
      root.dataset.choosing = String(choosing);
      playLayout.hidden = choosing;
      header.hidden = choosing;
      actions.hidden = choosing;
      catalog.refresh();
      catalog.setReturn(
        data.current
          ? () => {
              if (!paused && !disposed) openLevel(data.current);
            }
          : null,
      );
      catalog.selectCategory(data.chapter);
      chapterButtons.forEach((el, i) => {
        el.replaceChildren();
        node("strong", "", el).textContent =
          rules.sizes[i] + " × " + rules.sizes[i];
        node("span", "", el).textContent = t("chapter" + i);
        el.setAttribute("aria-pressed", String(i === data.chapter));
      });
      for (const [el, name] of [
        [choose, "choose"],
        [undo, "undo"],
        [restart, "restart"],
      ]) {
        el.setAttribute("aria-label", t(name));
        el.title = t(name);
      }
      choose.disabled = choosing || confirming;
      undo.disabled = choosing || confirming || !state()?.path.length;
      restart.disabled = choosing || confirming;
      chooser.hidden = !choosing;
      boardHost.hidden = choosing;
      stats.hidden = choosing;
      warning.textContent = failed ? t("saveFailed") : "";
      if (choosing) {
        levelGrid.replaceChildren();
        levels
          .slice(
            data.chapter * rules.perChapter,
            data.chapter * rules.perChapter + rules.perChapter,
          )
          .forEach((entry, i) => {
            const card = node("button", "lights-level game-button", levelGrid);
            card.type = "button";
            card.dataset.lightsLevel = entry.id;
            const complete = !!data.completed[entry.id];
            const draft = !!data.drafts[entry.id]?.started;
            card.dataset.completed = String(complete);
            card.dataset.draft = String(draft);
            WorkTimeApp.games.paintLevelCard(card, {
              number: data.chapter * rules.perChapter + i + 1,
              label: t("level", {
                number: data.chapter * rules.perChapter + i + 1,
              }),
              complete,
              draft,
              current: data.current === entry.id,
            });
            card.addEventListener("click", () => {
              if (!paused && !disposed) openLevel(entry.id);
            });
          });
      } else {
        const size = level().size;
        cells.setAttribute("aria-label", t("board", { size }));
        cells.style.setProperty("--lights-n", String(size));
        if (
          cells.children.length !== size * size ||
          cells.dataset.chapter !== String(data.chapter)
        ) {
          cells.dataset.chapter = String(data.chapter);
          cells.replaceChildren();
          for (let i = 0; i < size * size; i++) {
            const cell = node("button", "lights-cell", cells);
            cell.type = "button";
            cell.dataset.cell = String(i);
            cell.innerHTML =
              '<svg viewBox="0 0 64 64" aria-hidden="true">' +
              art[data.chapter] +
              "</svg>";
            cell.addEventListener("click", () => play(i));
          }
        }
        [...cells.children].forEach((cell, i) => {
          const on = state().board[i] === 1;
          cell.dataset.on = String(on);
          cell.setAttribute("aria-pressed", String(on));
          cell.setAttribute(
            "aria-label",
            t("cell", {
              row: Math.floor(i / size) + 1,
              column: (i % size) + 1,
              state: t((on ? "on" : "off") + data.chapter),
            }),
          );
        });
        const solved = rules.won(state().board);
        cover.hidden = !confirming && !solved;
        coverTitle.hidden = !confirming;
        coverTitle.textContent = confirming ? t("confirm") : "";
        result.hidden = !confirming;
        result.textContent = confirming ? t("confirmRestart") : "";
        resultStats.hidden = confirming;
        resultMovesLabel.textContent = t("moves");
        resultMovesValue.textContent = String(state().path.length);
        resultTimeLabel.textContent = t("time");
        resultTimeValue.textContent = clock(state().elapsed);
        cancel.hidden = !confirming;
        next.hidden = confirming;
        back.hidden = confirming;
        cancel.textContent = t("cancel");
        accept.textContent = t(confirming ? "accept" : "again");
        next.textContent = t(
          levels.at(-1).id === data.current ? "choose" : "next",
        );
        back.textContent = t("choose");
        back.hidden ||= levels.at(-1).id === data.current;
        cells.inert = !cover.hidden;
        status.textContent = solved ? t("won") : "";
      }
      renderStats();
    }
    cells.addEventListener(
      "keydown",
      (event) => {
        if (
          paused ||
          disposed ||
          choosing ||
          confirming ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const direction = {
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1],
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
        }[event.key];
        const cell = event.target.closest("[data-cell]");
        if (!direction || !cell) return;
        event.preventDefault();
        const i = Number(cell.dataset.cell),
          size = level().size;
        const row = Math.max(
          0,
          Math.min(size - 1, Math.floor(i / size) + direction[0]),
        );
        const col = Math.max(0, Math.min(size - 1, (i % size) + direction[1]));
        cells.children[row * size + col].focus({ preventScroll: true });
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        tick();
        visible = !document.hidden;
        save();
        render();
      },
      { signal },
    );
    document.addEventListener("worktime:languagechange", render, { signal });
    const timer = setInterval(() => {
      tick();
      renderStats();
      if (state()?.started && !disposed) save();
    }, 1000);
    function dispose() {
      if (disposed) return;
      tick();
      disposed = true;
      paused = true;
      clearInterval(timer);
      save();
    }
    signal.addEventListener("abort", dispose, { once: true });
    render();
    return {
      pause() {
        tick();
        paused = true;
        save();
        render();
      },
      resume() {
        paused = false;
        stamp = performance.now();
      },
      resize() {},
      dispose,
    };
  },
});
