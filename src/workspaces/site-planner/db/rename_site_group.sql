-- NEW-1/NEW-2 — rename a PROJECT (a site group) in ONE atomic statement.
-- Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE: adds a function,
-- changes no table, no column and no policy.
--
-- WHY THIS EXISTS
-- A project's name is denormalized: it is copied onto the `site` column (and `data->>'site'`) of
-- every plan row in the group. The client used to rename by iterating the plans it happened to
-- have in LOCAL storage, so any plan not hydrated in that browser was never written — it kept the
-- old name in the cloud and re-published it the next time it saved for any reason. Proven in
-- production: group smrp1wrgg6u5 sat split "Silvestri" (4 plans) / "Sylvestri" (1 plan, saved 17
-- minutes AFTER the rename) and showed as two entries in the map list.
--
-- This makes the rename ONE UPDATE over the whole group. Postgres applies a single statement
-- atomically, so the rename cannot half-land, and it reaches every plan in the group INCLUDING
-- ones the calling browser has never loaded.
--
-- SECURITY
--   • SECURITY INVOKER (the default) — the existing RLS policies on public.sites apply unchanged,
--     so a caller can only ever rename rows they are already permitted to update. No new surface.
--   • `search_path` is pinned, so the function body can't be redirected by a caller's search_path.
--   • It touches ONLY `site`, `data`, `version` and `updated_at`. It never writes `team_id`
--     (which would trip the guard_team_rehome BEFORE UPDATE trigger and could silently unshare a
--     project) and never writes `user_id` or `deleted_at`.
--
-- GROUP MATCHING — the group key is `coalesce(data->>'groupId', id)`, which is EXACTLY what the
-- client's `groupOf()` reads. The `group_id` COLUMN is a denormalized mirror that is known to
-- drift from the jsonb (the e2e fixture rows disagree today), so matching on it would rename the
-- wrong set. Do not "optimise" this onto the column.
--
-- ⛔ DELIBERATE SCOPE, STATED HERE SO IT ISN'T ONLY IMPLICIT IN THE WHERE CLAUSE: this UPDATE
-- carries `and s.deleted_at is null` — an ordinary interactive rename never reaches into the
-- caller's trash. That is correct, but it means a row soft-deleted moments before a group rename
-- keeps its stale name FOREVER, invisible everywhere in the product yet still readable by any
-- query that doesn't filter `deleted_at` (group `smsrpaiqu5sv`'s anchor row sat this way for
-- weeks, B1037954/B1060784). The sibling function `reconcile_site_group_name()`
-- (db/reconcile_site_group_name.sql) is the trash-inclusive twin for exactly that cleanup — never
-- called from the app, only from the account-wide reconciliation script.
--
-- BEFORE THIS RUNS the client degrades to a fetch-the-group-then-write-each-row fallback, which
-- still reaches every plan (fixing the split) but is not atomic — so saving and renaming are never
-- blocked by the migration being un-run; the rename simply isn't atomic yet.

create or replace function public.rename_site_group(
  p_group_id   text,
  p_site       text,
  p_renamed_at bigint
)
returns table (id text, version integer)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  -- ⛔ NEW-1 — REFUSE AN EMPTY STAMP BY NAME. `jsonb_set` is STRICT, so a NULL `p_renamed_at` makes
  -- the whole expression NULL and the statement tries to set `data` to NULL. MEASURED, not assumed:
  -- `public.sites.data` is NOT NULL today, so the attempt aborts the whole group update with
  -- `23502 null value in column "data"` rather than destroying anything — the outcome is safe but
  -- the message names a column the caller never touched, and the safety rests entirely on a
  -- constraint this function does not own. Refusing here says what actually went wrong, and keeps
  -- saying it if that constraint is ever relaxed. Unreachable from today's client (`cloudRenameGroup`
  -- coerces with `Number(renamedAt) || Date.now()`) — which is exactly why it belongs here rather
  -- than being trusted there: this function is granted to `authenticated`, so any caller can reach
  -- it. LOUD-FAILURE: the client surfaces `error.message` straight onto the rename banner.
  if p_renamed_at is null or p_renamed_at <= 0 then
    raise exception 'rename_site_group: p_renamed_at must be a positive epoch-ms timestamp (got %)', p_renamed_at
      using errcode = '22004';
  end if;
  return query
  update public.sites s
     set site       = p_site,
         data       = jsonb_set(
                        jsonb_set(coalesce(s.data, '{}'::jsonb), '{site}', to_jsonb(p_site), true),
                        '{siteRenamedAt}', to_jsonb(p_renamed_at), true),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null
  returning s.id, s.version;
end;
$$;

comment on function public.rename_site_group(text, text, bigint) is
  'Rename a project (site group) in one atomic statement across every plan row in the group. '
  'SECURITY INVOKER — existing RLS on public.sites decides what the caller may rename.';

grant execute on function public.rename_site_group(text, text, bigint) to authenticated;
