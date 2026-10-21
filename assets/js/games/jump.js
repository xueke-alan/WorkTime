"use strict";
WorkTimeApp.games.register({
  id: "game-jump",
  nameKey: "games.jump.name",
  descriptionKey: "games.jump.description",
  icon: "game-jump",
  create({ container, signal }) {
    const rules = WorkTimeApp.games.jumpRules;
    const storageKey = "worktime.games.jump.best.v1";
    const t = (name, params) =>
      WorkTimeApp.i18n.t("games.jump." + name, params);
    const reduced = WorkTimeApp.ui.animationCompat.preference();
    let state = rules.create(),
      best = 0,
      saveFailed = false;
    let mode = "ready",
      paused = false,
      suspended = false,
      disposed = false;
    let charge = null,
      flight = null,
      frame = null,
      last = null;
    let activePointer = null,
      keyHeld = false,
      camera = { x: 0, z: 0 },
      gainText = "",
      sceneHint = "";
    let landing = null,
      spawn = null,
      particles = [],
      trail = [];
    let width = 0,
      height = 0,
      dpr = 1;
    const smooth = (value) => value * value * (3 - 2 * value);
    function readBest() {
      const raw = window.localStorage.getItem(storageKey);
      try {
        const value = JSON.parse(raw);
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
      } catch {
        return 0;
      }
    }
    try {
      best = readBest();
    } catch {
      saveFailed = true;
    }
    function node(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    }
    const listen = (target, event, callback, options = {}) =>
      target.addEventListener(event, callback, { ...options, signal });
    const root = node("section", "game-jump game-session", container);
    const counters = node("div", "jump-counters game-hud", root);
    const meters = ["score", "best"].map((name) => {
      const box = node("div", "game-stat", counters);
      return {
        name,
        label: node("span", "", box),
        value: node("strong", "", box),
      };
    });
    const controls = node("div", "jump-controls game-controls", root);
    function button(parent, action, callback, icon) {
      const element = node("button", "game-button", parent);
      element.type = "button";
      element.dataset.jumpAction = action;
      if (icon) {
        element.classList.add("game-icon-button");
        element.append(WorkTimeApp.games.createIcon(icon));
      }
      listen(element, "click", callback);
      return element;
    }
    const pauseButton = button(
      controls,
      "pause",
      () => {
        if (mode !== "playing") return;
        paused = !paused;
        cancelCharge();
        sync();
        if (paused) stop();
        else {
          stage.focus();
          loop();
        }
      },
      "pause",
    );
    const restart = button(controls, "restart", start, "restart-alt");
    const stage = node("div", "jump-stage", root);
    stage.tabIndex = 0;
    stage.setAttribute("role", "group");
    const canvas = node("canvas", "", stage);
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    const cover = node("div", "jump-cover", stage);
    const heading = node("h3", "", cover);
    const description = node("p", "", cover);
    const play = button(cover, "start", () => {
      if (mode === "playing") {
        paused = false;
        sync();
        stage.focus();
        loop();
      } else start();
    });
    const chargeBar = node("div", "jump-charge", stage);
    chargeBar.setAttribute("aria-hidden", "true");
    const chargeFill = node("span", "", chargeBar);
    const feedback = node("p", "jump-feedback", root);
    feedback.setAttribute("role", "status");
    const notice = node("div", "game-notice", root);
    const warning = node("p", "", notice);
    warning.setAttribute("role", "status");
    const help = WorkTimeApp.games.createHelp({
      root,
      controls,
      signal,
      text: () => t("help"),
      onChange(open) {
        if (open) {
          cancelCharge();
          if (mode === "playing") paused = true;
          stop();
          sync();
        }
      },
    });
    function saveBest() {
      best = Math.max(best, state.score);
      try {
        best = Math.max(best, readBest());
        window.localStorage.setItem(storageKey, JSON.stringify(best));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }
    function sync(paint = true) {
      root.dataset.mode = mode;
      root.dataset.phase = flight
        ? "jumping"
        : charge !== null
          ? "charging"
          : "idle";
      meters.forEach(({ name, label, value }) => {
        label.textContent = t(name);
        WorkTimeApp.games.paintCounter(
          value,
          name === "score" ? state.score : best,
        );
      });
      const isPaused = paused || suspended;
      pauseButton.disabled = mode !== "playing";
      pauseButton.title = t(isPaused ? "resume" : "pause");
      pauseButton.setAttribute("aria-label", pauseButton.title);
      WorkTimeApp.games.setIcon(pauseButton, isPaused ? "play-arrow" : "pause");
      restart.title = t("restart");
      restart.setAttribute("aria-label", restart.title);
      cover.hidden = mode === "playing" && !isPaused;
      cover.dataset.ended = String(mode === "over");
      heading.textContent =
        mode === "over" ? String(state.score) : t(isPaused ? "paused" : "name");
      description.textContent = t(mode === "over" ? "result" : "intro", {
        best,
      });
      play.textContent = t(
        mode === "over" ? "again" : isPaused ? "resume" : "start",
      );
      feedback.textContent = gainText || t("instruction");
      sceneHint = t("sceneHint");
      warning.textContent = saveFailed ? t("saveFailed") : "";
      stage.setAttribute("aria-label", t("board", { score: state.score }));
      chargeBar.hidden = mode !== "playing" || isPaused;
      help.refresh();
      if (paint) draw();
    }
    function cancelCharge() {
      charge = null;
      keyHeld = false;
      const pointer = activePointer;
      activePointer = null;
      if (pointer !== null && stage.hasPointerCapture(pointer))
        stage.releasePointerCapture(pointer);
      chargeFill.style.transform = "scaleX(0)";
    }
    function start() {
      if (disposed || suspended || signal.aborted) return;
      stop();
      cancelCharge();
      state = rules.create();
      camera = { x: 0, z: 0 };
      flight = null;
      landing = spawn = null;
      particles = [];
      trail = [];
      mode = "playing";
      paused = false;
      gainText = "";
      sync();
      stage.focus({ preventScroll: true });
    }
    function canPlay() {
      return (
        mode === "playing" &&
        !paused &&
        !suspended &&
        !disposed &&
        !signal.aborted &&
        !help.isOpen()
      );
    }
    function beginCharge() {
      if (!canPlay() || flight || charge !== null) return false;
      charge = performance.now();
      gainText = "";
      sync();
      loop();
      return true;
    }
    function release() {
      if (charge === null) return;
      const duration = performance.now() - charge;
      cancelCharge();
      if (!canPlay() || flight) return;
      const result = rules.jump(state, duration);
      flight = {
        from: state.position,
        result,
        time: 0,
        power: Math.min(1, duration / rules.maxCharge),
      };
      landing = null;
      trail = [];
      sync();
      loop();
    }
    listen(stage, "pointerdown", (event) => {
      if (
        event.button !== 0 ||
        activePointer !== null ||
        keyHeld ||
        event.target.closest("button")
      )
        return;
      if (beginCharge()) {
        event.preventDefault();
        stage.focus({ preventScroll: true });
        activePointer = event.pointerId;
        stage.setPointerCapture(event.pointerId);
      }
    });
    listen(stage, "pointerup", (event) => {
      if (event.pointerId === activePointer) {
        event.preventDefault();
        release();
      }
    });
    for (const event of ["pointercancel", "lostpointercapture"])
      listen(stage, event, () => {
        if (activePointer === null) return;
        cancelCharge();
        sync();
      });
    listen(stage, "contextmenu", (event) => event.preventDefault());
    listen(stage, "keydown", (event) => {
      if (event.target !== stage || event.code !== "Space") return;
      event.preventDefault();
      if (!event.repeat && activePointer === null && beginCharge())
        keyHeld = true;
    });
    listen(stage, "keyup", (event) => {
      if (event.code === "Space" && keyHeld) {
        event.preventDefault();
        release();
      }
    });
    listen(stage, "blur", () => {
      if (charge !== null) {
        cancelCharge();
        sync();
      }
    });
    listen(window, "blur", () => {
      if (mode !== "playing") return;
      paused = true;
      cancelCharge();
      stop();
      sync();
    });
    listen(document, "worktime:languagechange", () => sync());
    listen(window, "storage", (event) => {
      if (event.key === storageKey) {
        saveBest();
        sync();
      }
    });
    function stop() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      last = null;
    }
    function loop() {
      if (!canPlay() || frame !== null) return;
      frame = window.requestAnimationFrame(tick);
    }
    function tick(now) {
      frame = null;
      if (!canPlay()) return;
      const dt = last === null ? 0 : Math.max(0, now - last);
      last = now;
      if (landing) {
        landing.time += dt;
        if (landing.time > 650) landing = null;
      }
      if (spawn) {
        spawn.time += dt;
        if (spawn.time > 500) spawn = null;
      }
      particles.forEach((p) => (p.time += dt));
      particles = particles.filter((p) => p.time < p.life);
      trail.forEach((p) => (p.time += dt));
      trail = trail.filter((p) => p.time < 160);
      if (flight) {
        flight.time += dt;
        if (!reduced.matches && flight.time < 450) {
          const p = Math.min(1, flight.time / 480);
          trail.push({
            x: flight.from.x + (flight.result.position.x - flight.from.x) * p,
            z: flight.from.z + (flight.result.position.z - flight.from.z) * p,
            lift: 4 * p * (1 - p) * 145 + 25,
            time: 0,
          });
        }
        if (flight.time >= 480) {
          const { result } = flight;
          if (result.state.status !== "lost" || flight.time >= 800) {
            state = result.state;
            flight = null;
            trail = [];
            if (state.status !== "lost") {
              landing = {
                time: 0,
                position: state.position,
                platform: state.platforms.at(result.advanced ? -3 : -2),
                gain: result.gain,
                perfect: result.perfect,
              };
              if (result.advanced)
                spawn = { platform: state.platforms.at(-1), time: 0 };
              if (!reduced.matches)
                particles = Array.from(
                  { length: result.perfect ? 14 : 8 },
                  (_, i) => ({
                    x: state.position.x,
                    z: state.position.z,
                    angle: i * 2.39996,
                    speed: 30 + (i % 4) * 12,
                    life: 360 + (i % 3) * 70,
                    time: 0,
                  }),
                );
            }
            if (state.status === "lost") {
              mode = "over";
              gainText = t("miss");
            } else if (result.advanced)
              gainText = t(result.perfect ? "perfect" : "gain", {
                n: result.gain,
              });
            else gainText = t("short");
            saveBest();
            sync(false);
            if (mode === "over") play.focus({ preventScroll: true });
          }
        }
      }
      const current = state.platforms.at(-2);
      let cameraTarget = current;
      if (flight?.result.advanced && !reduced.matches) {
        const target = state.platforms.at(-1);
        const follow = smooth(
          Math.max(0, Math.min(1, (flight.time - 120) / 360)),
        );
        cameraTarget = {
          x: current.x + (target.x - current.x) * follow,
          z: current.z + (target.z - current.z) * follow,
        };
      }
      const blend = reduced.matches ? 1 : 1 - Math.exp(-dt / 100);
      camera.x += (cameraTarget.x - camera.x) * blend;
      camera.z += (cameraTarget.z - camera.z) * blend;
      draw();
      if (
        charge !== null ||
        flight ||
        landing ||
        spawn ||
        particles.length ||
        trail.length ||
        Math.hypot(camera.x - current.x, camera.z - current.z) > 0.1
      )
        loop();
      else last = null;
    }
    const tones = [
      ["#f9faf6", "#c3cec4", "#a6b9ad"],
      ["#85b9aa", "#56917f", "#407665"],
      ["#f4d287", "#d2ac61", "#b58f4c"],
      ["#9db5cc", "#748da8", "#5a738e"],
      ["#e4b4a1", "#c68e7d", "#ad7666"],
    ];
    function project(x, z, lift = 0) {
      return {
        x: 300 + (x - camera.x - z + camera.z) * 0.866,
        y: 440 - (x - camera.x + z - camera.z) * 0.5 - lift,
      };
    }
    function polygon(points, fill) {
      ctx.beginPath();
      points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function ellipse(x, y, rx, ry, color) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    function platform(p) {
      const center = project(p.x, p.z),
        r = p.size / 2,
        depth = 37;
      const colors = tones[p.tone];
      for (let i = 3; i > 0; i--)
        ellipse(
          center.x + 16,
          center.y + depth + 7,
          p.size * (0.65 + i * 0.04),
          p.size * (0.19 + i * 0.025),
          "#253e3108",
        );
      ctx.save();
      if (!reduced.matches) {
        if (spawn?.platform === p) {
          const enter = Math.min(1, spawn.time / 400);
          ctx.globalAlpha = smooth(Math.min(1, enter * 2));
          ctx.translate(0, -45 * Math.pow(1 - enter, 3));
        }
        const compression =
          charge !== null && p === state.platforms.at(-2)
            ? Math.min(1, (performance.now() - charge) / rules.maxCharge) * 7
            : flight && p === state.platforms.at(-2) && flight.time < 250
              ? flight.power *
                7 *
                Math.exp(-flight.time / 65) *
                Math.cos(flight.time / 40)
              : landing?.platform === p
                ? Math.sin(landing.time / 65) *
                  Math.exp(-landing.time / 115) *
                  6
                : 0;
        ctx.translate(0, center.y + depth);
        ctx.scale(1, 1 - compression / (depth + r));
        ctx.translate(0, -center.y - depth);
      }
      if (p.kind === "round") {
        ctx.fillStyle = colors[2];
        ctx.fillRect(center.x - r * 1.225, center.y, r * 2.45, depth);
        ellipse(center.x, center.y + depth, r * 1.225, r * 0.707, colors[2]);
        ellipse(center.x, center.y, r * 1.225, r * 0.707, colors[0]);
      } else {
        const points = [
          [-r, -r],
          [r, -r],
          [r, r],
          [-r, r],
        ].map(([x, z]) => project(p.x + x, p.z + z));
        const lower = points.map((point) => ({
          x: point.x,
          y: point.y + depth,
        }));
        polygon([points[0], points[3], lower[3], lower[0]], colors[1]);
        polygon([points[1], points[0], lower[0], lower[1]], colors[2]);
        polygon(points, colors[0]);
      }
      ellipse(
        center.x,
        center.y,
        7,
        4,
        p.tone === 0 ? "#6e9b8350" : "#ffffff70",
      );
      ctx.restore();
    }
    // Layout and backing-store allocation happen only when the stage changes size.
    // The animation loop reads cached geometry and never forces a layout.
    function measure() {
      if (disposed) return;
      const bounds = stage.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (width && height) {
        const w = Math.round(width * dpr),
          h = Math.round(height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
      draw();
    }
    const stageObserver = new window.ResizeObserver(measure);
    stageObserver.observe(stage);
    const heroSprite = document.createElement("canvas");
    heroSprite.width = 80;
    heroSprite.height = 160;
    const sprite = heroSprite.getContext("2d");
    sprite.scale(2, 2);
    sprite.translate(20, 70);
    const bodyFill = sprite.createLinearGradient(-15, 0, 15, 0);
    bodyFill.addColorStop(0, "#252b40");
    bodyFill.addColorStop(0.48, "#57546d");
    bodyFill.addColorStop(1, "#24283b");
    sprite.fillStyle = bodyFill;
    sprite.beginPath();
    sprite.moveTo(-17, -4);
    sprite.lineTo(-10, -39);
    sprite.quadraticCurveTo(0, -47, 10, -39);
    sprite.lineTo(17, -4);
    sprite.quadraticCurveTo(0, 6, -17, -4);
    sprite.fill();
    const headFill = sprite.createRadialGradient(-4, -60, 1, 0, -54, 17);
    headFill.addColorStop(0, "#646078");
    headFill.addColorStop(1, "#292d41");
    sprite.fillStyle = headFill;
    sprite.beginPath();
    sprite.ellipse(0, -54, 13, 14, 0, 0, Math.PI * 2);
    sprite.fill();
    function draw() {
      if (!ctx || disposed || !width || !height) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width / 600, height / 650);
      ctx.translate((width - 600 * scale) / 2, (height - 650 * scale) / 2);
      ctx.scale(scale, scale);
      const progress = flight ? Math.min(1, flight.time / 480) : 0;
      let point = state.position,
        lift = 0;
      if (flight) {
        point = {
          x:
            flight.from.x +
            (flight.result.position.x - flight.from.x) * progress,
          z:
            flight.from.z +
            (flight.result.position.z - flight.from.z) * progress,
        };
        lift = 4 * progress * (1 - progress) * (reduced.matches ? 35 : 145);
        if (flight.time > 480) {
          const fall = (flight.time - 480) / 320;
          lift = -190 * fall * fall;
        }
      }
      const hero = project(point.x, point.z, lift);
      const shadow = project(point.x, point.z);
      const chargeValue =
        charge === null
          ? 0
          : Math.min(1, (performance.now() - charge) / rules.maxCharge);
      chargeFill.style.transform = `scaleX(${chargeValue})`;
      const drawHero = () => {
        const shadowScale = 1 - Math.max(0, lift) / 270;
        for (let i = 3; i > 0; i--)
          ellipse(
            shadow.x + 5,
            shadow.y + 3,
            (16 + i * 2) * shadowScale,
            (5 + i) * shadowScale,
            `rgba(28,40,52,${0.045 * shadowScale})`,
          );
        ctx.save();
        ctx.translate(hero.x, hero.y);
        if (!reduced.matches) {
          let squash = chargeValue * 0.3;
          if (flight && progress < 1) {
            // Rotate around the body's center, keeping both endpoints upright.
            const spin = smooth(
              Math.max(0, Math.min(1, (progress - 0.08) / 0.84)),
            );
            const direction =
              flight.result.position.x - flight.from.x >=
              flight.result.position.z - flight.from.z
                ? 1
                : -1;
            ctx.translate(0, -28);
            ctx.rotate(direction * Math.PI * 2 * spin);
            ctx.translate(0, 28);
            squash =
              flight.power * 0.3 * Math.max(0, 1 - progress / 0.12) -
              Math.sin(progress * Math.PI) * 0.12;
          } else if (flight) {
            ctx.rotate(((flight.time - 480) / 320) * 1.4);
          } else if (landing)
            squash =
              Math.sin(landing.time / 55) *
              Math.exp(-landing.time / 130) *
              0.28;
          ctx.scale(1 + squash * 0.55, 1 - squash);
          if (charge !== null) ctx.translate(0, chargeValue * 5);
          else if (flight && progress < 0.12)
            ctx.translate(0, flight.power * 5 * (1 - progress / 0.12));
        }
        ctx.drawImage(heroSprite, -20, -70, 40, 80);
        ctx.restore();
      };
      for (const p of trail) {
        const at = project(p.x, p.z, p.lift);
        ellipse(
          at.x,
          at.y,
          3 * (1 - p.time / 160),
          3 * (1 - p.time / 160),
          `rgba(115,143,131,${0.18 * (1 - p.time / 160)})`,
        );
      }
      // Paint distant platforms before the player, then any platform in front.
      let paintedHero = false;
      const heroDepth = point.x + point.z;
      [...state.platforms]
        .sort((a, b) => b.x + b.z - a.x - a.z)
        .forEach((p) => {
          if (!paintedHero && lift < 20 && p.x + p.z < heroDepth - p.size / 2) {
            drawHero();
            paintedHero = true;
          }
          platform(p);
        });
      if (!paintedHero) drawHero();
      if (landing && !reduced.matches && landing.time < 400) {
        const age = landing.time / 400,
          at = project(landing.position.x, landing.position.z);
        ctx.beginPath();
        ctx.ellipse(
          at.x,
          at.y + 1,
          18 + 38 * age,
          9 + 19 * age,
          0,
          0,
          Math.PI * 2,
        );
        ctx.lineWidth = 2 * (1 - age);
        ctx.strokeStyle = `rgba(111,154,126,${0.45 * (1 - age)})`;
        ctx.stroke();
      }
      for (const p of particles) {
        const age = p.time / 1000;
        const at = project(p.x, p.z);
        ctx.globalAlpha = Math.pow(1 - p.time / p.life, 2);
        ellipse(
          at.x + Math.cos(p.angle) * p.speed * age * 2,
          at.y + Math.sin(p.angle) * p.speed * age - 65 * age + 120 * age * age,
          2.5,
          1.7,
          landing?.perfect ? "#e7ba5d" : "#79a995",
        );
      }
      ctx.globalAlpha = 1;
      if (landing?.gain && !reduced.matches) {
        const p = Math.min(1, landing.time / 650),
          at = project(landing.position.x, landing.position.z, 85 + 35 * p);
        ctx.globalAlpha = Math.min(1, (1 - p) * 3);
        ctx.fillStyle = landing.perfect ? "#62836b" : "#596b62";
        ctx.textAlign = "center";
        ctx.font = "700 26px sans-serif";
        ctx.fillText("+" + landing.gain, at.x, at.y);
        ctx.globalAlpha = 1;
      }
      if (mode === "playing" && !paused && !suspended) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#687970";
        ctx.font = "15px sans-serif";
        ctx.fillText(sceneHint, 300, 605);
      }
    }
    measure();
    sync();
    return {
      resize({ height: available }) {
        root.style.setProperty(
          "--jump-height",
          Math.max(430, available) + "px",
        );
        measure();
      },
      pause() {
        suspended = true;
        if (mode === "playing") paused = true;
        cancelCharge();
        stop();
        sync();
      },
      resume() {
        suspended = false;
        sync();
      },
      dispose() {
        disposed = true;
        cancelCharge();
        stop();
        stageObserver.disconnect();
        root.remove();
      },
    };
  },
});
