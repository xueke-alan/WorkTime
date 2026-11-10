//! Pure (pyo3-free) core for the vanilla Jungle / Dou Shou Qi engine. Shared verbatim by
//! the PyO3 lib (`lib.rs`) and the standalone `jungle-engine` UCI binary (which `#[path]`-
//! includes this file) — so the engine the platform spawns and the engine the Python
//! bakeoffs/parity tests drive are the SAME code (the banqi_rust / banqi-engine pattern).
//!
//! Board: 7 files (a..g = 0..6) × 9 ranks (1..9). index = (rank-1)*7 + file, range 0..62.
//! Piece code: 0 empty; 1..8 = red rat..elephant; 9..16 = black rat..elephant.
//! Roles 1..8 = rat,cat,dog,wolf,leopard,tiger,lion,elephant — the value IS the capture
//! rank (sole wrap: rat captures elephant). ★ REGIONAL CONVENTION PINNED: dog(3) < wolf(4),
//! matching mistboard/packages/game/src/variants-jungle.ts (the canonical kernel; Leiden/YMI
//! swap them — do NOT). Geometry constants below are ported byte-for-byte from that kernel.
//!
//! FEN + move contract: docs/engine/jungle-engine-build-scope-2026-06-25.md §2.

use std::collections::HashMap;

// Time source. Native targets use the real monotonic clock. On wasm32 (the in-browser
// client engine), `std::time::Instant::now()` panics — there is no monotonic clock in
// `wasm32-unknown-unknown` — so we substitute a no-op clock. The wasm shim always drives
// search by the node budget (it passes time_ms = 0), and `tick()` guards its wall-clock
// branch on `time_ms > 0`, so `elapsed()` is never consulted. Native behavior (UCI binary,
// PyO3 bindings) is unchanged.
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy)]
struct Instant;
#[cfg(target_arch = "wasm32")]
impl Instant {
    fn now() -> Self {
        Instant
    }
    fn elapsed(&self) -> std::time::Duration {
        std::time::Duration::from_millis(0)
    }
}

pub const W: usize = 7;
pub const H: usize = 9;
pub const N: usize = 63;

// Special squares (board indices), from variants-jungle.ts geometry.
pub const RED_DEN: u8 = 3; // d1
pub const BLACK_DEN: u8 = 59; // d9
pub const RED_TRAPS: [u8; 3] = [2, 4, 10]; // c1, e1, d2
pub const BLACK_TRAPS: [u8; 3] = [58, 60, 52]; // c9, e9, d8
pub const WATER: [u8; 12] = [22, 23, 25, 26, 29, 30, 32, 33, 36, 37, 39, 40];

// Role letters indexed by role 1..8 (P = leoPard so L stays Lion), per JUNGLE_ROLE_LETTER.
const ROLE_LETTERS: [u8; 8] = [b'R', b'C', b'D', b'W', b'P', b'T', b'L', b'E'];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Parsed {
    pub squares: [u8; N],
    pub turn: u8,      // 0 red, 1 black
    pub progress: u32, // plies since the last capture (no-progress draw clock)
    pub movenum: u32,
}

#[inline]
pub fn role_of(code: u8) -> u8 {
    if code == 0 {
        0
    } else {
        ((code - 1) % 8) + 1
    }
}
#[inline]
pub fn is_red(code: u8) -> bool {
    (1..=8).contains(&code)
}
/// 0 red, 1 black, 2 empty.
#[inline]
pub fn color_of(code: u8) -> u8 {
    if code == 0 {
        2
    } else if code <= 8 {
        0
    } else {
        1
    }
}
#[inline]
pub fn is_water(idx: u8) -> bool {
    WATER.contains(&idx)
}
/// 0 red owns, 1 black owns, 2 not a trap.
pub fn trap_owner(idx: u8) -> u8 {
    if RED_TRAPS.contains(&idx) {
        0
    } else if BLACK_TRAPS.contains(&idx) {
        1
    } else {
        2
    }
}

fn letter_to_code(c: u8) -> Option<u8> {
    let upper = c.to_ascii_uppercase();
    let role = ROLE_LETTERS.iter().position(|&l| l == upper)? as u8 + 1;
    Some(if c.is_ascii_uppercase() { role } else { role + 8 })
}

fn code_to_letter(code: u8) -> u8 {
    let l = ROLE_LETTERS[(role_of(code) - 1) as usize];
    if is_red(code) {
        l
    } else {
        l.to_ascii_lowercase()
    }
}

/// Canonical starting position (red to move). Red home is ranks 1–3; black is the 180° rotation.
pub fn initial() -> Parsed {
    let mut squares = [0u8; N];
    // (board index, role) for red back/middle ranks, per RED_SETUP in variants-jungle.ts.
    let red: [(usize, u8); 8] = [
        (0, 7),  // a1 lion
        (6, 6),  // g1 tiger
        (8, 3),  // b2 dog
        (12, 2), // f2 cat
        (14, 1), // a3 rat
        (16, 5), // c3 leopard
        (18, 4), // e3 wolf
        (20, 8), // g3 elephant
    ];
    for (idx, role) in red {
        squares[idx] = role;
        let file = idx % W;
        let rank = idx / W + 1;
        let ridx = (H - rank) * W + (W - 1 - file); // 180° rotation
        squares[ridx] = role + 8;
    }
    Parsed {
        squares,
        turn: 0,
        progress: 0,
        movenum: 1,
    }
}

// ── FEN: "<board> <turn> <progressClock> <moveNumber>", ranks high→low (rank 9 first) ──

pub fn to_fen(p: &Parsed) -> String {
    let mut s = String::new();
    for rank in (1..=H).rev() {
        let mut empties = 0u8;
        for file in 0..W {
            let code = p.squares[(rank - 1) * W + file];
            if code == 0 {
                empties += 1;
            } else {
                if empties > 0 {
                    s.push((b'0' + empties) as char);
                    empties = 0;
                }
                s.push(code_to_letter(code) as char);
            }
        }
        if empties > 0 {
            s.push((b'0' + empties) as char);
        }
        if rank > 1 {
            s.push('/');
        }
    }
    let turn = if p.turn == 0 { 'r' } else { 'b' };
    format!("{s} {turn} {} {}", p.progress, p.movenum)
}

/// Build a Parsed from raw square codes + side-to-move (progress/movenum default). For eval-only
/// batch helpers (eval_hand) that don't need the game clocks.
pub fn parsed_from_squares(squares: &[u8], turn: u8) -> Parsed {
    let mut sq = [0u8; N];
    sq[..N.min(squares.len())].copy_from_slice(&squares[..N.min(squares.len())]);
    Parsed { squares: sq, turn, progress: 0, movenum: 1 }
}

pub fn state_from_fen(fen: &str) -> Option<Parsed> {
    let mut it = fen.split_whitespace();
    let board = it.next()?;
    let turn = match it.next() {
        Some("b") => 1,
        _ => 0,
    };
    let progress = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let movenum = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    let mut squares = [0u8; N];
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != H {
        return None;
    }
    for (ri, rank_str) in ranks.iter().enumerate() {
        let rank = H - ri; // first chunk = rank 9
        let mut file = 0usize;
        for c in rank_str.bytes() {
            if c.is_ascii_digit() {
                file += (c - b'0') as usize;
            } else {
                let code = letter_to_code(c)?;
                if file >= W {
                    return None;
                }
                squares[(rank - 1) * W + file] = code;
                file += 1;
            }
        }
        if file != W {
            return None;
        }
    }
    Some(Parsed {
        squares,
        turn,
        progress,
        movenum,
    })
}

// ── Move encoding (UCI-ish "<from><to>", e.g. "a1b1"; a river jump is just from→to) ──

pub fn sq_to_str(idx: u8) -> String {
    let file = (idx as usize) % W;
    let rank = (idx as usize) / W + 1;
    format!("{}{}", (b'a' + file as u8) as char, rank)
}

pub fn move_to_uci(m: (u8, u8)) -> String {
    format!("{}{}", sq_to_str(m.0), sq_to_str(m.1))
}

pub fn uci_to_move(s: &str) -> Option<(u8, u8)> {
    let b = s.as_bytes();
    if b.len() != 4 {
        return None;
    }
    let sq = |f: u8, r: u8| -> Option<u8> {
        if !(b'a'..=b'g').contains(&f) || !(b'1'..=b'9').contains(&r) {
            return None;
        }
        Some(((r - b'1') as usize * W + (f - b'a') as usize) as u8)
    };
    Some((sq(b[0], b[1])?, sq(b[2], b[3])?))
}

// ── Capture resolution (rank + rat↔elephant wrap + trap rank-0 + water isolation) ──

/// Pure rank rule with the rat↔elephant wrap (no board context). attacker/target are roles 1..8.
pub fn rank_beats(attacker: u8, target: u8) -> bool {
    if attacker == 1 && target == 8 {
        return true; // rat captures elephant
    }
    if attacker == 8 && target == 1 {
        return false; // elephant never captures rat
    }
    attacker >= target
}

