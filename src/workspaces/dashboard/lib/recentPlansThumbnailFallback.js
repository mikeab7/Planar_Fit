/* recentPlansThumbnailFallback — the ONE dynamic-import bridge from the Dashboard into the
 * site-planner workspace's lazy thumbnail generator (NEW-1, 2026-09-08). A plan saved before this
 * feature shipped (or one whose thumbnail write failed) has `thumbnail_svg: null` — the Recent
 * Plans card calls this once per such plan, and never again once a value (even "") comes back.
 *
 * Dynamic on purpose: site-planner/lib/siteThumbnail.js pulls in siteModel.js/planStyle.js/
 * elementRows.js (the row-synced element engine) to rebuild real geometry from `site_elements` —
 * real weight the Dashboard's own static bundle must never carry (dashboardSitesFetch.js's header
 * explains the same discipline for `storage.js`). This keeps that whole graph behind one `import()`
 * that only resolves when a plan genuinely has no thumbnail yet.
 */
export async function lazyGenerateThumbnail(siteId) {
  const { generateAndStoreThumbnail } = await import("../../site-planner/lib/siteThumbnail.js");
  return generateAndStoreThumbnail(siteId);
}
