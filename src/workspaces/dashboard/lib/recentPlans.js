/* recentPlans — pure selection for the Dashboard's "Recent plans" card (NEW-1, 2026-09-08). Reads
 * the SAME `sites` rows every other card on this screen shares (dashboardSitesFetch.js) — already
 * sorted newest-edited-first and already excluding every deleted plan. A project delete
 * soft-deletes every plan sharing its group_id (cloudSync.js's cloudDeleteGroup), so
 * `deleted_at is null` already covers "plan deleted" AND "plan's project deleted" — there is no
 * separate flag to check here, and "fall through to the next one that still exists" falls straight
 * out of taking the top N of an already-filtered list: there is no gap to skip over.
 */
const displayName = (row) => (row && (row.site || row.name || "").trim()) || "Untitled";

/** The `limit` most recently edited plans, as the card's own row shape. `thumbnailSvg` is null
 * when no thumbnail has been generated yet (the card's cue to lazily generate one), "" when a
 * generation attempt found nothing drawable, or a real `<svg>...</svg>` string. */
export function pickRecentPlans(siteRows, limit) {
  return (siteRows || [])
    .filter((r) => r && r.id)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      groupId: r.group_id || r.id,
      name: displayName(r),
      updatedAt: r.updated_at || null,
      thumbnailSvg: r.thumbnail_svg == null ? null : r.thumbnail_svg,
    }));
}
