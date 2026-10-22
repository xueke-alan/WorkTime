"use strict";
/** Keep grid corners stationary while the head and tail travel along the trail. */
WorkTimeApp.games.snakePath = function (
  body,
  previous,
  alpha,
  columns = WorkTimeApp.games.snakeRules.columns,
  rows = WorkTimeApp.games.snakeRules.rows,
) {
  const delta = (value, size) => value - Math.round(value / size) * size;
  const points = [{ x: body[0].x + 0.5, y: body[0].y + 0.5 }];
  for (let i = 1; i < body.length; i++) {
    const last = points.at(-1);
    points.push({
      x: last.x + delta(body[i].x - body[i - 1].x, columns),
      y: last.y + delta(body[i].y - body[i - 1].y, rows),
    });
  }
  if (previous === body || alpha >= 1) return points;
  const head = points[0];
  head.x -= delta(body[0].x - previous[0].x, columns) * (1 - alpha);
  head.y -= delta(body[0].y - previous[0].y, rows) * (1 - alpha);
  if (body.length === previous.length) {
    const tail = points.at(-1);
    points.push({
      x:
        tail.x -
        delta(body.at(-1).x - previous.at(-1).x, columns) * (1 - alpha),
      y: tail.y - delta(body.at(-1).y - previous.at(-1).y, rows) * (1 - alpha),
    });
  }
  return points;
};
WorkTimeApp.games.register({
  id: "game-snake",
  nameKey: "games.snake.name",
  descriptionKey: "games.snake.description",
  icon: "game-snake",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.snakeRules;
    const key = "worktime.games.snake.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.snake." + name, params);
    const reduced = WorkTimeApp.ui.animationCompat.preference();
    let state = rules.create(),
      best = { classic: 0, wrap: 0, rush: 0 },
      saveFailed = false;
    let paused = false,
      suspended = false,
      disposed = false,
      confirming = null;
    let frame = null,
      last = null,
      accumulator = 0,
      countdown = 0,
      queue = [],
      pointer = null;
    let previous = state.body,
      effects = [],
      impact = null,
      colors = {},
      lastSave = 0;
    let viewportSize = null;
    try {
      const restored = rules.restore(JSON.parse(gameStorage.getItem(key)));
      if (restored) {
        ({ state, best } = restored);
        paused = state.status === "playing";
      }
    } catch {
      saveFailed = true;
    }
    previous = state.body;
    function node(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    }
    const root = node("section", "game-snake game-session", container);
    const counters = node("div", "snake-counters game-hud", root);
    const meters = ["score", "best", "length", "combo"].map((name) => {
      const box = node("div", "game-stat", counters);
      return {
        name,
        label: node("span", "", box),
        value: node("strong", "", box),
      };
    });
    const controls = node("div", "snake-controls game-controls", root);
    const modeHost = node("div", "snake-mode", controls);
    const modeLabel = node("label", "game-sr-only", modeHost);
    modeLabel.id = "snakeModeLabel";
    const select = node("select", "", modeHost);
    select.id = "snakeMode";
    Object.keys(rules.modes).forEach((mode) => {
      const option = node("option", "", select);
      option.value = mode;
    });
    const picker = WorkTimeApp.games.createSelect({
      host: modeHost,
      select,
      label: modeLabel,
      signal,
    });
    const listen = (target, event, callback, options = {}) =>
      target.addEventListener(event, callback, { ...options, signal });
    function button(parent, action, callback, icon) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.snakeAction = action;
      if (icon) element.append(WorkTimeApp.games.createIcon(icon));
      const activate = () => {
        if (!disposed && !suspended && !signal.aborted) callback();
      };
      let touch = null,
        lastTouch = -Infinity;
      listen(element, "pointerdown", (event) => {
        if (event.pointerType === "touch")
          touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      listen(element, "pointerup", (event) => {
        if (!touch || touch.id !== event.pointerId) return;
        const tap =
          Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 12;
        touch = null;
        if (tap) {
          event.preventDefault();
          lastTouch = performance.now();
          activate();
        }
      });
      listen(element, "pointercancel", () => (touch = null));
      listen(element, "click", (event) => {
        if (event.detail && performance.now() - lastTouch < 600) return;
        activate();
      });
      return element;
    }
    const pauseButton = button(controls, "pause", togglePause, "pause");
    const restart = button(
      controls,
      "restart",
      () => requestNew(state.mode),
      "restart-alt",
    );
    pauseButton.classList.add("game-icon-button");
    restart.classList.add("game-icon-button");
    const stage = node("div", "snake-stage", root);
    const board = node("div", "snake-board", stage);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const canvas = node("canvas", "", board);
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    const cover = node("div", "snake-cover", board);
    const coverTitle = node("h3", "", cover);
    const coverHint = node("p", "", cover);
    const coverActions = node("div", "snake-cover-actions", cover);
    const cancel = button(coverActions, "cancel", () => {
      confirming = null;
      paused = state.status === "playing";
      render();
      pauseButton.focus();
    });
    const start = button(coverActions, "start", () => {
      if (confirming) newGame(confirming);
      else if (["won", "lost"].includes(state.status)) newGame(state.mode);
      else begin();
    });
    const pad = node("div", "snake-pad", root);
    const arrows = {
      up: "arrow-upward",
      left: "arrow-back",
      down: "arrow-downward",
      right: "arrow-forward",
    };
    const padButtons = Object.keys(arrows).map((direction) => {
      const b = button(
        pad,
        direction,
        () => turn(direction),
        arrows[direction],
      );
      b.classList.add("game-icon-button");
      return b;
    });
    const notice = node("div", "game-notice", root);
    const warning = node("p", "", notice);
    warning.setAttribute("role", "status");
    const help = WorkTimeApp.games.createHelp({
      root,
      controls,
      signal,
      text: () => t("help"),
      onChange(open) {
        if (open && state.status === "playing") {
          paused = true;
          stopLoop();
          save();
          render();
        }
      },
    });
    function save() {
      best[state.mode] = Math.max(best[state.mode], state.score);
      try {
        gameStorage.setItem(key, JSON.stringify({ version: 1, state, best }));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      lastSave = performance.now();
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
    }
    function stopLoop() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      last = null;
      accumulator = 0;
      countdown = 0;
      queue = [];
      pointer = null;
      effects = [];
      impact = null;
      cover.style.opacity = "";
      cover.inert = false;
      previous = state.body;
      draw(1);
    }
    function begin() {
      if (help.isOpen() || suspended) return;
      stopLoop();
      paused = false;
      state.status = "playing";
      countdown = 1800;
      render();
      board.focus({ preventScroll: true });
      schedule();
    }
    function togglePause() {
      if (confirming || help.isOpen()) return;
      if (state.status === "ready") {
        begin();
        return;
      }
      if (state.status !== "playing") return;
      if (paused) begin();
      else {
        paused = true;
        stopLoop();
        save();
        render();
      }
    }
    function requestNew(mode) {
      picker.close();
      select.value = state.mode;
      picker.sync();
      if (state.status === "playing") {
        paused = true;
        stopLoop();
        confirming = mode;
        render();
        cancel.focus();
      } else newGame(mode);
    }
    function newGame(mode) {
      stopLoop();
      state = rules.create(mode);
      previous = state.body;
      confirming = null;
      paused = false;
      save();
      render();
      if (viewportSize) resize(viewportSize);
      board.focus({ preventScroll: true });
    }
    function turn(direction) {
      if (
        suspended ||
        disposed ||
        signal.aborted ||
        help.isOpen() ||
        confirming ||
        paused ||
        countdown > 0
      )
        return;
      if (state.status === "ready") begin();
      if (state.status !== "playing" || queue.length >= 2) return;
      if (rules.canTurn(queue.at(-1) || state.direction, direction))
        queue.push(direction);
    }
    function render() {
      root.dataset.status = state.status;
      root.dataset.paused = String(paused);
      modeLabel.textContent = t("mode");
      [...select.options].forEach(
        (option) => (option.textContent = t(option.value)),
      );
      select.value = state.mode;
      picker.sync();
      const values = [
        state.score,
        Math.max(best[state.mode], state.score),
        state.body.length,
        "×" + state.combo,
      ];
      meters.forEach((meter, i) => {
        meter.label.textContent = t(meter.name);
        WorkTimeApp.games.paintCounter(meter.value, values[i]);
      });
      pauseButton.disabled =
        ["lost", "won"].includes(state.status) || !!confirming;
      const pauseName =
        state.status === "ready" ? "start" : paused ? "resume" : "pause";
      WorkTimeApp.games.setIcon(
        pauseButton,
        pauseName === "pause" ? "pause" : "play-arrow",
      );
      pauseButton.title = t(pauseName);
      pauseButton.setAttribute("aria-label", t(pauseName));
      restart.title = t("restart");
      restart.setAttribute("aria-label", t("restart"));
      padButtons.forEach((b) =>
        b.setAttribute("aria-label", t(b.dataset.snakeAction)),
      );
      cover.hidden =
        (!confirming &&
          !paused &&
          state.status === "playing" &&
          countdown <= 0) ||
        (!!impact && impact.elapsed < impact.hold);
      const reveal = impact
        ? Math.max(0, Math.min(1, (impact.elapsed - impact.hold) / impact.fade))
        : 1;
      cover.style.opacity = String(reveal);
      cover.inert = reveal < 1;
      root.dataset.impact = String(!!impact);
      cover.dataset.counting = String(countdown > 0);
      coverActions.hidden = countdown > 0;
      coverHint.hidden = countdown > 0;
      cancel.hidden = !confirming;
      cancel.textContent = t("cancel");
      coverTitle.textContent =
        countdown > 0
          ? String(Math.ceil(countdown / 600))
          : t(confirming ? "confirm" : paused ? "paused" : state.status);
      coverHint.textContent = t(
        confirming
          ? "confirmHint"
          : state.status === "lost" || state.status === "won"
            ? "result"
            : "readyHint",
        { score: state.score },
      );
      start.textContent = t(
        confirming || ["lost", "won"].includes(state.status)
          ? "restart"
          : paused
            ? "resume"
            : "start",
      );
      warning.hidden = !saveFailed;
      warning.textContent = t("saveFailed");
      board.setAttribute(
        "aria-label",
        t("board", { score: state.score, length: state.body.length }),
      );
      help.refresh();
      readColors();
      draw(1);
    }
    function readColors() {
      const style = window.getComputedStyle(root);
      colors = {
        snake: style.getPropertyValue("--accent").trim() || "#24775f",
        ink: style.getPropertyValue("--ink").trim() || "#15392e",
        paper: style.getPropertyValue("--paper").trim() || "#fff",
        food: "#cf6651",
        bonus: "#ba831c",
      };
    }
    function draw(alpha) {
      const width = canvas.width;
      if (!width) return;
      ctx.clearRect(0, 0, width, canvas.height);
      const unit = width / state.columns;
      ctx.save();
      if (impact && !reduced.matches && impact.elapsed < 260) {
        const kick =
          Math.sin(impact.elapsed * 0.1) *
          (1 - impact.elapsed / 260) *
          unit *
          0.15;
        ctx.translate(kick * impact.dx, kick * impact.dy);
      }
      ctx.fillStyle = colors.snake;
      ctx.globalAlpha = 0.12;
      for (let y = 0; y < state.rows; y++)
        for (let x = 0; x < state.columns; x++) {
          ctx.beginPath();
          ctx.arc(
            (x + 0.5) * unit,
            (y + 0.5) * unit,
            Math.max(0.7, width / 650),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      ctx.globalAlpha = 1;
      function food(cell, bonus) {
        if (!cell) return;
        const x = (cell.x + 0.5) * unit,
          y = (cell.y + 0.5) * unit;
        ctx.fillStyle = bonus ? colors.bonus : colors.food;
        ctx.beginPath();
        if (bonus) {
          ctx.moveTo(x, y - unit * 0.39);
          ctx.lineTo(x + unit * 0.39, y);
          ctx.lineTo(x, y + unit * 0.39);
          ctx.lineTo(x - unit * 0.39, y);
          ctx.closePath();
        } else ctx.arc(x, y, unit * 0.3, 0, Math.PI * 2);
        ctx.fill();
        if (bonus) {
          ctx.strokeStyle = colors.bonus;
          ctx.lineWidth = unit * 0.07;
          ctx.beginPath();
          ctx.arc(
            x,
            y,
            unit * 0.48,
            -Math.PI / 2,
            -Math.PI / 2 + (Math.PI * 2 * cell.ttl) / (cell.duration || 65),
          );
          ctx.stroke();
          ctx.save();
          ctx.font = `600 ${unit * 0.4}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(
            "+" + 50 * Math.min(5, state.combo + 1),
            x,
            y + unit * (cell.y === state.rows - 1 ? -0.65 : 0.95),
          );
          ctx.restore();
        }
      }
      food(state.food, false);
      food(state.alternative, false);
      food(state.bonus, true);
      const points = WorkTimeApp.games.snakePath(
        state.body,
        previous,
        alpha,
        state.columns,
        state.rows,
      );
      // Draw wrapped copies rather than sweeping across the arena at a portal.
      const minX = Math.floor(
          (Math.min(...points.map((p) => p.x)) - 0.36) / state.columns,
        ),
        maxX = Math.floor(
          (Math.max(...points.map((p) => p.x)) + 0.36) / state.columns,
        ),
        minY = Math.floor(
          (Math.min(...points.map((p) => p.y)) - 0.36) / state.rows,
        ),
        maxY = Math.floor(
          (Math.max(...points.map((p) => p.y)) + 0.36) / state.rows,
        );
      for (let tileX = -maxX; tileX <= -minX; tileX++)
        for (let tileY = -maxY; tileY <= -minY; tileY++) {
          const ox = tileX * state.columns,
            oy = tileY * state.rows;
          ctx.strokeStyle =
            state.status === "lost" ? colors.food : colors.snake;
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = unit * 0.72;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          // Axis-aligned strips avoid whole-polyline stroke tessellation changing
          // the antialiasing of a stationary bend as distant endpoints move.
          const radius = unit * 0.36;
          points.forEach((p, i) => {
            const x = (p.x + ox) * unit,
              y = (p.y + oy) * unit;
            const next = points[i + 1],
              before = points[i - 1];
            if (next) {
              const nx = (next.x + ox) * unit,
                ny = (next.y + oy) * unit;
              if (p.y === next.y)
                ctx.fillRect(
                  Math.min(x, nx),
                  y - radius,
                  Math.abs(nx - x),
                  radius * 2,
                );
              else
                ctx.fillRect(
                  x - radius,
                  Math.min(y, ny),
                  radius * 2,
                  Math.abs(ny - y),
                );
            }
            if (
              !before ||
              !next ||
              (p.x - before.x) * (next.y - p.y) !==
                (p.y - before.y) * (next.x - p.x)
            ) {
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          });
          const head = points[0],
            [dx, dy] = rules.vectors[state.direction];
          // A subtle tint keeps the head distinct in every theme and on impact.
          ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
          ctx.beginPath();
          ctx.arc(
            (head.x + ox) * unit,
            (head.y + oy) * unit,
            radius,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.fillStyle = colors.paper;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(
              (head.x + ox + dx * 0.13 - dy * side * 0.16) * unit,
              (head.y + oy + dy * 0.13 + dx * side * 0.16) * unit,
              unit * 0.065,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      effects.forEach((effect) => {
        ctx.globalAlpha = Math.max(0, Math.min(1, effect.life / 350));
        ctx.fillStyle = effect.bonus ? colors.bonus : colors.food;
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4,
            distance =
              (1 - effect.life / (effect.bonus ? 700 : 350)) * unit * 1.4;
          ctx.fillRect(
            (effect.x + 0.5) * unit + Math.cos(angle) * distance,
            (effect.y + 0.5) * unit + Math.sin(angle) * distance,
            unit * 0.12,
            unit * 0.12,
          );
        }
        if (effect.bonus) {
          ctx.save();
          ctx.font = `700 ${unit * 0.55}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(
            `+${effect.points} · ×${effect.combo}`,
            (effect.x + 0.5) * unit,
            Math.max(
              unit,
              (effect.y - 0.3) * unit - (1 - effect.life / 700) * unit,
            ),
          );
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
      if (impact && impact.elapsed < impact.hold) {
        const progress = impact.elapsed / impact.hold;
        const x = (impact.x + 0.5) * unit,
          y = (impact.y + 0.5) * unit;
        ctx.globalAlpha = (1 - progress) * 0.8;
        ctx.fillStyle = colors.food;
        if (reduced.matches) {
          ctx.beginPath();
          ctx.arc(x, y, unit * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = colors.food;
          ctx.lineWidth = unit * 0.09;
          ctx.beginPath();
          ctx.arc(x, y, unit * (0.35 + progress * 1.15), 0, Math.PI * 2);
          ctx.stroke();
          for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4;
            const distance = unit * (0.3 + progress * 1.3);
            ctx.fillRect(
              x + Math.cos(angle) * distance - unit * 0.06,
              y + Math.sin(angle) * distance - unit * 0.06,
              unit * 0.12,
              unit * 0.12,
            );
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    function schedule() {
      if (
        frame === null &&
        !disposed &&
        !signal.aborted &&
        !suspended &&
        !paused &&
        (state.status === "playing" || impact)
      )
        frame = window.requestAnimationFrame(tick);
    }
    function tick(now) {
      frame = null;
      const delta = last === null ? 0 : Math.min(80, now - last);
      last = now;
      if (impact) {
        impact.elapsed += delta;
        if (impact.elapsed >= impact.hold + impact.fade) impact = null;
        render();
        schedule();
        return;
      }
      if (countdown > 0) {
        const numeral = Math.ceil(countdown / 600);
        countdown = Math.max(0, countdown - delta);
        if (Math.ceil(countdown / 600) !== numeral) render();
        schedule();
        return;
      }
      accumulator += delta;
      const duration = rules.interval(state);
      if (accumulator >= duration) {
        accumulator -= duration;
        previous = state.body;
        const old = state;
        state = rules.step(state, queue.shift() || state.direction);
        if (state.score !== old.score && !reduced.matches)
          effects.push({
            ...state.body[0],
            life: state.eaten === old.eaten ? 700 : 350,
            bonus: state.eaten === old.eaten,
            points: state.score - old.score,
            combo: state.combo,
          });
        best[state.mode] = Math.max(best[state.mode], state.score);
        if (state.status !== "playing") {
          previous = state.body;
          accumulator = 0;
          if (state.status === "lost") {
            const [dx, dy] = rules.vectors[state.direction];
            const contact = (value, extent) =>
              state.mode === "wrap"
                ? (value + extent) % extent
                : Math.max(0, Math.min(extent - 1, value));
            impact = {
              elapsed: 0,
              hold: reduced.matches ? 160 : 420,
              fade: reduced.matches ? 240 : 680,
              dx,
              dy,
              x: contact(state.body[0].x + dx, state.columns),
              y: contact(state.body[0].y + dy, state.rows),
            };
          }
          save();
        } else if (state.score !== old.score || now - lastSave > 3000) save();
        render();
      }
      effects.forEach((effect) => (effect.life -= delta));
      effects = effects.filter((effect) => effect.life > 0);
      draw(
        reduced.matches || state.status !== "playing"
          ? 1
          : Math.min(1, accumulator / rules.interval(state)),
      );
      schedule();
    }
    listen(select, "change", () => requestNew(select.value));
    listen(container, "keydown", (event) => {
      if (
        event.target.closest(".snake-mode, .game-help-screen") ||
        help.isOpen()
      )
        return;
      const direction = {
        ArrowUp: "up",
        w: "up",
        ArrowDown: "down",
        s: "down",
        ArrowLeft: "left",
        a: "left",
        ArrowRight: "right",
        d: "right",
      }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (direction) {
        event.preventDefault();
        if (!event.repeat) turn(direction);
      } else if (
        (event.code === "Space" &&
          (event.target === board || event.target === container)) ||
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        if (!event.repeat) togglePause();
      }
    });
    listen(board, "pointerdown", (event) => {
      if (event.target !== canvas || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      board.setPointerCapture(event.pointerId);
      board.focus({ preventScroll: true });
    });
    listen(board, "pointermove", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
      turn(
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up",
      );
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      listen(board, event, () => (pointer = null));
    listen(window, "blur", () => suspend());
    listen(document, "worktime:languagechange", render);
    const themeObserver = new MutationObserver(() => {
      readColors();
      draw(1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"],
    });
    function resize(size) {
      viewportSize = size;
      root.style.setProperty(
        "--snake-height",
        Math.max(440, size.height) + "px",
      );
      const available = stage.getBoundingClientRect();
      const cell = Math.max(
        6,
        Math.min(
          (available.width - 4) / state.columns,
          (available.height - 4) / state.rows,
          32,
        ),
      );
      const boardWidth = Math.floor(cell * state.columns),
        boardHeight = Math.floor(cell * state.rows);
      root.style.setProperty("--snake-width", boardWidth + "px");
      root.style.setProperty("--snake-board-height", boardHeight + "px");
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(boardWidth * ratio);
      canvas.height = Math.round(boardHeight * ratio);
      readColors();
      draw(1);
    }
    function suspend() {
      if (state.status === "playing") paused = true;
      stopLoop();
      save();
      render();
    }
    signal.addEventListener("abort", stopLoop, { once: true });
    render();
    return {
      resize,
      pause() {
        suspended = true;
        suspend();
      },
      resume() {
        suspended = false;
        render();
      },
      dispose() {
        if (disposed) return;
        save();
        disposed = true;
        stopLoop();
        themeObserver.disconnect();
        picker.close();
        root.remove();
      },
    };
  },
});
