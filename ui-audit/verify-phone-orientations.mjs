/* verify-phone-orientations.mjs — B1447440/NEW-1, 2026-09-09.
 *
 * THE CAPABILITY THIS PROVES: real phone testing — WebKit, materially closer to Safari's real
 * layout/pointer-event engine than a Chromium viewport pretending to be a phone (see
 * VERIFICATION.md's "WEBKIT INSTALLS ON DEMAND HERE" note for the full engine-level detail and its
 * limits) — is possible from a Claude Code session with network access to planyr.io. See
 * docs/PHONE-TESTING.md for the full write-up: how to run this, what it can and cannot prove, and
 * why a DIFFERENT session (with a more restricted sandbox) could not reach planyr.io or download
 * WebKit at all — this harness needs an environment that can, e.g. a Claude Code web session with
 * normal network access, not every sandboxed dev container.
 *
 * ENGINE: WebKit (via Playwright's bundled browser, `npx playwright install webkit` +
 * `npx playwright install-deps webkit`) — not Apple's own build, not Mobile Safari's browser
 * chrome, but the real WebKit rendering + pointer-event engine, not a Chromium viewport pretending
 * to be a phone. Falls back to Chromium mobile emulation, CLEARLY LABELLED, only if WebKit
 * genuinely cannot be installed/launched here — see `resolveEngine()` below.
 *
 * DEVICES: Playwright's built-in device descriptors (never a bare viewport — a descriptor
 * carries deviceScaleFactor, isMobile, hasTouch and the mobile UA, which is what makes
 * `(pointer: coarse)` and `navigator.maxTouchPoints` resolve the way the app's own
 * `isPhoneSheetMode` gate reads them). iPhone SE (smallest current-shape screen Playwright
 * ships), iPhone 15 (the common case), iPhone 15 Pro Max (largest) — each in portrait AND its
 * "landscape" sibling descriptor.
 *
 * AUTH: this session has no real E2E_EMAIL/E2E_PASSWORD (those are GitHub Actions secrets, not
 * available here — see OWNER-TODO.md's "one 2-minute paste" item and .github/workflows/e2e.yml).
 * Project-scoped surfaces (Site/Schedule/Review/Library/Notes/Spreadsheet) are reached instead
 * via this repo's existing fixture-seeding mechanism (ui-audit/lib/fixtureSeeding.mjs) — the
 * owner's real Bain plan, loaded into localStorage/IndexedDB as a LOCAL (signed-out) plan before
 * the measured page ever navigates. This is the same mechanism `verify-v91632-real-plan.mjs`
 * uses, pointed at the real https://planyr.io/ origin instead of a local build. It exercises the
 * REAL deployed bundle and the SAME workspace-chrome layout code a signed-in user sees, but it is
 * NOT a signed-in session — the account pill, cloud-sync badges and any auth-gated affordance are
 * NOT covered. Said loudly here and in every report this harness prints, per this task's Step 2.
 *
 * WHAT COUNTS AS BREAKING (Step 3 of the dispatching brief): horizontal scroll / clipped or
 * unreachable content; an interactive control under 44×44 CSS px; controls overlapping each
 * other or spilling outside the viewport; the Properties bottom sheet covering the very object
 * it is inspecting; anything unreachable specifically in landscape. This harness is READ-ONLY —
 * it finds and screenshots, it does not fix anything (see the dispatching backlog item).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFixtureState, readFixture } from "./lib/fixtureSeeding.mjs";

const { webkit, chromium, devices } = pw;

const BASE = (process.env.PLANYR_URL || "https://planyr.io/").replace(/\/*$/, "/");
const OUT_DIR = fileURLToPath(new URL("./.artifacts/phone-orientations", import.meta.url));
const CACHE_DIR = fileURLToPath(new URL("./.cache/raster", import.meta.url));
const SITE_ID = "phone-orient-bain";
mkdirSync(OUT_DIR, { recursive: true });

const DEVICE_SPECS = [
  { name: "iPhone SE", orientation: "portrait" },
  { name: "iPhone SE landscape", orientation: "landscape" },
  { name: "iPhone 15", orientation: "portrait" },
  { name: "iPhone 15 landscape", orientation: "landscape" },
  { name: "iPhone 15 Pro Max", orientation: "portrait" },
  { name: "iPhone 15 Pro Max landscape", orientation: "landscape" },
];

const SURFACES = [
  { id: "map-landing", label: "Map landing (no project, signed out)", needsProject: false, path: () => "#/site" },
  { id: "site", label: "Site", needsProject: true, path: (id) => `#/project/${id}/site` },
  { id: "schedule", label: "Schedule", needsProject: true, path: (id) => `#/project/${id}/schedule` },
  { id: "review", label: "Review", needsProject: true, path: (id) => `#/project/${id}/markup` },
  { id: "library", label: "Library", needsProject: true, path: (id) => `#/project/${id}/library` },
  { id: "notes", label: "Notes", needsProject: true, path: (id) => `#/project/${id}/notes` },
  { id: "spreadsheet", label: "Spreadsheet", needsProject: true, path: (id) => `#/project/${id}/spreadsheet` },
  { id: "site-properties-sheet", label: "Site properties sheet (open)", needsProject: true, special: "properties-sheet", path: (id) => `#/project/${id}/site` },
];

/* STEP 1 of the brief — establish what is actually possible here, and say so plainly. Tries a
 * real WebKit launch (materially closer to Safari than a Chromium viewport, per
 * VERIFICATION.md's own "WEBKIT INSTALLS ON DEMAND HERE" note); reports the exact failure and
 * falls back to Chromium mobile emulation, clearly labelled, if WebKit cannot run. */
