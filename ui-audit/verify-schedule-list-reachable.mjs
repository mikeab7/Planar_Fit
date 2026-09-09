/**
 * B1396192 — live/headless proof that the "which schedules exist" list is reachable from a
 * Schedule tab that ALREADY has a schedule loaded, not just from the "no schedule yet" empty
 * state. Follow-on to PR #1578 (B1380336/B1380337): that PR built the grouped
 * here/Organization/elsewhere list (ScheduleOwnerList) and the ownership data
 * (scheduleOwnership.js) correctly, but mounted the list ONLY inside Scheduler.jsx's empty
 * state — so the moment a routed project had a schedule of its own, every one of its OTHER
 * schedules (and the Organization's) became unreachable from that project's Schedule tab. Owner
 * repro (2026-09-09, read-only against planyr_production): Goose Creek carries five schedules —
 * the real one, three empty duplicates, and "TAS Land Sale" (22 tasks) — and four of the five
 * were unreachable from Goose Creek's own Schedule tab, which is the original complaint
 * (B1380336) restated one level up.
 *
 * This harness never touches Supabase: the /sequence/ iframe is replaced with a same-origin stub
 * (same pattern as ui-audit/verify-schedule-switcher-pick.mjs) that speaks the real postMessage
 * contract — planar:nav-state AND planar:toolbar-state (the switcher lives in ScheduleCenter, the
 * toolbar's CENTER zone — see that component's own header for why it can't live in the right
 * zone instead — which only renders once toolbar.ready, so the stub has to report both to
 * exercise the real Scheduler.jsx/ScheduleToolbar.jsx code, not an approximation of it).
 *
 * MUTATION PROOF (not automated in this file — see the session record / PR body): CHECK 1 below,
 * run against the commit BEFORE this fix (`git stash` this fix, rebuild, run, `git stash pop`,
 * rebuild again) reports the "Schedules" button ABSENT while a schedule is loaded — i.e. this
 * harness goes RED on the reported defect, not just green-by-construction.
 *
 * ⛔ B1397568 (NEW-1, 2026-09-09) — CHECKS 6-10 are the follow-on: the owner used exactly the
 * panel CHECK 1 proves is reachable (he switched schedules successfully with it), then searched
 * the page for "new schedule" / "create schedule" / "add schedule" / "+ new" / "link an existing"
 * and matched NONE of them. The create dialog itself already worked from a loaded project — CHECK
 * 5 below proves that, unchanged — but only via the breadcrumb's generic "＋ New project" row, a
 * DIFFERENT menu with a label that gives no hint it creates a schedule. CHECKS 6-10 prove the fix:
 * a clearly-labelled "New schedule" row now lives INSIDE the Schedules panel itself
 * (ScheduleOwnerList, via the new optional `onCreate` prop), reusing the exact same
 * NewScheduleModal/validateNewSchedule path — same blank-name-on-collision rule, same
 * required-name-and-owner gate — so nothing about WHAT gets created changed, only where the
 * control to reach it lives. Run each of CHECKS 6-10 against the pre-fix commit the same way (a
 * `git stash`) and `[data-testid="schedule-owner-create"]` resolves to zero elements — the row did
 * not exist there before this fix.
 *
 * Run:  npm run build && npx vite preview --port 4174   (then)
 *       BASE_URL=http://localhost:4174/ node ui-audit/verify-schedule-list-reachable.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4174/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

// Fixture mirrors the owner's real Goose Creek shape (read-only, 2026-09-09): one real schedule,
// three empty duplicates, and a genuinely separate second schedule ("TAS Land Sale") under the
// SAME site — the exact case B1380547/multi-schedule-per-project plumbing exists for, and the
// exact case that was unreachable. Grand Port stands in for "some OTHER project's schedule".
const GOOSE_CREEK_GID = "gcSiteId1";
const GRAND_PORT_GID = "gpSiteId2";
const WOODS_ROAD_GID = "wrSiteId3"; // no linked schedule at all — the regression control
const PROJECTS = [
  { id: "1", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "19", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "20", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
  { id: "21", name: "Goose Creek", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek", ownerKind: "site" },
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
    [WOODS_ROAD_GID]: site(WOODS_ROAD_GID, "Woods Road"),
  })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

// A stand-in for the embedded Gantt (public/sequence/index.html). Unlike the sibling
// verify-schedule-switcher-pick.mjs stub, this one ALSO emits planar:toolbar-state — the new
// "Schedules" switcher lives in ScheduleCenter (the header's center zone), which renders nothing
// until toolbar.ready, so a stub that only sends nav-state can never exercise it.
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
    window.__cmds.push(m.type + (m.id != null ? (":" + m.id) : "") + (m.siteId != null ? (":site:" + m.siteId) : "") + (m.view ? (":" + m.view) : ""));
    document.getElementById("s").textContent = window.__cmds.join(" | ");
    if (m.type === "planar:nav-request") { emit(); return; }
    if (m.type === "planar:nav-select" && m.id != null) {
      if (projects.some(p => p.id === m.id)) { aPid = m.id; section = "projects"; emit(); }
    } else if (m.type === "planar:nav-select-by-site" && m.siteId != null) {
      const match = projects.find(p => p.linkedSiteId === m.siteId);
      if (match && !(aPid === match.id && section === "projects")) { aPid = match.id; section = "projects"; emit(); }
    } else if (m.type === "planar:nav-dashboard") {
      section = "reports"; emit();
    } else if (m.type === "planar:view-set" && m.view) {
      view = m.view; emitToolbar();
    }
  });
  emit();
</script></body></html>`;

async function newCtx(browser, { initialActiveId = "1", viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort()); // no cloud in the sandbox — fail fast, don't hang
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml(initialActiveId) }));
  return ctx;
}

const switcherBtn = (page) => page.locator('[data-testid="schedule-switcher-btn"]').first();
const ownerList = (page) => page.locator('[data-testid="schedule-owner-list"]').first();
// The stub's `window.__cmds` lives in the /sequence/ IFRAME's own window, not the top-level
// page's — read it via the iframe element's contentWindow (same-origin, so this is a plain
// property read, no postMessage round trip needed).
const readCmds = (page) => page.evaluate(() => {
  const ifr = document.querySelector("iframe");
  return ifr && ifr.contentWindow ? (ifr.contentWindow.__cmds || []) : [];
});

async function check1_loadedGridReachable(browser) {
  console.log("\nCHECK 1 — Goose Creek (a schedule IS loaded): the Schedules button exists and its dropdown carries all three groups");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const bodyBefore = await page.evaluate(() => document.body.innerText);
  ok(bodyBefore.includes("Goose Creek") && !bodyBefore.includes("No schedule"), "starting state: Goose Creek's own schedule is showing, not the empty state");

  const btn = switcherBtn(page);
  const btnPresent = await btn.count().then((n) => n > 0).catch(() => false);
  ok(btnPresent, "the 'Schedules' button is present in the header while a schedule is loaded (THE bug: pre-fix this did not exist)");
  if (!btnPresent) { await ctx.close(); return; }

  await btn.click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const listVisible = await ownerList(page).count().then((n) => n > 0).catch(() => false);
  ok(listVisible, "clicking it opens the grouped schedule list (ScheduleOwnerList)");

  const listText = await ownerList(page).innerText().catch(() => "");
  const listLower = listText.toLowerCase();
  ok(listText.includes("Goose Creek"), "the routed project's OWN group heading ('Goose Creek') is present");
  ok(listText.includes("TAS Land Sale"), "Goose Creek's OTHER schedule ('TAS Land Sale') is now reachable from Goose Creek's own Schedule tab");
  ok(listLower.includes("organization"), "the Organization group is present");
  ok(listText.includes("Pursuits") && listText.includes("Operations"), "both Organization-owned schedules (Pursuits, Operations) are listed");
  ok(listLower.includes("other projects") && listText.includes("Grand Port"), "another project's schedule (Grand Port) is listed under 'Other projects'");

  // Pick the sibling schedule under the SAME site — it should switch without leaving the project.
  const tasRow = page.locator('[data-testid="schedule-owner-row"][data-schedule-id="22"]');
  await tasRow.click({ timeout: 6000 });
  await page.waitForTimeout(400);
  const hash = await page.evaluate(() => window.location.hash);
  ok(hash.includes(GOOSE_CREEK_GID), "picking Goose Creek's OTHER schedule keeps the route on Goose Creek (Site/Review/Library/Notes undisturbed)");

  await page.screenshot({ path: new URL("./screens/schedule-list-reachable-goosecreek.png", import.meta.url).pathname });
  await ctx.close();
}

async function check2_emptyStateUnregressed(browser) {
  console.log("\nCHECK 2 — Woods Road (NO linked schedule): the original empty-state rail is unchanged");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${WOODS_ROAD_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const body = await page.evaluate(() => document.body.innerText);
  ok(body.includes("No schedule"), "the empty state still shows for a project with zero schedules (unregressed)");
  ok(body.toLowerCase().includes("organization") && body.includes("Pursuits") && body.includes("Operations"), "the empty state's own inline Organization group is unchanged");

  const btnPresent = await switcherBtn(page).count().then((n) => n > 0).catch(() => false);
  ok(btnPresent, "the header 'Schedules' button ALSO exists here (consistent entry point in both states)");

  // B1397568 — the empty state's own inline ScheduleOwnerList (below LinkSchedulePanel) must NOT
  // also grow a "New schedule" row: LinkSchedulePanel already owns Create/Link here, and a second
  // create control on the one surface that already had a clear one would be a redundant control.
  const inlineCreateRow = await page.locator('[data-testid="schedule-owner-create"]').count().catch(() => -1);
  ok(inlineCreateRow === 0, `the empty state's inline list carries NO create row of its own — LinkSchedulePanel's "Create schedule"/"Link an existing schedule" stay the only ones here (found ${inlineCreateRow})`);
  await ctx.close();
}

async function check3_splitAndGanttViews(browser) {
  console.log("\nCHECK 3 — Split and Gantt views (not just Grid): the Schedules button survives a view switch");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  for (const label of ["Split", "Gantt", "Grid"]) {
    await page.locator(`button[aria-pressed]:has-text("${label}")`).first().click({ timeout: 6000 });
    await page.waitForTimeout(300);
    const present = await switcherBtn(page).count().then((n) => n > 0).catch(() => false);
    ok(present, `'Schedules' button is present in the ${label} view`);
  }
  await ctx.close();
}

async function check4_phoneWidth(browser) {
  console.log("\nCHECK 4 — phone width: the Schedules button is reachable on the narrow header (horizontal scroll, not a 2nd line)");
  const ctx = await newCtx(browser, { initialActiveId: "1", viewport: { width: 380, height: 800 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const btn = switcherBtn(page);
  const present = await btn.count().then((n) => n > 0).catch(() => false);
  ok(present, "the 'Schedules' button exists in the DOM at phone width");
  if (present) {
    // The narrow header scrolls SIDEWAYS (flexWrap:"nowrap" + overflow-x — the owner's explicit
    // ask, see AppHeader.jsx's Row-2 comment), so the button legitimately sits past the phone
    // screen's right edge with nothing else broken — a real user reaches it with a swipe.
    // Playwright's coordinate-based .click() re-derives "in viewport" from the OUTER page frame
    // and disagrees with a nested horizontal-scroll container no matter how it's scrolled first
    // (DRIVER-SCROLL-IS-NOT-APP-SCROLL: the driver's own notion of "on screen" isn't the app's),
    // so this scrolls the real overflow-x ancestor by hand and fires the click as a real in-page
    // DOM event — proving the SAME thing a swipe-then-tap would (the button is reachable and its
    // handler runs), without fighting the driver's coordinate math over a scroll it can't see.
    const opened = await page.evaluate(() => {
      let el = document.querySelector('[data-testid="schedule-switcher-btn"]');
      if (!el) return false;
      let anc = el.parentElement;
      while (anc && anc !== document.body) {
        if (anc.scrollWidth > anc.clientWidth + 1) { anc.scrollLeft = anc.scrollWidth; break; }
        anc = anc.parentElement;
      }
      el.click();
      return true;
    });
    ok(opened, "the button is reachable via the row's own horizontal scroll and its click handler fires");
    await page.waitForTimeout(250);
    const listVisible = await ownerList(page).count().then((n) => n > 0).catch(() => false);
    ok(listVisible, "the dropdown opens on the phone-width header too");
    const createVisible = await page.locator('[data-testid="schedule-owner-create"]').count().then((n) => n > 0).catch(() => false);
    ok(createVisible, "'New schedule' is reachable in that same dropdown at phone width");
  }
  await page.screenshot({ path: new URL("./screens/schedule-list-reachable-phone.png", import.meta.url).pathname });
  await ctx.close();
}

async function check6_createFromLoadedProjectViaPanel(browser) {
  console.log("\nCHECK 6 — '+ New schedule' now lives IN the Schedules panel itself (Goose Creek, 5 schedules already loaded) — the round trip");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await switcherBtn(page).click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const createRow = page.locator('[data-testid="schedule-owner-create"]');
  const createPresent = await createRow.count().then((n) => n > 0).catch(() => false);
  ok(createPresent, "a 'New schedule' row is present INSIDE the Schedules panel dropdown (THE gap this fix closes — pre-fix this did not exist here)");
  ok((await createRow.innerText().catch(() => "")).toLowerCase().includes("new schedule"), "its visible text reads 'New schedule' — matches the term the owner actually searched for and found zero matches on");
  if (!createPresent) { await ctx.close(); return; }

  await createRow.click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const modalVisible = await page.locator('[data-testid="new-schedule-modal"]').count().then((n) => n > 0).catch(() => false);
  ok(modalVisible, "clicking it opens the New-schedule dialog");

  const nameVal = await page.locator('[data-testid="new-schedule-name"]').inputValue().catch(() => null);
  ok(nameVal === "", `the name box starts BLANK, never auto-filled "Goose Creek (6)" — that auto-naming is what produced the three empty duplicates (got ${JSON.stringify(nameVal)})`);

  const ownerVal = await page.locator('[data-testid="new-schedule-owner"]').inputValue().catch(() => null);
  ok(ownerVal === GOOSE_CREEK_GID, `the owner is pre-selected to the project standing in the panel (got ${JSON.stringify(ownerVal)})`);

  const createBtn = page.locator('[data-testid="new-schedule-create"]');
  ok(await createBtn.isDisabled().catch(() => false), "Create is disabled while the name is empty — a name is required, never silently defaulted");

  await page.fill('[data-testid="new-schedule-name"]', "Land Sale 2");
  await createBtn.click({ timeout: 6000 });
  await page.waitForTimeout(300);

  const modalGone = await page.locator('[data-testid="new-schedule-modal"]').count().then((n) => n === 0).catch(() => false);
  ok(modalGone, "the dialog closes after a successful create");
  const cmds = await readCmds(page);
  ok(cmds.some((c) => c.startsWith("planar:nav-create-linked") && c.includes(`site:${GOOSE_CREEK_GID}`)), `a create command was bridged to the embedded app carrying the routed project as owner (cmds: ${JSON.stringify(cmds)})`);

  await ctx.close();
}

async function check7_oneScheduleProject(browser) {
  console.log("\nCHECK 7 — a project with exactly ONE schedule (Grand Port) also gets a create row, owner pre-filled, name blank");
  const ctx = await newCtx(browser, { initialActiveId: "3" }); // id "3" = Grand Port
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GRAND_PORT_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await switcherBtn(page).click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const createRow = page.locator('[data-testid="schedule-owner-create"]');
  const createPresent = await createRow.count().then((n) => n > 0).catch(() => false);
  ok(createPresent, "the create row is present for a project with only ONE schedule too");
  if (!createPresent) { await ctx.close(); return; }
  await createRow.click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const ownerVal = await page.locator('[data-testid="new-schedule-owner"]').inputValue().catch(() => null);
  ok(ownerVal === GRAND_PORT_GID, `owner pre-selected to Grand Port (got ${JSON.stringify(ownerVal)})`);
  const nameVal = await page.locator('[data-testid="new-schedule-name"]').inputValue().catch(() => null);
  ok(nameVal === "", `name starts blank — a schedule already named "Grand Port" exists under this owner, so the pre-fix auto-name would have collided (got ${JSON.stringify(nameVal)})`);
  await ctx.close();
}

async function check8_organizationOwnedCreate(browser) {
  console.log("\nCHECK 8 — creating an ORGANIZATION-owned schedule from the panel");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await switcherBtn(page).click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.locator('[data-testid="schedule-owner-create"]').click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.selectOption('[data-testid="new-schedule-owner"]', "__org__");
  await page.fill('[data-testid="new-schedule-name"]', "Company Retreat Plan");
  await page.locator('[data-testid="new-schedule-create"]').click({ timeout: 6000 });
  await page.waitForTimeout(300);

  const cmds = await readCmds(page);
  const created = cmds.find((c) => c.startsWith("planar:nav-create-linked"));
  ok(!!created, `a create command was bridged (cmds: ${JSON.stringify(cmds)})`);
  ok(!!created && !created.includes(":site:"), `the Organization-owned create carries NO siteId (got ${JSON.stringify(created)})`);
  await ctx.close();
}

async function check9_nameCollisionWarns(browser) {
  console.log("\nCHECK 9 — a name colliding with an existing schedule under the SAME owner warns, but never blocks");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await switcherBtn(page).click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.locator('[data-testid="schedule-owner-create"]').click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.fill('[data-testid="new-schedule-name"]', "TAS Land Sale");
  await page.waitForTimeout(150);
  const warningVisible = await page.locator('[data-testid="new-schedule-warning"]').count().then((n) => n > 0).catch(() => false);
  ok(warningVisible, "a same-owner name collision shows a warning");
  const createDisabled = await page.locator('[data-testid="new-schedule-create"]').isDisabled().catch(() => true);
  ok(!createDisabled, "the collision warning does NOT block Create — he's allowed to name two schedules the same thing if he means to");
  await ctx.close();
}

async function check10_cancelCreatesNothing(browser) {
  console.log("\nCHECK 10 — cancelling the dialog creates nothing");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await switcherBtn(page).click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.locator('[data-testid="schedule-owner-create"]').click({ timeout: 6000 });
  await page.waitForTimeout(250);
  await page.fill('[data-testid="new-schedule-name"]', "Should never be created");
  const cmdsBefore = (await readCmds(page)).length;
  await page.locator('button:has-text("Cancel")').first().click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const modalGone = await page.locator('[data-testid="new-schedule-modal"]').count().then((n) => n === 0).catch(() => false);
  ok(modalGone, "Cancel closes the dialog");
  const cmdsAfter = (await readCmds(page)).length;
  ok(cmdsAfter === cmdsBefore, `Cancel posted no bridged command at all — nothing was created (before ${cmdsBefore}, after ${cmdsAfter})`);
  await ctx.close();
}

async function check5_createSecondScheduleFromLoadedProject(browser) {
  console.log("\nCHECK 5 — '+ New schedule' from a project that ALREADY has one (not just from the empty state)");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-list-reachable");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  await page.locator('[data-testid="project-crumb"]').first().click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const newRow = page.locator('button:has-text("New project")').first();
  const found = await newRow.count().then((n) => n > 0).catch(() => false);
  ok(found, "'New project' (opens the New-schedule dialog) is present in the breadcrumb menu from a loaded project");
  if (found) {
    await newRow.click({ timeout: 6000 });
    await page.waitForTimeout(250);
    const modalVisible = await page.locator('[data-testid="new-schedule-modal"]').count().then((n) => n > 0).catch(() => false);
    ok(modalVisible, "the New-schedule dialog opens from a project that already has a schedule (never gated by showEmptyState)");
    const ownerSelectValue = await page.locator('[data-testid="new-schedule-owner"]').inputValue().catch(() => null);
    ok(ownerSelectValue === GOOSE_CREEK_GID, `the dialog pre-selects the routed project as owner (got ${JSON.stringify(ownerSelectValue)})`);
  }
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await check1_loadedGridReachable(browser);
await check2_emptyStateUnregressed(browser);
await check3_splitAndGanttViews(browser);
await check4_phoneWidth(browser);
await check5_createSecondScheduleFromLoadedProject(browser);
await check6_createFromLoadedProjectViaPanel(browser);
await check7_oneScheduleProject(browser);
await check8_organizationOwnedCreate(browser);
await check9_nameCollisionWarns(browser);
await check10_cancelCreatesNothing(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — the schedule list is reachable whenever the Schedule tab is open, not only when the project has none, and '+ New schedule' is reachable from the Schedules panel itself for a project already carrying schedules" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
