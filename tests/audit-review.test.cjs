"use strict";
const assert = require("node:assert/strict"),
  { retainReview } = require("../scripts/lib/audit-review.cjs");
const previous = {
  path: "assets/js/example.js",
  category: "runtime",
  baselineSha256: "original",
  sha256: "reviewed",
  review: {
    status: "reviewed",
    decision: "retain",
    reviewedSha256: "reviewed",
    reason: "Specific prior decision.",
  },
};
const current = { ...previous, review: { status: "pending" } };
assert.deepEqual(retainReview(current, previous), previous.review);
assert.notEqual(
  retainReview(current, previous),
  previous.review,
  "No mutable alias to prior review",
);
for (const field of ["path", "category", "baselineSha256", "sha256"])
  assert.equal(
    retainReview({ ...current, [field]: "changed" }, previous),
    null,
    field,
  );
assert.equal(
  retainReview(current, {
    ...previous,
    review: { ...previous.review, reviewedSha256: "different" },
  }),
  null,
);
assert.equal(
  retainReview(current, { ...previous, review: { status: "pending" } }),
  null,
  "Unchanged bytes do not create semantic approval",
);
assert.equal(retainReview(current, null), null);
const removed = {
  ...previous,
  sha256: null,
  review: {
    status: "reviewed",
    decision: "delete-duplicate",
    reviewedSha256: null,
    originalPreserved: true,
  },
};
assert.deepEqual(retainReview(removed, removed), removed.review);
assert.equal(
  retainReview(
    { ...removed, baselineSha256: null },
    { ...removed, baselineSha256: null },
  ),
  null,
  "Unprotected deleted files cannot inherit approval",
);
assert.equal(
  retainReview(removed, {
    ...removed,
    review: { ...removed.review, originalPreserved: false },
  }),
  null,
);
assert.equal(
  retainReview(removed, {
    ...removed,
    review: { ...removed.review, decision: "retain" },
  }),
  null,
);
console.log(
  "Audit review passed: exact content/baseline/category binding, pending remains pending, protected deletion and detached inherited metadata.",
);
