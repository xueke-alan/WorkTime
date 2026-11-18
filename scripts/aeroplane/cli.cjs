"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const root = path.resolve(__dirname, "../..");
const scope = { WorkTimeApp: { games: {} }, performance };
vm.createContext(scope);
for (const name of ["rules", "ai"])
  vm.runInContext(
    fs.readFileSync(
      path.join(root, `assets/js/games/aeroplane-${name}.js`),
      "utf8",
    ),
    scope,
  );
const R = scope.WorkTimeApp.games.aeroplaneRules,
  A = scope.WorkTimeApp.games.aeroplaneAi;
const cache = path.join(root, ".cache/aeroplane-training");
const modelPath = path.join(cache, "candidate.json");
const vendor = path.join(root, "assets/vendor/aeroplane");
const expert = [0, 6, 22, 35, 3, 18, -25, 12, 8, 6, 10, 150, 2, -6];
const clone = (v) => JSON.parse(JSON.stringify(v));
function play(
  model,
  seed,
  seat = 0,
  opponent = null,
  difficulty = "easy",
  rounds = null,
) {
  const rng = R.random(seed);
  let s = R.create(),
    steps = 0;
  while (s.phase !== "won" && steps++ < 12000) {
    if (s.phase === "roll") s = R.roll(s, 1 + Math.floor(rng() * 6));
    if (s.phase === "move") {
      let a;
      if (s.turn === seat)
        a = A.choose(
          s,
          model,
          difficulty,
          (seed + steps * 991) >>> 0,
          rounds === null ? { budget: 1e9 } : { rounds, budget: 1e9 },
        );
      else if (opponent === "random") {
        const legal = R.legal(s);
        a = legal[Math.floor(rng() * legal.length)];
      } else if (opponent) a = A.rank(s, opponent)[0].a;
      else a = A.baseline(s);
      s = R.move(s, a).state;
    }
  }
  if (s.phase !== "won") throw Error("Non-terminating evaluation game");
  const progress = (p) =>
    s.pieces
      .slice(p * 4, p * 4 + 4)
      .reduce((v, n) => v + (n === R.END ? 100 : Math.max(0, n + 3)), 0);
  return {
    win: s.winner === seat ? 1 : 0,
    reward:
      (s.winner === seat ? 1 : 0) +
      0.001 *
        (progress(seat) -
          Math.max(...[0, 1, 2, 3].filter((p) => p !== seat).map(progress))),
    steps,
  };
}
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
function bootstrap() {
  const rng = R.random(81621),
    samples = [];
  let s = R.create();
  for (let i = 0; i < 30000; i++) {
    if (s.phase === "won") s = R.create();
    if (s.phase === "roll") s = R.roll(s, 1 + Math.floor(rng() * 6));
    if (s.phase !== "move") continue;
    const legal = R.legal(s);
    for (const a of legal) {
      const x = A.features(s, a);
      // A short stochastic search provides supervised action-value targets.
      let future = 0;
      for (let d = 1; d <= 6; d++) {
        let next = R.move(s, a).state;
        if (next.phase !== "won") {
          next = { ...next, turn: s.turn, phase: "roll", die: 0 };
          next = R.roll(next, d);
          if (next.phase === "move")
            future +=
              Math.max(
                ...R.legal(next).map((b) => A.dot(expert, A.features(next, b))),
              ) / 6;
        }
      }
      samples.push({ x, y: A.dot(expert, x) + 0.12 * future });
    }
    s = R.move(s, legal[Math.floor(rng() * legal.length)]).state;
  }
  const policy = Array(A.FEATURES).fill(0);
  for (let epoch = 0; epoch < 14; epoch++)
    for (const sample of samples) {
      const error = Math.max(
        -100,
        Math.min(100, A.dot(policy, sample.x) - sample.y),
      );
      for (let j = 0; j < policy.length; j++)
        policy[j] -= 0.006 * (error * sample.x[j] + 0.0005 * policy[j]);
    }
  return {
    format: 1,
    rules: R.VERSION,
    features: A.FEATURES,
    policy,
    value: Array(A.FEATURES).fill(0),
    training: {
      seed: 81621,
      samples: samples.length,
      method: "search distillation + evolutionary self-play",
      generations: 0,
    },
  };
}
async function train(resume = false) {
  let model = resume ? JSON.parse(fs.readFileSync(modelPath)) : bootstrap();
  if (model.rules !== R.VERSION)
    throw Error(
      "Checkpoint rules differ; run train to create a compatible candidate",
    );
  if (
    resume &&
    model.training.generations === 12 &&
    model.training.valueSamples
  ) {
    process.stdout.write("Training checkpoint is already complete.\n");
    return;
  }
  const checkpointPath = path.join(cache, "checkpoint.json");
  const checkpoint =
    resume && fs.existsSync(checkpointPath)
      ? JSON.parse(fs.readFileSync(checkpointPath))
      : null;
  const history =
      checkpoint?.generation === model.training.generations
        ? checkpoint.history
        : [clone(model)],
    rng = R.random(91341 + model.training.generations);
  for (let gen = model.training.generations; gen < 12; gen++) {
    const population = [clone(model)];
    for (let i = 1; i < 20; i++) {
      const next = clone(model);
      next.policy = next.policy.map(
        (v, j) =>
          v +
          (j === 0 ? 0 : (rng() + rng() + rng() - 1.5) * (j === 11 ? 8 : 5)),
      );
      population.push(next);
    }
    const scores = population.map((candidate) => {
      let total = 0;
      for (let n = 0; n < 64; n++) {
        const opponent =
          n % 2 === 0 ? null : history[Math.floor(n / 2) % history.length];
        total += play(
          candidate,
          200000 + gen * 1000 + n,
          n % 4,
          opponent,
          "training",
        ).reward;
      }
      return total / 64;
    });
    const elite = population
      .map((m, i) => ({ m, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    model = clone(elite[0].m);
    // The value head is fitted from actual self-play outcomes below.
    model.training.generations = gen + 1;
    model.training.games = (gen + 1) * 20 * 64;
    history.push(clone(model));
    if (history.length > 5) history.shift();
    save(modelPath, model);
    save(checkpointPath, { generation: model.training.generations, history });
    save(path.join(cache, "training.json"), {
      ...model.training,
      latestReward: elite[0].score,
    });
    process.stdout.write(
      `generation ${gen + 1}/12 reward ${elite[0].score.toFixed(3)}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Learn a bounded action-value correction from terminal self-play returns.
  const rngValue = R.random(318221),
    records = [];
  for (let g = 0; g < 600; g++) {
    let s = R.create();
    const trajectory = [];
    while (s.phase !== "won") {
      if (s.phase === "roll") s = R.roll(s, 1 + Math.floor(rngValue() * 6));
      if (s.phase === "move") {
        const ranked = A.rank(s, model),
          a =
            rngValue() < 0.12
              ? ranked[Math.floor(rngValue() * ranked.length)].a
              : ranked[0].a;
        trajectory.push({ p: s.turn, x: A.features(s, a) });
        s = R.move(s, a).state;
      }
    }
    for (const t of trajectory)
      records.push({ x: t.x, y: t.p === s.winner ? 0.75 : -0.25 });
  }
  for (let e = 0; e < 4; e++)
    for (const t of records) {
      const value = Math.tanh(A.dot(model.value, t.x)),
        error = (value - t.y) * (1 - value * value);
      for (let j = 0; j < A.FEATURES; j++)
        model.value[j] -= 0.0003 * (error * t.x[j] + 0.01 * model.value[j]);
    }
  model.training.valueSamples = records.length;
  save(modelPath, model);
  process.stdout.write("Candidate trained. Run evaluate before export.\n");
}
function wilson(w, n) {
  const z = 1.959963984540054,
    p = w / n,
    d = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / d,
    margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    wins: w,
    games: n,
    rate: p,
    low: center - margin,
    high: center + margin,
  };
}
async function evaluate() {
  const model = JSON.parse(fs.readFileSync(modelPath));
  const cases = [
    { name: "random", opponent: "random", difficulty: "normal" },
    { name: "baseline", opponent: null, difficulty: "normal" },
    { name: "hard", opponent: null, difficulty: "hard" },
    { name: "ablation", opponent: null, difficulty: "normal", ablate: true },
  ];
  const report = {
    modelHash: crypto
      .createHash("sha256")
      .update(fs.readFileSync(modelPath))
      .digest("hex"),
    seedRange: [9300000, 9301999],
    sources: sourceHashes(),
    protocol:
      "Four-seat rotation, identical seeded dice streams within each paired comparison; fixed node limits, no wall-clock cutoff during evaluation",
    inference: {
      easy: { rounds: 0, temperature: 4 },
      normal: { rounds: 2, temperature: 0.7 },
      hard: { rounds: 16, temperature: 0 },
      rolloutDice: 12,
    },
    cases: {},
  };
  for (const test of cases) {
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        (_, i) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
              workerData: { test, model, start: i * 250, count: 250 },
            });
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", (code) => {
              if (code) reject(Error("Evaluation worker exited " + code));
            });
          }),
      ),
    );
    for (const result of results)
      if (JSON.stringify(result.sources) !== JSON.stringify(report.sources))
        throw Error("Rules or inference changed during evaluation");
    const wins = results.flatMap((result) => result.wins);
    report.cases[test.name] = {
      ...wilson(
        wins.reduce((n, w) => n + w, 0),
        wins.length,
      ),
      outcomes: wins,
    };
    save(path.join(cache, "evaluation.json"), report);
    process.stdout.write(
      `${test.name}: ${report.cases[test.name].rate.toFixed(4)}\n`,
    );
  }
  report.cases.normal = clone(report.cases.baseline);
  const paired = (a, b) => {
    const deltas = a.map((n, i) => n - b[i]),
      mean = deltas.reduce((n, d) => n + d, 0) / deltas.length,
      variance =
        deltas.reduce((n, d) => n + (d - mean) ** 2, 0) / (deltas.length - 1);
    return {
      difference: mean,
      low: mean - 1.96 * Math.sqrt(variance / deltas.length),
      high: mean + 1.96 * Math.sqrt(variance / deltas.length),
    };
  };
  report.hardVsNormal = paired(
    report.cases.hard.outcomes,
    report.cases.normal.outcomes,
  );
  report.modelVsAblation = paired(
    report.cases.normal.outcomes,
    report.cases.ablation.outcomes,
  );
  report.passed =
    report.cases.baseline.low > 0.25 &&
    report.hardVsNormal.low > 0 &&
    report.modelVsAblation.low > 0;
  save(path.join(cache, "evaluation.json"), report);
  process.stdout.write(
    JSON.stringify({
      passed: report.passed,
      hardVsNormal: report.hardVsNormal,
      modelVsAblation: report.modelVsAblation,
    }) + "\n",
  );
}
function exportModel() {
  const report = JSON.parse(
    fs.readFileSync(path.join(cache, "evaluation.json")),
  );
  const source = fs.readFileSync(modelPath),
    hash = crypto.createHash("sha256").update(source).digest("hex");
  if (
    !report.passed ||
    hash !== report.modelHash ||
    JSON.stringify(report.sources) !== JSON.stringify(sourceHashes())
  )
    throw Error("Frozen model has not passed evaluation");
  const model = JSON.parse(source);
  model.release = { version: "2.0.1", evaluatedHash: hash };
  fs.mkdirSync(vendor, { recursive: true });
  const body = JSON.stringify(model);
  const modelHash = crypto.createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(
    path.join(vendor, "model.js"),
    `"use strict";\nWorkTimeApp.games.aeroplaneModel=${body};\n`,
  );
  const manifest = {
    format: 1,
    rules: R.VERSION,
    model: "model.js",
    payloadHash: modelHash,
    source: "Locally trained for WorkTime; no third-party weights",
    training: model.training,
  };
  save(path.join(vendor, "manifest.json"), manifest);
  fs.writeFileSync(
    path.join(vendor, "manifest.js"),
    `"use strict";\nWorkTimeApp.games.aeroplaneManifest=${JSON.stringify(manifest)};\n`,
  );
  const compact = clone(report);
  for (const test of Object.values(compact.cases)) delete test.outcomes;
  save(path.join(vendor, "evaluation.json"), compact);
}
function sourceHashes() {
  return Object.fromEntries(
    ["rules", "ai"].map((name) => [
      name,
      crypto
        .createHash("sha256")
        .update(
          fs
            .readFileSync(
              path.join(root, `assets/js/games/aeroplane-${name}.js`),
              "utf8",
            )
            .replace(/\r\n?/g, "\n"),
        )
        .digest("hex"),
    ]),
  );
}
if (!isMainThread) {
  const { test, model, start, count } = workerData;
  const candidate = test.ablate
    ? {
        ...model,
        policy: Array(A.FEATURES).fill(0),
        value: Array(A.FEATURES).fill(0),
      }
    : model;
  const wins = [];
  for (let i = start; i < start + count; i++)
    wins.push(
      play(candidate, 9300000 + i, i % 4, test.opponent, test.difficulty).win,
    );
  parentPort.postMessage({ wins, sources: sourceHashes() });
} else if (require.main === module) {
  const command = process.argv[2] || "help";
  Promise.resolve(
    command === "train"
      ? train()
      : command === "resume"
        ? train(true)
        : command === "evaluate"
          ? evaluate()
          : command === "export"
            ? exportModel()
            : process.stdout.write("train | resume | evaluate | export\n"),
  ).catch((e) => {
    process.stderr.write(e.stack + "\n");
    process.exitCode = 1;
  });
}
module.exports = { R, A, play, wilson, bootstrap };
