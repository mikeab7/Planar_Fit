/* dashboardPrefs — per-user persisted Dashboard card layout (B1213313, NEW-2).
 *
 * Reuses the SAME account-scoped store the Site Planner's Standards panel uses
 * (`public.profiles.prefs` jsonb, own-row RLS — src/workspaces/site-planner/db/user_prefs.sql)
 * so no new migration is needed: this just adds one more top-level key, `dashboardLayout`.
 *
 * Deliberately does NOT import `site-planner/lib/userPrefs.js`, even though it manages the
 * same column: that module's `applyPrefs()` also pushes plan-standards defaults into
 * `planStyle.js`/`measureStyle.js`, which pulls a good slice of the Site Planner's rendering
 * code into whatever chunk imports it. The Dashboard has nothing to do with plan styling, so
 * it talks to `profiles.prefs` directly — the same jsonb bag, a different, independent reader/
 * writer, touching only its own key. A read-modify-write (never a bare `{dashboardLayout}`
 * write) is what keeps this from clobbering the OTHER keys (planStandards, sitesPanel, …) a
 * concurrent Site Planner session might be writing to the same row.
 *
 * Same shape as userPrefs.js on purpose (mirror-then-cloud, LOUD-FAILURE, a `source` the UI can
 * report) — proven pattern, just narrower.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { normalizeLayout, normalizeDismissed, appendNewCatalogCards } from "./dashboardLayout.js";

const MIRROR_KEY = "planyr:dashboardLayout:v1";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

// The mirror's shape grew a second field (B1422496 — `dismissed`, the deliberately-removed-card
// list catalog reconciliation needs; see dashboardLayout.js's own header). A pre-existing mirror
// is just the bare layout array — read as `{ layout: <that array>, dismissed: undefined }` so
// normalizeDismissed's own bootstrap default (see below) applies to it exactly as it does to a
// legacy cloud row.
function readMirror() {
  if (!hasLS()) return { layout: null, dismissed: undefined };
  try {
    const raw = JSON.parse(localStorage.getItem(MIRROR_KEY) || "null");
    if (Array.isArray(raw)) return { layout: raw, dismissed: undefined };
    if (raw && typeof raw === "object") return { layout: raw.layout ?? null, dismissed: raw.dismissed };
    return { layout: null, dismissed: undefined };
  } catch { return { layout: null, dismissed: undefined }; }
}
function writeMirror(layout, dismissed) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ layout, dismissed })); } catch { /* quota / private mode */ }
}

/** Load the signed-in user's Dashboard layout, reconciled against the current card catalog
 * (B1422496 — appendNewCatalogCards adds any card the user hasn't placed or dismissed, so a card
 * shipped after this layout was last saved reaches it without the user opening Customize; see
 * dashboardLayout.js's own header for the full reasoning and the dismissed-card bootstrap rule).
 * Returns { layout, dismissed, source } where source is "cloud" (the account row) or "local"
 * (mirror only — signed out, or the read failed). Never throws — a prefs read can't be allowed to
 * block the Dashboard from rendering its default. */
export async function loadDashboardLayout(uid) {
  const mirror = readMirror();
  const mirrorLayout = normalizeLayout(mirror.layout);
  const mirrorDismissed = normalizeDismissed(mirror.dismissed, mirrorLayout);
  if (!supabase || !uid) {
    return { layout: appendNewCatalogCards(mirrorLayout, mirrorDismissed), dismissed: mirrorDismissed, source: "local" };
  }
  try {
    const { data, error } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (error) {
      return { layout: appendNewCatalogCards(mirrorLayout, mirrorDismissed), dismissed: mirrorDismissed, source: "local", error: error.message };
    }
    const rawLayout = normalizeLayout(data?.prefs?.dashboardLayout);
    const dismissed = normalizeDismissed(data?.prefs?.dashboardDismissedCards, rawLayout);
    const layout = appendNewCatalogCards(rawLayout, dismissed);
    writeMirror(layout, dismissed);
    return { layout, dismissed, source: "cloud" };
  } catch (e) {
    return { layout: appendNewCatalogCards(mirrorLayout, mirrorDismissed), dismissed: mirrorDismissed, source: "local", error: e?.message || "layout load failed" };
  }
}

/** Persist a layout + its dismissed-card list. Mirror first (instant, and the signed-out
 * fallback), then a read-modify-write of the cloud row so every OTHER key already in `prefs`
 * survives untouched. LOUD-FAILURE: a failed cloud write is reported, never swallowed into a
 * silent "saved". `dismissed` is normalized against `layout` — pass the caller's actual tracked
 * list (never omit it), since an omitted/undefined value here would re-trigger the bootstrap
 * default and mark everything currently missing as dismissed. */
export async function saveDashboardLayout(uid, layout, dismissed) {
  const next = normalizeLayout(layout);
  const nextDismissed = normalizeDismissed(dismissed, next);
  writeMirror(next, nextDismissed);
  if (!supabase || !uid) return { ok: false, layout: next, dismissed: nextDismissed, error: "not signed in" };
  try {
    const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (readErr) return { ok: false, layout: next, dismissed: nextDismissed, error: readErr.message };
    const prevPrefs = (row?.prefs && typeof row.prefs === "object") ? row.prefs : {};
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: uid, prefs: { ...prevPrefs, dashboardLayout: next, dashboardDismissedCards: nextDismissed }, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) return { ok: false, layout: next, dismissed: nextDismissed, error: error.message };
    return { ok: true, layout: next, dismissed: nextDismissed };
  } catch (e) {
    return { ok: false, layout: next, dismissed: nextDismissed, error: e?.message || "layout save failed" };
  }
}
