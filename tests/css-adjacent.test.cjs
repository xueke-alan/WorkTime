"use strict";
const assert = require("node:assert/strict"),
  postcss = require("postcss"),
  { consolidateAdjacent } = require("../scripts/clean-css.cjs");
const tree = postcss.parse(`
.a { color:red; padding:1px; }
.a { color:blue!important; color:unsupported; }
.b { color:green; }
.a { color:yellow; }
@media (max-width:500px) { .a { padding:2px; } }
@media (max-width:500px) { .a { padding-top:3px; } @supports (display:grid) { .b { display:grid; } } }
@media (min-width:500px) { .a { padding:4px; } }
@media (min-width:500px) { .a { padding:5px; } }
/* This comment is a retained boundary. */
@media (min-width:500px) { .a { padding:6px; } }
@layer { .a { color:red; } }
@layer { .a { color:blue; } }
@layer named { .a { color:red; } }
@layer named { .a { color:blue; } }
@keyframes motion { from { opacity:0; } from { transform:none; } }
@keyframes motion { from { opacity:1; } }
`);
function declarations(root) {
  const values = [];
  root.walkDecls((node) => {
    const ancestry = [];
    for (
      let parent = node.parent;
      parent && parent.type !== "root";
      parent = parent.parent
    )
      ancestry.unshift(
        parent.type === "atrule"
          ? [parent.name, parent.params]
          : parent.selector,
      );
    values.push([ancestry, node.prop, node.value, !!node.important]);
  });
  return values;
}
const before = declarations(tree),
  result = consolidateAdjacent(tree);
assert.deepEqual(result, { rules: 3, conditions: 2 });
assert.deepEqual(
  declarations(tree),
  before,
  "Every declaration retains exact selector, condition, priority and order",
);
assert.equal(
  tree.nodes.filter((node) => node.type === "atrule" && node.name === "layer")
    .length,
  4,
  "Anonymous and named cascade layer boundaries remain",
);
assert.equal(
  tree.nodes.filter(
    (node) => node.type === "atrule" && node.name === "keyframes",
  ).length,
  2,
  "Duplicate keyframe names never combined",
);
assert.equal(
  tree.nodes.find((node) => node.type === "atrule" && node.name === "keyframes")
    .nodes.length,
  2,
  "Duplicate keyframe offsets never combined",
);
assert.match(tree.toString(), /retained boundary/);
assert.deepEqual(consolidateAdjacent(tree), { rules: 0, conditions: 0 });
console.log(
  "Adjacent CSS passed: unchanged declaration order/conditions/priority, different selectors/media, comment boundaries, layers/keyframes and idempotence.",
);
