// MIT. WorkTime browser ABI; includes the pinned, locally patched MistyJungle core.
#![allow(dead_code)]
include!("generated/engine.rs");

pub struct PlaySession {
    inner: RootAnalysisSession,
    moves: Vec<(u8, u8)>,
    index: usize,
    candidate: (u8, u8),
    score: i32,
    best: (u8, u8),
    best_score: i32,
}

impl PlaySession {
    fn new(positions: &[Parsed]) -> Self {
        let p = *positions.last().unwrap();
        let mut inner = RootAnalysisSession::new(p, 18);
        inner.budget.rep_seed = positions[..positions.len() - 1]
            .iter().map(|p| zkey(p, &inner.z, inner.side)).collect();
        let moves = ordered_moves_ext(&p, None, &inner.budget.killers[0], &inner.budget.history);
        let best = moves.first().copied().unwrap_or((255, 255));
        Self { inner, moves, index: 0, candidate: best, score: -INF, best, best_score: 0 }
    }

    fn step(&mut self, nodes: u64) {
        let s = &mut self.inner;
        if self.moves.is_empty() || s.finished { return; }
        s.budget.nodes = 0;
        s.budget.cap = nodes;
        s.budget.start = Instant::now();
        s.budget.aborted = false;
        s.budget.path.clear();
        s.budget.path.push(s.key);
        let depth = s.depth_reached + 1;
        while self.index < self.moves.len() {
            let m = self.moves[self.index];
            let child = make_move(&s.p, m);
            let val = if m.1 == opp_den(s.p.turn) || !color_has_pieces(&child, child.turn) {
                WIN
            } else {
                -negamax(&child, None, None, depth - 1, -INF, -self.score,
                    1, &s.z, s.side, &mut s.tt, &mut s.budget)
            };
            if s.budget.aborted { break; }
            if val > self.score { self.score = val; self.candidate = m; }
            self.index += 1;
        }
        s.total_nodes += s.budget.nodes;
        if self.index == self.moves.len() {
            self.best = self.candidate;
            self.best_score = self.score;
            s.depth_reached = depth;
            s.finished = depth >= MAX_DEPTH || self.score >= WIN - MAX_DEPTH;
            self.moves = ordered_moves_ext(&s.p, Some(self.best), &s.budget.killers[0], &s.budget.history);
            self.index = 0;
            self.score = -INF;
        }
    }
}

// Explicit ownership across the small raw WASM ABI. No wasm-bindgen/runtime dependency.
#[no_mangle]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn release(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
#[no_mangle]
pub unsafe extern "C" fn session_new(ptr: *const u8, len: usize) -> *mut PlaySession {
    let Ok(text) = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)) else { return std::ptr::null_mut(); };
    let Some(positions) = text.lines().map(state_from_fen).collect::<Option<Vec<_>>>() else { return std::ptr::null_mut(); };
    if positions.is_empty() { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(PlaySession::new(&positions)))
}
#[no_mangle]
pub unsafe extern "C" fn session_step(s: *mut PlaySession, nodes: u32) { (*s).step(nodes as u64); }
#[no_mangle]
pub unsafe extern "C" fn session_from(s: *const PlaySession) -> u32 { (*s).best.0 as u32 }
#[no_mangle]
pub unsafe extern "C" fn session_to(s: *const PlaySession) -> u32 { (*s).best.1 as u32 }
#[no_mangle]
pub unsafe extern "C" fn session_score(s: *const PlaySession) -> i32 { (*s).best_score }
#[no_mangle]
pub unsafe extern "C" fn session_depth(s: *const PlaySession) -> i32 { (*s).inner.depth_reached }
#[no_mangle]
pub unsafe extern "C" fn session_nodes(s: *const PlaySession) -> f64 { (*s).inner.total_nodes as f64 }
#[no_mangle]
pub unsafe extern "C" fn session_finished(s: *const PlaySession) -> u32 { (*s).inner.finished as u32 }
#[no_mangle]
pub unsafe extern "C" fn session_free(s: *mut PlaySession) { drop(Box::from_raw(s)); }

// Diagnostic exports compare the compiled engine's actual rules with the UI referee.
#[no_mangle]
pub unsafe extern "C" fn legal_mask(s: *const PlaySession, from: u32) -> u64 {
    legal_moves(&(*s).inner.p).iter().filter(|m| m.0 as u32 == from)
        .fold(0u64, |mask, m| mask | (1u64 << m.1))
}
#[no_mangle]
pub unsafe extern "C" fn position_status(s: *const PlaySession) -> i32 {
    let p = &(*s).inner.p;
    match status_of(p) {
        Status::Win(c) => if c == 0 { 1 } else { -1 },
        Status::Draw => 2,
        Status::Playing => {
            let n = (*s).inner.budget.rep_seed.iter().filter(|&&k| k == (*s).inner.key).count();
            if n >= 2 { 2 } else { 0 }
        }
    }
}
