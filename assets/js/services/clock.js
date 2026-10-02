"use strict";
/** Injectable clock. Business date policy is supplied independently of the host timestamp. */
const WorkClock = (() => {
  function create({ now = () => new Date(), dateKey }) {
    function current() {
      const value = now();
      if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw Error("时钟返回了无效时间。");
      return new Date(value.getTime());
    }
    function today() {
      return dateKey(current());
    }
    function year() {
      return Number(today().slice(0, 4));
    }
    /** Recheck at China midnight, on focus/resume, and after delayed timers. */
    function watch({
      document,
      onChange,
      schedule = setTimeout,
      cancel = clearTimeout,
    }) {
      let previous = today(),
        timer = null,
        stopped = false;
      function refresh() {
        if (stopped) return;
        const next = today();
        if (next !== previous) {
          previous = next;
          onChange(next);
        }
      }
      function arm() {
        if (stopped) return;
        cancel(timer);
        const nextMidnight = Date.parse(today() + "T00:00:00+08:00") + 86400000;
        timer = schedule(
          () => {
            refresh();
            arm();
          },
          Math.max(
            20,
            Math.min(60000, nextMidnight - current().getTime() + 20),
          ),
        );
      }
      function resume() {
        if (document.visibilityState === "hidden") return;
        refresh();
        arm();
      }
      document.addEventListener("visibilitychange", resume);
      document.defaultView.addEventListener("focus", resume);
      arm();
      return () => {
        stopped = true;
        cancel(timer);
        document.removeEventListener("visibilitychange", resume);
        document.defaultView.removeEventListener("focus", resume);
      };
    }
    return { now: current, today, year, watch };
  }
  return { create };
})();
