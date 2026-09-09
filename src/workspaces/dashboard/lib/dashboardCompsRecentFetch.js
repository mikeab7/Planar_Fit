/* dashboardCompsRecentFetch — the comps the "Since you were last here" card needs: comps ADDED
 * since a given moment, with enough fields to state their rate and size (never just "a comp was
 * added"). Deliberately separate from dashboardCompsFetch.js (which reads only `comp_type` for the
 * Comps summary card's counts) — this reads the real deal fields, but still only the ones
 * lib/sinceLastHereFeed.js's `compRateLine` needs, bounded by a `created_at` filter rather than an
 * account-wide pull.
 *
 * ⛔ Deliberately does NOT import `shared/comps/lib/comps.js`'s `rowToComp` — measured: doing so
 * pulled a brand-new "comps" chunk onto the Site Planner's own route (`perf:bundle`'s
 * `siteRouteAllowlist` gate), because that module is also reached (dynamically) from
 * `CompsPanel.jsx`, and Rollup gives a multi-consumer module its own shared chunk that then rides
 * every consumer's graph. The handful of snake_case→camelCase fields this card needs are mapped by
 * hand below instead — the same "duplicated rather than shared, for a measured bundle reason"
 * pattern `releaseCanvas.js`/`ParcelDataPanel.jsx`'s `MONO_FONT` already use in this codebase.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const COLUMNS = [
  "id", "title", "comp_type", "created_at", "project_id",
  "land_price", "land_size_value", "land_size_unit",
  "bldg_price", "bldg_size_sf",
  "lease_rate", "lease_rate_period", "lease_rate_expense", "lease_size_sf",
].join(", ");

function rowToCompLite(r) {
  return {
    id: r.id,
    projectId: r.project_id || null,
    compType: r.comp_type,
    title: r.title || "",
    createdAt: r.created_at,
    landPrice: r.land_price != null ? Number(r.land_price) : null,
    landSizeValue: r.land_size_value != null ? Number(r.land_size_value) : null,
    landSizeUnit: r.land_size_unit || null,
    bldgPrice: r.bldg_price != null ? Number(r.bldg_price) : null,
    bldgSizeSf: r.bldg_size_sf != null ? Number(r.bldg_size_sf) : null,
    leaseRate: r.lease_rate != null ? Number(r.lease_rate) : null,
    leaseRatePeriod: r.lease_rate_period || null,
    leaseRateExpense: r.lease_rate_expense || null,
    leaseSizeSf: r.lease_size_sf != null ? Number(r.lease_size_sf) : null,
  };
}

/** Every live comp created at/after `sinceIso`, newest first. Returns [] on any failure. */
export async function fetchRecentComps(sinceIso) {
  if (!supabase || !sinceIso) return [];
  try {
    const { data, error } = await supabase
      .from("comps")
      .select(COLUMNS)
      .is("deleted_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data.map(rowToCompLite);
  } catch (_) {
    return [];
  }
}
