/* dashboardCompsFetch — the Comps card's one read (NEW-COMPS-CARD, replacing the old bare-count
 * card — B1213313, NEW-2). The card shows the most recently added comp against its real peers, not
 * a count, so it needs every comp's full row (county, size, rate, dates) rather than just
 * `comp_type` — reuses `shared/comps/lib/compsStore.js`'s `fetchAllComps()` (the same canonical
 * read every other comp consumer in the app uses) rather than a second, narrower select that could
 * drift from it. The derivation itself (which comp is featured, who its peers are, the sentence)
 * is pure and lives in `lib/compsCardModel.js` — this file only fetches.
 */
import { fetchAllComps } from "../../../shared/comps/lib/compsStore.js";

/** Every live comp the signed-in user can see, or `[]` on any failure — LOUD-FAILURE is for
 * writes; a dashboard summary card that can't reach this one source still renders the other cards
 * (Dashboard.jsx's own standing rule), so this degrades to an empty list rather than throwing. */
export async function fetchAllCompsForCard() {
  try {
    const { data, error } = await fetchAllComps();
    if (error) return [];
    return data || [];
  } catch (_) {
    return [];
  }
}
