-- NEW-1 — THE PROJECT-RENAME MARKER MAY NEVER BE WRITTEN EMPTY.
-- Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE: adds two functions
-- and one BEFORE UPDATE trigger. Changes no table, no column, no policy, and rewrites NO EXISTING
-- ROW (the repair for rows already damaged is a separate, deliberately un-run file — see
-- db/rename_stamp_backfill_20260910.sql).
--
-- ============================================================================================
-- THE BUG, MEASURED ON planyr_production 2026-09-10 (not reasoned about)
-- ============================================================================================
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               else jsonb_typeof(data->'siteRenamedAt') end, count(*)
--     from public.sites group by 1;
--
--     null        (the key IS present, and it is EMPTY)     64
--     number      (a real epoch-ms stamp)                   34
--     key-absent  (legacy — predates schema v13)            18
--
-- A key that is PRESENT and null is a WRITE. Nothing absent-by-default produces it. It came from
-- the ordinary client document push: `siteModel.createSiteModel` normalises an unknown marker to
-- an explicit `siteRenamedAt: null`, and `cloudSync.siteRowFor` sends the whole model as `data`,
-- which REPLACES the row's jsonb. So a device whose cached copy predated a rename overwrote that
-- rename's own stamp with an empty one.
--
-- IT IS NOT THEORETICAL. Group `smrp1wrgg6u5` — the Silvestri group this whole invariant was built
-- for — was renamed 2026-07-31T19:23:15.307Z. Four of its five live plans still carry that exact
-- stamp. Plan `sms9c5oc7jnt` carries JSON null with `updated_at` 2026-08-05T19:18:05Z, five days
-- AFTER the rename: a client document write erased a real timestamp. `projectName.nameAuthority`
-- then had nothing to compare — the stamped tier lost a voter and the group fell back to the
-- legacy majority rule, which is exactly the coin flip `siteRenamedAt` exists to replace.
--
-- ============================================================================================
-- WHY A SERVER-SIDE GUARD AND NOT ONLY THE CLIENT FIX
-- ============================================================================================
-- The client half shipped alongside this (`cloudSync.slimForCloud` now omits an unknown marker
-- rather than asserting null — `projectName.normalizeRenameStampForWrite`). That closes the
-- writer. It does NOT close the hole, for two reasons:
--   • The cloud write replaces the whole `data` jsonb, so OMITTING the key erases a real stamp
--     just as thoroughly as writing null did. Something at the row has to keep what the row
--     already knows.
--   • A browser tab can run a bundle for weeks (this repo's own chunk-recovery notes measure
--     exactly that). Every un-upgraded tab is still a live writer of empty markers.
-- The brief's own bar was "make an empty marker impossible rather than merely unlikely". Only a
-- rule at the row can say impossible.
--
-- ============================================================================================
-- THE RULE, IN ONE SENTENCE
-- ============================================================================================
-- An UPDATE that does not itself carry a real millisecond stamp may not clear a stamped row's
-- marker, and may not change that row's project NAME either.
--
-- The second half is not extra scope, it is what keeps the first half from backfiring. Preserving
-- the stamp alone would let an unstamped write land a STALE name on a row that now claims the
-- rename's own timestamp — and in a two-plan group that ties the stamped tier and hands the tie to
-- `updatedAt`, which the stale row wins. Refusing both together is the honest reading: the marker
-- and the name it stamps travel as one fact, and a write that carries neither is not a rename.
-- Every real rename path DOES carry a stamp (`rename_site_group`, its pre-migration document
-- fallback in `cloudRename.js`, and `reconcile_site_group_name`), and test/renameStampIntegrity.js
-- fails the build if that ever stops being true — so this refuses nothing legitimate.
--
-- A BEFORE trigger rather than a CHECK constraint, for the same reason db/sites_county_normalize.sql
-- gives: a CHECK would REJECT the write, turning a silent wrong answer into a hard save failure for
-- a user who was only editing their drawing. Correcting the write is the behaviour we actually
-- want, and the correction is VISIBLE in the product — the project keeps its real name — rather
-- than being a silent revert of something the user asked for. Nobody asked for this name change;
-- a stale client did.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • It never STAMPS a row that has no stamp. Inventing `now()` for an unstamped write would let
--     a stale name win outright — the exact opposite of the fix.
--   • It never enforces monotonicity between two real stamps. `renameSiteGroup` computes
--     `max(now, newest-local-stamp + 1)` from the plans THIS device has cached, so a genuinely
--     later rename from a device with a partial cache can legitimately carry a smaller number;
--     refusing it would freeze the project's name. number → number always passes untouched.
--   • It never touches `deleted_at`, `team_id`, `user_id` or `version`, and it does not care how a
--     group is keyed — it is strictly per-row, so it neither uses nor worsens the known
--     `group_id` column vs `data->>'groupId'` drift (filed separately, out of scope here).
--   • It does not force the `site` COLUMN to mirror `data->>'site'` in general, and that restraint
--     is MEASURED rather than cautious. Exactly one production row disagrees today
--     (`smrkumgymt65`: the column reads `I-10/HWY 90, TX` while the jsonb still holds the raw
--     `  I-10/HWY 90 , , TX`), and there the COLUMN is the better value — a blanket mirror rule
--     would push the uglier string into the name the owner actually sees. So the column is only
--     ever put back in the one branch that refused a jsonb name change, never on its own.
--   • It cannot catch a write that carries a STALE-BUT-REAL stamp alongside a stale name (a device
--     cached before a rename, holding an older stamp). number → number passes untouched, by the
--     rule above. That case is the B1440976 family — a rename losing to a stale cached copy — and
--     it is answered at the PULL, where `siteModel.mergeSiteContent` resolves both fields through
--     `nameAuthority`. This guard neither closes nor widens it; refusing an older stamp here would
--     mean silently freezing the name of any device whose clock runs behind, which is a worse
--     failure than the one it would prevent.

