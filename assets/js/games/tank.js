"use strict";
WorkTimeApp.games.register({
  id: "game-tank",
  nameKey: "games.tank.name",
  descriptionKey: "games.tank.description",
  icon: "game-tank",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.tankRules;
    const reduced = WorkTimeApp.ui.animationCompat.preference();
    // Shared bitmap lettering keeps the status rail and score popups consistent.
    const pixelGlyphs = {
      0: [14, 17, 19, 21, 25, 17, 14],
      1: [4, 12, 4, 4, 4, 4, 14],
      2: [14, 17, 1, 2, 4, 8, 31],
      3: [30, 1, 1, 14, 1, 1, 30],
      4: [2, 6, 10, 18, 31, 2, 2],
      5: [31, 16, 16, 30, 1, 1, 30],
      6: [14, 16, 16, 30, 17, 17, 14],
      7: [31, 1, 2, 4, 8, 8, 8],
      8: [14, 17, 17, 14, 17, 17, 14],
      9: [14, 17, 17, 15, 1, 1, 14],
      P: [30, 17, 17, 30, 16, 16, 16],
      "+": [0, 4, 4, 31, 4, 4, 0],
    };
    const helmetPixels = [
      "000011110000",
      "001122221100",
      "012222222210",
      "122233222221",
      "122233222221",
      "122222222221",
      "122222222221",
      "111111111111",
      "000000001100",
      "000000001100",
    ];
    const powerPixels = {
      helmet: helmetPixels,
      star: [
        "000001100000",
        "000011110000",
        "111111111111",
        "011111111110",
        "001111111100",
        "001111111100",
        "011110011110",
        "011000000110",
        "010000000010",
        "000000000000",
      ],
      shovel: [
        "000011110000",
        "000010010000",
        "000011110000",
        "000001100000",
        "000001100000",
        "000001100000",
        "000111111000",
        "000111111000",
        "000011110000",
        "000001100000",
      ],
      clock: [
        "000111111000",
        "001100001100",
        "011001100110",
        "010001100010",
        "010001111010",
        "010000000010",
        "010000000010",
        "011000000110",
        "001100001100",
        "000111111000",
      ],
      bomb: [
        "000000111100",
        "000001100110",
        "000001100000",
        "000111111000",
        "001111111100",
        "011133111110",
        "011133111110",
        "011111111110",
        "001111111100",
        "000111111000",
      ],
      life: [
        "000001100000",
        "000001100000",
        "110111111011",
        "110111111011",
        "111133331111",
        "111133331111",
        "111111111111",
        "110111111011",
        "110111111011",
        "110000000011",
      ],
    };
    const t = (key, params) => WorkTimeApp.i18n.t("games.tank." + key, params);
    const listen = (el, event, fn, options = {}) =>
      el.addEventListener(event, fn, { ...options, signal });
    let state = rules.create(),
      mode = "ready",
      paused = false,
      suspended = false,
      disposed = false;
    let frame = null,
      last = null,
      accumulator = 0,
      best = 0,
      saveFailed = false,
      muted = false,
      audio = null;
    let viewport = null;
    let custom = null,
      brush = 1,
      cursor = { x: 0, y: 0 },
      painting = null;
    const keys = new Map(),
      touch = new Map();
    const storage = "worktime.games.tank.v1";
    try {
      const saved = JSON.parse(gameStorage.getItem(storage));
      if (Number.isSafeInteger(saved?.best) && saved.best >= 0)
        best = saved.best;
      if (
        Array.isArray(saved?.custom) &&
        saved.custom.length === 2704 &&
        saved.custom.every((v) => Number.isInteger(v) && v >= 0 && v <= 5)
      )
        custom = saved.custom;
      muted = saved?.muted === true;
    } catch {
      saveFailed = true;
    }
    function node(tag, cls, parent) {
      const el = document.createElement(tag);
      el.className = cls;
      parent?.append(el);
      return el;
    }
    const root = node("section", "game-tank game-session", container);
    const playfield = node("div", "tank-layout", root);
    const hud = node("aside", "tank-counters game-hud", playfield);
    const meters = ["score", "best", "stage", "remaining"].map((key) => {
      const box = node("div", "game-stat", hud);
      return {
        key,
        label: node("span", "", box),
        value: node("strong", "", box),
      };
    });
    const controls = node("aside", "tank-controls game-controls", playfield);
    const pickers = [];
    function select(key, options) {
      const host = node("div", "tank-select", controls);
      const label = node("label", "game-sr-only", host);
      label.id = "tank-" + key + "-label";
      label.textContent = t(key);
      const el = node("select", "", host);
      el.id = "tank-" + key;
      el.dataset.tankSelect = key;
      options.forEach(([value, label]) => {
        const op = node("option", "", el);
        op.value = value;
        op.textContent = label;
      });
      const picker = WorkTimeApp.games.createSelect({
        host,
        select: el,
        label,
        signal,
      });
      pickers.push({ key, el, picker, label });
      return el;
    }
    const players = select("players", [
      [1, t("solo")],
      [2, t("duo")],
    ]);
    const stages = select(
      "stage",
      Array.from({ length: 35 }, (_, i) => [
        i + 1,
        t("stageOption", { n: i + 1 }),
      ]),
    );
    function button(parent, key, fn, icon) {
      const el = node(
        "button",
        "game-button" + (icon ? " game-icon-button" : ""),
        parent,
      );
      el.type = "button";
      el.dataset.tankAction = key;
      if (icon) el.append(WorkTimeApp.games.createIcon(icon));
      listen(el, "click", fn);
      return el;
    }
    const actions = node("div", "tank-actions", controls);
    const pauseButton = button(actions, "pause", togglePause, "pause");
    const restart = button(
      actions,
      "restart",
      () => start(state.custom),
      "restart-alt",
    );
    const sound = button(actions, "sound", () => {
      muted = !muted;
      unlockAudio();
      save();
      sync();
    });
    sound.classList.add("game-icon-button");
    const editor = button(controls, "editor", openEditor);
    const arena = node("div", "tank-arena", playfield);
    const board = node("div", "tank-board", arena);
    board.tabIndex = 0;
    board.setAttribute("role", "group");
    const canvas = node("canvas", "", board);
    canvas.width = 240 * 3;
    canvas.height = 208 * 3;
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const cover = node("div", "tank-cover", board);
    const eyebrow = node("span", "tank-eyebrow", cover);
    eyebrow.textContent = "BATTLE CITY";
    const heading = node("h3", "", cover),
      description = node("p", "", cover);
    const results = node("div", "tank-results", cover);
    const play = button(cover, "start", () => {
      if (mode === "clear") advance();
      else if (paused) {
        paused = false;
        sync();
        board.focus();
        loop();
      } else start(state.custom);
    });
    const editorBar = node("div", "tank-editor-bar", controls);
    editorBar.hidden = true;
    const brushShapes = node("div", "tank-brush-shapes", editorBar);
    const brushOptions = [
      [0, -1],
      [1, -1],
      [2, -1],
      [3, -1],
      [4, -1],
      [5, -1],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
    ];
    const brushes = brushOptions.map(([tile, side], i) => {
      const b = button(brushShapes, "brush" + i, () => {
        brush = i;
        sync();
      });
      b.dataset.brush = i;
      return b;
    });
    const clearMap = button(editorBar, "clearMap", () => {
      state.map = Array(2704).fill(0);
      rules.fence(state.map, 1);
      draw();
    });
    const testMap = button(editorBar, "testMap", () => {
      custom = [...state.map];
      save();
      start(true);
    });
    const cancelEditor = button(editorBar, "back", () => {
      mode = "ready";
      state = rules.create({
        stage: Number(stages.value),
        players: Number(players.value),
      });
      sync();
    });
    const touchBar = node("div", "tank-touch", playfield);
    const pad = node("div", "tank-pad", touchBar);
    const touchButtons = [0, 3, 2, 1].map((dir) => {
      const b = button(pad, "dir" + dir, () => {});
      b.textContent = ["↑", "→", "↓", "←"][dir];
      b.dataset.dir = dir;
      bindHold(b, { dir });
      return b;
    });
    const fireButton = button(touchBar, "fire", () => {});
    fireButton.classList.add("tank-fire");
    bindHold(fireButton, { fire: true });
    const feedback = node("p", "tank-feedback", root);
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const warning = node("p", "tank-warning", root);
    warning.setAttribute("role", "status");
    const help = WorkTimeApp.games.createHelp({
      root,
      controls: actions,
      signal,
      text: () => t("help"),
      onChange(open) {
        if (open) pause();
      },
    });
    function save() {
      best = Math.max(best, ...state.players.map((p) => p.score));
      try {
        const prior = JSON.parse(gameStorage.getItem(storage));
        if (Number.isSafeInteger(prior?.best))
          best = Math.max(best, prior.best);
        gameStorage.setItem(storage, JSON.stringify({ best, custom, muted }));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }
    function unlockAudio() {
      if (muted || disposed) return;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!audio && Audio) audio = new Audio();
        if (audio?.state === "suspended") void audio.resume().catch(() => {});
      } catch {
        /* Sound is optional on offline or restricted browsers. */
      }
    }
    function tone(event) {
      if (muted || !audio || audio.state !== "running") return;
      const frequencies = {
        shot: 180,
        hit: 90,
        explosion: 45,
        power: 660,
        life: 880,
        clear: 1046,
        start: 440,
      };
      const duration =
        event === "explosion" ? 0.22 : event === "shot" ? 0.05 : 0.11;
      const osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(
        frequencies[event] || 220,
        audio.currentTime,
      );
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(25, (frequencies[event] || 220) / 3),
        audio.currentTime + duration,
      );
      gain.gain.setValueAtTime(0.035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.currentTime + duration,
      );
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    }
    function clearInput() {
      keys.clear();
      touch.clear();
      painting = null;
    }
    function stop() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      last = null;
      accumulator = 0;
    }
    function active() {
      return (
        mode === "playing" &&
        !paused &&
        !suspended &&
        !disposed &&
        !signal.aborted &&
        !help.isOpen()
      );
    }
    function pause() {
      clearInput();
      if (mode === "playing") paused = true;
      stop();
      sync();
    }
    function togglePause() {
      if (mode !== "playing") return;
      if (paused) {
        paused = false;
        sync();
        board.focus();
        loop();
      } else pause();
    }
    function start(useCustom = false) {
      if (disposed || suspended || signal.aborted) return;
      if (mode === "editor" && !useCustom) return;
      stop();
      clearInput();
      unlockAudio();
      state = rules.create({
        players: Number(players.value),
        stage: Number(stages.value),
        custom: useCustom ? custom : null,
      });
      mode = "playing";
      paused = false;
      sync();
      tone("start");
      board.focus({ preventScroll: true });
      loop();
    }
    function advance() {
      stop();
      clearInput();
      state = rules.next(state);
      mode = "playing";
      paused = false;
      stages.value = String(((state.stage - 1) % 35) + 1);
      sync();
      tone("start");
      board.focus();
      loop();
    }
    function openEditor() {
      stop();
      clearInput();
      save();
      state = rules.create({ custom: custom || rules.mapFor(1) });
      mode = "editor";
      paused = false;
      sync();
      board.focus();
    }
    const mappings = [
      { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 },
      { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 },
    ];
    function inputs() {
      return state.players.map((_, p) => {
        const dirs = [...keys.keys()].filter(
          (code) =>
            mappings[p][code] !== undefined ||
            (state.playerCount === 1 && mappings[1][code] !== undefined),
        );
        const code = dirs.at(-1);
        let dir = code ? (mappings[p][code] ?? mappings[1][code]) : undefined;
        let fire =
          keys.has(p === 0 ? "KeyJ" : "Enter") ||
          (p === 0 && (keys.has("Space") || keys.has("KeyK")));
        if (p === 0)
          for (const held of touch.values()) {
            if (held.dir !== undefined) dir = held.dir;
            if (held.fire) fire = true;
          }
        return { dir, fire };
      });
    }
    function loop(now) {
      frame = null;
      if (!active()) return;
      if (now !== undefined) {
        if (last !== null) accumulator += Math.min(0.1, (now - last) / 1000);
        last = now;
        while (accumulator >= 1 / 60 && active()) {
          rules.step(state, inputs());
          accumulator -= 1 / 60;
          for (const event of new Set(state.events)) tone(event);
          if (
            state.status !== "playing" &&
            !state.effects.some((effect) => effect.big && effect.life > 0.1)
          ) {
            mode = state.status;
            clearInput();
            save();
            sync();
            play.focus({ preventScroll: true });
            break;
          }
        }
        paintCounters();
        draw();
      }
      if (active()) frame = window.requestAnimationFrame(loop);
    }
    function bindHold(el, value) {
      listen(el, "pointerdown", (e) => {
        if (!active()) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        touch.set(e.pointerId, value);
        board.focus({ preventScroll: true });
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        listen(el, event, (e) => touch.delete(e.pointerId));
    }
    function paintCounters() {
      const values = [
        state.players.reduce((sum, p) => sum + p.score, 0),
        Math.max(best, ...state.players.map((p) => p.score)),
        state.stage,
        20 - state.destroyed,
      ];
      meters.forEach((m, i) => {
        if (m.value.textContent !== String(values[i]))
          m.value.textContent = values[i];
      });
      root.dataset.mode = mode;
      root.dataset.paused = String(paused || suspended);
    }
    function sync() {
      paintCounters();
      meters.forEach((m) => (m.label.textContent = t(m.key)));
      pickers.forEach(({ key, el, picker, label }) => {
        label.textContent = t(key);
        [...el.options].forEach(
          (op, i) =>
            (op.textContent =
              key === "players"
                ? t(i ? "duo" : "solo")
                : t("stageOption", { n: i + 1 })),
        );
        el.disabled = mode !== "ready" && mode !== "over";
        picker.sync();
      });
      const isPaused = paused || suspended;
      pauseButton.disabled = mode !== "playing";
      pauseButton.title = t(isPaused ? "resume" : "pause");
      pauseButton.setAttribute("aria-label", pauseButton.title);
      WorkTimeApp.games.setIcon(pauseButton, isPaused ? "play-arrow" : "pause");
      restart.title = t("restart");
      restart.setAttribute("aria-label", restart.title);
      restart.disabled = mode === "editor";
      sound.title = t(muted ? "unmute" : "mute");
      sound.setAttribute("aria-label", sound.title);
      sound.setAttribute("aria-pressed", String(!muted));
      sound.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/>${muted ? '<path d="m16 9 5 6m0-6-5 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</g></svg>`;
      editor.textContent = t("editor");
      editor.disabled = mode === "editor";
      editorBar.hidden = mode !== "editor";
      touchBar.hidden = mode === "editor";
      brushes.forEach((b, i) => {
        const [tile, side] = brushOptions[i];
        b.textContent =
          t("tile" + tile) + (side < 0 ? "" : " " + ["↑", "→", "↓", "←"][side]);
        b.setAttribute("aria-pressed", String(brush === i));
      });
      for (const [b, key] of [
        [clearMap, "clearMap"],
        [testMap, "testMap"],
        [cancelEditor, "back"],
      ])
        b.textContent = t(key);
      touchButtons.forEach((b) =>
        b.setAttribute("aria-label", t("dir" + b.dataset.dir)),
      );
      fireButton.textContent = t("fire");
      cover.hidden = mode === "editor" || (mode === "playing" && !isPaused);
      cover.dataset.result = String(mode === "over" || mode === "clear");
      heading.textContent = t(
        mode === "over"
          ? "over"
          : mode === "clear"
            ? "clear"
            : isPaused
              ? "paused"
              : "name",
      );
      description.textContent = t(
        mode === "over"
          ? state.reason === "base"
            ? "baseLost"
            : "livesLost"
          : mode === "clear"
            ? "clearText"
            : isPaused
              ? "pauseText"
              : "intro",
      );
      results.replaceChildren();
      if (mode === "clear" || mode === "over")
        state.players.forEach((p, i) => {
          const row = node("p", "", results);
          row.textContent = `${i + 1}P  ·  ${p.score}  ·  ${p.kills.map((n, k) => `${(k + 1) * 100}×${n}`).join("  ")}${state.bonusPlayer === i ? "  ★ +1000" : ""}`;
        });
      play.textContent = t(
        mode === "clear"
          ? "next"
          : mode === "over"
            ? "again"
            : isPaused
              ? "resume"
              : "start",
      );
      feedback.textContent = t(
        mode === "editor"
          ? "editorHint"
          : state.playerCount === 2
            ? "duoKeys"
            : "keys",
      );
      warning.textContent = saveFailed ? t("saveFailed") : "";
      board.setAttribute(
        "aria-label",
        t(mode === "editor" ? "editorBoard" : "board", {
          stage: state.stage,
          remaining: 20 - state.destroyed,
        }),
      );
      help.refresh();
      if (viewport) layout(viewport);
      draw();
    }
    function rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    }
    function pixelText(text, x, y, color = "#202e25") {
      [...String(text)].forEach((character, index) => {
        pixelGlyphs[character]?.forEach((row, dy) => {
          for (let dx = 0; dx < 5; dx++)
            if (row & (1 << (4 - dx)))
              rect(x + index * 6 + dx, y + dy, 1, 1, color);
        });
      });
    }
    function drawEffect(e) {
      const age = e.total - e.life;
      const progress = age / e.total;
      const seed = e.seed || 0;
      const calm = reduced.matches;
      ctx.save();
      if (!e.big) {
        // Tiny, directional-looking sparks distinguish a hit from a kill.
        ctx.globalAlpha = 1 - progress;
        for (let i = 0; i < (calm ? 3 : 5); i++) {
          const angle = i * 2.4 + seed * 6;
          const r = calm ? 2 : 2 + progress * 6;
          rect(
            e.x + Math.cos(angle) * r,
            e.y + Math.sin(angle) * r,
            1,
            1,
            "#ffc06a",
          );
        }
        rect(e.x - 1, e.y - 1, 2, 2, "#ffe9ae");
        ctx.restore();
        return;
      }
      // Smoke is behind the fire, in stepped pixel clusters rather than blur.
      if (age > 0.12) {
        const smoke = (age - 0.12) / 0.6;
        ctx.globalAlpha = Math.min(0.48, smoke * 2) * (1 - smoke);
        for (let i = 0; i < 5; i++) {
          const angle = i * 2.4 + seed * 6;
          const distance = calm ? 3 : 3 + smoke * 9;
          const radius = 3 + Math.floor(smoke * 4);
          const x = e.x + Math.cos(angle) * distance;
          const y = e.y + Math.sin(angle) * distance - (calm ? 0 : smoke * 7);
          rect(
            x - radius,
            y - radius + 2,
            radius * 2,
            radius * 2 - 4,
            "#82877d",
          );
          rect(
            x - radius + 2,
            y - radius,
            radius * 2 - 4,
            radius * 2,
            "#82877d",
          );
        }
      }
      // A single local flash gives the impact weight without flashing the screen.
      if (age < 0.07) {
        ctx.globalAlpha = calm ? 0.55 : 1 - age / 0.1;
        const r = calm ? 5 : 6 + Math.floor(age * 70);
        rect(
          e.x - r,
          e.y - r + 2,
          r * 2,
          r * 2 - 4,
          calm ? "#f6b75b" : "#fff2c4",
        );
        rect(
          e.x - r + 2,
          e.y - r,
          r * 2 - 4,
          r * 2,
          calm ? "#f6b75b" : "#fff2c4",
        );
      }
      // A broken octagonal shock ring expands around the fireball.
      if (!calm && age > 0.035 && age < 0.32) {
        const wave = (age - 0.035) / 0.285;
        const radius = 7 + wave * 17;
        ctx.globalAlpha = (1 - wave) * 0.7;
        for (let i = 0; i < 24; i++) {
          const angle = (i * Math.PI) / 12;
          rect(
            e.x + Math.cos(angle) * radius,
            e.y + Math.sin(angle) * radius,
            2,
            2,
            "#edbc78",
          );
        }
      }
      // Three nested, irregular fire layers expand then collapse into embers.
      if (age < 0.4) {
        const bloom = age / 0.4;
        const radius = calm ? 7 : 4 + Math.sin(Math.PI * bloom) * 10;
        ctx.globalAlpha = Math.min(1, (1 - bloom) * 2.5);
        for (let layer = 0; layer < 3; layer++) {
          const r = Math.max(3, Math.round(radius * (1 - layer * 0.28)));
          const color = ["#c64c2e", "#f39a3c", "#ffe5a0"][layer];
          rect(e.x - r, e.y - r + 2, r * 2, r * 2 - 4, color);
          rect(e.x - r + 2, e.y - r, r * 2 - 4, r * 2, color);
          if (layer === 0 && !calm)
            for (let i = 0; i < 6; i++) {
              const angle = (i * Math.PI) / 3 + seed * 6;
              rect(
                e.x + Math.cos(angle) * r - 2,
                e.y + Math.sin(angle) * r - 2,
                4,
                4,
                color,
              );
            }
        }
      }
      if (!calm) {
        ctx.globalAlpha = Math.min(1, (1 - progress) * 2);
        for (let i = 0; i < 10; i++) {
          const angle = i * 2.4 + seed * 6;
          const speed = 15 + (i % 4) * 5;
          const distance = (1 - Math.exp(-age * 5)) * speed;
          const x = e.x + Math.cos(angle) * distance;
          const y = e.y + Math.sin(angle) * distance + age * age * 13;
          const side = i % 3 === 0 ? 2 : 1;
          rect(
            x,
            y,
            side,
            side,
            age < 0.3 ? (i % 2 ? "#ffcf71" : "#f08a3d") : "#a1987c",
          );
        }
      }
      if (e.points && age > 0.12) {
        ctx.globalAlpha = Math.min(1, e.life / 0.18);
        const text = "+" + e.points;
        const width = text.length * 6 - 1;
        const y = Math.max(1, Math.round(e.y - 21 - (calm ? 0 : progress * 9)));
        const x = Math.max(
          1,
          Math.min(207 - width, Math.round(e.x - width / 2)),
        );
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ])
          pixelText(text, x + dx, y + dy, "#101311");
        pixelText(text, x, y, "#ffe4a1");
      }
      ctx.restore();
    }
    function drawArrival(tank, progress) {
      const x = tank.x + 7,
        y = tank.y + 7;
      const calm = reduced.matches;
      const color =
        tank.player === 0
          ? "#f3d47c"
          : tank.player === 1
            ? "#b2de8b"
            : "#a6d9e4";
      const fade = Math.min(1, (1 - progress) * 4);
      ctx.save();
      ctx.globalAlpha = fade * 0.8;
      // Four corner brackets focus on the spawn pad, then release the tank.
      const radius = calm
        ? 9
        : Math.round(
            progress < 0.6 ? 17 - progress * 13 : 9 + (progress - 0.6) * 10,
          );
      for (const dx of [-1, 1])
        for (const dy of [-1, 1]) {
          const left = x + dx * radius - (dx > 0 ? 4 : 0);
          const top = y + dy * radius;
          rect(left, top, 5, 1, color);
          rect(x + dx * radius, top - (dy > 0 ? 4 : 0), 1, 5, color);
        }
      if (calm) {
        ctx.globalAlpha = fade * 0.18;
        rect(x - 7, y - 7, 14, 14, color);
      } else {
        // Inward sparks and one compact charge bloom precede materialization.
        if (progress < 0.62) {
          const distance = 3 + (1 - progress / 0.62) * 15;
          ctx.globalAlpha = Math.sin((Math.PI * progress) / 0.75) * 0.85;
          for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4 + (tank.id % 3) * 0.2;
            rect(
              x + Math.cos(angle) * distance,
              y + Math.sin(angle) * distance,
              i % 2 ? 1 : 2,
              i % 2 ? 1 : 2,
              color,
            );
          }
        }
        if (progress > 0.18 && progress < 0.55) {
          const charge = Math.sin(((progress - 0.18) / 0.37) * Math.PI);
          const r = 2 + Math.round(charge * 3);
          ctx.globalAlpha = charge * 0.75;
          rect(x - r, y - 2, r * 2, 4, color);
          rect(x - 2, y - r, 4, r * 2, color);
          rect(x - 1, y - 1, 2, 2, "#fff1c5");
        }
        if (progress > 0.42) {
          const scan = Math.min(1, (progress - 0.42) / 0.58);
          const line = Math.round(tank.y + 14 * (1 - scan));
          ctx.globalAlpha = fade * 0.65;
          rect(tank.x - 1, line, 16, 1, color);
          ctx.globalAlpha = fade * 0.16;
          rect(tank.x - 1, line - 1, 16, 3, color);
        }
      }
      ctx.restore();
    }
    function drawTank(tank) {
      const { x, y, dir, type, player } = tank;
      const arriving = tank.spawn > 0 || (player >= 0 && tank.arrival > 0);
      const progress =
        tank.spawn > 0 ? 1 - tank.spawn / 0.9 : 1 - tank.arrival / 0.55;
      if (arriving) drawArrival(tank, progress);
      if (tank.spawn > 0 && progress < 0.42 && !reduced.matches) return;
      ctx.save();
      if (tank.spawn > 0) {
        ctx.globalAlpha = reduced.matches
          ? 0.45 + progress * 0.55
          : 0.5 + progress * 0.5;
        if (!reduced.matches) {
          const reveal = Math.min(1, (progress - 0.42) / 0.58);
          ctx.beginPath();
          ctx.rect(x - 2, y + 14 * (1 - reveal), 18, 16 * reveal);
          ctx.clip();
        }
      }
      ctx.save();
      ctx.translate(Math.round(x + 7), Math.round(y + 7));
      ctx.rotate((dir * Math.PI) / 2);
      const carrier = tank.carrier && Math.floor(state.time * 5) % 2;
      const body = carrier
        ? "#ef5751"
        : player === 0
          ? "#e6bf53"
          : player === 1
            ? "#87bf65"
            : type === 3
              ? ["#ddd", "#c5bb69", "#8cbf64", "#67a85b"][tank.hp - 1]
              : "#c9cdd0";
      rect(-7, -7, 4, 14, "#686960");
      rect(3, -7, 4, 14, "#686960");
      for (let y = -7; y < 7; y += 3) {
        const shift = Math.floor(tank.tread / 2) % 2;
        rect(-7, y + shift, 3, 1, body);
        rect(4, y + shift, 3, 1, body);
      }
      const model = player >= 0 ? tank.level : type;
      rect(-3, -5, 6, 11, body);
      rect(-4, -2, 8, 6, body);
      if (model === 1) {
        // Fast chassis: tapered nose and two dark rear vents.
        rect(-2, -6, 4, 2, body);
        rect(-2, 3, 1, 2, "#343f35");
        rect(1, 3, 1, 2, "#343f35");
      }
      if (model === 3) {
        // Armor: broad, layered plates change color with remaining HP.
        rect(-5, -4, 10, 9, body);
        rect(-4, -3, 8, 1, "#e2e6cc");
        rect(-4, 3, 8, 2, "#53634d");
      }
      rect(-2, -3, 4, 5, "#656c53");
      rect(model === 2 ? -2 : -1, -9, model === 2 ? 4 : 2, 8, body);
      rect(-2, 0, 4, 3, body);
      rect(-2, -4, 1, 3, "#f8efba");
      if (tank.level > 0) {
        rect(-2, 4, 1, 1, "#fff");
        if (tank.level > 1) rect(1, 4, 1, 1, "#fff");
      }
      ctx.restore();
      ctx.restore();
      if (tank.shield > 0) {
        ctx.strokeStyle =
          !reduced.matches && Math.floor(state.time * 10) % 2
            ? "#fff"
            : "#87dafa";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x - 1), Math.round(y - 1), 16, 16);
      }
    }
    function draw() {
      ctx.setTransform(3, 0, 0, 3, 0, 0);
      rect(0, 0, 240, 208, "#82847e");
      rect(0, 0, 208, 208, "#101311");
      for (let y = 0; y < 52; y++)
        for (let x = 0; x < 52; x++) {
          const tile = state.map[y * 52 + x],
            px = x * 4,
            py = y * 4;
          if (tile === 1) {
            rect(px, py, 4, 4, "#ae593d");
            rect(px, py, 4, 1, "#d58a60");
            if ((x + (y % 2)) % 2 === 0) rect(px, py, 1, 4, "#703e2f");
          }
          if (tile === 2) {
            rect(px, py, 4, 4, "#a9b7b8");
            if (y % 2 === 0) rect(px, py, 4, 1, "#e3ece7");
            if (x % 2 === 0) rect(px, py, 1, 4, "#e3ece7");
            if (x % 2 === 1) rect(px + 3, py, 1, 4, "#667878");
            if (y % 2 === 1) rect(px, py + 3, 4, 1, "#667878");
          }
          if (tile === 3) {
            rect(px, py, 4, 4, "#305c9c");
            rect(
              px,
              py + ((x + Math.floor(state.time * 2)) % 3),
              3,
              1,
              "#6598cc",
            );
          }
          if (tile === 5) {
            rect(px, py, 4, 4, "#b5d3d5");
            rect(px + (y % 3), py, 1, 3, "#e4f3ec");
          }
        }
      // Eagle silhouette, drawn independently of the breakable base walls.
      const eagle = [
        "11000000000011",
        "11100000000111",
        "11111000011111",
        "01111111111110",
        "00111111111100",
        "00011111111000",
        "00111111111100",
        "01100111100110",
        "11000111100011",
        "00001111110000",
        "00011100111000",
        "00111000011100",
      ];
      eagle.forEach((row, y) =>
        [...row].forEach((v, x) => {
          if (v === "1")
            rect(97 + x, 194 + y, 1, 1, state.base ? "#c1bba0" : "#664a3c");
        }),
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 208, 208);
      ctx.clip();
      state.tanks.forEach(drawTank);
      ctx.restore();
      state.bullets.forEach((b) => rect(b.x - 1, b.y - 1, 2, 2, "#fff4ca"));
      for (let y = 0; y < 52; y++)
        for (let x = 0; x < 52; x++)
          if (state.map[y * 52 + x] === 4) {
            rect(x * 4, y * 4, 4, 4, "#276040");
            rect(x * 4 + (y % 2), y * 4, 2, 2, "#62a455");
            rect(x * 4 + 2, y * 4 + 3, 2, 1, "#142f24");
          }
      if (
        state.power &&
        (state.power.life > 3 || Math.floor(state.time * 6) % 2)
      ) {
        const p = state.power;
        rect(p.x, p.y, 16, 16, "#162318");
        rect(p.x, p.y, 16, 1, "#e8d895");
        rect(p.x, p.y + 15, 16, 1, "#e8d895");
        rect(p.x, p.y + 1, 1, 14, "#e8d895");
        rect(p.x + 15, p.y + 1, 1, 14, "#e8d895");
        if (powerPixels[p.kind]) {
          const palette = [null, "#f4dda1", "#9e8f55", "#fff0be"];
          powerPixels[p.kind].forEach((row, y) => {
            [...row].forEach((pixel, x) => {
              if (pixel !== "0")
                rect(p.x + 2 + x, p.y + 3 + y, 1, 1, palette[Number(pixel)]);
            });
          });
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 208, 208);
      ctx.clip();
      state.effects.forEach(drawEffect);
      ctx.restore();
      // Classic remaining-wave rail; all live state also has an HTML counter.
      for (let i = 0; i < 20 - state.spawned; i++) {
        const x = 215 + (i % 2) * 10,
          y = 7 + Math.floor(i / 2) * 9;
        rect(x, y, 2, 7, "#242b25");
        rect(x + 5, y, 2, 7, "#242b25");
        rect(x + 2, y + 2, 3, 4, "#242b25");
        rect(x + 3, y, 1, 3, "#242b25");
      }
      state.players.forEach((p, i) => {
        const y = 110 + i * 31;
        pixelText(`${i + 1}P`, 215, y);
        // Use the same pixel vocabulary as the remaining-enemy markers.
        const livesText = String(p.lives);
        if (livesText.length <= 2) {
          rect(215, y + 13, 2, 7, "#202e25");
          rect(220, y + 13, 2, 7, "#202e25");
          rect(217, y + 15, 3, 4, "#202e25");
          rect(218, y + 12, 1, 4, "#202e25");
        }
        pixelText(livesText, livesText.length <= 2 ? 225 : 212, y + 13);
      });
      rect(216, 175, 1, 11, "#202e25");
      rect(217, 175, 8, 4, "#202e25");
      rect(217, 179, 5, 2, "#202e25");
      const stageText = String(state.stage).padStart(2, "0");
      pixelText(
        stageText,
        Math.max(209, 231 - (stageText.length * 6 - 1)),
        192,
      );
      if (state.freeze > 0) {
        rect(2, 3, 2, 7, "#d9efff");
        rect(6, 3, 2, 7, "#d9efff");
      }
      if (
        state.fortify > 0 &&
        state.fortify < 5 &&
        Math.floor(state.time * 4) % 2
      ) {
        ctx.strokeStyle = "#fff6b9";
        ctx.strokeRect(88.5, 184.5, 31, 23);
      }
      if (mode === "editor") {
        ctx.strokeStyle = "#ffffff26";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 13; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 16, 0);
          ctx.lineTo(i * 16, 208);
          ctx.moveTo(0, i * 16);
          ctx.lineTo(208, i * 16);
          ctx.stroke();
        }
        ctx.strokeStyle = "#ffe089";
        ctx.lineWidth = 1;
        ctx.strokeRect(cursor.x * 16 + 0.5, cursor.y * 16 + 0.5, 15, 15);
      }
    }
    function paintCell(x, y) {
      if (x < 0 || y < 0 || x > 12 || y > 12) return;
      cursor = { x, y };
      // Keep spawn pads, the eagle and its enclosure available in custom maps.
      if (
        (y === 0 && [0, 6, 12].includes(x)) ||
        (y >= 11 && x >= 4 && x <= 8)
      ) {
        draw();
        return;
      }
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++)
          state.map[(y * 4 + dy) * 52 + x * 4 + dx] =
            brushOptions[brush][1] < 0 ||
            [dy < 2, dx >= 2, dy >= 2, dx < 2][brushOptions[brush][1]]
              ? brushOptions[brush][0]
              : 0;
      draw();
    }
    function paintPointer(e) {
      const r = canvas.getBoundingClientRect();
      paintCell(
        Math.floor((((e.clientX - r.left) / r.width) * 240) / 16),
        Math.floor(((e.clientY - r.top) / r.height) * 13),
      );
    }
    listen(board, "pointerdown", (e) => {
      board.focus({ preventScroll: true });
      if (mode !== "editor") return;
      e.preventDefault();
      painting = e.pointerId;
      board.setPointerCapture(e.pointerId);
      paintPointer(e);
    });
    listen(board, "pointermove", (e) => {
      if (mode === "editor" && painting === e.pointerId) paintPointer(e);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      listen(board, event, () => (painting = null));
    listen(root, "keydown", (e) => {
      if (e.target.closest("button,select,[role=listbox]")) return;
      if (mode === "editor") {
        const dir = mappings[1][e.code];
        if (dir !== undefined) {
          e.preventDefault();
          const [dx, dy] = rules.directions[dir];
          cursor = {
            x: Math.max(0, Math.min(12, cursor.x + dx)),
            y: Math.max(0, Math.min(12, cursor.y + dy)),
          };
          draw();
        }
        if (e.code === "Space") {
          e.preventDefault();
          paintCell(cursor.x, cursor.y);
        }
        return;
      }
      if (e.code === "KeyP") {
        e.preventDefault();
        if (!e.repeat) togglePause();
        return;
      }
      if (!active()) return;
      if (
        mappings.some((m) => m[e.code] !== undefined) ||
        ["Space", "KeyJ", "KeyK", "Enter"].includes(e.code)
      ) {
        e.preventDefault();
        if (!keys.has(e.code)) keys.set(e.code, true);
      }
    });
    listen(window, "keyup", (e) => keys.delete(e.code));
    listen(window, "blur", pause);
    listen(root, "focusout", (e) => {
      if (mode === "playing" && !root.contains(e.relatedTarget)) pause();
    });
    listen(document, "worktime:languagechange", sync);
    listen(players, "change", () => {
      state = rules.create({
        players: Number(players.value),
        stage: Number(stages.value),
      });
      sync();
    });
    listen(stages, "change", () => {
      state = rules.create({
        players: Number(players.value),
        stage: Number(stages.value),
      });
      sync();
    });
    listen(signal, "abort", () => {
      stop();
      clearInput();
    });
    function layout({ width, height }) {
      viewport = { width, height };
      root.style.setProperty("--tank-height", Math.max(0, height) + "px");
      const mobile =
        window.matchMedia("(pointer: coarse)").matches || width < 620;
      root.classList.toggle("tank-has-touch", mobile);
      root.classList.toggle("tank-stacked", width < 700);
      const short = height < 420 && width > 560;
      root.classList.toggle("tank-short", short);
      // Measure at full width, then center a group fitted to the actual board.
      // Extra horizontal room belongs outside the sidebars, not beside the field.
      playfield.style.width = "100%";
      const boardWidth = Math.max(
        0,
        Math.floor(
          Math.min(arena.clientWidth, (arena.clientHeight * 240) / 208),
        ),
      );
      board.style.width = boardWidth + "px";
      if (!root.classList.contains("tank-stacked")) {
        const gap = parseFloat(getComputedStyle(playfield).columnGap) || 0;
        playfield.style.width =
          Math.min(
            width,
            boardWidth + hud.offsetWidth + controls.offsetWidth + gap * 2,
          ) + "px";
      }
    }
    sync();
    return {
      resize(size) {
        layout(size);
        draw();
      },
      pause() {
        suspended = true;
        pause();
      },
      resume() {
        suspended = false;
        sync();
      },
      dispose() {
        if (disposed) return;
        save();
        disposed = true;
        stop();
        clearInput();
        if (audio) void audio.close().catch(() => {});
        root.remove();
      },
    };
  },
});
