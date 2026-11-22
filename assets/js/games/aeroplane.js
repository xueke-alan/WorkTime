"use strict";
WorkTimeApp.games.register({
  id: "game-aeroplane",
  nameKey: "games.aeroplane.name",
  descriptionKey: "games.aeroplane.description",
  icon: "game-aeroplane",
  create({ container, signal }) {
    const G = WorkTimeApp.games,
      R = G.aeroplaneRules,
      A = G.aeroplaneAi;
    const archive = WorkTimeApp.services.gameArchive,
      storage = archive.session();
    const t = (key, params) =>
      WorkTimeApp.i18n.t("games.aeroplane." + key, params);
    const root = document.createElement("section");
    root.className = "game-aeroplane game-session";
    container.append(root);
    let state = R.create(),
      setup = true,
      shellPaused = false,
      disposed = false,
      busy = false,
      error = "",
      restarting = false,
      worker = null,
      url = null,
      generation = 0,
      timer = null;
    let seats = state.seats.slice(),
      focused = null,
      rollingPlayer = null;
    const animations = new Set();
    try {
      const raw = storage.getItem(archive.keys["game-aeroplane"]);
      if (raw !== null) {
        state = archive.normalize("game-aeroplane", JSON.parse(raw)).state;
        seats = state.seats.slice();
        setup = false;
      }
    } catch {
      error = "invalid";
    }
    const el = (tag, cls, text, parent = root) => {
      const n = document.createElement(tag);
      n.className = cls;
      if (text !== undefined) n.textContent = text;
      parent.append(n);
      return n;
    };
    function button(parent, text, action, disabled = false) {
      const b = el("button", "aero-button", text, parent);
      b.type = "button";
      b.dataset.aeroAction = action;
      b.disabled = disabled;
      return b;
    }
    function stop() {
      generation++;
      rollingPlayer = null;
      clearTimeout(timer);
      timer = null;
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
      for (const a of animations) a.cancel();
      animations.clear();
      busy = false;
    }
    function save() {
      try {
        storage.setItem(
          archive.keys["game-aeroplane"],
          JSON.stringify({ version: 1, state }),
        );
      } catch {
        error = "saveError";
      }
    }
    const allowed = () =>
      !disposed &&
      !setup &&
      !shellPaused &&
      !busy &&
      !restarting &&
      !error &&
      state.phase !== "won";
    const human = () => state.seats[state.turn] === "human";
    const reduced = () =>
      document.documentElement.dataset.reducedMotion === "true" ||
      (WorkTimeApp.ui.animationCompat?.preference().matches ??
        matchMedia("(prefers-reduced-motion: reduce)").matches);
    function svg(tag, attrs, parent) {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      parent.append(n);
      return n;
    }
    function render(
      active = document.activeElement?.getAttribute("data-aero-action"),
    ) {
      if (disposed) return;
      const previousPlayer =
        root.querySelector(".aero-dice")?.dataset.dicePlayer;
      const previousChoices = root.querySelector(".aero-plane-choices");
      const workspace =
        root.querySelector(".aero-workspace") ?? el("div", "aero-workspace");
      const side =
        workspace.querySelector(".aero-sidebar") ??
        el("aside", "aero-sidebar", undefined, workspace);
      const playerCards = [...side.querySelectorAll(".aero-player")];
      const previousSeats = Boolean(root.querySelector(".aero-switch"));
      side
        .querySelectorAll(":scope > :not(.aero-player)")
        .forEach((node) => node.remove());
      workspace.querySelector(".aero-board-wrap")?.remove();
      root.toggleAttribute("data-visual-busy", busy);
      const boardWrap = el("div", "aero-board-wrap", undefined, workspace);
      workspace.prepend(boardWrap);
      side.inert = false;
      const board = el("div", "aero-board", undefined, boardWrap);
      board.setAttribute("role", "group");
      board.setAttribute("aria-label", t("board"));
      const art = svg(
        "svg",
        {
          viewBox: "-.3 -.3 17.6 17.6",
          "aria-hidden": "true",
          class: "aero-art",
        },
        board,
      );
      svg(
        "rect",
        {
          x: -0.22,
          y: -0.22,
          width: 17.44,
          height: 17.44,
          rx: 0.28,
          class: "aero-board-paper",
        },
        art,
      );
      const shape = (points, cls, parent = art) =>
        svg(
          "polygon",
          { points: points.map((q) => q.join(",")).join(" "), class: cls },
          parent,
        );
      R.polygons.forEach((points, i) =>
        shape(points, "aero-square aero-" + R.colors[R.squareColor(i)]),
      );
      for (let p = 0; p < 4; p++) {
        const color = "aero-" + R.colors[p];
        const base = svg("g", { transform: `rotate(${p * 90} 8.5 8.5)` }, art);
        svg(
          "rect",
          {
            x: 0.18,
            y: 13.18,
            width: 3.64,
            height: 3.64,
            rx: 0.3,
            class: "aero-airport " + color,
          },
          base,
        );
        for (let i = 0; i < 4; i++) {
          const [x, y] = R.coordinate(p, -2, i);
          svg(
            "circle",
            { cx: x, cy: y, r: 0.53, class: "aero-hangar " + color },
            art,
          );
        }
        shape(
          [
            [4, 15],
            [4, 17],
            [6, 17],
          ].map((q) => R.rotate(q, p)),
          "aero-start " + color,
        );
        for (let n = 51; n < R.END; n++) {
          const [x, y] = R.coordinate(p, n);
          const home = svg(
            "g",
            { transform: `rotate(${p * 90} ${x} ${y})` },
            art,
          );
          svg(
            "rect",
            {
              x: x - 0.5,
              y: y - 0.5,
              width: 1,
              height: 1,
              class: "aero-home " + color,
            },
            home,
          );
          svg("circle", { cx: x, cy: y, r: 0.15, class: "aero-stop" }, home);
        }
        shape(
          [
            [7, 10],
            [10, 10],
            [8.5, 8.5],
          ].map((q) => R.rotate(q, p)),
          "aero-finish " + color,
        );
        const [sx, sy] = R.coordinate(p, -1);
        svg(
          "path",
          {
            d: `M${sx - 0.18} ${sy - 0.2}h.35v.35m-.35-.35 .35.35`,
            transform: `rotate(${p * 90} ${sx} ${sy})`,
            class: "aero-launch-arrow " + color,
          },
          art,
        );
      }
      // Lines are drawn above the cells; each midpoint is the exact capturable
      // square of the opposite home lane used by the rules.
      for (let p = 0; p < 4; p++) {
        const [x1, y1] = R.coordinate(p, 18),
          [xm, ym] = R.coordinate((p + 2) % 4, 53),
          [x2, y2] = R.coordinate(p, 30);
        const line = svg(
          "g",
          { class: "aero-flight-line aero-" + R.colors[p] },
          art,
        );
        svg("path", { d: `M${x1},${y1} L${xm},${ym} L${x2},${y2}` }, line);
        const ax = (xm + x2) / 2,
          ay = (ym + y2) / 2;
        svg(
          "path",
          {
            d: `M${ax - 0.25},${ay - 0.14} L${ax},${ay} L${ax - 0.25},${ay + 0.14}`,
            transform: `rotate(${p * 90} ${ax} ${ay})`,
            class: "aero-flight-arrow",
          },
          line,
        );
      }
      R.track.forEach(([x, y]) => {
        svg("circle", { cx: x, cy: y, r: 0.17, class: "aero-stop" }, art);
      });
      const moves = !setup && state.phase === "move" ? R.legal(state) : [];
      state.pieces.forEach((n, idx) => {
        const p = Math.floor(idx / 4),
          i = idx % 4,
          [x, y] = R.coordinate(p, n, i);
        const same = state.pieces
          .map((v, k) => ({ v, k }))
          .filter((o) => Math.floor(o.k / 4) === p && o.v === n)
          .map((o) => o.k);
        const offset =
          n === -2 || n === R.END
            ? 0
            : (same.indexOf(idx) - (same.length - 1) / 2) * 0.22;
        const plane = el(
          "button",
          `aero-plane aero-${R.colors[p]}`,
          undefined,
          board,
        );
        plane.type = "button";
        plane.dataset.plane = String(idx);
        plane.dataset.aeroAction = "plane-" + i;
        plane.style.left = ((x + 0.3 + offset) / 17.6) * 100 + "%";
        plane.style.top = ((y + 0.3 + offset) / 17.6) * 100 + "%";
        plane.innerHTML =
          '<span class="aero-plane-model"><svg viewBox="0 .5 32 32" aria-hidden="true"><path class="aero-plane-body" d="M16 3c-1.4 0-2 2-2 5v5L4 20v3l10-4v6l-4 3v2l6-2 6 2v-2l-4-3v-6l10 4v-3l-10-7V8c0-3-.6-5-2-5Z"/></svg></span>';
        plane.setAttribute(
          "aria-label",
          t("plane", {
            color: t(R.colors[p]),
            n: i + 1,
            position:
              n === -2
                ? t("hangar")
                : n === -1
                  ? t("launchPad")
                  : n === R.END
                    ? t("arrived")
                    : String(n),
          }),
        );

        plane.disabled = !(
          p === state.turn &&
          moves.includes(i) &&
          allowed() &&
          human()
        );
        if (!plane.disabled) plane.classList.add("aero-legal");
        if (n === R.END) plane.classList.add("aero-arrived");
      });
      if (!setup) {
        const player = rollingPlayer ?? state.turn;
        const value = state.die || lastDie(player);
        const dice = button(
          board,
          "",
          "roll",
          !allowed() || !human() || state.phase !== "roll",
        );
        dice.className = "aero-dice aero-" + R.colors[player];
        dice.dataset.dicePlayer = String(player);
        dice.dataset.dieValue = String(value);
        dice.setAttribute(
          "aria-label",
          t("roll") + (value ? ": " + value : ""),
        );
        const [x, y] = R.rotate([2, 15], player);
        dice.style.left = ((x + 0.3) / 17.6) * 100 + "%";
        dice.style.top = ((y + 0.3) / 17.6) * 100 + "%";
        dice.innerHTML =
          '<span class="aero-dice-scene" aria-hidden="true"><span class="aero-dice-lift"><span class="aero-dice-cube"></span></span></span>';
        if (!busy && !restarting && previousPlayer !== String(player))
          dice.classList.add("aero-dice-enter");
        G.dice3d.draw(dice, value);
        dice.classList.toggle(
          "aero-dice-ready",
          allowed() && human() && state.phase === "roll",
        );
      }
      for (let p = 0; p < 4; p++) {
        const row =
          playerCards[p] ??
          el("div", `aero-player aero-${R.colors[p]}`, undefined, side);
        const color = t(R.colors[p]);
        const kind = setup ? seats[p] : state.seats[p];
        row.ariaCurrent =
          !setup && p === (rollingPlayer ?? state.turn) && state.phase !== "won"
            ? "true"
            : null;
        if (!playerCards[p] || previousSeats !== setup) {
          row.replaceChildren();
          el("span", "aero-player-dot", undefined, row).ariaHidden = "true";
          const details = el("div", "aero-player-details", undefined, row);
          el("strong", "", color, details);
          el("span", "aero-player-kind", t(kind), details);
          if (setup) {
            const toggle = button(row, "", "seat-" + p);
            toggle.className = "aero-switch";
            toggle.setAttribute("role", "switch");
            toggle.setAttribute("aria-label", `${color} ${t("human")}`);
            toggle.setAttribute("aria-checked", String(kind === "human"));
          } else el("span", "aero-progress", undefined, row);
        }
        if (!setup) {
          const arrived = state.pieces
            .slice(p * 4, p * 4 + 4)
            .filter((n) => n === R.END).length;
          const progress = row.querySelector(".aero-progress");
          if (progress.textContent !== `${arrived}/4`)
            progress.textContent = `${arrived}/4`;
        }
      }
      const feedback = el("div", "aero-feedback", undefined, side);
      if (setup) {
        button(side, t("start"), "start", !seats.includes("human"));
      } else {
        let message = "";
        if (state.phase === "won")
          message = t("winner", { color: t(R.colors[state.winner]) });
        else if (busy) message = t(human() ? "wait" : "thinking");
        else if (allowed() && human() && state.phase === "move")
          message = t("choose", { color: t(R.colors[state.turn]) });
        if (message) {
          const status = el("p", "aero-status", message, feedback);
          status.setAttribute("role", "status");
        }
        if (state.phase === "move" && human()) {
          const choices = el(
            "div",
            "aero-plane-choices aero-" +
              R.colors[state.turn] +
              (!previousChoices && allowed() ? " aero-choices-enter" : ""),
            undefined,
            feedback,
          );
          for (const i of moves) {
            const b = button(choices, "✈ " + (i + 1), "plane-" + i, !allowed());
            b.setAttribute(
              "aria-label",
              root
                .querySelector(`[data-plane="${state.turn * 4 + i}"]`)
                .getAttribute("aria-label"),
            );
          }
        }
        button(side, t("exit"), "restart");
      }
      if (error) {
        const warning = el("div", "aero-warning", t(error), side);
        warning.setAttribute("role", "alert");
        button(warning, t("retry"), "retry");
      }
      if (restarting) {
        const panel = el("div", "aero-dialog", undefined, boardWrap);
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-labelledby", "aero-dialog-title");
        panel.setAttribute("aria-describedby", "aero-dialog-message");
        el("h3", "", t("exit"), panel).id = "aero-dialog-title";
        el("p", "", t("confirm"), panel).id = "aero-dialog-message";
        const actions = el("div", "aero-dialog-actions", undefined, panel);
        const cancel = button(actions, t("cancel"), "close");
        button(actions, t("exit"), "confirm");
        board.inert = true;
        side.inert = true;
        cancel.focus({ preventScroll: true });
      } else if (active)
        root
          .querySelector(`[data-aero-action="${active}"]:not(:disabled)`)
          ?.focus({ preventScroll: true });
    }
    async function playAnimation(node, frames, options, token) {
      if (!node || disposed || token !== generation) return false;
      const animation = node.animate(frames, { fill: "forwards", ...options });
      animations.add(animation);
      try {
        await animation.finished;
      } catch {
        return false;
      } finally {
        animations.delete(animation);
      }
      return !disposed && token === generation;
    }
    function fadeDice(token) {
      const scene = root.querySelector(".aero-dice-scene");
      if (!scene) return;
      const style = getComputedStyle(scene);
      const before = { opacity: style.opacity, transform: style.transform };
      scene.getAnimations().forEach((animation) => animation.cancel());
      return playAnimation(
        scene,
        [before, { opacity: 0, transform: "translateY(-8%) scale(.8)" }],
        { duration: 180, easing: "ease-in" },
        token,
      );
    }
    async function closeExitDialog(confirm) {
      stop();
      const token = generation;
      const panel = root.querySelector(".aero-dialog");
      panel.inert = true;
      if (!reduced()) {
        const style = getComputedStyle(panel);
        const before = { opacity: style.opacity, transform: style.transform };
        panel.getAnimations().forEach((animation) => animation.cancel());
        await Promise.all([
          playAnimation(
            panel,
            [
              before,
              { opacity: 0, transform: "translate(-50%, -47%) scale(.98)" },
            ],
            { duration: 140, easing: "ease-in" },
            token,
          ),
          confirm && fadeDice(token),
        ]);
      }
      if (disposed || token !== generation) return;
      restarting = false;
      if (confirm) {
        setup = true;
        error = "";
      }
      render(confirm ? "seat-0" : "restart");
      schedule();
    }
    function planePosition(player, n, plane, stacked = false) {
      const point = R.coordinate(player, n, plane);
      if (stacked && n !== -2 && n !== R.END) {
        const same = state.pieces
          .map((v, i) => ({ v, i }))
          .filter((o) => Math.floor(o.i / 4) === player && o.v === n)
          .map((o) => o.i);
        const offset =
          (same.indexOf(player * 4 + plane) - (same.length - 1) / 2) * 0.22;
        return point.map((v) => v + offset);
      }
      return point;
    }
    async function animateMove(effect, token) {
      if (reduced()) return;
      const plane = root.querySelector(
        `[data-plane="${effect.player * 4 + effect.plane}"]`,
      );
      if (!plane) return;
      root.setAttribute("data-visual-busy", "");
      plane.classList.add("aero-moving");
      const anchor = [
        (parseFloat(plane.style.left) / 100) * 17.6 - 0.3,
        (parseFloat(plane.style.top) / 100) * 17.6 - 0.3,
      ];
      const path = effect.path.slice();
      const points = [];
      for (let i = 0; i < path.length; i++) {
        const n = path[i],
          last = i === path.length - 1;
        if (n - path[i - 1] === 4) {
          for (let step = path[i - 1] + 1; step <= n; step++)
            points.push({
              point: planePosition(
                effect.player,
                step,
                effect.plane,
                last && step === n,
              ),
              duration: 130,
            });
        } else if (last && effect.special === "fly") {
          points.push({
            point: R.coordinate(effect.crossing.player, effect.crossing.step),
            duration: 230,
          });
          points.push({
            point: planePosition(effect.player, n, effect.plane, true),
            duration: 230,
          });
        } else
          points.push({
            point: planePosition(effect.player, n, effect.plane, last),
            duration: effect.special === "takeoff" ? 300 : 180,
          });
      }
      const size =
        root.querySelector(".aero-board").getBoundingClientRect().width / 17.6;
      const transform = (q, scale = 1) =>
        `translate(-50%, -50%) translate3d(${(q[0] - anchor[0]) * size}px,${(q[1] - anchor[1]) * size}px,0) scale(${scale})`;
      const duration = points.reduce((n, p) => n + p.duration, 0),
        frames = [
          {
            transform: transform(anchor),
            offset: 0,
            easing: "cubic-bezier(.45,0,.7,.5)",
          },
        ];
      let elapsed = 0,
        previous = anchor;
      for (const [index, segment] of points.entries()) {
        const midpoint = previous.map((v, i) => (v + segment.point[i]) / 2);
        frames.push({
          transform: transform(midpoint, 1.08),
          offset: (elapsed + segment.duration * 0.5) / duration,
          easing: "cubic-bezier(.3,.5,.55,1)",
        });
        elapsed += segment.duration;
        frames.push({
          transform: transform(
            segment.point,
            effect.to === R.END && index === points.length - 1 ? 2.35 / 5.2 : 1,
          ),
          offset: elapsed / duration,
          easing: "cubic-bezier(.45,0,.7,.5)",
        });
        previous = segment.point;
      }
      if (
        !(await playAnimation(
          plane,
          frames,
          { duration, easing: "linear" },
          token,
        ))
      )
        return;
      await Promise.all(
        effect.captured.map(async (idx) => {
          if (disposed || token !== generation) return;
          const target = root.querySelector(`[data-plane="${idx}"]`);
          if (!target) return;
          const from = [
            (parseFloat(target.style.left) / 100) * 17.6 - 0.3,
            (parseFloat(target.style.top) / 100) * 17.6 - 0.3,
          ];
          const to = R.coordinate(Math.floor(idx / 4), -2, idx % 4);
          target.classList.add("aero-moving");
          await playAnimation(
            target,
            [
              { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
              {
                transform: `translate(-50%, -50%) translate3d(${(to[0] - from[0]) * size}px,${(to[1] - from[1]) * size}px,0) scale(1)`,
                opacity: 1,
              },
            ],
            { duration: 300, easing: "cubic-bezier(.3,0,.2,1)" },
            token,
          );
        }),
      );
    }
    function lastDie(player) {
      return state.rolls.findLast(([seat]) => seat === player)?.[1] || 0;
    }
    async function move(plane) {
      if (!allowed() || state.phase !== "move") return;
      const token = ++generation,
        player = state.turn;
      const result = R.move(state, plane);
      state = result.state;
      save();
      busy = true;
      for (const b of root.querySelectorAll(".aero-plane,.aero-dice"))
        b.disabled = true;
      const choices = root.querySelector(".aero-plane-choices");
      if (choices && !reduced()) {
        const opacity = getComputedStyle(choices).opacity;
        choices.getAnimations().forEach((animation) => animation.cancel());
        void playAnimation(
          choices,
          [{ opacity }, { opacity: 0 }],
          { duration: 140, easing: "ease-out" },
          token,
        );
      }
      await animateMove(result.effect, token);
      if (
        !disposed &&
        token === generation &&
        state.turn !== player &&
        !reduced()
      )
        await fadeDice(token);
      if (disposed || token !== generation) return;
      busy = false;
      render();
      schedule();
    }
    async function roll() {
      if (!allowed() || state.phase !== "roll") return;
      const token = ++generation;
      busy = true;
      rollingPlayer = state.turn;
      const startingFace = lastDie(rollingPlayer);
      const bytes = new Uint32Array(1);
      let value;
      do {
        crypto.getRandomValues(bytes);
        value = bytes[0];
      } while (value >= 4294967292);
      const result = (value % 6) + 1;
      state = R.roll(state, result);
      save();
      render();
      if (!reduced()) {
        const dice = root.querySelector(".aero-dice");
        dice.classList.add("aero-dice-rolling");
        await Promise.all(
          G.dice3d
            .frames(startingFace, result)
            .map(({ part, keyframes }) =>
              playAnimation(
                dice.querySelector(".aero-dice-" + part),
                keyframes,
                { duration: G.dice3d.duration },
                token,
              ),
            ),
        );
      }
      if (
        !disposed &&
        token === generation &&
        state.turn !== rollingPlayer &&
        !reduced()
      )
        await fadeDice(token);
      if (disposed || token !== generation) return;
      rollingPlayer = null;
      busy = false;
      render();
      schedule();
    }
    let modelLoading,
      modelAttempt = 0,
      reloadModel = false;
    function loadModel() {
      if (!modelLoading)
        modelLoading = (async () => {
          await WorkTimeApp.services.assets.scripts(
            [
              "assets/vendor/aeroplane/manifest.js",
              "assets/vendor/aeroplane/model.js",
            ].map(
              (path) => path + (modelAttempt ? "?retry=" + modelAttempt : ""),
            ),
          );
          const model = G.aeroplaneModel,
            manifest = G.aeroplaneManifest;
          if (
            !A.validate(model) ||
            manifest?.format !== 1 ||
            manifest.rules !== R.VERSION ||
            !manifest?.payloadHash
          ) {
            reloadModel = true;
            throw Error("Invalid model");
          }
          const bytes = new TextEncoder().encode(JSON.stringify(model));
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const hash = Array.from(new Uint8Array(digest), (n) =>
            n.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== manifest.payloadHash) {
            reloadModel = true;
            throw Error("Model integrity failed");
          }
          reloadModel = false;
          return model;
        })().catch((e) => {
          modelLoading = null;
          throw e;
        });
      return modelLoading;
    }
    async function think() {
      if (!allowed() || human() || state.phase !== "move") return;
      const token = ++generation;
      busy = true;
      render();
      try {
        const model = await loadModel();
        if (disposed || token !== generation) return;
        const source = `"use strict";const R=(${G.aeroplaneRulesFactory.toString()})();const A=(${G.aeroplaneAiFactory.toString()})(R);onmessage=e=>{try{const {state,model,token,seed}=e.data;postMessage({token,action:A.choose(state,model,state.difficulty,seed)});}catch(error){postMessage({error:String(error)});}};`;
        url = URL.createObjectURL(
          new Blob([source], { type: "text/javascript" }),
        );
        worker = new Worker(url);
        timer = setTimeout(() => fail(token), 12000);
        worker.onerror = () => fail(token);
        worker.onmessage = (e) => {
          if (disposed || token !== generation) return;
          if (
            e.data.error ||
            e.data.token !== token ||
            !R.legal(state).includes(e.data.action)
          ) {
            fail(token);
            return;
          }
          const action = e.data.action;
          stop();
          void move(action);
        };
        worker.postMessage({
          token,
          state,
          model,
          seed: crypto.getRandomValues(new Uint32Array(1))[0],
        });
      } catch {
        fail(token);
      }
    }
    function fail(token) {
      if (disposed || token !== generation) return;
      stop();
      error = "modelError";
      render();
    }
    function schedule() {
      clearTimeout(timer);
      if (allowed() && !human())
        timer = setTimeout(() => {
          timer = null;
          if (state.phase === "roll") void roll();
          else void think();
        }, 450);
    }
    root.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest("[data-aero-action]");
        if (!b || b.disabled) return;
        const action = b.dataset.aeroAction;
        if (setup && action.startsWith("seat-")) {
          const p = Number(action.slice(5));
          seats[p] = seats[p] === "human" ? "ai" : "human";
          b.setAttribute("aria-checked", String(seats[p] === "human"));
          b
            .closest(".aero-player")
            .querySelector(".aero-player-kind").textContent = t(seats[p]);
          root.querySelector('[data-aero-action="start"]').disabled =
            !seats.includes("human");
        } else if (action === "start") {
          if (!seats.includes("human")) return;
          stop();
          state = R.create(seats);
          setup = false;
          error = "";
          save();
          render();
          schedule();
        } else if (action === "roll") void roll();
        else if (action.startsWith("plane-") && human())
          void move(Number(action.slice(6)));
        else if (action === "restart") {
          stop();
          restarting = true;
          render();
        } else if (action === "close" || action === "confirm") {
          void closeExitDialog(action === "confirm");
        } else if (action === "retry") {
          stop();
          const reason = error;
          error = "";
          modelLoading = null;
          if (reason === "modelError" && reloadModel) modelAttempt++;
          if (reason === "saveError") save();
          render();
          schedule();
        }
      },
      { signal },
    );
    root.addEventListener(
      "keydown",
      (e) => {
        if (restarting) {
          if (e.key === "Escape" || e.key === "Tab") e.stopPropagation();
          if (root.querySelector(".aero-dialog").inert) {
            e.preventDefault();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            void closeExitDialog(false);
          } else if (e.key === "Tab") {
            const buttons = [...root.querySelectorAll(".aero-dialog button")];
            const index = buttons.indexOf(document.activeElement);
            e.preventDefault();
            buttons[
              (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
            ]?.focus();
          }
          return;
        }
        if (!allowed() || !human()) return;
        if (
          ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key) &&
          state.phase === "move"
        ) {
          e.preventDefault();
          const legal = R.legal(state),
            direction = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1;
          const current =
            Number(document.activeElement?.getAttribute("data-plane")) % 4;
          focused =
            legal[
              (legal.indexOf(current) + direction + legal.length) % legal.length
            ];
          root
            .querySelector(`[data-plane="${state.turn * 4 + focused}"]`)
            ?.focus();
        }
        if (
          /^[1-4]$/.test(e.key) &&
          state.phase === "move" &&
          R.legal(state).includes(Number(e.key) - 1)
        ) {
          e.preventDefault();
          void move(Number(e.key) - 1);
        }
      },
      { signal },
    );
    render();
    schedule();
    return {
      dispose() {
        disposed = true;
        stop();
        root.remove();
      },
      pause() {
        shellPaused = true;
        stop();
        render();
      },
      resume() {
        shellPaused = false;
        render();
        schedule();
      },
      resize() {},
    };
  },
});