begin;

-- ---------------------------------------------------------------------------
-- 1) The SQL mirror of the client's ONE parse (projectName.js `renameStamp`). A stable, immutable
--    function rather than an inline expression, so the trigger below, the backfill file, and any
--    future audit query provably ask the same question. Tolerates a stamp that arrived as a
--    numeric STRING (PostgREST hands `data->>'siteRenamedAt'` back as text, and some older writers
--    round-tripped it that way); everything else — absent, JSON null, a non-numeric string, zero
--    or negative — is UNKNOWN, which is NOT the same fact as "never renamed".
-- ---------------------------------------------------------------------------
create or replace function public.rename_stamp(v jsonb)
returns bigint
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' and (v #>> '{}')::numeric > 0
      then floor((v #>> '{}')::numeric)::bigint
    when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' and btrim(v #>> '{}')::numeric > 0
      then floor(btrim(v #>> '{}')::numeric)::bigint
    else null
  end;
$$;

comment on function public.rename_stamp(jsonb) is
  'Parse a project-rename marker (epoch ms) out of jsonb. Mirrors projectName.js renameStamp: '
  'absent / JSON null / non-numeric / <= 0 all read as NULL = UNKNOWN, never as "never renamed".';

-- ---------------------------------------------------------------------------
-- 2) The guard.
-- ---------------------------------------------------------------------------
create or replace function public.sites_preserve_rename_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prior_at bigint;
begin
  prior_at := public.rename_stamp(old.data -> 'siteRenamedAt');
  if prior_at is null then return new; end if;                                   -- nothing to protect
  if public.rename_stamp(new.data -> 'siteRenamedAt') is not null then return new; end if; -- a real rename
  if new.data is null or jsonb_typeof(new.data) <> 'object' then return new; end if;

  -- This write is not a rename, so it may not move the name the stamp belongs to. The `site`
  -- COLUMN is put back with it — but only here, inside the branch that actually refused the jsonb
  -- name, so the two never end up announcing different names because of this guard.
  if (new.data ? 'site') and (old.data ? 'site')
     and (new.data ->> 'site') is distinct from (old.data ->> 'site') then
    new.data := jsonb_set(new.data, '{site}', old.data -> 'site', true);
    if new.site is distinct from old.site then new.site := old.site; end if;
  end if;

  new.data := jsonb_set(new.data, '{siteRenamedAt}', to_jsonb(prior_at), true);
  return new;
end;
$$;

comment on function public.sites_preserve_rename_stamp() is
  'An UPDATE carrying no real siteRenamedAt may neither clear a stamped row''s marker nor change '
  'its project name. See db/sites_rename_stamp_guard.sql for the production measurement behind it.';

drop trigger if exists sites_preserve_rename_stamp on public.sites;
create trigger sites_preserve_rename_stamp
  before update on public.sites
  for each row execute function public.sites_preserve_rename_stamp();

commit;

-- Verification (run after):
--   select case when not (data ? 'siteRenamedAt') then 'key-absent'
--               else jsonb_typeof(data->'siteRenamedAt') end as marker, count(*)
--     from public.sites group by 1 order by 2 desc;
--   -- the 'null' bucket must never GROW again from here (existing rows are untouched by this file;
--   -- db/rename_stamp_backfill_20260910.sql is the separate, un-run repair for them).
