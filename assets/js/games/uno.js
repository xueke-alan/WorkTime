"use strict";
WorkTimeApp.games.register({
  id: "game-uno",
  nameKey: "games.uno.name",
  descriptionKey: "games.uno.description",
  icon: "game-uno",
  create({ container, signal }) {
    const G = WorkTimeApp.games,
      R = G.unoRules,
      A = G.unoAi;
    const archive = WorkTimeApp.services.gameArchive,
      storage = archive.session();
    const t = (key, params) => WorkTimeApp.i18n.t("games.uno." + key, params);
    const seed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    let state = null,
      setup = true,
      localPause = false,
      shellPause = false;
    let disposed = false,
      confirmation = null,
      warning = "";
    let worker = null,
      workerUrl = null,
      timer = null,
      generation = 0,
      thinking = false;
    let count = 4,
      difficulty = "normal",
      degraded = false;
    let openingCards = null,
      openingShown = 0;
    let queuedHeight = null;
    let visualBusy = false,
      dealing = false,
      revealResult = true;
    let presentingPlayer = null;
    let handOrder = null;
    let shownDeckCount = null,
      flightOrigin = null;
    const aiShifts = new Map();
    const normalPaints = new Map(),
      flightFaces = new Map(),
      aiGeometry = new Map();
    let renderHost = null;
    const { setArt, referenceView, patchView, moveView } = G.unoViewFactory();
    const seatViews = new Map();
    let ownView = null;
    let targetScore = 500,
      pickerAbort = null;
    let hoveredCard = null,
      hoverBounds = null;
    let wildMenu = null,
      wildTimer = null,
      wildFrame = null;
    let shownDiscard = null,
      discardLimit = R.DISCARD_LIMIT,
      restoringFocus = false;
    let spinFrame = null,
      spinAngle = 0,
      spinRate = 0.032,
      spinMirror = 1,
      spinTime = 0,
      spinDirection = 1,
      spinBurst = 0;
    let ringMotion = null,
      ringMotionElement = null,
      nativeSpinUnavailable = false;
    let pointerMotion = null,
      pointerMotionElement = null,
      nativePointerUnavailable = false;
    let pointerSeat = null,
      pointerRadius = null;
    let pointerAngle = null,
      pointerTarget = null,
      spinReady = false;
    const arrowShape =
      '<path class="uno-arrow-shape" d="M24 4C20 15 11 27 7 39Q23 33 41 40Q33 18 24 4Z"/>';
    // Original outlined paths: card faces never depend on an installed font.
    const digits = [
      "M30 9C9 7 8 67 28 70C51 74 54 11 30 9ZM29 24C38 22 36 54 29 55C21 55 22 25 29 24Z",
      "M14 24L29 10L41 11L38 68L24 68L27 29L19 35Z",
      "M11 25C11 3 49 4 50 24C52 39 30 45 24 56L48 54L48 68L9 69L10 57C14 41 35 34 35 25C35 17 25 18 25 27Z",
      "M12 13Q46 1 49 23Q51 35 40 39Q53 42 49 58Q43 79 9 65L14 52Q35 61 35 51Q36 43 23 46L22 33Q36 34 35 24Q32 17 16 26Z",
      "M31 10L47 11L44 45L52 45L51 58L44 58L43 69L29 69L30 58L7 58L8 45ZM31 29L21 45L31 45Z",
      "M14 10L49 10L47 24L25 24L23 34Q53 28 49 55Q44 79 10 66L14 52Q35 63 35 51Q36 41 9 48Z",
      "M46 13L39 26Q21 18 22 38Q47 26 50 48Q53 73 29 72Q7 72 8 44Q7 2 46 13ZM29 45Q17 45 23 58Q36 67 36 51Q36 45 29 45Z",
      "M10 10L51 11L49 24L29 69L13 68L34 25L9 25Z",
      "M29 8Q54 8 49 29Q48 36 42 39Q58 47 48 64Q39 79 17 69Q0 59 14 40Q1 33 10 16Q16 8 29 8ZM29 20Q19 22 25 32Q35 38 36 27Q36 20 29 20ZM29 46Q15 49 24 59Q39 66 37 52Q36 46 29 46Z",
      "M13 67L20 54Q38 62 38 41Q13 53 9 30Q7 6 30 8Q52 8 52 35Q54 77 13 67ZM30 35Q43 35 36 22Q24 14 24 29Q24 35 30 35Z",
    ];
    function glyph(value) {
      if (value <= 9) return `<path fill-rule="evenodd" d="${digits[value]}"/>`;
      if (value === 10)
        return '<path fill-rule="evenodd" d="M30 14C-5 13-5 67 30 66C65 67 65 13 30 14ZM15 29C8 39 13 53 25 56Q32 59 39 53ZM21 27L45 51C53 39 45 24 33 23Q26 22 21 27Z"/>';
      if (value === 11)
        return '<path d="M4 31Q6 10 34 14L34 5L55 23L34 40L34 29Q16 24 15 39ZM56 49Q54 70 26 66L26 75L5 57L26 40L26 51Q44 56 45 41Z"/>';
      if (value === 13)
        return '<path d="M30 9Q33 33 53 40Q32 47 30 71Q26 49 7 40Q26 32 30 9Z"/>';
      return `<path d="M3 35L15 35L15 23L25 23L25 35L37 35L37 45L25 45L25 57L15 57L15 45L3 45Z"/><g transform="translate(40 0)">${glyph(value === 12 ? 2 : 4)}</g>`;
    }
    function faceMark(value, cls) {
      return `<svg class="${cls}" viewBox="${value === 12 || value === 14 ? "0 0 100 80" : "0 0 60 80"}" aria-hidden="true">${glyph(value)}</svg>`;
    }
    const unoWordArt =
      '<svg viewBox="0 0 180 80" aria-hidden="true"><path d="M10 12L25 12L21 46Q19 60 31 60Q42 60 43 45L47 12L62 13L58 48Q55 76 29 74Q2 73 6 46ZM72 13L65 72L80 72L84 36L105 71L119 70L126 12L111 13L107 48L86 13Z"/><path fill-rule="evenodd" d="M151 10Q179 10 174 42Q172 75 147 74Q121 72 126 40Q128 9 151 10ZM150 25Q141 25 140 43Q137 60 148 60Q159 61 160 42Q163 24 150 25Z"/></svg>';
    const backArt = `<svg class="uno-back-art" viewBox="0 0 80 112" aria-hidden="true"><path d="M9 12Q40 6 70 12L70 100Q41 106 10 100Z" fill="none" stroke="#f4e8cd" stroke-width="1.5"/><path d="M12 64C8 38 40 19 61 30C85 45 61 86 34 86Q16 85 12 64Z" fill="#d7434d" stroke="#fff4de" stroke-width="3"/><g transform="rotate(-18 40 56)" fill="#f5ce55" stroke="#fff3db" stroke-width="2" paint-order="stroke fill">${unoWordArt.replace('<svg viewBox="0 0 180 80" aria-hidden="true">', '<svg x="8" y="36" width="64" height="40" viewBox="0 0 180 80" aria-hidden="true">')}</g><path d="m16 18 10-2m28 80 10-2" stroke="#f5ce55" stroke-width="2" stroke-linecap="round"/></svg>`;
    function oneMark(parent, cls) {
      const mark = node(parent, "span", cls);
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", "1!");
      setArt(
        mark,
        '<svg viewBox="0 0 100 80" aria-hidden="true"><path d="' +
          digits[1] +
          '"/><path d="M65 10L82 9L75 51L64 52ZM65 60Q82 56 78 70Q64 78 63 67Z"/></svg>',
      );
      return mark;
    }
    function visibleScore(player) {
      const pending =
        !revealResult && state.roundPoints && state.winner === player
          ? state.roundPoints.reduce((a, b) => a + b, 0)
          : 0;
      return state.scores[player] - pending;
    }
    function numberArt(value) {
      const text = String(value),
        width = text.length * 52 + 8;
      return `<svg viewBox="0 0 ${width} 80" aria-hidden="true">${[...text].map((digit, i) => `<g transform="translate(${i * 52} 0)">${glyph(Number(digit))}</g>`).join("")}</svg>`;
    }
    function scoreMark(parent, player) {
      const value = visibleScore(player);
      const highest = Math.max(...state.scores.map((_, i) => visibleScore(i)));
      const score = node(
        parent,
        "span",
        "uno-seat-score" +
          (value > 0 && value === highest ? " uno-score-leading" : ""),
      );
      const text = String(value);
      score.dataset.score = text;
      score.setAttribute("role", "img");
      score.style.setProperty("--score-width", text.length * 16 + "px");
      setArt(score, numberArt(value));
      score.setAttribute(
        "aria-label",
        t("score", { name: name(player), n: value }),
      );
      score.title = score.getAttribute("aria-label");
    }
    function playerInfo(parent, player) {
      const info = node(
        parent,
        "div",
        player === 0 ? "uno-own-info" : "uno-seat-info",
      );
      const face = avatar(info, player);
      if (state.dealer === player) {
        face.removeAttribute("aria-hidden");
        face.querySelector("svg").setAttribute("aria-hidden", "true");
        const crown = node(face, "span", "uno-dealer");
        crown.setAttribute("role", "img");
        crown.setAttribute("aria-label", t("dealer", { name: name(player) }));
        crown.title = crown.getAttribute("aria-label");
        setArt(
          crown,
          '<svg viewBox="0 0 40 28" aria-hidden="true"><path d="M5 21L3 7L13 13L20 2L27 13L37 7L34 22Q20 26 5 21Z"/><path d="M7 25Q20 28 33 25M10 18L9 15M20 17V12M30 18L31 15"/></svg>',
        );
      }
      const labels = node(info, "div", "uno-seat-labels");
      const nameLine = node(labels, "div", "uno-name-line");
      node(nameLine, "strong", "", name(player)).title = name(player);
      if (state.hands[player].length === 1 && state.status === "playing")
        oneMark(nameLine, "uno-call");
      const stats = node(labels, "div", "uno-player-stats");
      scoreMark(stats, player);
      return info;
    }
    function unoMark(parent, cls) {
      const mark = node(parent, "span", cls);
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", "UNO");
      setArt(mark, unoWordArt);
      return mark;
    }
    const animations = new Set(),
      flights = new Set(),
      visualDelays = new Map();
    const root = document.createElement("section");
    root.className = "game-uno game-session";
    container.append(root);
    try {
      const raw = storage.getItem(archive.keys["game-uno"]);
      if (raw !== null) {
        const saved = JSON.parse(raw);
        if (
          Array.isArray(saved?.state?.hands) &&
          saved.state.hands.length > R.MAX_PLAYERS
        ) {
          warning = "tooManyPlayers";
        } else {
          state = archive.normalize("game-uno", saved).state;
          count = state.hands.length;
          difficulty = state.difficulty;
          targetScore = state.targetScore;
          discardLimit = R.DISCARD_LIMIT;
          setup = false;
        }
      }
    } catch {
      warning = "invalid";
    }
    const identity = (i) => {
      const n =
        (((state?.appearanceSeed ?? state?.rng ?? 1) >>> 4) + i * 7) % 64;
      return { n, hue: (n * 47) % 360 };
    };
    const name = (i) => {
      if (i === 0) return t("you");
      const n = identity(i).n;
      return (
        t("namesFirst").split("|")[n % 8] +
        t("namesLast").split("|")[Math.floor(n / 8)]
      );
    };
    function avatar(parent, i) {
      const { n, hue } = identity(i);
      const face = node(parent, "span", "uno-avatar");
      face.setAttribute("aria-hidden", "true");
      setArt(
        face,
        `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><ellipse cx="32" cy="58" rx="24" ry="5" fill="hsl(${hue} 35% 82%)"/><path d="M15 54q-7-25 2-37Q32 ${n % 2 ? 0 : 7} 47 17q9 12 2 37Z" fill="hsl(${hue} 64% 65%)" stroke="hsl(${hue} 40% 32%)" stroke-width="2"/><path d="M21 16 17 8m26 8 4-8" stroke="hsl(${hue} 40% 32%)" stroke-width="3" stroke-linecap="round"/><circle cx="17" cy="7" r="4" fill="hsl(${(hue + 70) % 360} 70% 62%)"/><circle cx="47" cy="7" r="4" fill="hsl(${(hue + 70) % 360} 70% 62%)"/><ellipse cx="24" cy="30" rx="8" ry="10" fill="#fff"/><ellipse cx="42" cy="30" rx="8" ry="10" fill="#fff"/><circle cx="${24 + (n % 3)}" cy="32" r="3.5" fill="#263c45"/><circle cx="${40 + (n % 3)}" cy="32" r="3.5" fill="#263c45"/><path d="M25 45q7 ${6 + (n % 5)} 14 0" fill="none" stroke="#314452" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="15" cy="42" rx="4" ry="2" fill="#e88383"/><ellipse cx="49" cy="42" rx="4" ry="2" fill="#e88383"/>${n % 3 === 0 ? `<path d="m20 18 10-7 14 8" fill="hsl(${(hue + 160) % 360} 70% 68%)"/>` : ""}</svg>`,
      );
      return face;
    }
    const cardText = (id) => {
      const c = R.cards[id];
      return (
        (c.value >= 13 ? "" : t(c.color) + " · ") +
        (c.value <= 9 ? c.value : t("value" + c.value))
      );
    };
    function node(parent, tag, cls, text) {
      if (parent === root && renderHost) parent = renderHost;
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text !== undefined) el.textContent = text;
      parent.append(el);
      return el;
    }
    function button(parent, key, callback, icon) {
      const b = node(parent, "button", "game-button", icon ? "" : t(key));
      if (icon) {
        b.append(G.createIcon(icon));
        node(b, "span", "", t(key));
      }
      b.type = "button";
      b.dataset.unoAction = key;
      b.onclick = callback;
      return b;
    }
    function handAction(parent, key, callback) {
      const action = button(parent, key, callback);
      const label = t(key);
      action.classList.add("uno-hand-action");
      action.setAttribute("aria-label", label);
      action.title = label;
      action.textContent = "";
      setArt(
        action,
        '<svg class="uno-action-frame" viewBox="0 0 160 64" preserveAspectRatio="none" aria-hidden="true"><path d="M8 7Q80 4 152 8L153 55Q83 60 7 55L6 9Z"/><path class="uno-action-sketch" d="M13 5L150 7M155 12L154 50M12 58L145 59"/></svg>',
      );
      node(action, "span", "uno-hand-action-label", label);
      return action;
    }
    function stop(keepMotion = false) {
      clearCardHover();
      closeWildMenu();
      generation++;
      clearTimeout(timer);
      timer = null;
      worker?.terminate();
      worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
      thinking = false;
      if (!keepMotion) {
        cancelAnimationFrame(spinFrame);
        spinFrame = null;
        spinTime = 0;
        freezeRing();
        if (pointerMotion) {
          const time = pointerMotion.currentTime;
          pointerMotion.pause();
          if (typeof time === "number") pointerMotion.currentTime = time;
        }
      }
      cancelVisuals();
    }
    function paused() {
      return (
        disposed ||
        setup ||
        localPause ||
        shellPause ||
        document.hidden ||
        !!confirmation
      );
    }
    function save() {
      if (!state) return;
      try {
        storage.setItem(
          archive.keys["game-uno"],
          JSON.stringify({ version: 1, state }),
        );
        if (warning === "saveFailed") warning = "";
      } catch {
        warning = "saveFailed";
      }
    }
    function commit(action) {
      if (paused() || visualBusy || !state) return;
      if (refillEmptyDeck()) return;
      const next = R.apply(state, action);
      if (!next) return;
      if (action.type === "color") {
        stop();
        state = next;
        save();
        render();
        schedule();
        return;
      }
      const previous = state;
      const from = sourceRect(action, previous.turn);
      const beforeHand =
        previous.hands[0].length !== next.hands[0].length
          ? handLayout()
          : new Map();
      const beforeAi = new Map();
      for (let player = 1; player < previous.hands.length; player++) {
        if (previous.hands[player].length !== next.hands[player].length)
          for (const [key, pose] of aiLayout(player)) beforeAi.set(key, pose);
      }
      if (action.type === "play" && previous.turn !== 0) {
        const key = previous.turn + ":";
        const first = beforeAi.get(key + "0");
        if (first && Math.abs(first.x - from.x) < 1) {
          for (let i = 0; i < 7; i++) {
            const next = beforeAi.get(key + (i + 1));
            if (next) beforeAi.set(key + i, next);
            else beforeAi.delete(key + i);
          }
        }
      }
      stop(true);
      state = next;
      if (action.type === "play" && !reducedMotion())
        shownDiscard = previous.discard.slice();
      presentingPlayer = previous.turn;
      const recycled = previous.discard.filter(
        (id) => !next.discard.includes(id),
      );
      const hasDraws = next.hands.some((hand, i) =>
        hand.some((id) => !previous.hands[i].includes(id)),
      );
      if ((hasDraws || recycled.length) && !reducedMotion()) {
        shownDeckCount = previous.deck.length;
        if (recycled.length && action.type !== "play")
          shownDiscard = previous.discard.slice(0, -1);
      }
      revealResult = next.status === "playing" || reducedMotion();
      save();
      if (!reducedMotion()) busy();
      render();
      animateAction(previous, action, from, beforeHand, beforeAi);
    }
    function fallback() {
      stop();
      degraded = true;
      if (!paused() && state?.status === "playing" && state.turn !== 0)
        commit(A.choose(R.observe(state), "normal", state.rng));
      else render();
    }
    function schedule() {
      if (
        paused() ||
        visualBusy ||
        !state ||
        state.status !== "playing" ||
        timer ||
        thinking
      )
        return;
      if (
        root.closest(".workspace")?.classList.contains("is-game-transitioning")
      ) {
        timer = setTimeout(() => {
          timer = null;
          schedule();
        }, 60);
        return;
      }
      if (refillEmptyDeck() || state.turn === 0) return;
      const token = generation;
      timer = setTimeout(() => {
        timer = null;
        if (token !== generation || paused()) return;
        if (state.difficulty !== "hard" || degraded) {
          commit(
            A.choose(
              R.observe(state),
              degraded ? "normal" : state.difficulty,
              state.rng,
            ),
          );
          return;
        }
        try {
          const source = `const R=(${G.unoRulesFactory.toString()})();const A=(${G.unoAiFactory.toString()})(R);onmessage=e=>{postMessage(A.choose(e.data.observation,"hard",e.data.seed,250))};`;
          workerUrl = URL.createObjectURL(
            new Blob([source], { type: "text/javascript" }),
          );
          worker = new Worker(workerUrl);
          thinking = true;
          render();
          worker.onmessage = (e) => {
            if (token !== generation || paused()) return;
            if (
              !R.legal(state).some(
                (a) => JSON.stringify(a) === JSON.stringify(e.data),
              )
            ) {
              fallback();
              return;
            }
            commit(e.data);
          };
          worker.onerror = (e) => {
            e.preventDefault();
            if (token === generation) fallback();
          };
          worker.postMessage({
            observation: R.observe(state),
            seed: state.rng,
          });
          timer = setTimeout(() => {
            if (token === generation) fallback();
          }, 2000);
        } catch {
          fallback();
        }
      }, 740);
    }
    function begin() {
      startRound(R.create(count, difficulty, seed(), targetScore));
    }
    function advanceRound() {
      if (paused() || visualBusy || !state) return;
      const next = R.nextRound(state);
      if (!next) return;
      if (reducedMotion()) {
        startRound(next);
        return;
      }
      stop();
      busy();
      root.dataset.handPhase = "collecting";
      for (const button of root.querySelectorAll(".uno-hand-actions button"))
        button.disabled = true;
      const token = generation;
      collectRound(token).then(() => {
        if (token !== generation || paused()) return;
        return afterVisualDelay(140, token, () => startRound(next));
      });
    }
    function collectRound(token) {
      const pile = root.querySelector(".uno-draw-dock");
      const destination = rect(pile.querySelector("button"));
      const bounds = root.getBoundingClientRect();
      const cards = [
        ...root.querySelectorAll(".uno-hand .uno-card"),
        ...root.querySelectorAll(".uno-seat .uno-mini-back"),
        ...root.querySelectorAll(".uno-discard-card"),
      ];
      // Measure the whole table before hiding cards or updating any counters.
      const jobs = cards.map((el) => {
        const front = el.matches(".uno-mini-back")
          ? el.querySelector(".uno-revealed-face")
          : el;
        const seat = el.closest(".uno-seat");
        const from = rect(el);
        from.x = Math.max(
          bounds.x + 4,
          Math.min(from.x, bounds.right - from.width - 4),
        );
        return {
          el,
          from,
          id: front ? Number(front.dataset.card) : undefined,
          player: seat
            ? Number(seat.dataset.seat)
            : el.closest(".uno-hand")
              ? 0
              : null,
          discard: el.classList.contains("uno-discard-card"),
        };
      });
      const hiddenDiscards =
        state.discard.length - jobs.filter((job) => job.discard).length;
      const remaining = state.hands.map((hand) => hand.length);
      let returned = 0;
      const initialCount = state.deck.length;
      return Promise.all(
        jobs.map((job, index) =>
          afterVisualDelay(index * 12, token, () => {
            job.el.style.visibility = "hidden";
            job.el.dataset.unoHidden = "true";
            if (job.player !== null) {
              remaining[job.player]--;
              const label = root.querySelector(
                job.player === 0
                  ? ".uno-own-count"
                  : `[data-seat="${job.player}"] .uno-seat-count`,
              );
              if (label)
                label.textContent = t("cards", { n: remaining[job.player] });
            }
            return fly(
              job.from,
              destination,
              job.id,
              0,
              480,
              "recycle",
              200 + index,
            ).then(() => {
              if (token !== generation) return;
              returned++;
              shownDeckCount =
                initialCount +
                returned +
                (returned === jobs.length ? hiddenDiscards : 0);
              paintDrawPile(pile, shownDeckCount);
            });
          }),
        ),
      );
    }
    function startRound(next) {
      stop();
      spinReady = false;
      spinAngle = 0;
      spinBurst = 0;
      pointerMotion?.cancel();
      pointerMotion = null;
      pointerAngle = pointerTarget = null;
      pointerSeat = null;
      pointerRadius = null;
      state = next;
      state.discardLimit = discardLimit;
      openingCards = reducedMotion() ? null : state.discard.slice();
      openingShown = 0;
      if (!reducedMotion()) handOrder = state.hands[0].slice();
      setup = false;
      localPause = false;
      confirmation = null;
      if (["invalid", "tooManyPlayers"].includes(warning)) warning = "";
      save();
      render();
      animateDeal();
    }
    function requestStart() {
      if (!setup && state) {
        count = state.hands.length;
        difficulty = state.difficulty;
        targetScore = state.targetScore;
      }
      if (state && state.matchWinner === null) {
        stop();
        confirmation = begin;
        render();
      } else begin();
    }
    function reducedMotion() {
      return (
        document.documentElement.dataset.reducedMotion === "true" ||
        (WorkTimeApp.ui.animationCompat?.preference().matches ??
          matchMedia("(prefers-reduced-motion: reduce)").matches)
      );
    }
    function cancelVisuals() {
      for (const [timer, resolve] of visualDelays) {
        clearTimeout(timer);
        resolve();
      }
      visualDelays.clear();
      for (const animation of animations) animation.cancel();
      animations.clear();
      aiShifts.clear();
      flightFaces.clear();
      flightOrigin = null;
      aiGeometry.clear();
      for (const flight of flights) flight.remove();
      flights.clear();
      root.querySelectorAll("[data-uno-hidden]").forEach((el) => {
        el.style.visibility = "";
        el.style.display = "";
        delete el.dataset.unoHidden;
      });
      visualBusy = false;
      dealing = false;
      revealResult = true;
      presentingPlayer = null;
      handOrder = null;
      shownDiscard = null;
      shownDeckCount = null;
      openingCards = null;
      openingShown = 0;
      delete root.dataset.handPhase;
      delete root.dataset.visualBusy;
      root.removeAttribute("aria-busy");
      if (queuedHeight !== null) {
        root.style.setProperty("--uno-height", queuedHeight + "px");
        queuedHeight = null;
      }
    }
    function rect(el, knownStyle = null) {
      if (!el) return null;
      const r = el.getBoundingClientRect(),
        transform = (knownStyle || getComputedStyle(el)).transform;
      const matrix = new DOMMatrix(
        transform === "none" ? undefined : transform,
      );
      const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        cardWidth: el.offsetWidth,
        cardHeight: el.offsetHeight,
        angle,
      };
    }
    function playerRect(player, card) {
      const hand = root.querySelector(
        player === 0 ? ".uno-hand" : `[data-seat="${player}"] .uno-seat-hand`,
      );
      const area = rect(hand);
      if (player !== 0) {
        const cards =
          hand &&
          [...hand.querySelectorAll(".uno-mini-back")].filter(
            (el) => el.style.display !== "none",
          );
        const center = rect(root.querySelector(".uno-discard"));
        const distance = (el) => {
          const r = rect(el);
          return Math.hypot(
            r.x + r.width / 2 - center.x - center.width / 2,
            r.y + r.height / 2 - center.y - center.height / 2,
          );
        };
        const edge = cards?.length
          ? [cards[0], cards.at(-1)].sort(
              (a, b) => distance(a) - distance(b),
            )[0]
          : null;
        if (edge) return rect(edge);
      }
      const specific =
        player === 0 && card !== undefined
          ? rect(hand?.querySelector(`[data-card="${card}"]`))
          : null;
      if (!area) return rect(root.querySelector(".uno-discard .uno-stack-top"));
      if (
        specific &&
        specific.x >= area.x &&
        specific.x + specific.width <= area.x + area.width
      )
        return specific;
      const width = player === 0 ? 76 : 44,
        height = player === 0 ? 112 : 64;
      return {
        x: area.x + area.width / 2 - width / 2,
        y: area.y + area.height / 2 - height / 2,
        width,
        height,
      };
    }
    function sourceRect(action, player) {
      return action.type === "play"
        ? playerRect(player, action.card)
        : rect(
            root.querySelector(
              '.uno-draw-dock > button[data-uno-action="draw"]',
            ),
          );
    }
    function aiDealEnd(player, count) {
      let g = aiGeometry.get(player);
      if (!g) {
        const hand = root.querySelector(
            `[data-seat="${player}"] .uno-seat-hand`,
          ),
          reference = hand.querySelector(".uno-mini-back"),
          style = getComputedStyle(reference);
        const width = parseFloat(style.width),
          height = parseFloat(style.height),
          sibling = hand.querySelectorAll(".uno-mini-back")[1];
        const origin = style.transformOrigin
          .split(" ")
          .map((value, i) =>
            value.endsWith("%")
              ? (parseFloat(value) * (i ? height : width)) / 100
              : parseFloat(value),
          );
        g = {
          area: hand.getBoundingClientRect(),
          space: hand.clientWidth,
          width,
          height,
          step:
            width +
            (sibling ? parseFloat(getComputedStyle(sibling).marginLeft) : 0),
          top: parseFloat(getComputedStyle(hand).paddingTop),
          origin,
          angleScale:
            parseFloat(style.getPropertyValue("--uno-back-angle-scale")) || 1,
          liftScale:
            parseFloat(style.getPropertyValue("--uno-back-lift-scale")) || 1,
        };
        aiGeometry.set(player, g);
      }
      const offset = (count - 1) / 2,
        angle = offset * 7 * g.angleScale,
        rad = (angle * Math.PI) / 180,
        c = Math.cos(rad),
        s = Math.sin(rad);
      const left = (g.space - g.width + (count - 1) * g.step) / 2,
        [ox, oy] = g.origin;
      const cx =
        g.area.x + left + ox + c * (g.width / 2 - ox) - s * (g.height / 2 - oy);
      const cy =
        g.area.y +
        g.top +
        oy +
        s * (g.width / 2 - ox) +
        c * (g.height / 2 - oy) +
        offset * offset * 1.1 * g.liftScale;
      const width = Math.abs(g.width * c) + Math.abs(g.height * s),
        height = Math.abs(g.width * s) + Math.abs(g.height * c);
      return {
        x: cx - width / 2,
        y: cy - height / 2,
        width,
        height,
        cardWidth: g.width,
        cardHeight: g.height,
        angle,
      };
    }
    function aiPose(el) {
      const style = getComputedStyle(el),
        bounds = rect(el, style);
      const matrix = new DOMMatrix(
        style.transform === "none" ? undefined : style.transform,
      );
      const [ox, oy] = style.transformOrigin.split(" ").map(parseFloat);
      const x = el.offsetWidth / 2 - ox,
        y = el.offsetHeight / 2 - oy;
      return {
        ...bounds,
        transform: style.transform,
        layoutX:
          bounds.x +
          bounds.width / 2 -
          ((matrix.a - 1) * x + matrix.c * y + matrix.e),
        layoutY:
          bounds.y +
          bounds.height / 2 -
          (matrix.b * x + (matrix.d - 1) * y + matrix.f),
      };
    }
    function aiLayout(player = null) {
      return new Map(
        [...root.querySelectorAll(".uno-seat .uno-mini-back")]
          .filter(
            (el) =>
              (player === null ||
                Number(el.closest(".uno-seat").dataset.seat) === player) &&
              el.style.display !== "none",
          )
          .map((el) => [
            el.closest(".uno-seat").dataset.seat + ":" + el.dataset.backIndex,
            aiPose(el),
          ]),
      );
    }
    function moveAiHands(before, player = null, delay = 0) {
      const jobs = [];
      for (const el of root.querySelectorAll(".uno-seat .uno-mini-back")) {
        const seat = el.closest(".uno-seat").dataset.seat;
        if (
          (player !== null && Number(seat) !== player) ||
          el.style.display === "none"
        )
          continue;
        const old = before.get(seat + ":" + el.dataset.backIndex);
        if (!old) continue;
        const now = aiPose(el),
          base = now.transform;
        const dx = old.layoutX - now.layoutX,
          dy = old.layoutY - now.layoutY;
        if (Math.abs(dx) + Math.abs(dy) < 0.4 && old.transform === base)
          continue;
        jobs.push(() =>
          track(
            el,
            [
              {
                transform: `translate(${dx}px,${dy}px) ${old.transform === "none" ? "" : old.transform}`,
              },
              { transform: base },
            ],
            {
              duration: 300,
              delay,
              fill: "both",
              easing: "cubic-bezier(.22,.65,.3,1)",
            },
            aiShifts,
          ),
        );
      }
      return jobs.map((run) => run());
    }
    function stageAiHand(player, count, animate = true) {
      const before = animate ? aiLayout(player) : null;
      const backs = root.querySelectorAll(
        `[data-seat="${player}"] .uno-mini-back`,
      );
      const shown = Math.min(backs.length, count);
      for (const back of backs) {
        const active = aiShifts.get(back);
        if (active) {
          active.cancel();
          animations.delete(active);
          aiShifts.delete(back);
        }
      }
      backs.forEach((back, index) => {
        if (index >= shown) {
          back.style.display = "none";
          back.dataset.unoHidden = "true";
        } else {
          back.style.display = "";
          back.style.visibility = "";
          delete back.dataset.unoHidden;
          const offset = index - (shown - 1) / 2;
          back.style.setProperty("--back-angle", offset * 7 + "deg");
          back.style.setProperty(
            "--back-lift",
            Math.abs(offset) ** 2 * 1.1 + "px",
          );
        }
      });
      return before
        ? Promise.all(moveAiHands(before, player))
        : Promise.resolve();
    }
    function handLayout() {
      return new Map(
        [...root.querySelectorAll(".uno-hand .uno-card")].map((el) => [
          Number(el.dataset.card),
          aiPose(el),
        ]),
      );
    }
    function moveHand(before, duration = 360) {
      const jobs = [];
      for (const el of root.querySelectorAll(".uno-hand .uno-card")) {
        const old = before.get(Number(el.dataset.card));
        if (!old) continue;
        const now = aiPose(el),
          base = now.transform;
        const dx = old.layoutX - now.layoutX,
          dy = old.layoutY - now.layoutY;
        if (Math.abs(dx) + Math.abs(dy) < 0.5 && old.transform === base)
          continue;
        jobs.push(() =>
          track(
            el,
            [
              {
                transform: `translate(${dx}px,${dy}px) ${old.transform === "none" ? "" : old.transform}`,
              },
              { transform: base },
            ],
            { duration, easing: "cubic-bezier(.22,.65,.3,1)" },
          ),
        );
      }
      return jobs.map((run) => run());
    }
    function positionHandActions() {
      const own = root.querySelector(".uno-own"),
        hand = own?.querySelector(".uno-hand"),
        actions = own?.querySelector(".uno-hand-actions");
      if (!actions || actions.hidden) return;
      const ownBox = own.getBoundingClientRect(),
        handBox = hand.getBoundingClientRect();
      const last = hand.querySelector(".uno-card:last-child");
      const small = matchMedia("(max-width:700px)").matches,
        gap = small ? 12 : 16;
      let edge = ownBox.left + ownBox.width / 2 + (small ? 60 : 75);
      let centerY = ownBox.top + (small ? 96 : 105);
      if (last) {
        const pose = aiPose(last),
          scale = small ? 0.7 : 1;
        const angle =
          ((parseFloat(last.style.getPropertyValue("--card-angle")) || 0) *
            scale *
            Math.PI) /
          180;
        const lift =
          (parseFloat(last.style.getPropertyValue("--card-lift")) || 0) * scale;
        const width = last.offsetWidth,
          height = last.offsetHeight;
        const cosine = Math.cos(angle),
          sine = Math.sin(angle);
        edge =
          pose.layoutX +
          (sine * height) / 2 +
          (Math.abs(cosine * width) + Math.abs(sine * height)) / 2;
        edge = Math.min(
          edge,
          handBox.right - parseFloat(getComputedStyle(hand).paddingRight),
        );
        centerY = pose.layoutY + ((1 - cosine) * height) / 2 + lift;
      }
      const left = Math.max(
        8,
        Math.min(
          ownBox.width - actions.offsetWidth - 8,
          edge - ownBox.left + gap,
        ),
      );
      actions.style.left = left + "px";
      actions.style.top = centerY - ownBox.top + "px";
    }
    function poseHandCard(card, index, count) {
      const offset =
        (index - (count - 1) / 2) * Math.min(1, 6 / Math.max(1, count - 1));
      card.style.zIndex = String(10 + index);
      card.style.setProperty("--card-angle", offset * 4.2 + "deg");
      card.style.setProperty(
        "--card-lift",
        Math.abs(offset) ** 2 * 1.65 + "px",
      );
    }
    function sortHand() {
      const before = handLayout();
      const spread = root.querySelector(".uno-hand-spread");
      const ordered = [...spread.children].sort(
        (a, b) => Number(a.dataset.card) - Number(b.dataset.card),
      );
      let cursor = spread.firstChild;
      ordered.forEach((card, index) => {
        moveView(spread, card, cursor);
        cursor = card.nextSibling;
        poseHandCard(card, index, ordered.length);
      });
      handOrder = null;
      root.dataset.handPhase = "sorting";
      return Promise.all(moveHand(before, 440));
    }
    function track(el, keyframes, options, channel = null) {
      if (channel?.has(el)) channel.get(el).cancel();
      const animation = WorkTimeApp.ui.animationCompat.animate(
        el,
        keyframes,
        options,
      );
      animations.add(animation);
      channel?.set(el, animation);
      return animation.finished
        .catch(() => {})
        .then(() => {
          animations.delete(animation);
          if (channel?.get(el) === animation) channel.delete(el);
        });
    }
    function fly(
      from,
      to,
      card,
      delay = 0,
      duration = 360,
      drawing = false,
      layer = 200,
      color = null,
      arrivalPaint = null,
      onArrival = null,
    ) {
      if (!from || !to || disposed) return Promise.resolve();
      const origin = (flightOrigin ??= root.getBoundingClientRect());
      const staging = document.createDocumentFragment();
      const flight =
        card === undefined
          ? node(staging, "div", "uno-card uno-back uno-flight")
          : drawCard(staging, card);
      flight.style.zIndex = String(layer);
      root.append(flight);
      flight.classList.add("uno-flight");
      flight.setAttribute("aria-hidden", "true");
      if (card === undefined) setArt(flight, backArt);
      flights.add(flight);
      // Use a complete card's typography, then scale the whole face. Resizing
      // an AI's small card box alone leaves full-size labels overlapping.
      const faceKey = card === undefined ? "back" : "face";
      let face = flightFaces.get(faceKey);
      if (!face) {
        const model =
            root.querySelector(
              card === undefined
                ? ".uno-draw-dock .uno-card"
                : ".uno-discard .uno-stack-top",
            ) || root.querySelector(".uno-hand .uno-card"),
          style = getComputedStyle(model);
        const corner = model.querySelector(".uno-card-corner"),
          cornerStyle = corner ? getComputedStyle(corner) : null;
        face = {
          width: parseFloat(style.width),
          height: parseFloat(style.height),
          padding: style.padding,
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
          corner: cornerStyle
            ? { top: cornerStyle.top, left: cornerStyle.left }
            : null,
        };
        flightFaces.set(faceKey, face);
      }
      const { width, height } = face;
      Object.assign(flight.style, {
        padding: face.padding,
        borderWidth: face.borderWidth,
        borderRadius: face.borderRadius,
      });
      const corner = flight.querySelector(".uno-card-corner");
      if (corner && face.corner) Object.assign(corner.style, face.corner);
      Object.assign(flight.style, {
        left: from.x + from.width / 2 - width / 2 - origin.x + "px",
        top: from.y + from.height / 2 - height / 2 - origin.y + "px",
        width: width + "px",
        minWidth: "0",
        height: height + "px",
        transformOrigin: "center center",
      });
      const extras = [];
      if (color && card !== undefined && R.cards[card].value >= 13) {
        const fromPaint = paint(flight);
        flight.classList.add("uno-settled", "uno-" + color);
        extras.push(
          track(flight, [fromPaint, paint(flight)], {
            duration,
            delay,
            easing: "cubic-bezier(.4,0,.2,1)",
            fill: "both",
          }),
        );
      }
      if (arrivalPaint)
        extras.push(
          track(flight, [paint(flight), arrivalPaint], {
            duration,
            delay,
            easing: "ease-in-out",
            fill: "both",
          }),
        );
      if (drawing && card !== undefined) {
        flight.classList.add("uno-draw-flight");
        const back = node(flight, "div", "uno-flight-back");
        setArt(back, backArt);
        extras.push(
          track(
            back,
            [
              {
                transform:
                  drawing === "recycle" ? "rotateY(180deg)" : "rotateY(0deg)",
              },
              {
                transform:
                  drawing === "recycle" ? "rotateY(0deg)" : "rotateY(180deg)",
                offset: 0.45,
              },
              {
                transform:
                  drawing === "recycle" ? "rotateY(0deg)" : "rotateY(180deg)",
              },
            ],
            { duration, delay, easing: "ease-in-out", fill: "both" },
          ),
        );
      }
      const dx = to.x + to.width / 2 - from.x - from.width / 2,
        dy = to.y + to.height / 2 - from.y - from.height / 2;
      const fromWidth = from.cardWidth || from.width,
        fromHeight = from.cardHeight || from.height;
      const toWidth = to.cardWidth || to.width,
        toHeight = to.cardHeight || to.height;
      return Promise.all([
        ...extras,
        track(
          flight,
          Array.from({ length: 13 }, (_, i) => {
            const t = i / 12,
              arc = Math.sin(Math.PI * t);
            const angle =
              (from.angle || 0) * (1 - t) + (to.angle || 0) * t + arc * 4;
            return {
              offset: t,
              transform: `translate(${dx * t}px,${dy * t - arc * (drawing === true ? 38 : 24)}px) rotate(${angle}deg) scale(${(fromWidth * (1 - t) + toWidth * t) / width},${(fromHeight * (1 - t) + toHeight * t) / height})`,
              opacity: 1,
            };
          }),
          {
            duration,
            delay,
            easing:
              drawing === true
                ? "cubic-bezier(.32,.12,.38,1)"
                : "cubic-bezier(.22,.65,.3,1)",
            fill: "both",
          },
        ),
      ]).then(() => {
        onArrival?.();
        flight.remove();
        flights.delete(flight);
      });
    }
    function busy() {
      if (visualBusy) return;
      visualBusy = true;
      root.dataset.visualBusy = "true";
      root.setAttribute("aria-busy", "true");
    }
    function finishVisuals(token, promises) {
      Promise.all(promises).then(() => {
        if (token !== generation || disposed) return;
        const beforeAi = state.status !== "playing" ? aiLayout() : null;
        cancelVisuals();
        render();
        if (state.status !== "playing" && !reducedMotion())
          void Promise.all(moveAiHands(beforeAi));
        schedule();
      });
    }
    function paint(el) {
      const style = getComputedStyle(el);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        filter: style.filter,
      };
    }
    function normalPaint(id) {
      const key = R.cards[id].color;
      if (normalPaints.has(key)) return normalPaints.get(key);
      const probe = drawCard(root, id);
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
      });
      const result = paint(probe);
      probe.remove();
      normalPaints.set(key, result);
      return result;
    }
    function fadePaint(el, from) {
      const to = paint(el);
      if (
        reducedMotion() ||
        Object.keys(to).every((key) => to[key] === from[key])
      )
        return Promise.resolve();
      return track(el, [from, to], { duration: 280, easing: "ease-in-out" });
    }
    function freezeRing() {
      if (!ringMotion) return;
      const time = ringMotion.currentTime;
      ringMotion.pause();
      if (typeof time === "number") ringMotion.currentTime = time;
    }
    function spinOnCompositor(ring) {
      if (reducedMotion()) {
        freezeRing();
        return;
      }
      if (
        !nativeSpinUnavailable &&
        (!ringMotion || ringMotionElement !== ring)
      ) {
        ringMotion?.cancel();
        try {
          ringMotion = ring.animate(
            [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
            {
              duration: 11250,
              iterations: Infinity,
              easing: "linear",
              fill: "both",
            },
          );
          ringMotion.finished.catch(() => {});
          ringMotion.currentTime =
            11250 * 1000000 + (((spinAngle % 360) + 360) % 360) / 0.032;
          ringMotionElement = ring;
        } catch {
          ringMotion = null;
          nativeSpinUnavailable = true;
        }
      }
      if (!ringMotion) return;
      if (paused() || state.status !== "playing") freezeRing();
      else {
        const rate = spinRate / 0.032;
        if (Math.abs(ringMotion.playbackRate - rate) > 0.002) {
          if (typeof ringMotion.updatePlaybackRate === "function")
            ringMotion.updatePlaybackRate(rate);
          else ringMotion.playbackRate = rate;
        }
        if (ringMotion.playState === "paused") ringMotion.play();
      }
      if (typeof ringMotion.currentTime === "number")
        spinAngle = (ringMotion.currentTime * 0.032) % 360;
    }
    function paintMotion() {
      const ring = root.querySelector(".uno-direction");
      if (ring) {
        spinOnCompositor(ring);
        if (
          !ringMotion ||
          ringMotion.playState !== "running" ||
          !ring.style.transform
        )
          ring.style.transform = `rotate(${spinAngle}deg)`;
        const a = ((225 + 75 * spinMirror) * Math.PI) / 180;
        const x = 120 + 94 * Math.cos(a),
          y = 120 + 94 * Math.sin(a);
        const angle = 135 - 15 * spinMirror;
        const first = ring.querySelector(".uno-direction-head-a"),
          second = ring.querySelector(".uno-direction-head-b");
        const one = `translate(${x} ${y}) rotate(${angle}) scale(.8) translate(-24 -24)`;
        const two = `translate(${240 - x} ${240 - y}) rotate(${angle + 180}) scale(.8) translate(-24 -24)`;
        if (first.getAttribute("transform") !== one)
          first.setAttribute("transform", one);
        if (second.getAttribute("transform") !== two)
          second.setAttribute("transform", two);
      }
      const pointer = root.querySelector(".uno-player-pointer"),
        value = pointerAngle + "deg";
      if (
        !pointerMotion &&
        pointer &&
        pointer.style.getPropertyValue("--player-angle") !== value
      )
        pointer.style.setProperty("--player-angle", value);
    }
    // Native clocks run without a JS frame loop at cruise. Only reverse geometry
    // and browsers without WAAPI need the temporary requestAnimationFrame driver.
    function syncSpin() {
      if (!state || !root.querySelector(".uno-direction")) return;
      if (!spinReady) {
        spinDirection = state.direction;
        spinRate = state.direction * 0.032;
        spinMirror = state.direction;
        spinReady = true;
        if (ringMotion)
          ringMotion.currentTime =
            11250 * 1000000 + (((spinAngle % 360) + 360) % 360) / 0.032;
      }
      if (spinDirection !== state.direction) {
        spinDirection = state.direction;
        spinBurst = 1050;
        if (!spinFrame) spinTime = 0;
      }
      if (reducedMotion()) {
        cancelAnimationFrame(spinFrame);
        spinFrame = null;
        spinMirror = state.direction;
        pointerAngle = pointerTarget;
        paintMotion();
        return;
      }
      paintMotion();
      if (
        pointerMotion?.playState === "paused" &&
        !paused() &&
        state.status === "playing"
      )
        pointerMotion.play();
      if (spinFrame || paused() || state.status !== "playing") return;
      if (ringMotion && !spinBurst && !nativePointerUnavailable) return;
      if (!spinTime) spinTime = performance.now();
      const tick = (now) => {
        spinFrame = null;
        if (
          disposed ||
          paused() ||
          reducedMotion() ||
          state.status !== "playing"
        ) {
          spinTime = 0;
          return;
        }
        const dt = Math.min(48, Math.max(0, now - spinTime));
        spinTime = now;
        spinBurst = Math.max(0, spinBurst - dt);
        // A brief reverse spin hides the changing arrow geometry; settle to cruise.
        const boost = spinBurst
          ? Math.sin(Math.PI * (1 - spinBurst / 1050)) ** 2 * 0.72
          : 0;
        const targetRate = state.direction * (0.032 + boost);
        spinRate += (targetRate - spinRate) * (1 - Math.exp(-dt / 125));
        spinMirror +=
          (state.direction - spinMirror) * (1 - Math.exp(-dt / 150));
        if (Math.abs(state.direction - spinMirror) < 0.001)
          spinMirror = state.direction;
        spinAngle = (spinAngle + spinRate * dt) % 360;
        if (
          !pointerMotion &&
          nativePointerUnavailable &&
          pointerTarget !== null &&
          pointerAngle !== null
        ) {
          pointerAngle +=
            (pointerTarget - pointerAngle) * (1 - Math.exp(-dt / 110));
          if (Math.abs(pointerTarget - pointerAngle) < 0.02)
            pointerAngle = pointerTarget;
        }
        paintMotion();
        if (ringMotion && !spinBurst && !nativePointerUnavailable) {
          spinRate = state.direction * 0.032;
          spinMirror = state.direction;
          paintMotion();
          spinTime = 0;
          return;
        }
        spinFrame = requestAnimationFrame(tick);
      };
      spinFrame = requestAnimationFrame(tick);
    }
    function discardPose(sequence) {
      let n =
        (state.appearanceSeed ^ Math.imul(sequence + 1, 0x9e3779b1)) >>> 0;
      n ^= n >>> 16;
      n = Math.imul(n, 0x85ebca6b) >>> 0;
      n = (n ^ (n >>> 13)) >>> 0;
      const x = (n % 21) - 10,
        y = ((n >>> 7) % 13) - 6;
      const angle = ((n >>> 14) % 23) - 11;
      return `translate(${x}px,${y}px) rotate(${angle}deg)`;
    }
    function renderDiscard(parent) {
      const pile = node(parent, "div", "uno-pile uno-discard");
      const history = openingCards
        ? openingCards.slice(0, openingShown)
        : shownDiscard || state.discard;
      const ids = history.slice(-state.discardLimit);
      ids.forEach((id, index) => {
        const card = drawCard(pile, id);
        card.classList.add("uno-discard-card");
        const event = [...state.log]
          .reverse()
          .find((e) => e.card === id && e.type === "play");
        if (
          R.cards[id].value >= 13 &&
          !state.openingColor &&
          !openingCards &&
          (event || index === ids.length - 1)
        )
          card.classList.add(
            "uno-settled",
            "uno-" + (event?.color || state.color),
          );
        card.style.transform = discardPose(history.length - ids.length + index);
        card.style.zIndex = String(index);
        if (index === ids.length - 1 && !shownDiscard)
          card.classList.add("uno-stack-top");
        else {
          card.classList.add("uno-stack-under");
          card.setAttribute("aria-hidden", "true");
        }
        if (index === ids.length - 1 && shownDiscard)
          card.classList.add("uno-previous-top");
      });
      if (shownDiscard) {
        const card = drawCard(pile, state.discard.at(-1));
        card.classList.add("uno-discard-card", "uno-stack-top");
        card.style.transform = discardPose(state.discard.length - 1);
        card.style.zIndex = String(ids.length);
      }
      pile.setAttribute("aria-label", t("discard"));
      return pile;
    }
    function animateDeal() {
      if (reducedMotion() || paused()) {
        schedule();
        return;
      }
      busy();
      dealing = true;
      root.dataset.handPhase = "dealing";
      const token = generation;
      const dealt = state.hands.map(() => 0);
      const status = root.querySelector(".uno-status");
      if (status) status.textContent = t("dealing");
      const hidden = [
        ...root.querySelectorAll(".uno-hand .uno-card, .uno-mini-back"),
      ];
      hidden.forEach((el) => {
        el.style.visibility = "hidden";
        if (el.classList.contains("uno-mini-back")) el.style.display = "none";
        el.dataset.unoHidden = "true";
      });
      const launch = () => {
        if (token !== generation || paused() || !dealing) return;
        if (
          root
            .closest(".workspace")
            ?.classList.contains("is-game-transitioning")
        ) {
          timer = setTimeout(() => {
            timer = null;
            launch();
          }, 40);
          return;
        }
        const from = rect(
          root.querySelector('.uno-draw-dock > button[data-uno-action="draw"]'),
        );
        // Measure every destination before inserting flights to avoid one forced
        // layout per dealt card on dense tables.
        const launches = [];
        for (let round = 0; round < 7; round++) {
          for (let player = 0; player < state.hands.length; player++) {
            const destination =
              player === 0
                ? playerRect(0, state.hands[0][round])
                : aiDealEnd(player, round + 1);
            const delay = (round * state.hands.length + player) * 42;
            launches.push(() =>
              fly(
                from,
                destination,
                player === 0 ? state.hands[0][round] : undefined,
                delay,
                300,
                player === 0,
                player === 0 ? 10 + round : 200,
              ).then(() => {
                if (token !== generation || !dealing) return;
                dealt[player]++;
                const target =
                  player === 0
                    ? root.querySelector(
                        `.uno-hand [data-card="${state.hands[0][round]}"]`,
                      )
                    : root.querySelectorAll(
                        `[data-seat="${player}"] .uno-mini-back`,
                      )[round];
                if (player === 0 && target) {
                  target.style.visibility = "";
                  target.style.display = "";
                  delete target.dataset.unoHidden;
                }
                if (player === 0 && target)
                  return fadePaint(target, normalPaint(state.hands[0][round]));
                if (player !== 0) return stageAiHand(player, dealt[player]);
              }),
            );
          }
        }
        finishVisuals(token, [
          Promise.all(launches.map((launch) => launch())).then(() => {
            if (token !== generation || disposed) return;
            dealing = false;
            return sortHand().then(() => animateOpening(token));
          }),
        ]);
      };
      launch();
    }

    function animateOpening(token) {
      if (!openingCards || token !== generation) return Promise.resolve();
      root.dataset.handPhase = "opening";
      let sequence = Promise.resolve();
      for (const id of openingCards) {
        sequence = sequence.then(() => {
          if (token !== generation || disposed || !openingCards) return;
          openingShown++;
          const old = root.querySelector(".uno-discard"),
            parent = old.parentElement;
          const pile = renderDiscard(parent);
          old.replaceWith(pile);
          const top = pile.querySelector(".uno-stack-top");
          top.style.visibility = "hidden";
          top.dataset.unoHidden = "true";
          const source = rect(
            root.querySelector(
              '.uno-draw-dock > button[data-uno-action="draw"]',
            ),
          );
          return fly(source, rect(top), id, 0, 340, false, 200).then(() => {
            if (token !== generation || !openingCards) return;
            top.style.visibility = "";
            delete top.dataset.unoHidden;
            paintTableColor(root.querySelector(".uno-table"));
            return track(top, [{ opacity: 1 }, { opacity: 1 }], {
              duration: 120,
            });
          });
        });
      }
      return sequence.then(async () => {
        if (token !== generation || disposed) return;
        for (let player = 0; player < state.hands.length; player++) {
          const extra = state.hands[player].slice(7);
          for (const id of extra) {
            if (token !== generation || disposed) return;
            const target =
              player === 0
                ? root.querySelector(`.uno-hand [data-card="${id}"]`)
                : null;
            await fly(
              rect(root.querySelector('[data-uno-action="draw"]')),
              player === 0 ? playerRect(0, id) : aiDealEnd(player, 7),
              player === 0 ? id : undefined,
              0,
              420,
              true,
            );
            if (token !== generation || disposed) return;
            if (target) {
              target.style.visibility = "";
              delete target.dataset.unoHidden;
            }
          }
          const label = root.querySelector(
            player === 0
              ? ".uno-own-count"
              : `[data-seat="${player}"] .uno-seat-count`,
          );
          if (label)
            label.textContent = t("cards", { n: state.hands[player].length });
        }
      });
    }
    function refillEmptyDeck() {
      if (paused() || visualBusy || !state || openingCards) return false;
      const next = R.refill(state);
      if (!next) return false;
      const cards = state.discard.slice(0, -1);
      stop(true);
      state = next;
      save();
      if (reducedMotion()) {
        render();
        return false;
      }
      shownDiscard = cards;
      shownDeckCount = 0;
      busy();
      render();
      const token = generation;
      finishVisuals(token, animateRecycle(cards, 0, token).tasks);
      return true;
    }
    function paintDrawPile(pile, count) {
      pile.dataset.count = String(count);
      const caption = pile.querySelector(".uno-pile-caption");
      if (caption && caption.dataset.count !== String(count)) {
        caption.dataset.count = String(count);
        caption.setAttribute("role", "img");
        caption.setAttribute("aria-label", t("cards", { n: count }));
        caption.style.setProperty(
          "--pile-digits",
          String(String(count).length),
        );
        caption.replaceChildren();
        setArt(caption, numberArt(count));
      }
      const under = [...pile.querySelectorAll(".uno-deck-under")];
      const visible = Math.min(3, Math.max(0, count - 1));
      for (let i = 0; i < Math.max(visible, under.length); i++) {
        if (i >= visible) {
          under[i]?.remove();
          continue;
        }
        const card =
          under[i] || node(pile, "div", "uno-card uno-back uno-deck-under");
        if (!under[i]) {
          card.setAttribute("aria-hidden", "true");
          setArt(card, backArt);
        }
        card.style.transform = `translate(${(i - 1) * 4}px,${i * 3}px) rotate(${[5, -6, 3][i]}deg)`;
        card.style.zIndex = String(i);
      }
    }
    // Delays are cancellable timers, not empty animations on the entire table.
    function waitVisual(delay) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          visualDelays.delete(timer);
          resolve();
        }, delay);
        visualDelays.set(timer, resolve);
      });
    }
    function afterVisualDelay(delay, token, callback) {
      const ready = delay > 0 ? waitVisual(delay) : Promise.resolve();
      return ready.then(() => {
        if (token === generation && !disposed) return callback();
      });
    }
    function animateRecycle(ids, delay, token) {
      const pile = root.querySelector(".uno-draw-dock");
      const sources = [...root.querySelectorAll(".uno-discard-card")].filter(
        (el) => ids.includes(Number(el.dataset.card)),
      );
      const shown = sources.length
        ? sources
        : [root.querySelector(".uno-stack-top")];
      const destination = rect(pile.querySelector("button"));
      const tasks = shown.map((card, i) => {
        const from = rect(card),
          id = sources.length ? Number(card.dataset.card) : ids.at(-1);
        return afterVisualDelay(delay + i * 22, token, () => {
          if (sources.length) card.style.visibility = "hidden";
          return fly(from, destination, id, 0, 520, "recycle", 180 + i).then(
            () => {
              if (token === generation) {
                shownDeckCount = Math.floor(
                  (ids.length * (i + 1)) / shown.length,
                );
                paintDrawPile(pile, shownDeckCount);
              }
            },
          );
        });
      });
      return { tasks, duration: 520 + (shown.length - 1) * 22 };
    }
    function animateAction(previous, action, from, beforeHand, beforeAi) {
      if (reducedMotion()) {
        presentingPlayer = null;
        revealResult = true;
        render();
        schedule();
        return;
      }
      busy();
      const incoming = state.hands[0].find(
        (id) => !previous.hands[0].includes(id),
      );
      if (incoming !== undefined) {
        const hand = root.querySelector(".uno-hand");
        const pane = rect(hand),
          card = rect(hand.querySelector(`[data-card="${incoming}"]`));
        if (card.x < pane.x) hand.scrollLeft -= pane.x - card.x + 8;
        else if (card.x + card.width > pane.x + pane.width)
          hand.scrollLeft += card.x + card.width - pane.x - pane.width + 8;
      }
      const token = generation,
        promises = moveHand(beforeHand);
      const recycled = previous.discard.filter(
        (id) => !state.discard.includes(id),
      );
      const drawStart = action.type === "play" ? 420 : 0;
      const recycleStart =
        drawStart + Math.max(0, previous.deck.length - 1) * 170;
      const recycling = recycled.length
        ? animateRecycle(recycled, recycleStart, token)
        : null;
      if (recycling) promises.push(...recycling.tasks);
      let drawIndex = 0;
      if (action.type === "play") {
        const landing = root.querySelector(".uno-discard .uno-stack-top");
        landing.style.visibility = "hidden";
        landing.dataset.unoHidden = "true";
        promises.push(
          fly(
            from,
            rect(landing),
            action.card,
            0,
            420,
            false,
            200,
            action.color,
          ).then(() => {
            if (token === generation) {
              landing.style.visibility = "";
              delete landing.dataset.unoHidden;
              const settling = [];
              if (R.cards[action.card].value >= 13)
                landing.classList.add("uno-settled", "uno-" + action.color);
              const older = [
                ...landing.parentElement.querySelectorAll(".uno-stack-under"),
              ];
              older
                .slice(0, Math.max(0, older.length + 1 - state.discardLimit))
                .forEach((el) =>
                  settling.push(
                    track(el, [{ opacity: 1 }, { opacity: 0 }], {
                      duration: 320,
                      easing: "ease-out",
                      fill: "forwards",
                    }).then(() => el.remove()),
                  ),
                );
              return Promise.all(settling);
            }
          }),
        );
      }
      for (let player = 0; player < state.hands.length; player++) {
        const added = state.hands[player].filter(
          (id) => !previous.hands[player].includes(id),
        );
        if (player !== 0 && added.length)
          stageAiHand(player, previous.hands[player].length, false);
        added.forEach((id, index) => {
          const order = drawIndex++;
          const afterRecycle = recycling && order >= previous.deck.length;
          const departure = afterRecycle
            ? recycleStart +
              recycling.duration +
              30 +
              (order - previous.deck.length) * 170
            : drawStart + order * 170;
          const destination =
            player === 0
              ? playerRect(0, id)
              : aiDealEnd(
                  player,
                  Math.min(7, previous.hands[player].length + index + 1),
                );
          const target =
            player === 0
              ? root.querySelector(`.uno-hand [data-card="${id}"]`)
              : null;
          if (target) {
            target.classList.add("uno-arriving");
            target.style.visibility = "hidden";
            target.dataset.unoHidden = "true";
          }
          promises.push(
            afterVisualDelay(departure, token, () => {
              shownDeckCount = afterRecycle
                ? Math.max(
                    0,
                    recycled.length - (order - previous.deck.length) - 1,
                  )
                : Math.max(0, previous.deck.length - order - 1);
              paintDrawPile(
                root.querySelector(".uno-draw-dock"),
                shownDeckCount,
              );
              return fly(
                rect(
                  root.querySelector(
                    '.uno-draw-dock > button[data-uno-action="draw"]',
                  ),
                ),
                destination,
                player === 0 ? id : undefined,
                0,
                760,
                true,
                target ? Number(target.style.zIndex) : 200 + index,
                null,
                player === 0
                  ? null
                  : paint(
                      root.querySelector(
                        `[data-seat="${player}"] .uno-mini-back`,
                      ),
                    ),
                () => {
                  if (target && token === generation) {
                    target.style.visibility = "";
                    delete target.dataset.unoHidden;
                    target.classList.remove("uno-arriving");
                  }
                },
              );
            }).then(() => {
              if (player !== 0 && token === generation)
                return stageAiHand(
                  player,
                  previous.hands[player].length + index + 1,
                );
            }),
          );
        });
      }
      promises.push(
        ...moveAiHands(beforeAi, null, action.type === "play" ? 160 : 0),
      );
      const event = state.log[state.log.length - 1];
      promises.push(...actionEffects(previous, action, event));
      if (event?.uno) {
        const toast = unoMark(root, "uno-toast");
        const tableBox = root
            .querySelector(".uno-table")
            .getBoundingClientRect(),
          origin = root.getBoundingClientRect();
        toast.style.left = tableBox.x + tableBox.width / 2 - origin.x + "px";
        toast.style.top = tableBox.y + tableBox.height / 2 - origin.y + "px";
        flights.add(toast);
        promises.push(
          track(
            toast,
            [
              {
                transform: "translate(-50%,-50%) scale(.4) rotate(-16deg)",
                opacity: 0,
              },
              {
                transform: "translate(-50%,-50%) scale(1.12) rotate(5deg)",
                opacity: 1,
                offset: 0.25,
              },
              {
                transform: "translate(-50%,-50%) scale(1) rotate(0deg)",
                opacity: 1,
                offset: 0.8,
              },
              { transform: "translate(-50%,-65%) scale(.9)", opacity: 0 },
            ],
            { duration: 1000, easing: "ease-out", fill: "both" },
          ),
        );
      }
      finishVisuals(token, promises);
    }
    function winnerMark(parent) {
      const mark = node(parent, "div", "uno-win");
      mark.setAttribute("role", "img");
      mark.setAttribute(
        "aria-label",
        t("winner", { name: name(state.winner) }),
      );
      mark.innerHTML =
        '<svg viewBox="0 0 180 80" aria-hidden="true"><path d="M8 15L19 65L31 64L41 39L45 65L59 63L75 12L61 14L53 44L48 17L35 18L25 45L22 13ZM82 14L80 28L87 28L84 52L77 53L76 66L105 65L107 52L99 52L102 27L110 27L111 13ZM119 15L113 65L127 66L131 38L148 66L160 64L168 13L154 14L150 42L133 14Z"/><path class="uno-win-sparks" d="m15 2 3 5m65 65-2 6m89-37 7 2m-73-41 2 6"/></svg>';
    }
    function actionEffects(previous, action, event) {
      const tasks = [];
      const show = (parent, value, sign = "", center = false) => {
        if (!parent) return;
        const area = parent.getBoundingClientRect(),
          origin = root.getBoundingClientRect();
        const effect = node(
          root,
          "div",
          "uno-action-effect" + (center ? " uno-effect-center" : ""),
        );
        effect.style.left = area.x + area.width / 2 - origin.x + "px";
        effect.style.top =
          area.y + area.height * (center ? 0.5 : 0.4) - origin.y + "px";
        if (center)
          effect.style.color =
            getComputedStyle(parent).getPropertyValue("--uno-current");
        effect.setAttribute("aria-hidden", "true");
        effect.innerHTML = sign
          ? `<svg viewBox="0 0 150 80"><path d="${sign === "+" ? "M5 33L23 33L23 15L36 15L36 33L54 33L54 47L36 47L36 65L23 65L23 47L5 47Z" : "M5 33L54 33L54 47L5 47Z"}"/><g transform="translate(60 0)">${value >= 10 ? `<g transform="scale(.65 1)">${glyph(Math.floor(value / 10))}<g transform="translate(60 0)">${glyph(value % 10)}</g></g>` : glyph(value)}</g></svg>`
          : faceMark(value, "uno-effect-mark");
        if (center)
          effect.insertAdjacentHTML(
            "afterbegin",
            '<svg class="uno-effect-rays" viewBox="0 0 200 200" aria-hidden="true"><path d="m100 8 2 17m47-4-8 15m36 18-15 8m30 38-18 1m2 47-16-9m-13 36-8-16m-39 33-1-19m-47 2 9-16m-35-16 17-7m-27-40 18 1m0-47 15 8m18-36 8 16"/></svg>',
          );
        flights.add(effect);
        tasks.push(
          track(
            effect,
            center
              ? [
                  { opacity: 0 },
                  { opacity: 1, offset: 0.18 },
                  { opacity: 1, offset: 0.65 },
                  { opacity: 0 },
                ]
              : [
                  {
                    transform: "translate(-50%,-40%) scale(.4) rotate(-20deg)",
                    opacity: 0,
                  },
                  {
                    transform: `translate(-50%,-50%) scale(1.1) rotate(${center ? 170 : 5}deg)`,
                    opacity: 1,
                    offset: 0.22,
                  },
                  {
                    transform: `translate(-50%,-55%) scale(1) rotate(${center ? 340 : -3}deg)`,
                    opacity: 1,
                    offset: 0.7,
                  },
                  {
                    transform: `translate(-50%,-70%) scale(.9) rotate(${center ? 400 : 0}deg)`,
                    opacity: 0,
                  },
                ],
            {
              duration: center ? 1100 : 800,
              delay: center ? 0 : 160,
              easing: "ease-out",
              fill: "both",
            },
          ).then(() => {
            effect.remove();
            flights.delete(effect);
          }),
        );
      };
      const area = (i) =>
        root.querySelector(i === 0 ? ".uno-own" : `[data-seat="${i}"]`);
      if (action.type === "play") {
        const value = R.cards[action.card].value;
        if (value === 11) show(root.querySelector(".uno-table"), 11, "", true);
        if (value === 10 || (value === 11 && state.hands.length === 2))
          show(
            area(
              (previous.turn + previous.direction + state.hands.length) %
                state.hands.length,
            ),
            10,
          );
        if (event.target !== undefined && event.count > 0) {
          show(area(event.target), event.count, "+");
        }
      }
      return tasks;
    }
    function clearCardHover() {
      hoveredCard?.classList.remove("uno-hovered");
      hoveredCard = hoverBounds = null;
    }
    function withinCard(box, event) {
      return (
        box &&
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      );
    }
    function holdCardHover(card, event) {
      if (visualBusy || paused() || card.disabled) return false;
      if (hoveredCard === card) return true;
      if (hoveredCard && withinCard(hoverBounds, event)) return false;
      clearCardHover();
      hoveredCard = card;
      const box = card.getBoundingClientRect(),
        clip = card.closest(".uno-hand").getBoundingClientRect();
      hoverBounds = {
        left: Math.max(box.left, clip.left),
        right: Math.min(box.right, clip.right),
        top: Math.max(box.top, clip.top),
        bottom: Math.min(box.bottom, clip.bottom),
      };
      card.classList.add("uno-hovered");
      return true;
    }
    root.addEventListener(
      "pointermove",
      (event) => {
        if (!hoveredCard) return;
        if (wildMenu?.contains(event.target)) {
          clearTimeout(wildTimer);
          return;
        }
        if (
          withinCard(hoverBounds, event) ||
          withinCard(hoveredCard.getBoundingClientRect(), event)
        )
          return;
        clearCardHover();
        if (wildMenu) deferWildClose();
        const card = event.target.closest?.(".uno-hand .uno-legal");
        if (card) holdCardHover(card, event);
      },
      { signal },
    );
    root.addEventListener(
      "pointerleave",
      () => {
        clearCardHover();
        if (wildMenu) deferWildClose();
      },
      { signal },
    );
    root.addEventListener(
      "scroll",
      (event) => {
        clearCardHover();
        if (event.target.matches?.(".uno-hand")) positionHandActions();
      },
      {
        signal,
        capture: true,
        passive: true,
      },
    );
    root.addEventListener(
      "click",
      (event) => {
        const card = hoveredCard;
        if (event.target.closest?.(".uno-hand-actions,.uno-corner-controls"))
          return;
        if (
          !card ||
          visualBusy ||
          card.disabled ||
          !withinCard(hoverBounds, event) ||
          wildMenu?.contains(event.target)
        )
          return;
        if (event.target.closest?.(".uno-card") === card) return;
        event.preventDefault();
        event.stopPropagation();
        card.click();
      },
      { signal, capture: true },
    );
    function drawCard(parent, id, interactive = false, available = false) {
      const c = R.cards[id];
      const el = node(
        parent,
        interactive ? "button" : "div",
        "uno-card uno-" + c.color,
      );
      el.dataset.card = String(id);
      el.dataset.value = String(c.value);
      el.setAttribute("aria-label", cardText(id));
      setArt(
        el,
        (c.value >= 13
          ? '<svg class="uno-wild-colors" viewBox="0 0 100 120" aria-hidden="true"><path fill="#bc3742" d="M50 60L50 10A44 50 0 0 0 6 60Z"/><path fill="#2e6ab1" d="M50 60L94 60A44 50 0 0 0 50 10Z"/><path fill="#268053" d="M50 60L50 110A44 50 0 0 0 94 60Z"/><path fill="#ebc443" d="M50 60L6 60A44 50 0 0 0 50 110Z"/><ellipse cx="50" cy="60" rx="44" ry="50" fill="none" stroke="#fff8" stroke-width="1.5"/></svg>'
          : "") +
          faceMark(c.value, "uno-card-symbol") +
          faceMark(c.value, "uno-card-corner"),
      );
      if (interactive) {
        el.type = "button";
        el.disabled = !available;
        el.classList.toggle("uno-legal", available);
        if (available)
          el.onmouseenter = (event) =>
            holdCardHover(event.currentTarget, event);
        if (c.value >= 13) {
          if (available) {
            el.onmouseenter = (event) => {
              if (holdCardHover(event.currentTarget, event))
                openWildMenu(event.currentTarget);
            };
            el.onmouseleave = deferWildClose;
            el.onfocus = (event) => openWildMenu(event.currentTarget);
            // Touch reveals the swatches; the card itself never commits a play.
            el.onclick = (event) => openWildMenu(event.currentTarget);
            el.onkeydown = (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openWildMenu(event.currentTarget);
                wildMenu?.querySelector("button")?.focus();
              }
            };
          }
        } else
          el.onclick = () => {
            if (!paused() && state.turn === 0)
              commit({ type: "play", card: id, color: c.color });
          };
      }
      return el;
    }
    function closeWildMenu(immediate = true) {
      if (!immediate && wildMenu && !reducedMotion()) {
        wildMenu.classList.add("uno-swatches-leaving");
        clearTimeout(wildTimer);
        wildTimer = setTimeout(() => closeWildMenu(), 150);
        return;
      }
      clearTimeout(wildTimer);
      cancelAnimationFrame(wildFrame);
      wildFrame = null;
      const card = root.querySelector(".uno-wild-open");
      if (card) {
        card.classList.remove("uno-wild-open");
        card.style.removeProperty("--uno-preview");
        delete card.dataset.preview;
      }
      wildMenu?.remove();
      wildMenu = null;
    }
    function deferWildClose() {
      clearTimeout(wildTimer);
      wildTimer = setTimeout(() => {
        if (hoveredCard?.classList.contains("uno-wild-open")) return;
        closeWildMenu(false);
      }, 180);
    }
    function openWildMenu(card) {
      if (paused() || visualBusy || card.disabled) return;
      if (wildMenu?.dataset.card === card.dataset.card) {
        clearTimeout(wildTimer);
        wildMenu.classList.remove("uno-swatches-leaving");
        return;
      }
      closeWildMenu();
      card.classList.add("uno-wild-open");
      const menu = node(root, "div", "uno-color-swatches");
      menu.dataset.card = card.dataset.card;
      wildMenu = menu;
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", t("chooseColor"));
      const keepMenu = () => {
        clearTimeout(wildTimer);
        menu.classList.remove("uno-swatches-leaving");
      };
      menu.onmouseenter = keepMenu;
      menu.onmouseleave = deferWildClose;
      menu.onfocusin = keepMenu;
      menu.onfocusout = (e) => {
        if (!menu.contains(e.relatedTarget) && e.relatedTarget !== card)
          deferWildClose();
      };
      const shapes = [
        "M5 8Q3 3 13 4Q22 1 25 9Q28 16 21 24Q12 29 5 22Q0 18 5 8Z",
        "M14 3C24 2 28 10 26 18C25 26 16 29 8 25C0 21 1 11 6 6Q9 3 14 3Z",
        "M14 3C23 1 28 8 27 15C28 24 19 29 11 26C2 25 0 16 4 9Q7 4 14 3Z",
        "M7 5Q19 0 25 8Q29 17 22 23Q13 29 4 22Q0 11 7 5Z",
      ];
      const preview = (color) => {
        card.dataset.preview = color;
        card.style.setProperty(
          "--uno-preview",
          {
            red: "#bc3742",
            yellow: "#ebc443",
            green: "#268053",
            blue: "#2e6ab1",
          }[color],
        );
      };
      for (const [index, color] of R.colors.entries()) {
        const choice = node(
          menu,
          "button",
          "uno-color-swatch uno-color-" + color,
        );
        choice.type = "button";
        choice.dataset.unoColor = color;
        choice.setAttribute("aria-label", t(color));
        choice.title = t(color);
        choice.innerHTML = `<svg viewBox="0 0 30 30" aria-hidden="true"><path d="${shapes[index]}"/><path class="uno-swatch-highlight" d="M8 9Q13 5 20 8"/></svg>`;
        choice.onmouseenter = choice.onfocus = () => preview(color);
        choice.onmouseleave = choice.onblur = () => {
          card.style.removeProperty("--uno-preview");
          delete card.dataset.preview;
        };
        choice.onclick = () =>
          commit({ type: "play", card: Number(card.dataset.card), color });
      }
      const start = performance.now();
      const position = () => {
        if (wildMenu !== menu || !card.isConnected) return;
        const a = card.getBoundingClientRect(),
          b = root.getBoundingClientRect();
        const width = card.offsetWidth;
        menu.style.width = width + "px";
        menu.style.left =
          Math.max(
            4,
            Math.min(b.width - width - 4, a.x + a.width / 2 - b.x - width / 2),
          ) + "px";
        menu.style.top = a.y - b.y - 100 + "px";
        if (performance.now() - start < 220 && !menu.matches(":hover"))
          wildFrame = requestAnimationFrame(position);
      };
      position();
      if (!reducedMotion())
        void track(
          menu,
          [
            { opacity: 0, transform: "translateY(5px) scale(.94)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 150, easing: "ease-out" },
        );
    }
    function render() {
      if (disposed) return;
      pickerAbort?.abort();
      pickerAbort = null;
      closeWildMenu();
      const focused = root.contains(document.activeElement)
        ? document.activeElement
        : null;
      const focusAction = focused?.dataset.unoAction,
        focusCard = focused?.dataset.card;
      const handScroll = root.querySelector(".uno-hand")?.scrollLeft || 0;
      const fresh = document.createDocumentFragment();
      const seatSignatures = new Map();
      let nextOwnSignature = null;
      renderHost = fresh;
      try {
        const stage = state && !setup ? node(root, "div", "uno-stage") : root;
        if (warning)
          node(root, "p", "uno-warning", t(warning)).setAttribute(
            "role",
            "alert",
          );
        if (degraded) node(root, "p", "uno-warning", t("fallback"));
        root.classList.toggle("uno-playing", !setup && !!state);
        root.classList.toggle(
          "uno-paused",
          paused() || state?.status !== "playing",
        );
        if (setup) {
          const layout = node(root, "div", "uno-setup-layout");
          const form = node(layout, "section", "uno-setup");
          node(form, "h3", "", t("settings"));
          node(form, "p", "uno-intro", t("description"));
          const field = (key, choices, selected, change) => {
            const row = node(form, "div", "uno-field");
            const label = node(row, "label", "", t(key));
            label.id = "uno-" + key + "-label";
            const host = node(row, "div", "uno-select-host");
            const select = node(host, "select");
            select.id = "uno-" + key;
            select.dataset.unoSetting = key;
            for (const [value, text] of choices) {
              const option = node(select, "option", "", text);
              option.value = String(value);
              option.selected = value === selected;
            }
            select.onchange = (event) => change(event.currentTarget.value);
          };
          field(
            "players",
            Array.from({ length: R.MAX_PLAYERS - 1 }, (_, i) => [
              i + 2,
              String(i + 2),
            ]),
            count,
            (value) => {
              count = Number(value);
            },
          );
          field(
            "difficulty",
            ["easy", "normal", "hard"].map((value) => [value, t(value)]),
            difficulty,
            (value) => {
              difficulty = value;
            },
          );
          field(
            "targetScore",
            R.TARGET_SCORES.map((value) => [value, t("points", { n: value })]),
            targetScore,
            (value) => {
              targetScore = Number(value);
              for (const paragraph of root.querySelectorAll(
                "[data-uno-rules-body]",
              )) {
                const key = paragraph.dataset.unoRulesBody;
                paragraph.textContent = t(key, { target: targetScore });
              }
            },
          );
          node(form, "p", "uno-setup-note", t("scoreHint"));
          button(form, "start", requestStart);
          if (state)
            button(form, "continue", () => {
              setup = false;
              state.discardLimit = R.DISCARD_LIMIT;
              targetScore = state.targetScore;
              save();
              render();
              schedule();
            });
          const rules = node(layout, "aside", "uno-setup-rules");
          rules.tabIndex = 0;
          rules.setAttribute("aria-label", t("rules"));
          node(rules, "h3", "", t("rules"));
          for (const section of [
            "Goal",
            "Start",
            "Play",
            "Special",
            "Draw",
            "Score",
          ]) {
            const block = node(rules, "section", "uno-rule-section");
            node(block, "h4", "", t("rules" + section + "Title"));
            const paragraph = node(
              block,
              "p",
              "",
              t("rules" + section, { target: targetScore }),
            );
            paragraph.dataset.unoRulesBody = "rules" + section;
          }
        } else if (state) {
          const displayTurn = presentingPlayer ?? state.turn;
          const arena = node(stage, "section", "uno-arena");
          arena.dataset.players = String(state.hands.length);
          arena.setAttribute("aria-label", t("table"));
          const seats = node(arena, "div", "uno-seats");
          const positions = {
            2: ["top"],
            3: ["upper-left", "upper-right"],
            4: ["left", "top", "right"],
            5: ["left", "upper-left", "upper-right", "right"],
            6: ["left", "upper-left", "top", "upper-right", "right"],
            7: [
              "lower-left",
              "middle-left",
              "upper-left",
              "upper-right",
              "middle-right",
              "lower-right",
            ],
            8: [
              "lower-left",
              "middle-left",
              "upper-left",
              "top",
              "upper-right",
              "middle-right",
              "lower-right",
            ],
          }[state.hands.length];
          state.hands.forEach((hand, i) => {
            if (i === 0) return;
            const active =
              state.status === "playing" && !paused() && displayTurn === i;
            const ended = state.status !== "playing" && revealResult;
            const signature = JSON.stringify([
              identity(i).n,
              name(i),
              visibleScore(i),
              state.dealer === i,
              Math.max(
                ...state.scores.map((_, player) => visibleScore(player)),
              ),
              t("cards", { n: hand.length }),
              positions[i - 1],
              ended,
              state.winner === i,
              hand,
            ]);
            seatSignatures.set(i, signature);
            const cached = seatViews.get(i),
              className = "uno-seat" + (active ? " uno-active" : "");
            if (cached?.signature === signature && cached.node.isConnected) {
              if (cached.node.className === className)
                referenceView(seats, cached.node);
              else {
                const copy = cached.node.cloneNode(false);
                copy.className = className;
                for (const child of cached.node.childNodes)
                  referenceView(copy, child);
                seats.append(copy);
              }
              return;
            }
            const seat = node(
              seats,
              "div",
              "uno-seat" + (active ? " uno-active" : ""),
            );
            seat.dataset.seat = String(i);
            seat.dataset.position = positions[i - 1];
            const info = playerInfo(seat, i);

            const backs = node(seat, "div", "uno-seat-hand");
            backs.setAttribute("aria-hidden", "true");

            const visible = ended ? hand.length : Math.min(7, hand.length);
            backs.classList.toggle("uno-revealed", ended);
            if (ended) {
              backs.removeAttribute("aria-hidden");
              backs.setAttribute("role", "group");
              backs.setAttribute(
                "aria-label",
                name(i) + " · " + t("cards", { n: hand.length }),
              );
            }
            for (let j = 0; j < visible; j++) {
              const back = node(backs, "span", "uno-mini-back");
              if (ended) {
                setArt(back, backArt);
                const front = drawCard(back, hand[j]);
                front.classList.add("uno-revealed-face");
                front.style.setProperty(
                  "--reveal-delay",
                  Math.min(j, 12) * 45 + "ms",
                );
                back.style.setProperty(
                  "--reveal-delay",
                  Math.min(j, 12) * 45 + "ms",
                );
              } else setArt(back, backArt);
              back.dataset.backIndex = String(j);
              back.style.setProperty(
                "--back-angle",
                (Math.min(j, 6) - (Math.min(7, visible) - 1) / 2) * 7 + "deg",
              );
              back.style.setProperty(
                "--back-lift",
                Math.abs(Math.min(j, 6) - (Math.min(7, visible) - 1) / 2) ** 2 *
                  1.1 +
                  "px",
              );
            }
            seat.append(info);
            if (state.status === "won" && revealResult && state.winner === i)
              winnerMark(seat);
          });
          const table = node(arena, "div", "uno-table");
          paintTableColor(table);
          table.dataset.current = String(displayTurn);
          const status = node(table, "p", "uno-status");
          status.setAttribute("role", "status");
          status.setAttribute("aria-live", "polite");
          status.textContent =
            state.status === "won" && revealResult
              ? t(state.matchWinner !== null ? "matchWinner" : "roundWinner", {
                  name: name(state.winner),
                })
              : state.status === "draw"
                ? t("drawGame")
                : paused()
                  ? t("paused")
                  : t(thinking ? "thinking" : "turn", {
                      name: name(displayTurn),
                    });
          const direction = node(table, "div", "uno-direction");

          direction.dataset.direction = String(state.direction);
          setArt(
            direction,
            `<svg viewBox="0 0 240 240" aria-hidden="true"><path d="M37 168A94 94 0 0 1 174 43"/><g class="uno-direction-head-a">${arrowShape}</g><path d="M203 72A94 94 0 0 1 66 197"/><g class="uno-direction-head-b">${arrowShape}</g></svg>`,
          );
          direction.setAttribute(
            "aria-label",
            t(state.direction === 1 ? "clockwise" : "counterclockwise"),
          );
          direction.title = direction.getAttribute("aria-label");
          const pointer = node(table, "div", "uno-player-pointer");

          pointer.setAttribute("aria-hidden", "true");
          setArt(pointer, `<svg viewBox="0 0 48 48">${arrowShape}</svg>`);
          const piles = node(table, "div", "uno-piles");
          const drawPile = node(stage, "div", "uno-pile uno-draw-dock");
          const deck = node(drawPile, "button", "uno-card uno-back");
          deck.type = "button";
          deck.dataset.unoAction = "draw";
          setArt(deck, backArt);
          deck.setAttribute("aria-label", t("draw"));
          node(drawPile, "span", "uno-pile-caption", "");
          paintDrawPile(drawPile, shownDeckCount ?? state.deck.length);
          if (state.openingColor) {
            const choose = node(table, "section", "uno-opening-colors");
            node(
              choose,
              "p",
              "",
              t("openingColor", { name: name(state.turn) }),
            );
            if (state.turn === 0)
              for (const color of R.colors) {
                const choice = button(choose, color, () =>
                  commit({ type: "color", color }),
                );
                choice.dataset.unoOpeningColor = color;
                choice.disabled = paused() || visualBusy;
              }
          }
          const legal = R.legal(state);
          const human =
            !paused() &&
            !visualBusy &&
            presentingPlayer === null &&
            (state.deck.length > 0 || state.discard.length < 2) &&
            state.turn === 0 &&
            state.status === "playing";
          deck.disabled = !human || state.drawn !== null || state.openingColor;
          deck.onclick = () => commit({ type: "draw" });
          renderDiscard(piles);
          const color = node(
            table,
            "p",
            "uno-current-color uno-color-" + state.color,
          );
          node(color, "span", "uno-color-dot").setAttribute(
            "aria-hidden",
            "true",
          );
          node(color, "span", "", t("currentColor", { color: t(state.color) }));
          node(
            table,
            "span",
            "uno-direction-caption",
            t(state.direction === 1 ? "clockwise" : "counterclockwise"),
          );
          const sorted =
            handOrder?.slice() || state.hands[0].slice().sort((a, b) => a - b);
          const muted =
            displayTurn === 0 && state.turn === 0 && state.status === "playing";
          nextOwnSignature = JSON.stringify([
            state.status !== "playing" && (paused() || visualBusy),
            visibleScore(0),
            state.dealer === 0,
            Math.max(...state.scores.map((_, player) => visibleScore(player))),
            sorted,
            human,
            muted,
            !paused() && displayTurn === 0 && state.status === "playing",
            state.drawn,
            state.status,
            state.winner,
            state.matchWinner,
            revealResult,
            muted || human
              ? legal.filter((a) => a.card !== undefined).map((a) => a.card)
              : [],
            t("cards", { n: sorted.length }),
            t("drawnHint"),
            t("pass"),
            t("nextRound"),
            t("newMatch"),
          ]);
          if (
            ownView?.signature === nextOwnSignature &&
            ownView.node.isConnected
          )
            referenceView(stage, ownView.node);
          else {
            const own = node(
              stage,
              "section",
              "uno-own" +
                (!paused() && displayTurn === 0 && state.status === "playing"
                  ? " uno-active"
                  : ""),
            );
            if (state.status === "won" && revealResult && state.winner === 0)
              winnerMark(own);
            const ownHeader = node(own, "div", "uno-own-header");
            playerInfo(ownHeader, 0);
            const hand = node(own, "div", "uno-hand");
            const sorted =
              handOrder?.slice() ||
              state.hands[0].slice().sort((a, b) => a - b);
            hand.classList.add("uno-hand-fan");
            const spread = node(hand, "div", "uno-hand-spread");
            for (let index = 0; index < sorted.length; index++) {
              const id = sorted[index];
              const card = drawCard(
                spread,
                id,
                true,
                human && legal.some((a) => a.card === id),
              );
              card.classList.toggle(
                "uno-muted",
                displayTurn === 0 &&
                  state.turn === 0 &&
                  state.status === "playing" &&
                  !legal.some((action) => action.card === id),
              );
              poseHandCard(card, index, sorted.length);
              const onCardFocus = card.onfocus;
              card.onfocus = (event) => {
                onCardFocus?.call(event.currentTarget, event);
                if (!restoringFocus)
                  event.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  });
              };
            }
            hand.scrollLeft = handScroll;
            const hint = node(
              own,
              "p",
              "uno-drawn-hint",
              state.drawn !== null &&
                state.turn === 0 &&
                state.status === "playing"
                ? t("drawnHint")
                : "",
            );
            hint.setAttribute("aria-live", "polite");
            const actions = node(own, "nav", "uno-hand-actions");
            if (
              state.drawn !== null &&
              state.turn === 0 &&
              state.status === "playing"
            )
              handAction(actions, "pass", () =>
                commit({ type: "pass" }),
              ).disabled = !human;
            if (state.status !== "playing" && revealResult)
              handAction(
                actions,
                state.matchWinner === null ? "nextRound" : "newMatch",
                state.matchWinner === null ? advanceRound : begin,
              ).disabled = paused() || visualBusy;
            actions.hidden = actions.childElementCount === 0;
          }
          if (!confirmation && localPause) {
            const cover = overlay("uno-pause", "paused");
            button(cover, "resume", () => {
              localPause = false;
              render();
              schedule();
            });
            button(cover, "settings", () => {
              setup = true;
              render();
            });
          }
          const controls = node(root, "nav", "uno-corner-controls");
          const restart = button(controls, "restart", requestStart);
          const settings = button(controls, "settings", () => {
            stop();
            setup = true;
            render();
          });
          for (const [control, icon, label] of [
            [restart, "restart-alt", "restart"],
            [settings, "settings", "settings"],
          ]) {
            control.textContent = "";
            control.append(G.createIcon(icon));
            control.title = t(label);
            control.setAttribute("aria-label", t(label));
          }
        }

        if (confirmation) {
          const confirm = overlay("uno-confirm", "confirm");
          button(confirm, "restart", () => confirmation());
          button(confirm, "cancel", () => {
            confirmation = null;
            render();
            schedule();
          });
        }
      } finally {
        renderHost = null;
      }
      patchView(root, fresh);
      if (setup) {
        pickerAbort = new AbortController();
        for (const select of root.querySelectorAll(".uno-select-host select")) {
          G.createSelect({
            host: select.parentElement,
            select,
            label: select.closest(".uno-field").querySelector("label"),
            signal: pickerAbort.signal,
          });
        }
      }
      for (const i of seatViews.keys())
        if (!seatSignatures.has(i)) seatViews.delete(i);
      for (const [i, signature] of seatSignatures)
        seatViews.set(i, {
          signature,
          node: root.querySelector(`[data-seat="${i}"]`),
        });
      const liveOwn = root.querySelector(".uno-own");
      ownView = liveOwn ? { signature: nextOwnSignature, node: liveOwn } : null;
      const liveHand = root.querySelector(".uno-hand");
      if (liveHand && liveHand.scrollLeft !== handScroll)
        liveHand.scrollLeft = handScroll;
      positionHandActions();
      root.classList.toggle("uno-motion-paused", paused());
      const revealed = [...root.querySelectorAll(".uno-revealed")];
      if (revealed.length) {
        const arenaBox = root
          .querySelector(".uno-arena")
          ?.getBoundingClientRect();
        const seatBoxes = [...root.querySelectorAll(".uno-seat")].map(
          (seat) => ({
            seat,
            box: seat.getBoundingClientRect(),
          }),
        );
        const revealSteps = [];
        for (const tray of revealed) {
          const seat = tray.closest(".uno-seat"),
            box = seat.getBoundingClientRect(),
            cx = box.x + box.width / 2,
            cy = box.y + box.height / 2;
          let available = Math.max(
            50,
            Math.min(cx - arenaBox.x, arenaBox.right - cx) * 2 - 8,
          );
          for (const peer of seatBoxes) {
            if (peer.seat === seat) continue;
            if (
              Math.abs(peer.box.y + peer.box.height / 2 - cy) <
              Math.min(box.height, peer.box.height) * 0.65
            )
              available = Math.min(
                available,
                Math.abs(peer.box.x + peer.box.width / 2 - cx) - 8,
              );
          }
          const cards = [...tray.querySelectorAll(".uno-mini-back")];
          if (!cards.length) continue;
          const width = cards[0].offsetWidth;
          const overhang = Math.max(
            ...cards.map((card) => {
              const m = new DOMMatrix(getComputedStyle(card).transform);
              return Math.abs(m.b) * card.offsetHeight * 1.5 + 3;
            }),
          );
          const step = Math.max(
            2,
            Math.min(
              width * 0.58,
              (available - width - overhang * 2) /
                Math.max(1, cards.length - 1),
            ),
          );
          revealSteps.push([tray, step]);
        }
        for (const [tray, step] of revealSteps)
          tray.style.setProperty("--uno-reveal-step", step + "px");
      }
      pointAtPlayer();
      syncSpin();
      const modal = root.querySelector(".uno-overlay");
      if (modal) {
        for (const child of root.children)
          if (child !== modal) child.inert = true;
        modal.querySelector("button")?.focus({ preventScroll: true });
      } else {
        restoringFocus = true;
        if (focusAction)
          root
            .querySelector(`[data-uno-action="${focusAction}"]`)
            ?.focus({ preventScroll: true });
        else if (focusCard)
          root
            .querySelector(`button[data-card="${focusCard}"]`)
            ?.focus({ preventScroll: true });
        restoringFocus = false;
      }
    }
    function paintTableColor(table) {
      if (!table || !state) return;
      const color = state.openingColor
        ? null
        : openingCards
          ? openingShown > 0
            ? R.cards[openingCards[openingShown - 1]].color
            : null
          : state.color;
      const colors = {
        red: "#c44250",
        yellow: "#be921a",
        green: "#2f8660",
        blue: "#387bb7",
      };
      table.dataset.color = colors[color] ? color : "none";
      table.style.setProperty("--uno-current", colors[color] || "#899398");
    }
    function angleDifference(target, current) {
      // Accumulated orbit angles can exceed several turns in either direction.
      // Reduce before offsetting: JS remainder alone does not wrap negatives.
      return ((((target - current) % 360) + 540) % 360) - 180;
    }
    // Sample an interrupted orbit before replacing it; interpolate radius as
    // well as angle so moving between the human and AI seats never teleports.
    function pointAtPlayer() {
      const table = root.querySelector(".uno-table"),
        pointer = table?.querySelector(".uno-player-pointer");
      if (!pointer || !state) return;
      const source = table.getBoundingClientRect();
      const displayTurn = presentingPlayer ?? state.turn;
      const target = rect(
        root.querySelector(
          displayTurn === 0
            ? ".uno-hand"
            : `[data-seat="${displayTurn}"] .uno-seat-info`,
        ),
      );
      if (!target) return;
      let nextRadius = source.width / 2 + 32;
      if (displayTurn === 0) {
        const info = rect(root.querySelector(".uno-own-info"));
        if (info)
          nextRadius = Math.max(
            source.width / 4,
            Math.min(
              nextRadius,
              info.y -
                (source.y + source.height / 2) -
                pointer.offsetHeight / 2 -
                10,
            ),
          );
      }
      const targetAngle =
        (Math.atan2(
          target.y + target.height / 2 - source.y - source.height / 2,
          target.x + target.width / 2 - source.x - source.width / 2,
        ) *
          180) /
        Math.PI;
      let startRadius = pointerRadius ?? nextRadius;
      const reroute =
        Math.abs(nextRadius - startRadius) > 0.1 ||
        pointerSeat !== displayTurn ||
        pointerTarget === null ||
        Math.abs(angleDifference(targetAngle, pointerTarget)) > 0.1;
      if (reroute && pointerMotion && pointerMotionElement === pointer) {
        const matrix = new DOMMatrix(getComputedStyle(pointer).transform);
        const visible = (Math.atan2(matrix.f, matrix.e) * 180) / Math.PI;
        pointerAngle += angleDifference(visible, pointerAngle);
        startRadius = Math.hypot(matrix.e, matrix.f);
      }
      if (pointerAngle === null) pointerTarget = targetAngle;
      else if (pointerSeat !== displayTurn) {
        const clockwise = (((targetAngle - pointerAngle) % 360) + 360) % 360;
        pointerTarget =
          pointerAngle +
          (state.direction === 1
            ? clockwise
            : clockwise < 0.05
              ? 0
              : clockwise - 360);
      } else pointerTarget += angleDifference(targetAngle, pointerTarget);
      pointerSeat = displayTurn;
      if (pointerAngle === null || reducedMotion() || paused())
        pointerAngle = pointerTarget;
      pointerRadius = nextRadius;
      pointer.style.setProperty("--uno-pointer-radius", nextRadius + "px");
      pointer.style.setProperty("--player-angle", pointerAngle + "deg");
      if (
        reroute &&
        !reducedMotion() &&
        !paused() &&
        (Math.abs(pointerTarget - pointerAngle) > 0.1 ||
          Math.abs(nextRadius - startRadius) > 0.1) &&
        !nativePointerUnavailable
      ) {
        pointerMotion?.cancel();
        const transform = (angle, radius) =>
            `rotate(${angle}deg) translateX(${radius}px) rotate(90deg)`,
          target = pointerTarget;
        try {
          const animation = pointer.animate(
            [
              { transform: transform(pointerAngle, startRadius) },
              { transform: transform(target, nextRadius) },
            ],
            {
              duration: 450,
              easing: "cubic-bezier(.22,.65,.3,1)",
              fill: "both",
            },
          );
          pointerMotion = animation;
          pointerMotionElement = pointer;
          animation.finished.then(
            () => {
              if (pointerMotion !== animation) return;
              pointerAngle = target;
              pointer.style.setProperty("--player-angle", target + "deg");
              animation.cancel();
              pointerMotion = null;
            },
            () => {},
          );
        } catch {
          pointerMotion = null;
          nativePointerUnavailable = true;
        }
      }
    }
    function overlay(className, title, params) {
      const cover = node(root, "div", "uno-overlay");
      const panel = node(cover, "section", className + " uno-dialog");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", t(title, params));
      node(panel, "h3", "", t(title, params));
      return panel;
    }
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && wildMenu) {
          const id = wildMenu.dataset.card;
          root
            .querySelector(`button[data-card="${id}"]`)
            ?.focus({ preventScroll: true });
          closeWildMenu();
          event.preventDefault();
          return;
        }
        const modal = root.querySelector(".uno-overlay");
        if (!modal) return;
        if (event.key === "Escape") {
          if (confirmation) {
            confirmation = null;
            render();
            schedule();
          } else if (localPause) {
            localPause = false;
            render();
            schedule();
          }
          event.preventDefault();
        }
        if (event.key === "Tab") {
          const buttons = [...modal.querySelectorAll("button:not(:disabled)")];
          const index = buttons.indexOf(document.activeElement);
          if (
            (event.shiftKey && index <= 0) ||
            (!event.shiftKey && index === buttons.length - 1)
          ) {
            buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
            event.preventDefault();
          }
        }
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        stop();
        render();
        schedule();
      },
      { signal },
    );
    document.addEventListener(
      "worktime:languagechange",
      () => {
        stop();
        render();
        schedule();
      },
      { signal },
    );
    document.addEventListener(
      "worktime:motionchange",
      () => {
        if (visualBusy && reducedMotion()) {
          stop();
          render();
          schedule();
        } else syncSpin();
      },
      { signal },
    );
    render();
    schedule();
    return {
      pause() {
        shellPause = true;
        stop();
        render();
      },
      resume() {
        shellPause = false;
        render();
        schedule();
      },
      resize({ height }) {
        clearCardHover();
        flightFaces.clear();
        flightOrigin = null;
        aiGeometry.clear();
        const nextHeight = Math.max(510, height - 8);
        if (visualBusy && flights.size) queuedHeight = nextHeight;
        else {
          root.style.setProperty("--uno-height", nextHeight + "px");
          pointAtPlayer();
          positionHandActions();
        }
      },
      dispose() {
        disposed = true;
        pickerAbort?.abort();
        stop();
        ringMotion?.cancel();
        pointerMotion?.cancel();
        pointerMotion = null;
        ringMotion = null;
        root.remove();
      },
    };
  },
});
