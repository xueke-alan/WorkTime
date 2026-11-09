// WorkTime synchronous browser bridge. GPL-3.0-or-later, like Pikafish.
// Runs entirely inside a dedicated Web Worker; no pthreads or shared memory.
#include <memory>
#include <string>
#include <iostream>
#include <emscripten.h>
#include "attacks.h"
#include "engine.h"
#include "position.h"

using namespace Stockfish;
static std::unique_ptr<Engine> engine;
static std::string best;

extern "C" {
EMSCRIPTEN_KEEPALIVE void wt_init() {
    Attacks::init();
    Position::init();
    engine = std::make_unique<Engine>();
    engine->set_on_update_no_moves([](const Engine::InfoShort&) {});
    engine->set_on_update_full([](const Engine::InfoFull&) {});
    engine->set_on_iter([](const Engine::InfoIter&) {});
    engine->set_on_bestmove([](std::string_view move, std::string_view) {
        best = move;
    });
    engine->set_on_start([]() {});
    engine->set_on_verify_network([](std::string_view message) { std::cerr << message << std::endl; });
    engine->load_network("pikafish.nnue");
}

EMSCRIPTEN_KEEPALIVE const char* wt_search(const char* fen, int milliseconds,
                                          int depth, int nodes) {
    best.clear();
    if (!engine || engine->set_position(fen, {}).has_value()) return "";
    Search::LimitsType limits;
    limits.startTime = now();
    limits.movetime = milliseconds;
    limits.depth = depth;
    limits.nodes = nodes;
    engine->go(limits);
    return best.c_str();
}
}
