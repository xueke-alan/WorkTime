"use strict";
const assert = require("node:assert/strict");
const postcss = require("postcss");
const { clean } = require("../scripts/clean-css.cjs");
const root = postcss.parse(`
 .a { color: red; padding: 2px; }
 .a { color: blue; }
 .a { color: red; }
 @media (max-width: 500px) { .a { color: red; } }
 @media (min-width: 500px) { .a { color: red; } }
 .a { color: red !important; }
 .b { color: red; }
 @keyframes first { from { opacity: 0; } to { opacity: 1; } }
 @keyframes second { from { opacity: 0; } to { opacity: 1; } }
 .empty { /* unused */ }
 @layer first { .unused {} }
 @layer second { .layered { color: red; } }
 @layer { .anonymous { color: red !important; } }
 @layer { .anonymous { color: blue !important; } }
 @layer { .anonymous { color: red !important; } }
`);
const stats = clean(root);
assert.equal(stats.duplicates, 1);
assert.equal(stats.empty, 2);
const css = root.toString();
assert.match(css, /padding: 2px/);
assert.match(css, /color: blue/);
assert.match(css, /color: red !important/);
assert.match(css, /max-width: 500px/);
assert.match(css, /min-width: 500px/);
assert.equal((css.match(/from \{ opacity: 0/g) || []).length, 2);
assert.match(css, /\.b \{ color: red/);
assert.match(css, /@layer first/);
assert(css.indexOf("@layer first") < css.indexOf("@layer second"));
assert.equal(
  (css.match(/\.anonymous \{ color: red !important/g) || []).length,
  2,
  "anonymous layers have separate cascade identities",
);
assert.deepEqual(clean(root), { duplicates: 0, empty: 0 });
console.log(
  "CSS cleanup passed: condition scopes, important, distinct selectors, keyframes and idempotence.",
);
