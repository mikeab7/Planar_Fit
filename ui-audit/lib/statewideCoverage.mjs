/* NEW-1/NEW-2/NEW-3 (2026-09-09) — does a "statewide" parcel layer actually cover its state, and
 * can the app's own query shape answer it inside the app's own timing budget? The pure half of
 * `probe-statewide-parcels.mjs`'s first real SPATIAL checks (every prior pass checked metadata —
 * capabilities, field list — never asked a spatial question at a real coordinate).
 *
 * THE FAILURE THIS CLOSES (NEW-1/NEW-2). Nebraska's wired `ne_statewide`
 * (gis.ne.gov/Agency/.../TaxParcelsDED) had a real capabilities list, a real field set, and
 * `statewide: true` — every check any prior probe pass ran on it — and its layer extent converts
 * to roughly 40.98–41.21°N / -96.34 to -95.84°W: the Omaha metro plus two Iowa counties, not
 * Nebraska. A query at Omaha's own coordinates returned ZERO, because Omaha sits just north of
 * that layer's own covered extent. `extentCoverageCheck` projects a layer's own declared extent to
 * lat/lon and compares it against the state's real bounding box, so a source that covers
 * materially less than its claimed state is flagged rather than reading as one more clean row.
 *
 * REPROJECTION, not a bundled CRS library. This is Node-script tooling, not client code, so a
 * devDependency would cost the app nothing — but every wired source uses a DIFFERENT projected
 * spatial reference (Florida EPSG:3086, Tennessee 102100/Web Mercator, California a custom Albers
 * 102962, …), and hand-maintaining every one's inverse projection here would be exactly the kind
 * of guessed-at math this repo's LOUD-FAILURE rule warns against. Esri's own public Geometry
 * Service (`utility.arcgisonline.com`, confirmed reachable from the sandbox this was built in,
 * distinct from the `*.arcgis.com` allowlist the probe script's own header names) exposes a
 * `/project` operation that reprojects ANY geometry between ANY two well-known spatial references
 * authoritatively — one extra GET request, no guessed math, no added dependency.
 *
 * ⛔ A LAYER'S DECLARED `extent` (free — already in the same `?f=json` metadata call every probe
 * pass makes), NEVER a live `returnExtentOnly` aggregate query. Measured directly: `?
 * returnExtentOnly=true&where=1=1` timed out past 30s against Florida (10.8M features), Tennessee
 * (2.1M) AND California (13.1M, otherwise fast) — a "real, computed" extent is strictly worse than
 * the free declared one, since it costs a full extra request and still can't be trusted to answer
 * inside any budget a probe (or the app) can afford.
 *
 * THE REFERENCE BOXES ARE COARSE ON PURPOSE — generous rectangular envelopes (same spirit as
 * `siteRegion.js`'s `STATE_ENVELOPES` for TX/CO), not a legal boundary. This is a DIAGNOSTIC that
 * flags a candidate for a human to look at, never a hard gate — a real statewide layer for an
 * irregularly-shaped or far-flung state (Alaska, Hawaii, Michigan's two peninsulas) can
 * legitimately read a lower span fraction than a compact rectangular state without that being a
 * defect, which is why the verdict carries the numbers rather than a bare pass/fail.
 *
 * THE TIMING BUDGET (NEW-3) IS NOT INVENTED HERE — it is `PARCEL_FETCH_TIMEOUT_MS` from
 * `src/workspaces/site-planner/lib/arcgis.js` (8000ms), the SAME cap the app's own click-lookup
 * path already enforces via `AbortController`. It cannot be imported directly (that module pulls
 * in `mapLock.js`, which needs a DOM `window` this Node tooling has none of), so it is a
 * DELIBERATE, commented duplicate — asserting the app's real hang-guard budget against the app's
 * real query shape (a ~7-mile envelope intersect, attributes only, no geometry —
 * `outFields=OBJECTID&returnGeometry=false`, the shape a real viewport draw runs), not a number
 * picked for this probe alone. Measured directly against the live services: that exact shape timed
 * out past 32s against Florida and took 25.5s to return ZERO features against Tennessee, while
 * California (13.1M features — MORE than Florida) answered in under 2s. Raw feature count is not
 * the predictor.
 *
 * Every network-touching function here takes an injected `fetchJson` (the probe script's own
 * timeout-aware fetch wrapper) rather than importing `fetch` directly — same DI shape as
 * `agolParcelSearch.mjs`'s `searchState`/`makeOrgResolver`, so a unit test can exercise the pure
 * decision logic without a real network call.
 */

