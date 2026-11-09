"use strict";

// The packaged engine is loaded only when entering human/computer play.
// Classic script + Blob Worker also work when index.html is opened via file://.
WorkTimeApp.games.createXiangqiEngine = function () {
  let worker = null;
  let loading = null;
  let sequence = 0;
  const pending = new Map();
  let disposed = false;
  let rejectLoading = null;
  let loadTimer = null;
  let generation = 0;
  let resourceScript = null;

  function fail(error) {
    generation++;
    clearTimeout(loadTimer);
    if (resourceScript) {
      resourceScript.onload = resourceScript.onerror = null;
      resourceScript.remove();
      resourceScript = null;
    }
    rejectLoading?.(error);
    rejectLoading = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    loading = null;
  }

  function load() {
    if (disposed) return Promise.reject(Error("Engine disposed"));
    if (loading) return loading;
    const token = ++generation;
    loading = new Promise((resolve, reject) => {
      rejectLoading = reject;
      loadTimer = setTimeout(
        () => fail(Error("Engine initialization timed out")),
        60000,
      );
      const start = () => {
        // A resource can finish after timeout, disposal, or a newer load attempt.
        if (disposed || token !== generation) return;
        const url = URL.createObjectURL(
          new Blob([WorkTimeApp.games.pikafishWorkerSource], {
            type: "text/javascript",
          }),
        );
        try {
          worker = new Worker(url);
        } catch (error) {
          URL.revokeObjectURL(url);
          fail(error);
          reject(error);
          return;
        }
        URL.revokeObjectURL(url);
        worker.onerror = (event) => {
          if (token !== generation) return;
          const error = Error(event.message || "Engine failed");
          fail(error);
          reject(error);
        };
        worker.onmessage = ({ data }) => {
          if (token !== generation) return;
          if (data.type === "ready") {
            clearTimeout(loadTimer);
            rejectLoading = null;
            resolve();
          } else if (data.type === "error") {
            const error = Error(data.message);
            fail(error);
            reject(error);
          } else if (data.type === "move") {
            const request = pending.get(data.id);
            pending.delete(data.id);
            request?.resolve(data.move);
          }
        };
      };
      if (WorkTimeApp.games.pikafishWorkerSource) start();
      else {
        const script = document.createElement("script");
        resourceScript = script;
        const path = "assets/vendor/pikafish/engine.js";
        const version = WorkTimeApp.data.assetVersions?.[path];
        script.src = path + (version ? "?v=" + version : "");
        script.onload = () => {
          script.remove();
          if (token !== generation) return;
          resourceScript = null;
          start();
        };
        script.onerror = () => {
          if (token !== generation) return;
          fail(Error("Unable to load local Pikafish resources"));
        };
        document.head.append(script);
      }
    });
    return loading;
  }

  return {
    load,
    async search(fen, difficulty) {
      await load();
      if (disposed) throw Error("Engine disposed");
      if (!worker) throw Error("Engine unavailable");
      if (pending.size) throw Error("Search already running");
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "search", id, fen, difficulty });
      });
    },
    dispose() {
      disposed = true;
      fail(Error("Engine disposed"));
    },
  };
};