/// Can the piece on `from` capture the enemy on `to`? Layers water-isolation + trap rank-0
/// onto rank_beats. Assumes attacker/target are enemies (caller checks colour).
pub fn can_capture(attacker: u8, from: u8, target: u8, to: u8) -> bool {
    if is_water(from) != is_water(to) {
        return false; // cross-boundary (land ↔ water) capture forbidden, incl. the rat wrap
    }
    if trap_owner(to) == color_of(attacker) {
        return true; // target sits on the attacker's trap → rank 0
    }
    rank_beats(role_of(attacker), role_of(target))
}

// ── Movegen (ported from getJungleLegalMovesFrom in variants-jungle.ts) ──────

fn try_land(p: &Parsed, from: u8, to: u8, out: &mut Vec<(u8, u8)>) {
    let code = p.squares[from as usize];
    let me = color_of(code);
    let own_den = if me == 0 { RED_DEN } else { BLACK_DEN };
    if to == own_den {
        return; // never enter your own den
    }
    let tgt = p.squares[to as usize];
    if tgt == 0 {
        out.push((from, to));
    } else if color_of(tgt) != me && can_capture(code, from, tgt, to) {
        out.push((from, to));
    }
}

fn moves_from(p: &Parsed, from: u8, out: &mut Vec<(u8, u8)>) {
    let code = p.squares[from as usize];
    let role = role_of(code);
    let f = (from as i32) % 7;
    let r = (from as i32) / 7;

    // Orthogonal one-steps. Only the rat (role 1) may step onto water.
    for (df, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
        let (nf, nr) = (f + df, r + dr);
        if nf < 0 || nf >= 7 || nr < 0 || nr >= 9 {
            continue;
        }
        let to = (nr * 7 + nf) as u8;
        if is_water(to) && role != 1 {
            continue;
        }
        try_land(p, from, to, out);
    }

    // Lion (role 7) and Tiger (role 6) river jumps, both axes for both. The tiger was
    // vertical-only until 0.0.6 (mistboard #430): that reading exists in English Wikipedia
    // and nowhere else checked (Tencent QQ游戏, Leiden, KataGo-AnimalChess all give the
    // tiger the lion's jump), and the platform kernel changed with this.
    if role == 7 || role == 6 {
        let dirs: &[(i32, i32)] = &[(1, 0), (-1, 0), (0, 1), (0, -1)];
        for &(df, dr) in dirs {
            let (mut nf, mut nr) = (f + df, r + dr);
            if nf < 0 || nf >= 7 || nr < 0 || nr >= 9 || !is_water((nr * 7 + nf) as u8) {
                continue; // must face water
            }
            let mut blocked = false;
            while nf >= 0 && nf < 7 && nr >= 0 && nr < 9 && is_water((nr * 7 + nf) as u8) {
                if p.squares[(nr * 7 + nf) as usize] != 0 {
                    blocked = true; // a rat of either colour in the lake blocks the jump
                    break;
                }
                nf += df;
                nr += dr;
            }
            if blocked || nf < 0 || nf >= 7 || nr < 0 || nr >= 9 {
                continue;
            }
            try_land(p, from, (nr * 7 + nf) as u8, out);
        }
    }
}

/// All legal moves for the side to move.
pub fn legal_moves(p: &Parsed) -> Vec<(u8, u8)> {
    let mut out = Vec::with_capacity(32);
    for idx in 0..N {
        if color_of(p.squares[idx]) == p.turn {
            moves_from(p, idx as u8, &mut out);
        }
    }
    out
}

// ── Apply move + terminal detection (ported from applyJungleMove) ────────────

pub fn make_move(p: &Parsed, m: (u8, u8)) -> Parsed {
    let mut squares = p.squares;
    let moving = squares[m.0 as usize];
    let captured = squares[m.1 as usize];
    squares[m.0 as usize] = 0;
    squares[m.1 as usize] = moving;
    Parsed {
        squares,
        turn: 1 - p.turn,
        progress: if captured != 0 { 0 } else { p.progress + 1 },
        movenum: if p.turn == 1 { p.movenum + 1 } else { p.movenum },
    }
}

fn color_has_pieces(p: &Parsed, color: u8) -> bool {
    p.squares.iter().any(|&c| color_of(c) == color)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Playing,
    Win(u8), // colour that won
    Draw,
}

/// Status of `p_new` (the position AFTER a move that landed on `last_to`). Excludes
/// threefold repetition (history-dependent — the search tracks that via a path set);
/// covers den-entry, capture-all, stalemate (= loss for the side to move), and no-progress.
pub fn board_status(p_new: &Parsed, last_to: u8) -> Status {
    let nxt = p_new.turn; // side to move now = the mover's opponent
    let mover = 1 - nxt;
    let opp_den = if nxt == 0 { RED_DEN } else { BLACK_DEN };
    if last_to == opp_den {
        return Status::Win(mover); // mover entered the opponent's den
    }
    if !color_has_pieces(p_new, nxt) {
        return Status::Win(mover); // opponent has no pieces
    }
    if legal_moves(p_new).is_empty() {
        return Status::Win(mover); // opponent has no legal move (stalemate = loss)
    }
    if p_new.progress >= PROGRESS_LIMIT {
        return Status::Draw; // no-progress clock
    }
    Status::Playing
}

/// Status derivable from a STATIC position (no move history): den-entry (an enemy piece
/// sits on a den), capture-all, stalemate (side-to-move has no move), no-progress. Used by
/// the golden-parity test, which carries the FEN per frame. Repetition is excluded (the
/// search tracks it via a path set). A "playing" position never has a piece on an enemy den.
pub fn status_of(p: &Parsed) -> Status {
    if color_of(p.squares[RED_DEN as usize]) == 1 {
        return Status::Win(1); // black entered red's den
    }
    if color_of(p.squares[BLACK_DEN as usize]) == 0 {
        return Status::Win(0); // red entered black's den
    }
    if !color_has_pieces(p, 0) {
        return Status::Win(1);
    }
    if !color_has_pieces(p, 1) {
        return Status::Win(0);
    }
    if legal_moves(p).is_empty() {
        return Status::Win(1 - p.turn); // stalemate = loss for the side to move
    }
    if p.progress >= PROGRESS_LIMIT {
        return Status::Draw;
    }
    Status::Playing
}

// ── Evaluation (P1e bootstrap: a port of evaluate() in server-jungle-engine.ts) ──
// Scaled ×2 so the *1.5 / *0.5 terms stay integer + deterministic. Material (rat boosted
// well above rank — it kills the elephant and swims) + den-distance (the win is a race to
// the enemy den; adjacency is nearly decisive) + trap vulnerability. This is a THROWAWAY
// bootstrap — strength comes from depth + quiescence now, and tablebases/learned eval later.
const VAL: [i32; 9] = [0, 65, 22, 30, 40, 50, 75, 90, 100]; // indexed by role 1..8
/// Plies without a capture that end the game a draw. 200 = 100 moves by each side.
///
/// Raised from 100 on measurement: jungle shuffles far more than chess does, because rank
/// decides every capture and pieces cannot trade freely, so long manoeuvring stretches with
/// nothing taken are normal play rather than a stalled game. Over 100 self-play games per
/// setting at a 5M-node budget, limit 100 gave 25% decisive with 14 games ending on this clock,
/// limit 200 gave 33% with 1, and limit 400 gave 33% with 0. Threefold repetition adjudicates
/// what is genuinely stuck.
///
/// This MUST match DEFAULT_JUNGLE_PROGRESS_CLOCK_LIMIT in the Mistboard platform kernel: the
/// server adjudicates the draw and the engine evaluates toward it, and a mismatch means the
/// engine scores every node past its own limit as drawn while the server plays on.
pub const PROGRESS_LIMIT: u32 = 200;

const WIN: i32 = 1_000_000;
const INF: i32 = 2_000_000;
const MAX_DEPTH: i32 = 24;
const TT_BITS: usize = 18;
const TT_SIZE: usize = 1 << TT_BITS;
const TT_MASK: u64 = (TT_SIZE as u64) - 1;

#[inline]
fn opp_den(turn: u8) -> u8 {
    if turn == 0 {
        BLACK_DEN
    } else {
        RED_DEN
    }
}

#[inline]
fn manhattan(a: u8, b: u8) -> i32 {
    let (af, ar) = ((a % 7) as i32, (a / 7) as i32);
    let (bf, br) = ((b % 7) as i32, (b / 7) as i32);
    (af - bf).abs() + (ar - br).abs()
}

// ── Learned eval (NNUE-style net trained on gensfen, loaded from exported weights) ──
pub const NET_ACC: usize = 1024;
const NET_H: usize = 64;
const NET_FEATS: usize = 1009; // 16 piece planes × 63 squares + 1 padding row
// R3 residual eval: the net predicts a tanh-bounded CORRECTION to the handcrafted eval (which
// stays exact on material/den/trap), so a fuzzy net never corrupts material. Inference:
// eval = eval_hand(p) + net_out·SCALE. Training target = clamp((search_score − eval_hand)/SCALE, ±1).
const NET_RESIDUAL_SCALE: f32 = 1000.0;

pub struct Net {
    emb: Vec<f32>, // NET_FEATS × NET_ACC (row-major)
    w1: Vec<f32>,  // NET_H × NET_ACC
    b1: Vec<f32>,  // NET_H
    w2: Vec<f32>,  // NET_H
    b2: f32,
}

