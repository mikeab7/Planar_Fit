/* V190 (B609) step 5 — the floating cursor chip (feetToLatLng/CursorChip, the current form of the
 * old EPSG:2278 easting/northing pill) must be ABSENT on a plan with no origin set — there is no
 * ground coordinate to show. Logged-out, no external GIS needed (ATTEMPT-BEFORE-YOU-PARK).
 *
 * `SitePlanner.jsx`'s `cursorLL` memo returns null whenever `!origin`, and `CursorChip` itself
 * bails (`if (!ll) return null`) — so the DOM never gets the child `[data-ground-el]` span. This
 * harness seeds two plans (one WITH an origin, one WITHOUT), moves the mouse over the canvas on
 * each, and asserts the chip's presence tracks the origin — the "positive control" plan is the
 * known-good arm (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): if it ever stopped showing the chip too,
 * that would mean the PROBE broke, not the app.
 *
 * Run:  npm run build && npx vite preview --port 4173
 *       node ui-audit/verify-v190-cursor-chip-no-origin.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";

function seedScript(siteId, site) {
  return `(() => { try {
    localStorage.setItem(${JSON.stringify(SITES_KEY)}, JSON.stringify(${JSON.stringify({ [siteId]: site })}));
    localStorage.setItem(${JSON.stringify(CUR_KEY)}, ${JSON.stringify(siteId)});
  } catch (e) {} })();`;
}

const baseSite = {
  schemaVersion: 2, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -300, y: -150 }, { x: 300, y: -150 }, { x: 300, y: 200 }, { x: -300, y: 200 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -20, w: 360, h: 150, rot: 0 }],
  markups: [], measures: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(),
};

const withOrigin = { ...baseSite, id: "site-origin", groupId: "grp-origin", site: "Origin Test", name: "Concept A", origin: { lat: 29.78, lon: -95.8 } };
const noOrigin = { ...baseSite, id: "site-noorigin", groupId: "grp-noorigin", site: "No-Origin Test", name: "Concept A", origin: null };

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function chipPresentAfterHover(site) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedScript(site.id, site));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-v190-cursor-chip-no-origin");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  // The app now opens on the Dashboard workspace by default — switch to Site Planner explicitly.
  const tab = page.getByTestId("module-tab-site-planner");
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(2000);
  const svg = page.getByTestId("planner-canvas");
  const svgCount = await svg.count().catch(() => 0);
  if (!svgCount) { await ctx.close(); return { chip: null, errs, noPlanner: true }; }
  const box = await svg.first().boundingBox();
  // A few points across the canvas — the chip only needs ONE hover to prove the state either way.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 });
  await page.waitForTimeout(400);
  const chip = await page.$("[data-ground-el]");
  const present = !!chip;
  await ctx.close();
  return { chip: present, errs };
}

const withRes = await chipPresentAfterHover(withOrigin);
check("positive control — chip PRESENT on a plan WITH an origin (proves the probe can see the chip at all)", withRes.chip === true, JSON.stringify(withRes));

const noRes = await chipPresentAfterHover(noOrigin);
check("V190 step 5 — chip ABSENT on a plan with NO origin set", noRes.chip === false, JSON.stringify(noRes));

await browser.close();
const failed = results.filter((r) => !r.p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
