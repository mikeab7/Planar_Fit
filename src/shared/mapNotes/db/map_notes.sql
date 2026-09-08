-- Map Notes (NEW-1; provisional label until the real B# is minted at push time, per /CLAUDE.md's
-- LATE-BIND rule). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER
-- site-planner/db/teams.sql (needs public.is_team_member). Idempotent: safe to re-run.
--
-- WHAT THIS IS: a map note is a short piece of text pinned to a place on the ground. Owner's own
-- framing (2026-09-08): "i should be able to add a note … it should be able to take the same form
-- code wise as placing a comp but just with different data." So this table is deliberately
-- comps.sql's ANCHOR + OWNERSHIP + SHARING + SOFT-DELETE shape verbatim, with the three comp types
-- and every deal column replaced by one payload: a body of plain text and an optional short title.
--
-- ⛔ A NOTE NEVER CREATES A SITE, AND THIS IS THE ONE PLACE IT DIFFERS FROM A COMP BY DESIGN.
-- B843792 made `project_id` a comp's OWNING site, materializing a new tracked site from the comp's
-- own location when nothing matched. A map note must NEVER do that: it is an annotation on the
-- ground, not a record about a property, and auto-creating a site per note would silently fill the
-- owner's sites list with junk. `project_id` here is a purely OPTIONAL link to an ALREADY-EXISTING
-- site, chosen by hand the same way the plan and comp dropdowns offer one, and it stays NULL when
-- there is none. Nothing in this module may call the comp path's site-materialization helper.
--
-- ⛔ THIS IS NOT THE NOTES WORKSPACE, and the split is deliberate. `notes_pages` / `notes_trees`
-- (src/workspaces/notes) are a document system — a rich-text editor with versions, redline and
-- conflict review. A map note is a short piece of text pinned to a place. They share a word and
-- nothing else: no foreign key, no shared storage, no shared editor. Keeping them apart now is
-- precisely what makes a future "open this map note as a full page" possible as its own item.
--
-- SHARING SHAPE, inherited from comps.sql for the same reason it was chosen there: a team member
-- can READ every team-shared note, but only the person who WROTE one may change or delete it.
-- team_sharing.sql's "any member may edit" is explicitly NOT reused (annotations are reference
-- material — many readers, few writers), and there is no team-admin override either.
--
-- ANCHOR: a pin drop OR a real parcel selection — the same two kinds a comp gets, never a
-- hand-drawn shape. `anchor_kind` says which; `lat`/`lon` is the point either way (the parcel
-- assembly's representative point when anchor_kind='parcel'), and `parcel_apn`/`parcel_geom` carry
-- a snapshot of the selected parcel(s) so the shape renders without a live re-query of the county
-- service. A site-plan-anchored note (comps' third kind) is deliberately NOT in this cut — see the
-- backlog item; adding it later is an `anchor_kind` value plus two nullable columns, exactly as it
-- was for comps (comps_site_plan_anchor.sql), so nothing here forecloses it.

create table if not exists public.map_notes (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete set null,
  -- OPTIONAL link to an EXISTING site only — never materialized from a note. See the header.
  project_id   text references public.sites(id) on delete set null,

  -- payload: the whole of it. A note is text pinned to a place.
  title        text,                              -- optional short label
  body         text not null default '',          -- the note itself, plain text

  -- anchor: pin OR real parcel selection (comps.sql's shape verbatim)
  anchor_kind  text not null check (anchor_kind in ('pin', 'parcel')),
  lat          double precision not null,
  lon          double precision not null,
  county       text,
  parcel_apn   text,
  parcel_geom  jsonb,

  -- soft delete (comps_soft_delete.sql's shape) — a note is never hard-deleted by the app.
  deleted_at   timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (id),
  -- a parcel anchor must carry a parcel identity, or it is indistinguishable from a bare pin
  -- and the map can't draw its shape (comps_parcel_anchor_has_identity, same reasoning).
  constraint map_notes_parcel_anchor_has_identity check (
    anchor_kind = 'pin' or parcel_apn is not null or parcel_geom is not null
  )
);

create index if not exists map_notes_user_idx    on public.map_notes (user_id);
create index if not exists map_notes_team_idx    on public.map_notes (team_id) where team_id is not null;
create index if not exists map_notes_project_idx on public.map_notes (project_id) where project_id is not null;
create index if not exists map_notes_live_idx    on public.map_notes (updated_at desc) where deleted_at is null;

-- RLS: comps.sql's four policies, unchanged in shape -------------------------------------------
alter table public.map_notes enable row level security;

drop policy if exists "select own or team map notes" on public.map_notes;
drop policy if exists "insert own map notes"         on public.map_notes;
drop policy if exists "update own map notes"         on public.map_notes;
drop policy if exists "delete own map notes"         on public.map_notes;

-- SELECT: own row OR a row shared with a team you're in.
create policy "select own or team map notes" on public.map_notes
  for select to authenticated
  using ( user_id = (select auth.uid()) or (team_id is not null and public.is_team_member(team_id)) );

-- INSERT: you must be the creator, and if you set a team_id you must belong to that team.
create policy "insert own map notes" on public.map_notes
  for insert to authenticated
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

-- UPDATE: OWNER ONLY, even on a team-shared row. Soft delete IS an update, so this is also the
-- policy that keys deletion on (owner, id) — a teammate's delete affects 0 rows.
create policy "update own map notes" on public.map_notes
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) and (team_id is null or public.is_team_member(team_id)) );

-- DELETE: OWNER ONLY. The app never calls a hard DELETE on a live note — this policy exists for
-- the eventual purge-from-trash action and for the owner's own manual cleanup, nothing else.
create policy "delete own map notes" on public.map_notes
  for delete to authenticated
  using ( user_id = (select auth.uid()) );

create or replace function public.map_notes_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists map_notes_touch on public.map_notes;
create trigger map_notes_touch before update on public.map_notes
  for each row execute function public.map_notes_touch_updated_at();

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select relrowsecurity from pg_class where oid = 'public.map_notes'::regclass;  -- expect true
--   select polname from pg_policy where polrelid = 'public.map_notes'::regclass;   -- 4 rows