impl Net {
    /// Load flat-f32-LE weights exported by lab/jungle_train_eval.py --save.
    pub fn load(path: &str) -> Option<Net> {
        let bytes = std::fs::read(path).ok()?;
        let f: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        let need = NET_FEATS * NET_ACC + NET_H * NET_ACC + NET_H + NET_H + 1;
        if f.len() < need {
            return None;
        }
        let mut o = 0;
        let mut take = |n: usize| {
            let s = f[o..o + n].to_vec();
            o += n;
            s
        };
        let emb = take(NET_FEATS * NET_ACC);
        let w1 = take(NET_H * NET_ACC);
        let b1 = take(NET_H);
        let w2 = take(NET_H);
        let b2 = take(1)[0];
        Some(Net { emb, w1, b1, w2, b2 })
    }
}

/// Learned eval from the side-to-move's view → engine score units (tanh*10000, well below WIN).
/// Features are canonicalized to stm-POV (black-to-move → 180° rot idx→62-idx + colour swap),
/// matching the training featurization.
pub fn eval_net(p: &Parsed, net: &Net) -> i32 {
    let mut acc = [0f32; NET_ACC];
    for sq in 0..N {
        let c = p.squares[sq];
        if c == 0 {
            continue;
        }
        let (code, square) = if p.turn == 0 {
            (c, sq)
        } else {
            (if c <= 8 { c + 8 } else { c - 8 }, 62 - sq)
        };
        let base = ((code as usize - 1) * 63 + square) * NET_ACC;
        for j in 0..NET_ACC {
            acc[j] += net.emb[base + j];
        }
    }
    let mut h = [0f32; NET_H];
    for i in 0..NET_H {
        let mut s = net.b1[i];
        let wb = i * NET_ACC;
        for j in 0..NET_ACC {
            s += net.w1[wb + j] * acc[j].max(0.0); // relu(acc)
        }
        h[i] = s.max(0.0); // relu
    }
    let mut out = net.b2;
    for i in 0..NET_H {
        out += net.w2[i] * h[i];
    }
    // Residual: exact handcrafted eval + learned tanh-bounded positional correction.
    eval_hand(p) + (out.tanh() * NET_RESIDUAL_SCALE) as i32
}

/// Leaf eval: EXACT tablebase value if the position's material is in `tb`, else the learned net
/// if provided, else the handcrafted bootstrap.
#[inline]
fn eval(p: &Parsed, net: Option<&Net>, tb: Option<&Store>) -> i32 {
    if let Some(store) = tb {
        if let Some(wdl) = probe_store(store, p) {
            return match wdl {
                TB_WIN => TB_SCORE,
                TB_LOSS => -TB_SCORE,
                _ => 0,
            };
        }
    }
    match net {
        Some(n) => eval_net(p, n),
        None => eval_hand(p),
    }
}

pub fn eval_hand(p: &Parsed) -> i32 {
    let me = p.turn;
    let enemy_den = opp_den(me);
    let own_den = if me == 0 { RED_DEN } else { BLACK_DEN };
    let mut s = 0i32;
    for idx in 0..N {
        let code = p.squares[idx];
        if code == 0 {
            continue;
        }
        let role = role_of(code);
        let v = VAL[role as usize];
        let friendly = color_of(code) == me;
        s += if friendly { 2 * v } else { -2 * v };
        // Advancement toward the relevant den (enemy den for ours, our den for theirs).
        let target = if friendly { enemy_den } else { own_den };
        let dist = manhattan(idx as u8, target);
        let advance = if dist <= 1 { 400 } else { (16 - dist) * 3 };
        s += if friendly { advance } else { -advance };
        // A piece on its enemy's trap is rank 0 (capturable by anything): risky for us, good
        // when it's their piece in our trap. (value*0.5*2 = v in the scaled units.)
        let tr = trap_owner(idx as u8);
        if friendly {
            if tr == 1 - me {
                s -= v;
            }
        } else if tr == me {
            s += v;
        }
    }
    s
}

// ── Zobrist + transposition table ────────────────────────────────────────────

