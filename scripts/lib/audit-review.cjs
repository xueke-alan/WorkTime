"use strict";
/** Carry explicit reviews forward only while content and baseline identity match. */
function retainReview(current, previous) {
  if (
    !previous ||
    previous.review?.status !== "reviewed" ||
    current.path !== previous.path ||
    current.category !== previous.category ||
    current.baselineSha256 !== previous.baselineSha256 ||
    current.sha256 !== previous.sha256 ||
    (Object.hasOwn(previous.review, "reviewedSha256") &&
      current.sha256 !== previous.review.reviewedSha256)
  )
    return null;
  if (
    current.sha256 === null &&
    (!current.baselineSha256 ||
      !previous.review.originalPreserved ||
      !["delete", "delete-duplicate"].includes(previous.review.decision))
  )
    return null;
  return { ...previous.review };
}
module.exports = { retainReview };
