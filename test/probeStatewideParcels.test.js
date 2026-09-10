/* B1461729 — the exact fixture from the incident: Nevada's emptied service answered HTTP 200,
 * fast, with a JSON ArcGIS error body — and a check reading `res.ok` alone (the pre-fix shape of
 * `probeSource` in probe-statewide-parcels.mjs) called that reachable. Never again — and this
 * module IS one of the three places the item named ("in the runtime lookup, in
 * ui-audit/probe-statewide-parcels.mjs, and in the extent-and-count check added in PR #1611").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { probeSource, verdictFor } from "../ui-audit/probe-statewide-parcels.mjs";
import { resetHostHealth, resetHostThrottle } from "../ui-audit/lib/hostThrottle.mjs";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe("probeSource — a 200-with-ArcGIS-error body must never read as reachable", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetHostHealth(); resetHostThrottle(); });

  it("the exact Nevada incident fixture on the METADATA call: HTTP 200, {error:{code:400,message:'Failed to execute query.'}}", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { error: { code: 400, message: "Failed to execute query." } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const src = { url: "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0" };
    const r = await probeSource(src, "NV");
    expect(r.reachable).toBe(false);
    expect(r.arcgisError).toBe(true);
    expect(r.error).toMatch(/Failed to execute query.*code 400/);
    // Must not proceed to count/extent/envelope checks on an error body — there's nothing there
    // worth measuring, and probing further would just cost more wall-clock against a broken source.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the same fixture on the COUNT query — metadata is fine, but the layer's own /query 400s", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "APN" }], geometryType: "esriGeometryPolygon" })) // metadata
      .mockResolvedValueOnce(jsonResponse(200, { error: { code: 400, message: "Failed to execute query." } })); // count
    vi.stubGlobal("fetch", fetchMock);
    const src = { url: "https://example.test/arcgis/rest/services/Foo/Bar/MapServer/0" };
    const r = await probeSource(src, "NV");
    expect(r.reachable).toBe(false);
    expect(r.arcgisError).toBe(true);
    expect(r.error).toMatch(/Failed to execute query/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // stops here — never reaches the extent/envelope checks
  });

  it("a genuinely healthy source still reports reachable:true with its measured facts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "APN" }], geometryType: "esriGeometryPolygon" })) // metadata, no extent
      .mockResolvedValueOnce(jsonResponse(200, { count: 1394188 })) // count
      .mockResolvedValueOnce(jsonResponse(200, { features: [{}] })); // envelope timing probe
    vi.stubGlobal("fetch", fetchMock);
    const src = { url: "https://example.test/arcgis/rest/services/Foo/Bar/MapServer/0" };
    const r = await probeSource(src, "NV");
    expect(r.reachable).toBe(true);
    expect(r.arcgisError).toBeUndefined();
    expect(r.featureCount).toBe(1394188);
  });

  it("a plain HTTP failure (no body at all) is still reported as unreachable, not arcgisError", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Internal Server Error" });
    vi.stubGlobal("fetch", fetchMock);
    const r = await probeSource({ url: "https://example.test/arcgis/rest/services/Foo/Bar/MapServer/0" }, "NV");
    expect(r.reachable).toBe(false);
    expect(r.arcgisError).toBeUndefined();
  });
});

describe("verdictFor — arcgis-error gets its own verdict, distinct from blocked/host-error", () => {
  it("reports arcgis-error when every source failed with an ArcGIS error body", () => {
    const v = verdictFor({ sources: [{ reachable: false, arcgisError: true }] });
    expect(v).toBe("arcgis-error");
  });

  it("still reports measured-reachable when at least one source answered", () => {
    const v = verdictFor({ sources: [{ reachable: false, arcgisError: true }, { reachable: true }] });
    expect(v).toBe("measured-reachable");
  });

  it("blocked-in-sandbox and host-error are unaffected for non-arcgisError failures", () => {
    expect(verdictFor({ sources: [{ reachable: false, blocked: true }] })).toBe("blocked-in-sandbox");
    expect(verdictFor({ sources: [{ reachable: false, blocked: false }] })).toBe("host-error");
  });
});
