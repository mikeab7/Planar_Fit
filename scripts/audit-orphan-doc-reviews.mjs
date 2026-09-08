#!/usr/bin/env node
/* B1340368 (owner report 2026-09-08, "the Last document row dead-ends") — one-time catch-up
 * for Doc Review documents filed under a project that no longer resolves to anything live.
 *
 * `storage.js`'s `purgeProjectFoldersFor` now clears `doc_reviews.project_id` (→ "Unfiled")
 * the moment it confirms a project's whole GROUP is genuinely, permanently gone — but that fix
 * only runs GOING FORWARD, on the next purge. This script finds and (optionally) repairs
 * documents that were already orphaned before it existed — the exact shape of the reported
 * bug: doc `rvmtov1wtr0459a` ("2026.09.05 planyr-dupe-check") is alive, correctly excludes
 * itself from every "is this document deleted" check, and still dead-ends on open because its
 * `project_id` (`smtov116eka7`) has no trace anywhere in `sites`.
 *
 * BUCKETS — every filed, non-deleted doc_reviews row's `project_id`, against public.sites,
 * reusing audit-orphan-folders.mjs's own `bucketFor` (never a second copy of the same rule):
 *   - live          — a real, non-deleted sites row (matched by id OR group_id) exists.
 *                     Never touched, never reported as a candidate.
 *   - soft_deleted  — every matching sites row is soft-deleted, but the project could still
 *                     be restored within its 30-day window. Reported ONLY, never an --apply
 *                     candidate — same precedent as audit-orphan-folders.mjs's own soft_deleted
 *                     bucket, and the same reason: the SAME storage.js gate that clears this
 *                     going forward only fires once the project is PERMANENTLY purged, and this
 *                     script must not act any sooner than the app itself would.
 *   - never_existed — no sites row anywhere (matched by id OR group_id). The only bucket
 *                     --apply can ever touch.
 *
 * USAGE (report — always safe, never writes anything):
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-orphan-doc-reviews.mjs
 *
 * USAGE (apply — writes `project_id = null` for the confirmed doc_reviews ids named on the
 * command line, taken from THIS run's own "never_existed" list; anything else is left alone):
 *   … --apply --confirm=<comma-separated doc_reviews ids>
 */
import { createClient } from "@supabase/supabase-js";
import { bucketFor } from "./audit-orphan-folders.mjs";

async function fetchAll(sb, table, cols) {
  const pageSize = 1000; // PostgREST default row cap — page explicitly
  let from = 0, rows = [];
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// Every project id a doc_reviews row could carry — a real sites.id (a legacy/solo project, or
// a specific plan named directly) OR a sites.group_id (the ordinary case: project_id mirrors
// the group). Folded into ONE status map keyed by whichever id was asked, so a solo project
// (id === group_id, or a row with no separate group_id column populated) is judged the same
// way `cloudCheckDeleted`/`groupStillHasLivePlans` already judge it elsewhere in this codebase.
export function statusByProjectId(sites) {
  const byKey = new Map();
  const note = (key, deletedAt) => {
    if (!key) return;
    const cur = byKey.get(key) || { hasLive: false, hasDeleted: false };
    if (deletedAt == null) cur.hasLive = true; else cur.hasDeleted = true;
    byKey.set(key, cur);
  };
  for (const r of sites || []) { note(r.id, r.deleted_at); note(r.group_id, r.deleted_at); }
  return byKey;
}

async function main() {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads every account's documents).");
    process.exit(2);
  }
  const sb = createClient(URL, KEY);

  const APPLY = process.argv.includes("--apply");
  const CONFIRM = (process.argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1] || "";
  const confirmedIds = new Set(CONFIRM.split(",").map((s) => s.trim()).filter(Boolean));

  const [docs, sites] = await Promise.all([
    fetchAll(sb, "doc_reviews", "id,title,project,project_id,updated_at,deleted_at"),
    fetchAll(sb, "sites", "id,group_id,deleted_at"),
  ]);
  const statusByKey = statusByProjectId(sites);

  const candidates = (docs || []).filter((d) => d && !d.deleted_at && d.project_id);
  const buckets = { live: [], soft_deleted: [], never_existed: [] };
  for (const d of candidates) buckets[bucketFor(statusByKey.get(d.project_id))].push(d);

  console.log(`Scanned ${candidates.length} filed, non-deleted doc_reviews row(s) (of ${docs.length} total).`);
  console.log(`  live: ${buckets.live.length} · soft_deleted: ${buckets.soft_deleted.length} · never_existed: ${buckets.never_existed.length}\n`);

  for (const bucketName of ["soft_deleted", "never_existed"]) {
    for (const d of buckets[bucketName]) console.log(`[${bucketName}] ${d.id} — "${d.title}" filed under ${d.project_id} (updated ${d.updated_at})`);
  }

  const eligible = buckets.never_existed; // soft_deleted is still restorable — report only
  console.log(`\n${eligible.length} document(s) confirmed filed under a project with NO trace anywhere, eligible for --apply:`);
  for (const d of eligible) console.log(`  - ${d.id} ("${d.title}")`);

  if (!APPLY) {
    console.log("\nReport only — nothing changed. Re-run with --apply --confirm=<comma-separated doc_reviews ids from the list above> to unfile them.");
    return;
  }

  const toFix = eligible.filter((d) => confirmedIds.has(d.id));
  const skippedConfirm = eligible.filter((d) => !confirmedIds.has(d.id));
  if (skippedConfirm.length) console.log(`\n--apply given but NOT confirmed for: ${skippedConfirm.map((d) => d.id).join(", ")} — left untouched.`);
  if (!toFix.length) { console.log("Nothing confirmed to unfile."); return; }

  console.log(`\nUnfiling ${toFix.length} confirmed document(s)...`);
  for (const d of toFix) {
    const { error } = await sb.from("doc_reviews").update({ project_id: null }).eq("id", d.id);
    if (error) console.error(`  ${d.id}: FAILED — ${error.message}`);
    else console.log(`  ${d.id}: unfiled (was ${d.project_id}).`);
  }
}

// Only run when invoked directly — importing this module (the pure exports, for unit tests)
// must never trigger a real run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
