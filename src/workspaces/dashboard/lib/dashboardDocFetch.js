/* dashboardDocFetch — the last-touched Review document, for the Jump-back-in card (B1213313,
 * NEW-2). A trimmed version of doc-review/lib/reviewStore.js's own `fetchReviews()` shape —
 * avoided here on purpose so this card doesn't statically pull that module's heavier
 * `cloudSync.js`/`siteModel.js` imports for three columns.
 *
 * ⛔ B1340368 (owner report 2026-09-08, "the Last document row dead-ends") — the single most
 * recent NON-DELETED document is not always openable: its own `deleted_at` can be null while
 * the PROJECT it's filed under (`project_id`, mirrors `sites.group_id`) has since been fully
 * deleted or purged. Reproduced live: doc `rvmtov1wtr0459a` ("2026.09.05 planyr-dupe-check")
 * is alive and correctly excluded by neither of the two obvious candidates — it isn't itself
 * soft-deleted, and this query already excludes `deleted_at` rows — but its `project_id`
 * (`smtov116eka7`) resolves to NOTHING in `sites` (a throwaway test project, since torn down).
 * Opening it navigates the route to that dead project id, and Shell.jsx's project-deletion gate
 * (built for the Site Planner, but module-agnostic — it blocks whichever workspace is active)
 * swaps in "This project doesn't exist" instead of ever mounting Doc Review. Neither the
 * document nor the query was ever the bug; the STALE reference is `project_id` itself, and
 * nothing cleared it when its project went away (see storage.js's `purgeProjectFoldersFor`,
 * which now does exactly that at the point a project is confirmed permanently gone).
 *
 * Fixed here by pulling a bounded batch of the most recent non-deleted documents (never just
 * one) and walking them in order for the first one whose filed project is either unset or
 * still live — falling back through the list exactly as the brief asked, and returning null
 * (dropping the line) only when nothing in the batch qualifies.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { liveProjectIds, docProjectIsDead } from "../../../shared/projects/docProjectLiveness.js";

// Bounded fallback depth — a card is not the place for an unbounded account-wide scan; an
// account with 20 consecutive documents all filed under dead projects is not a case this
// falls back past, and the card just drops the line rather than showing a stale one.
const DOC_CANDIDATE_LIMIT = 20;

/** { id, title, project, projectId, updatedAt } for the most recently touched document across
 * every project whose filed project (if any) is still live, or null if there is none / the
 * read failed. */
export async function fetchLastTouchedDoc() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("doc_reviews")
      .select("id, title, project, project_id, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(DOC_CANDIDATE_LIMIT);
    if (error || !Array.isArray(data) || !data.length) return null;
    const projectIds = [...new Set(data.map((d) => d.project_id).filter(Boolean))];
    let live = null;
    if (projectIds.length) {
      // Inconclusive (offline/RLS/thrown) → fail OPEN, same as every other deletion-status
      // check in this codebase: never withhold the whole card on a maybe. docProjectIsDead's
      // own `!liveIds` branch already returns false for every candidate in that case, so
      // `pick` below naturally falls back to the plain most-recent document.
      try { live = await liveProjectIds(projectIds); } catch (_) { live = null; }
    }
    const pick = data.find((d) => !docProjectIsDead(d, live));
    if (!pick) return null;
    return { id: pick.id, title: pick.title || "Untitled document", project: pick.project || null, projectId: pick.project_id || null, updatedAt: pick.updated_at || null };
  } catch (_) {
    return null;
  }
}
