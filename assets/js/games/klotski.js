"use strict";
WorkTimeApp.games.register({
  id: "game-klotski",
  nameKey: "games.klotski.name",
  descriptionKey: "games.klotski.description",
  icon: "game-klotski",
  create({ container, signal }) {
    const G = WorkTimeApp.games,
      rules = G.klotskiRules;
    const levels = WorkTimeApp.data.klotski;
    const archive = WorkTimeApp.services.gameArchive;
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    let winPending = false,
      escaped = false,
      winRevision = 0,
      escapeAnimation = null,
      coverAnimation = null;
    const storage = archive.session(),
      key = "worktime.games.klotski.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.klotski." + name, params);
    let failed = false,
      paused = false,
      disposed = false,
      confirming = false;
    let visible = !document.hidden,
      stamp = performance.now(),
      selected = null,
      drag = null,
      dragMotion = null,
      suppressPointerClick = false;
    let data;
    try {
      const raw = storage.getItem(key);
      if (raw !== null)
        data = archive.normalize("game-klotski", JSON.parse(raw));
    } catch {
      failed = true;
    }
    data ||= {
      version: 1,
      grouping: 2,
      chapter: 0,
      classics: false,
      current: null,
      drafts: {},
      completed: {},
    };
    let choosing = !data.current;
    const level = () => levels.find((l) => l.id === data.current);
    const state = () => data.drafts[data.current];
    const clock = (ms) =>
      Math.floor(ms / 60000) +
      ":" +
      String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    const node = (tag, className, parent) => {
      const el = document.createElement(tag);
      el.className = className;
      parent?.append(el);
      return el;
    };
    const listen = (el, type, callback) =>
      el.addEventListener(type, callback, { signal });
    const root = node("section", "game-klotski game-session", container);
    const playLayout = node("div", "klotski-play", root);
    const sidebar = node("aside", "klotski-sidebar", playLayout);
    const eyebrow = node("p", "klotski-eyebrow", sidebar);
    const heading = node("h3", "klotski-heading", sidebar);
    const stats = node("div", "klotski-stats", sidebar);
    function stat() {
      const box = node("div", "game-stat", stats);
      return { label: node("span", "", box), value: node("strong", "", box) };
    }
    const moves = stat(),
      time = stat(),
      best = stat();
    const actions = node("div", "klotski-actions game-controls", sidebar);
    function button(parent, action, callback, icon) {
      const el = node("button", "game-button", parent);
      el.type = "button";
      el.dataset.klotskiAction = action;
      if (icon) {
        el.classList.add("game-icon-button");
        el.append(G.createIcon(icon));
      }
      const invoke = () => {
        if (!paused && !disposed && !el.disabled) callback();
      };
      let touch = null,
        touchHandledAt = -Infinity;
      listen(el, "pointerdown", (event) => {
        touch =
          event.pointerType === "touch"
            ? { id: event.pointerId, x: event.clientX, y: event.clientY }
            : null;
      });
      listen(el, "pointercancel", () => {
        touch = null;
      });
      listen(el, "pointerup", (event) => {
        const start = touch;
        touch = null;
        if (
          !start ||
          event.pointerId !== start.id ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
        )
          return;
        const rect = el.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          return;
        // Some touch streams omit the compatibility click after a board drag.
        // Handle the tap directly, then suppress its later synthetic click.
        touchHandledAt = performance.now();
        invoke();
      });
      el.addEventListener(
        "touchend",
        (event) => {
          if (performance.now() - touchHandledAt < 500 && event.cancelable)
            event.preventDefault();
        },
        { signal, passive: false },
      );
      listen(el, "click", (event) => {
        if (event.detail && performance.now() - touchHandledAt < 500) return;
        invoke();
      });
      return el;
    }
    const choose = button(actions, "choose", showChooser, "grid-4x4");
    const undo = button(
      actions,
      "undo",
      () => {
        tick();
        cancelDrag();
        stopWin();
        rules.undo(level(), state());
        selected = null;
        save();
        render();
        board.focus({ preventScroll: true });
      },
      "undo",
    );
    const restart = button(
      actions,
      "restart",
      () => {
        tick();
        cancelDrag();
        stopWin();
        if (state().started) {
          confirming = true;
          save();
          render();
          cancel.focus();
        } else reset();
      },
      "restart-alt",
    );
    const boardHost = node("div", "klotski-board-host", playLayout);
    const board = node("div", "klotski-board", boardHost);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const tiles = node("div", "klotski-tiles", board);
    const pieceButtons = Array.from({ length: 10 }, (_, piece) => {
      const el = node("button", "klotski-piece", tiles);
      el.type = "button";
      el.dataset.piece = String(piece);
      return el;
    });
    const exit = node("div", "klotski-exit", boardHost);
    const cover = node("div", "klotski-cover", boardHost);
    cover.hidden = true;
    cover.setAttribute("role", "group");
    const coverTitle = node("h3", "", cover);
    const result = node("p", "", cover);
    const coverActions = node("div", "klotski-result-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirming = false;
      stamp = performance.now();
      render();
      restart.focus();
    });
    const accept = button(coverActions, "accept", reset);
    const next = button(coverActions, "next", () => {
      const bank = data.classics
        ? levels.filter((l) => l.classic !== undefined)
        : levels;
      const index = bank.findIndex((l) => l.id === data.current);
      if (index >= 0 && index < bank.length - 1) openLevel(bank[index + 1].id);
      else showChooser();
    });
    const back = button(coverActions, "back", showChooser);
    const catalog = G.createLevelPage(root, "klotski-level-page", signal);
    const chapterButtons = rules.groups.map((_, chapter) => {
      const el = button(catalog.categories, "chapter-" + chapter, () => {
        data.chapter = chapter;
        save();
        render();
      });
      el.dataset.klotskiChapter = String(chapter);
      el.setAttribute("aria-controls", catalog.entries.id);
      return el;
    });
    const filter = button(catalog.header, "classics", () => {
      data.classics = !data.classics;
      save();
      render();
    });
    const progress = node("p", "klotski-progress", catalog.entries);
    const grid = node("div", "klotski-levels game-level-grid", catalog.entries);
    const warning = node("p", "klotski-warning", root);
    warning.setAttribute("role", "status");
    const status = node("p", "game-sr-only", root);
    status.setAttribute("role", "status");
    function tick() {
      const now = performance.now();
      if (
        !paused &&
        !disposed &&
        visible &&
        !choosing &&
        !confirming &&
        state()?.started &&
        !rules.won(state())
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
      warning.textContent = failed ? t("saveFailed") : "";
    }
    function cancelDrag() {
      stopDragMotion();
      const current = drag;
      drag = null;
      if (current) {
        if (current.frame) window.cancelAnimationFrame(current.frame);
        current.element.style.removeProperty("transform");
        current.element.classList.remove("is-dragged");
        if (board.hasPointerCapture(current.id))
          board.releasePointerCapture(current.id);
      }
      board.classList.remove("is-dragging");
      if (current?.dirty) {
        renderBoard();
        renderStats();
        save();
      }
    }
    function stopDragMotion() {
      const current = dragMotion;
      dragMotion = null;
      current?.animation.cancel();
      current?.element.classList.remove("is-settling");
    }
    function settlePiece(element, from) {
      stopDragMotion();
      element.classList.add("is-settling");
      const target = element.getBoundingClientRect();
      const x = from.left - target.left,
        y = from.top - target.top;
      if (reduced.matches || (Math.abs(x) < 0.5 && Math.abs(y) < 0.5)) {
        element.classList.remove("is-settling");
        return null;
      }
      const animation = compat.animate(
        element,
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: Math.min(120, 75 + Math.hypot(x, y) * 0.3),
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
      const current = { element, animation };
      dragMotion = current;
      void animation.finished.then(() => {
        if (dragMotion !== current) return;
        dragMotion = null;
        element.classList.remove("is-settling");
      });
      return animation;
    }
    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      tick();
      drag.points.push({ clientX: event.clientX, clientY: event.clientY });
      flushDrag();
      if (!drag) return;
      const element = drag.element,
        from = element.getBoundingClientRect();
      cancelDrag();
      settlePiece(element, from);
    }
    function canSlide(piece, direction) {
      const [dx, dy] = rules.directions[direction],
        p = state().positions[piece];
      const [w, h] = level().pieces[piece];
      const x = (p % 4) + dx,
        y = Math.floor(p / 4) + dy;
      if (x < 0 || y < 0 || x + w > 4 || y + h > 5) return false;
      const positions = [...state().positions];
      positions[piece] = x + 4 * y;
      return rules.valid(level(), positions);
    }
    function legalDragDirections(piece) {
      return Object.fromEntries(
        Object.keys(rules.directions).map((direction) => [
          direction,
          canSlide(piece, direction),
        ]),
      );
    }
    function clampDragOrigin(event) {
      // Discard overshoot against a wall, so reversing responds immediately.
      for (const axis of dragAxes(event)) {
        if (Math.abs(axis.distance) > 0.5 && !drag.allowed[axis.direction])
          drag[axis.axis] = axis.axis === "x" ? event.clientX : event.clientY;
      }
    }
    function dragAxes(event) {
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      return [
        { direction: dx > 0 ? "r" : "l", distance: dx, axis: "x" },
        { direction: dy > 0 ? "d" : "u", distance: dy, axis: "y" },
      ].sort((a, b) => Math.abs(b.distance) - Math.abs(a.distance));
    }
    function followPointer(event) {
      if (!drag) return;
      const axis = dragAxes(event).find(
        (a) => Math.abs(a.distance) > 0.5 && drag.allowed[a.direction],
      );
      const offset = axis
        ? Math.max(-drag.cell, Math.min(drag.cell, axis.distance))
        : 0;
      drag.element.style.transform = `translate(${axis?.axis === "x" ? offset : 0}px, ${axis?.axis === "y" ? offset : 0}px)`;
    }
    function updateDragPoint(event) {
      clampDragOrigin(event);
      followPointer(event);
      for (let n = 0; n < 10 && drag; n++) {
        const axis = dragAxes(event).find(
          (a) =>
            Math.abs(a.distance) >= drag.cell * 0.55 &&
            drag.allowed[a.direction],
        );
        if (!axis) break;
        const [x, y] = rules.directions[axis.direction];
        drag.x += x * drag.cell;
        drag.y += y * drag.cell;
        if (!play(drag.piece, axis.direction)) {
          drag.x -= x * drag.cell;
          drag.y -= y * drag.cell;
          break;
        }
        if (drag) {
          clampDragOrigin(event);
          followPointer(event);
        }
      }
    }
    function flushDrag() {
      const current = drag;
      if (!current) return;
      if (current.frame) window.cancelAnimationFrame(current.frame);
      current.frame = 0;
      const points = current.points.splice(0);
      for (const point of points) {
        if (drag !== current || !playable()) break;
        updateDragPoint(point);
      }
    }
    function stopWin() {
      winRevision++;
      winPending = false;
      escaped = false;
      escapeAnimation?.cancel();
      coverAnimation?.cancel();
      escapeAnimation = coverAnimation = null;
      boardHost.classList.remove("is-escaping", "is-escaped");
    }
    async function finishWin(revision, settlement = null) {
      if (settlement) await settlement.finished;
      if (
        revision !== winRevision ||
        disposed ||
        paused ||
        choosing ||
        !visible
      )
        return;
      if (!reduced.matches) {
        // Let the final grid translation settle before Cao Cao exits below it.
        escapeAnimation = compat.animate(
          pieceButtons[0],
          [
            { transform: "translateY(0)", opacity: 1, offset: 0 },
            { transform: "translateY(30%)", opacity: 1, offset: 0.35 },
            { transform: "translateY(110%)", opacity: 0, offset: 1 },
          ],
          {
            delay: settlement ? 0 : 120,
            duration: 780,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "both",
          },
        );
        await escapeAnimation.finished;
      }
      if (
        revision !== winRevision ||
        disposed ||
        paused ||
        choosing ||
        !visible
      )
        return;
      escapeAnimation = null;
      winPending = false;
      escaped = true;
      renderResult();
      if (!reduced.matches)
        coverAnimation = compat.animate(
          cover,
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, easing: "ease-out" },
        );
      next.focus({ preventScroll: true });
    }
    function showChooser() {
      tick();
      cancelDrag();
      stopWin();
      confirming = false;
      choosing = true;
      save();
      render();
      chapterButtons[data.chapter].focus({ preventScroll: true });
    }
    function openLevel(id) {
      tick();
      cancelDrag();
      stopWin();
      data.current = id;
      data.chapter = level().chapter;
      data.drafts[id] ||= rules.create(level());
      choosing = false;
      confirming = false;
      selected = null;
      stamp = performance.now();
      save();
      render();
      board.focus({ preventScroll: true });
    }
    function reset() {
      cancelDrag();
      stopWin();
      data.drafts[data.current] = rules.create(level());
      confirming = false;
      selected = null;
      stamp = performance.now();
      save();
      render();
      board.focus({ preventScroll: true });
    }
    function playable() {
      return (
        !paused &&
        !disposed &&
        visible &&
        !choosing &&
        !confirming &&
        state() &&
        !rules.won(state())
      );
    }
    function play(piece, direction) {
      if (!playable()) return false;
      if (!drag) stopDragMotion();
      const dragged = drag?.element;
      const [dx, dy] = rules.directions[direction];
      const wins = piece === 0 && state().positions[0] + dx + 4 * dy === 13;
      const from = wins ? dragged?.getBoundingClientRect() : null;
      tick();
      if (!rules.move(level(), state(), piece, direction)) return false;
      if (drag) drag.dirty = true;
      if (drag && !rules.won(state())) {
        const p = state().positions[piece];
        dragged.style.setProperty("--piece-x", String(p % 4));
        dragged.style.setProperty("--piece-y", String(Math.floor(p / 4)));
        drag.allowed = legalDragDirections(piece);
        const count = String(state().path.length);
        if (moves.value.textContent !== count) moves.value.textContent = count;
        undo.disabled = false;
        return true;
      }
      if (rules.won(state())) {
        archive.addCompletion(data, data.current, state().path);
        if (rules.better(state(), data.completed[data.current]))
          data.completed[data.current] = JSON.parse(JSON.stringify(state()));
        cancelDrag();
        dragged?.classList.add("is-settling");
        selected = null;
        winPending = true;
        escaped = false;
      }
      save();
      render();
      if (rules.won(state())) {
        void finishWin(
          ++winRevision,
          dragged ? settlePiece(dragged, from) : null,
        );
      }
      return true;
    }
    function title(entry) {
      const number = levels.findIndex((l) => l.id === entry.id) + 1;
      return entry.classic === undefined
        ? t("level", { number })
        : t("classic" + entry.classic);
    }
    function renderStats() {
      if (!state()) return;
      const record = data.completed[data.current];
      for (const [entry, label, value] of [
        [moves, "moves", state().path.length],
        [time, "time", clock(state().elapsed)],
        [
          best,
          "best",
          record ? record.path.length + " / " + clock(record.elapsed) : "—",
        ],
      ]) {
        entry.label.textContent = t(label);
        entry.value.textContent = String(value);
      }
    }
    function renderBoard() {
      if (!state()) return;
      board.setAttribute("aria-label", t("board"));
      pieceButtons.forEach((el, i) => {
        const [w, h] = level().pieces[i],
          p = state().positions[i];
        el.style.setProperty("--piece-x", String(p % 4));
        el.style.setProperty("--piece-y", String(Math.floor(p / 4)));
        el.style.setProperty("--piece-w", String(w));
        el.style.setProperty("--piece-h", String(h));
        el.dataset.kind =
          i === 0
            ? "cao"
            : w * h === 1
              ? "soldier"
              : w === 2
                ? "horizontal"
                : "vertical";
        const name = t(
          i === 0 ? "cao" : w * h === 1 ? "soldier" : "general" + i,
        );
        el.textContent = name;
        el.setAttribute(
          "aria-label",
          t("piece", { name, row: Math.floor(p / 4) + 1, column: (p % 4) + 1 }),
        );
        el.setAttribute("aria-pressed", String(i === selected));
      });
      exit.textContent = t("exit");
    }
    function renderResult() {
      if (!state()) return;
      const solved = rules.won(state());
      boardHost.classList.toggle("is-escaping", winPending);
      boardHost.classList.toggle("is-escaped", escaped);
      cover.hidden = !confirming && (!solved || winPending);
      board.inert = !cover.hidden || winPending;
      coverTitle.textContent = t(confirming ? "confirm" : "won");
      result.textContent = confirming
        ? t("confirmRestart")
        : t("result", {
            moves: state().path.length,
            time: clock(state().elapsed),
          });
      cancel.hidden = !confirming;
      next.hidden = confirming;
      back.hidden = confirming;
      cancel.textContent = t("cancel");
      accept.textContent = t(confirming ? "restart" : "again");
      next.textContent = t("next");
      back.textContent = t("choose");
      status.textContent = solved && !winPending ? t("won") : "";
    }
    function render() {
      playLayout.hidden = choosing;
      catalog.page.hidden = !choosing;
      root.dataset.choosing = String(choosing);
      catalog.refresh();
      catalog.selectCategory(data.chapter + ":" + data.classics);
      catalog.setReturn(
        data.current
          ? () => {
              if (!paused && !disposed) openLevel(data.current);
            }
          : null,
      );
      chapterButtons.forEach((el, i) => {
        el.replaceChildren();
        node("strong", "", el).textContent = t("group", {
          difficulty: t("difficulty" + rules.groups[i].difficulty),
          number: rules.groups[i].part,
        });
        node("span", "", el).textContent = t("count", {
          count: levels.filter((l) => l.chapter === i && data.completed[l.id])
            .length,
          total: levels.filter((l) => l.chapter === i).length,
        });
        el.setAttribute("aria-pressed", String(i === data.chapter));
      });
      filter.textContent = t("classics");
      filter.setAttribute("aria-pressed", String(data.classics));
      warning.textContent = failed ? t("saveFailed") : "";
      if (choosing) {
        const entries = levels.filter(
          (l) =>
            l.chapter === data.chapter &&
            (!data.classics || l.classic !== undefined),
        );
        progress.textContent =
          t("group", {
            difficulty: t("difficulty" + rules.groups[data.chapter].difficulty),
            number: rules.groups[data.chapter].part,
          }) +
          " · " +
          t("count", {
            count: entries.filter((l) => data.completed[l.id]).length,
            total: entries.length,
          });
        grid.replaceChildren();
        if (!entries.length)
          node("p", "klotski-empty", grid).textContent = t("noClassics");
        entries.forEach((entry) => {
          const card = node("button", "game-button klotski-level", grid);
          card.type = "button";
          card.dataset.klotskiLevel = entry.id;
          G.paintLevelCard(card, {
            number: levels.indexOf(entry) + 1,
            label: title(entry),
            complete: !!data.completed[entry.id],
            draft: !!data.drafts[entry.id]?.started,
            current: data.current === entry.id,
          });
          if (entry.classic !== undefined) {
            node("span", "klotski-classic-name", card).textContent =
              title(entry);
          }
          card.addEventListener("click", () => {
            if (!paused && !disposed) openLevel(entry.id);
          });
        });
        return;
      }
      eyebrow.textContent = t("group", {
        difficulty: t("difficulty" + level().difficulty),
        number: rules.groups[level().chapter].part,
      });
      heading.textContent = title(level());
      for (const [el, name] of [
        [choose, "choose"],
        [undo, "undo"],
        [restart, "restart"],
      ]) {
        el.title = t(name);
        el.setAttribute("aria-label", t(name));
      }
      choose.disabled = confirming;
      undo.disabled = confirming || !state().path.length;
      restart.disabled = confirming;
      renderStats();
      renderBoard();
      renderResult();
    }
    listen(board, "pointerdown", (event) => {
      if (!playable() || event.button !== 0 || !event.isPrimary) return;
      const piece = event.target.closest("[data-piece]");
      if (!piece) return;
      const heldPosition = piece.getBoundingClientRect();
      if (event.pointerType !== "touch") event.preventDefault();
      cancelDrag();
      suppressPointerClick = false;
      selected = Number(piece.dataset.piece);
      piece.focus({ preventScroll: true });
      drag = {
        id: event.pointerId,
        piece: selected,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        element: piece,
        cell: tiles.getBoundingClientRect().width / 4,
        allowed: legalDragDirections(selected),
        dirty: false,
        points: [],
        frame: 0,
      };
      board.setPointerCapture(event.pointerId);
      board.classList.add("is-dragging");
      piece.classList.add("is-dragged");
      renderBoard();
      const target = piece.getBoundingClientRect();
      const offsetX = heldPosition.left - target.left,
        offsetY = heldPosition.top - target.top;
      drag.x -= offsetX;
      drag.y -= offsetY;
      piece.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    });
    listen(board, "pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id || !playable()) return;
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3
      )
        suppressPointerClick = true;
      const coalesced = event.getCoalescedEvents?.() || [];
      for (const point of coalesced.length ? coalesced : [event])
        drag.points.push({ clientX: point.clientX, clientY: point.clientY });
      if (drag.points.length > 64)
        drag.points.splice(0, drag.points.length - 64);
      if (!drag.frame) drag.frame = window.requestAnimationFrame(flushDrag);
    });
    listen(board, "pointerup", finishDrag);
    for (const event of ["pointercancel", "lostpointercapture"])
      listen(board, event, (event) => {
        if (drag && event.pointerId === drag.id) cancelDrag();
      });
    listen(board, "click", (event) => {
      if (event.detail && suppressPointerClick) {
        suppressPointerClick = false;
        return;
      }
      if (!playable()) return;
      const piece = event.target.closest("[data-piece]");
      if (piece) {
        selected = Number(piece.dataset.piece);
        renderBoard();
        return;
      }
      if (selected === null) return;
      const rect = tiles.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) / (rect.width / 4));
      const y = Math.floor((event.clientY - rect.top) / (rect.height / 5));
      const p = state().positions[selected],
        [w, h] = level().pieces[selected];
      if (x >= p % 4 && x < (p % 4) + w) {
        if (y < Math.floor(p / 4)) play(selected, "u");
        else if (y >= Math.floor(p / 4) + h) play(selected, "d");
      } else if (y >= Math.floor(p / 4) && y < Math.floor(p / 4) + h) {
        if (x < p % 4) play(selected, "l");
        else if (x >= (p % 4) + w) play(selected, "r");
      }
    });
    listen(board, "keydown", (event) => {
      if (!playable() || drag || event.altKey || event.ctrlKey || event.metaKey)
        return;
      if (event.key === "Escape") {
        selected = null;
        renderBoard();
        return;
      }
      const focused = event.target.closest("[data-piece]");
      if (["Enter", " "].includes(event.key) && focused) {
        event.preventDefault();
        selected = Number(focused.dataset.piece);
        renderBoard();
        return;
      }
      const direction = {
        ArrowLeft: "l",
        ArrowRight: "r",
        ArrowUp: "u",
        ArrowDown: "d",
      }[event.key];
      if (direction) {
        event.preventDefault();
        if (selected === null && focused)
          selected = Number(focused.dataset.piece);
        if (selected !== null) play(selected, direction);
      }
    });
    listen(document, "visibilitychange", () => {
      tick();
      visible = !document.hidden;
      cancelDrag();
      if (!visible) {
        stopWin();
        renderResult();
      }
      save();
    });
    listen(document, "worktime:languagechange", render);
    const releaseMotionPreference = compat.listen(reduced, () => {
      cancelDrag();
      if (winPending || coverAnimation) {
        stopWin();
        renderResult();
      }
    });
    const timer = setInterval(() => {
      tick();
      if (!choosing) renderStats();
      if (state()?.started && !paused && visible && !drag) save();
    }, 1000);
    function dispose() {
      if (disposed) return;
      tick();
      cancelDrag();
      stopWin();
      releaseMotionPreference();
      disposed = true;
      clearInterval(timer);
      save();
    }
    signal.addEventListener("abort", dispose, { once: true });
    render();
    return {
      pause() {
        tick();
        cancelDrag();
        stopWin();
        paused = true;
        renderResult();
        save();
      },
      resume() {
        paused = false;
        stamp = performance.now();
      },
      resize() {
        cancelDrag();
        if (winPending) {
          stopWin();
          renderResult();
        }
      },
      dispose,
    };
  },
});
