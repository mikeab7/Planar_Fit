import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSourceResult, isSourceOpen, sourceCooldownMs, filterHealthyCandidates,
  resetSourceHealth, isStatewideBackup, SOURCE_FAIL_THRESHOLD, SOURCE_COOLDOWN_MS,
} from "../src/workspaces/site-planner/lib/sourceHealth.js";
import { STATEWIDE_KEYS } from "../src/workspaces/site-planner/lib/counties.js";

// The per-source circuit breaker (B244): after N consecutive failures a county's
// parcel server is skipped for a cooldown so clicks stop re-hammering a dead host,
// then auto-resumes. `now` is injected so this is deterministic without real timers.
describe("sourceHealth — parcel-server circuit breaker (B244)", () => {
  beforeEach(resetSourceHealth);

  it("stays closed below the failure threshold", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD - 1; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t)).toBe(false);
  });

  it("opens after N consecutive failures", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t)).toBe(true);
    expect(sourceCooldownMs("fbcad", t)).toBe(SOURCE_COOLDOWN_MS);
  });

  it("a success resets the streak (a blip never trips the breaker)", () => {
    const t = 1000;
    recordSourceResult("fbcad", false, t);
    recordSourceResult("fbcad", false, t);
    recordSourceResult("fbcad", true, t); // recovered
    recordSourceResult("fbcad", false, t); // a fresh streak of 1
    expect(isSourceOpen("fbcad", t)).toBe(false);
  });

  it("auto-resumes (closes) once the cooldown elapses", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t + 1)).toBe(true); // still inside cooldown
    expect(isSourceOpen("fbcad", t + SOURCE_COOLDOWN_MS + 1)).toBe(false); // cooled down → retry
    expect(sourceCooldownMs("fbcad", t + SOURCE_COOLDOWN_MS + 1)).toBe(0);
  });

  it("filterHealthyCandidates drops an open primary but ALWAYS keeps the statewide key", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fortbend", false, t);
    const cands = [{ county: "fortbend", url: "u1" }, { county: "txgio_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["txgio_statewide"], t);
    expect(out.map((c) => c.county)).toEqual(["txgio_statewide"]); // dead primary dropped, fallback kept
  });

  it("keeps a healthy primary alongside the statewide fallback", () => {
    const cands = [{ county: "harris", url: "u1" }, { county: "txgio_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["txgio_statewide"], 1000);
    expect(out.map((c) => c.county)).toEqual(["harris", "txgio_statewide"]);
  });

  it("NEW-1 (2026-09-08) — a brand-new state's statewide source survives its own outage exactly like txgio_statewide does, via the real STATEWIDE_KEYS list, never a hand-typed one", () => {
    // Mutation-prove one of the 19 states NEW-1 wired (docs/STATEWIDE-PARCELS.md): the outage
    // path is REUSED, not reimplemented, so this must hold with zero per-state code. Arkansas is
    // picked because its host (gis.arkansas.gov) is a REAL, confirmed outage from this build
    // environment's own egress policy — the same "genuine outage, not simulated" standing
    // e2e/parcel-outage-fallback.spec.js already established for county-level sources.
    expect(STATEWIDE_KEYS).toContain("ar_statewide");
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("ar_statewide", false, t);
    expect(isSourceOpen("ar_statewide", t)).toBe(true); // the breaker really did open — not a no-op
    const cands = [{ county: "harris", url: "u1" }, { county: "ar_statewide", url: "u2" }];
    // Passing the REAL production list (not ["ar_statewide"] by hand) is the point: this is
    // exactly what MapFinder.jsx / SitePlanner.jsx call with, so a future change that stops
    // deriving `alwaysKeep` from STATEWIDE_KEYS (e.g. reverting to a literal two-state array)
    // fails HERE, not silently in production for the 19 states added after that array was written.
    const out = filterHealthyCandidates(cands, STATEWIDE_KEYS, t);
    expect(out.map((c) => c.county)).toEqual(["harris", "ar_statewide"]); // open breaker, still never dropped
  });

  it("never returns empty even if every candidate's breaker is open (coverage must survive)", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) { recordSourceResult("harris", false, t); recordSourceResult("fortbend", false, t); }
    const cands = [{ county: "harris", url: "u1" }, { county: "fortbend", url: "u2" }];
    const out = filterHealthyCandidates(cands, [], t); // no always-keep, both open
    expect(out.length).toBeGreaterThan(0);
  });
});

// isStatewideBackup — the honest "statewide backup" badge fires ONLY when the county's
// own CAD was genuinely unavailable, never when a healthy CAD merely lost the parallel
// identify race to a faster TxGIO (B630 — the false "Fort Bend server unavailable" notice
// on every healthy Fort Bend click).
describe("isStatewideBackup — honest 'statewide backup' labeling (B630)", () => {
  const SW = ["txgio_statewide"]; // the statewide TxGIO source has its own key since B787 (was `chambers`)

  it("is NOT a backup when a real county CAD answered directly", () => {
    // FBCAD answered → hit.county is a real primary, not the statewide key.
    expect(isStatewideBackup("fortbend", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup when statewide won the race but a healthy CAD WAS queried (the B630 bug)", () => {
    // The reported case: FBCAD is healthy (a queried candidate) and returns 200, but the
    // statewide TxGIO layer answered a hair faster and won the eager race. That is a race
    // outcome, not an outage — the notice must NOT fire.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("IS a backup when the real CAD's breaker was open, so only statewide was queried", () => {
    // A genuine outage: FBCAD's breaker opened, so filterHealthyCandidates dropped it and
    // only the statewide layer remained to answer — TxGIO truly stood in.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(true);
  });

  it("is NOT a backup in a statewide-only area (no real CAD covers the point)", () => {
    // A county with no configured CAD is served straight from TxGIO — that is its normal
    // source, not a stand-in, so no "backup" badge.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [],
      queried: [{ county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup at a border straddle when at least one real CAD was still queryable", () => {
    // Point near a county line: fortbend's breaker is open (dropped) but harris is healthy
    // and WAS queried. Even if statewide won the race, a real CAD was available — don't
    // cry "county server unavailable".
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }, { county: "harris" }],
      queried: [{ county: "harris" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("defends against missing/empty inputs", () => {
    expect(isStatewideBackup("txgio_statewide")).toBe(false);
    expect(isStatewideBackup(undefined, { statewideKeys: SW })).toBe(false);
  });

  it("NEW-1 — the honest backup badge fires for a newly-wired state's composite exactly like txgio_statewide, using the real STATEWIDE_KEYS list", () => {
    // A New York click where a real county-level source doesn't exist at all — ny_statewide is
    // the ONLY source (no per-county entry backs it, unlike Texas/Colorado), so this is the
    // "statewide-only area" case, not a "backup", by the same rule as a Texas county with no CAD.
    expect(isStatewideBackup("ny_statewide", {
      realPrimaries: [],
      queried: [{ county: "ny_statewide" }],
      statewideKeys: STATEWIDE_KEYS,
    })).toBe(false);
  });
});
