/* chromeDock.js — B<NEW-B#> (Help/Report button placement) — lets the MAP screen and the SITE
 * PLANNER canvas claim the global Help/Report control as one of THEIR OWN furniture items —
 * stacked with the zoom stack / scale bar / layers control, inside the canvas/map pane — instead
 * of leaving it as separate `position:fixed` app chrome floating over the true viewport corner.
 *
 * Owner, 2026-09-07: "It is also in the wrong place. It should be on the map when it is on the
 * site plan or the map." Everywhere else the control keeps its existing fixed-corner,
 * cornerClearance-avoiding behavior (see cornerClearance.js) — this is additive, not a
 * replacement.
 *
 * Mechanism: a workspace mounts a small DOM node inside its own furniture layer and calls
 * `registerChromeDock(name, el)`; `HelpReportControl.jsx` portals its button into whichever
 * registered dock is CURRENTLY RENDERED (`activeChromeDock()` skips a kept-alive-but-hidden
 * workspace's dock — SitePlannerApp keeps both MapFinder and SitePlanner mounted at once,
 * `display:none`-hiding the inactive one, per that file's own header), falling back to the
 * ordinary fixed-corner placement when no dock is active (every other route).
 *
 * Shell must never statically import a lazy workspace's module (see /CLAUDE.md "Lazy-loaded
 * workspaces") — this is the same shared-DOM-contract shape `data-canvas-corner` already uses
 * for corner AVOIDANCE (cornerClearance.js); this is the DOCKING sibling of it. Deliberately a
 * SEPARATE attribute/registry from `data-canvas-corner` — a dock target is not itself an
 * occupant other chrome must clear, and marking it that way would make it see itself.
 */

const docks = new Map(); // name -> el

export function registerChromeDock(name, el) {
  if (!el) return () => {};
  docks.set(name, el);
  return () => { if (docks.get(name) === el) docks.delete(name); };
}

/* `getClientRects().length === 0` is true for a disconnected node AND for one with a
 * `display:none` ancestor (the kept-alive-but-hidden workspace case) — the same cheap
 * "is this actually on screen" check, without walking computed styles up the tree. */
function isDocked(el) {
  try { return !!el && el.isConnected && el.getClientRects().length > 0; } catch (_) { return false; }
}

export function activeChromeDock() {
  for (const el of docks.values()) { if (isDocked(el)) return el; }
  return null;
}
