"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { createHash } = require("node:crypto");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const root = path.resolve(__dirname, "../..");
const sourcePaths = ["uno-rules", "uno-ai", "uno-model"].map((name) =>
  path.join(root, "assets/js/games", name + ".js"),
);
const scope = vm.createContext({ WorkTimeApp: { games: {} }, performance });
for (const file of sourcePaths)
  vm.runInContext(fs.readFileSync(file, "utf8"), scope, { filename: file });
const G = scope.WorkTimeApp.games;
const R = G.unoRules;
const base = G.unoAi;
const M = G.unoModelFactory(R, base);
const cache = path.join(root, ".cache/uno-training");
const checkpoint = path.join(cache, "checkpoint.json");
const result = path.join(cache, "evaluation.json");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const sources = () =>
  Object.fromEntries(
    [...sourcePaths, __filename].map((file) => [
      path.relative(root, file).replaceAll("\\", "/"),
      sha(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")),
    ]),
  );
const digest = (model) => sha(JSON.stringify(model));
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
};
const load = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const random = (seed) => ({ rng: seed >>> 0 || 1 });
const same = (a, b) =>
  a.type === b.type && a.card === b.card && a.color === b.color;

function match({ count, deckSeed, aiSeed, target, policy, onEnd }) {
  let s = R.create(count, "normal", deckSeed, target);
  const ai = Array.from({ length: count }, (_, seat) =>
    random(aiSeed ^ Math.imul(seat + 1, 0x9e3779b9)),
  );
  for (let step = 0; step < 10000; step++) {
    const o = R.observe(s, false);
    const actions = R.legal(s);
    const seed = ai[s.turn].rng;
    R.random(ai[s.turn]);
    const action = policy(o, actions, seed, step);
    assert(
      actions.some((a) => same(a, action)),
      "AI returned an illegal action",
    );
    s = R.apply(s, action, true);
    if (s.matchWinner !== null) {
      onEnd?.(s);
      return s.matchWinner;
    }
    if (s.status !== "playing") s = R.nextRound(s);
  }
  throw Error("Match exceeded 10,000 actions at seed " + deckSeed);
}

function fixtures(start, games) {
  return Array.from({ length: 7 * games }, (_, i) => {
    const count = 2 + Math.floor(i / games);
    const n = i % games;
    return {
      count,
      seat: n % count,
      target: n % 4 === 0 ? 500 : n % 4 === 1 ? 300 : 200,
      deckSeed: start + i,
      aiSeed: (start ^ Math.imul(i + 1, 2654435761)) >>> 0,
    };
  });
}

function batch(task, items, model, history = []) {
  const threads = Math.min(12, os.availableParallelism(), items.length);
  return Promise.all(
    Array.from(
      { length: threads },
      (_, i) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(__filename, {
            workerData: {
              task,
              model,
              history,
              items: items.filter((_, j) => j % threads === i),
            },
          });
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code) reject(Error("Worker exited with code " + code));
          });
        }),
    ),
  ).then((arrays) => arrays.flat());
}

function teacher(o, actions, seed, hard) {
  if (!hard && !o.openingColor) {
    return actions.reduce((best, action) =>
      base.score(o, action) > base.score(o, best) ? action : best,
    );
  }
  return base.choose(o, hard ? "hard" : "normal", seed, Infinity, 10);
}

