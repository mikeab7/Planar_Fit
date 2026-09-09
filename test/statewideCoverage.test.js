/* NEW-1/NEW-2/NEW-3 (2026-09-09) — the pure spatial checks `probe-statewide-parcels.mjs` runs
 * against every wired statewide parcel source: does the layer's own extent actually cover its
 * claimed state, and can the app's own query shape answer inside the app's own timing budget.
 *
 * The teeth proof this suite exists for: run `extentCoverageCheck` against the REAL retracted
 * Nebraska extent (gis.ne.gov/Agency/.../TaxParcelsDED, 2026-09-09) and require it to flag —
 * a check that cannot see the known defect it was built for is not a check.
 */
import { describe, it, expect } from "vitest";
import {
  STATE_BBOX, STATE_PROBE_POINT, COVERAGE_SPAN_FLOOR, ENVELOPE_QUERY_BUDGET_MS,
  extentCoverageCheck, projectExtentToWgs84, probeEnvelopeTiming, pointInsideExtent,
} from "../ui-audit/lib/statewideCoverage.mjs";

describe("extentCoverageCheck — the teeth proof against the real Nebraska defect", () => {
  // MEASURED, 2026-09-09: gis.ne.gov/Agency/rest/services/TaxParcelsDED/MapServer/0's own extent,
  // already converted to lat/lon — the exact defect this check was built to catch.
  const RETRACTED_NE_EXTENT = { ymin: 40.984, xmin: -96.343, ymax: 41.205, xmax: -95.841 };

  it("flags the retracted Nebraska TaxParcelsDED extent as insufficient", () => {
    const c = extentCoverageCheck(RETRACTED_NE_EXTENT, "NE");
    expect(c.insufficient).toBe(true);
    expect(c.latFrac).toBeLessThan(COVERAGE_SPAN_FLOOR);
    expect(c.lonFrac).toBeLessThan(COVERAGE_SPAN_FLOOR);
  });

  it("does NOT flag the real, measured Florida extent (a genuinely statewide source)", () => {
    // MEASURED live against services9.arcgis.com's Florida_Statewide_Cadastral, 2026-09-09,
    // via Esri's public Geometry Service (EPSG:3086 → WGS84).
    const FL_EXTENT = { ymin: 24.411732639431325, xmin: -87.638000642580224, ymax: 31.042643481582544, xmax: -79.770179939634986 };
    const c = extentCoverageCheck(FL_EXTENT, "FL");
    expect(c.insufficient).toBe(false);
    expect(c.latFrac).toBeGreaterThan(0.9);
    expect(c.lonFrac).toBeGreaterThan(0.9);
  });

  it("does NOT flag the real, measured Tennessee extent", () => {
    // MEASURED live against services1.arcgis.com's Tennessee_Property_Boundaries_Public_Use,
    // 2026-09-09, via the Geometry Service (Web Mercator → WGS84).
    const TN_EXTENT = { ymin: 34.983062726515364, xmin: -90.305410057691645, ymax: 36.678095388986122, xmax: -81.64691664713574 };
    const c = extentCoverageCheck(TN_EXTENT, "TN");
    expect(c.insufficient).toBe(false);
  });

  it("returns null when the state has no reference bbox on record", () => {
    expect(extentCoverageCheck({ ymin: 0, xmin: 0, ymax: 1, xmax: 1 }, "ZZ")).toBeNull();
  });

  it("returns null on a failed projection rather than a false verdict", () => {
    expect(extentCoverageCheck({ failed: true, why: "blocked" }, "NE")).toBeNull();
  });

  it("checks lat and lon spans SEPARATELY — a layer narrow in only one dimension still fails", () => {
    const ref = STATE_BBOX.CO; // [36.9, -109.2, 41.1, -102.0]
    const fullLon = { ymin: ref[0], xmin: ref[1], ymax: ref[0] + 0.05, xmax: ref[3] }; // full lon span, near-zero lat span
    const c = extentCoverageCheck(fullLon, "CO");
    expect(c.lonFrac).toBeGreaterThan(0.9);
    expect(c.latFrac).toBeLessThan(COVERAGE_SPAN_FLOOR);
    expect(c.insufficient).toBe(true); // a healthy lon span must not average out a broken lat span
  });

  it("every STATE_BBOX entry has a real, non-degenerate span (south<north, west<east)", () => {
    for (const [abbr, [s, w, n, e]] of Object.entries(STATE_BBOX)) {
      expect(n, abbr).toBeGreaterThan(s);
      expect(e, abbr).toBeGreaterThan(w);
    }
  });

  it("every STATE_PROBE_POINT falls inside that state's own STATE_BBOX (a real, on-land test point)", () => {
    for (const [abbr, [lat, lng]] of Object.entries(STATE_PROBE_POINT)) {
      const ref = STATE_BBOX[abbr];
      expect(ref, abbr).toBeTruthy();
      const [s, w, n, e] = ref;
      expect(lat, `${abbr} lat`).toBeGreaterThanOrEqual(s);
      expect(lat, `${abbr} lat`).toBeLessThanOrEqual(n);
      expect(lng, `${abbr} lng`).toBeGreaterThanOrEqual(w);
      expect(lng, `${abbr} lng`).toBeLessThanOrEqual(e);
    }
  });
});

