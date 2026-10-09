(() => {
  "use strict";
  const canvas = document.getElementById("particleBg"),
    ctx = canvas?.getContext("2d"),
    reduced = WorkTimeApp.ui.animationCompat.preference();
  if (!ctx) return;
  const interval = 1000 / 30;
  let unlisten;
  let w,
    h,
    points = [],
    frame = null,
    lastDraw = null,
    lastTick = null,
    disposed = true;
  function resize() {
    w = innerWidth;
    h = innerHeight;
    const d = Math.min(devicePixelRatio, 2);
    canvas.width = w * d;
    canvas.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    points = Array.from(
      { length: Math.min(55, Math.max(14, Math.round((w * h) / 45000))) },
      () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.2 + 0.6,
      }),
    );
    synchronize();
  }
  let themeRGB = "21,126,104";
  function updateTheme() {
    themeRGB =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-rgb")
        .trim() || "21,126,104";
    synchronize();
  }
  function draw(timestamp = performance.now()) {
    frame = null;
    if (disposed || document.hidden) return;
    if (!reduced.matches) frame = requestAnimationFrame(draw);
    // Display refresh rates must not dictate decorative work or particle speed.
    if (lastTick !== null && timestamp - lastTick < interval) return;
    const elapsed =
      lastDraw === null ? 1 : Math.min(100, timestamp - lastDraw) / (1000 / 60);
    lastTick =
      lastTick === null
        ? timestamp
        : timestamp - ((timestamp - lastTick) % interval);
    lastDraw = timestamp;
    ctx.clearRect(0, 0, w, h);
    if (!reduced.matches)
      for (const p of points) {
        p.x = (p.x + p.vx * elapsed + w) % w;
        p.y = (p.y + p.vy * elapsed + h) % h;
      }
    ctx.fillStyle = `rgba(${themeRGB},.24)`;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j],
          dx = p.x - q.x,
          dy = p.y - q.y,
          d = dx * dx + dy * dy;
        if (d < 16900) {
          ctx.strokeStyle = `rgba(${themeRGB},${(1 - d / 16900) * 0.14})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fill();
    }
  }
  function synchronize() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastDraw = lastTick = null;
    if (!disposed && !document.hidden) draw();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    synchronize();
    removeEventListener("resize", resize);
    removeEventListener("pagehide", dispose);
    document.removeEventListener("visibilitychange", synchronize);
    document.removeEventListener("worktime:themechange", updateTheme);
    document.removeEventListener("worktime:failed", dispose);
    unlisten?.();
    unlisten = null;
    points = [];
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    addEventListener("resize", resize);
    addEventListener("pagehide", dispose);
    document.addEventListener("visibilitychange", synchronize);
    document.addEventListener("worktime:failed", dispose);
    unlisten = WorkTimeApp.ui.animationCompat.listen(reduced, synchronize);
    document.addEventListener("worktime:themechange", updateTheme);
    themeRGB =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-rgb")
        .trim() || themeRGB;
    resize();
  }
  WorkTimeApp.ui.background = { mount, dispose };
  mount();
})();
