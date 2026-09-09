-- NEW-1 (Since-you-were-last-here dashboard card) — ADD a real creation timestamp to `sites`.
-- Applied to production (project lyeqzkuiwngunutlkkmi) 2026-09-08.
--
-- WHY: nothing in this table (or the client model) has ever recorded when a plan was CREATED —
-- only `updated_at`, which is bumped on every save. The dashboard's "Since you were last here"
-- feed needs to say "a new plan appeared" honestly, and it cannot do that from `updated_at` alone
-- (a plan touched last night reads identically to one touched three months ago and re-saved
-- today). This column is the fix, and it is careful about the one thing that makes it safe:
--
-- EXISTING ROWS ARE BACKFILLED TO A SENTINEL, NEVER TO "NOW" — a plan created two years ago must
-- never read as "created 5 minutes ago" just because this migration happened to run then. So the
-- column is added WITHOUT a default first, every existing row is set to a clearly-ancient
-- sentinel (1970-01-01), and ONLY THEN does the column gain `default now()` — which Postgres
-- applies only to rows INSERTED from this point forward. A brand-new plan gets a true creation
-- time for free, with zero application-code change (an ordinary INSERT never lists `created_at`,
-- so the column default fills it in); every plan that already existed is permanently marked as
-- "we don't know, and it wasn't just now" and can never trigger a false "plan created" event.

alter table public.sites add column if not exists created_at timestamptz;

update public.sites set created_at = '1970-01-01T00:00:00Z'::timestamptz where created_at is null;

alter table public.sites alter column created_at set default now();
alter table public.sites alter column created_at set not null;

-- Verify (read-only; safe to run any time) -------------------------------------------------------
--   select id, site, created_at, updated_at from public.sites order by updated_at desc limit 20;
--   select count(*) from public.sites where created_at = '1970-01-01T00:00:00Z'::timestamptz;
