/* probe-comp-county-state — WHICH COUNTY KEY does a comp anchor get for an OUT-OF-STATE point?
 *
 * The Comps card's `countyLabel` was cleared by probe-county-label.mjs (card agrees with the
 * registry for every configured key). This probe aims one level UP, at the code that decides
 * WHICH key a dropped comp pin carries — `countyKeyForName(name)` called with no state, on an
 * answer (`countyAtPoint` → `resolveCounty`) that is backed by a NATIONAL 3,144-county roster.
 *
 * KNOWN-GOOD ARMS ARE PART OF THE ASSERTION (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a real Texas
 * Montgomery point and a real Colorado point must keep answering `montgomery` / `co_denver`, or
 * the probe is measuring itself rather than the app.
 *
 * Run: npx vite-node ui-audit/review-2026-09-08/probe-comp-county-state.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { loadCountyPolygons, resolveCounty } = await import(`${ROOT}/src/workspaces/site-planner/lib/countyPolygons.js`);
const { countyKeyForName } = await import(`${ROOT}/src/workspaces/site-planner/lib/counties.js`);
const { countyLabel } = await import(`${ROOT}/src/workspaces/dashboard/lib/compsCardModel.js`);

await loadCountyPolygons(async () => ({
  ok: true, status: 200,
  json: async () => JSON.parse(await readFile(`${ROOT}/public/geo/county-polygons.json`, "utf8")),
}));

const POINTS = [
  { what: "Montgomery County, PA (Norristown)", lat: 40.121, lng: -75.34, expectState: "PA", inState: false },
  { what: "Liberty County, GA (Hinesville)", lat: 31.846, lng: -81.60, expectState: "GA", inState: false },
  { what: "Chambers County, AL (Lanett)", lat: 32.87, lng: -85.19, expectState: "AL", inState: false },
  { what: "Harris County, GA (Hamilton)", lat: 32.75, lng: -84.87, expectState: "GA", inState: false },
  // KNOWN-GOOD ARMS — these must keep resolving, or the probe is broken, not the app.
  { what: "Montgomery County, TX (Conroe)", lat: 30.311, lng: -95.456, expectState: "TX", inState: true, expectKey: "montgomery" },
  // Denver's known-good arm expects the STATE-QUALIFIED key: unqualified it is null, which is the
  // second half of the same defect — before the fix every Colorado comp lost its county entirely.
  { what: "Denver, CO", lat: 39.739, lng: -104.99, expectState: "CO", inState: true, expectKey: "co_denver" },
];

let mislabelled = 0, knownGoodFailures = 0;
for (const p of POINTS) {
  const ans = resolveCounty(p.lat, p.lng);
  const unqualified = ans.status === "ok" ? countyKeyForName(ans.name) : null;      // what the app does today
  const qualified = ans.status === "ok" ? countyKeyForName(ans.name, ans.state) : null; // what it should do
  const label = countyLabel(unqualified);
  const bad = !p.inState && !!unqualified;
  if (bad) mislabelled++;
  if (p.inState && qualified !== p.expectKey) knownGoodFailures++;
  console.log(
    `${bad ? "✗" : "·"} ${p.what.padEnd(36)} geometry=${String(ans.name)}, ${String(ans.state)}` +
    `  → key(no state)=${String(unqualified)}  label="${String(label)}"` +
    `  | key(state-qualified)=${String(qualified)}`,
  );
}
console.log(`\nOut-of-state points given a Texas county key: ${mislabelled} of ${POINTS.filter((p) => !p.inState).length}`);
console.log(`Known-good arms that failed (probe is void if > 0): ${knownGoodFailures}`);
console.log("\nRead the two key columns together: `key(no state)` is what the app did before the\nNEW-1 fix, `key(state-qualified)` is what every call site does now.");
