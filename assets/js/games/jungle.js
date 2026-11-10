"use strict";

WorkTimeApp.games.register({
  id: "game-jungle",
  nameKey: "games.jungle.name",
  descriptionKey: "games.jungle.description",
  icon: "game-jungle",
  create({ container, signal }) {
    const G = WorkTimeApp.games,
      rules = G.jungleRules,
      art = G.jungleArt;
    const compat = WorkTimeApp.ui.animationCompat;
    const reduced = compat.preference();
    const archive = WorkTimeApp.services.gameArchive,
      storage = archive.session();
    const t = (key, params) =>
      WorkTimeApp.i18n.t("games.jungle." + key, params);
    let options = { mode: "ai", difficulty: "normal", human: 1, path: [] };
    let state = rules.create(),
      active = false,
      setupOpen = true,
      paused = false,
      covered = false;
    let selected = -1,
      focus = 42,
      thinking = false,
      engineSearch = null,
      engineError = false,
      thought = null,
      generation = 0,
      failed = false;
    let landscape = false,
      mapKey = "",
      motion = null,
      moving = false,
      rotation = null,
      rotating = false;
    let available = { width: 1000, height: 800 };
    try {
      landscape =
        localStorage.getItem("worktime.games.jungle.landscape") === "true";
    } catch {
      /* View preferences are optional. */
    }
    try {
      const raw = storage.getItem(archive.keys["game-jungle"]);
      if (raw !== null) {
        const save = archive.normalize("game-jungle", JSON.parse(raw));
        options = save.state;
        state = rules.replay(options.path);
        active = true;
        setupOpen = false;
      }
    } catch {
      failed = true;
    }
    const node = (parent, tag, className) => {
      const el = document.createElement(tag);
      el.className = className;
      parent.append(el);
      return el;
    };
    const root = node(container, "section", "game-jungle game-session");
    const catalog = G.createLevelPage(root, "jungle-level-page", signal);
    const setup = node(catalog.entries, "section", "jungle-setup");
    const heading = node(setup, "h3", "jungle-heading");
    const intro = node(setup, "p", "jungle-detail");
    const buttons = [];
    function button(parent, action, label, callback) {
      const el = node(parent, "button", "game-button");
      el.type = "button";
      el.dataset.jungleAction = action;
      buttons.push({ el, label });
      el.addEventListener(
        "click",
        () => {
          if (!paused && !signal.aborted) callback();
        },
        { signal },
      );
      return el;
    }
    let draft = { ...options };
    function choices(parent, label, values, field) {
      const group = node(parent, "fieldset", "jungle-options");
      const legend = node(group, "legend", "jungle-label");
      const controls = node(group, "div", "jungle-choice-row");
      const items = values.map(([value, name]) => ({
        value,
        control: button(controls, field + "-" + value, name, () => {
          draft[field] = value;
          if (field === "human") {
            startMatch();
            return;
          }
          render();
        }),
      }));
      return { group, legend, label, items, field };
    }
    const modes = choices(
      setup,
      "mode",
      [
        ["ai", "ai"],
        ["local", "local"],
      ],
      "mode",
    );
    for (const { control } of modes.items) catalog.categories.append(control);
    modes.group.remove();
    const difficulties = choices(
      setup,
      "difficulty",
      [
        ["easy", "easy"],
        ["normal", "normal"],
        ["hard", "hard"],
      ],
      "difficulty",
    );
    const sides = choices(
      setup,
      "side",
      [
        [1, "first"],
        [-1, "second"],
      ],
      "human",
    );
    const engineLabel = node(setup, "p", "jungle-detail");
    const setupActions = node(setup, "div", "jungle-actions");
    button(setupActions, "start", "start", startMatch);
    function startMatch() {
      cancel();
      options = { ...draft, path: [] };
      state = rules.create();
      selected = -1;
      active = true;
      engineError = false;
      setupOpen = false;
      persist();
      render();
      scheduleAI();
      cells[focus].focus();
    }
    function returnToMatch() {
      setupOpen = false;
      render();
      scheduleAI();
    }
    const back = catalog.back;
    back.dataset.jungleAction = "continue";
    const play = node(root, "div", "jungle-play");
    const stage = node(play, "div", "jungle-stage");
    const board = node(stage, "div", "jungle-board");
    board.setAttribute("role", "group");
    const map = node(board, "div", "jungle-map");
    map.setAttribute("aria-hidden", "true");
    const cells = Array.from({ length: 63 }, (_, index) => {
      const cell = node(board, "button", "jungle-cell");
      cell.type = "button";
      cell.dataset.display = index;
      cell.addEventListener("click", () => attempt(square(index)), { signal });
      cell.addEventListener(
        "focus",
        () => {
          focus = index;
        },
        { signal },
      );
      cell.addEventListener(
        "keydown",
        (event) => {
          const offsets = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -(landscape ? 9 : 7),
            ArrowDown: landscape ? 9 : 7,
          };
          if (Object.hasOwn(offsets, event.key)) {
            event.preventDefault();
            const next = index + offsets[event.key];
            if (
              next >= 0 &&
              next < 63 &&
              (Math.abs(offsets[event.key]) === (landscape ? 9 : 7) ||
                Math.floor(next / (landscape ? 9 : 7)) ===
                  Math.floor(index / (landscape ? 9 : 7)))
            ) {
              cells[focus].tabIndex = -1;
              focus = next;
              cells[focus].tabIndex = 0;
              cells[focus].focus();
            }
          } else if (event.key === "Escape") {
            selected = -1;
            render();
          }
        },
        { signal },
      );
      const terrain = node(cell, "span", "jungle-terrain");
      const piece = node(cell, "span", "jungle-piece");
      const animal = node(piece, "span", "jungle-animal");
      const captureMark = node(cell, "span", "jungle-capture-indicator");
      captureMark.setAttribute("aria-hidden", "true");
      captureMark.hidden = true;
      for (const el of [terrain, piece]) el.setAttribute("aria-hidden", "true");
      cell.parts = { terrain, piece, animal, captureMark };
      return cell;
    });
    const lastMove = node(board, "div", "jungle-last-move");
    lastMove.setAttribute("aria-hidden", "true");
    let lastMoveKey = "";
    const result = node(stage, "section", "jungle-result");
    result.hidden = true;
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    const resultCard = node(result, "div", "jungle-result-card");
    const resultArt = node(resultCard, "div", "jungle-result-art");
    resultArt.setAttribute("aria-hidden", "true");
    const resultTitle = node(resultCard, "h3", "jungle-result-title");
    const resultNote = node(resultCard, "p", "jungle-result-note");
    const resultActions = node(resultCard, "div", "jungle-result-actions");
    let dismissedResult = "",
      resultArtKind = "";
    const controls = node(play, "aside", "jungle-controls");
    const objective = node(controls, "header", "jungle-objective");
    const matchTitle = node(objective, "h3", "jungle-heading");
    const matchDetail = node(objective, "p", "jungle-detail");
    const status = node(objective, "p", "jungle-status");
    status.setAttribute("role", "status");
    const thinkingIndicator = node(objective, "div", "jungle-thinking");
    thinkingIndicator.setAttribute("aria-hidden", "true");
    // Material Symbols Rounded Psychology, Apache-2.0; Google revision 737e3324305806514d7909874fa1818ae1808232.
    thinkingIndicator.innerHTML = `<svg class="jungle-thinking-icon" viewBox="0 -960 960 960" focusable="false">
      <path d="M240-252q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v40q0 17-11.5 28.5T560-80q-17 0-28.5-11.5T520-120v-80q0-17 11.5-28.5T560-240h120v-160q0-17 11.5-28.5T720-440h68l-38-155q-23-91-98-148t-172-57q-116 0-198 81t-82 197q0 60 24.5 114t69.5 96l26 24v168q0 17-11.5 28.5T280-80q-17 0-28.5-11.5T240-120v-132Zm254-188Z" />
      <path class="jungle-thinking-gear" d="m434-410 4 32q1 8 6.5 13t13.5 5h44q8 0 13.5-5t6.5-13l4-32q8-3 14.5-7t11.5-9l30 13q7 3 14 1t11-9l22-38q4-7 2.5-14t-7.5-12l-26-19q2-8 2-16t-2-16l26-19q6-5 7.5-12t-2.5-14l-22-38q-4-7-11-9t-14 1l-30 13q-5-5-11.5-9t-14.5-7l-4-32q-1-8-6.5-13t-13.5-5h-44q-8 0-13.5 5t-6.5 13l-4 32q-8 3-14.5 7t-11.5 9l-30-13q-7-3-14-1t-11 9l-22 38q-4 7-2.5 14t7.5 12l26 19q-2 8-2 16t2 16l-26 19q-6 5-7.5 12t2.5 14l22 38q4 7 11 9t14-1l30-13q5 5 11.5 9t14.5 7Zm46-50q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460Z" />
    </svg>`;
    const engineFailure = node(controls, "div", "jungle-engine-error");
    const engineFailureText = node(engineFailure, "p", "jungle-detail");
    engineFailureText.setAttribute("role", "alert");
    button(engineFailure, "retry-engine", "retryEngine", () => {
      engineError = false;
      scheduleAI();
      render();
    });
    const actions = node(controls, "div", "jungle-actions");
    const rotate = button(actions, "rotate", "rotateLandscape", () => {
      cancel();
      const before = board.getBoundingClientRect();
      const panelBefore = controls.getBoundingClientRect();
      const sectionsBefore = [...controls.children].map((element) => ({
        element,
        bounds: element.getBoundingClientRect(),
      }));
      const current = square(focus);
      landscape = !landscape;
      focus = displaySquare(current);
      try {
        localStorage.setItem(
          "worktime.games.jungle.landscape",
          String(landscape),
        );
      } catch {
        /* Keep the session preference. */
      }
      resize(available);
      render();
      animateRotation(before, panelBefore, sectionsBefore);
    });
    const rotateIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    rotateIcon.setAttribute("viewBox", "0 0 24 24");
    rotateIcon.setAttribute("class", "ui-icon");
    rotateIcon.setAttribute("aria-hidden", "true");
    rotateIcon.innerHTML =
      '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="9" height="12" rx="1.5"/><path d="M5 5a8 8 0 0 1 14 5m0-6v6h-5"/></g>';
    const undo = button(actions, "undo", "undo", () => {
      cancel();
      let count = state.path.length - 1;
      if (options.mode === "ai")
        while (count > 0 && (count % 2 ? -1 : 1) !== options.human) count--;
      state = rules.replay(state.path.slice(0, Math.max(0, count)));
      selected = -1;
      persist();
      render();
      scheduleAI();
    });
    const restart = button(actions, "restart", "restart", () =>
      prompt.open(restart),
    );
    const settings = button(actions, "settings", "settings", () => {
      cancel();
      draft = { ...options };
      setupOpen = true;
      selected = -1;
      render();
    });
    actions.insertBefore(settings, undo);
    button(resultActions, "result-review", "reviewBoard", () => {
      dismissedResult = resultKey();
      render();
    });
    button(resultActions, "result-restart", "playAgain", () => {
      cancel();
      state = rules.create();
      selected = -1;
      persist();
      render();
      scheduleAI();
    });
    const prompt = G.createRestartPrompt({
      host: stage,
      signal,
      onOpen() {
        covered = true;
        cancel();
        render();
      },
      onCancel() {
        covered = false;
        render();
        scheduleAI();
      },
      onConfirm() {
        covered = false;
        engineError = false;
        state = rules.create();
        selected = -1;
        persist();
        render();
        scheduleAI();
      },
    });
    const legend = node(controls, "div", "jungle-guide");
    const guideHeading = node(legend, "p", "jungle-guide-heading");
    const strength = node(legend, "div", "jungle-strength");
    strength.setAttribute("role", "group");
    const links = node(strength, "div", "jungle-strength-links");
    links.setAttribute("aria-hidden", "true");
    const ringPoint = (degrees) => {
      const angle = (degrees * Math.PI) / 180;
      return [120 + 88 * Math.cos(angle), 120 + 88 * Math.sin(angle)];
    };
    links.innerHTML = `<svg viewBox="0 0 240 240" aria-hidden="true" focusable="false"><defs><marker id="jungle-strength-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 .5 4 2.5 0 4.5Z" fill="currentColor"/></marker><marker id="jungle-strength-exception" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 .5 4 2.5 0 4.5Z" fill="var(--jungle-red)"/></marker></defs><circle cx="120" cy="120" r="88" fill="none" stroke="currentColor" opacity=".12"/>${Array.from(
      { length: 8 },
      (_, i) => {
        const start = ringPoint(-90 + i * 45 + 17),
          end = ringPoint(-90 + (i + 1) * 45 - 17);
        return `<path class="jungle-strength-link${i === 7 ? " is-exception" : ""}" d="M${start[0].toFixed(2)} ${start[1].toFixed(2)}A88 88 0 0 1 ${end[0].toFixed(2)} ${end[1].toFixed(2)}" fill="none" stroke="currentColor" stroke-width="1.8" marker-end="url(#${i === 7 ? "jungle-strength-exception" : "jungle-strength-arrow"})"/>`;
      },
    ).join("")}</svg>`;
    const guideAnimals = Array.from({ length: 8 }, (_, i) => {
      const portrait = node(strength, "span", "jungle-guide-animal");
      portrait.innerHTML = art.portraits[8 - i];
      const [x, y] = ringPoint(-90 + i * 45);
      portrait.style.left = (x / 240) * 100 + "%";
      portrait.style.top = (y / 240) * 100 + "%";
      return portrait;
    });
    const ringCenter = node(strength, "div", "jungle-strength-center");
    const rulesButton = node(ringCenter, "button", "jungle-rules-info");
    rulesButton.type = "button";
    rulesButton.dataset.jungleAction = "rules";
    rulesButton.setAttribute("aria-haspopup", "dialog");
    rulesButton.append(G.createIcon("info"));
    const rulesDialog = node(root, "section", "jungle-rules-dialog");
    rulesDialog.hidden = true;
    rulesDialog.setAttribute("role", "dialog");
    rulesDialog.setAttribute("aria-modal", "true");
    let rulesOpen = false,
      rulesScroll = 0;
    const rulesHeader = node(rulesDialog, "header", "jungle-rules-header");
    const rulesHeading = node(rulesHeader, "h2", "jungle-rules-title");
    rulesHeading.id = "jungleRulesTitle";
    rulesDialog.setAttribute("aria-labelledby", rulesHeading.id);
    const rulesSubtitle = node(rulesHeader, "p", "jungle-rules-paused");
    const closeRules = node(rulesHeader, "button", "jungle-rules-close");
    closeRules.type = "button";
    closeRules.dataset.jungleAction = "rules-close";
    closeRules.append(G.createIcon("close"));
    const rulesBody = node(rulesDialog, "div", "jungle-rules-body");
    const rulesSections = [
      "win",
      "move",
      "capture",
      "water",
      "jump",
      "trap",
      "draw",
    ].map((key) => {
      const card = node(rulesBody, "section", "jungle-rule-card");
      card.dataset.rule = key;
      const title = node(card, "h3", "");
      const description = node(card, "p", "");
      return { key, title, description };
    });
    const rulesFooter = node(rulesDialog, "footer", "jungle-rules-footer");
    const resumeRules = node(rulesFooter, "button", "game-button");
    resumeRules.type = "button";
    resumeRules.dataset.jungleAction = "rules-resume";
    function dismissRules() {
      if (!rulesOpen) return;
      rulesOpen = false;
      covered = false;
      render();
      root.scrollTop = rulesScroll;
      rulesButton.focus({ preventScroll: true });
      scheduleAI();
    }
    rulesButton.addEventListener(
      "click",
      () => {
        if (paused || signal.aborted || rulesOpen) return;
        rulesScroll = root.scrollTop;
        rulesOpen = true;
        covered = true;
        cancel();
        render();
        root.scrollTop = 0;
        closeRules.focus({ preventScroll: true });
      },
      { signal },
    );
    closeRules.addEventListener("click", dismissRules, { signal });
    resumeRules.addEventListener("click", dismissRules, { signal });
    rulesDialog.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismissRules();
        } else if (event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          (document.activeElement === closeRules
            ? resumeRules
            : closeRules
          ).focus();
        }
      },
      { signal },
    );
    const error = node(root, "p", "jungle-save-error");
    error.setAttribute("role", "status");
    const celebration = G.createCelebration(signal);
    function square(display) {
      const p = landscape
        ? (8 - (display % 9)) * 7 + Math.floor(display / 9)
        : display;
      return options.mode === "ai" && options.human === -1 ? 62 - p : p;
    }
    function displaySquare(p) {
      const base = options.mode === "ai" && options.human === -1 ? 62 - p : p;
      return landscape ? (base % 7) * 9 + 8 - Math.floor(base / 7) : base;
    }
    function resize(size) {
      const changed =
        available.width !== size.width || available.height !== size.height;
      available = size;
      const compact = size.width < 900;
      root.dataset.compact = String(compact);
      root.dataset.orientation = landscape ? "landscape" : "portrait";
      const width = Math.max(
        200,
        Math.min(
          landscape ? 1160 : 760,
          size.width - (compact ? 16 : 292),
          compact ? Infinity : (size.height - 24) * (landscape ? 9 / 7 : 7 / 9),
        ),
      );
      root.style.setProperty("--jungle-size", width + "px");
      root.style.setProperty(
        "--jungle-panel-height",
        width * (landscape ? 7 / 9 : 9 / 7) + "px",
      );
      if (changed && (moving || rotating)) {
        settleMotion();
        settleRotation();
        render();
        scheduleAI();
      }
    }
    function settleMotion() {
      if (!motion) return;
      const current = motion;
      motion = null;
      moving = false;
      current.animations.forEach((animation) => animation.cancel());
      current.capture?.remove();
      current.cell.classList.remove("is-moving");
      board.dataset.moving = "false";
    }
    function settleRotation() {
      if (!rotation) return;
      const current = rotation;
      rotation = null;
      rotating = false;
      current.forEach((animation) => animation.cancel());
      root.dataset.rotating = "false";
    }
    function animateRotation(before, panelBefore, sectionsBefore) {
      const after = board.getBoundingClientRect();
      if (reduced.matches || !before.width || !after.width || !playable()) {
        scheduleAI();
        return;
      }
      const angle = landscape ? -90 : 90;
      const dx = before.left + before.width / 2 - after.left - after.width / 2;
      const dy = before.top + before.height / 2 - after.top - after.height / 2;
      const scale = before.width / after.height;
      const timing = { duration: 560, easing: "cubic-bezier(.22,.7,.25,1)" };
      const bounds = root.getBoundingClientRect();
      // Fit every sampled angle, so a tall board never clips its corners mid-turn.
      const frames = Array.from({ length: 17 }, (_, index) => {
        const progress = index / 16,
          remaining = 1 - progress;
        const degrees = angle * remaining,
          radians = (degrees * Math.PI) / 180;
        const x = dx * remaining,
          y = dy * remaining;
        const centerX = after.left + after.width / 2 + x;
        const centerY = after.top + after.height / 2 + y;
        const width =
          after.width * Math.abs(Math.cos(radians)) +
          after.height * Math.abs(Math.sin(radians));
        const height =
          after.width * Math.abs(Math.sin(radians)) +
          after.height * Math.abs(Math.cos(radians));
        const roomX =
          2 *
          Math.max(
            1,
            Math.min(centerX - bounds.left - 8, bounds.right - centerX - 8),
          );
        const roomY =
          2 *
          Math.max(
            1,
            Math.min(centerY - bounds.top - 8, bounds.bottom - centerY - 8),
          );
        const desired = scale + (1 - scale) * progress;
        const fitted =
          index === 0
            ? scale
            : index === 16
              ? 1
              : Math.min(desired, roomX / width, roomY / height) * 0.98;
        return {
          offset: progress,
          transform: `translate(${x}px, ${y}px) rotate(${degrees}deg) scale(${fitted})`,
        };
      });
      rotating = true;
      root.dataset.rotating = "true";
      const animations = [compat.animate(board, frames, timing)];
      // Move the sidebar and its three sections with the same clock as the board.
      // Animate relative offsets instead of scaling, keeping labels and icons crisp.
      const panelAfter = controls.getBoundingClientRect();
      const sectionsAfter = sectionsBefore.map((section) => ({
        ...section,
        end: section.element.getBoundingClientRect(),
      }));
      const panelX = panelBefore.left - panelAfter.left;
      const panelY = panelBefore.top - panelAfter.top;
      animations.push(
        compat.animate(
          controls,
          [
            { transform: `translate(${panelX}px, ${panelY}px)` },
            { transform: "translate(0, 0)" },
          ],
          timing,
        ),
      );
      for (const { element, bounds, end } of sectionsAfter) {
        const x = bounds.left - end.left - panelX;
        const y = bounds.top - end.top - panelY;
        animations.push(
          compat.animate(
            element,
            [
              { transform: `translate(${x}px, ${y}px)` },
              { transform: "translate(0, 0)" },
            ],
            timing,
          ),
        );
      }
      // Counter-rotate the faces and landmarks while the map turns beneath them.
      for (const cell of cells) {
        const parts = [
          ...(!cell.parts.piece.hidden ? [cell.parts.piece] : []),
          ...(cell.parts.terrain.firstChild ? [cell.parts.terrain] : []),
        ];
        for (const part of parts)
          animations.push(
            compat.animate(
              part,
              [
                { transform: `rotate(${-angle}deg)` },
                { transform: "rotate(0deg)" },
              ],
              timing,
            ),
          );
      }
      rotation = animations;
      render();
      Promise.all(animations.map((animation) => animation.finished)).then(
        () => {
          if (rotation !== animations) return;
          settleRotation();
          render();
          scheduleAI();
        },
      );
    }
    function persist() {
      options.path = state.path;
      try {
        storage.setItem(
          archive.keys["game-jungle"],
          JSON.stringify({ version: 1, state: options }),
        );
        failed = false;
      } catch {
        failed = true;
      }
    }
    function cancel() {
      settleMotion();
      settleRotation();
      generation++;
      engineSearch?.cancel();
      engineSearch = null;
      thought?.cancel();
      thought = null;
      thinking = false;
    }
    function playable() {
      return (
        !paused &&
        !covered &&
        !setupOpen &&
        !rotating &&
        !signal.aborted &&
        !document.hidden
      );
    }
    function attempt(p) {
      if (
        !playable() ||
        moving ||
        thinking ||
        state.status !== "playing" ||
        (options.mode === "ai" && state.turn !== options.human)
      )
        return;
      if (Math.sign(state.board[p]) === state.turn) {
        selected = selected === p ? -1 : p;
        render();
        return;
      }
      const next = selected < 0 ? null : rules.move(state, selected, p);
      if (next) accept(next);
    }
    function accept(next) {
      settleMotion();
      const [from, to] = next.path.at(-1);
      const source = cells[displaySquare(from)],
        target = cells[displaySquare(to)];
      const start = source.getBoundingClientRect(),
        end = target.getBoundingClientRect();
      const capture = state.board[to]
        ? target.parts.piece.cloneNode(true)
        : null;
      state = next;
      selected = -1;
      persist();
      render();
      const finish = () => {
        if (state.status === "won" && options.mode === "local")
          celebration.play(board);
        scheduleAI();
      };
      if (!reduced.matches && playable() && start.width && end.width) {
        moving = true;
        target.classList.add("is-moving");
        board.dataset.moving = "true";
        const jump =
          rules.water(from) === false &&
          (Math.abs(from - to) > 7 || Math.abs((from % 7) - (to % 7)) > 1);
        const dx = start.left - end.left,
          dy = start.top - end.top;
        const animation = compat.animate(
          target.parts.piece,
          [
            { transform: `translate(${dx}px, ${dy}px) scale(1)` },
            {
              transform: `translate(${dx * 0.5}px, ${dy * 0.5 - (jump ? end.height * 0.45 : 5)}px) scale(${jump ? 1.16 : 1.07})`,
              offset: 0.5,
            },
            { transform: "translate(0, 0) scale(1)" },
          ],
          { duration: jump ? 520 : 320, easing: "cubic-bezier(.22,.7,.25,1)" },
        );
        const animations = [animation];
        if (capture) {
          capture.classList.add("jungle-captured");
          target.append(capture);
          animations.push(
            compat.animate(
              capture,
              [
                { opacity: 1, transform: "scale(1)" },
                { opacity: 0, transform: "scale(.6)" },
              ],
              {
                duration: 220,
                delay: jump ? 300 : 100,
                fill: "both",
                easing: "ease-out",
              },
            ),
          );
        }
        const current = { animations, cell: target, capture };
        motion = current;
        render();
        Promise.all(animations.map((entry) => entry.finished)).then(() => {
          if (motion !== current) return;
          settleMotion();
          render();
          finish();
        });
        return;
      }
      finish();
    }
    function scheduleAI() {
      if (
        !playable() ||
        moving ||
        !active ||
        options.mode !== "ai" ||
        state.status !== "playing" ||
        state.turn === options.human ||
        thinking ||
        engineError
      )
        return;
      thinking = true;
      render();
      const token = ++generation;
      thought = G.createThinkTurn({
        simple: options.difficulty === "easy",
        advanced: options.difficulty === "hard",
      });
      engineSearch = G.jungleEngine.search(state, options.difficulty, {
        onResult(result) {
          if (token !== generation) return;
          engineSearch = null;
          root.dataset.engine = result.engine;
          root.dataset.engineDepth = result.depth;
          root.dataset.engineNodes = result.nodes;
          thought.wait(() => {
            if (token !== generation || !playable()) return;
            thinking = false;
            thought = null;
            const next = rules.move(state, ...result.move);
            if (next) accept(next);
            else fail();
          });
        },
        onError: fail,
      });
      function fail() {
        if (token !== generation) return;
        cancel();
        engineError = true;
        render();
      }
    }
    function render() {
      catalog.page.hidden = !setupOpen || rulesOpen;
      play.hidden = setupOpen || rulesOpen;
      rulesDialog.hidden = !rulesOpen;
      root.dataset.rulesOpen = String(rulesOpen);
      catalog.refresh();
      catalog.setReturn(active ? returnToMatch : null);
      if (setupOpen) catalog.selectCategory(draft.mode);
      heading.textContent = t(draft.mode);
      intro.textContent = t("intro");
      for (const { el, label } of buttons) el.textContent = t(label);
      for (const [control, label, icon] of [
        [undo, "undo", "undo"],
        [restart, "restart", "restart-alt"],
        [settings, "settings", "grid-4x4"],
      ]) {
        control.replaceChildren(G.createIcon(icon));
        node(control, "span", "jungle-action-label").textContent = t(label);
        control.setAttribute("aria-label", t(label));
      }
      rotate.replaceChildren(
        rotateIcon,
        document.createTextNode(
          t(landscape ? "rotatePortrait" : "rotateLandscape"),
        ),
      );
      rotate.setAttribute("aria-pressed", String(landscape));
      rotate.disabled = rotating;
      for (const group of [modes, difficulties, sides]) {
        group.legend.textContent = t(group.label);
        for (const { value, control } of group.items)
          control.setAttribute(
            "aria-pressed",
            String(draft[group.field] === value),
          );
      }
      difficulties.group.hidden =
        sides.group.hidden =
        engineLabel.hidden =
          draft.mode !== "ai";
      engineLabel.textContent = t("engineName");
      engineFailure.hidden = !engineError;
      engineFailureText.textContent = t("engineError");
      setupActions.hidden = draft.mode === "ai";
      for (const { value, control } of sides.items) {
        control.removeAttribute("aria-pressed");
        control.replaceChildren();
        node(control, "span", "jungle-start-side").textContent = t(
          value === 1 ? "first" : "second",
        );
        node(control, "span", "jungle-start-label").textContent =
          t("startShort");
        control.setAttribute(
          "aria-label",
          t(value === 1 ? "first" : "second") + " · " + t("startShort"),
        );
      }
      matchTitle.textContent = t(options.mode);
      matchDetail.textContent =
        options.mode === "ai"
          ? t(options.difficulty) +
            " · " +
            t(options.human === 1 ? "first" : "second")
          : t("localHint");
      status.textContent =
        state.status === "draw"
          ? t("draw")
          : state.status === "won"
            ? t("winner", { side: t(state.winner === 1 ? "red" : "blue") })
            : engineError
              ? t("enginePaused")
              : thinking
                ? t("thinking")
                : t("turn", { side: t(state.turn === 1 ? "red" : "blue") });
      status.dataset.thinking = String(thinking);
      const statusSide =
        state.status === "won"
          ? state.winner
          : state.status === "draw" || engineError
            ? 0
            : state.turn;
      status.dataset.side =
        statusSide === 1 ? "red" : statusSide === -1 ? "blue" : "neutral";
      thinkingIndicator.toggleAttribute(
        "data-active",
        options.mode === "ai" &&
          state.status === "playing" &&
          thinking &&
          !engineError &&
          !setupOpen,
      );
      // Keep the thinker's color while the icon fades out after the turn changes.
      if (thinking)
        thinkingIndicator.dataset.side = state.turn === 1 ? "red" : "blue";
      renderResult();
      undo.disabled =
        state.path.length <=
        (options.mode === "ai" && options.human === -1 ? 1 : 0);
      guideHeading.textContent = t("strength");
      strength.setAttribute("aria-label", t("strength"));
      rulesButton.title = t("rulesTitle");
      rulesButton.setAttribute("aria-label", t("rulesTitle"));
      rulesHeading.textContent = t("rulesTitle");
      rulesSubtitle.textContent = t("rulesPaused");
      closeRules.setAttribute("aria-label", t("rulesResume"));
      resumeRules.textContent = t("rulesResume");
      rulesSections.forEach(({ key, title, description }) => {
        title.textContent = t("rule_" + key + "_title");
        description.textContent = t("rule_" + key);
      });
      guideAnimals.forEach((el, i) => {
        el.title = t("animal" + (8 - i));
        el.setAttribute("aria-label", el.title);
        el.setAttribute("role", "img");
      });
      error.hidden = !failed || rulesOpen;
      error.textContent = t("saveError");
      const flipped = options.mode === "ai" && options.human === -1;
      root.dataset.orientation = landscape ? "landscape" : "portrait";
      board.style.setProperty("--jungle-columns", landscape ? "9" : "7");
      board.style.setProperty("--jungle-rows", landscape ? "7" : "9");
      if (mapKey !== landscape + ":" + flipped) {
        mapKey = landscape + ":" + flipped;
        map.innerHTML = art.map(landscape, flipped);
      }
      board.setAttribute(
        "aria-label",
        t(landscape ? "boardLandscape" : "board"),
      );
      board.setAttribute("aria-busy", String(thinking));
      board.dataset.turn = state.turn;
      const targets =
        selected < 0
          ? []
          : rules
              .legal(state.board, state.turn)
              .filter(([from]) => from === selected)
              .map(([, to]) => to);
      const last = state.path.at(-1) ?? [];
      board.dataset.lastSide = last.length
        ? Math.sign(state.board[last[1]])
        : 0;
      const trailKey = [landscape, flipped, ...last].join(":");
      lastMove.hidden = !last.length;
      if (trailKey !== lastMoveKey) {
        lastMoveKey = trailKey;
        lastMove.replaceChildren();
        if (last.length) {
          const columns = landscape ? 9 : 7,
            rows = landscape ? 7 : 9;
          const from = displaySquare(last[0]),
            to = displaySquare(last[1]);
          const x1 = ((from % columns) + 0.5) * 100,
            y1 = (Math.floor(from / columns) + 0.5) * 100;
          const x2 = ((to % columns) + 0.5) * 100,
            y2 = (Math.floor(to / columns) + 0.5) * 100;
          const length = Math.hypot(x2 - x1, y2 - y1),
            dx = (x2 - x1) / length,
            dy = (y2 - y1) / length;
          const tipX = x2 - dx * 46,
            tipY = y2 - dy * 46;
          const line = `M${x1 + dx * 14} ${y1 + dy * 14}L${tipX - dx * 2} ${tipY - dy * 2}`;
          const head = `M${tipX - dx * 10 - dy * 6} ${tipY - dy * 10 + dx * 6}L${tipX} ${tipY}L${tipX - dx * 10 + dy * 6} ${tipY - dy * 10 - dx * 6}`;
          lastMove.innerHTML = `<svg viewBox="0 0 ${columns * 100} ${rows * 100}" preserveAspectRatio="none" focusable="false"><g class="jungle-trail-origin"><circle cx="${x1}" cy="${y1}" r="9" fill="none" stroke="#fffd" stroke-width="6"/><circle cx="${x1}" cy="${y1}" r="9" fill="none" stroke="currentColor" stroke-width="2.8"/></g><path class="jungle-trail-line jungle-trail-halo" d="${line}" pathLength="1"/><path class="jungle-trail-line" d="${line}" pathLength="1"/><path class="jungle-trail-head jungle-trail-halo" d="${head}"/><path class="jungle-trail-head" d="${head}"/></svg>`;
        }
      }
      cells.forEach((cell, display) => {
        const p = square(display),
          occupant = state.board[p],
          animal = Math.abs(occupant);
        const terrain = rules.water(p)
          ? "river"
          : rules.dens.includes(p)
            ? "den"
            : rules.traps.flat().includes(p)
              ? "trap"
              : "land";
        cell.dataset.square = p;
        cell.dataset.terrain = terrain;
        cell.dataset.side = Math.sign(occupant);
        cell.dataset.target = String(targets.includes(p));
        if (targets.includes(p)) {
          const columns = landscape ? 9 : 7;
          const from = displaySquare(selected);
          const dx = (display % columns) - (from % columns);
          const dy = Math.floor(display / columns) - Math.floor(from / columns);
          // Paw artwork points up at 0deg; use the selected piece's screen-space move.
          const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
          cell.style.setProperty("--jungle-paw-angle", angle + "deg");
        } else cell.style.removeProperty("--jungle-paw-angle");
        cell.classList.toggle("is-selected", p === selected);
        cell.classList.toggle("is-last", last.includes(p));
        cell.dataset.lastMove =
          p === last[0] ? "from" : p === last[1] ? "to" : "";
        cell.tabIndex = display === focus ? 0 : -1;
        cell.setAttribute("aria-pressed", String(p === selected));
        cell.setAttribute(
          "aria-disabled",
          String(
            thinking ||
              moving ||
              rotating ||
              covered ||
              paused ||
              state.status !== "playing",
          ),
        );
        const parts = cell.parts;
        const captureTarget = targets.includes(p) && occupant !== 0;
        parts.captureMark.hidden = !captureTarget;
        if (captureTarget && !parts.captureMark.firstChild)
          parts.captureMark.innerHTML = art.capture;
        cell.dataset.owner =
          terrain === "den" || terrain === "trap"
            ? p < 21
              ? "blue"
              : "red"
            : "none";
        if (parts.terrain.dataset.kind !== terrain) {
          parts.terrain.dataset.kind = terrain;
          parts.terrain.innerHTML = art.terrain[terrain] || "";
        }
        parts.piece.hidden = !occupant;
        parts.piece.dataset.side = Math.sign(occupant);
        if (parts.animal.dataset.kind !== String(animal)) {
          parts.animal.dataset.kind = animal;
          parts.animal.innerHTML = art.portraits[animal] || "";
        }
        const pieceName = occupant
          ? t(occupant > 0 ? "red" : "blue") + " " + t("animal" + animal)
          : t("empty");
        cell.setAttribute(
          "aria-label",
          t("square", {
            column: (display % (landscape ? 9 : 7)) + 1,
            row: Math.floor(display / (landscape ? 9 : 7)) + 1,
            piece: pieceName,
            terrain: t(terrain),
          }) +
            (targets.includes(p)
              ? " · " + t(captureTarget ? "capture" : "legal")
              : "") +
            (p === last[0]
              ? " · " + t("lastFrom")
              : p === last[1]
                ? " · " + t("lastTo")
                : ""),
        );
      });
    }
    function resultKey() {
      return [
        options.mode,
        options.human,
        state.status,
        state.winner,
        JSON.stringify(state.path),
      ].join(":");
    }
    function renderResult() {
      const terminal = options.mode === "ai" && state.status !== "playing";
      if (!terminal) dismissedResult = "";
      result.hidden =
        !terminal ||
        setupOpen ||
        covered ||
        moving ||
        rotating ||
        dismissedResult === resultKey();
      if (!terminal) return;
      const kind =
        state.status === "draw"
          ? "draw"
          : state.winner === options.human
            ? "win"
            : "loss";
      result.dataset.outcome = kind;
      resultTitle.textContent = t("result" + kind);
      resultNote.textContent = t("resultNote" + kind);
      const lastTo = state.path.at(-1)?.[1];
      const enteringAnimal =
        state.status === "won" && rules.dens.includes(lastTo)
          ? Math.abs(state.board[lastTo])
          : 0;
      const animal =
        enteringAnimal || (kind === "win" ? 7 : kind === "loss" ? 8 : 3);
      const artKey = kind + ":" + animal;
      if (artKey === resultArtKind) return;
      resultArtKind = artKey;
      const portrait = art.portraits[animal]
        .replace(/^<svg[^>]*>/, "")
        .replace(/<\/svg>$/, "");
      const stars =
        '<path d="m25 22 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Zm110 12 2 5 6 1-4 4 1 5-5-3-5 3 1-5-4-4 6-1Z" fill="#e7b952"/>';
      const backdrop =
        kind === "win"
          ? `<circle cx="80" cy="65" r="49" fill="#f4db8e"/><path d="m45 92-7 35 23-8 15 14 4-38m0 0 4 38 15-14 23 8-7-35" fill="#df916d"/>${stars}`
          : kind === "loss"
            ? '<circle cx="80" cy="65" r="49" fill="#dce9ee"/><path d="M34 110q-12 0-12-9t12-9q3-13 16-11 10 0 13 13 11-3 12 7t-13 9Z" fill="#f7faf9"/><path d="m130 39 5 7m-2 9 7 1" stroke="#8badb9" stroke-width="3" stroke-linecap="round"/>'
            : `<circle cx="80" cy="65" r="49" fill="#e3eacb"/>${stars}`;
      resultArt.innerHTML = `<svg viewBox="0 0 160 140" focusable="false">${backdrop}<g transform="translate(39 24) scale(.82)">${portrait}</g>${kind === "win" ? '<path d="m61 25 3-14 16 8 16-8 3 14Z" fill="#efbd43" stroke="#b78c31" stroke-width="1.5"/>' : kind === "loss" ? '<path d="m119 75 4-8 4 8q0 7-4 7t-4-7Z" fill="#88b8cb"/>' : ""}</svg>`;
    }
    document.addEventListener("worktime:languagechange", render, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          cancel();
          render();
        } else scheduleAI();
      },
      { signal },
    );
    signal.addEventListener("abort", cancel, { once: true });
    const unlistenMotion = compat.listen(reduced, () => {
      settleMotion();
      settleRotation();
      render();
      scheduleAI();
    });
    signal.addEventListener("abort", unlistenMotion, { once: true });
    render();
    scheduleAI();
    return {
      pause() {
        paused = true;
        cancel();
        render();
      },
      resume() {
        paused = false;
        render();
        scheduleAI();
      },
      resize,
      dispose() {
        cancel();
        celebration.dispose();
        root.remove();
      },
    };
  },
});