function collect(fixture, model, history) {
  const traces = [];
  match({
    ...fixture,
    policy(o, actions, seed, step) {
      if (actions.length === 1) return actions[0];
      if (!model && step % 3 !== 0 && !o.openingColor && o.drawn === null)
        return teacher(o, actions, seed, false);
      if (model && o.turn !== fixture.seat) {
        const previous = history[(o.turn + fixture.deckSeed) % history.length];
        return previous && (o.turn + fixture.deckSeed) % 3 !== 0
          ? M.choose(o, "normal", seed, previous, Infinity)
          : teacher(o, actions, seed, false);
      }
      const encode = M.features(o);
      const inputs = actions.map(encode);
      if (model) {
        const p = M.distribution(
          inputs.map((input) => M.predict(model.weights, input)),
          1.1,
        );
        const index = M.draw(p, random(seed));
        traces.push({ inputs, index });
        return actions[index];
      }
      const action = teacher(o, actions, seed, step % 2 === 0);
      traces.push({ inputs, index: actions.findIndex((a) => same(a, action)) });
      return action;
    },
    onEnd(s) {
      if (model) {
        const reward =
          Number(s.matchWinner === fixture.seat) - 1 / fixture.count;
        for (const trace of traces) trace.reward = reward;
      }
    },
  });
  return traces;
}

function fit(model, data, epochs, rng, rate) {
  const w = model.weights;
  const width = M.inputSize + 2;
  const gradient = new Float64Array(w.length);
  const hidden = new Float64Array(M.hiddenSize);
  const first = new Float64Array(w.length);
  const second = new Float64Array(w.length);
  let updates = 0;
  let pending = 0;
  const flush = () => {
    updates++;
    for (let j = 0; j < w.length; j++) {
      const g = gradient[j] / pending;
      first[j] = 0.9 * first[j] + 0.1 * g;
      second[j] = 0.999 * second[j] + 0.001 * g * g;
      w[j] -=
        (rate * (first[j] / (1 - 0.9 ** updates))) /
        (Math.sqrt(second[j] / (1 - 0.999 ** updates)) + 1e-8);
    }
    gradient.fill(0);
    pending = 0;
  };
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const { inputs, index, reward = 1 } of R.shuffle(data.slice(), rng)) {
      const scores = inputs.map((input) => M.predict(w, input));
      const temperature = reward === 1 ? 1 : 1.1;
      const probabilities = M.distribution(scores, temperature);
      for (let i = 0; i < scores.length; i++) {
        const d =
          (reward * (probabilities[i] - Number(i === index))) / temperature;
        if (Math.abs(d) < 1e-9) continue;
        const input = inputs[i];
        M.predict(w, input, hidden);
        for (let h = 0; h < hidden.length; h++) {
          const offset = h * width;
          const slope = d * w[offset + M.inputSize + 1] * (1 - hidden[h] ** 2);
          for (let j = 0; j < M.inputSize; j++)
            gradient[offset + j] += slope * input[j];
          gradient[offset + M.inputSize] += slope;
          gradient[offset + M.inputSize + 1] += d * hidden[h];
        }
      }
      if (++pending === 32) flush();
    }
    if (pending) flush();
  }
}

function assess(fixture, model, modes) {
  const wins = [];
  for (const mode of modes) {
    const winner = match({
      ...fixture,
      policy(o, actions, seed) {
        if (actions.length === 1) return actions[0];
        if (o.turn !== fixture.seat) return teacher(o, actions, seed, false);
        return mode === "legacy"
          ? base.choose(o, "hard", seed, Infinity)
          : M.choose(o, mode, seed, model, Infinity);
      },
    });
    wins.push(Number(winner === fixture.seat));
  }
  return { count: fixture.count, wins };
}

if (!isMainThread) {
  const { task, items, model, history } = workerData;
  parentPort.postMessage(
    task === "collect"
      ? items.flatMap((fixture) => collect(fixture, model, history))
      : items.map((fixture) => assess(fixture, model, task)),
  );
}

