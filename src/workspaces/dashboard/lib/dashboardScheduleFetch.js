/* dashboardScheduleFetch — the one Supabase read the "Schedule health" card needs.
 *
 * `public.planar_data` holds exactly one row per account (key: the fixed literal "hs-v1",
 * used identically for every user — RLS on `user_id = auth.uid()` does the account-scoping, not
 * the key itself; see src/workspaces/scheduler/db/planar_tables_owner_only_no_team_default.sql).
 * `value` is a ~350 KB jsonb document; `value.projects` is what scheduleHealth.js summarizes.
 *
 * This mirrors the exact call the embedded Scheduler itself makes
 * (public/sequence/index.html's `window.storage.get("hs-v1")`, backed by
 * `.from("planar_data").select("value").eq("key", k).single()`) — same table, same key, same
 * RLS — just a second, independent, read-only caller. Fetched once per Dashboard mount, never
 * on a timer or per-render: the embedded app itself only re-reads on its own load.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const SCHEDULE_KEY = "hs-v1";

/** Returns the raw `value.projects` map, or null if there's no schedule yet / the read failed
 * (never throws — a Dashboard card degrades to "no data" rather than crashing the page). */
export async function fetchScheduleProjects() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("planar_data").select("value").eq("key", SCHEDULE_KEY).maybeSingle();
    if (error || !data?.value) return null;
    return data.value.projects || null;
  } catch (_) {
    return null;
  }
}

/** The moment this account's schedule document was last WRITTEN, in ms — or null when unknown.
 *
 * `public.planar_data` carries no `updated_at` column and no task object carries a temporal field
 * (both re-confirmed against production, 2026-09-08), so this is the only recorded evidence in the
 * system of when a schedule change happened: `public.planar_history` is the append-only ring the
 * embedded Scheduler writes a dated snapshot into on every save (public/sequence/index.html's
 * `_snapshot`, same "hs-v1" key, same own-row RLS). "Since you were last here" uses it as the
 * tightest measured UPPER BOUND on its two snapshot-diffed schedule events — see
 * sinceLastHereFeed.js's header for why a bound is the honest answer and why the floor was wrong.
 *
 * Deliberately selects `created_at` ONLY, never `value`: the newest snapshot's own payload is a
 * ~216 KB jsonb copy of the whole schedule, and this needs one indexed timestamp. Never throws —
 * a null degrades the stamp to `now` (a looser but still true bound), never to a guess. */
export async function fetchScheduleLastWriteAt() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("planar_history")
      .select("created_at")
      .eq("key", SCHEDULE_KEY)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.created_at) return null;
    const ms = Date.parse(data.created_at);
    return Number.isFinite(ms) ? ms : null;
  } catch (_) {
    return null;
  }
}
