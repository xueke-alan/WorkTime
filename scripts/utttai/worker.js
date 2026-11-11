/* global ort */
"use strict";
// Bundled after the pinned ORT runtime and the application's shared referee.
(() => {
  const R = WorkTimeApp.games.ultimateTttRules;
  let session;
  const node = (state, action = -1, prior = 1) => ({
    state,
    action,
    prior,
    visits: 0,
    sum: 0,
    children: null,
  });
  async function evaluate(n) {
    if (n.state.status !== "playing") return n.state.winner * n.state.turn;
    const output = await session.run({
      input: new ort.Tensor("float32", R.encode(n.state), [1, 4, 9, 9]),
    });
    const logits = output.policy_logits.data;
    const value = output.state_value.data[0];
    if (logits.length !== 81 || !Number.isFinite(value))
      throw Error("Invalid NMCTS2 output");
    const moves = R.legal(n.state),
      max = Math.max(...moves.map((p) => logits[R.flat(p)]));
    const weights = moves.map((p) => Math.exp(logits[R.flat(p)] - max));
    const total = weights.reduce((a, b) => a + b, 0);
    n.children = moves.map((p, i) =>
      node(R.move(n.state, p, false), p, weights[i] / total),
    );
    return value;
  }
  async function search(state, difficulty, limit) {
    const started = performance.now(),
      root = node(state);
    await evaluate(root);
    let simulations = 0;
    while (performance.now() - started < limit || simulations < 1) {
      const path = [root];
      let n = root;
      while (n.children?.length) {
        let best = -Infinity,
          selected;
        for (const child of n.children) {
          const score =
            (child.visits ? -child.sum / child.visits : 0) +
            (2 * Math.max(0.01, child.prior) * Math.sqrt(n.visits + 1)) /
              (child.visits + 1);
          if (score > best) {
            best = score;
            selected = child;
          }
        }
        n = selected;
        path.push(n);
      }
      let value = await evaluate(n);
      for (let i = path.length - 1; i >= 0; i--) {
        path[i].visits++;
        path[i].sum += value;
        value = -value;
      }
      simulations++;
    }
    let candidates = root.children;
    const wins = candidates.filter((n) => n.state.winner === state.turn);
    if (wins.length) candidates = wins;
    else {
      // One-ply tactical guard uses the variant referee, including clearing and territory wins.
      const safe = candidates.filter(
        (n) =>
          !R.legal(n.state).some(
            (p) => R.move(n.state, p, false).winner === -state.turn,
          ),
      );
      if (safe.length) candidates = safe;
    }
    candidates.sort((a, b) => b.visits - a.visits || b.prior - a.prior);
    let best = candidates[0];
    if (difficulty === "easy" && !wins.length) {
      const pool = candidates.slice(0, 5);
      best = pool[Math.floor(Math.random() * pool.length)];
    }
    return {
      move: best.action,
      simulations,
      elapsed: performance.now() - started,
      engine: "uttt.ai NMCTS2",
      model: "stage2-100000",
      value: root.sum / root.visits,
    };
  }
  function decodeOffline(base64) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(base64);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  self.onmessage = async ({ data }) => {
    try {
      if (data.type === "init") {
        const wasm = data.offline
          ? decodeOffline(data.offline.wasm)
          : data.wasm;
        const model = data.offline
          ? decodeOffline(data.offline.model)
          : new Uint8Array(data.model);
        const url = URL.createObjectURL(
          new Blob([wasm], { type: "application/wasm" }),
        );
        try {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.simd = true;
          ort.env.wasm.wasmPaths = {
            "ort-wasm-simd.wasm": url,
            "ort-wasm.wasm": url,
          };
          session = await ort.InferenceSession.create(model, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          });
          const test = await session.run({
            input: new ort.Tensor(
              "float32",
              R.encode(R.create()),
              [1, 4, 9, 9],
            ),
          });
          if (
            test.policy_logits.data.length !== 81 ||
            !Number.isFinite(test.state_value.data[0])
          )
            throw Error("Model smoke test failed");
          self.postMessage({ type: "ready", probe: test.state_value.data[0] });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (data.type === "search") {
        const state = R.replay(data.path, data.chain);
        if (!session || !state || state.status !== "playing")
          throw Error("Invalid search request");
        self.postMessage({
          type: "result",
          id: data.id,
          ...(await search(state, data.difficulty, data.budget)),
        });
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        message: String(error.message || error),
      });
    }
  };
})();