async function resolveEngine() {
  try {
    const browser = await webkit.launch({});
    await browser.close();
    return { engineName: "webkit", launch: (opts) => webkit.launch(opts), label: "WebKit (real rendering/pointer engine, not Chromium emulation)", fallback: false, error: null };
  } catch (e) {
    return { engineName: "chromium", launch: (opts) => chromium.launch(opts), label: "Chromium mobile emulation (FALLBACK — not WebKit, not Safari)", fallback: true, error: String(e && e.message || e).slice(0, 500) };
  }
}

async function fetchChunkInfo(page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    const main = scripts.find((s) => /\/assets\/index-.*\.js$/.test(s || "")) || scripts[0] || null;
    return { mainChunk: main, allScripts: scripts };
  }).catch(() => ({ mainChunk: null, allScripts: [] }));
}

/* One generic layout audit against whatever is currently rendered. Scoped to real UI chrome
 * (buttons/links/form controls) — canvas drawing handles (grips) are a different, deliberately
 * small category per this repo's CHROME-NEVER-EATS-A-PRESS rule and are reported SEPARATELY,
 * never folded into the "too-small control" count, so the two are never conflated. */
async function auditPage(page) {
  const issues = [];
  const push = (kind, detail) => issues.push({ kind, detail });

  const visible = await page.evaluate(() => document.visibilityState === "visible").catch(() => false);
  if (!visible) push("harness-fault", "document.visibilityState was not 'visible' at measurement time — this run is void (FOREGROUND-OR-VOID)");

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })).catch(() => null);
  if (metrics && metrics.scrollWidth > metrics.clientWidth + 1) {
    push("horizontal-scroll", `page scrolls horizontally: content ${metrics.scrollWidth}px vs viewport ${metrics.clientWidth}px`);
  }

  const vw = page.viewportSize() || { width: 0, height: 0 };
  const controls = await page.evaluate(() => {
    const sel = 'button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select, input:not([type="hidden"]), textarea, [role="tab"]';
    // A control below the fold of its own SCROLLABLE ancestor is reachable by scrolling — that
    // is not "outside the viewport" in the breaking sense DRIVER-SCROLL-IS-NOT-APP-SCROLL warns
    // about; only a control pinned OUTSIDE every scroll container (fixed/absolute chrome that
    // truly cannot be reached) counts as unreachable.
    const inScrollable = (n) => {
      let p = n.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && p.scrollHeight > p.clientHeight + 1) return true;
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
        p = p.parentElement;
      }
      return false;
    };
    return [...document.querySelectorAll(sel)]
      .filter((n) => !n.closest("[data-handle-layer]") && !n.closest("[data-chrome]"))
      .map((n) => {
        const r = n.getBoundingClientRect();
        const s = getComputedStyle(n);
        const ok = r.width > 0.5 && r.height > 0.5 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity || "1") > 0.05;
        return {
          tag: n.tagName.toLowerCase(),
          text: (n.getAttribute("data-testid") || n.getAttribute("aria-label") || n.getAttribute("title") || n.textContent || "").trim().replace(/\s+/g, " ").slice(0, 44),
          x: r.x, y: r.y, w: r.width, h: r.height, ok, scrollable: inScrollable(n),
        };
      })
      .filter((c) => c.ok);
  }).catch(() => []);

  let smallInChrome = 0, smallInPanel = 0;
  for (const c of controls) {
    if (c.w < 44 || c.h < 44) {
      if (c.scrollable) smallInPanel++; else smallInChrome++;
      push("small-touch-target", `<${c.tag}> "${c.text}" is ${Math.round(c.w)}×${Math.round(c.h)}px${c.scrollable ? " (inside a scrollable panel)" : " (always-on-screen chrome)"}`);
    }
    // Only a control OUTSIDE any scrollable ancestor can be genuinely unreachable — one inside a
    // scroll container is just below the current scroll position (reachable, not a defect). And
    // only PARTIAL overflow counts as "clipped" — an element with ZERO overlap with the viewport
    // is indistinguishable from a deliberately off-canvas closed drawer/menu (this app hides
    // several panels that way by design, e.g. the collapsed left rail on phone widths) and is
    // reported separately, non-fatally, as `offscreen-hidden-control` instead.
    if (!c.scrollable) {
      const visibleW = Math.max(0, Math.min(c.x + c.w, vw.width) - Math.max(c.x, 0));
      const visibleH = Math.max(0, Math.min(c.y + c.h, vw.height) - Math.max(c.y, 0));
      const hasOverflow = c.x < -0.5 || c.y < -0.5 || c.x + c.w > vw.width + 0.5 || c.y + c.h > vw.height + 0.5;
      if (hasOverflow && visibleW > 0.5 && visibleH > 0.5) {
        push("control-outside-viewport", `<${c.tag}> "${c.text}" at (${Math.round(c.x)},${Math.round(c.y)}) size ${Math.round(c.w)}×${Math.round(c.h)} vs viewport ${vw.width}×${vw.height} — PARTLY clipped`);
      } else if (hasOverflow && (visibleW < 0.5 || visibleH < 0.5)) {
        push("offscreen-hidden-control", `<${c.tag}> "${c.text}" at (${Math.round(c.x)},${Math.round(c.y)}) is entirely off-canvas — likely a collapsed drawer/menu, not scored as breaking`);
      }
    }
  }
  const capped = controls.slice(0, 200);
  for (let i = 0; i < capped.length; i++) {
    for (let j = i + 1; j < capped.length; j++) {
      const a = capped[i], b = capped[j];
      if (a.scrollable || b.scrollable) continue; // two rows in a scrolling list "overlapping" off-screen is not a defect
      const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const minArea = Math.min(a.w * a.h, b.w * b.h);
      if (minArea > 4 && (ox * oy) / minArea > 0.3) {
        push("overlapping-controls", `<${a.tag}> "${a.text}" overlaps <${b.tag}> "${b.text}" (${Math.round((100 * ox * oy) / minArea)}% of the smaller one's area)`);
      }
    }
  }
  return { issues, controlCount: controls.length, smallInChrome, smallInPanel };
}

