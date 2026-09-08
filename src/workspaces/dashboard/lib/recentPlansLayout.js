/* recentPlansLayout — pure sizing rule for the Dashboard's "Recent plans" card (NEW-1,
 * 2026-09-08). At the card's default size it's a 2x2 grid of four thumbnails; resized down, the
 * grid drops to two side-by-side thumbnails rather than shrinking all four into an unrecognizable
 * mush — the owner's own bar: "at small sizes drop to two thumbnails rather than shrinking four."
 * Pure/dependency-free so it's unit-testable without a browser; the card measures its own content
 * box with a ResizeObserver (the same pattern NeedsAttentionCard.jsx already uses for its bar
 * chart) and feeds the pixels in here.
 */

// A thumbnail narrower than this reads as a blur, not a shape — this is the actual floor the
// task asks for ("a minimum size below which the thumbnails stop being recognizable"), enforced
// by dropping to two thumbnails before ever rendering one this small. The card's own CARD_DEFS
// minW/minH (dashboardLayout.js) keep even a "row2" thumbnail comfortably above it.
export const MIN_THUMB_PX = 84;
// Name + timestamp lines under each thumbnail.
const TEXT_BLOCK_PX = 34;
const GRID_GAP_PX = 10;

/** The card's current content-box size (px) → "grid2x2" (all four, 2 rows) or "row2" (the two
 * most recent, one row). Always returns a mode — never blank. */
export function recentPlansLayoutMode({ width, height }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const cellW = (w - GRID_GAP_PX) / 2;
  const cellH2Rows = (h - GRID_GAP_PX) / 2;
  const thumbH2Rows = cellH2Rows - TEXT_BLOCK_PX;
  const fitsGrid2x2 = cellW >= MIN_THUMB_PX && thumbH2Rows >= MIN_THUMB_PX * 0.7;
  return fitsGrid2x2 ? "grid2x2" : "row2";
}

/** How many plans a mode shows, most-recent-first. */
export function countForMode(mode) {
  return mode === "grid2x2" ? 4 : 2;
}
