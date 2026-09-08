/* Verify the site-plan panel redesign (B1310208-B1310211, owner decision 2026-09-07) at the
 * owner's own reported window size, 1191x465.
 *
 *   B1310208 (NEW-1) — the plan card at rest shows identity only (thumbnail, name, date/page,
 *     one "Adjust" button) — every editing control leaves the resting card.
 *   B1310209 (NEW-2) — "Adjust" opens a small panel DOCKED to the map (bottom-right — see
 *     mapChromeStack.js's own header for why that corner and the measured scale-bar clearance),
 *     matching the Layers panel's chrome. It never floats or drags.
 *   B1310210 (NEW-3) — the overflow "⋯" menu is gone; Delete lives in the panel's own footer,
 *     separated from Done; Pin comp here / Change page… join Move/resize and Crop in the body.
 *   B1310211 (NEW-4) — Opacity (dragged constantly) reads visually heavier than Rotation (set
 *     once), instead of the two sharing one weight.
 *
 * ⛔ NEW-1 (this item, regression from B1310209 — filed live 9:03 PM CDT 2026-09-07, deployed as
 * build 5c394f5) — THE ADJUST PANEL COVERED THE IMAGERY & LAYERS PANEL. Both dock to the map's
 * right edge (Layers `topright`, Adjust `bottomright`) and each sizes itself independently of the
 * other's actual rendered height, so on a short window (measured live: 1600×465 and 1191×465, the
 * owner's own real window sizes) both panels resolve to nearly the full map height and collide
 * across their whole shared width — confirmed by `document.elementFromPoint`, not just rect math.
 * The fix (`mapChromeStack.js`'s own header has the full reasoning) is that the Layers panel
 * force-collapses to its header chip the instant Adjust opens and refuses to reopen until Adjust
 * closes — there is no clearance number that lets two independently-tall right-edge panels share
 * a 465px-tall column, so ONE of them has to yield. This file now runs the whole B1310208-B1310211
 * check at BOTH of the owner's reported window sizes and adds the no-intersection assertion this
 * regression needed — a screenshot alone would not have caught it (both panels render correctly
 * on their own; only their SHARED geometry is wrong).
 *
 * Supabase itself is network-blocked from this sandbox (curl confirms: CONNECT tunnel failed,
 * 403), the same wall this repo's own e2e auth.setup.js hits — so this is a SANDBOX check, not
 * the real signed-in pass on planyr.io the owner's dispatch also asked for (`Blocker: auth`).
 * It mocks the Supabase REST/auth endpoints via Playwright's own network layer (`ctx.route`),
 * which intercepts a request before it ever leaves the browser regardless of auth/session state
 * — this is what lets a comp + a placed site-plan overlay render without a real account.
 *
 * ⛔ This is exactly how a REAL cross-cutting defect was caught, not a synthetic one: the global
 * help/report FAB (`app/HelpReportControl.jsx`) is also fixed bottom-right and measures the real
 * DOM (`shared/ui/cornerClearance.js`) to decide its own clearance, but only clears Leaflet's own
 * control container and anything carrying `data-canvas-corner` — a bottom-right occupant that
 * doesn't declare itself is invisible to that math. The Adjust panel's footer (Delete/Done) sat
 * exactly where the FAB was measured to land until it was marked
 * `data-canvas-corner="site-plan-adjust"`; that fix is asserted below (Done must be clickable).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
// NEW-1 — both of the owner's own reported real window sizes, not just one.
const VIEWPORTS = [
  { width: 1191, height: 465 },
  { width: 1600, height: 465 },
];

const OVERLAY_ROW = {
  id: "throwaway-overlay-1", user_id: "fake-user-1", team_id: null, project_id: "throwaway-project-1",
  site_link_declined: false, review_id: "fake-review-1", page: 1,
  doc_title: "Airtex - throwaway", doc_date: "2026-09-01", source_file_name: "airtex-throwaway.pdf",
  img_w: 1200, img_h: 900, raster_key: "fake-raster-key", thumb_data_url: null,
  center_lat: 29.87, center_lon: -95.55, ft_per_px: 1.2, rotation_deg: 12.5, crop: null,
  opacity: 0.85, visible: true, locked: false, version: 3,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
const COMP_ROW = {
  id: "throwaway-comp-1", user_id: "fake-user-1", team_id: null, project_id: "throwaway-project-1",
  comp_type: "land", comp_date: "2026-08-01", lease_commencement_date: null,
  title: "Core 5 - West Hardy", notes: null, anchor_kind: "pin", lat: 29.87, lon: -95.55, county: "harris",
  parcel_apn: null, parcel_geom: null, site_plan_overlay_id: "throwaway-overlay-1", site_plan_point: { x: 300, y: 200 },
  land_price: 500000, land_size_value: 5, land_size_unit: "ac",
  bldg_price: null, bldg_size_sf: null, bldg_noi: null, bldg_cap_rate: null,
  lease_rate: null, lease_rate_period: null, lease_rate_expense: null, lease_ti: null, lease_term: null, lease_size_sf: null,
  lease_free_rent_months: null, lease_escalation_pct: null, comp_party_provider: null, comp_party_acquirer: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
};

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
// Two absolute-positioned rects intersect iff they overlap on BOTH axes.
const intersects = (a, b) => !a || !b ||
  (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height);

async function runAtViewport(VIEWPORT) {
  const label = `${VIEWPORT.width}x${VIEWPORT.height}`;
  console.log(`\n=== ${label} ===`);

  // Playwright evaluates ctx.route() handlers LIFO (the most-recently-registered match runs
  // first). A SINGLE handler branching on the path — rather than several overlapping
  // "**/rest/v1/..." globs — sidesteps the ordering trap where a later, broader fallback
  // swallows an earlier, more specific one before it ever runs.
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.route("**/*.supabase.co/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/auth/v1/user") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "fake-user-1", aud: "authenticated", role: "authenticated", email: "throwaway@example.com" }) });
    }
    if (path === "/rest/v1/rpc/list_my_teams") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (path === "/rest/v1/site_plan_overlays") {
      if (req.method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([OVERLAY_ROW]) });
    }
    if (path === "/rest/v1/comps") {
      if (req.method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([COMP_ROW]) });
    }
    if (path.startsWith("/rest/v1/")) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await assertMeasurable(page, "verify-site-plan-adjust-panel");

  // Reach the Site Planner workspace (MapFinder, since no site is active).
  const tab = page.locator('[data-testid="module-tab-site-planner"]');
  await tab.waitFor({ state: "visible", timeout: 10000 });
  await tab.click();
  await page.waitForTimeout(1500);

  // The bug report's own repro zoomed the map in ("to the 300 ft scale") before opening Adjust —
  // matched here so the plan is genuinely rendering (past SITE_PLAN_MIN_ZOOM=15), not just the
  // resting card. A WHEEL zoom at a point clear of both side columns, rather than clicking the
  // Leaflet zoom-in control (this repo's usual harness idiom, ui-audit/verify-map-plan-render.mjs's
  // `zoomInTo`) — at this short 465px window the Comps rail's own bottom edge already overlaps the
  // bottom-left zoom control (a separate, pre-existing overlap, not this item's regression), so
  // clicking it here is flaky by construction; the wheel reaches the map directly.
  await page.mouse.move(Math.round(VIEWPORT.width * 0.45), Math.round(VIEWPORT.height * 0.5));
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(150); }
  await page.waitForTimeout(300);

  // Switch the rail to the Comps tab and open the throwaway comp.
  const compsTab = page.locator("button", { hasText: /^Comps/ }).first();
  await compsTab.waitFor({ state: "visible", timeout: 10000 });
  await compsTab.click();
  await page.waitForTimeout(1200);
  const compRow = page.locator("button", { hasText: "Core 5 - West Hardy" }).first();
  await compRow.waitFor({ state: "visible", timeout: 10000 });
  await compRow.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + `site-plan-01-resting-card-${label}.png` });

  const restingText0 = await page.evaluate(() => document.body.innerText);
  check("the plan is genuinely rendering, not gated by zoom (no 'Zoomed out too far' warning)", !/Zoomed out too far/.test(restingText0));

  // ---- the comp name renders whole (not clipped) ----
  const compNameBox = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("div")).find((d) => d.textContent.trim() === "Core 5 - West Hardy" && d.children.length === 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
  check("comp name 'Core 5 - West Hardy' renders with a real box", !!compNameBox, JSON.stringify(compNameBox));
  if (compNameBox) check("comp name box is inside the window (not clipped below it)", compNameBox.bottom <= VIEWPORT.height + 1, JSON.stringify(compNameBox));

  // ---- B1310208 (NEW-1): the resting card is identity-only ----
  const restingText = await page.evaluate(() => document.body.innerText);
  check("resting card shows an Adjust button", /\bAdjust\b/.test(restingText));
  check("resting card shows the plan's date/page", /2026-09-01/.test(restingText) && /p\.1/.test(restingText));
  check("no 'Move / resize' visible before pressing Adjust", !/Move \/ resize/.test(restingText));
  check("no 'Pin comp here' visible before pressing Adjust", !/Pin comp here/.test(restingText));
  check("no 'Change page' visible before pressing Adjust", !/Change page/.test(restingText));
  check("no overflow '⋯' (more actions) control anywhere", (await page.locator('[aria-label="More actions"]').count()) === 0);
  check("no 'Delete site plan' visible before pressing Adjust", !/Delete site plan/.test(restingText));

  // NEW-1 (this item) — the Layers panel BEFORE Adjust opens, so the "it collapsed because of
  // Adjust" claim below has a real before/after rather than assuming its resting state.
  const layersBefore = await page.locator('[data-testid="map-layers-panel"]').boundingBox().catch(() => null);
  const layersOpenBefore = layersBefore ? layersBefore.height > 60 : null; // collapsed chip is ~30px tall
  check("Layers panel is open by default on this desktop-width window (regression precondition)", layersOpenBefore === true, JSON.stringify(layersBefore));

  // ---- B1310209 (NEW-2): press Adjust, the panel docks bottom-right ----
  const adjustBtn = page.locator("button", { hasText: /^Adjust$/ }).first();
  await adjustBtn.waitFor({ state: "visible", timeout: 8000 });
  await adjustBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + `site-plan-02-adjust-panel-open-${label}.png` });

  const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
  check("Adjust panel exists after clicking Adjust", (await panel.count()) > 0);

  if ((await panel.count()) > 0) {
    const panelBox = await panel.boundingBox();
    check("panel docks near the bottom-right corner (right edge within 15px of viewport right)",
      panelBox && (VIEWPORT.width - (panelBox.x + panelBox.width)) <= 15, JSON.stringify(panelBox));
    check("panel sits clear of the scale bar (at least 30px above the viewport bottom)",
      panelBox && (VIEWPORT.height - (panelBox.y + panelBox.height)) >= 30, JSON.stringify(panelBox));
    check("panel does not run off the top of the map (y >= 0)", panelBox && panelBox.y >= 0, JSON.stringify(panelBox));

    const railBox = await page.locator('[data-testid="map-sites-panel"]').boundingBox().catch(() => null);
    check("panel does not overlap the comps rail (top-left)", !intersects(panelBox, railBox), JSON.stringify({ railBox, panelBox }));

    // ⛔ NEW-1 (this item) — THE ACTUAL REGRESSION: the Adjust panel must never overlap the
    // Imagery & layers panel. This is rect math, not a screenshot: two independently-measured
    // `getBoundingClientRect()` boxes, read the same way the bug report's own repro measured them
    // (`Adjust panel rect` / `Imagery and layers panel rect`, then their intersection). Proven to
    // catch the exact regression: reverting the yield effect below reproduces this bug report's
    // own numbers almost exactly (Layers stays at its open height/position and its rect overlaps
    // Adjust's over their full shared width) and turns both checks red at both viewports.
    const layersAfter = await page.locator('[data-testid="map-layers-panel"]').boundingBox().catch(() => null);
    check("Layers panel force-collapsed while Adjust is open (no longer the tall open card)",
      layersAfter ? layersAfter.height <= 60 : null, JSON.stringify(layersAfter));
    check("Adjust panel does not intersect the Layers panel's rect", !intersects(panelBox, layersAfter), JSON.stringify({ layersAfter, panelBox }));

    const chrome = await panel.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderRadius: s.borderRadius, position: s.position, zIndex: s.zIndex, boxShadow: s.boxShadow };
    });
    check("panel is position:absolute (docked, never fixed/dragged)", chrome.position === "absolute", JSON.stringify(chrome));

    const panelText = await panel.evaluate((el) => el.innerText);
    check("panel body has Opacity", /Opacity/.test(panelText));
    check("panel body has Rotation", /Rotation/.test(panelText));
    check("panel body has Move / resize", /Move \/ resize|Editing on map/.test(panelText));
    check("panel body has Crop", /Crop|Edit crop/.test(panelText));
    check("panel body has Pin comp here", /Pin comp here/.test(panelText));
    check("panel body has Change page", /Change page/.test(panelText));
    check("panel footer has Delete site plan and Done", /Delete site plan/.test(panelText) && /\bDone\b/.test(panelText));

    // B1310211 (NEW-4) — opacity's label reads visually heavier than rotation's.
    const weights = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('[data-testid="site-plan-adjust-panel"] span'));
      const opacityLabel = spans.find((s) => s.textContent.trim() === "Opacity");
      const rotationLabel = spans.find((s) => s.textContent.trim() === "Rotation");
      const w = (el) => (el ? getComputedStyle(el).fontWeight : null);
      return { opacityWeight: w(opacityLabel), rotationWeight: w(rotationLabel) };
    });
    check("opacity label is bold — the prominent block", weights.opacityWeight === "600", JSON.stringify(weights));
    check("rotation label is a visibly different (quieter) weight than opacity's", weights.rotationWeight !== weights.opacityWeight, JSON.stringify(weights));

    // B1310210 (NEW-3) — Delete is an inline confirm, never a native dialog.
    page.on("dialog", async (d) => { console.log("  [DIALOG — should never appear]", d.message()); fail++; await d.accept().catch(() => {}); });
    await panel.locator("button", { hasText: "Delete site plan…" }).click();
    await page.waitForTimeout(300);
    const confirmText = await panel.evaluate((el) => el.innerText);
    check("delete shows an inline confirm (no native dialog)", /Delete/.test(confirmText) && /Cancel/.test(confirmText));
    await panel.locator("button", { hasText: "Cancel" }).click();
    await page.waitForTimeout(200);

    // The Done click is the teeth of the cornerClearance fix: before `data-canvas-corner` was
    // added, the global help/report FAB sat exactly here and intercepted the click.
    await panel.locator("button", { hasText: "Done" }).click({ timeout: 5000 });
    await page.waitForTimeout(300);
    check("Done is clickable and closes the panel (not covered by the help/report FAB)", (await page.locator('[data-testid="site-plan-adjust-panel"]').count()) === 0);

    // NEW-1 (this item) — the yield is TEMPORARY: closing Adjust must restore whatever the user
    // had (open, since it started open at this width), not leave Layers stuck collapsed.
    await page.waitForTimeout(300);
    const layersRestored = await page.locator('[data-testid="map-layers-panel"]').boundingBox().catch(() => null);
    check("Layers panel re-expands once Adjust closes (the collapse was temporary, not sticky)",
      layersRestored ? layersRestored.height > 60 : null, JSON.stringify(layersRestored));
  }

  await page.screenshot({ path: OUT + `site-plan-03-after-done-${label}.png` });
  await ctx.close();
}

for (const vp of VIEWPORTS) await runAtViewport(vp);

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
