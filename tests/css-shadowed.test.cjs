"use strict";
const assert = require("node:assert/strict"),
  postcss = require("postcss"),
  { pruneShadowed } = require("../scripts/clean-css.cjs");
const root = postcss.parse(`
.a { color:red; padding:2px; }
.b { color:green; }
.a { color:blue; color:unsupported; }
.a { color:yellow !important; }
@media (max-width:500px) { .a { color:red; } }
@media (min-width:500px) { .a { color:red; } }
@media (max-width:500px) { .a { color:blue; } }
@layer one { .a { color:red; } }
@layer two { .a { color:blue; } }
@keyframes one { from { color:red; } to { color:blue; } }
@keyframes two { from { color:red; } to { color:blue; } }
@layer { .anonymous { color:red !important; } }
@layer { .anonymous { color:blue !important; } }
@layer { .anonymous { color:red !important; } }
`);
assert.throws(() => pruneShadowed(root), /predicate/);
const supported = (_prop, value) => value !== "unsupported";
const result = pruneShadowed(root, supported);
assert.equal(result.removed.length, 2);
const css = root.toString();
assert.match(css, /padding:2px/);
assert.match(css, /color:unsupported/);
assert.match(css, /color:yellow !important/);
assert.match(css, /\.b \{ color:green/);
assert.match(css, /min-width:500px/);
assert.match(css, /@layer one \{ .a \{ color:red/);
assert.match(css, /@layer two \{ .a \{ color:blue/);
assert.equal((css.match(/from \{ color:red/g) || []).length, 2);
assert.equal(
  (css.match(/\.anonymous \{ color:red !important/g) || []).length,
  2,
);
assert.equal(pruneShadowed(root, supported).removed.length, 0);
console.log(
  "Shadowed CSS passed: supported values only, property/selector/condition/priority isolation, fallback/layers/keyframes and idempotence.",
);
