/* B1461730 — the periodic health sweep over every wired parcel source. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectWiredLayerUrls, sweep } from "../ui-audit/parcel-source-health-sweep.mjs";
import { resetHostHealth, resetHostThrottle } from "../ui-audit/lib/hostThrottle.mjs";

describe("collectWiredLayerUrls — pure, deduped by URL", () => {
  it("dedupes two keys sharing one layer URL and names both", () => {
    const registry = {
      county_a: { state: "TX", layerUrl: "https://example.test/MapServer/0" },
      county_b: { state: "TX", layerUrl: "https://example.test/MapServer/0" },
    };
    const out = collectWiredLayerUrls([registry]);
    expect(out).toHaveLength(1);
    expect(out[0].labels).toEqual(["TX/county_a", "TX/county_b"]);
  });

  it("skips a serviceUrl-only entry (out of scope for this pass)", () => {
    const registry = { foo: { state: "TX", serviceUrl: "https://example.test/MapServer" } };
    expect(collectWiredLayerUrls([registry])).toEqual([]);
  });

  it("trims a trailing slash so two URLs differing only by it still dedupe", () => {
    const registry = {
      a: { layerUrl: "https://example.test/MapServer/0" },
      b: { layerUrl: "https://example.test/MapServer/0/" },
    };
    expect(collectWiredLayerUrls([registry])).toHaveLength(1);
  });

  it("finds Nevada, wired via the post-B1455632 Yellow URL, in the real registries", async () => {
    const { COUNTIES, COUNTIES_MAP } = await import("../src/workspaces/site-planner/lib/counties.js");
    const out = collectWiredLayerUrls([COUNTIES, COUNTIES_MAP]);
    const nv = out.find((r) => r.url.includes("arcgis.water.nv.gov"));
    expect(nv).toBeTruthy();
    expect(nv.url).toContain("County_Parcels_In_Nevada_Yellow");
    expect(nv.labels).toContain("NV/nv_statewide");
  });
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe("sweep — end to end over a fake host", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetHostHealth(); resetHostThrottle(); });

  it("reports a healthy source as healthy, with its feature count", async () => {
    vi.doMock("../src/workspaces/site-planner/lib/counties.js", () => ({
      COUNTIES: {},
      COUNTIES_MAP: { fake_statewide: { state: "ZZ", layerUrl: "https://example.test/arcgis/rest/services/Foo/Bar/MapServer/0" } },
    }));
    vi.resetModules();
    const { sweep: freshSweep } = await import("../ui-audit/parcel-source-health-sweep.mjs");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "APN" }], geometryType: "esriGeometryPolygon" }))
      .mockResolvedValueOnce(jsonResponse(200, { count: 12345 }));
    vi.stubGlobal("fetch", fetchMock);
    const sw = await freshSweep();
    expect(sw.totalSources).toBe(1);
    expect(sw.broken).toHaveLength(0);
    expect(sw.results[0].healthy).toBe(true);
    expect(sw.results[0].featureCount).toBe(12345);
    vi.doUnmock("../src/workspaces/site-planner/lib/counties.js");
    vi.resetModules();
  });

  it("flags a source that answers with an ArcGIS error body and reports its neighbour-walk finding", async () => {
    vi.doMock("../src/workspaces/site-planner/lib/counties.js", () => ({
      COUNTIES: {},
      COUNTIES_MAP: {
        nv_statewide: { state: "NV", layerUrl: "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0" },
      },
    }));
    vi.resetModules();
    const { sweep: freshSweep } = await import("../ui-audit/parcel-source-health-sweep.mjs");
    const REST = "https://arcgis.water.nv.gov/arcgis/rest/services";
    const fetchMock = vi.fn(async (url) => {
      if (url === `${REST}/BaseLayers/County_Parcels_in_Nevada/MapServer/0?f=json`) {
        return jsonResponse(200, { error: { code: 400, message: "Failed to execute query." } });
      }
      if (url === `${REST}/BaseLayers?f=json`) {
        return jsonResponse(200, { folders: [], services: [
          { name: "County_Parcels_in_Nevada", type: "MapServer" },
          { name: "County_Parcels_In_Nevada_Yellow", type: "MapServer" },
        ] });
      }
      if (url === `${REST}?f=json`) return jsonResponse(200, { folders: ["BaseLayers"], services: [] });
      if (url === `${REST}/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer?f=json`) {
        return jsonResponse(200, { layers: [{ id: 0, name: "County Parcels Yellow", geometryType: "esriGeometryPolygon" }] });
      }
      if (url === `${REST}/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0?f=json`) {
        return jsonResponse(200, { fields: [{ name: "APN" }], geometryType: "esriGeometryPolygon" });
      }
      if (url.startsWith(`${REST}/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0/query`)) {
        return jsonResponse(200, { count: 1394188 });
      }
      return { ok: false, status: 404, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const sw = await freshSweep();
    expect(sw.broken).toHaveLength(1);
    expect(sw.broken[0].labels).toContain("NV/nv_statewide");
    expect(sw.broken[0].problem).toMatch(/Failed to execute query/);
    expect(sw.broken[0].candidate.url).toContain("County_Parcels_In_Nevada_Yellow");
    vi.doUnmock("../src/workspaces/site-planner/lib/counties.js");
    vi.resetModules();
  });
});
