/* Verify the Texarkana/Chambers fix — a parcel-source-outage notice must name a county the
 * current MAP VIEW could plausibly contain, and must clear once the view leaves it.
 *
 * Reported live: Michael panned to Texarkana (Bowie County, far NE Texas) and the map read
 * "Chambers County's live parcel server is unavailable — showing Planyr's saved copy… Clicking a
 * lot still selects it." Chambers is a Gulf Coast county on Galveston Bay, ~300 miles away and
 * nowhere near the viewport. The fix (`counties.js`'s `countyBboxIntersectsView` + `MapFinder.jsx`'s
 * `setSourceNotice`/`sourceNoticeStillPlausible`, wired into `onMove`) is fully proven at the
 * pure-function level in `test/counties.test.js`; this harness drives the real component end to end
 * and covers BOTH halves of the mechanism in one gesture sequence:
 *   1. fly to Chambers's own area → the notice correctly APPEARS (it names somewhere the view
 *      genuinely is);
 *   2. fly away to Texarkana, ~300 miles off, with NO OTHER interaction in between → the notice
 *      CLEARS on its own, the moment the view no longer contains Chambers.
 *
 * ⛔ TEETH, per this repo's own rule (a check nobody has seen fail is not a check) — run against the
 * pre-fix tree, this harness reproduces the reported defect VERBATIM: after flying away to
 * Texarkana, the toast still reads
 *   "Chambers County's live parcel server is unavailable — showing Planyr's saved copy · as of
 *   Aug 4, 2026. Clicking a lot still selects it."
 * — stuck, exactly as reported. Only the fix clears it. (Confirmed by temporarily reverting the
 * MapFinder.jsx/counties.js changes and re-running this file — see the item's PR for the transcript.)
 *
 * WHY `flyToSite` (a saved site's "Show on map" pin), NOT a second address search: `goAddress`
 * (the search box's handler) calls `setErr("")` at its own start, for reasons unrelated to this fix
 * — so a search-based "pan" would clear ANY notice regardless of whether this fix exists, passing
 * vacuously on both the broken and the fixed tree (an earlier draft of this harness made exactly
 * that mistake). `flyToSite` — the map-pin icon beside a saved site in the Sites list — calls
 * `map.flyTo(...)` and NOTHING else, so it moves the view the same way a real drag/pan would
 * without touching `err` itself; only `onMove`'s own re-check can be responsible for a change here.
 *
 * WHY THE VIEW IS FLOWN TO CHAMBERS *BEFORE* ENTERING SELECT MODE (learned the hard way — an
 * earlier draft entered select mode first, at the app's default landing view, and every assertion
 * passed vacuously on BOTH trees because Chambers's layer never actually reached its own host):
 * entering select mode (`Object.keys(layerUrlsRef.current).forEach(addDisplay)`) mounts an outline
 * layer for every one of the ~70 configured counties/statewide composites AT ONCE, and each one's
 * very first metadata fetch (`.../MapServer/0/?f=json`) fires IMMEDIATELY, at whatever view happens
 * to be on screen the instant select mode turns on — regardless of zoom. So Chambers's outage has
 * to be armed while the view is already sitting on Chambers, or the notice this harness is trying
 * to observe never has a reason to appear in the first place.
 *
 * Fully hermetic — no real network to any GIS host is needed or attempted:
 *   - Chambers's own live host (gisdata.pandai.com) is ABORTED, forcing its hang-guard (`markDown`)
 *     to fire — instantly, since an abort resolves as an immediate `requesterror`, not the 8s timeout.
 *   - `/api/parcel-cache/svc/chambers` (same-origin) is served a canned snapshot so `getSnapshot`
 *     resolves truthy — the exact condition that produces the REPORTED wording (`cacheFallbackNotice`,
 *     "Chambers County's live parcel server is unavailable…"), not the unnamed generic fallback text.
 *   - EVERY other county/statewide composite's outline layer — its metadata fetch, its `/query`,
 *     and its `/export` — is answered with a canned, well-formed success, so of the ~70 counties
 *     this app loads in select mode, only Chambers ever errors. Without this, nearly all of them
 *     fail too (this sandbox's egress proxy tunnels only an allowlist of hosts — every other one
 *     comes back `ERR_TUNNEL_CONNECTION_FAILED`), racing unpredictably for which message wins.
 *   - Two throwaway sites (one at Chambers, one at Texarkana) are seeded into localStorage so the
 *     Sites list has real "Show on map" pins to drive — never one of Michael's real plans, and the
 *     seed is local-only (no Supabase/Drive write of any kind).
 *
 * Run:  VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *       npx vite preview --port 4188 &
 *       node ui-audit/verify-county-notice-plausibility.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const CHAMBERS = { lat: 29.7, lng: -94.66 };
const TEXARKANA = { lat: 33.4418, lng: -94.0377 };
const GENERATED_AT_ISO = "2026-08-04T10:37:33Z";
const GENERATED_AT_HUMAN = "Aug 4, 2026";

const squareRing = (lat, lng, h) => [
  [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
];

// A canned, well-formed EMPTY ArcGIS feature-query response — satisfies esri-leaflet's
// featureLayer as a clean zero-result answer (fires 'load', never 'requesterror').
const EMPTY_ARCGIS_QUERY = JSON.stringify({
  objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
  spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: [],
});
// A canned, well-formed layer-metadata response — every featureLayer fetches this once, up front,
// REGARDLESS of the current zoom (unlike the feature query itself, which is zoom-gated).
const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon",
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
});
// A minimal valid 1×1 transparent PNG — satisfies a statewide composite's /export image overlay.
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const CHAMBERS_FIXTURE = {
  meta: { cached: true, generatedAt: GENERATED_AT_ISO, count: 1, source: "stratmap-2025", stale: false },
  fc: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { OBJECTID: 1, Prop_ID: "TEST1", OWNER_NAME: "TEST OWNER", LEGAL_AREA: 5.0, GIS_AREA: 5.0, SITUS_ADDR: "123 Test Rd", county: "CHAMBERS" },
      geometry: { type: "Polygon", coordinates: [squareRing(CHAMBERS.lat, CHAMBERS.lng, 0.0015)] },
    }],
  },
};

// Two throwaway local sites (never touching Supabase/Drive — pure localStorage, this device
// only) so the Sites list has real "Show on map" pins to fly with, per DECISION #7 in
// `/CLAUDE.md`'s owner product constraints ("a live check runs on a throwaway duplicate… never on
// one of Michael's real plans, and the session says exactly what was touched" — this touches
// nothing of his; both sites are minted fresh in this headless browser profile and discarded with it).
function seedThrowawaySites() {
  const sites = {
    s_verify_chambers: {
      id: "s_verify_chambers", groupId: "s_verify_chambers", site: "Chambers Test Site", name: "Plan 1",
      status: "active", origin: { lat: CHAMBERS.lat, lon: CHAMBERS.lng }, county: "chambers",
      parcels: [], els: [], updatedAt: Date.now(),
    },
    s_verify_texarkana: {
      id: "s_verify_texarkana", groupId: "s_verify_texarkana", site: "Texarkana Test Site", name: "Plan 1",
      status: "active", origin: { lat: TEXARKANA.lat, lon: TEXARKANA.lng }, county: null,
      parcels: [], els: [], updatedAt: Date.now() - 500000,
    },
  };
  return `(() => { try {
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`;
}

function installRoutes(page) {
  return page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("gisdata.pandai.com")) return route.abort("connectionfailed"); // Chambers CCAD — forced down
    if (u.includes("/api/parcel-cache/svc/")) {
      const url = new URL(u);
      const county = url.pathname.split("/").filter(Boolean)[3];
      if (county !== "chambers") return route.fulfill({ status: 404 });
      const isMeta = url.searchParams.get("meta") === "1";
      return route.fulfill({
        status: 200,
        contentType: isMeta ? "application/json" : "application/geo+json",
        body: JSON.stringify(isMeta ? CHAMBERS_FIXTURE.meta : CHAMBERS_FIXTURE.fc),
      });
    }
    // Every OTHER county/statewide composite's ArcGIS traffic — metadata, feature query, or a
    // statewide layer's raster /export — answered as a clean success (see header: without this,
    // nearly all of them fail too, via this sandbox's proxy, and the race is undirected).
    if (/\/(MapServer|FeatureServer)\//i.test(u)) {
      if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_ARCGIS_QUERY });
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK }); // bare metadata
    }
    return route.continue();
  });
}

// Hover the row (the pin only becomes clickable on hover/focus — `pointerEvents` follows React
// hover state) then click its "Show on map" pin — the SAME `flyToSite` a real click on a saved
// site uses, so this is not a synthetic shortcut around the app's own code.
async function flyToSeededSite(page, label) {
  const row = page.locator('div[title*="Open site"]').filter({ hasText: label }).first();
  await row.hover();
  await row.locator('[aria-label="Show on map"]').click();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await assertMeasurable(page, "verify-county-notice-plausibility");
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(String(e)); console.log("  [pageerror]", String(e)); });

await page.addInitScript(seedThrowawaySites());
await installRoutes(page);
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

console.log("\n--- 1: fly to Chambers's own area, then arm select mode — Chambers's CCAD goes down ---");
await flyToSeededSite(page, "Chambers Test Site");
await page.waitForTimeout(1500);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
await page.waitForTimeout(2500);

const toast = () => page.locator('[data-testid="map-status-toast"]');
const toastTextOf = async () => { const t = toast(); return (await t.count()) && await t.first().isVisible().catch(() => false) ? t.first().innerText() : ""; };

const atChambers = await toastTextOf();
console.log(`  banner text: ${atChambers ? JSON.stringify(atChambers) : "(none shown)"}`);
expect(
  "the notice correctly APPEARS while the view is genuinely at Chambers, naming Chambers and its snapshot date",
  atChambers.includes("Chambers") && atChambers.includes(GENERATED_AT_HUMAN),
  atChambers || "(none shown)",
);

console.log("\n--- 2: fly away to Texarkana (~300 mi), via a saved site's pin — no search, no other interaction ---");
await flyToSeededSite(page, "Texarkana Test Site");
await page.waitForTimeout(2000);

const atTexarkana = await toastTextOf();
console.log(`  banner text: ${atTexarkana ? JSON.stringify(atTexarkana) : "(none shown)"}`);
expect(
  "the notice CLEARS on its own once the view leaves Chambers for Texarkana, 300 miles away — the reported bug",
  !/chambers/i.test(atTexarkana),
  atTexarkana || "(cleared — pass)",
);
expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);

await page.close();
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — county-notice plausibility (the Texarkana/Chambers fix)`);
process.exit(failures ? 1 : 0);
