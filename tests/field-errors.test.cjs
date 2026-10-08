"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const realm = vm.createContext({});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/ui/elements.js", "utf8") +
    ";globalThis.Errors=WorkTimeApp.ui.fieldErrors",
  realm,
);
const errors = realm.Errors,
  primary = { textContent: "" },
  secondary = { textContent: "" };
errors.show(primary, { code: "UNSAVED", message: "translated warning" });
primary.textContent = "a different translation";
errors.saved(primary);
assert.equal(primary.textContent, "");
errors.show(primary, { code: "VALIDATION", message: "same warning" });
errors.saved(primary);
assert.equal(
  primary.textContent,
  "same warning",
  "Saving cannot erase invalid input",
);
errors.show(secondary, { code: "VALIDATION", message: "same warning" });
errors.clearRelated(primary, secondary);
assert.equal(
  primary.textContent,
  "same warning",
  "Equal text does not mean the same error",
);
const shared = { code: "VALIDATION", message: "shared day error" };
errors.show(primary, shared);
errors.show(secondary, shared);
errors.clearRelated(primary, secondary);
assert.equal(primary.textContent, "");
assert.equal(secondary.textContent, "");
errors.show(primary, { code: "UNSAVED", message: "old failed write" });
errors.clear(primary);
primary.textContent = "unmanaged new validation";
errors.saved(primary);
assert.equal(
  primary.textContent,
  "unmanaged new validation",
  "Clearing releases the old cause",
);
console.log(
  "Field feedback passed: cause-based recovery, validation retained, linked errors independent of translation and stale cause released.",
);
