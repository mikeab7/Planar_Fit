/* deviceShape.js — pointer-aware "is this device phone-shaped" test (B1447443).
 *
 * The planner's mobile layout (the overlaid, hamburger-summoned Land/Analysis/Yield rail; the
 * right tool rail's own overlay; the phone Properties companion) has always been decided by ONE
 * width-only breakpoint (`FLOAT_MIN_WIDTH`, 760px). That conflates two different questions: "is
 * this screen narrow" and "is this device a phone" — which agree for a phone held upright, and
 * DISAGREE for a phone held sideways. A large iPhone in LANDSCAPE is wider than 760px (so a
 * width-only test reads it as desktop) while still being genuinely short and touch-operated — on
 * the Site surface that left the desktop-styled, non-scrolling icon rail taller than the
 * available height, with its last two entries clipped and NO way to reach them (B1447443).
 *
 * `isPhoneShape` widens the test with one more path: a coarse (touch) pointer AND a short
 * viewport also counts as phone-shaped, even when the width alone would read as desktop. A real
 * desktop window is never `coarsePointer` (a mouse is never coarse), so this can only ever ADD
 * phone-shaped devices to the set the width-only test already caught — it can never turn an
 * actual desktop window (any width, any height, mouse-driven) into a phone. That is what keeps
 * desktop pixel-identical: `coarsePointer` gates the new path shut for every mouse-driven session.
 *
 * Distinct from `propertiesSheet.js`'s `isPhoneSheetMode`, which is deliberately scoped to ONE
 * surface (the Properties bottom sheet) and says explicitly not to generalize it — this is the
 * general phone/desktop LAYOUT decision (which of the two shapes the whole workspace should
 * render in), reusing the same `FLOAT_MIN_WIDTH` token for both the width and the height side of
 * the test rather than inventing a second magic number.
 */
export function isPhoneShape({ narrowWidth, shortHeight, coarsePointer }) {
  return !!narrowWidth || !!(coarsePointer && shortHeight);
}
