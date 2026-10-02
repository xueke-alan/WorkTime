(() => {
  "use strict";
  const canvas = document.getElementById("particleBg"),
    ctx = canvas.getContext("2d"),
    reduced = matchMedia("(prefers-reduced-motion:reduce)");
  let w,
    h,
    points = [],
    frame = null,
    disposed = false;
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
  function draw() {
    frame = null;
    if (disposed || document.hidden) return;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!reduced.matches) {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
      }
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j],
          dx = p.x - q.x,
          dy = p.y - q.y,
          d = dx * dx + dy * dy;
        if (d < 16900) {
          ctx.strokeStyle = `rgba(21,126,104,${(1 - d / 16900) * 0.14})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(21,126,104,.24)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fill();
    }
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  }
  function synchronize() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (!disposed && !document.hidden) draw();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    synchronize();
    removeEventListener("resize", resize);
    removeEventListener("pagehide", dispose);
    document.removeEventListener("visibilitychange", synchronize);
    document.removeEventListener("worktime:failed", dispose);
    reduced.removeEventListener("change", synchronize);
  }
  addEventListener("resize", resize);
  addEventListener("pagehide", dispose);
  document.addEventListener("visibilitychange", synchronize);
  document.addEventListener("worktime:failed", dispose);
  reduced.addEventListener("change", synchronize);
  window.WorkBackground = { dispose };
  resize();
})();
