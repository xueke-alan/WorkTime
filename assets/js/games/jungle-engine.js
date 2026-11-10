"use strict";

WorkTimeApp.games.jungleEngine = (() => {
  const G = WorkTimeApp.games;
  const budgets = { easy: 100, normal: 700, hard: 3000 };
  const flip = (p) => (8 - Math.floor(p / 7)) * 7 + (p % 7);
  function fen(board, turn, quiet = 0, number = 1) {
    const letters = " RCDWPTLE";
    const ranks = [];
    for (let row = 0; row < 9; row++) {
      let text = "",
        empty = 0;
      for (let col = 0; col < 7; col++) {
        const piece = board[row * 7 + col];
        if (!piece) empty++;
        else {
          if (empty) text += empty;
          empty = 0;
          const letter = letters[Math.abs(piece)];
          text += piece > 0 ? letter : letter.toLowerCase();
        }
      }
      ranks.push(text + (empty || ""));
    }
    return (
      ranks.join("/") +
      " " +
      (turn === 1 ? "r" : "b") +
      " " +
      quiet +
      " " +
      number
    );
  }
  function positions(state) {
    // A capture irreversibly changes material; older positions cannot repeat.
    const keys = state.positions.slice(-(state.quiet + 1));
    const frames = keys.slice(0, -1).map((key) => {
      const [pieces, turn] = key.split(":");
      return fen(pieces.split(",").map(Number), Number(turn));
    });
    frames.push(
      fen(
        state.board,
        state.turn,
        state.quiet,
        Math.floor(state.path.length / 2) + 1,
      ),
    );
    return frames.join("\n");
  }
  function search(state, difficulty, { onResult, onError }) {
    let cancelled = false,
      worker = null,
      url = null,
      watchdog = null;
    function cancel() {
      cancelled = true;
      clearTimeout(watchdog);
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
    }
    function fail(error) {
      if (cancelled) return;
      cancel();
      onError(error);
    }
    WorkTimeApp.services.assets
      .script("assets/vendor/misty-jungle/engine.js")
      .then(() => {
        if (cancelled) return;
        try {
          const assets = G.mistyJungleAssets;
          url = URL.createObjectURL(
            new Blob([assets.worker], { type: "text/javascript" }),
          );
          worker = new Worker(url);
          worker.onerror = (event) => {
            event.preventDefault();
            fail(Error(event.message || "Engine worker failed"));
          };
          worker.onmessage = ({ data }) => {
            if (cancelled) return;
            if (data.error) return fail(Error(data.error));
            if (
              !Array.isArray(data.move) ||
              data.move.length !== 2 ||
              !data.move.every(
                (p) => Number.isInteger(p) && p >= 0 && p < 63,
              ) ||
              data.engine !== "MistyJungle" ||
              !(data.depth > 0) ||
              !(data.nodes > 0)
            )
              return fail(Error("Invalid engine response"));
            const move = data.move.map(flip);
            if (
              !G.jungleRules
                .legal(state.board, state.turn)
                .some((m) => m[0] === move[0] && m[1] === move[1])
            )
              return fail(Error("Illegal engine move"));
            cancel();
            onResult({ ...data, move });
          };
          watchdog = setTimeout(
            () => fail(Error("Engine timed out")),
            budgets[difficulty] + 10000,
          );
          worker.postMessage({
            wasm: assets.wasm,
            positions: positions(state),
            budget: budgets[difficulty],
          });
        } catch (error) {
          fail(error);
        }
      })
      .catch(fail);
    return { cancel };
  }
  return { search, fen, positions, flip, budgets };
})();
