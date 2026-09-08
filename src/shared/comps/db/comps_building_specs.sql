-- Adds `clear_height_ft` and `year_built` to public.comps — the two building-spec facts the
-- Dashboard's Comps card needs (NEW-COMPS-CARD; provisional label until the real B# is minted at
-- push time, per /CLAUDE.md's LATE-BIND rule). Run once in the Supabase SQL editor (project
-- lyeqzkuiwngunutlkkmi) AFTER db/comps.sql and db/comps_value_constraints.sql. Idempotent: safe
-- to re-run.
--
-- WHY THESE TWO, AND WHY NOW: the Comps dashboard card's spec line (building size · clear height ·
-- year) is a standard industrial-comp fact set, and this app already has "clear height" as a real
-- concept — it's a field on a drawn Site Planner BUILDING element (site-planner/lib/buildingProps.js)
-- — but nowhere on a COMP record. Rather than have the card silently omit two of its three spec
-- facts forever (no field anywhere for a user to ever fill them), this migration adds them as
-- genuine, optional facts about the property, alongside `bldg_size_sf`/`lease_size_sf`. Neither is
-- ever fabricated or guessed — a comp saved before this migration simply reads null for both, and
-- the card's spec line omits whatever isn't known (this repo's standing "a field left empty must
-- never render as a placeholder" rule — comps.js's own header, `compFieldRows`).
--
-- SCOPE: applies to BUILDING_SALE and LEASE comps only (a land comp has no building yet) — enforced
-- client-side by compSheetColumns.js's `appliesTo`, not by a DB constraint (comp_type already
-- distinguishes the three, and a stray value on a land row is harmless dead data, not a hazard).
--
-- clear_height_ft: the interior clear height, in feet — a plain numeric like every other footage
-- figure on this table, not integer-clamped (a real listing sometimes states a fraction, e.g. "32.5 ft").
-- year_built: a plain calendar year — smallint is enough range (up to 32767) and half the storage
-- of integer for a column that only ever holds a four-digit year.

alter table public.comps add column if not exists clear_height_ft numeric;
alter table public.comps add column if not exists year_built smallint;

-- Extend the existing non-negative-amounts guarantee (comps_value_constraints.sql) rather than a
-- parallel constraint — one place enumerates every dollar/size/footage figure this product
-- guarantees is never negative.
alter table public.comps drop constraint if exists comps_amounts_non_negative;
alter table public.comps add constraint comps_amounts_non_negative check (
  (land_price is null or land_price >= 0) and
  (bldg_price is null or bldg_price >= 0) and
  (lease_rate is null or lease_rate >= 0) and
  (lease_ti is null or lease_ti >= 0) and
  (lease_opex is null or lease_opex >= 0) and
  (land_size_value is null or land_size_value >= 0) and
  (bldg_size_sf is null or bldg_size_sf >= 0) and
  (lease_size_sf is null or lease_size_sf >= 0) and
  (clear_height_ft is null or clear_height_ft >= 0)
);

-- A sanity range, not a strict one — wide enough for any real building (the oldest industrial
-- stock still standing predates 1900; the upper bound just catches an obvious typo, not a genuine
-- future construction date entered a little early).
alter table public.comps drop constraint if exists comps_year_built_range;
alter table public.comps add constraint comps_year_built_range check (
  year_built is null or (year_built >= 1800 and year_built <= 2100)
);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps' and column_name in ('clear_height_ft', 'year_built');
--   select conname from pg_constraint where conrelid = 'public.comps'::regclass and contype = 'c'
--     and conname in ('comps_amounts_non_negative', 'comps_year_built_range');  -- expect 2 rows