export const GEOMETRY_SERVICE_PROJECT_URL =
  "https://utility.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer/project";

// [south, west, north, east] lat/lon, deliberately generous — the same convention counties.js's
// own `bbox` fields use. Reference only: never shipped to the client, never a legal boundary.
export const STATE_BBOX = {
  AL: [30.1, -88.5, 35.1, -84.9], AK: [51.2, -179.2, 71.5, -129.9], AZ: [31.3, -114.9, 37.0, -109.0],
  AR: [33.0, -94.7, 36.5, -89.6], CA: [32.5, -124.5, 42.1, -114.1], CO: [36.9, -109.2, 41.1, -102.0],
  CT: [40.95, -73.75, 42.1, -71.75], DE: [38.4, -75.8, 39.9, -75.0], DC: [38.79, -77.12, 39.0, -76.91],
  FL: [24.4, -87.65, 31.1, -79.9], GA: [30.35, -85.7, 35.05, -80.75], HI: [18.9, -160.3, 22.25, -154.8],
  ID: [41.99, -117.3, 49.1, -111.0], IL: [36.9, -91.55, 42.55, -87.0], IN: [37.75, -88.1, 41.8, -84.78],
  IA: [40.35, -96.65, 43.55, -90.1], KS: [36.99, -102.1, 40.1, -94.6], KY: [36.5, -89.6, 39.15, -81.95],
  LA: [28.9, -94.05, 33.05, -88.75], ME: [43.0, -71.1, 47.5, -66.9], MD: [37.9, -79.5, 39.75, -75.0],
  MA: [41.2, -73.55, 42.9, -69.9], MI: [41.7, -90.5, 48.3, -82.4], MN: [43.5, -97.25, 49.4, -89.5],
  MS: [30.15, -91.7, 35.0, -88.1], MO: [35.95, -95.8, 40.6, -89.1], MT: [44.35, -116.1, 49.0, -104.0],
  NE: [39.99, -104.06, 43.0, -95.3], NV: [35.0, -120.0, 42.0, -114.0], NH: [42.7, -72.6, 45.3, -70.6],
  NJ: [38.9, -75.6, 41.36, -73.9], NM: [31.3, -109.05, 37.0, -103.0], NY: [40.5, -79.77, 45.02, -71.85],
  NC: [33.8, -84.33, 36.6, -75.4], ND: [45.9, -104.05, 49.0, -96.55], OH: [38.4, -84.82, 42.33, -80.5],
  OK: [33.6, -103.0, 37.0, -94.4], OR: [41.99, -124.6, 46.3, -116.45], PA: [39.7, -80.52, 42.27, -74.7],
  RI: [41.1, -71.9, 42.02, -71.1], SC: [32.0, -83.35, 35.2, -78.5], SD: [42.48, -104.06, 45.95, -96.44],
  TN: [34.98, -90.31, 36.68, -81.65], TX: [25.84, -106.65, 36.5, -93.5], UT: [36.99, -114.05, 42.0, -109.04],
  VA: [36.54, -83.68, 39.47, -75.24], VT: [42.72, -73.44, 45.02, -71.5], WA: [45.54, -124.77, 49.0, -116.9],
  WI: [42.49, -92.89, 47.08, -86.25], WV: [37.2, -82.65, 40.64, -77.72], WY: [40.99, -111.06, 45.0, -104.05],
};