fn build_zobrist() -> ([[u64; N]; 17], u64) {
    let mut z = [[0u64; N]; 17];
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = || {
        x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut v = x;
        v = (v ^ (v >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        v = (v ^ (v >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        v ^ (v >> 31)
    };
    for row in z.iter_mut() {
        for cell in row.iter_mut() {
            *cell = next();
        }
    }
    (z, next())
}

fn zkey(p: &Parsed, z: &[[u64; N]; 17], side: u64) -> u64 {
    let mut k = 0u64;
    for idx in 0..N {
        let c = p.squares[idx];
        if c != 0 {
            k ^= z[c as usize][idx];
        }
    }
    if p.turn == 1 {
        k ^= side;
    }
    k
}

#[derive(Clone, Copy, Default)]
struct TtEntry {
    key: u64,
    depth: i32,
    value: i32,
    flag: u8, // 0 empty, 1 exact, 2 lower bound, 3 upper bound
    mv: (u8, u8),
}

struct Budget {
    nodes: u64,
    cap: u64,
    start: Instant,
    time_ms: u128,
    aborted: bool,
    rep_seed: Vec<u64>, // zobrist keys of prior game positions (since last capture) — repetition
    path: Vec<u64>,     // zobrist keys on the current search line — repetition within search
    contempt: i32,      // draw is worth -contempt to the side to move (avoids draws when ahead/equal)
    killers: Vec<[(u8, u8); 2]>, // two killer quiet moves per ply (move ordering)
    history: Vec<i32>,           // [from*63+to] cutoff history (quiet move ordering)
    ext: bool, // Rung-1 search extensions (LMR + killers/history ordering + PVS); false = pre-Rung-1 baseline
}

impl Budget {
    fn tick(&mut self) -> bool {
        self.nodes += 1;
        // Guard the wall-clock branch on time_ms > 0 so time_ms = 0 means "node budget only"
        // (the wasm client engine passes 0; wasm has no monotonic clock — see the Instant shim).
        if self.time_ms > 0 && self.nodes & 1023 == 0 && self.start.elapsed().as_millis() >= self.time_ms {
            self.aborted = true;
        }
        if self.nodes > self.cap {
            self.aborted = true;
        }
        self.aborted
    }
}

// ── Move ordering ────────────────────────────────────────────────────────────

fn order_score(p: &Parsed, m: (u8, u8), tt_mv: Option<(u8, u8)>) -> i32 {
    if Some(m) == tt_mv {
        return 1_000_000;
    }
    if m.1 == opp_den(p.turn) {
        return 90_000; // den entry (a winning move)
    }
    let victim = p.squares[m.1 as usize];
    if victim != 0 {
        return 100 + VAL[role_of(victim) as usize]; // MVV by victim value
    }
    0
}

fn ordered_moves(p: &Parsed, tt_mv: Option<(u8, u8)>) -> Vec<(u8, u8)> {
    let mut moves = legal_moves(p);
    moves.sort_by(|&a, &b| {
        order_score(p, b, tt_mv)
            .cmp(&order_score(p, a, tt_mv))
            .then(a.cmp(&b)) // deterministic tie-break
    });
    moves
}

// Main-search ordering: TT move > den-entry > captures (MVV-LVA) > killers > quiet-by-history.
fn order_score_ext(
    p: &Parsed,
    m: (u8, u8),
    tt_mv: Option<(u8, u8)>,
    killers: &[(u8, u8); 2],
    history: &[i32],
) -> i32 {
    if Some(m) == tt_mv {
        return 2_000_000;
    }
    if m.1 == opp_den(p.turn) {
        return 1_900_000;
    }
    let victim = p.squares[m.1 as usize];
    if victim != 0 {
        return 1_000_000 + 100 * VAL[role_of(victim) as usize]
            - VAL[role_of(p.squares[m.0 as usize]) as usize]; // MVV-LVA
    }
    if m == killers[0] || m == killers[1] {
        return 900_000;
    }
    history[m.0 as usize * 63 + m.1 as usize].min(800_000) // quiet by history (capped below killers)
}

fn ordered_moves_ext(
    p: &Parsed,
    tt_mv: Option<(u8, u8)>,
    killers: &[(u8, u8); 2],
    history: &[i32],
) -> Vec<(u8, u8)> {
    let mut moves = legal_moves(p);
    moves.sort_by(|&a, &b| {
        order_score_ext(p, b, tt_mv, killers, history)
            .cmp(&order_score_ext(p, a, tt_mv, killers, history))
            .then(a.cmp(&b))
    });
    moves
}

// ── Search ───────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn negamax(
    p: &Parsed,
    net: Option<&Net>,
    tb: Option<&Store>,
    depth: i32,
    mut alpha: i32,
    beta: i32,
    ply: i32,
    z: &[[u64; N]; 17],
    side: u64,
    tt: &mut [TtEntry],
    budget: &mut Budget,
) -> i32 {
    if budget.tick() {
        return 0;
    }
    let key = zkey(p, z, side);
    if budget.path.contains(&key) || budget.rep_seed.contains(&key) {
        return -budget.contempt; // repetition → draw (negative so an ahead/equal side avoids it)
    }
    let slot = (key & TT_MASK) as usize;
    let mut tt_mv = None;
    {
        let e = &tt[slot];
        if e.flag != 0 && e.key == key {
            tt_mv = Some(e.mv);
            if e.depth >= depth {
                match e.flag {
                    1 => return e.value,
                    2 => alpha = alpha.max(e.value),
                    3 => {
                        if e.value <= alpha {
                            return e.value;
                        }
                    }
                    _ => {}
                }
                if alpha >= beta {
                    return e.value;
                }
            }
        }
    }

    let killers = budget.killers[ply as usize];
    let moves = if budget.ext {
        ordered_moves_ext(p, tt_mv, &killers, &budget.history)
    } else {
        ordered_moves(p, tt_mv)
    };
    if moves.is_empty() {
        return -(WIN - ply); // no legal move = loss for the side to move
    }
    if depth <= 0 {
        return quiesce(p, net, tb, alpha, beta, ply, z, side, budget);
    }

    let alpha_orig = alpha;
    let mut best = -INF;
    let mut best_mv = moves[0];
    budget.path.push(key);
    for (idx, m) in moves.iter().enumerate() {
        let m = *m;
        let child = make_move(p, m);
        let tactical = p.squares[m.1 as usize] != 0 || m.1 == opp_den(p.turn);
        let val = if m.1 == opp_den(p.turn) || !color_has_pieces(&child, child.turn) {
            WIN - ply // den entry or captured the opponent's last piece
        } else if child.progress >= PROGRESS_LIMIT {
            0 // no-progress draw
        } else if idx == 0 || !budget.ext {
            // Principal variation (or pre-Rung-1 baseline): full window, no reduction.
            -negamax(&child, net, tb, depth - 1, -beta, -alpha, ply + 1, z, side, tt, budget)
        } else {
            // Late-move reduction for quiet, late moves; null-window probe; re-search if it surprises.
            let red = if depth >= 3 && idx >= 3 && !tactical { 1 } else { 0 };
            let mut s = -negamax(&child, net, tb, depth - 1 - red, -alpha - 1, -alpha, ply + 1, z, side, tt, budget);
            if s > alpha && red > 0 {
                s = -negamax(&child, net, tb, depth - 1, -alpha - 1, -alpha, ply + 1, z, side, tt, budget);
            }
            if s > alpha && s < beta {
                s = -negamax(&child, net, tb, depth - 1, -beta, -alpha, ply + 1, z, side, tt, budget);
            }
            s
        };
        if budget.aborted {
            budget.path.pop();
            return 0;
        }
        if val > best {
            best = val;
            best_mv = m;
        }
        alpha = alpha.max(best);
        if alpha >= beta {
            if budget.ext && !tactical {
                // Beta cutoff by a quiet move → reward it (killers + history).
                let k = &mut budget.killers[ply as usize];
                if k[0] != m {
                    k[1] = k[0];
                    k[0] = m;
                }
                budget.history[m.0 as usize * 63 + m.1 as usize] += depth * depth;
            }
            break;
        }
    }
    budget.path.pop();

    let flag = if best <= alpha_orig {
        3
    } else if best >= beta {
        2
    } else {
        1
    };
    let e = &mut tt[slot];
    if e.flag == 0 || e.key != key || e.depth <= depth {
        *e = TtEntry {
            key,
            depth,
            value: best,
            flag,
            mv: best_mv,
        };
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn quiesce(
    p: &Parsed,
    net: Option<&Net>,
    tb: Option<&Store>,
    mut alpha: i32,
    beta: i32,
    ply: i32,
    z: &[[u64; N]; 17],
    side: u64,
    budget: &mut Budget,
) -> i32 {
    if budget.tick() {
        return 0;
    }
    let stand = eval(p, net, tb);
    if stand >= beta {
        return stand;
    }
    alpha = alpha.max(stand);
    // Tactical moves only: captures + den entries (the horizon dangers a static eval misses).
    let mut tac: Vec<(u8, u8)> = legal_moves(p)
        .into_iter()
        .filter(|&m| p.squares[m.1 as usize] != 0 || m.1 == opp_den(p.turn))
        .collect();
    tac.sort_by(|&a, &b| {
        order_score(p, b, None)
            .cmp(&order_score(p, a, None))
            .then(a.cmp(&b))
    });
    for m in &tac {
        let child = make_move(p, *m);
        let val = if m.1 == opp_den(p.turn) || !color_has_pieces(&child, child.turn) {
            WIN - ply
        } else if child.progress >= PROGRESS_LIMIT {
            0
        } else {
            -quiesce(&child, net, tb, -beta, -alpha, ply + 1, z, side, budget)
        };
        if budget.aborted {
            return 0;
        }
        if val >= beta {
            return val;
        }
        alpha = alpha.max(val);
    }
    alpha
}

/// Best move via iterative-deepening negamax αβ + TT + quiescence. Strength is the node
/// budget (CPU-independent); `time_ms` is a latency cap. Returns (255, 255) if no move.
pub fn best_move(p: &Parsed, node_budget: u64, time_ms: u64) -> (u8, u8) {
    best_move_scored(p, node_budget, time_ms).0
}

/// Like `best_move` but also returns the root score. Handcrafted eval, no tablebase.
pub fn best_move_scored(p: &Parsed, node_budget: u64, time_ms: u64) -> ((u8, u8), i32) {
    best_move_scored_full(p, None, None, node_budget, time_ms, &[], 0)
}

/// Iterative-deepening αβ with a chosen leaf eval (Some(net) = learned, None = handcrafted) and
/// an optional tablebase probed at the leaf for exact endgame values.
pub fn best_move_scored_full(
    p: &Parsed,
    net: Option<&Net>,
    tb: Option<&Store>,
    node_budget: u64,
    time_ms: u64,
    rep_fens: &[String],
    contempt: i32,
) -> ((u8, u8), i32) {
    best_move_scored_ext(p, net, tb, node_budget, time_ms, rep_fens, contempt, true)
}

/// What a search actually CONSUMED, as opposed to what it was allowed. `nodes` is the real
/// visited-node count (never the budget echoed back) and `depth` is the last iterative-deepening
/// iteration that ran to COMPLETION (0 if even the first one was cut short — an incomplete depth
/// is discarded, so it is not "reached"). A caller comparing these against the budget it handed
/// in can tell a work-bound search from a time-bound one: nodes at the cap means the node budget
/// bound, nodes far short of it with the clock at the ceiling means the host was slow.
#[derive(Clone, Copy, Debug, Default)]
pub struct SearchStats {
    pub nodes: u64,
    pub depth: i32,
}

/// Like `best_move_scored_full` but `ext` toggles the Rung-1 search extensions
/// (LMR + killer/history ordering + PVS). `ext=false` is the pre-Rung-1 baseline,
/// for in-build A/B comparison.
#[allow(clippy::too_many_arguments)]
pub fn best_move_scored_ext(
    p: &Parsed,
    net: Option<&Net>,
    tb: Option<&Store>,
    node_budget: u64,
    time_ms: u64,
    rep_fens: &[String],
    contempt: i32,
    ext: bool,
) -> ((u8, u8), i32) {
    let (m, score, _) =
        best_move_scored_stats(p, net, tb, node_budget, time_ms, rep_fens, contempt, ext);
    (m, score)
}

/// Like `best_move_scored_ext` but also returns what the search consumed (`SearchStats`).
/// This is the body every other entry point above funnels into: the search itself is
/// byte-for-byte the same, the stats are read off the budget it already keeps.
#[allow(clippy::too_many_arguments)]
pub fn best_move_scored_stats(
    p: &Parsed,
    net: Option<&Net>,
    tb: Option<&Store>,
    node_budget: u64,
    time_ms: u64,
    rep_fens: &[String],
    contempt: i32,
    ext: bool,
) -> ((u8, u8), i32, SearchStats) {
    let root = legal_moves(p);
    if root.is_empty() {
        return ((255, 255), -WIN, SearchStats::default());
    }
    let (z, side) = build_zobrist();
    let key = zkey(p, &z, side);
    // Repetition seed: zobrist keys of prior game positions (since the last capture) so the
    // search recognises a line that returns to one of them as a draw.
    let rep_seed: Vec<u64> = rep_fens
        .iter()
        .filter_map(|f| state_from_fen(f).map(|s| zkey(&s, &z, side)))
        .collect();
    let mut tt = vec![TtEntry::default(); TT_SIZE];
    let mut budget = Budget {
        nodes: 0,
        cap: node_budget,
        start: Instant::now(),
        time_ms: time_ms as u128,
        aborted: false,
        rep_seed,
        path: Vec::new(),
        contempt,
        killers: vec![[(255, 255); 2]; MAX_DEPTH as usize + 8],
        history: vec![0i32; 63 * 63],
        ext,
    };
    let mut best = root[0];
    let mut best_score = -INF;
    let mut completed_depth = 0;

    for depth in 1..=MAX_DEPTH {
        budget.path.clear();
        budget.path.push(key); // root key on the path so a line returning here is a repetition
        let tt_mv = {
            let e = &tt[(key & TT_MASK) as usize];
            if e.flag != 0 && e.key == key {
                Some(e.mv)
            } else {
                None
            }
        };
        let moves = if budget.ext {
            ordered_moves_ext(p, tt_mv, &budget.killers[0], &budget.history)
        } else {
            ordered_moves(p, tt_mv)
        };
        let mut alpha = -INF;
        let mut local_best = moves[0];
        let mut local_score = -INF;
        for m in &moves {
            let child = make_move(p, *m);
            let val = if m.1 == opp_den(p.turn) || !color_has_pieces(&child, child.turn) {
                WIN
            } else if child.progress >= PROGRESS_LIMIT {
                0
            } else {
                -negamax(&child, net, tb, depth - 1, -INF, -alpha, 1, &z, side, &mut tt, &mut budget)
            };
            if budget.aborted {
                break;
            }
            if val > local_score {
                local_score = val;
                local_best = *m;
            }
            alpha = alpha.max(val);
        }
        if budget.aborted {
            break; // discard this incomplete depth, keep the previous best
        }
        best = local_best;
        best_score = local_score;
        completed_depth = depth;
        tt[(key & TT_MASK) as usize] = TtEntry {
            key,
            depth,
            value: local_score,
            flag: 1,
            mv: local_best,
        };
        if local_score >= WIN - MAX_DEPTH {
            break; // forced win found — no deeper search needed
        }
    }
    (
        best,
        best_score,
        SearchStats {
            nodes: budget.nodes,
            depth: completed_depth,
        },
    )
}

/// Exact per-root-move values for in-browser MultiPV (the WebAssembly client engine). Runs the
/// SAME iterative-deepening negamax + TT + quiescence as `best_move_scored_ext`, but searches
/// every root move with a FULL window (`-INF..INF`) instead of narrowing alpha across siblings,
/// so each move gets an exact value rather than a fail-low bound past the best one. Handcrafted
/// eval, no net/tablebase (the browser build has neither). `time_ms = 0` = node-budget-only.
///
/// Returns `(from, to, score, depth_reached)` sorted best-first, where `score` is the
/// side-to-move-POV native score (WIN = 1_000_000; the caller maps it through the win% curve).
/// Empty when the position is terminal (no legal move).
pub fn root_move_values(p: &Parsed, node_budget: u64, time_ms: u64) -> Vec<(u8, u8, i32, i32)> {
    let mut session = RootAnalysisSession::new(*p, time_ms);
    session.advance(node_budget)
}

/// Incremental root analysis for browser workers.
///
/// The position, Zobrist keys, TT, and move-ordering heuristics live for the whole session.
/// Each call receives a bounded node slice and publishes only fully completed depths.
pub struct RootAnalysisSession {
    p: Parsed,
    z: [[u64; N]; 17],
    side: u64,
    key: u64,
    tt: Vec<TtEntry>,
    budget: Budget,
    completed: Vec<(u8, u8, i32)>,
    depth_reached: i32,
    total_nodes: u64,
    finished: bool,
}

impl RootAnalysisSession {
    pub fn new(p: Parsed, time_ms: u64) -> Self {
        let (z, side) = build_zobrist();
        let key = zkey(&p, &z, side);
        Self {
            p,
            z,
            side,
            key,
            tt: vec![TtEntry::default(); TT_SIZE],
            budget: Budget {
                nodes: 0,
                cap: 1,
                start: Instant::now(),
                time_ms: time_ms as u128,
                aborted: false,
                rep_seed: Vec::new(),
                path: Vec::new(),
                contempt: 0,
                killers: vec![[(255, 255); 2]; MAX_DEPTH as usize + 8],
                history: vec![0i32; 63 * 63],
                ext: true,
            },
            completed: Vec::new(),
            depth_reached: 0,
            total_nodes: 0,
            finished: false,
        }
    }

    pub fn advance(&mut self, node_budget: u64) -> Vec<(u8, u8, i32, i32)> {
        if self.finished || self.depth_reached >= MAX_DEPTH {
            return self.results();
        }
        let root = legal_moves(&self.p);
        if root.is_empty() {
            self.finished = true;
            return Vec::new();
        }

        self.budget.nodes = 0;
        self.budget.cap = node_budget.max(1);
        self.budget.start = Instant::now();
        self.budget.aborted = false;
        // A budget abort can return before every ancestor pops its repetition key.
        self.budget.path.clear();

        for depth in (self.depth_reached + 1)..=MAX_DEPTH {
            self.budget.path.clear();
            self.budget.path.push(self.key);
            let tt_mv = {
                let e = &self.tt[(self.key & TT_MASK) as usize];
                if e.flag != 0 && e.key == self.key {
                    Some(e.mv)
                } else {
                    None
                }
            };
            let moves = ordered_moves_ext(
                &self.p,
                tt_mv,
                &self.budget.killers[0],
                &self.budget.history,
            );
            let mut depth_vals = Vec::with_capacity(moves.len());
            for m in &moves {
                let child = make_move(&self.p, *m);
                let val = if m.1 == opp_den(self.p.turn)
                    || !color_has_pieces(&child, child.turn)
                {
                    WIN
                } else if child.progress >= PROGRESS_LIMIT {
                    0
                } else {
                    -negamax(
                        &child,
                        None,
                        None,
                        depth - 1,
                        -INF,
                        INF,
                        1,
                        &self.z,
                        self.side,
                        &mut self.tt,
                        &mut self.budget,
                    )
                };
                if self.budget.aborted {
                    break;
                }
                depth_vals.push((m.0, m.1, val));
            }
            if self.budget.aborted {
                break;
            }
            depth_vals.sort_by(|a, b| b.2.cmp(&a.2).then((a.0, a.1).cmp(&(b.0, b.1))));
            if let Some(&(bf, bt, bv)) = depth_vals.first() {
                self.tt[(self.key & TT_MASK) as usize] = TtEntry {
                    key: self.key,
                    depth,
                    value: bv,
                    flag: 1,
                    mv: (bf, bt),
                };
            }
            self.completed = depth_vals;
            self.depth_reached = depth;
            if self
                .completed
                .first()
                .map(|v| v.2 >= WIN - MAX_DEPTH)
                .unwrap_or(false)
            {
                self.finished = true;
                break;
            }
        }

        self.total_nodes = self
            .total_nodes
            .saturating_add(self.budget.nodes.min(self.budget.cap));
        self.results()
    }

    pub fn depth(&self) -> i32 {
        self.depth_reached
    }

    pub fn total_nodes(&self) -> u64 {
        self.total_nodes
    }

    fn results(&self) -> Vec<(u8, u8, i32, i32)> {
        self.completed
            .iter()
            .map(|&(f, t, v)| (f, t, v, self.depth_reached))
            .collect()
    }
}

// ── Endgame tablebase (P2 first rung: self-contained WDL for 2-piece sets) ────
// Built on the parity-validated movegen, so it inherits all rules correctness. A 2-piece
// endgame is SELF-CONTAINED: every capture or den-entry ENDS the game (the loser has no
// piece, or the den is breached), so non-capture moves stay in-set and a simple fixpoint
// solves win/draw/loss with no sub-tablebase. The k≥3 build (capture → (k-1)-piece sub-TB
// lookup) + combinatorial indexing is the next step; this rung proves the machinery and is
// validated vs deep search now and the Leiden retrograde.tgz oracle next.
//
// WDL (side-to-move perspective): 0 = draw/unknown, 1 = win, 2 = loss.
pub const TB_DRAW: u8 = 0;
pub const TB_WIN: u8 = 1;
pub const TB_LOSS: u8 = 2;

/// Decode a tablebase index → position, or None if two pieces overlap (invalid). Index =
/// stm (low bit) + 2*(sq0 + 63*sq1 + …). Pieces are distinct codes in a fixed order.
fn tb_pos(pieces: &[u8], idx: usize) -> Option<Parsed> {
    let stm = (idx & 1) as u8;
    let mut rest = idx >> 1;
    let mut squares = [0u8; N];
    for &code in pieces {
        let sq = rest % N;
        rest /= N;
        if squares[sq] != 0 {
            return None; // two pieces on one square
        }
        // Reject UNREACHABLE placements: only a rat may occupy water; no piece may sit on its
        // OWN den (an enemy on a den is the won terminal, which is fine).
        if is_water(sq as u8) && role_of(code) != 1 {
            return None;
        }
        let own_den = if is_red(code) { RED_DEN } else { BLACK_DEN };
        if sq as u8 == own_den {
            return None;
        }
        squares[sq] = code;
    }
    Some(Parsed {
        squares,
        turn: stm,
        progress: 0,
        movenum: 1,
    })
}

fn tb_index(pieces: &[u8], p: &Parsed) -> usize {
    let mut acc = 0usize;
    for (i, &code) in pieces.iter().enumerate() {
        let sq = (0..N).find(|&s| p.squares[s] == code).unwrap();
        acc += sq * N.pow(i as u32);
    }
    acc * 2 + p.turn as usize
}

/// Sorted multiset of piece codes on the board — the canonical material-set key.
pub fn material_key(p: &Parsed) -> Vec<u8> {
    let mut codes: Vec<u8> = p.squares.iter().copied().filter(|&c| c != 0).collect();
    codes.sort_unstable();
    codes
}

/// All k-piece material sets with ≥1 red (1..8) and ≥1 black (9..16), codes ascending.
pub fn material_sets(k: usize) -> Vec<Vec<u8>> {
    fn rec(start: u8, k: usize, cur: &mut Vec<u8>, out: &mut Vec<Vec<u8>>) {
        if cur.len() == k {
            if cur.iter().any(|&c| c <= 8) && cur.iter().any(|&c| c >= 9) {
                out.push(cur.clone());
            }
            return;
        }
        for code in start..=16 {
            cur.push(code);
            rec(code + 1, k, cur, out);
            cur.pop();
        }
    }
    let mut out = Vec::new();
    rec(1, k, &mut Vec::new(), &mut out);
    out
}

/// WDL of `child` from ITS side-to-move's view: terminal via status, same-set via the
/// in-progress table, or a capture via the already-solved sub-table in `store`.
fn child_wdl(child: &Parsed, cur: &[u8], cur_val: &[u8], store: &HashMap<Vec<u8>, Vec<u8>>) -> u8 {
    match status_of(child) {
        Status::Win(c) => {
            if c == child.turn {
                TB_WIN
            } else {
                TB_LOSS
            }
        }
        Status::Draw => TB_DRAW,
        Status::Playing => {
            let key = material_key(child);
            if key.len() == cur.len() {
                cur_val[tb_index(cur, child)] // non-capture: same material set
            } else {
                store[&key][tb_index(&key, child)] // capture: (k-1)-piece sub-table
            }
        }
    }
}

/// Solve one material set to a WDL table. Lower-piece sub-tables (reached by captures) must
/// already be in `store`. Layered retrograde via a shrinking-worklist fixpoint: WIN if a move
/// hands the opponent a LOSS; LOSS if every move hands the opponent a WIN (stalemate is a
/// terminal LOSS); otherwise DRAW. Built on the parity-validated movegen → inherits correctness.
pub fn solve_set(pieces: &[u8], store: &HashMap<Vec<u8>, Vec<u8>>) -> Vec<u8> {
    let size = 2 * N.pow(pieces.len() as u32);
    let mut val = vec![TB_DRAW; size];
    let mut unknown: Vec<usize> = Vec::new();

    for idx in 0..size {
        if let Some(p) = tb_pos(pieces, idx) {
            if let Status::Win(c) = status_of(&p) {
                val[idx] = if c == p.turn { TB_WIN } else { TB_LOSS };
            } else {
                unknown.push(idx); // Playing (progress 0 ⇒ no-progress never fires here)
            }
        }
    }

    loop {
        let mut still = Vec::with_capacity(unknown.len());
        let mut changed = false;
        for &idx in &unknown {
            let p = tb_pos(pieces, idx).unwrap();
            let (mut found_win, mut all_win) = (false, true);
            for m in legal_moves(&p) {
                let cval = child_wdl(&make_move(&p, m), pieces, &val, store);
                if cval == TB_LOSS {
                    found_win = true;
                    break;
                }
                if cval != TB_WIN {
                    all_win = false;
                }
            }
            if found_win {
                val[idx] = TB_WIN;
                changed = true;
            } else if all_win {
                val[idx] = TB_LOSS;
                changed = true;
            } else {
                still.push(idx);
            }
        }
        unknown = still;
        if !changed {
            break;
        }
    }
    val
}

/// Solve one material set by TRUE queue-based retrograde — O(positions × branching), no
/// rescan-per-pass (vs `solve_set`'s fixpoint). Backward induction from terminals via reverse
/// in-set edges: a position is WIN the moment a successor is known LOSS-for-opponent; LOSS the
/// moment its last unresolved in-set successor becomes WIN-for-opponent (and it has no drawing
/// escape); leftover = DRAW. Captures/den-entries resolve immediately (sub-tables / terminal).
/// MUST produce byte-identical tables to `solve_set` (asserted in tests). Reverse edges are
/// stored (fine ≤4 pieces); k≥5 needs on-the-fly un-move instead (the frontier upgrade).
pub fn solve_set_retro(pieces: &[u8], store: &HashMap<Vec<u8>, Vec<u8>>) -> Vec<u8> {
    let size = 2 * N.pow(pieces.len() as u32);
    let mut val = vec![TB_DRAW; size];
    let mut deg = vec![0u32; size]; // unresolved in-set successors
    let mut can_lose = vec![true; size]; // false once a drawing capture is found
    let mut preds: Vec<Vec<u32>> = vec![Vec::new(); size]; // reverse in-set edges
    let mut queue: Vec<usize> = Vec::new();

    for idx in 0..size {
        let p = match tb_pos(pieces, idx) {
            Some(p) => p,
            None => continue,
        };
        if let Status::Win(c) = status_of(&p) {
            val[idx] = if c == p.turn { TB_WIN } else { TB_LOSS };
            queue.push(idx); // terminal seed (den breach / stalemate)
            continue;
        }
        let (mut winning, mut fixed_draw) = (false, false);
        let mut in_set: Vec<u32> = Vec::new();
        for m in legal_moves(&p) {
            if m.1 == opp_den(p.turn) {
                winning = true;
                break; // den entry
            }
            let captured = p.squares[m.1 as usize] != 0;
            let child = make_move(&p, m);
            if !captured {
                in_set.push(tb_index(pieces, &child) as u32);
            } else if !color_has_pieces(&child, child.turn) {
                winning = true;
                break; // captured the opponent's last piece
            } else {
                let key = material_key(&child);
                match store[&key][tb_index(&key, &child)] {
                    TB_LOSS => {
                        winning = true;
                        break;
                    }
                    TB_DRAW => fixed_draw = true,
                    _ => {}
                }
            }
        }
        if winning {
            val[idx] = TB_WIN;
            queue.push(idx);
            continue;
        }
        if fixed_draw {
            can_lose[idx] = false;
        }
        deg[idx] = in_set.len() as u32;
        for &c in &in_set {
            preds[c as usize].push(idx as u32);
        }
        if deg[idx] == 0 && can_lose[idx] {
            val[idx] = TB_LOSS; // every move hands the opponent a win, no drawing escape
            queue.push(idx);
        }
    }

    let mut qi = 0;
    while qi < queue.len() {
        let v = queue[qi];
        qi += 1;
        let vv = val[v];
        for u in std::mem::take(&mut preds[v]) {
            let u = u as usize;
            if val[u] != TB_DRAW {
                continue;
            }
            if vv == TB_LOSS {
                val[u] = TB_WIN; // a move into a loss-for-opponent
                queue.push(u);
            } else if vv == TB_WIN {
                deg[u] -= 1;
                if deg[u] == 0 && can_lose[u] {
                    val[u] = TB_LOSS;
                    queue.push(u);
                }
            }
        }
    }
    val
}

/// Memory-scalable retrograde: identical math to `solve_set_retro`, but predecessors are
/// regenerated ON THE FLY via un-move (no stored reverse edges → ~3 bytes/position instead of
/// ~2.4 GB/set at 4 pieces). Un-move reuses the parity-validated forward movegen: candidate
/// source squares come from the moved piece's own move geometry (symmetric), then each candidate
/// is verified by forward movegen on the reconstructed predecessor. This is the 4-5 piece solver.
pub fn solve_set_onfly(pieces: &[u8], store: &HashMap<Vec<u8>, Vec<u8>>) -> Vec<u8> {
    let size = 2 * N.pow(pieces.len() as u32);
    let mut val = vec![TB_DRAW; size];
    let mut deg = vec![0u16; size];
    let mut can_lose = vec![true; size];
    let mut queue: Vec<usize> = Vec::new();

    for idx in 0..size {
        let p = match tb_pos(pieces, idx) {
            Some(p) => p,
            None => continue,
        };
        if let Status::Win(c) = status_of(&p) {
            val[idx] = if c == p.turn { TB_WIN } else { TB_LOSS };
            queue.push(idx);
            continue;
        }
        let (mut winning, mut fixed_draw, mut nsucc) = (false, false, 0u16);
        for m in legal_moves(&p) {
            if m.1 == opp_den(p.turn) {
                winning = true;
                break;
            }
            let captured = p.squares[m.1 as usize] != 0;
            let child = make_move(&p, m);
            if !captured {
                nsucc += 1;
            } else if !color_has_pieces(&child, child.turn) {
                winning = true;
                break;
            } else {
                let key = material_key(&child);
                match store[&key][tb_index(&key, &child)] {
                    TB_LOSS => {
                        winning = true;
                        break;
                    }
                    TB_DRAW => fixed_draw = true,
                    _ => {}
                }
            }
        }
        if winning {
            val[idx] = TB_WIN;
            queue.push(idx);
            continue;
        }
        if fixed_draw {
            can_lose[idx] = false;
        }
        deg[idx] = nsucc;
        if nsucc == 0 && can_lose[idx] {
            val[idx] = TB_LOSS;
            queue.push(idx);
        }
    }

    let (mut preds, mut cands, mut umoves) = (Vec::new(), Vec::new(), Vec::new());
    let mut qi = 0;
    while qi < queue.len() {
        let vi = queue[qi];
        qi += 1;
        let vv = val[vi];
        let v = tb_pos(pieces, vi).unwrap();
        let mover = 1 - v.turn;
        preds.clear();
        for to in 0..N {
            let code = v.squares[to];
            if color_of(code) != mover {
                continue;
            }
            cands.clear();
            moves_from(&v, to as u8, &mut cands); // candidate sources (symmetric geometry)
            for &(_, cand) in &cands {
                if v.squares[cand as usize] != 0 {
                    continue; // a non-capture predecessor needs `from` empty in v
                }
                let mut u = v;
                u.squares[cand as usize] = code;
                u.squares[to] = 0;
                u.turn = mover;
                umoves.clear();
                moves_from(&u, cand, &mut umoves); // verify the reverse move on the predecessor
                if umoves.iter().any(|&(_, t)| t as usize == to) {
                    preds.push(tb_index(pieces, &u));
                }
            }
        }
        for &u in &preds {
            if val[u] != TB_DRAW {
                continue;
            }
            if vv == TB_LOSS {
                val[u] = TB_WIN;
                queue.push(u);
            } else if vv == TB_WIN {
                deg[u] -= 1;
                if deg[u] == 0 && can_lose[u] {
                    val[u] = TB_LOSS;
                    queue.push(u);
                }
            }
        }
    }
    val
}

/// Build all tablebases from 2 up to `max_pieces`, bottom-up via the memory-scalable on-the-fly
/// retrograde. Naive 63^k indexing; k≥5 also wants combinatorial indexing + disk (the frontier).
pub fn build_tables(max_pieces: usize) -> HashMap<Vec<u8>, Vec<u8>> {
    let mut store: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    for k in 2..=max_pieces {
        for set in material_sets(k) {
            let v = solve_set_onfly(&set, &store);
            store.insert(set, v);
        }
    }
    store
}

/// A built tablebase keyed by material set → WDL table.
pub type Store = HashMap<Vec<u8>, Vec<u8>>;

/// Score returned for a TB win/loss leaf: clearly winning/losing, but below mate (WIN=1e6).
const TB_SCORE: i32 = 500_000;

/// Serialize a store: u32 count, then per entry [u8 keylen][key][u32 vlen][val].
pub fn save_store(store: &Store, path: &str) -> std::io::Result<()> {
    let mut buf: Vec<u8> = Vec::new();
    buf.extend((store.len() as u32).to_le_bytes());
    for (k, v) in store {
        buf.push(k.len() as u8);
        buf.extend(k);
        buf.extend((v.len() as u32).to_le_bytes());
        buf.extend(v);
    }
    std::fs::write(path, buf)
}

pub fn load_store(path: &str) -> Option<Store> {
    let b = std::fs::read(path).ok()?;
    let mut o = 0usize;
    let n = u32::from_le_bytes(b[0..4].try_into().ok()?);
    o += 4;
    let mut store = HashMap::new();
    for _ in 0..n {
        let klen = *b.get(o)? as usize;
        o += 1;
        let k = b.get(o..o + klen)?.to_vec();
        o += klen;
        let vlen = u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?) as usize;
        o += 4;
        let v = b.get(o..o + vlen)?.to_vec();
        o += vlen;
        store.insert(k, v);
    }
    Some(store)
}

/// Probe the built store for a position's WDL (stm view): terminal via status, else the table
/// for its material set. None if the set isn't in the store.
pub fn probe_store(store: &Store, p: &Parsed) -> Option<u8> {
    match status_of(p) {
        Status::Win(c) => Some(if c == p.turn { TB_WIN } else { TB_LOSS }),
        Status::Draw => Some(TB_DRAW),
        Status::Playing => {
            let key = material_key(p);
            store.get(&key).map(|t| t[tb_index(&key, p)])
        }
    }
}

/// Per-piece-count aggregates over a built store: (k, sets, valid, win, loss, draw).
pub fn store_stats(store: &HashMap<Vec<u8>, Vec<u8>>) -> Vec<(usize, usize, usize, usize, usize, usize)> {
    let mut by_k: HashMap<usize, (usize, usize, usize, usize, usize)> = HashMap::new();
    for (key, val) in store {
        let e = by_k.entry(key.len()).or_default();
        e.0 += 1; // sets
        for (idx, &v) in val.iter().enumerate() {
            if tb_pos(key, idx).is_some() {
                e.1 += 1; // valid
                match v {
                    TB_WIN => e.2 += 1,
                    TB_LOSS => e.3 += 1,
                    _ => e.4 += 1,
                }
            }
        }
    }
    let mut out: Vec<_> = by_k
        .into_iter()
        .map(|(k, (s, v, w, l, d))| (k, s, v, w, l, d))
        .collect();
    out.sort();
    out
}

/// Self-contained 2-piece solve (no sub-tables needed: every capture/den-entry is terminal).
pub fn solve_endgame(pieces: &[u8]) -> Vec<u8> {
    solve_set(pieces, &HashMap::new())
}

/// Solve a material set and sample up to `n` PLAYING positions with their exact WDL — the
/// Phase-0 training labels. `store` must hold the (k-1) sub-tables (captures). Returns
/// (squares[63], stm, wdl). The table is solved transiently here and dropped on return — this
/// is the generate-and-discard pipeline (no full table is ever persisted).
pub fn sample_set_labels(
    pieces: &[u8],
    store: &HashMap<Vec<u8>, Vec<u8>>,
    n: usize,
    seed: u64,
) -> Vec<(Vec<u8>, u8, u8)> {
    let val = solve_set_onfly(pieces, store);
    let size = val.len();
    let mut rng = seed | 1; // xorshift64; must be nonzero
    let mut next = || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    let mut out = Vec::with_capacity(n);
    let cap = n.saturating_mul(50).max(100_000);
    let mut tries = 0;
    while out.len() < n && tries < cap {
        tries += 1;
        let idx = (next() as usize) % size;
        if let Some(p) = tb_pos(pieces, idx) {
            if matches!(status_of(&p), Status::Playing) {
                out.push((p.squares.to_vec(), p.turn, val[idx]));
            }
        }
    }
    out
}

/// Solve + count (valid positions, wins, losses, draws) over the side-to-move space.
pub fn solve_endgame_stats(pieces: &[u8]) -> (usize, usize, usize, usize) {
    let val = solve_endgame(pieces);
    let (mut valid, mut w, mut l, mut d) = (0, 0, 0, 0);
    for (idx, &v) in val.iter().enumerate() {
        if tb_pos(pieces, idx).is_some() {
            valid += 1;
            match v {
                TB_WIN => w += 1,
                TB_LOSS => l += 1,
                _ => d += 1,
            }
        }
    }
    (valid, w, l, d)
}

/// Solve the endgame and return the WDL of a single position (TB_WIN/TB_LOSS/TB_DRAW).
pub fn solve_and_probe(pieces: &[u8], p: &Parsed) -> u8 {
    solve_endgame(pieces)[tb_index(pieces, p)]
}

// ── Reference opponent: the TS bot's algorithm (server-jungle-engine.ts) ──────
// Plain fixed-depth negamax, capture-ordered, leaf = static eval — NO TT, NO iterative
// deepening, NO quiescence. Same movegen + eval as the full engine, so a full-vs-fixed
// bakeoff isolates exactly the search improvements (the P1f gate). misty-jungle-level-3 = depth 4.

fn nmx_fixed(p: &Parsed, depth: i32, mut alpha: i32, beta: i32, ply: i32) -> i32 {
    let moves = ordered_moves(p, None);
    if moves.is_empty() {
        return -(WIN - ply);
    }
    if depth <= 0 {
        return eval(p, None, None);
    }
    let mut best = -INF;
    for m in &moves {
        let child = make_move(p, *m);
        let val = if m.1 == opp_den(p.turn) || !color_has_pieces(&child, child.turn) {
            WIN - ply
        } else if child.progress >= PROGRESS_LIMIT {
            0
        } else {
            -nmx_fixed(&child, depth - 1, -beta, -alpha, ply + 1)
        };
        best = best.max(val);
        alpha = alpha.max(best);
        if alpha >= beta {
            break;
        }
    }
    best
}

pub fn best_move_fixed_depth(p: &Parsed, depth: i32) -> (u8, u8) {
    let moves = ordered_moves(p, None);
    if moves.is_empty() {
        return (255, 255);
    }
    let (mut best, mut best_score, mut alpha) = (moves[0], -INF, -INF);
    for m in &moves {
        let child = make_move(p, *m);
        let val = if m.1 == opp_den(p.turn) || !color_has_pieces(&child, child.turn) {
            WIN
        } else if child.progress >= PROGRESS_LIMIT {
            0
        } else {
            -nmx_fixed(&child, depth - 1, -INF, -alpha, 1)
        };
        if val > best_score {
            best_score = val;
            best = *m;
        }
        alpha = alpha.max(val);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_fen_roundtrips() {
        let p = initial();
        let fen = to_fen(&p);
        assert_eq!(fen, "t5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1");
        assert_eq!(state_from_fen(&fen).unwrap(), p);
    }

    #[test]
    fn geometry_matches_kernel() {
        assert_eq!((RED_DEN, BLACK_DEN), (3, 59));
        assert!(is_water(22) && is_water(40) && !is_water(0));
        assert_eq!(trap_owner(2), 0);
        assert_eq!(trap_owner(52), 1);
        assert_eq!(trap_owner(0), 2);
    }

    #[test]
    fn move_codec_roundtrips() {
        for &(a, b) in &[(0u8, 1u8), (3, 10), (62, 56)] {
            assert_eq!(uci_to_move(&move_to_uci((a, b))).unwrap(), (a, b));
        }
        assert_eq!(color_of(1), 0);
        assert_eq!(color_of(9), 1);
    }

    fn ucis(p: &Parsed) -> Vec<String> {
        let mut v: Vec<String> = legal_moves(p).into_iter().map(move_to_uci).collect();
        v.sort();
        v
    }

    #[test]
    fn initial_position_has_24_red_moves() {
        let p = initial();
        let m = ucis(&p);
        assert_eq!(m.len(), 24, "{m:?}");
        assert!(m.contains(&"a3a4".to_string())); // rat steps up
        assert!(m.contains(&"c3b3".to_string())); // leopard steps left
        assert!(!m.contains(&"c3c4".to_string())); // leopard cannot enter water
        assert!(!m.contains(&"a1d1".to_string())); // no teleport into own den
    }

    #[test]
    fn tiger_jumps_lake_on_both_axes_like_the_lion() {
        // Red tiger at a4 clears the west lake sideways (b4/c4) to d4, and at b3 along it to b7.
        let p = state_from_fen("7/7/7/7/7/T6/7/7/7 r 0 1").unwrap();
        assert!(ucis(&p).contains(&"a4d4".to_string()));
        let along = state_from_fen("7/7/7/7/7/7/1T5/7/7 r 0 1").unwrap();
        assert!(ucis(&along).contains(&"b3b7".to_string()));
        // From the central lane d5 it clears BOTH lakes; a leopard there only steps.
        let mid = state_from_fen("7/7/7/7/3T3/7/7/7/7 r 0 1").unwrap();
        assert!(ucis(&mid).contains(&"d5a5".to_string()) && ucis(&mid).contains(&"d5g5".to_string()));
        let leopard = state_from_fen("7/7/7/7/3P3/7/7/7/7 r 0 1").unwrap();
        assert!(!ucis(&leopard).contains(&"d5a5".to_string()));
        // A rat in the lake blocks the sideways jump too.
        let blocked = state_from_fen("7/7/7/7/7/T1r4/7/7/7 r 0 1").unwrap();
        assert!(!ucis(&blocked).contains(&"a4d4".to_string()));
    }

    #[test]
    fn lion_jumps_lake_and_a_rat_blocks_it() {
        // Red lion at b3, west lake (b4/b5/b6) clear → can jump to b7.
        let p = state_from_fen("7/7/7/7/7/7/1L5/7/7 r 0 1").unwrap();
        assert!(ucis(&p).contains(&"b3b7".to_string()));
        assert!(!ucis(&p).contains(&"b3b4".to_string())); // lion can't step into water
        // A rat (either colour) on b5 blocks the jump.
        let blocked = state_from_fen("7/7/7/7/1r5/7/1L5/7/7 r 0 1").unwrap();
        assert!(!ucis(&blocked).contains(&"b3b7".to_string()));
    }

    #[test]
    fn rat_takes_elephant_from_land_but_not_vice_versa() {
        // Red rat a1, black elephant a2.
        let p = state_from_fen("7/7/7/7/7/7/7/e6/R6 r 0 1").unwrap();
        assert!(ucis(&p).contains(&"a1a2".to_string())); // rat > elephant (wrap)
        // Black to move: the elephant cannot take the rat.
        let bp = state_from_fen("7/7/7/7/7/7/7/e6/R6 b 0 1").unwrap();
        assert!(!ucis(&bp).contains(&"a2a1".to_string()));
        assert!(ucis(&bp).contains(&"a2b2".to_string())); // but can move elsewhere
    }

    #[test]
    fn enemy_on_our_trap_is_rank_zero() {
        // Black elephant on c1 (a RED trap); a red cat on b1 can capture it.
        let p = state_from_fen("7/7/7/7/7/7/7/7/1Ce4 r 0 1").unwrap();
        assert!(ucis(&p).contains(&"b1c1".to_string()));
    }

    #[test]
    fn terminals() {
        // Den entry: red lion c9 → black den d9.
        let p = state_from_fen("2L4/7/7/7/7/7/7/7/r6 r 0 1").unwrap();
        let m = uci_to_move("c9d9").unwrap();
        assert!(legal_moves(&p).contains(&m));
        assert_eq!(board_status(&make_move(&p, m), m.1), Status::Win(0));

        // Capture-all: red lion a2 takes black's last piece (rat a1).
        let p2 = state_from_fen("7/7/7/7/7/7/7/L6/r6 r 0 1").unwrap();
        let m2 = uci_to_move("a2a1").unwrap();
        assert_eq!(board_status(&make_move(&p2, m2), m2.1), Status::Win(0));

        // No-progress: one quiet move short of the limit is still playing; the move that
        // reaches it draws. Built off PROGRESS_LIMIT rather than a literal, so changing the
        // rule cannot leave this test quietly asserting the old one.
        let quiet = uci_to_move("c9c8").unwrap();
        let below =
            state_from_fen(&format!("2L4/7/7/7/7/7/7/7/r6 r {} 1", PROGRESS_LIMIT - 2)).unwrap();
        assert_eq!(board_status(&make_move(&below, quiet), quiet.1), Status::Playing);
        let at =
            state_from_fen(&format!("2L4/7/7/7/7/7/7/7/r6 r {} 1", PROGRESS_LIMIT - 1)).unwrap();
        assert_eq!(board_status(&make_move(&at, quiet), quiet.1), Status::Draw);
    }

    #[test]
    fn search_takes_the_winning_capture() {
        // Black's last piece is a rat on a1; the red lion on a2 wins by capturing it.
        let p = state_from_fen("7/7/7/7/7/7/7/L6/r6 r 0 1").unwrap();
        assert_eq!(best_move(&p, 200_000, 100_000), uci_to_move("a2a1").unwrap());
    }

    #[test]
    fn search_enters_the_den() {
        let p = state_from_fen("2L4/7/7/7/7/7/7/7/r6 r 0 1").unwrap();
        assert_eq!(best_move(&p, 200_000, 100_000), uci_to_move("c9d9").unwrap());
    }

    #[test]
    fn search_returns_a_legal_move_from_initial() {
        let p = initial();
        let m = best_move(&p, 200_000, 100_000);
        assert!(legal_moves(&p).contains(&m));
    }

    #[test]
    fn incremental_root_analysis_retains_completed_work_across_slices() {
        let mut session = RootAnalysisSession::new(initial(), 0);
        let first = session.advance(100_000);
        let first_depth = session.depth();
        assert_eq!(first.len(), 24);
        assert!(first_depth >= 1);
        assert_eq!(session.total_nodes(), 100_000);

        let second = session.advance(100_000);
        assert_eq!(second.len(), 24);
        assert!(session.depth() >= first_depth);
        assert_eq!(session.total_nodes(), 200_000);
        assert!(second.iter().all(|line| line.3 == session.depth()));
    }

    #[test]
    fn search_is_deterministic_at_fixed_budget() {
        let p = initial();
        assert_eq!(best_move(&p, 300_000, 100_000), best_move(&p, 300_000, 100_000));
    }

    #[test]
    fn tablebase_2piece_solves() {
        let pieces = [3u8, 10u8]; // red dog, black cat (dog > cat; cat can't take dog)
        let val = solve_endgame(&pieces);
        // Red dog a1, black cat a2, red to move → dog captures the cat → win for red.
        let win = state_from_fen("7/7/7/7/7/7/7/c6/D6 r 0 1").unwrap();
        assert_eq!(val[tb_index(&pieces, &win)], TB_WIN);
        // Both sides win some, and draws are a small fraction (matches the Leiden "low draw
        // ratio" finding — validated separately vs deep search: 0 contradictions over 383).
        // `valid` < 63*62*2 since illegal placements (own-den / non-rat-on-water) are excluded.
        let (valid, w, l, d) = solve_endgame_stats(&pieces);
        assert!((4000..7812).contains(&valid));
        assert!(w > 0 && l > 0);
        assert!(d * 20 < valid); // < 5% draws
    }

    #[test]
    fn retrograde_matches_fixpoint() {
        // The fast queue-retrograde must produce byte-identical tables to the validated
        // fixpoint solver — on a 2-piece set and a 3-piece set (which exercises sub-table
        // lookups on captures).
        let empty = HashMap::new();
        let two = [3u8, 10u8]; // red dog, black cat
        assert_eq!(solve_set_retro(&two, &empty), solve_set(&two, &empty));

        // Build the 2-piece store the 3-piece set needs, then compare on {dog, cat, black rat}.
        let mut store: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        for set in material_sets(2) {
            store.insert(set.clone(), solve_set(&set, &store));
        }
        let three = [3u8, 9u8, 10u8]; // red dog; black rat, black cat
        assert_eq!(solve_set_retro(&three, &store), solve_set(&three, &store));
    }

    #[test]
    fn onfly_matches_retro() {
        // The memory-scalable on-the-fly un-move solver must be byte-identical to the
        // stored-edge retrograde (and thus to the fixpoint) — on 2-piece and 3-piece sets.
        let empty = HashMap::new();
        let two = [4u8, 11u8]; // red wolf, black dog
        assert_eq!(solve_set_onfly(&two, &empty), solve_set_retro(&two, &empty));

        let mut store: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        for set in material_sets(2) {
            store.insert(set.clone(), solve_set_retro(&set, &store));
        }
        let three = [5u8, 9u8, 12u8]; // red leopard; black rat, black wolf
        assert_eq!(solve_set_onfly(&three, &store), solve_set_retro(&three, &store));
    }
}
