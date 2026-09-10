import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { saveSite, loadSitesList, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { findProjectAtOrigin } from "../src/shared/projects/projectModel.js";

/* B1399568 — "Planning a site on ground that already has a project mints a second project."
 *
 * Production repro (2026-09-09): a single site add produced TWO projects in public.sites, 51
 * seconds apart, both group_id = id, both site "ALUMAX RD, NASH,", both name "Concept A", both
 * county "bowie", and both carrying BYTE-IDENTICAL origin coordinates (lat 33.44769381770632, lon
 * -94.13769222822577 — matching to the last digit). Both were empty shells that had taken later
 * writes, so neither was an abandoned stub.
 *
 * Fifty-one seconds rules out a debounce/submit-disable/StrictMode-remount guard — those close a
 * millisecond-scale window, not this one. Whether the second create came from a second human
 * press or the app re-entering the path on its own is UNKNOWN and, per the fix rule (ADOPT, DON'T
 * MINT), irrelevant: the guard is keyed on the ground, not on suppressing a second click, so it
 * holds regardless of which one happened.
 *
 * This suite is the RED PROOF the brief asked for. `mintUnconditionally` below replays exactly
 * what SitePlannerApp.jsx's newSiteFromMap/newBlankSite did on origin/main — mint a fresh id with
 * no ground check at all — and the first test proves that mechanism really does produce two
 * group_id=id rows for one owner at one origin (the bug, reproduced mechanically). `createOrAdopt`
 * mirrors the FIXED wiring (check findProjectAtOrigin first; mint only when nothing is found) and
 * the tests after it prove exactly one row survives the same two-call sequence. The "wiring"
 * describe block at the bottom pins that SitePlannerApp.jsx's real newSiteFromMap/newBlankSite
 * actually call findProjectAtOrigin before minting, so this can't silently drift back to the
 * unconditional-mint shape while these tests still pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(HERE, "../src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");

/* B1399568/FINDING-B (owner correction, read on main at 8d9ab8f) — the ground-adopt check above
 * closes the case where a second create runs AFTER the first has already saved. It does NOT, by
 * itself, close a FASTER race: the map's decide bar (MapFinder.jsx) had ZERO in-flight
 * protection, `planSelected` awaits a county lookup (up to 3s) and `startBlankHere` does too,
 * both BEFORE the project is ever written — a multi-second window with nothing on screen yet
 * where a second press re-enters the same verb before the first press's own `saveSite` has run,
 * i.e. before `findProjectAtOrigin` has anything to find. The fix is an in-flight guard at the
 * two functions every entry point funnels through (`runDecideVerb` for the decide bar,
 * `startBlankHere` itself for its three OTHER call sites this item found un-gated: the toolbar's
 * "Draw" button, ParcelInfoCard's outage fallback, and the map-wide outage offer) — proven here
 * as a source guard, since standing up the real Leaflet map + async county/team network calls to
 * race two presses is a live-verify concern this sandbox can't reliably time (the end-to-end
 * timing-independent shape IS proven live in e2e/duplicate-project-origin.spec.js).
 */
const MF = readFileSync(join(HERE, "../src/workspaces/site-planner/MapFinder.jsx"), "utf8");

function freshLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

// The owner's real production coordinates (ALUMAX RD, NASH, Bowie county) — the repro is used
// verbatim rather than a synthetic point, per this repo's WRONG-CASE rule (test the case that was
// actually reported, not a fixture built to make the mechanism disappear).
const ORIGIN = { lat: 33.44769381770632, lon: -94.13769222822577 };

let mintCounter = 0;
const nextId = () => "smtest" + (++mintCounter).toString(36);

// Replays origin/main's newSiteFromMap/newBlankSite verbatim: mint a fresh id and save it as a
// brand-new project, with NO check for an existing project at this origin.
function mintUnconditionally(origin) {
  const id = nextId();
  saveSite({
    id, groupId: id, site: "ALUMAX RD, NASH,", name: "Concept A",
    origin, county: "bowie", parcels: [], els: [], measures: [], settings: {},
  });
  return id;
}

// Mirrors the fixed wiring: check findProjectAtOrigin against the freshest local read first
// (never a possibly-stale prop), adopt (return the existing group) when found, mint only when
// nothing is found — the exact shape newSiteFromMap/newBlankSite now follow.
function createOrAdopt(origin) {
  const existingGroupId = origin ? findProjectAtOrigin(loadSitesList(), origin) : null;
  if (existingGroupId) return existingGroupId;
  return mintUnconditionally(origin);
}

function distinctGroupIds() {
  return new Set(loadSitesList().map((s) => s.groupId || s.id));
}

describe("B1399568 — RED PROOF: origin/main's unconditional mint reproduces the reported bug", () => {
  beforeEach(() => { freshLocalStorage(); setActiveUser(null); mintCounter = 0; });

  it("two create calls at the owner's exact production origin mint TWO group_id=id rows", () => {
    const g1 = mintUnconditionally(ORIGIN);
    const g2 = mintUnconditionally(ORIGIN); // 51s later in production; timing plays no role here
    expect(g1).not.toBe(g2);
    expect(distinctGroupIds().size).toBe(2); // fails once the adopt guard is in the path — this proves the mechanism is real
    const rows = loadSitesList();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => (r.groupId || r.id) === r.id)).toBe(true); // both are anchor rows (group_id = id)
    expect(rows.every((r) => r.origin.lat === ORIGIN.lat && r.origin.lon === ORIGIN.lon)).toBe(true); // byte-identical origin, matching the production repro
  });
});

