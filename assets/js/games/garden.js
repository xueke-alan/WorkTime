"use strict";
WorkTimeApp.games.register({
  id: "game-garden",
  nameKey: "games.garden.name",
  descriptionKey: "games.garden.description",
  icon: "game-garden",
  create({ container, signal }) {
    const gameStorage = WorkTimeApp.services.gameArchive.session();
    const rules = WorkTimeApp.games.gardenRules,
      key = "worktime.games.garden.v1";
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    let busy = false,
      motionRevision = 0,
      animations = [],
      hiddenTokens = [];
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.garden." + name, params);
    const node = (tag, className, parent) => {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    };
    const listen = (element, event, callback) =>
      element.addEventListener(event, callback, { signal });
    let state,
      previous = null,
      paused = false,
      disposed = false,
      confirming = false,
      choosing = false,
      suggested = null,
      feedback = "ready",
      saveFailed = false;
    let entered = false;
    const records = Array(rules.levelCount).fill(0);
    try {
      const saved = JSON.parse(gameStorage.getItem(key));
      if (saved?.version === 1) {
        if (Array.isArray(saved.records))
          saved.records.slice(0, rules.levelCount).forEach((value, i) => {
            if (Number.isInteger(value) && value >= 0 && value <= 3)
              records[i] = value;
          });
        state = rules.restore(saved.state);
        const candidate = rules.restore(saved.previous);
        if (
          state &&
          candidate?.level === state.level &&
          candidate.layoutVersion === state.layoutVersion &&
          candidate.seed === state.seed &&
          candidate.moves + 1 === state.moves &&
          candidate.undoLeft === state.undoLeft
        )
          previous = candidate;
      }
    } catch {
      saveFailed = true;
    }
    state ||= rules.create();
    let tiles = rules.layout(
      state.level,
      state.seed,
      state.layoutVersion,
    ).tiles;
    const root = node("section", "game-garden game-session", container);
    const header = node("div", "garden-header", root);
    const tools = node("div", "garden-tools", header);
    function button(parent, action, callback) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.gardenAction = action;
      listen(element, "click", () => {
        if (!paused && !disposed && !signal.aborted && !busy) callback();
      });
      return element;
    }
    const restart = button(tools, "restart", () => {
      stopMotion();
      choosing = false;
      confirming = true;
      render();
      cancel.focus();
    });
    restart.classList.add("game-icon-button");
    restart.append(WorkTimeApp.games.createIcon("restart-alt"));
    const steps = node("div", "garden-steps", header);
    header.prepend(steps);
    steps.setAttribute("role", "list");
    const chapterTitle = node("span", "", steps);
    chapterTitle.setAttribute("role", "listitem");
    const picker = button(steps, "levels", () => {
      stopMotion();
      choosing = true;
      render();
      levelButtons[state.level].focus();
    });
    const progress = node("div", "garden-progress game-sr-only", root);
    progress.setAttribute("role", "progressbar");
    const field = node("div", "garden-field", root);
    const stage = node("div", "garden-stage", field);
    const board = node("div", "garden-board", stage);
    board.setAttribute("role", "group");
    const cover = node("section", "garden-cover", stage);
    const coverTitle = node("h3", "", cover),
      coverText = node("p", "", cover);
    const levelGrid = node("div", "garden-level-grid", cover);
    const levelButtons = Array.from({ length: rules.levelCount }, (_, level) =>
      button(levelGrid, "level-" + level, () => {
        if (level > unlocked()) return;
        if (level === state.level && rules.phase(state, tiles) !== "won") {
          choosing = false;
          render();
          picker.focus();
        } else start(level, state.seed);
      }),
    );
    const coverActions = node("div", "garden-cover-actions", cover);
    const primary = button(coverActions, "primary", () => {
      if (confirming) start(0, Math.floor(Math.random() * 4294967296));
      else if (rules.phase(state, tiles) === "won")
        start(
          state.level < rules.levelCount - 1 ? state.level + 1 : 0,
          state.level < rules.levelCount - 1
            ? state.seed
            : Math.floor(Math.random() * 4294967296),
        );
      else start(state.level, state.seed);
    });
    const cancel = button(coverActions, "cancel", () => {
      confirming = false;
      choosing = false;
      render();
      restart.focus();
    });
    const trayBlock = node("div", "garden-tray-block", root);
    const trayHeader = node("div", "garden-tray-heading", trayBlock);
    const trayTitle = node("strong", "", trayHeader),
      trayCount = node("span", "", trayHeader);
    const tray = node("div", "garden-tray", trayBlock);
    tray.setAttribute("role", "group");
    const traySlots = Array.from({ length: 7 }, () => {
      const slot = node("button", "garden-slot garden-token", tray);
      slot.type = "button";
      return slot;
    });
    const fence = node("div", "garden-fence", tray);
    fence.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 8; i++) node("i", "", fence);
    const footer = node("div", "garden-footer", root);
    const reserveRow = node("div", "garden-reserve-row", field);
    const reserveTitle = node("strong", "game-sr-only", reserveRow);
    const reserve = node("div", "garden-reserve", reserveRow);
    reserve.setAttribute("role", "group");
    const reserveSlots = Array.from({ length: 2 }, () => {
      const slot = node("button", "garden-slot garden-token", reserve);
      slot.type = "button";
      return slot;
    });
    const actions = node("div", "garden-actions", footer);
    const store = button(actions, "store", () => {
      const id = state.tray.at(-1);
      if (id !== undefined) void act("store", id);
    });
    const undo = button(actions, "undo", async () => {
      if (confirming || !previous || !state.undoLeft) return;
      stopMotion();
      const origins = positions();
      const undoLeft = state.undoLeft - 1,
        hintsLeft = state.hintsLeft;
      state = rules.copy(previous);
      state.undoLeft = undoLeft;
      state.hintsLeft = hintsLeft;
      previous = null;
      suggested = null;
      feedback = "undone";
      save();
      render();
      await restoreMotion(origins);
      if (!disposed && !paused && !signal.aborted) focusTile();
    });
    const hint = button(actions, "hint", () => {
      if (
        confirming ||
        !state.hintsLeft ||
        rules.phase(state, tiles) !== "playing"
      )
        return;
      suggested = rules.hint(state, tiles);
      if (!suggested) return;
      state.hintsLeft--;
      feedback = "hinted";
      save();
      render();
      if (suggested.action === "return")
        reserveSlots[state.reserve.indexOf(suggested.id)]?.focus();
      else tileNodes[suggested.id]?.focus({ preventScroll: true });
    });
    const toolLabels = new Map();
    for (const [element, icon] of [
      [store, "store"],
      [undo, "undo"],
      [hint, "hint"],
    ]) {
      const graphic = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      graphic.setAttribute("viewBox", "0 0 48 48");
      graphic.setAttribute("aria-hidden", "true");
      graphic.classList.add("garden-tool-art");
      const paths = {
        store:
          '<path d="M8 24v16h31V24H28v8H19v-8Z"/><path d="M19 7h10v10h8L24 29 11 17h8Z"/>',
        undo: '<path d="m19 8-13 12 13 12v-8h10a7 7 0 1 1 0 14H19v7h10a14 14 0 1 0 0-28H19Z"/>',
        hint: '<path d="M24 4a14 14 0 0 0-9 25l3 5h12l3-5A14 14 0 0 0 24 4Z"/><path d="M18 39h12m-10 5h8" fill="none"/>',
      };
      graphic.innerHTML = paths[icon];
      element.append(graphic);
      toolLabels.set(element, node("span", "garden-tool-label", element));
    }
    const notice = node("p", "garden-notice game-sr-only", root);
    notice.setAttribute("role", "status");
    const warning = node("p", "garden-warning", field);
    warning.setAttribute("role", "status");
    const help = WorkTimeApp.games.createHelp({
      root,
      controls: tools,
      signal,
      text: () => t("help"),
      onChange() {
        stopMotion();
        render();
      },
    });
    const motionLayer = node("div", "garden-motion", root);
    motionLayer.setAttribute("aria-hidden", "true");
    const colors = [
      "#c85d52",
      "#bf942f",
      "#bb6c51",
      "#78924e",
      "#658bb2",
      "#cc873c",
      "#c37d91",
      "#b98f3b",
      "#9c7ca9",
      "#aa864e",
      "#a77d5e",
      "#ba7950",
      "#967258",
      "#548b92",
      "#c39040",
      "#b75e6e",
      "#739269",
      "#97754f",
      "#c6a342",
      "#6d9db2",
      "#bc7e9b",
      "#ca8852",
      "#b95e59",
      "#b69b43",
      "#6c80a5",
      "#ad9293",
      "#977ba8",
    ];
    const symbolName = (type) => t("symbol" + type);
    let tileNodes = [];
    function buildBoard() {
      const rows =
        state.layoutVersion === 2 ? (state.level === 0 ? 5.4 : 7.4) : 6;
      stage.style.setProperty("--garden-rows", rows);
      root.dataset.layoutVersion = state.layoutVersion;
      board.replaceChildren();
      tileNodes = tiles.map((tile) => {
        const element = node("button", "garden-tile garden-token", board);
        element.type = "button";
        element.dataset.tile = tile.id;
        element.style.left = (tile.x / 6) * 100 + "%";
        element.style.top = (tile.y / rows) * 100 + "%";
        element.style.zIndex = tile.z + 1;
        element.dataset.pile = tile.pile || "main";
        paintToken(element, tile.id);
        return element;
      });
    }
    function paintToken(element, id) {
      const tile = tiles[id];
      let art = element.firstElementChild;
      if (tile) {
        if (!art) {
          art = node("span", "garden-art", element);
          art.setAttribute("aria-hidden", "true");
        }
        art.style.backgroundPosition =
          (tile.type % 3) * 50 +
          "% " +
          (tile.type < 9
            ? [0, 0, 0, 50, 50, 50, 96, 100, 100][tile.type]
            : [0, 0, 0, 50, 50, 50, 98, 96, 100][tile.type % 9]) +
          "%";
        art.dataset.atlas = Math.floor(tile.type / 9);
      } else element.replaceChildren();
      element.style.setProperty(
        "--garden-color",
        tile ? colors[tile.type] : "transparent",
      );
      element.dataset.id = tile ? id : "";
    }
    function stopMotion() {
      motionRevision++;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      hiddenTokens.forEach((element) =>
        element.style.removeProperty("visibility"),
      );
      hiddenTokens = [];
      motionLayer.replaceChildren();
      busy = false;
      root.dataset.busy = "false";
    }
    function animate(
      element,
      frames,
      duration,
      easing = "cubic-bezier(.2,.75,.3,1)",
    ) {
      // animationCompat releases native fill effects at completion. Keep the
      // endpoint in ordinary styles so a shorter track never snaps back while
      // the rest of its group is still running.
      for (const [name, value] of Object.entries(frames.at(-1))) {
        if (!["offset", "easing", "composite"].includes(name))
          element.style[name] = value;
      }
      if (!duration) return Promise.resolve();
      const animation = compat.animate(element, frames, {
        duration,
        easing,
        fill: "both",
      });
      animations.push(animation);
      return animation.finished;
    }
    function positions() {
      const result = new Map();
      for (const element of [...tileNodes, ...traySlots, ...reserveSlots]) {
        if (!element.hidden && element.dataset.id !== "")
          result.set(
            Number(element.dataset.id),
            element.getBoundingClientRect(),
          );
      }
      return result;
    }
    async function moveMotion(before, next, action, id, origins) {
      if (reduced.matches || document.hidden) return;
      const token = ++motionRevision;
      busy = true;
      root.dataset.busy = "true";
      const rootBox = root.getBoundingClientRect();
      const preview =
        action === "store"
          ? next.tray
          : [...before.tray, id].sort((a, b) => tiles[a].type - tiles[b].type);
      const matched = preview.filter((value) => !next.tray.includes(value));
      const targets = new Map();
      preview.forEach((value, index) =>
        targets.set(value, traySlots[index].getBoundingClientRect()),
      );
      next.reserve.forEach((value, index) =>
        targets.set(value, reserveSlots[index].getBoundingClientRect()),
      );
      const ghosts = [];
      for (const [value, target] of targets) {
        const from = origins.get(value);
        if (!from) continue;
        const ghost = node("div", "garden-token garden-flight", motionLayer);
        paintToken(ghost, value);
        Object.assign(ghost.style, {
          left: from.left - rootBox.left + "px",
          top: from.top - rootBox.top + "px",
          width: from.width + "px",
          height: from.height + "px",
        });
        const frame = (box, scale = 1) =>
          `translate(${box.left - from.left + (box.width * (1 - scale)) / 2}px, ${box.top - from.top + (box.height * (1 - scale)) / 2}px) scale(${(box.width / from.width) * scale}, ${(box.height / from.height) * scale})`;
        const destination = [...traySlots, ...reserveSlots].find(
          (element) => element.dataset.id === String(value),
        );
        if (destination) {
          destination.style.visibility = "hidden";
          hiddenTokens.push(destination);
        }
        ghosts.push({ value, ghost, from, target, frame });
      }
      // Fly the picked tile into the rack while existing tiles slide into groups.
      await Promise.all(
        ghosts.map(({ value, ghost, target, frame }) =>
          animate(
            ghost,
            [
              { transform: "translate(0, 0) scale(1)", opacity: 1 },
              { transform: frame(target), opacity: 1 },
            ],
            value === id ? 220 : 180,
          ),
        ),
      );
      if (token !== motionRevision) return;
      if (matched.length === 3) {
        const group = ghosts.filter(({ value }) => matched.includes(value));
        const center = group[1]?.target;
        await Promise.all(
          group.map(({ ghost, target, frame }) =>
            animate(
              ghost,
              [
                { transform: frame(target), opacity: 1 },
                { transform: frame(center, 1.06), opacity: 1 },
              ],
              85,
            ),
          ),
        );
        if (token !== motionRevision) return;
        const burst = node("div", "garden-burst", motionLayer);
        Object.assign(burst.style, {
          left: center.left + center.width / 2 - rootBox.left + "px",
          top: center.top + center.height / 2 - rootBox.top + "px",
        });
        const sparks = Array.from({ length: 8 }, (_, index) => {
          const spark = node("i", "", burst);
          const angle = (index * Math.PI) / 4;
          return animate(
            spark,
            [
              { transform: "translate(0,0) scale(.5)", opacity: 1 },
              {
                transform: `translate(${Math.cos(angle) * 35}px,${Math.sin(angle) * 35}px) scale(0)`,
                opacity: 0,
              },
            ],
            180,
          );
        });
        await Promise.all([
          ...sparks,
          ...group.map(({ ghost, frame }) =>
            animate(
              ghost,
              [
                { transform: frame(center, 1.06), opacity: 1 },
                { transform: frame(center, 0.08), opacity: 0 },
              ],
              150,
            ),
          ),
        ]);
        if (token !== motionRevision) return;
        group.forEach(({ ghost }) => ghost.remove());
      }
      await Promise.all(
        ghosts
          .filter(({ value }) => next.tray.includes(value))
          .map(({ value, ghost, target, frame }) => {
            const final =
              traySlots[next.tray.indexOf(value)].getBoundingClientRect();
            return animate(
              ghost,
              [{ transform: frame(target) }, { transform: frame(final) }],
              matched.length ? 130 : 0,
            );
          }),
      );
      if (token === motionRevision) stopMotion();
    }
    function dealMotion() {
      if (reduced.matches || document.hidden || paused) return;
      tileNodes
        .filter((tile) => !tile.hidden && !tile.disabled)
        .forEach((tile, index) => {
          const animation = compat.animate(
            tile,
            [
              { opacity: 0, transform: "translateY(-10px) scale(.92)" },
              { opacity: 1, transform: "none" },
            ],
            {
              duration: 210,
              delay: Math.min(index * 8, 160),
              easing: "cubic-bezier(.2,.85,.3,1.15)",
            },
          );
          animations.push(animation);
        });
    }
    async function restoreMotion(origins) {
      if (reduced.matches || document.hidden) return;
      const token = ++motionRevision;
      const rootBox = root.getBoundingClientRect();
      busy = true;
      root.dataset.busy = "true";
      const pending = [];
      for (const element of [...tileNodes, ...traySlots, ...reserveSlots]) {
        if (element.hidden || element.dataset.id === "") continue;
        const id = Number(element.dataset.id),
          target = element.getBoundingClientRect(),
          from = origins.get(id);
        if (!from) {
          pending.push(
            animate(
              element,
              [
                { opacity: 0, transform: "scale(.8)" },
                { opacity: 1, transform: "none" },
              ],
              180,
            ),
          );
        } else if (
          Math.abs(from.left - target.left) + Math.abs(from.top - target.top) >
          1
        ) {
          const ghost = node("div", "garden-token garden-flight", motionLayer);
          paintToken(ghost, id);
          Object.assign(ghost.style, {
            left: from.left - rootBox.left + "px",
            top: from.top - rootBox.top + "px",
            width: from.width + "px",
            height: from.height + "px",
          });
          element.style.visibility = "hidden";
          hiddenTokens.push(element);
          pending.push(
            animate(
              ghost,
              [
                { transform: "none" },
                {
                  transform: `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${target.width / from.width}, ${target.height / from.height})`,
                },
              ],
              220,
            ),
          );
        }
      }
      await Promise.all(pending);
      if (token === motionRevision) stopMotion();
    }
    function save() {
      if (rules.phase(state, tiles) === "won")
        records[state.level] = Math.max(
          records[state.level],
          rules.stars(state, tiles),
        );
      try {
        gameStorage.setItem(
          key,
          JSON.stringify({ version: 1, state, previous, records }),
        );
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
      warning.textContent = saveFailed ? t("saveFailed") : "";
    }
    function unlocked() {
      let level = 0;
      while (level < rules.levelCount - 1 && records[level]) level++;
      return Math.max(level, state.level);
    }
    function start(level, seed) {
      stopMotion();
      state = rules.create(level, seed);
      tiles = rules.layout(level, seed, state.layoutVersion).tiles;
      previous = null;
      confirming = false;
      choosing = false;
      suggested = null;
      feedback = "ready";
      buildBoard();
      save();
      render();
      focusTile();
      dealMotion();
    }
    function focusTile() {
      tileNodes
        .find((tile) => !tile.hidden && !tile.disabled)
        ?.focus({ preventScroll: true });
    }
    async function act(action, id) {
      if (
        paused ||
        disposed ||
        confirming ||
        choosing ||
        signal.aborted ||
        root.querySelector(".game-help-screen:not([hidden])")
      )
        return;
      const next = rules.move(state, tiles, action, id);
      if (!next) return;
      // A fresh valid pick takes priority over cosmetic motion. Commit the
      // preceding visual state before measuring the next flight; never drop
      // input or leave a delayed pick waiting behind a match animation.
      if (busy) {
        stopMotion();
        render();
      }
      const origins = positions();
      const before = rules.copy(state);
      const oldCount = state.tray.length + state.reserve.length;
      previous = rules.copy(state);
      state = next;
      suggested = null;
      feedback =
        oldCount + (action === "pick" ? 1 : 0) >
        state.tray.length + state.reserve.length
          ? "matched"
          : action === "store"
            ? "stored"
            : "ready";
      save();
      render();
      if (!reduced.matches && rules.phase(state, tiles) !== "playing")
        cover.hidden = true;
      await moveMotion(before, next, action, id, origins);
      if (disposed || signal.aborted || paused || state !== next) return;
      render();
      if (rules.phase(state, tiles) === "won") primary.focus();
      else if (action === "pick") focusTile();
      else if (action === "store")
        (
          traySlots.find((slot) => !slot.disabled) ||
          reserveSlots.find((slot) => !slot.disabled)
        )?.focus({ preventScroll: true });
      else
        (
          reserveSlots.find((slot) => !slot.disabled) ||
          tileNodes.find((tile) => !tile.hidden && !tile.disabled)
        )?.focus({ preventScroll: true });
    }
    function render() {
      const phase = rules.phase(state, tiles),
        available = new Set(
          rules.available(tiles, state.removed).map(({ id }) => id),
        );
      const removed = new Set(state.removed),
        cleared =
          state.removed.length - state.tray.length - state.reserve.length;
      root.setAttribute("aria-label", t("name"));
      restart.setAttribute("aria-label", t("new"));
      restart.title = t("new");
      chapterTitle.textContent = t(
        "level" + rules.difficulty(state.level).chapter,
      );
      chapterTitle.dataset.state = "current";
      chapterTitle.setAttribute("aria-current", "step");
      picker.textContent =
        String(state.level + 1).padStart(2, "0") + " / " + rules.levelCount;
      picker.title = t("choose");
      picker.setAttribute(
        "aria-label",
        t("levelLabel", { n: state.level + 1, stars: records[state.level] }),
      );
      levelButtons.forEach((element, level) => {
        element.textContent =
          String(level + 1).padStart(2, "0") +
          (records[level] ? " " + "★".repeat(records[level]) : "");
        element.disabled = level > unlocked();
        element.setAttribute(
          "aria-label",
          t("levelLabel", { n: level + 1, stars: records[level] }),
        );
        element.setAttribute(
          "aria-current",
          level === state.level ? "true" : "false",
        );
      });
      progress.setAttribute("aria-label", t("progress"));
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(tiles.length));
      progress.setAttribute("aria-valuenow", String(cleared));
      board.setAttribute("aria-label", t("board"));
      board.inert = confirming || choosing;
      for (const tile of tiles) {
        const element = tileNodes[tile.id];
        const coverLevel = tile.above.reduce(
          (highest, id) =>
            removed.has(id) ? highest : Math.max(highest, tiles[id].z),
          tile.z,
        );
        element.dataset.covered = String(coverLevel > tile.z);
        element.style.setProperty(
          "--garden-cover-shade",
          String(Math.min(3, coverLevel - tile.z)),
        );
        element.hidden = removed.has(tile.id);
        element.disabled =
          !available.has(tile.id) ||
          phase !== "playing" ||
          confirming ||
          choosing;
        element.classList.toggle(
          "is-hinted",
          suggested?.action === "pick" && suggested.id === tile.id,
        );
        element.setAttribute(
          "aria-label",
          t(available.has(tile.id) ? "tile" : "covered", {
            name: symbolName(tile.type),
            n: tile.z + 1,
          }),
        );
      }
      trayTitle.textContent = t("tray");
      trayCount.textContent = state.tray.length + " / 7";
      tray.dataset.danger = String(state.tray.length >= 5);
      tray.setAttribute("aria-label", t("tray"));
      reserveTitle.textContent = t("reserve");
      reserveRow.title = t("reserve") + " · " + t("reserveRule");
      reserve.setAttribute("aria-label", t("reserve"));
      for (const [slots, ids, action] of [
        [traySlots, state.tray, "store"],
        [reserveSlots, state.reserve, "return"],
      ])
        slots.forEach((slot, i) => {
          const id = ids[i];
          paintToken(slot, id);
          slot.disabled =
            id === undefined ||
            confirming ||
            choosing ||
            (action === "store"
              ? state.reserve.length >= 2
              : state.tray.length >= 7);
          slot.classList.toggle(
            "is-hinted",
            suggested?.action === action && suggested.id === id,
          );
          slot.setAttribute(
            "aria-label",
            id === undefined
              ? t("empty")
              : t(action, { name: symbolName(tiles[id].type) }),
          );
          slot.title = slot.getAttribute("aria-label");
        });
      toolLabels.get(store).textContent = t("storeTool");
      store.disabled =
        confirming ||
        choosing ||
        !state.tray.length ||
        state.reserve.length >= 2;
      store.dataset.count = String(2 - state.reserve.length);
      store.title = t("reserveRule");
      store.setAttribute(
        "aria-label",
        t("storeTool") + " · " + (2 - state.reserve.length),
      );
      reserveRow.hidden = state.reserve.length === 0;
      toolLabels.get(undo).textContent = t("undo", { n: state.undoLeft }).split(
        " · ",
      )[0];
      undo.dataset.count = String(state.undoLeft);
      undo.setAttribute("aria-label", t("undo", { n: state.undoLeft }));
      undo.disabled = confirming || choosing || !previous || !state.undoLeft;
      toolLabels.get(hint).textContent = t("hint", {
        n: state.hintsLeft,
      }).split(" · ")[0];
      hint.dataset.count = String(state.hintsLeft);
      hint.setAttribute("aria-label", t("hint", { n: state.hintsLeft }));
      hint.disabled =
        confirming || choosing || !state.hintsLeft || phase !== "playing";
      notice.textContent = t(
        phase === "blocked"
          ? "blockedNotice"
          : phase === "won"
            ? "wonNotice"
            : state.tray.length >= 5
              ? "danger"
              : feedback,
      );
      warning.textContent = saveFailed ? t("saveFailed") : "";
      cover.hidden = !confirming && !choosing && phase === "playing";
      levelGrid.hidden = !choosing;
      primary.hidden = choosing;
      coverTitle.textContent = t(
        choosing
          ? "choose"
          : confirming
            ? "confirm"
            : phase === "won"
              ? state.level === rules.levelCount - 1
                ? "finished"
                : "won"
              : "blocked",
      );
      coverText.textContent = t(
        choosing
          ? "chooseText"
          : confirming
            ? "confirmText"
            : phase === "won"
              ? "wonText"
              : "blockedText",
      );
      if (!choosing && !confirming && phase === "won")
        coverText.textContent =
          "★".repeat(rules.stars(state, tiles)) + " · " + t("rating");
      primary.textContent = t(
        confirming
          ? "new"
          : phase === "won"
            ? state.level === rules.levelCount - 1
              ? "again"
              : "next"
            : "retry",
      );
      cancel.hidden = !confirming && !choosing;
      cancel.textContent = t("cancel");
      help.refresh();
    }
    listen(board, "click", (event) => {
      const tile = event.target.closest("[data-tile]");
      if (tile && !tile.disabled) act("pick", Number(tile.dataset.tile));
    });
    listen(board, "keydown", (event) => {
      const current = tiles[Number(event.target.dataset.tile)];
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!current || !direction) return;
      event.preventDefault();
      const [dx, dy] = direction;
      const options = rules
        .available(tiles, state.removed)
        .filter(
          (tile) =>
            tile.id !== current.id &&
            (tile.x - current.x) * dx + (tile.y - current.y) * dy > 0,
        );
      const distance = (tile) =>
        Math.hypot(tile.x - current.x, tile.y - current.y) +
        Math.abs((tile.x - current.x) * dy - (tile.y - current.y) * dx) * 2;
      options.sort((a, b) => distance(a) - distance(b));
      if (options[0]) tileNodes[options[0].id].focus({ preventScroll: true });
    });
    traySlots.forEach((slot) =>
      listen(slot, "click", () => {
        if (!slot.disabled) act("store", Number(slot.dataset.id));
      }),
    );
    reserveSlots.forEach((slot) =>
      listen(slot, "click", () => {
        if (!slot.disabled) act("return", Number(slot.dataset.id));
      }),
    );
    listen(root, "keydown", (event) => {
      if ((confirming || choosing) && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        confirming = false;
        choosing = false;
        render();
        restart.focus();
      }
    });
    listen(document, "worktime:languagechange", render);
    signal.addEventListener("abort", stopMotion, { once: true });
    const unlistenMotion = compat.listen(reduced, () => {
      stopMotion();
      render();
    });
    buildBoard();
    save();
    render();
    dealMotion();
    return {
      resize() {
        stopMotion();
        render();
      },
      pause() {
        stopMotion();
        paused = true;
        save();
        render();
      },
      resume() {
        paused = false;
        if (!entered) {
          entered = true;
          dealMotion();
        }
      },
      dispose() {
        if (disposed) return;
        stopMotion();
        unlistenMotion();
        save();
        disposed = true;
        root.remove();
      },
    };
  },
});
