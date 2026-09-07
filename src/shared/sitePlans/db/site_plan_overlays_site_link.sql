-- B1167712 (NEW-1, owner correction 2026-09-07) — "record that the link was deliberately cleared
-- so the matcher does not helpfully undo his decision." `project_id` was already nullable
-- (site_plan_overlays.sql), so detaching a plan from a site needs no schema change on its own —
-- what's missing is a way to tell "never resolved yet" apart from "the owner explicitly detached
-- this," which look identical if all you can see is `project_id is null`. Without this column,
-- SitePlansSection.jsx's own reload-sweep resolver (which tries to match every un-attached,
-- placed overlay to a site on every load — see overlaySiteMatch.js) would re-attach a plan the
-- owner just deliberately separated, right back, on the very next reload.
--
-- Idempotent. Apply after site_plan_overlays.sql.

alter table public.site_plan_overlays
  add column if not exists site_link_declined boolean not null default false;

comment on column public.site_plan_overlays.site_link_declined is
  'true once the owner has explicitly detached this plan from a site (or picked "No site" in the Site control) — stops the automatic footprint/name matcher (overlaySiteMatch.js) from re-suggesting ANY site for this overlay until the owner attaches one by hand again. Never set by the matcher itself, only by the UI action that clears project_id.';