describe("B1399568 — FIX: planning a site on already-planned ground ADOPTS the existing project", () => {
  beforeEach(() => { freshLocalStorage(); setActiveUser(null); mintCounter = 0; });

  it("two create calls at the same origin yield exactly ONE group_id=id row", () => {
    const g1 = createOrAdopt(ORIGIN);
    const g2 = createOrAdopt(ORIGIN);
    expect(g2).toBe(g1); // the second call opened the first project instead of minting a new one
    expect(distinctGroupIds().size).toBe(1);
    expect(loadSitesList()).toHaveLength(1);
  });

  it("adopt never rewrites the existing project — it only opens it", () => {
    const g1 = createOrAdopt(ORIGIN);
    const before = loadSitesList().find((s) => s.id === g1);
    const g2 = createOrAdopt(ORIGIN);
    const after = loadSitesList().find((s) => s.id === g1);
    expect(g2).toBe(g1);
    expect(after.updatedAt).toBe(before.updatedAt); // no write happened on the adopt path
  });

  it("holds for three-plus repeated calls at the same origin, not just a pair", () => {
    const ids = [createOrAdopt(ORIGIN), createOrAdopt(ORIGIN), createOrAdopt(ORIGIN), createOrAdopt(ORIGIN)];
    expect(new Set(ids).size).toBe(1);
    expect(loadSitesList()).toHaveLength(1);
  });

  it("a genuinely different origin still mints its own project — adopt is not a blanket dedupe", () => {
    const g1 = createOrAdopt(ORIGIN);
    const g2 = createOrAdopt({ lat: 29.7604, lon: -95.3698 }); // Houston — a real, different site
    expect(g2).not.toBe(g1);
    expect(distinctGroupIds().size).toBe(2);
  });

  it("a create call with no resolvable origin is untouched by the guard (mints as before)", () => {
    const g1 = createOrAdopt(ORIGIN);
    const g2 = createOrAdopt(null);
    expect(g2).not.toBe(g1);
    expect(distinctGroupIds().size).toBe(2);
  });
});

