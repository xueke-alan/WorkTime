"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const dir = __dirname;
const root = path.resolve(dir, "../..");
const upstream = fs
  .readFileSync(path.join(dir, "upstream/engine.rs"), "utf8")
  .replace(/\r\n/g, "\n");
let source = upstream.replace(/^\/\/!/gm, "//");
if (
  crypto.createHash("sha256").update(upstream).digest("hex") !==
  "4cb3180ee3c620abe57bcc9bec7e5703d144adeb5fe3e0f7431fa1d3ee06def5"
)
  throw Error("Pinned upstream source hash changed");
function patch(before, after) {
  if (!source.includes(before))
    throw Error("Upstream patch no longer applies: " + before.slice(0, 80));
  source = source.replace(before, after);
}
patch(
  "struct Instant;",
  'struct Instant(f64);\n#[cfg(target_arch = "wasm32")]\n#[link(wasm_import_module = "host")]\nextern "C" { fn now() -> f64; }',
);
patch("        Instant\n", "        Instant(unsafe { now() })\n");
patch(
  "std::time::Duration::from_millis(0)",
  "std::time::Duration::from_secs_f64(((unsafe { now() } - self.0) / 1000.0).max(0.0))",
);
patch(
  "pub const PROGRESS_LIMIT: u32 = 200;",
  "pub const PROGRESS_LIMIT: u32 = 100;",
);
patch(
  "    rank_beats(role_of(attacker), role_of(target))",
  "    if trap_owner(from) == 1 - color_of(attacker) { return false; }\n    rank_beats(role_of(attacker), role_of(target))",
);
patch(
  "if budget.path.contains(&key) || budget.rep_seed.contains(&key)",
  "if budget.path.iter().chain(budget.rep_seed.iter()).filter(|&&k| k == key).count() >= 2",
);
// History and the no-capture clock affect value: do not reuse a board-only TT score.
patch(
  "    let slot = (key & TT_MASK) as usize;",
  "    let tt_key = budget.path.iter().chain(budget.rep_seed.iter()).fold(key ^ (p.progress as u64).wrapping_mul(0x9e3779b97f4a7c15), |a, k| a.wrapping_add(k.rotate_left(17)));\n    let slot = (tt_key & TT_MASK) as usize;",
);
const start = source.indexOf("fn negamax(");
const end = source.indexOf("fn quiesce(", start);
let search = source.slice(start, end);
search = search
  .replaceAll("e.key == key", "e.key == tt_key")
  .replaceAll("e.key != key", "e.key != tt_key")
  .replace("            key,", "            key: tt_key,");
search = search.replace(
  "    if depth <= 0 {",
  "    if p.progress >= PROGRESS_LIMIT { return 0; }\n    if depth <= 0 {",
);
source = source.slice(0, start) + search + source.slice(end);
// Quiescence must also resolve no-move losses and immediate den threats before stand-pat.
patch(
  "    let stand = eval(p, net, tb);",
  `    if ply >= MAX_DEPTH + 6 { return eval(p, net, tb); }
    let moves = legal_moves(p);
    if moves.is_empty() { return -(WIN - ply); }
    if p.progress >= PROGRESS_LIMIT { return 0; }
    let key = zkey(p, z, side);
    if budget.path.iter().chain(budget.rep_seed.iter()).filter(|&&k| k == key).count() >= 2 { return 0; }
    let mut enemy = *p;
    enemy.turn = 1 - p.turn;
    let threatened = legal_moves(&enemy).iter().any(|m| m.1 == opp_den(enemy.turn));
    let stand = if threatened { -INF } else { eval(p, net, tb) };`,
);
patch(
  "let mut tac: Vec<(u8, u8)> = legal_moves(p)\n        .into_iter()\n        .filter(|&m| p.squares[m.1 as usize] != 0 || m.1 == opp_den(p.turn))",
  "let mut tac: Vec<(u8, u8)> = moves\n        .into_iter()\n        .filter(|&m| threatened || p.squares[m.1 as usize] != 0 || m.1 == opp_den(p.turn))",
);
patch(
  "            -quiesce(&child, net, tb, -beta, -alpha, ply + 1, z, side, budget)",
  "            budget.path.push(key);\n            let value = -quiesce(&child, net, tb, -beta, -alpha, ply + 1, z, side, budget);\n            budget.path.pop();\n            value",
);
// No-move victory has priority over the no-capture clock.
source = source.replaceAll(
  "child.progress >= PROGRESS_LIMIT {",
  "child.progress >= PROGRESS_LIMIT && !legal_moves(&child).is_empty() {",
);
fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
fs.writeFileSync(path.join(dir, "generated/engine.rs"), source);
if (process.argv.includes("--patch-only")) process.exit(0);
execFileSync(
  "cargo",
  [
    "+1.94.0",
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
  ],
  { cwd: dir, stdio: "inherit" },
);
const wasm = fs.readFileSync(
  path.join(
    dir,
    "target/wasm32-unknown-unknown/release/worktime_misty_jungle.wasm",
  ),
);
const worker = fs.readFileSync(path.join(dir, "worker.js"), "utf8");
const metadata = {
  name: "MistyJungle",
  upstream: "https://github.com/brianhliou/misty-jungle",
  commit: "5717f7f8db386a0ec38ec73c1df58920beb32591",
  upstreamSha256: crypto.createHash("sha256").update(upstream).digest("hex"),
  wasmSha256: crypto.createHash("sha256").update(wasm).digest("hex"),
  bytes: wasm.length,
  rust: "1.94.0",
};
const output = path.join(root, "assets/vendor/misty-jungle");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, "engine.js"),
  "/*! MistyJungle MIT; licenses/misty-jungle.txt. Generated by scripts/misty-jungle/build.cjs */\nWorkTimeApp.games.mistyJungleAssets = " +
    JSON.stringify({ ...metadata, wasm: wasm.toString("base64"), worker }) +
    ";\n",
);
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
console.log("Packaged offline MistyJungle:", wasm.length, "WASM bytes");
