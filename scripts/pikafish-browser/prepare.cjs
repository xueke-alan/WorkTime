"use strict";

// Prepare a fresh, pinned upstream tree before compiling. Keep this transform
// reviewable: only thread scheduling changes; search and evaluation stay upstream.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const revision = "b02dd08688b687209066f4e0d9f627bf15987e94";
const source = path.join(
  root,
  ".cache/pikafish-port/Pikafish-" + revision,
  "src",
);
const output = path.join(root, ".cache/pikafish-port/synchronous");
if (
  output !== path.resolve(root, ".cache/pikafish-port/synchronous") ||
  !output.startsWith(root + path.sep)
)
  throw Error("Unsafe build directory");
// A different upstream revision can remove sources: never overlay old files.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });
const file = path.join(output, "thread.cpp");
let code = fs.readFileSync(file, "utf8");
const begin = code.indexOf("Thread::Thread(");
const end = code.indexOf("Search::SearchManager* ThreadPool::main_manager()");
if (begin < 0 || end < begin) throw Error("Upstream thread layout changed");
code =
  code.slice(0, begin) +
  `Thread::Thread(Search::SharedState& sharedState,
    std::unique_ptr<Search::SearchManager> sm, usize n, usize numaN,
    usize totalNumaCount, OptionalThreadToNumaNodeBinder binder)
    : idx(n), idxInNuma(numaN), totalNuma(totalNumaCount) {
    searching = false;
    numaAccessToken = binder();
    worker = make_unique_large_page<Search::Worker>(sharedState, std::move(sm),
        n, idxInNuma, totalNuma, numaAccessToken);
}
Thread::~Thread() = default;
void Thread::start_searching() { worker->start_searching(); }
void Thread::clear_worker() { worker->clear(); }
void Thread::wait_for_search_finished() {}
void Thread::run_custom_job(std::function<void()> f) { f(); }
void Thread::ensure_network_replicated() { worker->ensure_network_replicated(); }
void Thread::idle_loop() {}

` +
  code.slice(end);
fs.writeFileSync(file, code);
// NUMA allocation and hash clearing also use native jobs. Execute those inline.
fs.writeFileSync(
  path.join(output, "thread_native.h"),
  `#pragma once
#include <functional>
#include <utility>
namespace Stockfish {
struct NativeThreadOptions {
    NativeThreadOptions& setLargeStack(bool) { return *this; }
};
struct NativeThread {
    bool joinable() const { return true; }
    void join() {}
};
template<class F, class... Args>
NativeThread create_native_thread(NativeThreadOptions, F&& f, Args&&... args) {
    std::invoke(std::forward<F>(f), std::forward<Args>(args)...);
    return {};
}
}
`,
);
fs.copyFileSync(
  path.join(__dirname, "bridge.cpp"),
  path.join(output, "bridge.cpp"),
);
console.log("Prepared synchronous Pikafish " + revision);
