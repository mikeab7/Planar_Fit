/* pinAddrCache — the pure, localStorage-backed half of the comp-pin reverse-geocode cache. Split
 * out of CompsPanel.jsx (its original home, B1497889/NEW-2) so a caller that only needs the DISK
 * cache — Dashboard's CompsCard.jsx (B1497890) — never has to reach through the whole comps-panel
 * component chunk (AnchoredMenu, CompEntryGrid, CompDraftsPanel, kmlImport, …) just to read three
 * pure functions.
 *
 * ⛔ MEASURED, NOT ASSUMED: the first cut of B1497890 dynamically imported CompsPanel.jsx directly
 * from CompsCard.jsx to reuse this cache. That changed Rollup's automatic chunk-splitting enough
 * to pull `jurisdiction` (71.4 KB), `compMarkerIcon` (40.9 KB), `localDb` and `countyKeys` onto the
 * SITE PLANNER route's own bundle — a different workspace entirely — and tripped
 * `bundle.siteRouteAllowlist` (ui-audit/perf-bundle-audit.mjs). This file has zero React/JSX and
 * zero other imports, so it can only ever be its own small chunk (or inlined) and can never drag a
 * sibling workspace's chunk graph along for the ride. CompsPanel.jsx re-exports everything here
 * unchanged, so its own callers and MapFinder.jsx's lazy import are unaffected.
 */
export const PIN_ADDR_STORAGE_KEY = "planyr:compPinAddr:v1";
export const PIN_ADDR_STORAGE_MAX = 500; // a bound so a very active account's cache can't grow forever

export function readPinAddrStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_ADDR_STORAGE_KEY) || "null");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (_) { return {}; }
}

// Only a SUCCESSFUL resolution is persisted — a failed/unreachable lookup stays in-memory-only
// (owned by whichever caller is resolving it) so it retries on the next page load rather than
// being remembered as permanently absent.
export function persistPinAddr(key, label) {
  try {
    const store = readPinAddrStorage();
    store[key] = label;
    const entries = Object.entries(store);
    const trimmed = entries.length > PIN_ADDR_STORAGE_MAX ? entries.slice(entries.length - PIN_ADDR_STORAGE_MAX) : entries;
    localStorage.setItem(PIN_ADDR_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch (_) { /* quota / private mode */ }
}

// "lat,lon" -> the cache key a resolved (or persisted) address is stored under.
export function pinCacheKey(anchor) {
  return anchor && typeof anchor.lat === "number" && typeof anchor.lon === "number"
    ? `${anchor.lat.toFixed(6)},${anchor.lon.toFixed(6)}`
    : null;
}
