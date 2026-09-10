/* B1461730 — walk a wired source's own REST server for a same-shaped replacement when it goes
 * missing. The fixture below is the real incident: Nevada's `County_Parcels_in_Nevada` service
 * went to zero layers on the SAME host, and the real replacement (`County_Parcels_In_Nevada_
 * Yellow`) sat one directory listing away, in the same folder, with an identical feature count.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseArcgisServiceUrl, serviceNameSimilarity, candidateMatchesKnownGood, walkForReplacement,
} from "../ui-audit/lib/serviceNeighbourWalk.mjs";

describe("parseArcgisServiceUrl — pure URL decomposition", () => {
  it("parses a layer URL into restBase/folder/serviceName/serviceType/layerId", () => {
    const p = parseArcgisServiceUrl("https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0");
    expect(p).toEqual({
      restBase: "https://arcgis.water.nv.gov/arcgis/rest/services",
      folder: "BaseLayers",
      serviceName: "County_Parcels_in_Nevada",
      serviceType: "MapServer",
      layerId: 0,
    });
  });

  it("parses a bare SERVICE url (no layer id)", () => {
    const p = parseArcgisServiceUrl("https://example.test/arcgis/rest/services/Folder/Svc/FeatureServer");
    expect(p).toMatchObject({ folder: "Folder", serviceName: "Svc", serviceType: "FeatureServer", layerId: null });
  });

  it("handles a service at the REST root (no folder)", () => {
    const p = parseArcgisServiceUrl("https://example.test/arcgis/rest/services/Svc/MapServer/0");
    expect(p).toMatchObject({ folder: "", serviceName: "Svc" });
  });

  it("returns null for something that isn't an ArcGIS REST services URL", () => {
    expect(parseArcgisServiceUrl("https://example.test/not/arcgis/at/all")).toBeNull();
    expect(parseArcgisServiceUrl("")).toBeNull();
  });
});

describe("serviceNameSimilarity — token overlap, the real Nevada pair", () => {
  it("scores the real failed/replacement pair highly", () => {
    const s = serviceNameSimilarity("County_Parcels_in_Nevada", "County_Parcels_In_Nevada_Yellow");
    expect(s).toBeGreaterThan(0.5);
  });

  it("scores two unrelated names near zero", () => {
    expect(serviceNameSimilarity("County_Parcels_in_Nevada", "Wetlands_2019")).toBe(0);
  });

  it("is symmetric", () => {
    expect(serviceNameSimilarity("Foo_Bar", "Bar_Baz")).toBeCloseTo(serviceNameSimilarity("Bar_Baz", "Foo_Bar"));
  });
});

describe("candidateMatchesKnownGood", () => {
  const ok = { ok: true, featureCount: 1394188, fieldNames: ["APN", "Acres", "County", "SourceDate", "Website"] };

  it("matches an identical count with every known field present", () => {
    expect(candidateMatchesKnownGood(ok, { featureCount: 1394188, fieldNames: ["APN", "Acres"] })).toBe(true);
  });

  it("tolerates a small drift in count (a republish can gain/lose a handful of parcels)", () => {
    expect(candidateMatchesKnownGood({ ...ok, featureCount: 1394190 }, { featureCount: 1394188 })).toBe(true);
  });

  it("rejects a materially different count", () => {
    expect(candidateMatchesKnownGood({ ...ok, featureCount: 500 }, { featureCount: 1394188 })).toBe(false);
  });

  it("rejects a candidate missing an expected field", () => {
    expect(candidateMatchesKnownGood(ok, { fieldNames: ["APN", "OwnerName"] })).toBe(false);
  });

  it("returns null (not a guessed boolean) when there is nothing to compare against", () => {
    expect(candidateMatchesKnownGood(ok, null)).toBeNull();
  });

  it("returns false for a candidate that itself failed to measure", () => {
    expect(candidateMatchesKnownGood({ ok: false }, { featureCount: 1 })).toBe(false);
  });
});

// Build a fake fetchJson keyed by exact URL, matching probe-statewide-parcels.mjs's own
// { ok, status, ms, json } shape.
function fakeFetchJson(table) {
  return vi.fn(async (url) => {
    for (const [pattern, body] of table) {
      const matches = typeof pattern === "string" ? url === pattern : pattern.test(url);
      if (matches) return { ok: true, status: 200, ms: 10, json: body };
    }
    return { ok: false, status: 404, ms: 10, json: null, error: `no fixture for ${url}` };
  });
}

describe("walkForReplacement — the real Nevada incident, end to end", () => {
  const REST = "https://arcgis.water.nv.gov/arcgis/rest/services";
  const FAILED_URL = `${REST}/BaseLayers/County_Parcels_in_Nevada/MapServer/0`;
  const REPLACEMENT_SERVICE = `${REST}/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer`;
  const REPLACEMENT_LAYER = `${REPLACEMENT_SERVICE}/0`;

  function nevadaFixture() {
    return fakeFetchJson([
      [`${REST}/BaseLayers?f=json`, {
        folders: [],
        services: [
          { name: "County_Parcels_in_Nevada", type: "MapServer" }, // the failed one — must be skipped as itself
          { name: "County_Parcels_In_Nevada_Yellow", type: "MapServer" }, // the real replacement
        ],
      }],
      [`${REST}?f=json`, { folders: ["BaseLayers", "Irrigation"], services: [] }],
      [`${REST}/Irrigation?f=json`, { folders: [], services: [{ name: "Canal_Districts", type: "MapServer" }] }], // unrelated sibling
      [`${REPLACEMENT_SERVICE}?f=json`, {
        layers: [{ id: 0, name: "County Parcels Yellow", geometryType: "esriGeometryPolygon" }],
      }],
      [`${REPLACEMENT_LAYER}?f=json`, {
        geometryType: "esriGeometryPolygon",
        fields: [{ name: "APN" }, { name: "PIN" }, { name: "Acres" }, { name: "County" }, { name: "SourceDate" }, { name: "Website" }],
      }],
      [new RegExp(`^${REPLACEMENT_LAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/query`), { count: 1394188 }],
    ]);
  }

  it("finds the real replacement in the SAME FOLDER and confirms it against the last-known-good facts", async () => {
    const fetchJson = nevadaFixture();
    const knownGood = { featureCount: 1394188, fieldNames: ["APN", "Acres", "County", "SourceDate", "Website"] };
    const r = await walkForReplacement({ failedUrl: FAILED_URL, knownGood, fetchJson });
    expect(r.ok).toBe(true);
    const best = r.results[0];
    expect(best.url).toBe(REPLACEMENT_LAYER);
    expect(best.matchesKnownGood).toBe(true);
    expect(best.featureCount).toBe(1394188);
  });

  it("never re-checks the failed service itself as its own replacement candidate", async () => {
    const fetchJson = nevadaFixture();
    const r = await walkForReplacement({ failedUrl: FAILED_URL, fetchJson });
    expect(r.results.some((c) => c.url.includes("County_Parcels_in_Nevada/"))).toBe(false);
  });

  it("filters out an unrelated sibling-folder service by name similarity", async () => {
    const fetchJson = nevadaFixture();
    const r = await walkForReplacement({ failedUrl: FAILED_URL, fetchJson });
    expect(r.results.some((c) => c.url.includes("Canal_Districts"))).toBe(false);
  });

  it("reports candidates even with no knownGood supplied — matchesKnownGood is null, not a guess", async () => {
    const fetchJson = nevadaFixture();
    const r = await walkForReplacement({ failedUrl: FAILED_URL, fetchJson });
    expect(r.results[0].matchesKnownGood).toBeNull();
  });

  it("reports (never silently drops) a same-named candidate elsewhere that itself has zero layers", async () => {
    const fetchJson = fakeFetchJson([
      [`${REST}/BaseLayers?f=json`, { folders: [], services: [
        { name: "County_Parcels_in_Nevada", type: "MapServer" },
        { name: "County_Parcels_in_Nevada_v2", type: "MapServer" }, // an empty shell, same species as the real failure
      ] }],
      [`${REST}?f=json`, { folders: ["BaseLayers"], services: [] }],
      [`${REST}/BaseLayers/County_Parcels_in_Nevada_v2/MapServer?f=json`, { layers: [] }], // zero layers
    ]);
    const r = await walkForReplacement({ failedUrl: FAILED_URL, fetchJson });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].reason).toMatch(/zero layers/);
  });

  it("returns ok:false with a reason, never throws, for a URL it can't parse", async () => {
    const r = await walkForReplacement({ failedUrl: "not a url", fetchJson: async () => { throw new Error("must not be called"); } });
    expect(r.ok).toBe(false);
    expect(r.candidatesChecked).toBe(0);
  });

  it("sameFolderOnly:true skips the root/sibling-folder walk entirely", async () => {
    const fetchJson = nevadaFixture();
    await walkForReplacement({ failedUrl: FAILED_URL, fetchJson, sameFolderOnly: true });
    expect(fetchJson).not.toHaveBeenCalledWith(`${REST}?f=json`);
  });
});