async function train(resume) {
  const rng = random(185217);
  const state = resume
    ? load(checkpoint)
    : {
        generation: 0,
        history: [],
        model: {
          version: 1,
          weights: Array.from(
            { length: M.parameterCount },
            () => (R.random(rng) - 0.5) * 0.65,
          ),
          settings: { ...M.defaults },
        },
      };
  if (!state.generation) {
    const data = await batch("collect", fixtures(1000000, 70), null);
    fit(state.model, data, 8, rng, 0.003);
    state.samples = data.length;
    state.generation = 1;
    state.history.push(structuredClone(state.model));
    save(checkpoint, state);
    console.log("Imitation samples:", data.length);
  }
  const stop = resume ? state.generation + 2 : 3;
  while (state.generation < stop) {
    const data = await batch(
      "collect",
      fixtures(2000000 + state.generation * 10000, 70),
      state.model,
      state.history,
    );
    fit(state.model, data, 2, random(4500 + state.generation), 0.00035);
    state.samples += data.length;
    state.generation++;
    state.history.push(structuredClone(state.model));
    state.history = state.history.slice(-4);
    save(checkpoint, state);
    console.log(
      "Completed generation",
      state.generation,
      "with",
      data.length,
      "decisions",
    );
  }
}

const comparisons = [
  [1, 0],
  [2, 1],
  [2, 3],
];
function summarize(data) {
  return comparisons.map(([a, b]) => {
    const differences = data.map(({ wins }) => wins[a] - wins[b]);
    const n = differences.length;
    const difference = differences.reduce((sum, v) => sum + v, 0) / n;
    const variance =
      differences.reduce((sum, v) => sum + (v - difference) ** 2, 0) / (n - 1);
    const margin = 1.96 * Math.sqrt(variance / n);
    return {
      n,
      difference,
      lower: difference - margin,
      upper: difference + margin,
    };
  });
}
function groups(data) {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      i + 2,
      summarize(data.filter((row) => row.count === i + 2)),
    ]),
  );
}
async function evaluate(tuning) {
  const state = load(checkpoint);
  const model = state.model;
  if (tuning && process.argv[3])
    Object.assign(model.settings, JSON.parse(process.argv[3]));
  assert(M.valid(model), "Invalid model");
  const start = tuning ? 6000000 : 9000000;
  const games = tuning ? Number(process.argv[4] || 144) : 480;
  const modes = ["easy", "normal", "hard", "legacy"];
  const data = await batch(modes, fixtures(start, games), model);
  const overall = summarize(data);
  const byPlayers = groups(data);
  const passed =
    overall.every((item) => item.lower > 0) &&
    Object.values(byPlayers).every((items) =>
      items.every((item) => item.difference >= 0),
    );
  const report = {
    modes,
    start,
    gamesPerCount: games,
    overall,
    byPlayers,
    passed,
    generation: state.generation,
    samples: state.samples,
    modelHash: digest(model),
    settings: model.settings,
    sources: sources(),
  };
  if (!tuning) save(result, report);
  console.log(JSON.stringify(report, null, 2));
  if (!passed && !tuning) process.exitCode = 1;
}

function exportModel() {
  const { model } = load(checkpoint);
  const report = load(result);
  assert(
    report.passed && M.valid(model) && report.modelHash === digest(model),
    "A passing evaluation for the current weights is required",
  );
  assert.deepEqual(
    report.sources,
    sources(),
    "Reevaluate against the current source",
  );
  const modelFile = path.join(root, "assets/js/games/uno-weights.js");
  fs.writeFileSync(
    modelFile,
    '"use strict";\nWorkTimeApp.games.unoWeights = ' +
      JSON.stringify(model) +
      ";\n",
  );
  save(path.join(__dirname, "evaluation.json"), {
    ...report,
    assetHash: sha(fs.readFileSync(modelFile)),
  });
}

if (isMainThread) {
  const command = process.argv[2];
  Promise.resolve()
    .then(() => {
      switch (command) {
        case "train":
          return train(false);
        case "resume":
          return train(true);
        case "evaluate":
          return evaluate(false);
        case "tune":
          return evaluate(true);
        case "configure": {
          const state = load(checkpoint);
          Object.assign(state.model.settings, JSON.parse(process.argv[3]));
          assert(M.valid(state.model), "Invalid model settings");
          return save(checkpoint, state);
        }
        case "export":
          return exportModel();
        default:
          throw Error("Use train, resume, tune, evaluate or export");
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
