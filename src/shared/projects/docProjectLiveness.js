/* docProjectLiveness — B1340368, "the Last document card offers a document filed under a
 * project that no longer exists." Shared by any surface that offers/lists a `doc_reviews` row
 * filed under a project: never offer or open one whose filed project is gone.
 *
 * ⛔ B1340368 (×2), recurrence 2026-09-09 — offering and opening read TWO
 * different copies of "which project is this doc filed under," and B1340368 only fixed one of
 * them. The Dashboard/Library OFFER-time checks below (docProjectIsDead) read the flat
 * `doc_reviews.project_id` mirror column; the OPEN path (DocReview.jsx's loadSingleReview) reads
 * the review's own record — the `data` jsonb reviewStore.loadReview returns — whose `projectId`
 * field is a SEPARATE copy of the same fact. Every ordinary save keeps the two in lockstep
 * (reviewRowFor mirrors one straight from the other), but storage.js's purgeProjectFoldersFor →
 * reviewStore.unfileReviewsForDeletedProject nulled only the flat column, out of band — so a
 * document a project purge had already made safe to OFFER (flat column null) could still carry
 * a dead project id in its own record, and opening it navigated straight to that dead id. Fixed
 * at both ends: unfileReviewsForDeletedProject now clears both copies (this file's own edit
 * doesn't touch that — see reviewStore.js), and `openableProjectId` below re-checks liveness at
 * the one place that actually navigates, so a record's own stale copy can never win either way.
 *
 * `doc_reviews.project_id` mirrors `sites.group_id` (doc-review/db/project_library.sql's own
 * column comment), so liveness is asked the SAME group-aware way `cloudCheckDeleted`
 * (site-planner/lib/cloudSync.js, B1164192) already asks it for the route gate — a live row
 * anywhere in the group (matched either as its own id, for a legacy pre-groupId row or a
 * solo project, or as a sibling's group_id) is enough. A project id that resolves to nothing
 * live — soft-deleted, hard-purged, or never a real row at all — is DEAD, and no doc filed
 * under it may be offered as openable.
 *
 * Deliberately its own small module rather than importing cloudSync.js's `cloudCheckDeleted` —
 * every consumer of this file (the Dashboard card, the Library Home Recent/Pinned lists) is
 * bundle-conscious and only needs the lightweight supabase client, not the ~36 KB sync engine.
 */
import { supabase } from "../../workspaces/site-planner/lib/supabase.js";

/** Of these candidate project ids, which are still LIVE (at least one non-deleted plan sharing
 * that id or group_id)? Batches every candidate into two indexed queries rather than one round
 * trip per id. Throws on a real fetch error — the caller decides how to fail; this never
 * silently reports "none are live" on a network blip, which would hide every candidate. */
export async function liveProjectIds(ids) {
  const candidates = [...new Set((ids || []).filter(Boolean))];
  if (!supabase || !candidates.length) return new Set();
  const [byId, byGroup] = await Promise.all([
    supabase.from("sites").select("id, group_id, deleted_at").in("id", candidates),
    supabase.from("sites").select("id, group_id, deleted_at").in("group_id", candidates),
  ]);
  const error = byId.error || byGroup.error;
  if (error) throw new Error(error.message || "project liveness check failed");
  const live = new Set();
  for (const r of [...(byId.data || []), ...(byGroup.data || [])]) {
    if (!r || r.deleted_at) continue;
    if (r.id && candidates.includes(r.id)) live.add(r.id);
    if (r.group_id && candidates.includes(r.group_id)) live.add(r.group_id);
  }
  return live;
}

/** Is this doc's FILED PROJECT dead? Pure — takes the Set liveProjectIds returned, never
 * queries anything itself, so it's usable synchronously in a render/filter pass once the
 * async liveness check has resolved. A doc with no project_id is never "dead" by this rule —
 * it isn't filed to anything that could go stale. A missing/not-yet-loaded `liveIds` (null)
 * fails OPEN (never dead on a maybe) — the caller decides separately whether "doc not found at
 * all" (a falsy `doc`) counts as its own kind of unopenable. */
export function docProjectIsDead(doc, liveIds) {
  if (!doc || !doc.project_id) return false;
  if (!liveIds) return false;
  return !liveIds.has(doc.project_id);
}

/** The project id a just-opened document's OWN record should actually navigate to. `rec` is a
 * review record as `reviewStore.loadReview` returns it (the `data` jsonb, not the flat mirror
 * row) — its `projectId` field can lag a purge that already cleared the mirror column (see this
 * file's own header). Re-runs the same liveness predicate against the record's copy so a
 * document that is safe to OPEN can never route to a project id nothing resolves any more,
 * whichever copy of the fact it came from. Fails OPEN on an inconclusive check (`liveIds` null —
 * offline/RLS/thrown), same as `docProjectIsDead` — never blocks an ordinary open on a maybe. */
export function openableProjectId(rec, liveIds) {
  const pid = (rec && rec.projectId) || null;
  if (!pid) return null;
  return docProjectIsDead({ project_id: pid }, liveIds) ? null : pid;
}
