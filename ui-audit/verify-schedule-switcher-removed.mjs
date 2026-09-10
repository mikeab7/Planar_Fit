/**
 * NEW-1 (2026-09-10) — live/headless proof that the old Schedule-toolbar "Schedules" switcher
 * (ScheduleSwitcher in ScheduleToolbar.jsx, shipped by B1396192) is GONE, and that the Row-1
 * breadcrumb's schedule crumb (ScheduleCrumb, B1435888) still does its job: grouping the routed
 * project's own schedules with the Organization's, offering "New schedule in <Project>", and
 * actually swapping the grid when a different schedule is picked.
 *
 * Owner ask, verbatim: "in the Schedule tab's toolbar there is a stacked-layers icon button with a
 * caret, sitting between 'Spreadsheet' and the Grid / Split / Gantt segmented control... That is
 * the control to delete, along with the grouped panel it opens." The breadcrumb's second level
 * (PR #1608/#1616) now does that job in the place the user already looks — two controls for one
 * job was the defect. The accepted trade-off: the old icon could jump straight to another
 * project's schedule in one step; the breadcrumb takes two (project, then schedule) — not solved
 * here, per the item's own instruction.
 *
 * This harness never touches Supabase: the /sequence/ iframe is replaced with a same-origin stub
 * (same pattern the now-deleted ui-audit/verify-schedule-list-reachable.mjs used) that speaks the
 * real postMessage contract, so the real Scheduler.jsx/ScheduleToolbar.jsx/ScheduleCrumb.jsx code
 * is exercised end to end with no auth and no network.
 *
 * MUTATION PROOF (not automated in this file — see the session record / PR body): CHECK 1 run
 * against the commit BEFORE this removal (`git stash` this fix, rebuild, run, `git stash pop`,
 * rebuild again) reports the "Schedules" button PRESENT — i.e. this harness goes RED against the
 * pre-removal build, not just green-by-construction.
 *
 * Run:  npm run build && npx vite preview --port 4174   (then)
 *       BASE_URL=http://localhost:4174/ node ui-audit/verify-schedule-switcher-removed.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4174/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

// Same fixture shape the deleted harness used — the owner's real Goose Creek: one real schedule,
// three empty duplicates, and a genuinely separate second schedule ("TAS Land Sale") under the
// SAME site. Grand Port stands in for "some OTHER project's schedule".
const GOOSE_CREEK_GID = "gcSiteId1";
const GRAND_PORT_GID = "gpSiteId2";
const PROJECTS = [
  { id: "1", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "19", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "22", name: "TAS Land Sale", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "5", name: "Pursuits", linkedSiteId: null, linkedSiteName: null, ownerKind: "org" },
  { id: "7", name: "Operations", linkedSiteId: null, linkedSiteName: null, ownerKind: "org" },
  { id: "3", name: "Grand Port", linkedSiteId: GRAND_PORT_GID, linkedSiteName: "Grand Port", ownerKind: "site" },
];

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({
    [GOOSE_CREEK_GID]: site(GOOSE_CREEK_GID, "Goose Creek"),
    [GRAND_PORT_GID]: site(GRAND_PORT_GID, "Grand Port"),
  })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const stubHtml = (initialActiveId) => `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  let aPid = ${JSON.stringify(initialActiveId)}, section = "projects", view = "grid";
  const projects = ${JSON.stringify(PROJECTS)};
  const emitNav = () => {
    const list = projects.map(p => ({ id: p.id, name: p.name, linkedSiteId: p.linkedSiteId, linkedSiteName: p.linkedSiteName, ownerKind: p.ownerKind }));
    parent.postMessage({ source: "planar-seq", type: "planar:nav-state", section, activeId: aPid, projects: list }, window.location.origin);
  };
  const emitToolbar = () => {
    parent.postMessage({ source: "planar-seq", type: "planar:toolbar-state", section, view,
      isMobile: false, zoomPct: 100, zoomable: view !== "grid", reviewCount: 0, reviewOpen: false,
      saveStatus: "saved", savePulse: false, fileLinked: false, offlineFallback: false,
      authRequired: false, activePanel: null }, window.location.origin);
  };
  const emit = () => { emitNav(); emitToolbar(); };
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "planar-shell") return;
    window.__cmds.push(m.type + (m.id != null ? (":" + m.id) : "") + (m.siteId != null ? (":site:" + m.siteId) : ""));
    document.getElementById("s").textContent = window.__cmds.join(" | ");
    if (m.type === "planar:nav-request") { emit(); return; }
    if (m.type === "planar:nav-select" && m.id != null) {
      if (projects.some(p => p.id === m.id)) { aPid = m.id; section = "projects"; emit(); }
    } else if (m.type === "planar:nav-select-by-site" && m.siteId != null) {
      const match = projects.find(p => p.linkedSiteId === m.siteId);
      if (match && !(aPid === match.id && section === "projects")) { aPid = match.id; section = "projects"; emit(); }
    }
  });
  emit();
</script></body></html>`;

async function newCtx(browser, { initialActiveId = "1", viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml(initialActiveId) }));
  return ctx;
}

async function check1_switcherGoneNoGap(browser) {
  console.log("\nCHECK 1 — the old 'Schedules' toolbar switcher is GONE, and the center group reads Grid/Split/Gantt with nothing before it and no leftover gap");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-switcher-removed");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const switcherCount = await page.locator('[data-testid="schedule-switcher-btn"]').count();
  ok(switcherCount === 0, `the header 'Schedules' switcher button no longer exists in the DOM (found ${switcherCount})`);

  const titleMatch = await page.locator('button[title*="Schedules"][title*="Organization"]').count();
  ok(titleMatch === 0, "no button anywhere carries the old 'Schedules — this project's, the Organization's, or another project's' title");

  const viewGroup = page.locator('[role="group"][aria-label="View"]');
  await viewGroup.waitFor({ state: "visible", timeout: 6000 });
  const labels = await viewGroup.locator("button").allInnerTexts();
  ok(labels.join(",") === "Grid,Split,Gantt", `the segmented control reads exactly Grid/Split/Gantt, in order (got ${JSON.stringify(labels)})`);

  // The center zone's own first child must now be the View group itself — nothing (no leftover
  // divider/spacer from the removed button) sits before it.
  const firstChildTag = await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="View"]');
    const center = group?.parentElement;
    const first = center?.firstElementChild;
    return first ? { tag: first.tagName, isViewGroup: first === group, outerHTMLStart: first.outerHTML.slice(0, 60) } : null;
  });
  ok(!!firstChildTag && firstChildTag.isViewGroup, `the View toggle is the FIRST element in the center zone — nothing (icon, divider, or gap) precedes it (got ${JSON.stringify(firstChildTag)})`);

  await page.screenshot({ path: new URL("./screens/schedule-switcher-removed.png", import.meta.url).pathname });
  await ctx.close();
}

async function check2_crumbStillGroupsAndOffersCreate(browser) {
  console.log("\nCHECK 2 — the breadcrumb's schedule menu still opens, groups this project's schedules + the Organization, and offers 'New schedule in <Project>'");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-switcher-removed");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const crumb = page.locator('[data-testid="schedule-crumb"]');
  ok(await crumb.count() > 0, "the schedule crumb is present in the Row-1 breadcrumb");
  await crumb.click({ timeout: 6000 });
  await page.waitForTimeout(250);

  const listVisible = await page.locator('[data-testid="schedule-owner-list"]').count().then((n) => n > 0).catch(() => false);
  ok(listVisible, "clicking the crumb opens the grouped schedule list");

  const listText = await page.locator('[data-testid="schedule-owner-list"]').innerText().catch(() => "");
  const listLower = listText.toLowerCase();
  ok(listText.includes("Goose Creek"), "the routed project's own group heading ('Goose Creek') is present");
  ok(listText.includes("TAS Land Sale"), "Goose Creek's other schedule ('TAS Land Sale') is listed");
  ok(listLower.includes("organization") && listText.includes("Pursuits") && listText.includes("Operations"), "the Organization group (Pursuits, Operations) is present");
  ok(!listText.includes("Grand Port"), "another project's schedule is NOT listed here — the crumb is scoped to this project + the Organization (showOther=false), unlike the removed toolbar panel");
  ok(listLower.includes("new schedule in goose creek"), `the create row reads 'New schedule in Goose Creek' (got: ${JSON.stringify(listText.slice(0, 300))})`);

  await ctx.close();
}

async function check3_switchingSwapsTheGrid(browser) {
  console.log("\nCHECK 3 — picking a different schedule from the crumb's menu still swaps the grid");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-switcher-removed");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  ok((await page.locator('[data-testid="schedule-crumb"]').innerText()).includes("Goose Creek"), "starting on Goose Creek's own schedule");

  await page.locator('[data-testid="schedule-crumb"]').click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const tasRow = page.locator('[data-testid="schedule-owner-row"][data-schedule-id="22"]');
  await tasRow.click({ timeout: 6000 });
  await page.waitForTimeout(400);

  const crumbText = await page.locator('[data-testid="schedule-crumb"]').innerText();
  ok(crumbText.includes("TAS Land Sale"), `the crumb now names the newly-picked schedule (got ${JSON.stringify(crumbText)})`);
  const hash = await page.evaluate(() => window.location.hash);
  ok(hash.includes(GOOSE_CREEK_GID), "the route stays on Goose Creek (Site/Review/Library/Notes undisturbed)");

  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await check1_switcherGoneNoGap(browser);
await check2_crumbStillGroupsAndOffersCreate(browser);
await check3_switchingSwapsTheGrid(browser);
await browser.close();

console.log("\n" + (fails === 0
  ? "✅ PASS — the old 'Schedules' toolbar switcher is gone with no leftover gap, and the breadcrumb's schedule crumb covers reachability, grouping, create, and switching"
  : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
