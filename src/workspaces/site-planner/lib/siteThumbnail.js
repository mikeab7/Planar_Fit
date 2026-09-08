/* siteThumbnail — writes the Dashboard's per-plan thumbnail (site_thumbnail.sql's
 * `sites.thumbnail_svg` / `thumbnail_updated_at`), NEW-1 2026-09-08.
 *
 * Two entry points, one write:
 *  - `refreshSiteThumbnailFromModel(model)` — the "refresh on save" path. Called (fire-and-forget,
 *    best-effort) right after a real cloud save from storage.js's pushSiteToCloud, using the
 *    model already held in memory — it already carries real `els`/`parcels`, so no extra fetch.
 *  - `generateAndStoreThumbnail(siteId)` — the Dashboard's lazy-generate-once fallback, for a plan
 *    that has never been saved since this feature shipped (thumbnail_svg is still null). Rebuilds
 *    a renderable model from the row-synced element engine (fetchElements + rowsToModel — the SAME
 *    reconstruction the planner itself uses to open a plan; see elementRows.js's own header on why
 *    hand-rolling a second one here would be a real risk, not a shortcut) rather than reading
 *    `sites.data`, whose els/parcels are deliberately emptied for a synced plan
 *    (cloudSync.js's slimForCloud — B672 read cutover).
 *
 * Both write via a plain `update`, deliberately OUTSIDE cloudSync.js's CAS/version-guarded upsert
 * engine — see site_thumbnail.sql's header for why that's the right call for a derived, always-
 * regenerable field (TIER-BY-REBUILDABILITY) with exactly one writer per plan and nothing to
 * conflict over. Best-effort throughout: a thumbnail is a rendering convenience (like
 * shared/sitePlans/lib/overlayRasterStorage.js's raster cache), never user data, so a failure here
 * is swallowed rather than surfaced (LOUD-FAILURE governs real writes, not this).
 */
import { supabase } from "./supabase.js";
import { planThumbnailSvg } from "./planThumbnail.js";

async function persistThumbnail(siteId, svg) {
  if (!supabase || !siteId) return;
  try {
    await supabase
      .from("sites")
      .update({ thumbnail_svg: svg, thumbnail_updated_at: new Date().toISOString() })
      .eq("id", siteId);
  } catch (_) {
    // best-effort — a lost thumbnail write just means the next save (or the Dashboard's own
    // lazy fallback) tries again; it never blocks or reports against the real content save.
  }
}

/** Refresh one plan's stored thumbnail from a live in-memory model (real els/parcels). Never
 * throws, never returns anything the caller needs to check — call it and move on. */
export async function refreshSiteThumbnailFromModel(model) {
  if (!model || !model.id) return;
  const svg = planThumbnailSvg(model) || "";
  await persistThumbnail(model.id, svg);
}

/** Lazily render + store a thumbnail for a plan that doesn't have one yet, from the cloud's own
 * row-synced element rows (never assumes the caller has this plan open/loaded locally). Returns
 * the SVG string (possibly "" if the plan has nothing drawable) so the caller can use it
 * immediately without a second read; returns null if it couldn't even attempt this (signed out,
 * fetch failed) — the caller should treat that the same as "still no thumbnail" and try again
 * another visit, never write a "" sentinel for a failure that wasn't a genuine empty-plan render. */
export async function generateAndStoreThumbnail(siteId) {
  if (!supabase || !siteId) return null;
  try {
    const [{ fetchElements }, { rowsToModel }] = await Promise.all([
      import("./elementApi.js"),
      import("./elementRows.js"),
    ]);
    const { data: headerRow } = await supabase.from("sites").select("data").eq("id", siteId).single();
    const r = await fetchElements(supabase, siteId);
    if (!r.ok) return null;
    const header = { settings: (headerRow && headerRow.data && headerRow.data.settings) || {} };
    const model = rowsToModel(header, r.rows);
    const svg = planThumbnailSvg(model) || "";
    await persistThumbnail(siteId, svg);
    return svg;
  } catch (_) {
    return null;
  }
}