/* The special site-properties-sheet run: select a real element on the owner's real Bain plan,
 * open its Properties (the "✎ Properties" pill on narrow+coarse; the docked "Properties" rail
 * tab is the only path once a device/orientation falls OUTSIDE the 760px narrow breakpoint —
 * that fallback happening at all is itself one of this run's findings). */
async function driveOpenPropertiesSheet(page, issues) {
  const push = (kind, detail) => issues.push({ kind, detail });
  const canvas = page.locator('[data-testid="planner-canvas"]');
  try { await canvas.waitFor({ state: "visible", timeout: 15000 }); }
  catch (e) { push("harness-fault", `planner canvas never appeared: ${String(e).slice(0, 200)}`); return { opened: false, mode: null }; }

  const fit = page.locator('button[title="Zoom to fit"]');
  for (let i = (await fit.count()) - 1; i >= 0; i--) { await fit.nth(i).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }

  const target = await page.evaluate(() => {
    const n = document.querySelector('[data-feature^="el:"]');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { id: n.getAttribute("data-feature"), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!target) { push("harness-fault", "no [data-feature^=\"el:\"] found on the fixture plan after Zoom to fit — cannot drive the properties sheet"); return { opened: false, mode: null }; }

  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);

  const beforeRect = await page.evaluate((id) => {
    const n = document.querySelector(`[data-feature="${id}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, target.id);

  const pill = page.getByText("✎ Properties", { exact: true });
  const pillCount = await pill.count().catch(() => 0);
  let mode = null;
  if (pillCount > 0) {
    await pill.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    mode = "bottom-sheet";
  } else {
    // Not in phone-sheet mode (this device/orientation combo is not "narrow" — e.g. a wide
    // landscape phone crossing the 760px breakpoint) — the docked left-rail "Properties" tab
    // is the desktop fallback path. Finding this at all IS one of this run's answers.
    const propsTab = page.getByRole("button", { name: "Properties", exact: true });
    if (await propsTab.count().catch(() => 0)) {
      await propsTab.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      mode = "docked-panel-desktop-fallback";
      push("landscape-desktop-fallback", "this device/orientation is wider than the 760px phone breakpoint, so selecting an element never offers the '✎ Properties' bottom-sheet affordance at all — only the docked desktop Properties rail tab reaches it");
    } else {
      push("harness-fault", "neither the '✎ Properties' pill nor a docked Properties rail tab was reachable after selecting an element");
      return { opened: false, mode: null };
    }
  }

  const sheetRect = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="left-menu-panel"]');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, isBottomSheet: n.getAttribute("data-bottom-sheet") === "properties" };
  });
  if (!sheetRect) { push("harness-fault", "Properties panel never rendered ([data-testid=\"left-menu-panel\"] absent) after opening it"); return { opened: false, mode }; }

  if (beforeRect) {
    const overlap = !(sheetRect.x > beforeRect.x + beforeRect.w || sheetRect.x + sheetRect.w < beforeRect.x
      || sheetRect.y > beforeRect.y + beforeRect.h || sheetRect.y + sheetRect.h < beforeRect.y);
    // The app is supposed to shift the map so the selection clears the sheet (selectionCoverDeltaPx)
    // — check where the SELECTED OBJECT actually sits now, not just its pre-open position.
    const afterRect = await page.evaluate((id) => {
      const n = document.querySelector(`[data-feature="${id}"]`);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, target.id);
    if (afterRect) {
      const stillCovered = !(sheetRect.x > afterRect.x + afterRect.w || sheetRect.x + sheetRect.w < afterRect.x
        || sheetRect.y > afterRect.y + afterRect.h || sheetRect.y + sheetRect.h < afterRect.y);
      if (stillCovered && mode === "bottom-sheet") {
        push("sheet-covers-selection", `the properties sheet (top ${Math.round(sheetRect.y)}px) still overlaps the selected element's on-screen position (top ${Math.round(afterRect.y)}px, bottom ${Math.round(afterRect.y + afterRect.h)}px) after opening`);
      }
    } else if (overlap && mode === "bottom-sheet") {
      push("sheet-covers-selection", "the selected element left the DOM/cull set once the sheet opened — could not confirm the map shifted to keep it visible");
    }
  }

  return { opened: true, mode, sheetRect, targetId: target.id };
}

async function run() {
  const engine = await resolveEngine();
  console.log(`\n=== STEP 1 — engine ===`);
  console.log(`  requested: WebKit`);
  console.log(`  using:     ${engine.label}`);
  if (engine.fallback) console.log(`  WebKit failure (verbatim, truncated): ${engine.error}`);
  console.log(`  base URL:  ${BASE}`);

  const seedBrowser = await engine.launch({});
  let fixtureState = null, fixtureFacts = null;
  try {
    const fixture = readFixture("bain");
    const built = await buildFixtureState(seedBrowser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE_DIR, viewport: { width: 1600, height: 900 } });
    fixtureState = built.state;
    fixtureFacts = built.census;
    console.log(`\n=== fixture ===`);
    console.log(`  seeded the owner's real Bain plan as a LOCAL (signed-out) project at siteId=${SITE_ID}`);
    console.log(`  census: ${JSON.stringify(fixtureFacts)}`);
  } catch (e) {
    console.log(`\n⛔ FIXTURE SEEDING FAILED: ${String(e && e.message || e).slice(0, 400)}`);
    console.log(`   Project-scoped surfaces (Site/Schedule/Review/Library/Notes/Spreadsheet) will be SKIPPED.`);
  }
  await seedBrowser.close();

  const results = [];
  const browser = await engine.launch({});
  try {
    for (const spec of DEVICE_SPECS) {
      const device = devices[spec.name];
      if (!device) { console.log(`⛔ unknown device descriptor "${spec.name}" — skipped`); continue; }
      for (const surface of SURFACES) {
        const label = `${spec.name} (${spec.orientation}) · ${surface.label}`;
        if (surface.needsProject && !fixtureState) {
          results.push({ device: spec.name, orientation: spec.orientation, surface: surface.id, skipped: "no fixture state", issues: [] });
          console.log(`SKIP  ${label} — no fixture state`);
          continue;
        }
        let ctx, page;
        try {
          ctx = await browser.newContext({
            ...device,
            storageState: surface.needsProject ? fixtureState : undefined,
            ignoreHTTPSErrors: true,
          });
          page = await ctx.newPage();
          page.on("pageerror", () => {});
          const path = surface.path(SITE_ID);
          await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(surface.id === "schedule" ? 4500 : 3000);

          let extra = {};
          const issues = [];
          if (surface.special === "properties-sheet") {
            extra = await driveOpenPropertiesSheet(page, issues);
          } else if (surface.id === "site") {
            const canvas = page.locator('[data-testid="planner-canvas"]');
            await canvas.waitFor({ state: "visible", timeout: 15000 }).catch(() =>
              issues.push({ kind: "harness-fault", detail: "planner canvas never appeared" }));
            const fit = page.locator('button[title="Zoom to fit"]');
            for (let i = (await fit.count()) - 1; i >= 0; i--) { await fit.nth(i).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); }
          } else if (surface.id === "map-landing") {
            // No project: this is MapFinder's Leaflet map, not the Site Planner drawing canvas.
            await page.locator(".leaflet-container").waitFor({ state: "visible", timeout: 15000 }).catch(() =>
              issues.push({ kind: "harness-fault", detail: "map (.leaflet-container) never appeared on the map-landing surface" }));
          }

          const audit = await auditPage(page);
          issues.push(...audit.issues);
          const chunkInfo = await fetchChunkInfo(page);

          const shotName = `${spec.name.replace(/\s+/g, "_")}-${spec.orientation}-${surface.id}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
          const shotPath = `${OUT_DIR}/${shotName}`;
          await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});

          const vw = page.viewportSize();
          // offscreen-hidden-control is informational (a deliberately collapsed drawer/menu) —
          // never counted toward the breaking verdict, only kept in the record for completeness.
          const breaking = issues.filter((it) => it.kind !== "offscreen-hidden-control");
          results.push({
            device: spec.name, orientation: spec.orientation, surface: surface.id, surfaceLabel: surface.label,
            viewport: vw, engine: engine.engineName, chunk: chunkInfo.mainChunk,
            controlCount: audit.controlCount, smallInChrome: audit.smallInChrome, smallInPanel: audit.smallInPanel,
            issues, breakingCount: breaking.length, screenshot: shotPath, extra,
          });
          const tag = breaking.length ? `${breaking.length} issue(s)` : "clean";
          console.log(`${breaking.length ? "FAIL" : "PASS"}  ${label} — ${tag} — chunk ${chunkInfo.mainChunk || "?"}`);
          for (const it of issues) console.log(`        [${it.kind}] ${it.detail}`);
        } catch (e) {
          results.push({ device: spec.name, orientation: spec.orientation, surface: surface.id, error: String(e && e.message || e).slice(0, 400) });
          console.log(`ERROR ${label} — ${String(e && e.message || e).slice(0, 200)}`);
        } finally {
          if (ctx) await ctx.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ engine: engine.label, base: BASE, generatedAt: new Date().toISOString(), fixtureFacts, results }, null, 2));

  console.log(`\n=== SUMMARY ===`);
  const worst = results.filter((r) => (r.breakingCount > 0) || r.error).length;
  const clean = results.filter((r) => r.breakingCount === 0).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`  ${results.length} runs: ${clean} clean, ${worst} with findings, ${skipped} skipped`);
  console.log(`  results + screenshots: ${OUT_DIR}`);
  process.exit(0);
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