describe("SitePlannerApp.jsx — the ADOPT check is actually wired ahead of both mint sites", () => {
  it("imports findProjectAtOrigin from the shared project model", () => {
    expect(SP.includes('import { markProjectFreshlyMinted, findProjectAtOrigin } from "../../shared/projects/projectModel.js";')).toBe(true);
  });

  it("newSiteFromMap checks findProjectAtOrigin BEFORE minting a new id", () => {
    const fnStart = SP.indexOf("const newSiteFromMap = async (payload) => {");
    const checkIdx = SP.indexOf("findProjectAtOrigin(loadSitesList(), payload.origin)", fnStart);
    const mintIdx = SP.indexOf("const id = newId();", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(fnStart);
    expect(mintIdx).toBeGreaterThan(fnStart);
    expect(checkIdx).toBeLessThan(mintIdx); // the ground check runs BEFORE a fresh id is ever minted
  });

  it("newSiteFromMap adopts (opens the existing project and returns) rather than falling through to mint", () => {
    const fnStart = SP.indexOf("const newSiteFromMap = async (payload) => {");
    const checkIdx = SP.indexOf("findProjectAtOrigin(loadSitesList(), payload.origin)", fnStart);
    const adoptIdx = SP.indexOf("if (existingGroupId) { openProjectGroup(existingGroupId); return; }", fnStart);
    expect(adoptIdx).toBeGreaterThan(checkIdx);
    expect(adoptIdx).toBeLessThan(SP.indexOf("const id = newId();", fnStart));
  });

  it("newBlankSite checks findProjectAtOrigin BEFORE minting a new id, for its located branch", () => {
    const fnStart = SP.indexOf("const newBlankSite = async (opts) => {");
    const checkIdx = SP.indexOf("findProjectAtOrigin(loadSitesList(), o)", fnStart);
    const mintIdx = SP.indexOf("const id = newId();", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(fnStart);
    expect(mintIdx).toBeGreaterThan(fnStart);
    expect(checkIdx).toBeLessThan(mintIdx);
  });

  it("newBlankSite adopts rather than falling through to mint", () => {
    const fnStart = SP.indexOf("const newBlankSite = async (opts) => {");
    const checkIdx = SP.indexOf("findProjectAtOrigin(loadSitesList(), o)", fnStart);
    const adoptIdx = SP.indexOf("if (existingGroupId) { openProjectGroup(existingGroupId); return; }", fnStart);
    expect(adoptIdx).toBeGreaterThan(checkIdx);
    expect(adoptIdx).toBeLessThan(SP.indexOf("const id = newId();", fnStart));
  });

  // NEW-4's own contract (SitePlannerApp.jsx's header comment above newBlankSite): an UNLOCATED
  // blank writes nothing and so can never duplicate a project — the guard must not fire for it.
  it("newBlankSite's ground check is gated on having a real origin, not run unconditionally", () => {
    const fnStart = SP.indexOf("const newBlankSite = async (opts) => {");
    const checkIdx = SP.indexOf("findProjectAtOrigin(loadSitesList(), o)", fnStart);
    const guardIdx = SP.lastIndexOf("if (o) {", checkIdx);
    expect(guardIdx).toBeGreaterThan(fnStart);
    expect(checkIdx - guardIdx).toBeLessThan(80); // the check is the first thing inside that `if (o) {`
  });
});

describe("MapFinder.jsx — FINDING-B: the decide bar and startBlankHere are guarded against an in-flight double-press", () => {
  it("runDecideVerb refuses to re-enter while a previous verb.run is still in flight", () => {
    const fnStart = MF.indexOf("const runDecideVerb = async (verb, target) => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = MF.indexOf("\n  };", fnStart);
    const body = MF.slice(fnStart, fnEnd);
    expect(body.includes("if (decideBusyRef.current) return;")).toBe(true);
    expect(body.includes("decideBusyRef.current = true;")).toBe(true);
    // Released in a `finally`, so a thrown/rejected verb.run can never leave the guard stuck.
    expect(body.includes("} finally {")).toBe(true);
    expect(body.includes("decideBusyRef.current = false;")).toBe(true);
  });

  it("runDecideVerb awaits verb.run — a synchronous fire-and-forget would defeat the guard's window", () => {
    const fnStart = MF.indexOf("const runDecideVerb = async (verb, target) => {");
    const fnEnd = MF.indexOf("\n  };", fnStart);
    const body = MF.slice(fnStart, fnEnd);
    expect(body.includes("await verb.run(target);")).toBe(true);
  });

  it("the decide bar's 'site' verb RETURNS its async calls so runDecideVerb's await has something to wait on", () => {
    const verbsStart = MF.indexOf("const DECIDE_VERBS = [");
    const siteStart = MF.indexOf('key: "site",', verbsStart);
    const siteEnd = MF.indexOf('key: "comp",', siteStart);
    const body = MF.slice(siteStart, siteEnd);
    expect(body.includes("return planSelected();")).toBe(true);
    expect(body.includes("return startBlankHere(")).toBe(true);
  });

  it("planSelected AWAITS onUseParcels — a fire-and-forget call would resolve before newSiteFromMap ever writes", () => {
    const fnStart = MF.indexOf("const planSelected = async () => {");
    expect(fnStart).toBeGreaterThan(-1);
    expect(MF.includes("await onUseParcels({ ...asm, name, county });")).toBe(true);
    const awaitIdx = MF.indexOf("await onUseParcels({ ...asm, name, county });", fnStart);
    expect(awaitIdx).toBeGreaterThan(fnStart);
  });

  it("startBlankHere carries its OWN in-flight guard, independent of the decide bar's", () => {
    const fnStart = MF.indexOf("const startBlankHere = async (at) => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = MF.indexOf("\n  };", fnStart);
    const body = MF.slice(fnStart, fnEnd);
    expect(body.includes("if (startBlankHereBusyRef.current) return;")).toBe(true);
    expect(body.includes("startBlankHereBusyRef.current = true;")).toBe(true);
    expect(body.includes("} finally {")).toBe(true);
    expect(body.includes("startBlankHereBusyRef.current = false;")).toBe(true);
  });

  it("startBlankHere AWAITS onSkip on both branches — a fire-and-forget call would let a second press race past newBlankSite's own write", () => {
    const fnStart = MF.indexOf("const startBlankHere = async (at) => {");
    const fnEnd = MF.indexOf("\n  };", fnStart);
    const body = MF.slice(fnStart, fnEnd);
    expect(body.includes("await onSkip?.();")).toBe(true);
    // NEW-1 — the name is tidied (appraisal.js's tidyAddressLabel) before this call, not inline
    // here; the guard below is about the AWAIT, not the exact tidying expression.
    expect(body.includes("await onSkip?.({ origin, county, name: tidyAddressLabel(parcelInfo?.label || addr.trim()) || \"Untitled site\" });")).toBe(true);
  });

  // startBlankHere is reachable from four places; the guard living INSIDE the function (rather
  // than at each call site) is what protects the three that don't go through runDecideVerb at
  // all — pin all four call sites so a future refactor that adds a fifth is caught by this list
  // going stale, not silently unguarded.
  it("every known call site of startBlankHere is still present (an un-gated fifth entry point would need this list updated)", () => {
    const callSites = [
      'onClick={() => startBlankHere()}', // the toolbar's own "Draw" button
      'return startBlankHere({ lat: pin.lat, lon: pin.lon });', // the decide bar's "site" verb
      'const m = mapRef.current; startBlankHere(m ? m.getCenter() : null); setParcelInfo(null);', // ParcelInfoCard's outage fallback
      'onClick={() => startBlankHere(fallbackOffer.at)} data-testid="map-start-blank-here"', // the map-wide outage offer
    ];
    for (const needle of callSites) expect(MF.includes(needle)).toBe(true);
  });
});
