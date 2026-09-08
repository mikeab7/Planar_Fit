/* firstLanding — a first-time user (no stored route, no evidence of any project anywhere this
 * account/browser can be asked) lands on the Map instead of the Dashboard; a returning user's
 * boot — resumed OR the plain Dashboard for someone who genuinely has no projects to resume —
 * is completely unchanged. See src/app/firstLanding.js for the full rule. */
import { describe, it, expect } from "vitest";
import { isFreshRoutelessBoot, firstLandingRedirect, resolveHasAnyProjects, MAP_HASH, MAP_ROUTE } from "../src/app/firstLanding.js";
import { pickBootRoute } from "../src/app/lastRoute.js";
import { buildHash, parseRoute, isDashboardRoute } from "../src/app/route.js";

describe("firstLanding — MAP_HASH / MAP_ROUTE", () => {
  it("is the project-less Site route — the same place 'New project' / leaving a project land on", () => {
    expect(MAP_ROUTE).toEqual({ module: "site-planner", projectId: null, cross: false, org: false });
    expect(MAP_HASH).toBe("#/site");
  });
});

describe("firstLanding — isFreshRoutelessBoot", () => {
  it("true only for a truly empty initial hash that resolves to the Dashboard", () => {
    expect(isFreshRoutelessBoot({ initialHashEmpty: true, hashAfterSeed: "" })).toBe(true);
    expect(isFreshRoutelessBoot({ initialHashEmpty: true, hashAfterSeed: "#" })).toBe(true);
  });

  it("⛔ DEEP LINKS ARE SACRED — an explicit '#/dashboard' is NOT a fresh routeless boot, even though it resolves to the same Dashboard", () => {
    // INITIAL_HASH_EMPTY (route.js) is only true for "" / "#" — a spelled-out deep link to the
    // Dashboard is a deliberate destination, not the absence of one, and must never be redirected.
    expect(isFreshRoutelessBoot({ initialHashEmpty: false, hashAfterSeed: "#/dashboard" })).toBe(false);
  });

  it("false once seedBootRoute found a worthy stored route to seed (the hash no longer resolves to the Dashboard)", () => {
    const seeded = buildHash({ module: "doc-review", projectId: "grp-1", cross: false, org: false });
    expect(isDashboardRoute(seeded)).toBe(false);
    expect(isFreshRoutelessBoot({ initialHashEmpty: true, hashAfterSeed: seeded })).toBe(false);
  });

  it("false for any other explicit deep link", () => {
    expect(isFreshRoutelessBoot({ initialHashEmpty: false, hashAfterSeed: "#/library" })).toBe(false);
    expect(isFreshRoutelessBoot({ initialHashEmpty: false, hashAfterSeed: "#/project/p1/site" })).toBe(false);
  });
});

describe("firstLanding — firstLandingRedirect", () => {
  it("redirects to the Map only when fresh, project-less, and still on the Dashboard", () => {
    expect(firstLandingRedirect({ isFreshRoutelessBoot: true, hasAnyProjects: false, stillOnDashboard: true })).toBe(MAP_HASH);
  });

  it("never redirects a returning user (has any projects)", () => {
    expect(firstLandingRedirect({ isFreshRoutelessBoot: true, hasAnyProjects: true, stillOnDashboard: true })).toBe(null);
  });

  it("never redirects when the boot wasn't fresh/routeless", () => {
    expect(firstLandingRedirect({ isFreshRoutelessBoot: false, hasAnyProjects: false, stillOnDashboard: true })).toBe(null);
  });

  it("never redirects if the user already navigated away during the async existence check", () => {
    expect(firstLandingRedirect({ isFreshRoutelessBoot: true, hasAnyProjects: false, stillOnDashboard: false })).toBe(null);
  });
});

describe("firstLanding — resolveHasAnyProjects", () => {
  const notCalled = (label) => () => { throw new Error(`${label} should not have been called`); };

  it("a local record alone is enough — never asks the cloud (signed out, or a signed-in device with an already-warm cache)", async () => {
    const out = await resolveHasAnyProjects({
      user: null,
      hasAnyLocalSites: () => true,
      pendingLegacyCount: notCalled("pendingLegacyCount"),
      hasAnyLiveSites: notCalled("hasAnyLiveSites"),
    });
    expect(out).toBe(true);
  });

  it("signed out, nothing local → first-timer (false) — no account to ask the cloud about", async () => {
    const out = await resolveHasAnyProjects({
      user: null,
      hasAnyLocalSites: () => false,
      pendingLegacyCount: notCalled("pendingLegacyCount"),
      hasAnyLiveSites: notCalled("hasAnyLiveSites"),
    });
    expect(out).toBe(false);
  });

  it("signed in, nothing local, un-migrated legacy local work exists → NOT a first-timer, never reaches the cloud", async () => {
    const out = await resolveHasAnyProjects({
      user: { id: "u1" },
      hasAnyLocalSites: () => false,
      pendingLegacyCount: (uid) => (uid === "u1" ? 3 : 0),
      hasAnyLiveSites: notCalled("hasAnyLiveSites"),
    });
    expect(out).toBe(true);
  });

  it("signed in, nothing local, nothing legacy, the cloud has a site → NOT a first-timer (the durable, wipe-proof signal)", async () => {
    const out = await resolveHasAnyProjects({
      user: { id: "u1" },
      hasAnyLocalSites: () => false,
      pendingLegacyCount: () => 0,
      hasAnyLiveSites: async (uid) => uid === "u1",
    });
    expect(out).toBe(true);
  });

  it("signed in, genuinely zero everywhere → first-timer", async () => {
    const out = await resolveHasAnyProjects({
      user: { id: "u1" },
      hasAnyLocalSites: () => false,
      pendingLegacyCount: () => 0,
      hasAnyLiveSites: async () => false,
    });
    expect(out).toBe(false);
  });
});