describe("projectExtentToWgs84 — reprojection via the injected fetchJson, never a bundled CRS table", () => {
  it("skips the network round trip entirely when the extent is already geographic (wkid 4326)", async () => {
    const throwing = async () => { throw new Error("must not be called for an already-4326 extent"); };
    const r = await projectExtentToWgs84({ xmin: -10, ymin: 20, xmax: -9, ymax: 21, spatialReference: { wkid: 4326 } }, { fetchJson: throwing });
    expect(r).toEqual({ xmin: -10, ymin: 20, xmax: -9, ymax: 21 });
  });

  it("skips the network round trip when spatialReference is absent (already unprojected)", async () => {
    const throwing = async () => { throw new Error("must not be called with no spatialReference"); };
    const r = await projectExtentToWgs84({ xmin: -10, ymin: 20, xmax: -9, ymax: 21 }, { fetchJson: throwing });
    expect(r).toEqual({ xmin: -10, ymin: 20, xmax: -9, ymax: 21 });
  });

  it("calls the Geometry Service and returns the projected envelope for a projected SR", async () => {
    let calledUrl = null;
    const fake = async (url) => {
      calledUrl = url;
      return { ok: true, json: { geometries: [{ xmin: -87.6, ymin: 24.4, xmax: -79.8, ymax: 31.0 }] } };
    };
    const r = await projectExtentToWgs84({ xmin: 1, ymin: 1, xmax: 2, ymax: 2, spatialReference: { wkid: 3086 } }, { fetchJson: fake });
    expect(r).toEqual({ ymin: 24.4, xmin: -87.6, ymax: 31.0, xmax: -79.8 });
    expect(calledUrl).toContain("GeometryServer/project");
    expect(calledUrl).toContain("inSR=3086");
    expect(calledUrl).toContain("outSR=4326");
  });

  it("reports failed:true rather than throwing when the geometry service is blocked", async () => {
    const blocked = async () => ({ ok: false, blocked: true, status: 403 });
    const r = await projectExtentToWgs84({ xmin: 1, ymin: 1, xmax: 2, ymax: 2, spatialReference: { wkid: 3086 } }, { fetchJson: blocked });
    expect(r.failed).toBe(true);
    expect(r.why).toMatch(/blocked/i);
  });

  it("reports failed:true when there is no usable extent in the metadata at all", async () => {
    const r = await projectExtentToWgs84(null, { fetchJson: async () => { throw new Error("must not be called"); } });
    expect(r.failed).toBe(true);
  });
});

describe("pointInsideExtent — the OTHER half of the Tennessee finding: zero results inside a claimed extent", () => {
  // MEASURED, 2026-09-09: Tennessee's own extent (converted via the Geometry Service) claims to
  // reach Nashville, and repeated probes there (4.2s–25.5s across runs) consistently answered zero.
  const TN_EXTENT = { ymin: 34.983062726515364, xmin: -90.305410057691645, ymax: 36.678095388986122, xmax: -81.64691664713574 };
  const NASHVILLE = [36.1627, -86.7816];

  it("Nashville is inside Tennessee's own declared extent", () => {
    expect(pointInsideExtent(NASHVILLE[0], NASHVILLE[1], TN_EXTENT)).toBe(true);
  });

  it("a point outside the extent reads false, not a false 'inside'", () => {
    expect(pointInsideExtent(25.0, -80.0, TN_EXTENT)).toBe(false); // Miami, nowhere near Tennessee
  });

  it("returns null (never a guessed boolean) when the extent failed to project", () => {
    expect(pointInsideExtent(36.1627, -86.7816, { failed: true, why: "blocked" })).toBeNull();
  });

  it("returns null on a non-finite point rather than throwing", () => {
    expect(pointInsideExtent(NaN, NaN, TN_EXTENT)).toBeNull();
  });
});

describe("probeEnvelopeTiming — NEW-3's timing budget, asserted against the app's own hang-guard", () => {
  it("does not flag a fast, in-budget response", async () => {
    const fast = async () => ({ ok: true, ms: 150, json: { features: [{}] } });
    const r = await probeEnvelopeTiming("https://example.test/FeatureServer/0", 30, -90, { fetchJson: fast });
    expect(r.overBudget).toBe(false);
    expect(r.featureCountInEnvelope).toBe(1);
  });

  it("flags Florida's real measured shape — an abort at the budget with zero bytes back", async () => {
    // MEASURED, 2026-09-09: a ~7-mile envelope/attributes-only query against Florida's statewide
    // cadastral layer timed out past 32s in an unbudgeted test; under this probe's own
    // ENVELOPE_QUERY_BUDGET_MS the underlying fetchJson aborts at the budget instead.
    const timesOut = async (url, opts) => ({ ok: false, ms: opts.timeout, error: "The operation was aborted." });
    const r = await probeEnvelopeTiming("https://example.test/FeatureServer/0", 30, -90, { fetchJson: timesOut, timeoutMs: ENVELOPE_QUERY_BUDGET_MS });
    expect(r.overBudget).toBe(true);
    expect(r.timedOut).toBe(true);
    expect(r.ms).toBe(ENVELOPE_QUERY_BUDGET_MS);
  });

  it("flags Tennessee's real measured shape — a slow answer that comes back empty, still over budget", async () => {
    // MEASURED, 2026-09-09: the same query shape against Tennessee's statewide layer took 25.5s
    // wall-clock and returned zero features — a real answer, just far outside any usable budget.
    const slowEmpty = async () => ({ ok: true, ms: 21143, json: { features: [] } });
    const r = await probeEnvelopeTiming("https://example.test/FeatureServer/0", 30, -90, { fetchJson: slowEmpty, timeoutMs: ENVELOPE_QUERY_BUDGET_MS });
    expect(r.overBudget).toBe(true); // ms (21143) exceeds the 8000ms budget even though the fetch itself "succeeded"
    expect(r.featureCountInEnvelope).toBe(0);
  });

  it("skips rather than guesses when no usable probe point is available", async () => {
    const r = await probeEnvelopeTiming("https://example.test/FeatureServer/0", NaN, NaN, { fetchJson: async () => { throw new Error("must not be called"); } });
    expect(r.skipped).toBe(true);
  });
});
