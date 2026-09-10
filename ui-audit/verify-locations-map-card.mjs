/* verify-locations-map-card — B1401952/V1018240: the Dashboard's Locations map card, driven with
 * a stubbed Supabase host so the sandbox's two standing blockers (Blocker: auth — the proxy
 * CORS-blocks a real Supabase sign-in; Blocker: live-GIS — the proxy hard-blocks every external
 * tile host) don't leave the whole fix unverified. Modeled on
 * ui-audit/verify-signed-in-project-delete.mjs's stub-Supabase + local-cloud-cache seed shape.
 *
 * WRONG-CASE's own rule: a harness for a reported symptom must refuse to score unless the
 * reported configuration is really present. So this seeds the owner's OWN five named colliding
 * pairs — Goose Creek/Grand Port, JFK/Sam Houston, Silvestri/Telge, Gessner/742, Katz/154602 —
 * each pair a few dozen meters apart (inside label-collision range at whatever zoom the fit
 * lands on), plus one project with no location at all (fix #1's target), and asserts each pair
 * BY NAME rather than trusting a generic "N labels visible" count.
 *
 * WHAT THIS PROVES that the sandbox otherwise couldn't: all three fixes' actual DOM/network
 * behavior, in both themes, with the exact reported names. WHAT IT DOES NOT PROVE (the residual
 * live gap — see V1018240): that the real tiles paint (this harness only asserts the request URL,
 * then aborts it — a real fetch to server.arcgisonline.com is still refused by this sandbox's
 * proxy) and that this holds against the real production database rather than this stub.
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
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
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

// Five colliding pairs, mirroring the owner's report by name; each pair sits a few dozen meters
// apart, and the pairs themselves are spread a few miles apart around a Houston-ish cluster so
// fitBounds lands at a realistic neighborhood zoom rather than a whole-metro one. One project has
// NO origin at all (fix #1's target). A mix of active/pursuit status tests the priority rule.
let n = 0;
const row = (name, status, lat, lon) => {
  n += 1;
  const id = `zzloc-${n}`;
  return { id, group_id: id, site: name, name, county: "Harris", status, role: "pursuit",
    updated_at: new Date(Date.now() - n * 1000).toISOString(), origin: lat == null ? null : { lat, lon },
    user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1,
    parcels: [], els: [], measures: [], settings: {} };
};
const sites = [
  row("Goose Creek", "active", 29.7350, -94.9774),
  row("Grand Port", "pursuit", 29.7351, -94.9773),
  row("JFK", "pursuit", 29.9490, -95.3420),
  row("Sam Houston", "pursuit", 29.9491, -95.3419),
  row("Silvestri", "active", 29.8100, -95.5600),
  row("Telge", "pursuit", 29.8101, -95.5599),
  row("Gessner", "pursuit", 29.7800, -95.5200),
  row("742", "pursuit", 29.7801, -95.5199),
  row("Katz", "active", 29.8500, -95.7500),
  row("154602", "pursuit", 29.8501, -95.7499),
  row("No Location Yet", "pursuit", null, null),
];

// site-planner's own MapFinder reads from the LOCAL on-device cloud cache (loadSitesList() →
// readSites(), planarfit:sites:cloud:<uid> — the sync target a real pullCloud() sign-in would
// have filled), not from a live Supabase query — so it needs its OWN seed, in SiteModel shape,
// mirroring verify-signed-in-project-delete.mjs's `plan()` builder. Same 11 projects as `sites`.
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

const wire = [];
const tables = { sites, comps: [] };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function runTheme(colorScheme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, colorScheme });
  await installStubSupabase(ctx, { tables, session, wire, control: {} });
  const tileRequests = [];
  // The real host is genuinely unreachable from this sandbox either way — aborting here just
  // makes that explicit instead of hanging on the proxy's own silent drop, while still letting us
  // see exactly what URL the app asked for.
  await ctx.route("**://server.arcgisonline.com/**", (route) => {
    tileRequests.push(route.request().url());
    route.abort();
  });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locations-map-card");
  page.on("pageerror", (e) => console.log(`  [pageerror/${colorScheme}]`, String(e).slice(0, 300)));
  await page.goto(BASE + "#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="locations-map-card"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500); // let the Leaflet map settle + zoomend/moveend + label-collision pass run

  const cardPresent = await page.$('[data-testid="locations-map-card"]') !== null;
  ok(`[${colorScheme}] Locations map card renders with real project data (not the empty state)`, cardPresent);

  if (cardPresent) {
    // ---- fix #3: satellite basemap ----
    await page.waitForTimeout(300);
    ok(`[${colorScheme}] requested Esri World Imagery tiles (site-planner's own BASEMAPS.esri, not a second provider)`,
      tileRequests.some((u) => u.includes("World_Imagery/MapServer/tile")), tileRequests[0] || "(no tile request seen)");
    ok(`[${colorScheme}] did NOT request the old Gray Canvas basemap`,
      !tileRequests.some((u) => u.includes("Gray_Base") || u.includes("Gray_Reference")));

    // ---- fix #2: label collide-avoid ----
    const labelInfo = await page.evaluate(() => {
      const spans = [...document.querySelectorAll(".dash-map-label-text")];
      return spans.map((el) => {
        const marker = el.closest(".dash-map-marker");
        const cs = getComputedStyle(el);
        return {
          text: el.textContent,
          visible: cs.display !== "none",
          kind: marker && marker.classList.contains("dash-map-marker--active") ? "active" : "pursuit",
          bg: cs.backgroundColor,
        };
      });
    });
    const byName = (t) => labelInfo.find((l) => l.text === t);
    const pairs = [["Goose Creek", "Grand Port"], ["JFK", "Sam Houston"], ["Silvestri", "Telge"], ["Gessner", "742"], ["Katz", "154602"]];
    for (const [a, b] of pairs) {
      const la = byName(a), lb = byName(b);
      const visibleCount = [la, lb].filter((l) => l && l.visible).length;
      ok(`[${colorScheme}] "${a}"/"${b}" — exactly one label visible, not both stacked`, visibleCount === 1,
        `${a}=${la ? la.visible : "missing"} ${b}=${lb ? lb.visible : "missing"}`);
    }
    // Active-vs-pursuit priority: of the visible ones, the active pair member should win when both exist.
    const activePairWinner = byName("Goose Creek"); // active
    ok(`[${colorScheme}] the active project in a colliding pair keeps its label over the pursuit`,
      activePairWinner && activePairWinner.visible, JSON.stringify(activePairWinner));

    // ---- label legibility: solid backing plate, not transparent ----
    const anyVisible = labelInfo.find((l) => l.visible);
    ok(`[${colorScheme}] a visible label's background is a solid (opaque) color, not transparent`,
      anyVisible && anyVisible.bg && !/rgba?\([^)]*,\s*0\s*\)/.test(anyVisible.bg) && anyVisible.bg !== "transparent",
      anyVisible ? anyVisible.bg : "(no visible label found)");

    // ---- fix #1: the dead link, now an intent-carrying navigate ----
    const missing = await page.$('[data-testid="locations-map-missing"]');
    ok(`[${colorScheme}] the "N projects need fixing" line is present (one project has no origin)`, !!missing);
    if (missing) {
      const missingText = await missing.innerText();
      ok(`[${colorScheme}] it reports exactly 1 missing location`, /^1\s/.test(missingText.trim()), missingText);
      await missing.click();
      await page.waitForTimeout(1200);
      const hash = await page.evaluate(() => location.hash);
      ok(`[${colorScheme}] click navigates to the Site Planner (module changed)`, hash.startsWith("#/site"), hash);
      const bannerText = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find((d) => d.textContent && d.textContent.includes("Showing only projects with no location set"));
        return el ? el.textContent : null;
      });
      ok(`[${colorScheme}] MapFinder's Sites panel opens with the missing-location filter banner`, !!bannerText, bannerText);
      const flaggedRowVisible = await page.evaluate(() => {
        return [...document.querySelectorAll("span")].some((s) => s.title && s.title.startsWith("No location set"));
      });
      ok(`[${colorScheme}] the flagged "No Location Yet" project row is shown with its "no location" tag`, flaggedRowVisible);
      // B1424624 — "No Location Yet" also carries "no boundary" (no parcel seeded for it either),
      // so this fixture ALREADY exercises the two-chip squeeze this item fixed; nothing here
      // previously checked that the row's own NAME survived it. Assert the name renders as more
      // than a collapsed stub (the reported defect measured under 3px, not even one glyph).
      const nameInfo = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="map-sites-panel"]');
        const row = panel && [...panel.querySelectorAll('div[title^="Open site"]')]
          .find((r) => r.textContent && r.textContent.includes("No Location Yet"));
        const nameSpan = row && row.querySelector("span");
        return nameSpan ? { text: nameSpan.textContent, width: nameSpan.getBoundingClientRect().width } : null;
      });
      ok(`[${colorScheme}] "No Location Yet"'s own name renders as more than a truncation stub`,
        !!nameInfo && nameInfo.width >= 20, JSON.stringify(nameInfo));
    }
  }
  await ctx.close();
}

await runTheme("light");
await runTheme("dark");
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name)); process.exit(1); }
