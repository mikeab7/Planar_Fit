/* menuLayers — WHICH OVERLAY A PRESS BELONGS TO, when two portal menus are open at once.
 *
 * ⛔ THE BUG THIS EXISTS TO CLOSE (B1358128, 2026-09-08). `AnchoredMenu` dismisses itself from a
 * document-level capture `mousedown` listener and stands down only for a press inside its OWN panel
 * or its anchor (B1106256 replaced a rendered click-away backdrop with that listener, for good
 * reasons of its own — see its header). A menu opened ON TOP of it is a SEPARATE portal at
 * `document.body`, so every press inside that second menu reads as "outside" and silently closes
 * the first one. The project switcher's per-row Rename/Delete menu is exactly that shape, and
 * ProjectBreadcrumb.jsx's own comment still asserted the opposite — "a SECOND portal layer above
 * the dropdown's click-away backdrop, so clicking inside it never closes the parent dropdown" —
 * which was TRUE of the backdrop it was written for and became false when the backdrop went away.
 *
 * The consequence was not a cosmetic flicker: the switcher's `[open]` effect clears the row menu's
 * target (`menuFor`) and the inline rename editor (`editingId`) when the dropdown closes, and the
 * Delete row's own state update then ran in the SAME React batch and spread the just-nulled target
 * into a NEW object — `{ ...null, confirm: true }` is truthy — so the confirmation rendered with
 * its project ERASED, asked "Delete this project?", and deleted `undefined`. Rename lost its editor
 * in the same breath. Two owner-reported bugs, one cause.
 *
 * The rule, kept here so it is one decision and not one per consumer: a press inside a menu layer
 * stacked ABOVE mine is not a press outside me. Strictly above — a sibling menu at the same level
 * must still dismiss me, which is what keeps "open one menu, click another trigger" working.
 *
 * Pure and DOM-agnostic by design (it takes the chain of layer values, not a node), so the verdict
 * is unit-testable without a browser: `test/menuLayers.test.js`.
 */

export const MENU_LAYER_ATTR = "data-menu-layer";

/** Pure verdict: does a press whose ancestor menu layers have these stacking values belong to a
 *  layer strictly above `myLayer`? `layers` is outermost-to-innermost or any order — only the max
 *  matters. Non-numeric / absent values are ignored. */
export function pressIsAboveLayer(layers, myLayer) {
  const mine = Number(myLayer);
  if (!Number.isFinite(mine)) return false;
  for (const raw of layers || []) {
    const v = Number(raw);
    if (Number.isFinite(v) && v > mine) return true;
  }
  return false;
}

/** Collect the `data-menu-layer` values on `node` and every ancestor. Returns [] off-DOM. */
export function layersOf(node) {
  const out = [];
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  while (el && el.getAttribute) {
    const v = el.getAttribute(MENU_LAYER_ATTR);
    if (v != null) out.push(v);
    el = el.parentElement;
  }
  return out;
}

/** The one call a dismiss listener makes: should it stand down for this press? */
export function pressBelongsToHigherMenu(target, myLayer) {
  return pressIsAboveLayer(layersOf(target), myLayer);
}
