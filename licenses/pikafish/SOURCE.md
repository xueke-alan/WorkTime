Pikafish browser engine for WorkTime
==================================

Upstream source (GPL-3.0-or-later):
https://github.com/official-pikafish/Pikafish/tree/b02dd08688b687209066f4e0d9f627bf15987e94

The exact upstream archive is:
https://github.com/official-pikafish/Pikafish/archive/b02dd08688b687209066f4e0d9f627bf15987e94.zip

Local modifications and bridge source are provided in scripts/pikafish-browser/.
prepare.cjs replaces native thread scheduling with synchronous execution inside
one browser Worker. Search and evaluation are upstream. build.cjs compiles with
Emscripten 3.1.74; package.cjs bundles the WASM and model into a classic script
so file:// does not require fetch, cross-origin isolation or SharedArrayBuffer.

NNUE model source:
https://github.com/official-pikafish/Networks/releases/tag/master-net
SHA-256: 810ef8ecb0d0697755deac0a1d956296d762132f63b74fc4f8658f2ec5203f5b
Size: 50,309,463 bytes.
The model is covered by the independent terms in NNUE-License.md
(including no commercial use without permission), preserved from the browser
port's v0.1.0 release. UPSTREAM-README.md records the fixed engine's own README.

Reproduction:
1. Extract the fixed source archive into .cache/pikafish-port/.
2. Install Emscripten 3.1.74 at .cache/pikafish-port/emsdk-main/ and activate it.
3. Place the hash-matching model at .cache/pikafish-port/pikafish.nnue.
4. Run node scripts/pikafish-browser/prepare.cjs.
5. Run node scripts/pikafish-browser/build.cjs.
6. Run node scripts/pikafish-browser/package.cjs.

The bridge, Worker runtime and thread-scheduling modifications are licensed
GPL-3.0-or-later. The generated engine.js retains these terms; see COPYING.txt.