/* ⛔ RED-PROOF, both directions — the owner's brief asked for both assertions to be shown
 * failing on current main. Faithfully replays Shell.jsx's own boot sequence end to end, the
 * same shape test/bootRouteResolution.test.js already uses for the neighboring B904304 boot
 * defect: seedBootRoute → parseRoute → (NEW) the first-landing check. `withFirstLanding: false`
 * reproduces PRE-FIX main exactly (nothing redirects a route-less boot away from the Dashboard,
 * whatever the account's project count); `withFirstLanding: true` is what this change adds. */
function resolveLanding(rawHash, { storedLastRoute, hasAnyProjects, withFirstLanding }) {
  const initialHashEmpty = rawHash === "" || rawHash === "#";
  const boot = pickBootRoute({ initialHashEmpty, stored: storedLastRoute });
  let effectiveHash = boot ? buildHash(boot) : rawHash;
  const fresh = isFreshRoutelessBoot({ initialHashEmpty, hashAfterSeed: effectiveHash });
  if (withFirstLanding) {
    const target = firstLandingRedirect({ isFreshRoutelessBoot: fresh, hasAnyProjects, stillOnDashboard: isDashboardRoute(effectiveHash) });
    if (target) effectiveHash = target;
  }
  return { route: parseRoute(effectiveHash), isDashboard: isDashboardRoute(effectiveHash) };
}

describe("firstLanding — RED-PROOF against current main's boot chain", () => {
  it("MUTATION PROOF (fails without this change): a brand-new, project-less account's bare-domain boot lands on the Dashboard on main", () => {
    const preFix = resolveLanding("", { storedLastRoute: null, hasAnyProjects: false, withFirstLanding: false });
    expect(preFix.isDashboard).toBe(true); // the reported gap: the "money maker" map is never shown
    const postFix = resolveLanding("", { storedLastRoute: null, hasAnyProjects: false, withFirstLanding: true });
    expect(postFix.isDashboard).toBe(false);
    expect(postFix.route).toEqual(MAP_ROUTE);
  });

  it("MUTATION PROOF (fails without this change): a returning user's stored resume target is completely unaffected by the first-landing check", () => {
    const stored = { module: "doc-review", projectId: "grp-42", cross: false };
    const preFix = resolveLanding("", { storedLastRoute: stored, hasAnyProjects: false, withFirstLanding: false });
    const postFix = resolveLanding("", { storedLastRoute: stored, hasAnyProjects: false, withFirstLanding: true });
    // hasAnyProjects is deliberately false here — even so, there is nothing for the first-landing
    // check to redirect: seedBootRoute already resolved this boot to a real, worth-restoring
    // route, so isFreshRoutelessBoot is false and the two must agree byte for byte.
    expect(postFix).toEqual(preFix);
    expect(postFix.route).toEqual({ module: "doc-review", projectId: "grp-42", cross: false, org: false });
  });

  it("a returning user who genuinely has zero projects (nothing stored, but not a first-timer) still lands on the Dashboard, unchanged", () => {
    const preFix = resolveLanding("", { storedLastRoute: null, hasAnyProjects: true, withFirstLanding: false });
    const postFix = resolveLanding("", { storedLastRoute: null, hasAnyProjects: true, withFirstLanding: true });
    expect(postFix).toEqual(preFix);
    expect(postFix.isDashboard).toBe(true);
  });

  it("an explicit deep link to the Dashboard ('#/dashboard') is never redirected, first-timer or not", () => {
    const postFix = resolveLanding("#/dashboard", { storedLastRoute: null, hasAnyProjects: false, withFirstLanding: true });
    expect(postFix.isDashboard).toBe(true);
  });

  it("any other explicit deep link (a shared project, a plan, a specific module) is never redirected, first-timer or not", () => {
    for (const hash of ["#/project/p1/site", "#/library", "#/markup", "#/project/p1/markup"]) {
      const preFix = resolveLanding(hash, { storedLastRoute: null, hasAnyProjects: false, withFirstLanding: false });
      const postFix = resolveLanding(hash, { storedLastRoute: null, hasAnyProjects: false, withFirstLanding: true });
      expect(postFix).toEqual(preFix);
    }
  });
});
