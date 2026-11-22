"use strict";
/** Exhaust each source component, then multi-source BFS from every escape state.
 * One graph edge is every reachable translation of ONE block, including turns.
 * This solver is development-only and deliberately independent of runtime rules.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const source = require("./source.json");
const additionalSource = require("./classics-extra.json");
const namedSource = require("./fayaa-named.json");
const displayNames = require("./display-names.json");
const toTraditional = require("opencc-js").Converter({ from: "cn", to: "tw" });
const bands = [
  [1, 10],
  [11, 20],
  [21, 40],
  [41, 60],
  [61, 80],
  [81, 1000],
];
const encode = (positions) =>
  String.fromCharCode(...positions.map((p) => 65 + p));
const decode = (key) => Array.from(key, (c) => c.charCodeAt(0) - 65);
function canonical(pieces) {
  return pieces
    .map((p) => [...p])
    .sort((a, b) => b[0] * b[1] - a[0] * a[1] || a[0] - b[0] || a[2] - b[2]);
}
const fixtures = source.map((s, index) => {
  const pieces = canonical(
    s.blocks.map(({ shape: [h, w], position: [y, x] }) => [w, h, x + 4 * y]),
  );
  return {
    index,
    name: s.name,
    pieces,
    type: pieces.map((p) => p.slice(0, 2).join("x")).join(","),
    key: encode(pieces.map((p) => p[2])),
  };
});
const extraFixtures = [
  ...additionalSource.entries,
  ...namedSource.entries.map((s) => ({ ...s, collection: "fayaa" })),
].map((s, i) => {
  const pieces = canonical(s.pieces);
  return {
    index: source.length + i,
    name: s.name,
    collection: s.collection,
    pieces,
    type: pieces.map((p) => p.slice(0, 2).join("x")).join(","),
    key: encode(pieces.map((p) => p[2])),
  };
});
function geometry(pieces) {
  const masks = pieces.map(([w, h]) =>
    Array.from({ length: 20 }, (_, p) => {
      if ((p % 4) + w > 4 || Math.floor(p / 4) + h > 5) return 0;
      let mask = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) mask |= 1 << (p + x + y * 4);
      return mask;
    }),
  );
  const groups = [];
  pieces.forEach(([w, h], i) => {
    if (i === 0 || w !== pieces[i - 1][0] || h !== pieces[i - 1][1])
      groups.push([]);
    groups.at(-1).push(i);
  });
  function keyFor(positions) {
    const sorted = groups.flatMap((g) =>
      g.map((i) => positions[i]).sort((a, b) => a - b),
    );
    return encode(sorted);
  }
  const mirror = (positions) =>
    keyFor(positions.map((p, i) => p - (p % 4) + 4 - pieces[i][0] - (p % 4)));
  function neighbors(key, routes = false) {
    const positions = decode(key);
    const occupied = positions.reduce((m, p, i) => m | masks[i][p], 0);
    const out = [];
    positions.forEach((p, piece) => {
      const blockers = occupied ^ masks[piece][p];
      const visited = new Set([p]),
        queue = [[p, ""]];
      for (let head = 0; head < queue.length; head++) {
        const [anchor, route] = queue[head];
        for (const [d, offset] of [
          ["l", -1],
          ["r", 1],
          ["u", -4],
          ["d", 4],
        ]) {
          const next = anchor + offset;
          if (
            next < 0 ||
            next >= 20 ||
            (d === "l" && anchor % 4 === 0) ||
            (d === "r" && anchor % 4 === 3) ||
            visited.has(next) ||
            !masks[piece][next] ||
            blockers & masks[piece][next]
          )
            continue;
          visited.add(next);
          const nextRoute = routes ? route + d : "";
          queue.push([next, nextRoute]);
          const moved = [...positions];
          moved[piece] = next;
          out.push({ key: keyFor(moved), piece, route: nextRoute, to: next });
        }
      }
    });
    return out;
  }
  return { masks, mirror, neighbors };
}
function graph(seed) {
  const geo = geometry(seed.pieces),
    keys = [seed.key],
    indices = new Map([[seed.key, 0]]),
    edges = [];
  for (let head = 0; head < keys.length; head++) {
    edges.push(
      geo.neighbors(keys[head]).map(({ key }) => {
        if (!indices.has(key)) {
          indices.set(key, keys.length);
          keys.push(key);
        }
        return indices.get(key);
      }),
    );
  }
  const distance = new Int16Array(keys.length).fill(-1),
    queue = [];
  keys.forEach((key, i) => {
    if (key.charCodeAt(0) - 65 === 13) {
      distance[i] = 0;
      queue.push(i);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const next of edges[i])
      if (distance[next] === -1) {
        distance[next] = distance[i] + 1;
        queue.push(next);
      }
  }
  return { ...geo, keys, indices, distance };
}
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function run({ check = process.argv.includes("--check") } = {}) {
  const buckets = new Map(),
    classics = new Map(),
    additionalClassics = new Map(),
    seenComponents = new Map(),
    stats = [],
    rejected = [],
    excludedNamed = [];
  for (const seed of [...fixtures, ...extraFixtures]) {
    if (seenComponents.get(seed.type)?.has(seed.key)) continue;
    const g = graph(seed);
    const seen = seenComponents.get(seed.type) || new Set();
    for (const key of g.keys) seen.add(key);
    seenComponents.set(seed.type, seen);
    stats.push({
      sourceIndex: seed.index,
      states: g.keys.length,
      maximum: Math.max(...g.distance),
    });
    console.log(
      `Component ${seed.index}: ${g.keys.length} states, max ${stats.at(-1).maximum}`,
    );
    function entry(key, minimum, fixture) {
      const positions = decode(key),
        pieces = seed.pieces.map(([w, h], i) => [w, h, positions[i]]);
      const identity = seed.type + ":" + [key, g.mirror(positions)].sort()[0];
      return {
        identity,
        id: "kl-" + hash(identity).slice(0, 16),
        pieces,
        minimum,
        ...(fixture
          ? {
              classic: fixture.index,
              title: fixture.name,
              ...(fixture.collection ? { collection: fixture.collection } : {}),
            }
          : {}),
        key,
      };
    }
    for (const fixture of fixtures.filter(
      (s) => s.type === seed.type && g.indices.has(s.key),
    )) {
      const minimum = g.distance[g.indices.get(fixture.key)];
      if (minimum < 1) {
        rejected.push(fixture.index);
        continue;
      }
      const e = entry(fixture.key, minimum, fixture);
      if (!classics.has(e.identity)) classics.set(e.identity, e);
    }
    for (const fixture of extraFixtures.filter(
      (s) => s.type === seed.type && g.indices.has(s.key),
    )) {
      const minimum = g.distance[g.indices.get(fixture.key)];
      if (minimum < 2) {
        if (!fixture.collection)
          throw Error("Invalid additional classic " + fixture.name);
        excludedNamed.push({
          index: fixture.index,
          reason: minimum < 0 ? "unsolvable" : "trivial",
        });
        continue;
      }
      const e = entry(fixture.key, minimum, fixture);
      if (classics.has(e.identity) || additionalClassics.has(e.identity))
        throw Error("Duplicate additional classic " + fixture.name);
      additionalClassics.set(e.identity, e);
    }
    // Keep a deterministic, diverse small reservoir for each exact distance.
    for (let i = 0; seed.index < source.length && i < g.keys.length; i++) {
      const minimum = g.distance[i];
      if (minimum < 1) continue;
      const e = entry(g.keys[i], minimum);
      const bucket = buckets.get(minimum) || new Map();
      if (bucket.size < 16 || e.id < [...bucket.keys()].sort().at(-1)) {
        bucket.set(e.id, e);
        if (bucket.size > 16) bucket.delete([...bucket.keys()].sort().at(-1));
      }
      buckets.set(minimum, bucket);
    }
    // Certificates retain physical identities even though graph keys sort equal shapes.
    const candidates = [
      ...classics.values(),
      ...additionalClassics.values(),
      ...[...buckets.values()].flatMap((b) => [...b.values()]),
    ].filter(
      (e) =>
        e.identity.startsWith(seed.type + ":") &&
        g.indices.has(e.key) &&
        !e.solution,
    );
    for (const e of candidates) {
      let current = e.key;
      const physical = e.pieces.map((p) => p[2]),
        solution = [];
      for (let remaining = e.minimum; remaining > 0; remaining--) {
        const n = g
          .neighbors(current, true)
          .find((n) => g.distance[g.indices.get(n.key)] === remaining - 1);
        if (!n) throw Error("Missing descending edge");
        const canonicalPosition = decode(current)[n.piece],
          shape = seed.pieces[n.piece];
        const piece = physical.findIndex(
          (p, i) =>
            p === canonicalPosition &&
            e.pieces[i][0] === shape[0] &&
            e.pieces[i][1] === shape[1],
        );
        solution.push({ piece, route: n.route });
        physical[piece] = n.to;
        current = n.key;
      }
      e.solution = solution;
    }
  }
  const selected = [],
    used = new Set();
  bands.forEach(([lo, hi], chapter) => {
    const group = [...classics.values()].filter(
      (e) => e.minimum >= lo && e.minimum <= hi,
    );
    for (const e of group) used.add(e.identity);
    const pool = [...buckets.entries()]
      .filter(([n]) => n >= lo && n <= hi)
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => [...b.values()].sort((a, b) => a.id.localeCompare(b.id)));
    for (let round = 0; group.length < 50; round++) {
      let added = false;
      for (const bucket of pool) {
        const e = bucket[round];
        if (e && !used.has(e.identity) && group.length < 50) {
          group.push(e);
          used.add(e.identity);
          added = true;
        }
      }
      if (!added && round >= 16)
        throw Error(`Not enough distinct levels for chapter ${chapter}`);
    }
    group.sort((a, b) => a.minimum - b.minimum || a.id.localeCompare(b.id));
    selected.push(...group.map((e) => ({ ...e, chapter })));
  });
  if (classics.size !== selected.filter((e) => e.classic !== undefined).length)
    throw Error("Classic omitted");
  const classic = selected.find((e) => e.classic === 0);
  if (classic.minimum !== 81)
    throw Error("Traditional move metric must produce 81");
  // Keep all other original layouts stable, and retain removed IDs for saves.
  const retired = selected
    .filter((e) => e.minimum === 1)
    .map((e) => ({ ...e, reason: "one-move" }));
  const active = selected.filter((e) => e.minimum > 1);
  const replacements = [...buckets.entries()]
    .filter(([minimum]) => minimum >= 2 && minimum <= 10)
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) =>
      [...bucket.values()].sort((a, b) => a.id.localeCompare(b.id)),
    );
  for (let round = 0; active.length < 300; round++) {
    if (round >= 16) throw Error("Insufficient nontrivial replacement layouts");
    for (const bucket of replacements) {
      const e = bucket[round];
      if (e && !used.has(e.identity) && active.length < 300) {
        active.push({ ...e, chapter: 0 });
        used.add(e.identity);
      }
    }
  }
  if (additionalClassics.size + excludedNamed.length !== extraFixtures.length)
    throw Error("Additional classic outside verified components");
  const baselineIds = new Set(active.map((l) => l.id));
  const candidatesByPriority = [...additionalClassics.values()].sort(
    (a, b) =>
      Number(a.collection === "fayaa") - Number(b.collection === "fayaa") ||
      (a.collection === "fayaa"
        ? Number(!baselineIds.has(a.id)) - Number(!baselineIds.has(b.id))
        : 0) ||
      a.classic - b.classic,
  );
  const unselectedNamed = [];
  for (const e of candidatesByPriority) {
    const chapter = bands.findIndex(
      ([lo, hi]) => e.minimum >= lo && e.minimum <= hi,
    );
    const existing = active.find((l) => l.id === e.id);
    if (existing) {
      existing.classic = e.classic;
      if (e.collection) existing.collection = e.collection;
      continue;
    }
    const replacement = active
      .filter((l) => l.chapter === chapter && l.classic === undefined)
      .sort(
        (a, b) =>
          Math.abs(a.minimum - e.minimum) - Math.abs(b.minimum - e.minimum) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!replacement) {
      if (!e.collection)
        throw Error("No ordinary layout available for " + e.title);
      unselectedNamed.push({ index: e.classic, minimum: e.minimum, chapter });
      continue;
    }
    // Reuse an older orientation if a previously retired board is named now.
    const restoredIndex = retired.findIndex((l) => l.id === e.id);
    const restored =
      restoredIndex < 0 ? null : retired.splice(restoredIndex, 1)[0];
    if (restored && restored.minimum !== e.minimum)
      throw Error("Retired distance mismatch");
    retired.push({ ...replacement, reason: "classic-replacement" });
    active.splice(active.indexOf(replacement), 1, {
      ...(restored || e),
      classic: e.classic,
      ...(e.collection ? { collection: e.collection } : {}),
      chapter,
    });
  }
  active.sort(
    (a, b) =>
      a.chapter - b.chapter ||
      a.minimum - b.minimum ||
      a.id.localeCompare(b.id),
  );
  const runtime = active.map(
    ({ id, pieces, chapter, classic, collection }, index) => ({
      id,
      pieces,
      difficulty: chapter,
      chapter: chapter * 2 + Math.floor((index % 50) / 25),
      ...(classic === undefined ? {} : { classic }),
      ...(collection ? { collection } : {}),
    }),
  );
  const certificates = {
    sourceSha256: hash(fs.readFileSync(path.join(__dirname, "source.json"))),
    additionalSourceSha256: hash(
      fs.readFileSync(path.join(__dirname, "classics-extra.json")),
    ),
    namedSourceSha256: hash(
      fs.readFileSync(path.join(__dirname, "fayaa-named.json")),
    ),
    displayNamesSha256: hash(
      fs.readFileSync(path.join(__dirname, "display-names.json")),
    ),
    components: stats,
    rejected,
    excludedNamed,
    unselectedNamed,
    namedAvailableByDifficulty: bands.map(
      ([lo, hi]) =>
        [...classics.values(), ...additionalClassics.values()].filter(
          (l) => l.minimum >= lo && l.minimum <= hi,
        ).length,
    ),
    namedSelectedByDifficulty: bands.map(
      (_, i) =>
        active.filter((l) => l.chapter === i && l.classic !== undefined).length,
    ),
    levels: active.map(({ id, minimum, solution }) => ({
      id,
      minimum,
      solution,
    })),
    retiredLevels: retired.map(({ id, minimum, solution, reason }) => ({
      id,
      minimum,
      solution,
      reason,
    })),
  };
  const namedTitles = namedSource.entries.map((s, i) => {
    const fixture = extraFixtures[additionalSource.entries.length + i];
    const identity =
      fixture.type +
      ":" +
      [
        fixture.key,
        geometry(fixture.pieces).mirror(decode(fixture.key)),
      ].sort()[0];
    const id = "kl-" + hash(identity).slice(0, 16);
    const override = displayNames[id];
    if (
      override &&
      (!override.reason ||
        [...override.name].length > 5 ||
        !override.name.trim())
    )
      throw Error("Invalid short title for " + id);
    return [
      source.length + additionalSource.entries.length + i,
      override?.name || s.name,
      override ? toTraditional(override.name) : s.sourceName,
      s.sourceLevel,
    ];
  });
  const outputs = [
    [
      "assets/data/klotski-names.js",
      '"use strict";\n// Generated by scripts/klotski/build.cjs; display names with original titles retained in source snapshots.\nWorkTimeApp.data.klotskiNamedTitles = ' +
        JSON.stringify(namedTitles, null, 2) +
        ";\n",
    ],
    [
      "assets/data/klotski.js",
      '"use strict";\n// Generated by scripts/klotski/build.cjs. No solutions or minimum counts are shipped.\nWorkTimeApp.data.klotski = ' +
        JSON.stringify(runtime, null, 2) +
        ";\nWorkTimeApp.data.klotskiRetired = " +
        JSON.stringify(
          retired.map(({ id, pieces, chapter, reason }) => ({
            id,
            pieces,
            chapter,
            reason,
          })),
          null,
          2,
        ) +
        ";\n",
    ],
    [
      "scripts/klotski/certificates.json",
      JSON.stringify(certificates, null, 2) + "\n",
    ],
  ];
  for (const [file, text] of outputs) {
    if (check) {
      if (fs.readFileSync(path.join(root, file), "utf8") !== text)
        throw Error("Stale " + file);
    } else fs.writeFileSync(path.join(root, file), text);
  }
  console.log(
    `Verified selection: ${active.length} levels, ${active.filter((l) => l.classic !== undefined).length} named (${active.filter((l) => l.classic !== undefined && !l.collection).length} classics); 12 groups of 25; ${retired.length} retired layouts.`,
  );
}
if (require.main === module) run();
module.exports = { geometry, canonical, encode, decode, graph, run };
