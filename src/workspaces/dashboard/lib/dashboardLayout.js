/* dashboardLayout — pure model for the Dashboard's arrangeable card grid (B1213313, NEW-1
 * arrangeable-grid rework — the free-form drag/resize/add/remove/reset grid react-grid-layout
 * renders in Dashboard.jsx).
 *
 * A layout is an array of { key, x, y, w, h } — a react-grid-layout-shaped position/size per
 * card, in GRID_COLS-wide grid units. `key` names one of CARD_DEFS; x/y/w/h are the same units
 * react-grid-layout's own onLayoutChange reports, so Dashboard.jsx can round-trip a change with
 * no translation. Array ORDER carries no meaning any more (x/y decide placement) — the narrow/
 * single-column view derives its own top-to-bottom order by sorting on (y, x) at render time.
 *
 * Kept pure and dependency-free so the arrange/persist logic is unit-testable without a browser,
 * a network, or react-grid-layout itself — Dashboard.jsx and dashboardPrefs.js are the only two
 * things that touch React/Supabase/the grid library.
 */

export const GRID_COLS = 12;

// The full card catalog. `title` is the label used in the "Add card" picker; `defaultW`/
// `defaultH` seed a first-run layout; `minW`/`minH` are the floor react-grid-layout enforces
// while resizing, so a card can never be crushed to unreadable. The actual card UI (data fetch +
// render) lives in components/*.jsx, keyed the same way. Sizes are deliberately code, not data —
// adding a new card type here never requires migrating anyone's saved layout (a saved layout
// that doesn't mention it just doesn't place it; see normalizeLayout).
export const CARD_DEFS = {
  jumpBackIn:     { title: "Jump back in",    defaultW: 8, defaultH: 4, minW: 3, minH: 3 },
  // NEW-1 (2026-09-08) — the one picture card among six text/number ones (see
  // components/RecentPlansCard.jsx). minW/minH keep it big enough for a 2x2 grid of
  // recognizable thumbnails before recentPlansLayout.js drops it to two.
  recentPlans:    { title: "Recent plans",    defaultW: 6, defaultH: 8, minW: 4, minH: 5 },
  pipelineStatus: { title: "Pipeline",        defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  // B1161792/B1161793 (NEW-1/NEW-2, Direction C) — the first two real content cards, replacing
  // the placeholder "Pursuits by activity" card (directly superseded by the richer sortable
  // "pursuitsTable" below) with two data-backed cards the owner reviewed and approved in chat.
  needsAttention: { title: "Needs attention", defaultW: 8, defaultH: 9, minW: 4, minH: 5 },
  pursuitsTable:  { title: "Pursuits",        defaultW: 8, defaultH: 9, minW: 5, minH: 5 },
  scheduleHealth: { title: "Schedule health", defaultW: 8, defaultH: 7, minW: 3, minH: 4 },
  compsSummary:   { title: "Comps",           defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  goingQuiet:     { title: "Going quiet",     defaultW: 4, defaultH: 6, minW: 3, minH: 4 },
  // NEW-1 (Locations map card, owner chat block 2026-09-08) — a real interactive map needs real
  // room to be legible; minW/minH keep it from being crushed into an unreadable strip.
  locationsMap:   { title: "Locations",       defaultW: 8, defaultH: 9, minW: 5, minH: 6 },
};

export const CARD_KEYS = Object.keys(CARD_DEFS);

// The order a first-run (or reset) Dashboard packs its cards in — row-major, wrapping at
// GRID_COLS, each card's own defaultW/defaultH. Every catalog card ships by default (NEW-2 — a
// first-run Dashboard must never be empty); a user who wants a leaner view removes what they
// don't need in Customize mode, rather than building one up from nothing.
const DEFAULT_ORDER = [
  "jumpBackIn", "recentPlans", "pipelineStatus", "locationsMap", "needsAttention", "pursuitsTable",
  "scheduleHealth", "compsSummary", "goingQuiet",
];

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Row-major pack: place each key in `order` left-to-right at its own defaultW/defaultH,
 * wrapping to a new row when it wouldn't fit. Deterministic and pure — used both to derive
 * DEFAULT_LAYOUT and to migrate a pre-grid ordered layout (see normalizeLayout). */
function packOrder(order) {
  let x = 0, y = 0, rowH = 0;
  const out = [];
  for (const key of order) {
    const def = CARD_DEFS[key];
    if (!def) continue;
    const w = Math.min(def.defaultW, GRID_COLS);
    if (x + w > GRID_COLS) { x = 0; y += rowH; rowH = 0; }
    out.push({ key, x, y, w, h: def.defaultH });
    x += w;
    rowH = Math.max(rowH, def.defaultH);
  }
  return out;
}

export const DEFAULT_LAYOUT = packOrder(DEFAULT_ORDER);

/** The default arrangement, as a fresh copy — what "Reset layout" restores. */
export function resetLayout() {
  return DEFAULT_LAYOUT.map((e) => ({ ...e }));
}

function isKeyedEntry(e) {
  return !!e && typeof e === "object" && typeof e.key === "string" && !!CARD_DEFS[e.key];
}
function isGridEntry(e) {
  return isKeyedEntry(e) && Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.w) && Number.isFinite(e.h);
}

/** Validate a raw (possibly stored/round-tripped) layout: unknown keys dropped, duplicates
 * dropped (first occurrence wins), positions/sizes clamped to sane bounds (respecting each
 * card's own minW/minH), and an empty/invalid result falls back to DEFAULT_LAYOUT rather than
 * ever rendering a blank grid.
 *
 * Also migrates the PRE-GRID saved shape (`{ key, size: "normal"|"wide" }`, ordered array —
 * B1213313's original release) into the grid shape: an old-format save has no numeric x/y/w/h
 * on any of its entries, so the whole array is treated as an ORDER and re-packed with
 * packOrder(), the same layout a first-run Dashboard would get for that same card order. */
export function normalizeLayout(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const keyed = list.filter(isKeyedEntry);
  if (!keyed.length) return resetLayout();

  const isGridShape = keyed.some((e) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.w) && Number.isFinite(e.h));
  if (!isGridShape) {
    const seen = new Set();
    const order = [];
    for (const e of keyed) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      order.push(e.key);
    }
    return packOrder(order);
  }

  const seen = new Set();
  const out = [];
  for (const e of keyed) {
    if (seen.has(e.key) || !isGridEntry(e)) continue;
    seen.add(e.key);
    const def = CARD_DEFS[e.key];
    const w = clamp(Math.round(e.w), def.minW, GRID_COLS);
    const h = Math.max(Math.round(e.h), def.minH);
    const x = clamp(Math.round(e.x), 0, GRID_COLS - w);
    const y = Math.max(Math.round(e.y), 0);
    out.push({ key: e.key, x, y, w, h });
  }
  return out.length ? out : resetLayout();
}

