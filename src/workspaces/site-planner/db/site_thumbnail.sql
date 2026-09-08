-- Recent-plans dashboard thumbnails (NEW-1, 2026-09-08) — a per-plan cached picture of the
-- drawing (boundary + buildings + truck courts/paving + parking, etc.), stored as a small SVG
-- string so the Dashboard's "Recent plans" card can show real renders of the four most recently
-- edited plans without rendering four live plans on every dashboard load.
--
-- WHY A COLUMN, NOT A STORAGE BLOB: the render is vector text (a few KB at most — a handful of
-- <path> elements, no raster bytes), so it rides in the same row the Dashboard already reads
-- (dashboardSitesFetch.js's one minimal `sites` select) with no second round trip and no Storage
-- bucket/signed-URL plumbing. Contrast with the site-plan-overlay raster thumbnails
-- (shared/sitePlans/lib/overlayRasterStorage.js), which are real JPEG bytes and do belong in
-- Storage — this is the opposite case (cheap, resolution-independent, text-sized).
--
-- WHY A PLAIN COLUMN, NOT PART OF THE CAS-GUARDED `data` JSONB: this is derived/rebuildable
-- (TIER-BY-REBUILDABILITY, /CLAUDE.md) — always regenerable from the plan's own `els`/`parcels` —
-- and nobody but this device's own render ever writes it, so there is no real conflict to guard
-- against. Routing it through cloudSync.js's `casUpsert`/`siteVersions` machinery (built for the
-- content jsonb's genuine multi-writer conflicts) would add risk to that already-hardened path for
-- no benefit. A plain `update ... where id = ...` is written outside that engine entirely
-- (site-planner/lib/siteThumbnail.js), gated by the SAME "update own or team sites" RLS policy
-- every other content write already goes through — no new policy needed.
--
-- `thumbnail_svg`: null = never attempted yet (the Dashboard's lazy-generate-once fallback should
-- try); '' (empty string) = attempted and the plan has nothing drawable (no boundary/elements) —
-- a deliberate, cheap-to-check sentinel so an empty plan is never re-fetched and re-rendered on
-- every visit; non-empty = a real <svg>...</svg> string, safe to use directly as an
-- `<img src="data:image/svg+xml,...">`.
--
-- Idempotent — safe to re-run.

alter table public.sites add column if not exists thumbnail_svg text;
alter table public.sites add column if not exists thumbnail_updated_at timestamptz;

comment on column public.sites.thumbnail_svg is
  'Cached SVG-string render of the plan (boundary + drawn elements), for the Dashboard recent-plans card. null = not generated yet; '''' = generated, nothing drawable; else a real <svg> string.';
comment on column public.sites.thumbnail_updated_at is
  'When thumbnail_svg was last (re)computed. Independent of updated_at, which tracks the plan content itself.';
