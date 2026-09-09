/* labelCollide — pure collide-avoid resolver for the Locations map card's pursuit/active labels
 * (LABEL-COLLIDE, owner report 2026-09-09 — several named pairs of labels, e.g. "Goose Creek and
 * Grand Port", printing directly on top of each other and unreadable). Kept pure and Leaflet/
 * canvas-free so the placement RULE is unit-testable without a browser — LocationsMapCard.jsx
 * supplies the actual screen-space boxes (which do need Leaflet's projection and a canvas text
 * measurement) and this file only ever decides, given a set of boxes and their priority, which
 * ones may show. Comps carry no label and never reach this module.
 *
 * The rule is collide-avoid, not clustering: every marker keeps its dot regardless of the
 * decision here, and a label that loses is simply not drawn (never shrunk, never truncated) until
 * panning or zooming apart gives it room. Active projects are considered before pursuits, and are
 * only ever beaten by another active — "the active projects keep their labels in preference to
 * pursuits, because those are the three he actually needs to read." Within one priority tier,
 * placement follows the order the caller passed (stable) — there's no further tie-break.
 */

export function boxesOverlap(a, b, pad = 0) {
  return !(a.right + pad < b.left || b.right + pad < a.left || a.bottom + pad < b.top || b.bottom + pad < a.top);
}

const PRIORITY = { active: 0, pursuit: 1 };

/** `items` — [{ id, kind: "active"|"pursuit", box: {left, top, right, bottom} }], any order.
 * Returns a Set of the ids whose label may be shown. A lower-priority label (or a same-priority
 * one placed later) whose box collides with an already-placed one is left out. */
export function resolveLabelVisibility(items, pad = 0) {
  const ordered = [...(items || [])].sort((a, b) => (PRIORITY[a.kind] ?? 1) - (PRIORITY[b.kind] ?? 1));
  const placed = [];
  const visible = new Set();
  for (const item of ordered) {
    const collides = placed.some((p) => boxesOverlap(item.box, p, pad));
    if (!collides) {
      visible.add(item.id);
      placed.push(item.box);
    }
  }
  return visible;
}
