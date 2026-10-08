"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [
  ...html.matchAll(/<script(?: defer)? src="(assets\/[^" ]+\.js)"><\/script>/g),
].map((match) => match[1]);
assert.equal(
  scripts[0],
  "assets/js/namespace.js",
  "Namespace precedes early theme and deferred data modules",
);
assert.equal(
  new Set(scripts).size,
  scripts.length,
  "Each production script loads once",
);
assert(
  !scripts.includes("assets/js/core.js"),
  "Old facade is absent from production",
);
let declarations = 0;
function inspect(node, file) {
  if (
    node.type === "AssignmentExpression" &&
    node.left.type === "MemberExpression"
  ) {
    const member = node.left;
    if (
      !member.computed &&
      member.object.type === "Identifier" &&
      ["window", "globalThis", "g"].includes(member.object.name) &&
      /^[A-Z]/.test(member.property.name)
    )
      assert.fail(file + " exports a separate global: " + member.property.name);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) inspect(child, file);
    } else if (value?.type) inspect(value, file);
  }
}
for (const file of scripts.filter(
  (file) => !file.startsWith("assets/vendor/"),
)) {
  const tree = acorn.parse(fs.readFileSync(path.join(root, file), "utf8"), {
    ecmaVersion: "latest",
  });
  for (const statement of tree.body) {
    if (statement.type === "VariableDeclaration")
      for (const declaration of statement.declarations) {
        assert.equal(
          declaration.id.name,
          "WorkTimeApp",
          file + " adds a top-level binding",
        );
        declarations++;
      }
    assert.notEqual(
      statement.type,
      "FunctionDeclaration",
      file + " adds a top-level function",
    );
  }
  inspect(tree, file);
}
assert.equal(declarations, 1, "The project has one namespace declaration");
console.log(
  "Namespace contract passed: unique ordered scripts, one project binding, no separate module globals or facade.",
);
