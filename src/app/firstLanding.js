/* firstLanding — first-time users land on the Map instead of the Dashboard (NEW-1, owner
 * request 2026-09-08, verbatim: "when people start using the site, that it initially defaults
 * to opening up onto the map. Like the site plan map... that's the money maker.").
 *
 * "THE MAP" — established live against production, not assumed from the owner's phrasing (his
 * own correction, same date): navigating to a bare "#/map" redirects to "#/site", which is the
 * Site Planner workspace with NO project selected — the pins-across-the-metro finder
 * (MapFinder.jsx: Sites/Comps rail, address search, "+ Select parcels", the Imagery & layers
 * rail). It is a STATE of the Site route (`mode === "map"` in SitePlannerApp.jsx), not a
 * separate route. `MAP_ROUTE`/`MAP_HASH` below are exactly that: { module: "site-planner",
 * projectId: null }, i.e. the same place "New project" and leaving a project already land on.
 *
 * "FIRST-TIMER", the precise rule (candidate (b) from the brief — "no projects at all" —
 * checked at whichever source is DURABLE for this user):
 *   1. The boot must be genuinely route-less: an empty hash (INITIAL_HASH_EMPTY) AND
 *      lastRoute.js's seedBootRoute() found nothing worth restoring (see isFreshRoutelessBoot).
 *      Any explicit deep link — including a literal "#/" or "#/dashboard" — is UNTOUCHED: deep
 *      links are sacred, and this predicate is false for both (INITIAL_HASH_EMPTY is only true
 *      for a truly bare "" / "#", never for "#/dashboard" spelled out).
 *   2. AND no evidence exists ANYWHERE this account/browser can be asked that it has ever had a
 *      project: the cloud, when signed in — the account's real record, which SURVIVES a cleared
 *      browser on a new device, so a returning signed-in user is never misread as new just
 *      because local storage was wiped — plus any not-yet-migrated legacy local work (a
 *      signed-out user who made real sites, then signs in for the first time, is not a
 *      first-timer either); the local cache, when signed out, which is the only record an
 *      anonymous session has at all.
 *
 * Deliberately NOT a "have we shown this once" flag of our own in localStorage: that is exactly
 * the kind of marker a cleared browser destroys, which is the one failure mode the owner's brief
 * called out by name. Re-deriving "does this account/browser have zero projects, right now" from
 * a source that outlives local storage (the cloud, for anyone who actually has an account) is
 * what makes the check survive a wipe rather than merely resist one.
 *
 * ACKNOWLEDGED GAP, stated rather than papered over: a signed-OUT visitor has no server identity
 * at all, so for that case only local storage can answer "have I been here before" — and
 * clearing it is genuinely indistinguishable from never having visited, because there is no
 * signal left anywhere that could tell the two apart. This is a property of not having an
 * account, not a defect in this rule; the moment they sign in, the durable cloud/legacy check
 * above takes over.
 */
import { isDashboardRoute, buildHash } from "./route.js";

export const MAP_ROUTE = { module: "site-planner", projectId: null, cross: false, org: false };
export const MAP_HASH = buildHash(MAP_ROUTE);

/* Pure: was THIS load's boot a genuine, route-less arrival at the Dashboard — as opposed to a
 * LATER, deliberate visit (the wordmark, the breadcrumb "Dashboard" crumb) that produces the
 * identical bare "#/" hash? Call this ONCE, at module scope, right after seedBootRoute() has had
 * its chance to redirect an empty hash into a stored, worth-restoring route (mirrors how
 * Shell.jsx already captures INITIAL_ROUTE once, for the same reason). `hashAfterSeed` is the
 * live hash read AFTER seedBootRoute ran — if it seeded a real route, isDashboardRoute is false;
 * if there was nothing to seed, the hash is unchanged and, for a truly empty initial hash,
 * resolves to the Dashboard. */
export function isFreshRoutelessBoot({ initialHashEmpty, hashAfterSeed }) {
  return !!initialHashEmpty && isDashboardRoute(hashAfterSeed);
}

/* Pure: given what the existence checks found, does this boot redirect to the Map? Returns the
 * hash to replace the URL with, or null to do nothing (stay on the Dashboard exactly as today).
 * `stillOnDashboard` guards the async gap between "we started checking" and "the check
 * resolved" — if the user has already navigated away by then (clicked a tab while we were
 * awaiting a cloud round-trip), a deliberate navigation must never be clobbered. */
export function firstLandingRedirect({ isFreshRoutelessBoot: fresh, hasAnyProjects, stillOnDashboard }) {
  if (!fresh || hasAnyProjects || !stillOnDashboard) return null;
  return MAP_HASH;
}

/* Async, injected — never imports storage.js/cloudSync.js/localStorage/Supabase directly, so
 * this is Node-testable with fakes and carries none of those modules' weight into this leaf.
 * Short-circuits on the cheapest, most-common-case check first: a local existence check never
 * touches the network, and a signed-out visitor never reaches the cloud branch at all. */
export async function resolveHasAnyProjects({ user, hasAnyLocalSites, pendingLegacyCount, hasAnyLiveSites }) {
  if (hasAnyLocalSites()) return true;
  if (!user) return false;
  if (pendingLegacyCount(user.id) > 0) return true;
  return !!(await hasAnyLiveSites(user.id));
}