// A real, on-land, populated coordinate per state (its capital, or a larger city where the
// capital sits awkwardly for this purpose — Florida's Tallahassee is a Panhandle outlier, so this
// uses Orlando instead). Used only as the center of the NEW-3 timing-budget envelope query below;
// never shipped, never a claim about jurisdiction.
export const STATE_PROBE_POINT = {
  AL: [32.3792, -86.3077], AK: [58.3019, -134.4197], AZ: [33.4484, -112.0740], AR: [34.7465, -92.2896],
  CA: [38.5816, -121.4944], CO: [39.7392, -104.9903], CT: [41.7658, -72.6734], DE: [39.1582, -75.5244],
  DC: [38.9072, -77.0369], FL: [28.5384, -81.3789], GA: [33.7490, -84.3880], HI: [21.3069, -157.8583],
  ID: [43.6150, -116.2023], IL: [39.7817, -89.6501], IN: [39.7684, -86.1581], IA: [41.5868, -93.6250],
  KS: [39.0473, -95.6752], KY: [38.2009, -84.8733], LA: [30.4515, -91.1871], ME: [44.3106, -69.7795],
  MD: [38.9784, -76.4922], MA: [42.3601, -71.0589], MI: [42.7325, -84.5555], MN: [44.9778, -93.2650],
  MS: [32.2988, -90.1848], MO: [38.5767, -92.1735], MT: [46.5891, -112.0391], NE: [40.8136, -96.7026],
  NV: [39.1638, -119.7674], NH: [43.2081, -71.5376], NJ: [40.2171, -74.7429], NM: [35.6870, -105.9378],
  NY: [42.6526, -73.7562], NC: [35.7796, -78.6382], ND: [46.8083, -100.7837], OH: [39.9612, -82.9988],
  OK: [35.4676, -97.5164], OR: [44.9429, -123.0351], PA: [40.2732, -76.8867], RI: [41.8240, -71.4128],
  SC: [34.0007, -81.0348], SD: [44.3683, -100.3510], TN: [36.1627, -86.7816], TX: [30.2672, -97.7431],
  UT: [40.7608, -111.8910], VA: [37.5407, -77.4360], VT: [44.2601, -72.5754], WA: [47.0379, -122.9007],
  WI: [43.0731, -89.4012], WV: [38.3498, -81.6326], WY: [41.1400, -104.8202],
};

// Below this, a "statewide" candidate's own extent spans materially less than the state it
// claims — set with room to spare beneath the real Nebraska defect this was built for (≈6–7% in
// both dimensions), so it fires with a wide margin before a legitimately irregular state's honest
// lower reading (Alaska/Hawaii/Michigan) would false-positive.
export const COVERAGE_SPAN_FLOOR = 0.35;

export const ENVELOPE_QUERY_BUDGET_MS = 8000; // mirrors PARCEL_FETCH_TIMEOUT_MS (arcgis.js) — see header above
export const ENVELOPE_HALF_MILES = 3.5; // a ~7-mile square, matching the dispatch brief's own measured test shape
export const MILES_PER_DEG_LAT = 69.0;

/* Is a point inside a WGS84 extent's own declared coverage? Pure. Used to catch the OTHER half of
 * Tennessee's finding: its extent claims to cover Nashville (34.98–36.68°N / -90.31 to -81.65°W
 * contains 36.1627/-86.7816), yet a real envelope query centered there measured 4.2–25.5s across
 * repeated runs and answered with ZERO features every time. A slow-but-honest "nothing here" at the
 * edge of a layer's coverage is normal; an empty answer at a point the layer's OWN extent claims to
 * reach is a defect worth flagging independent of whether that particular run happened to land
 * inside or outside the timing budget. */
export function pointInsideExtent(lat, lng, extentLatLon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !extentLatLon || extentLatLon.failed) return null;
  const { ymin, xmin, ymax, xmax } = extentLatLon;
  return lat >= ymin && lat <= ymax && lng >= xmin && lng <= xmax;
}

/* Project a layer's declared `extent` (its own native spatial reference) to lat/lon via Esri's
 * public Geometry Service. Returns `{ ymin, xmin, ymax, xmax }` in WGS84, or `{ failed: true, why }`
 * — never throws, so one bad reprojection can't take a whole probe run down. A layer already
 * published in a geographic SR (4326 or unset) skips the network round trip entirely. */
