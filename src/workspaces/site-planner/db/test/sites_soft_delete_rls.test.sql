-- ============================================================================
-- B1442592 ("An empty new project is never written to the server") — item 2, run rather than reasoned.
--
-- The report's own instruction: "establish whether a dropdown delete on a project that DOES have
-- a server row writes deleted_at. Test that specifically on a seeded project with a row, and put
-- the answer in the PR. Do not answer it by reasoning — run it." This is that run.
--
-- Reproduces cloudSync.js's ACTUAL statements against the REAL `sites` RLS policies:
--   - cloudDelete(uid, id):            update sites set deleted_at = now() where id = :id
--   - cloudDeleteGroup(uid, groupId):  the SAME update run twice — once `eq("id", groupId)`,
--                                      once `eq("group_id", groupId)` — exactly as the two
--                                      Promise.all queries in cloudSync.js do it.
--
-- Mirrors the self-rolling-back shape of team_share_scope.test.sql / comps_soft_delete_rls.test.sql:
-- every id here is a throwaway `rlstest-*` fixture on synthetic auth.users rows. Nothing that
-- belongs to a real account (Michael's included) is read or written. Paste into the Supabase SQL
-- editor (or run via execute_sql) and read the report out of the raised exception — the whole
-- thing rolls back regardless of outcome.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0e01';  -- A: owns the seeded projects
  ub uuid := '00000000-0000-4000-8000-0000000d0e02';  -- B: unrelated user, no team, no relation to A
  solo_site text := 'rlstest-del-solo';         -- Test 1: a lone project WITH a server row (the control)
  group_anchor text := 'rlstest-del-ganchor';   -- Test 2: a project with TWO plans (group delete)
  group_child text := 'rlstest-del-gchild';
  ghost_id text := 'rlstest-del-ghost';         -- Test 3: names NO sites row anywhere — the
                                                 -- lazy-created "New project" case this backlog item is about
  others_site text := 'rlstest-del-others';     -- Test 4: owned by B, not A — cross-account isolation
  n int;
  n2 int;
  d timestamptz;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del-b@test.invalid', now(), now());

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (solo_site, ua, solo_site, 'RLS delete test — solo', 'Concept A', now(), '{"id":"rlstest-del-solo"}'::jsonb, null);
  insert into public.site_elements (site_id, id, kind, data)
  values (solo_site, 'rlstest-del-e1', 'el', '{"id":"rlstest-del-e1"}'::jsonb);

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (group_anchor, ua, group_anchor, 'RLS delete test — group anchor', 'Concept A', now(), '{"id":"rlstest-del-ganchor"}'::jsonb, null);
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (group_child, ua, group_anchor, 'RLS delete test — group child plan', 'Concept B', now(), '{"id":"rlstest-del-gchild"}'::jsonb, null);

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (others_site, ub, others_site, 'RLS delete test — B''s own project', 'Concept A', now(), '{"id":"rlstest-del-others"}'::jsonb, null);

  -- ============================================================================
  -- TEST 1 — THE OWNER'S ACTUAL REPORT: a project WITH a server row, deleted by its owner.
  -- Exactly cloudDelete's own statement.
  -- ============================================================================
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);

  update public.sites set deleted_at = now() where id = solo_site;
  get diagnostics n = row_count;
  select deleted_at into d from public.sites where id = solo_site;
  if n = 1 and d is not null then
    passed := passed + 1; rep := rep || format(E'PASS  1. delete on a project WITH a server row writes deleted_at (1 row, deleted_at=%s)\n', d);
  else
    failed := failed + 1; rep := rep || format(E'FAIL  1. delete on a project WITH a server row affected %s row(s), deleted_at=%s\n', n, d);
  end if;

  select count(*) into n from public.sites where id = solo_site and deleted_at is null;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  1b. deleted project absent from the live (deleted_at is null) list\n';
  else failed := failed + 1; rep := rep || E'FAIL  1b. deleted project still reads as live\n'; end if;

  select count(*) into n from public.sites where id = solo_site and deleted_at is not null;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  1c. deleted project present in the Recently-deleted (deleted_at is not null) list\n';
  else failed := failed + 1; rep := rep || E'FAIL  1c. deleted project missing from the bin query\n'; end if;

  -- a project WITH PLANS: its drawing must survive the soft delete (recoverable trash, no cascade)
  select count(*) into n from public.site_elements where site_id = solo_site;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  1d. the plan''s elements survive the soft delete (no cascade fires)\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  1d. elements did not survive — %s row(s) left\n', n); end if;

  -- restore (the bin's "Restore" button: deleted_at set back to null)
  update public.sites set deleted_at = null where id = solo_site;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  1e. Restore (deleted_at -> null) succeeds for the owner\n';
  else failed := failed + 1; rep := rep || E'FAIL  1e. Restore affected 0 rows\n'; end if;

  -- ============================================================================
  -- TEST 2 — A PROJECT WITH PLANS (a real group of >1 site rows): cloudDeleteGroup's own
  -- two-query shape must bin every plan in the group, not just the anchor.
  -- ============================================================================
  update public.sites set deleted_at = now() where id = group_anchor;
  get diagnostics n = row_count;
  update public.sites set deleted_at = now() where group_id = group_anchor;
  get diagnostics n2 = row_count;
  -- the anchor itself also carries group_id = group_anchor in this fixture (mirrors a real
  -- anchor row), so the second query re-touches it — that's fine, cloudDeleteGroup unions the
  -- two result sets by id for exactly this reason. What matters is BOTH rows end up binned.
  select count(*) into n from public.sites where id in (group_anchor, group_child) and deleted_at is not null;
  if n = 2 then passed := passed + 1; rep := rep || E'PASS  2. group delete bins EVERY plan in the group (anchor + child), not just the anchor\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  2. group delete left %s of 2 plans binned\n', n); end if;

  -- ============================================================================
  -- TEST 3 — THE LAZY-CREATED CASE THIS BACKLOG ITEM IS ABOUT: an id that names NO sites row
  -- anywhere (an empty "New project" that was never edited, so saveSite/cloudUpsert never ran).
  -- Deleting it must be an honest, loud zero — never an error, never a fabricated success.
  -- ============================================================================
  update public.sites set deleted_at = now() where id = ghost_id or group_id = ghost_id;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  3. deleting a never-saved project id matches 0 rows (the honest removed:0 case) — no row anywhere to move to Recently deleted\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  3. a ghost id somehow matched %s row(s)\n', n); end if;

  -- ============================================================================
  -- TEST 4 — CROSS-ACCOUNT ISOLATION: A cannot soft-delete B's project (adjacent-case sanity;
  -- the same removed:0 shape must hold for "not mine" as it does for "doesn't exist").
  -- ============================================================================
  update public.sites set deleted_at = now() where id = others_site;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  4. A cannot soft-delete B''s project (0 rows — RLS holds)\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  4. A deleted %s row(s) belonging to B — RLS BREACH\n', n); end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- confirm B's project is genuinely untouched
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = others_site and deleted_at is null;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4b. B''s project is still live and untouched\n';
  else failed := failed + 1; rep := rep || E'FAIL  4b. B''s project was affected by A''s attempt\n'; end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- report + rollback -------------------------------------------
  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)',
    rep, passed, failed;
end $$;
