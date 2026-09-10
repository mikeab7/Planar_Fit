-- ============================================================================
-- B1482000 (follow-on to B1469872, owner report 2026-09-10) — "every row in the new 'Recently
-- deleted' plan list is labelled with the project name, so identical rows can't be told apart."
--
-- Reproduces the exact query shapes storage.js/cloudSync.js run against the REAL `sites` table
-- and confirms, at the schema level, that:
--   1. `site` is the PROJECT name and `name` is the PLAN name — distinct columns, and a soft-
--      deleted plan's own `name` is what a per-project trash list must read (listDeletedPlansInGroup),
--      never `site`.
--   2. `cloudCheckDeleted`'s two-query shape (`id = :id` OR `group_id = :id`) genuinely cannot see
--      a deleted plan's siblings when `:id` is that plan's OWN id rather than its group's anchor —
--      this is the gap `checkProjectDeletionStatus`'s new supplementary group check closes (the
--      deep-link "This project was deleted" dialog case).
--   3. Restore (deleted_at -> null) round-trips for a non-anchor plan exactly like it does for an
--      anchor.
--
-- Mirrors the self-rolling-back shape of sites_soft_delete_rls.test.sql: every id here is a
-- throwaway `rlstest-dpn-*` fixture on synthetic auth.users rows, run as the fixture owner under
-- RLS (not as postgres), so this also proves the app's own queries — not a superuser's — see what
-- they need to see. Nothing belonging to a real account (Michael's included) is read or written,
-- and the whole thing rolls back regardless of outcome (the raised exception at the end is
-- deliberate). Paste into the Supabase SQL editor (or run via execute_sql) and read the report out
-- of the raised exception.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0e03';  -- throwaway owner
  -- Scenario A (mirrors the owner's real Bain repro): a project with TWO plans, one of them
  -- soft-deleted and NOT the group's anchor.
  bain_anchor text := 'rlstest-dpn-bain-a';   -- live plan, also the group's anchor id
  bain_plan2  text := 'rlstest-dpn-bain-b';   -- soft-deleted plan, group_id points at the anchor
  -- Scenario B (mirrors the owner's real Woods Road repro): three plans in one group, two
  -- soft-deleted plans sharing the exact same PLAN name — only `deleted_at` tells them apart.
  wr_anchor text := 'rlstest-dpn-wr-a';       -- live
  wr_plan2  text := 'rlstest-dpn-wr-b';       -- soft-deleted, "Concept A PRINT"
  wr_plan3  text := 'rlstest-dpn-wr-c';       -- soft-deleted, "Concept A PRINT" (same name, different id/time)
  n int;
  row_name text;
  row_site text;
  group_id_seen text;
  live_count int;
  older_first boolean;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-dpn-a@test.invalid', now(), now());

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values
    (bain_anchor, ua, bain_anchor, 'Bain Test', 'Concept A', now(), '{"id":"rlstest-dpn-bain-a"}'::jsonb, null),
    (bain_plan2,  ua, bain_anchor, 'Bain Test', 'Concept A - Quiddity V1', now(), '{"id":"rlstest-dpn-bain-b"}'::jsonb, null),
    (wr_anchor, ua, wr_anchor, 'Woods Road Test', 'Concept A', now(), '{"id":"rlstest-dpn-wr-a"}'::jsonb, null),
    (wr_plan2,  ua, wr_anchor, 'Woods Road Test', 'Concept A PRINT', now(), '{"id":"rlstest-dpn-wr-b"}'::jsonb, null),
    (wr_plan3,  ua, wr_anchor, 'Woods Road Test', 'Concept A PRINT', now(), '{"id":"rlstest-dpn-wr-c"}'::jsonb, null);

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);

  -- ============================================================================
  -- Delete the non-anchor plans (exactly cloudDelete's own statement).
  -- ============================================================================
  update public.sites set deleted_at = now() where id = bain_plan2;
  update public.sites set deleted_at = now() - interval '2 days' where id = wr_plan2;
  update public.sites set deleted_at = now() - interval '1 hour' where id = wr_plan3;

  -- ============================================================================
  -- TEST 1 — listDeletedPlansInGroup's read: `site` (project name) and `name` (plan name) are
  -- genuinely different columns on the real schema, and the deleted plan's own `name` is what
  -- must be shown, not the project's `site`.
  -- ============================================================================
  select site, name into row_site, row_name from public.sites where id = bain_plan2;
  if row_site = 'Bain Test' and row_name = 'Concept A - Quiddity V1' and row_site is distinct from row_name then
    passed := passed + 1; rep := rep || format(E'PASS  1. site=%L (project) and name=%L (plan) are distinct columns on the real row\n', row_site, row_name);
  else
    failed := failed + 1; rep := rep || format(E'FAIL  1. site=%L name=%L — expected them distinct\n', row_site, row_name);
  end if;

  -- ============================================================================
  -- TEST 2 — THE GAP cloudCheckDeleted(uid, planId) has when planId is NOT the group's anchor:
  -- its own two-query shape (id = :id) OR (group_id = :id) cannot see the live sibling, because
  -- no row's group_id equals this non-anchor plan's OWN id.
  -- ============================================================================
  select count(*) into n from public.sites where id = bain_plan2 or group_id = bain_plan2;
  select group_id into group_id_seen from public.sites where id = bain_plan2;
  if n = 1 and group_id_seen = bain_anchor and group_id_seen != bain_plan2 then
    passed := passed + 1; rep := rep || format(E'PASS  2. cloudCheckDeleted(uid, %L) sees only the ONE deleted row (group_id=%L, which != the queried id) — confirms the gap checkProjectDeletionStatus''s supplementary check closes\n', bain_plan2, group_id_seen);
  else
    failed := failed + 1; rep := rep || format(E'FAIL  2. expected exactly 1 row and a differing group_id, got n=%s group_id=%L\n', n, group_id_seen);
  end if;

  -- ============================================================================
  -- TEST 3 — the supplementary check itself: asking about the TRUE group id (groupStillHasLivePlans)
  -- finds the live anchor, so `checkProjectDeletionStatus` would correctly report scope:"plan".
  -- ============================================================================
  select count(*) into live_count from public.sites where (id = bain_anchor or group_id = bain_anchor) and deleted_at is null;
  if live_count = 1 then
    passed := passed + 1; rep := rep || E'PASS  3. the plan''s TRUE group (asked by its real group_id) still has a live plan — groupStillHasLivePlans would answer true, so the dialog must say "plan", not "project"\n';
  else
    failed := failed + 1; rep := rep || format(E'FAIL  3. expected 1 live row in the true group, got %s\n', live_count);
  end if;

  -- ============================================================================
  -- TEST 4 — Woods Road shape: two deleted plans sharing the exact same NAME are only
  -- distinguishable by `deleted_at` — confirms why the plan-menu row needs the date, not just
  -- the (now-correct) name.
  -- ============================================================================
  select count(*) into n from public.sites where group_id = wr_anchor and deleted_at is not null and name = 'Concept A PRINT';
  if n = 2 then
    passed := passed + 1; rep := rep || E'PASS  4. two deleted plans in one group share the identical plan name — the UI needs deletedAt to tell them apart, which listDeletedPlansInGroup already carries\n';
  else
    failed := failed + 1; rep := rep || format(E'FAIL  4. expected 2 same-named deleted plans, got %s\n', n);
  end if;

  select (select deleted_at from public.sites where id = wr_plan2) < (select deleted_at from public.sites where id = wr_plan3)
    into older_first;
  if older_first then
    passed := passed + 1; rep := rep || E'PASS  4b. the two same-named rows carry distinct deleted_at values that sort newest-first as listDeletedPlansInGroup already does\n';
  else
    failed := failed + 1; rep := rep || E'FAIL  4b. deleted_at values did not order as expected\n';
  end if;

  -- ============================================================================
  -- TEST 5 — Restore (the exact "Restore" button statement) round-trips for a NON-anchor plan.
  -- ============================================================================
  update public.sites set deleted_at = null where id = bain_plan2;
  select count(*) into n from public.sites where id = bain_plan2 and deleted_at is null;
  if n = 1 then
    passed := passed + 1; rep := rep || E'PASS  5. restoring a non-anchor plan (deleted_at -> null) succeeds\n';
  else
    failed := failed + 1; rep := rep || E'FAIL  5. restore did not clear deleted_at\n';
  end if;

  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- report + rollback -------------------------------------------
  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)',
    rep, passed, failed;
end $$;
