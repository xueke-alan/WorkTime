"use strict";
let engine;
self.onmessage = async ({ data }) => {
  let session = 0;
  try {
    const started = performance.now();
    if (!engine) {
      const binary =
        typeof data.wasm === "string"
          ? Uint8Array.from(atob(data.wasm), (c) => c.charCodeAt(0))
          : data.wasm;
      engine = (
        await WebAssembly.instantiate(binary, {
          host: { now: () => performance.now() },
        })
      ).instance.exports;
    }
    const input = new TextEncoder().encode(data.positions);
    const ptr = engine.allocate(input.length);
    try {
      new Uint8Array(engine.memory.buffer, ptr, input.length).set(input);
      session = engine.session_new(ptr, input.length);
    } finally {
      engine.release(ptr, input.length);
    }
    if (!session) throw Error("Invalid engine position");
    const until = performance.now() + data.budget;
    const step = () => {
      let complete = true;
      try {
        engine.session_step(session, 100000);
        const depth = engine.session_depth(session);
        if (performance.now() < until && !engine.session_finished(session)) {
          complete = false;
          setTimeout(step, 0);
          return;
        }
        if (!depth) throw Error("Engine did not complete a search depth");
        const from = engine.session_from(session),
          to = engine.session_to(session);
        self.postMessage({
          move: [from, to],
          depth,
          nodes: engine.session_nodes(session),
          score: engine.session_score(session),
          elapsed: performance.now() - started,
          engine: "MistyJungle",
        });
      } catch (error) {
        self.postMessage({ error: error.message });
      } finally {
        // A live session is retained only while another slice is scheduled.
        if (session && complete) {
          engine.session_free(session);
          session = 0;
        }
      }
    };
    step();
  } catch (error) {
    if (session) engine.session_free(session);
    self.postMessage({ error: error.message });
  }
};
