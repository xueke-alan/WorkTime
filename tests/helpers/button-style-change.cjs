"use strict";
// Keep the pre-fix fixtures. Accept only the measured, explicitly reviewed
// text correction; control rectangles, icons and every other style stay exact.
module.exports = function reviewedButtonChange(
  current,
  previous,
  sample,
  suite,
) {
  if (current.key !== previous.key) return false;
  const expected = structuredClone(previous);
  const size = parseFloat(previous.styles.fontSize);
  const y = current.rect.length - 1;
  const oa = suite === "summary" && current.key === "SPAN::8";
  if (
    !oa &&
    !current.key.startsWith("SPAN:button-label:") &&
    current.key !== "dayLeaveLabel"
  )
    return false;
  let resized = false;
  if (previous.styles.lineHeight !== current.styles.lineHeight) {
    // Some editor labels and OA previously inherited line-height:1.
    if (parseFloat(previous.styles.lineHeight) !== size) return false;
    if (Math.abs(parseFloat(current.styles.lineHeight) - size * 1.3) > 0.001)
      return false;
    if (Math.abs(current.rect[1] - previous.rect[1] - size * 0.3) > 0.016)
      return false;
    if (Math.abs(parseFloat(current.styles.height) - current.rect[1]) > 0.002)
      return false;
    expected.styles.lineHeight = current.styles.lineHeight;
    expected.styles.height = current.styles.height;
    expected.rect[1] = current.rect[1];
    expected.rect[y] -= (current.rect[1] - previous.rect[1]) / 2;
    resized = true;
  }
  expected.rect[y] +=
    size * (oa && sample.width >= 1800 ? 0.18 : size < 13 ? 0.11 : 0.1);
  if (Math.abs(current.rect[y] - expected.rect[y]) > (resized ? 0.016 : 0.002))
    return false;
  expected.rect[y] = current.rect[y];
  return JSON.stringify(current) === JSON.stringify(expected);
};
