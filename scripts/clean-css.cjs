"use strict";
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");
const prettier = require("prettier");
/** Remove exact repeated declarations only within identical selector/condition scopes. */
function clean(root) {
  const seen = new Set();
  let duplicates = 0,
    empty = 0;
  const rules = [];
  root.walkRules((rule) => rules.push(rule));
  let uniqueRule = 0;
  for (const rule of rules.reverse()) {
    const identity = uniqueRule++;
    const conditions = [];
    for (
      let parent = rule.parent;
      parent && parent.type !== "root";
      parent = parent.parent
    ) {
      if (
        parent.type !== "atrule" ||
        /keyframes$/i.test(parent.name) ||
        (parent.name === "layer" && !parent.params.trim())
      ) {
        conditions.push("unique:" + identity);
        break;
      }
      conditions.unshift(parent.name + ":" + parent.params);
    }
    for (const declaration of [...rule.nodes].reverse()) {
      if (declaration.type !== "decl") continue;
      const key = JSON.stringify([
        conditions,
        rule.selector,
        declaration.prop,
        declaration.value,
        !!declaration.important,
      ]);
      if (seen.has(key)) {
        declaration.remove();
        duplicates++;
      } else seen.add(key);
    }
  }
  function discardEmpty(node) {
    if (!node.nodes) return;
    for (const child of [...node.nodes]) {
      discardEmpty(child);
      // An empty layer still establishes cascade order and must survive.
      if (
        ["rule", "atrule"].includes(child.type) &&
        child.name !== "layer" &&
        child.nodes &&
        !child.nodes.some((n) => n.type !== "comment")
      ) {
        child.remove();
        empty++;
      }
    }
  }
  discardEmpty(root);
  return { duplicates, empty };
}
async function main() {
  const directory = path.resolve(__dirname, "../assets/css");
  for (const name of fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".css"))) {
    const file = path.join(directory, name),
      root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    const stats = clean(root);
    fs.writeFileSync(
      file,
      await prettier.format(root.toString(), { parser: "css" }),
    );
    console.log(name, stats);
  }
}
/** Optional component consolidation. Only remove supported declarations shadowed by
 * a later supported value of the same property, selector, condition and priority.
 * Caller supplies a browser-verified support predicate; ordinary format:css stays exact-only. */
function pruneShadowed(root, isSupported) {
  if (typeof isSupported !== "function")
    throw Error("A verified support predicate is required");
  const later = new Set(),
    removed = [],
    rules = [];
  root.walkRules((rule) => rules.push(rule));
  for (const rule of rules.reverse()) {
    const conditions = [];
    let eligible = true;
    for (
      let parent = rule.parent;
      parent && parent.type !== "root";
      parent = parent.parent
    ) {
      if (
        parent.type !== "atrule" ||
        !["media", "supports", "container", "layer"].includes(parent.name) ||
        (parent.name === "layer" && !parent.params.trim())
      ) {
        eligible = false;
        break;
      }
      conditions.unshift(parent.name + ":" + parent.params);
    }
    if (!eligible) continue;
    for (const declaration of [...rule.nodes].reverse()) {
      if (
        declaration.type !== "decl" ||
        !isSupported(declaration.prop, declaration.value)
      )
        continue;
      const key = JSON.stringify([
        conditions,
        rule.selector,
        declaration.prop,
        !!declaration.important,
      ]);
      if (later.has(key)) {
        removed.push({
          selector: rule.selector,
          conditions,
          property: declaration.prop,
          value: declaration.value,
          important: !!declaration.important,
          line: declaration.source?.start?.line,
        });
        declaration.remove();
      } else later.add(key);
    }
  }
  return { removed, cleaned: clean(root) };
}
/** Merge only adjacent equal selectors/conditions, without moving declarations
 * across any other rule. Keyframes and order-establishing layers stay untouched. */
function consolidateAdjacent(root) {
  const result = { rules: 0, conditions: 0 };
  function visit(container) {
    if (!container.nodes) return;
    if (container.type === "atrule" && /keyframes$/i.test(container.name))
      return;
    for (const child of [...container.nodes]) visit(child);
    for (let index = 1; index < container.nodes.length;) {
      const previous = container.nodes[index - 1],
        current = container.nodes[index];
      const sameRule =
        previous.type === "rule" &&
        current.type === "rule" &&
        previous.selector === current.selector;
      const sameCondition =
        previous.type === "atrule" &&
        current.type === "atrule" &&
        ["media", "supports", "container"].includes(previous.name) &&
        previous.name === current.name &&
        previous.params === current.params &&
        previous.nodes &&
        current.nodes;
      if (!sameRule && !sameCondition) {
        index++;
        continue;
      }
      previous.append([...current.nodes]);
      current.remove();
      if (sameRule) result.rules++;
      else {
        result.conditions++;
        visit(previous);
      }
    }
  }
  visit(root);
  return result;
}
module.exports = { clean, pruneShadowed, consolidateAdjacent };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
