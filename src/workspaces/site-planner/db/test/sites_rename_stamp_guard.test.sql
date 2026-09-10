-- ============================================================================
-- NEW-1 — sites_preserve_rename_stamp trigger test, AGAINST THE REAL DATABASE.
--
-- Proves the single property: AN UPDATE CARRYING NO REAL siteRenamedAt MAY NEITHER CLEAR A
-- STAMPED ROW'S MARKER NOR CHANGE THAT ROW'S PROJECT NAME.
--
-- Seven cases. Cases 0 and 4 are KNOWN-GOOD ARMS — they assert answers that are true independently
-- of the guard, so a run in which everything "passes" because the probe is blind fails here first
-- (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: prove the instrument can see a known answer before trusting
-- it on the unknown one).
--   0. rename_stamp() reports the known answer for every known input.
--   1. a document write carrying `"siteRenamedAt": null` over a stamped row  → stamp PRESERVED.
--   2. a document write that OMITS the key over a stamped row                → stamp PRESERVED.
--   3. an unstamped write that also changes the NAME                          → name AND stamp kept.
--   4. a real rename (name + a numeric stamp)                                 → BOTH land, untouched.
--   5. a row with NO stamp at all                                             → untouched; an
--      unstamped write may still change its name (the legacy majority tier must not be frozen).
--   6. an ordinary content save on a stamped row                              → nothing corrected.
--   7. rename_site_group(…, null) is refused BY NAME. `jsonb_set` is strict, so a null stamp used
--      to abort on `public.sites.data`'s NOT NULL constraint with an opaque `23502` naming a column
--      the caller never touched — safe, but only because of a constraint that function does not own,
--      and unreadable to whoever has to act on it.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report, so every
--   fixture row is discarded. It writes NOTHING that survives.
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched):
--   `drop trigger sites_preserve_rename_stamp on public.sites;` and re-run — cases 1, 2 and 3
--   must FAIL (the stamp comes back empty and the stale name sticks). Restoring the trigger must
--   turn them green again. Case 7 is proved red by reverting rename_site_group() to its pre-NEW-1
--   `language sql` body: the failure then arrives as `23502 null value in column "data"`, which does
--   not name `p_renamed_at`, and this case fails. (Both were confirmed red against production on
--   2026-09-10 BEFORE the guard was applied: 4 of 8 failed, exactly cases 1-4.)
-- ============================================================================
do $$
declare
  grp        text := 'zzrsg-test-group';
  p_null     text := 'zzrsg-null-marker';
  p_absent   text := 'zzrsg-absent-marker';
  p_rename   text := 'zzrsg-name-change';
  p_col      text := 'zzrsg-content-save';
  p_real     text := 'zzrsg-real-rename';
  p_unstamp  text := 'zzrsg-never-stamped';
  p_wipe     text := 'zzrsg-null-arg';
  at1        bigint := 1785525795307;   -- the real Silvestri stamp, 2026-07-31T19:23:15.307Z
  at2        bigint := 1786655992552;
  rep        text := '';
  failed     int := 0;
  got_at     text;
  got_site   text;
  got_col    text;
  owner_uid  uuid;
  raised     boolean := false;
  err        text := '';
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'rename stamp guard test: no auth user to hang the fixture off'; end if;

  -- ---- Case 0 — KNOWN-GOOD ARM: the parse reports known answers -------------------------------
  if public.rename_stamp(to_jsonb(at1)) is distinct from at1 then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0a: rename_stamp(number) did not round-trip';
  end if;
  if public.rename_stamp('"1785525795307"'::jsonb) is distinct from at1 then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0b: rename_stamp(numeric string) did not parse';
  end if;
  if public.rename_stamp('null'::jsonb) is not null
     or public.rename_stamp(null::jsonb) is not null
     or public.rename_stamp('"nope"'::jsonb) is not null
     or public.rename_stamp('0'::jsonb) is not null
     or public.rename_stamp('-5'::jsonb) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0c: rename_stamp read an EMPTY marker as a stamp';
  end if;

  -- ---- fixtures: five stamped plans in one group, plus one never-stamped ----------------------
  insert into public.sites (id, user_id, site, name, data) values
    (p_null,    owner_uid, 'Silvestri', 'Concept A', jsonb_build_object('id', p_null,    'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_absent,  owner_uid, 'Silvestri', 'Concept B', jsonb_build_object('id', p_absent,  'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_rename,  owner_uid, 'Silvestri', 'Concept C', jsonb_build_object('id', p_rename,  'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_col,     owner_uid, 'Silvestri', 'Concept D', jsonb_build_object('id', p_col,     'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_real,    owner_uid, 'Silvestri', 'Concept E', jsonb_build_object('id', p_real,    'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_unstamp, owner_uid, 'Legacy',    'Concept A', jsonb_build_object('id', p_unstamp, 'groupId', p_unstamp, 'site', 'Legacy')),
    (p_wipe,    owner_uid, 'Wipe',      'Concept A', jsonb_build_object('id', p_wipe,    'groupId', p_wipe,    'site', 'Wipe'));

  -- ---- Case 1 — the exact shape that shipped: a document push asserting an empty marker --------
  update public.sites
     set data = jsonb_build_object('id', p_null, 'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', null::jsonb, 'els', '[]'::jsonb)
   where id = p_null;
  select data->>'siteRenamedAt' into got_at from public.sites where id = p_null;
  if got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: a null-marker document write left siteRenamedAt = %s (want %s)', coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 2 — the post-fix client shape: the key is OMITTED (still erases, without a guard) --
  update public.sites
     set data = jsonb_build_object('id', p_absent, 'groupId', grp, 'site', 'Silvestri', 'els', '[]'::jsonb)
   where id = p_absent;
  select data->>'siteRenamedAt' into got_at from public.sites where id = p_absent;
  if got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2: an omitted-marker document write left siteRenamedAt = %s (want %s)', coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 3 — an unstamped write may not move a stamped row's NAME --------------------------
  update public.sites
     set site = 'Sylvestri',
         data = jsonb_build_object('id', p_rename, 'groupId', grp, 'site', 'Sylvestri', 'siteRenamedAt', null::jsonb)
   where id = p_rename;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_rename;
  if got_site is distinct from 'Silvestri' or got_col is distinct from 'Silvestri' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3: an unstamped write moved a stamped name — data.site=%s column=%s stamp=%s (want Silvestri/Silvestri/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 6 — an ordinary content save on a stamped row is left completely alone ------------
  update public.sites
     set data = jsonb_build_object('id', p_col, 'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1, 'els', '[{"id":"b1"}]'::jsonb)
   where id = p_col;
  select data->>'site', data->'els'->0->>'id', data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_col;
  if got_site is distinct from 'Silvestri' or got_col is distinct from 'b1' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6: an ordinary content save was altered — site=%s first-el=%s stamp=%s', got_site, got_col, coalesce(got_at, '<empty>'));
  end if;

  -- ---- Case 4 — KNOWN-GOOD ARM: a REAL rename still lands, untouched -------------------------
  perform public.rename_site_group(grp, 'Woods Road', at2);
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_real;
  if got_site is distinct from 'Woods Road' or got_col is distinct from 'Woods Road' or got_at is distinct from at2::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4: a genuine rename was blocked — data.site=%s column=%s stamp=%s (want Woods Road/Woods Road/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at2);
  end if;

  -- ---- Case 5 — a never-stamped row is NOT frozen ---------------------------------------------
  update public.sites
     set site = 'Legacy Renamed',
         data = jsonb_build_object('id', p_unstamp, 'groupId', p_unstamp, 'site', 'Legacy Renamed')
   where id = p_unstamp;
  select data->>'site', site into got_site, got_col from public.sites where id = p_unstamp;
  if got_site is distinct from 'Legacy Renamed' or got_col is distinct from 'Legacy Renamed' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5: an UNSTAMPED row was frozen — data.site=%s column=%s (want Legacy Renamed)', got_site, got_col);
  end if;

  -- ---- Case 7 — a null stamp is REFUSED, never written as a blanked `data` --------------------
  begin
    perform public.rename_site_group(p_wipe, 'Anything', null);
  exception when others then
    raised := true; err := sqlerrm;
  end;
  select data::text into got_site from public.sites where id = p_wipe;
  if not raised or got_site is null or err not like '%p_renamed_at%' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7: rename_site_group(…, null) raised=%s err=%s data=%s (want a refusal naming p_renamed_at, data intact)',
                         raised, coalesce(nullif(err, ''), '<none>'), coalesce(got_site, '<NULL>'));
  end if;

  if failed > 0 then
    raise exception E'sites_preserve_rename_stamp: % of 8 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'sites_preserve_rename_stamp: ALL 8 CHECKS PASSED\n(fixtures rolled back)';
end $$;
