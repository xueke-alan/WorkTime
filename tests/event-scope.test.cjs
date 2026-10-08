"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/ui/elements.js", "utf8") +
    ";globalThis.UI=WorkTimeApp.ui",
  context,
);
const scope = context.UI.createEventScope(),
  target = new EventTarget();
let calls = 0;
const click = () => calls++;
scope.listen(target, "click", click);
target.dispatchEvent(new Event("click"));
assert.equal(calls, 1);
scope.dispose();
scope.dispose();
target.dispatchEvent(new Event("click"));
assert.equal(calls, 1, "Disposed scope releases listeners");
scope.listen(target, "click", click);
target.dispatchEvent(new Event("click"));
assert.equal(calls, 2, "Remount registers once");
const button = { onclick: click },
  old = button.onclick,
  installed = () => {};
scope.handler(button, "onclick", installed);
scope.dispose();
assert.equal(button.onclick, old);
scope.handler(button, "onclick", installed);
button.onclick = click;
scope.dispose();
assert.equal(
  button.onclick,
  click,
  "Release does not erase another owner's handler",
);
console.log(
  "Event scope: listener removal, idempotent disposal, remount and handler ownership passed.",
);
