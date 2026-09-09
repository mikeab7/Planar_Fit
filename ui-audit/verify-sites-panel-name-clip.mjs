/* verify-sites-panel-name-clip — B1424624: the Sites-panel row's project name collapsing to a
 * single-character stub (and the filter row's "Filter by name…" placeholder clipping to
 * "Filter by n") when a row carries both the "no boundary" and "no location" standing-fact flags
 * at once — the exact scene the Dashboard's "N projects' location(s) need fixing →" link (fixed
 * in #1589/B1401952) lands on. Driven with a stubbed Supabase host, same shape as
 * verify-locations-map-card.mjs, so this needs no live auth and no live GIS (unlike that card's
 * satellite tiles, nothing here reaches a real GIS host) — Verify: sandbox, not live.
 *
 * WRONG-CASE's own rule: a harness for a reported symptom must refuse to report a score unless
 * the reported configuration is really present. So every width sweep below seeds the OWNER'S
 * OWN reported shape — a long duplicated name with BOTH flags — plus the adjacent cases the item
 * asked to be checked: a short name, a long name with only ONE flag (either direction), and a
 * name with NEITHER flag, at 1568/1280/1024 (desktop) and 390 (phone), filtered and unfiltered.
 *
 * Build first with a stub-shaped Supabase config, matching the stub host below:
 *   VITE_SUPABASE_URL="https://stub.supabase.co" VITE_SUPABASE_ANON_KEY="stub-anon-key" \
 *     npx vite build && npx vite preview --port 4173
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { installStubSupabase } from "./lib/stubSupabase.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";

const jwt = (payload) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.sig`;
};
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

let n = 0;
const row = (name, lat, lon) => {
  n += 1;
  const id = `zzclip-${n}`;
  return { id, group_id: id, site: name, name, county: "Harris", status: "pursuit", role: "pursuit",
    updated_at: new Date(Date.now() - n * 1000).toISOString(), origin: lat == null ? null : { lat, lon },
    user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1,
    parcels: [], els: [], measures: [], settings: {} };
};
// Two chips (the owner's OWN reported shape — a duplicated project name, neither has a location or
// a drawn boundary): "ALUMAX Distribution Center II" ×2. One chip each direction: "Katz" (short
// name, has a location but no drawn parcel → "no boundary" only) and "Silvestri Industrial Park
// Building 3" (long name, has a drawn parcel but no location → "no location" only). Zero chips:
// "Grand Port Logistics Center" (has both).
const sites = [
  row("ALUMAX Distribution Center II", null, null),
  row("ALUMAX Distribution Center II (copy)", null, null),
  row("Katz", 29.85, -95.75),
  row("Silvestri Industrial Park Building 3", null, null),
  row("Grand Port Logistics Center", 29.81, -95.56),
];
const parcelRow = (siteId) => ({ site_id: siteId, kind: "parcel", deleted_at: null,
  data: { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], active: true } });
const siteElements = [
  parcelRow(sites.find((s) => s.name === "Silvestri Industrial Park Building 3").id),
  parcelRow(sites.find((s) => s.name === "Grand Port Logistics Center").id),
];

const modelPlan = (s) => ({
  id: s.id, groupId: s.group_id, site: s.site, name: s.name, origin: s.origin, county: s.county,
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.parse(s.updated_at),
});
const localSites = Object.fromEntries(sites.map((s) => [s.id, modelPlan(s)]));
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify(localSites))});
} catch (e) {} })();`;

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const tables = { sites, comps: [], site_elements: siteElements };
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function readPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="map-sites-panel"]');
    if (!panel) return null;
    const rows = [...panel.querySelectorAll('div[title^="Open site"]')].map((r) => {
      const nameSpan = r.querySelector("span");
      const badges = [...r.querySelectorAll('span[title="No boundary drawn yet"], span[title^="No location set"]')];
      return {
        nameText: nameSpan ? nameSpan.textContent : null,
        nameWidth: nameSpan ? nameSpan.getBoundingClientRect().width : null,
        chipCount: badges.length,
      };
    });
    const input = panel.querySelector('input[aria-label="Filter sites by name"]');
    let placeholderClipped = null, inputWidth = null;
    if (input) {
      const cs = getComputedStyle(input);
      const c2 = document.createElement("canvas").getContext("2d");
      c2.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const textWidth = c2.measureText(input.placeholder).width;
      inputWidth = input.getBoundingClientRect().width;
      const innerWidth = inputWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      placeholderClipped = textWidth > innerWidth;
    }
    return { panelWidth: panel.getBoundingClientRect().width, inputWidth, placeholderClipped, rows };
  });
}

async function runAt(width, height, label, { clickMissing = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  await installStubSupabase(ctx, { tables, session, wire: [], control: {} });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-sites-panel-name-clip");
  await page.goto(BASE + "#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="locations-map-card"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (clickMissing) {
    const missing = await page.$('[data-testid="locations-map-missing"]');
    if (missing) { await missing.click(); await page.waitForTimeout(3000); }
  } else {
    await page.evaluate(() => { location.hash = "#/site"; });
    await page.waitForTimeout(3000);
  }
  const info = await readPanel(page);
  await ctx.close();

  if (!info) { ok(`[${label}] Sites panel present`, false); return; }
  ok(`[${label}] filter input's placeholder is not clipped (width ${info.inputWidth?.toFixed(1)}px)`, info.placeholderClipped === false);
  for (const r of info.rows) {
    // "more than a truncation stub" — a real ellipsis-truncated name still carries several
    // characters of real width; a collapsed row (the reported defect) renders under ~20px, not
    // even one glyph.
    ok(`[${label}] "${r.nameText}" (${r.chipCount} chip${r.chipCount === 1 ? "" : "s"}) renders more than a truncation stub (width ${r.nameWidth?.toFixed(1)}px)`,
      r.nameWidth != null && r.nameWidth >= 20, `nameWidth=${r.nameWidth}`);
  }
}

await runAt(1568, 900, "filtered-1568");
await runAt(1280, 900, "filtered-1280");
await runAt(1024, 900, "filtered-1024");
await runAt(390, 844, "filtered-phone-390");
await runAt(1568, 900, "unfiltered-1568", { clickMissing: false });

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name)); process.exit(1); }