/** Which catalog cards are not currently in the layout — the "Add card" picker's contents. */
export function availableToAdd(layout) {
  const present = new Set(layout.map((e) => e.key));
  return CARD_KEYS.filter((k) => !present.has(k));
}

/** Add a catalog card back at its default size, appended below whatever is already placed. A
 * removed card re-enters this way, never destroyed (its saved size isn't kept — it gets a fresh
 * default, same as a first-time add). No-op for an already-present or unknown key. */
export function addCard(layout, key) {
  const def = CARD_DEFS[key];
  if (!def || layout.some((e) => e.key === key)) return layout;
  const y = layout.reduce((m, e) => Math.max(m, e.y + e.h), 0);
  return [...layout, { key, x: 0, y, w: def.defaultW, h: def.defaultH }];
}

/** Remove a card from the grid. It goes back into the "Add card" picker (availableToAdd), not
 * destroyed — removing is just leaving it out of this array. */
export function removeCard(layout, key) {
  return layout.filter((e) => e.key !== key);
}

/** Fold react-grid-layout's onLayoutChange payload (an array of { i, x, y, w, h }, `i` matching
 * our `key`) back into our own layout array — the pure half of drag-reorder and corner-resize.
 * Entries react-grid-layout doesn't mention (it always echoes every item, but a defensive fold
 * keeps this correct even if it doesn't) pass through unchanged; array order is preserved since
 * it carries no meaning. */
export function applyGridChange(layout, rglItems) {
  const rglByKey = new Map((Array.isArray(rglItems) ? rglItems : []).map((it) => [it.i, it]));
  return layout.map((e) => {
    const r = rglByKey.get(e.key);
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.w) || !Number.isFinite(r.h)) return e;
    return { key: e.key, x: r.x, y: r.y, w: r.w, h: r.h };
  });
}

/** The narrow/single-column view's reading order: top-to-bottom, left-to-right by the grid
 * position the user actually arranged — never the array's own storage order (see
 * applyGridChange's note: order isn't meaningful once x/y decide placement). */
export function narrowOrder(layout) {
  return [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** react-grid-layout's own layout prop shape for one entry: { i, x, y, w, h, minW, minH }. */
export function toRglItem(entry) {
  const def = CARD_DEFS[entry.key];
  return { i: entry.key, x: entry.x, y: entry.y, w: entry.w, h: entry.h, minW: def?.minW ?? 1, minH: def?.minH ?? 1 };
}