export async function projectExtentToWgs84(extent, { fetchJson } = {}) {
  if (!extent || !Number.isFinite(extent.xmin) || !Number.isFinite(extent.ymin)) return { failed: true, why: "no usable extent in metadata" };
  const wkid = (extent.spatialReference && (extent.spatialReference.latestWkid || extent.spatialReference.wkid)) || null;
  if (!wkid || wkid === 4326) return { ymin: extent.ymin, xmin: extent.xmin, ymax: extent.ymax, xmax: extent.xmax };
  const geometries = JSON.stringify({
    geometryType: "esriGeometryEnvelope",
    geometries: [{ xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax }],
  });
  const qs = new URLSearchParams({ f: "json", inSR: String(wkid), outSR: "4326", geometries });
  const res = await fetchJson(`${GEOMETRY_SERVICE_PROJECT_URL}?${qs}`);
  const g = res.json && Array.isArray(res.json.geometries) && res.json.geometries[0];
  if (!res.ok || !g || !Number.isFinite(g.xmin)) return { failed: true, why: res.blocked ? "geometry service blocked by this sandbox's egress policy" : `project op failed (${res.status || res.error || "no geometry returned"})` };
  return { ymin: g.ymin, xmin: g.xmin, ymax: g.ymax, xmax: g.xmax };
}

/* Does a WGS84 extent materially cover the state it's wired for? Pure — no network. Compares the
 * extent's own lat/lon SPAN against the state's reference bbox span in each dimension separately
 * (not area), because a layer that is narrow in only ONE dimension — Nebraska's was both, but a
 * layer clipped to a single north-south or east-west strip is just as wrong — must not average out
 * against a healthy other dimension. */
export function extentCoverageCheck(extentLatLon, stateAbbr) {
  const ref = STATE_BBOX[stateAbbr];
  if (!ref || !extentLatLon || extentLatLon.failed) return null;
  const [refS, refW, refN, refE] = ref;
  const { ymin, xmin, ymax, xmax } = extentLatLon;
  const refLatSpan = refN - refS, refLonSpan = refE - refW;
  const latSpan = Math.max(0, ymax - ymin), lonSpan = Math.max(0, xmax - xmin);
  const latFrac = refLatSpan > 0 ? latSpan / refLatSpan : null;
  const lonFrac = refLonSpan > 0 ? lonSpan / refLonSpan : null;
  const insufficient = (latFrac != null && latFrac < COVERAGE_SPAN_FLOOR) || (lonFrac != null && lonFrac < COVERAGE_SPAN_FLOOR);
  return { latFrac, lonFrac, insufficient, ref, extent: extentLatLon };
}

/* Run the envelope-intersect/attributes-only query the app's own viewport draw performs, timed
 * against `ENVELOPE_QUERY_BUDGET_MS`, and report whether it actually answered inside that budget —
 * never just how long it took. The injected `fetchJson`'s own AbortController does the enforcing;
 * this only reads the result and never throws, same contract as every other probe function here. */
export async function probeEnvelopeTiming(url, centerLat, centerLng, { timeoutMs = ENVELOPE_QUERY_BUDGET_MS, fetchJson } = {}) {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return { skipped: true, why: "no usable probe point" };
  const dLat = ENVELOPE_HALF_MILES / MILES_PER_DEG_LAT;
  const milesPerDegLng = MILES_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180) || MILES_PER_DEG_LAT;
  const dLng = ENVELOPE_HALF_MILES / milesPerDegLng;
  const geometry = JSON.stringify({
    xmin: centerLng - dLng, ymin: centerLat - dLat, xmax: centerLng + dLng, ymax: centerLat + dLat,
    spatialReference: { wkid: 4326 },
  });
  const qs = new URLSearchParams({
    f: "json", geometry, geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID", returnGeometry: "false",
  });
  const res = await fetchJson(`${url}/query?${qs}`, { timeout: timeoutMs });
  const overBudget = !res.ok || res.ms > timeoutMs;
  const timedOut = !res.ok && /abort/i.test(String(res.error || ""));
  return {
    ms: res.ms, overBudget, timedOut,
    featureCountInEnvelope: res.json && Array.isArray(res.json.features) ? res.json.features.length : null,
    status: res.status, error: overBudget ? res.error : undefined,
  };
}
