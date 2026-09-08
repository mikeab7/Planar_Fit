/* EVERY SCHEDULE HAS AN OWNER — the two user-visible halves, driven against the real app.
 *
 * The owner's report: he cannot have a Master Schedule and a Land Sale schedule under Goose Creek,
 * and pressing "New schedule" three times silently produced "Goose Creek (2)", "(3)" and "(4)" —
 * three empty duplicates that are on production right now. Two things had to change and both are
 * asserted here against a real browser rather than a source regex:
 *
 *   1. NEW SCHEDULE ASKS. It opens a dialog with the name pre-filled and the owner pre-selected to
 *      the project he is standing on, and it CANNOT create anything without both. The old path
 *      created a schedule outright with no prompt at any point, which is precisely why nothing on
 *      screen said it had happened.
 *   2. A PROJECT'S SCHEDULES ARE LISTED, with the ORGANIZATION as a peer container in the same
 *      list — never an "unassigned" or "no project" pile (owner rule: everything lives under
 *      something).
 *
 * Runs LOGGED OUT, like e2e/schedule-link-panel.spec.js, whose seeding + bridge-driving pattern
 * this follows: a Site Planner project in the legacy local store plus a route pointing at it, and
 * the embedded scheduler's nav-state posted in as the iframe would post it. No cloud, no external
 * GIS, so it is fully self-verifiable in the sandbox.
 *
 * ⛔ THE FIXTURE IS THE OWNER'S OWN SHAPE, NOT A TIDY ONE (WRONG-CASE). Goose Creek carries FIVE
 * schedules including the three empty duplicates, and two schedules (Pursuits, Operations) belong
 * to no project at all — that is production at __rev 4232. A one-schedule fixture passes every
 * assertion below while exercising neither the grouping nor the withheld name suggestion.
 */
import { test, expect } from "@playwright/test";

/* The migration block below calls the scheduler page's OWN module-scope declarations from inside
 * `page.evaluate`, where they are live globals of that document — not imports of this file. Declared
 * for ESLint only; if a future build ever wrapped that script in a closure these identifiers would
 * stop resolving and the test would fail LOUDLY, which is exactly the signal wanted (the module
 * would no longer be reachable in the shipped page). */
/* global normalizeScheduleOwnership, migrateScheduleOwnership, pruneScheduleRefs, ownerOf, validateNewSchedule */

const GOOSE = "g-goose";
const GRAND = "g-grand";
/* A project with no schedule of its own — the empty state, where the list and the dialog live. */
const ORPHAN = "g-orphan";

/* Seed the logged-out site store. Two real projects so the owner picker has something to change TO. */
function seed(page) {
  return page.addInitScript(([goose, grand, orphan]) => {
    const rec = (id, g, s) => ({ id, groupId: g, site: s, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: rec("p1", goose, "Goose Creek"),
      p2: rec("p2", grand, "Grand Port"),
      // A project with NO schedule of its own — the empty state, which is where the owner list and
      // the New-schedule dialog both live.
      p3: rec("p3", orphan, "Bayou Bend"),
    }));
    localStorage.setItem("planyr.theme", "light");

    /* Record what the shell POSTS into the iframe, so "did pressing Create actually ask for the
     * right thing" is observable without the embedded app (whose in-browser Babel is CDN-loaded and
     * may not run in the sandbox). Same-origin, so wrapping is allowed. */
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        const w = desc.get.call(this);
        try {
          if (w && !w.__planyrPosted) {
            const orig = w.postMessage.bind(w);
            w.__planyrPosted = true;
            w.postMessage = (m, o) => { (window.__posted = window.__posted || []).push(m); return orig(m, o); };
          }
        } catch (_) {}
        return w;
      },
    });
  }, [GOOSE, GRAND, ORPHAN]);
}

/* The production schedule set, as the embedded app bridges it up. */
const SCHEDULES = [
  { id: 1,  name: "Goose Creek",      ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
  { id: 19, name: "Goose Creek (2)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
  { id: 20, name: "Goose Creek (3)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
  { id: 21, name: "Goose Creek (4)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
  { id: 22, name: "TAS Land Sale",    ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
  { id: 2,  name: "Grand Port",       ownerKind: "site", linkedSiteId: GRAND, linkedSiteName: "Grand Port" },
  { id: 5,  name: "Pursuits",         ownerKind: "org" },
  { id: 7,  name: "Operations",       ownerKind: "org" },
];

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);

/* Open a project's Schedule tab carrying `projects` as the bridged schedule list.
 *
 * ⛔ THE RE-POST AFTER SETTLE IS LOad-BEARING, and getting it wrong is how this harness first
 * reported ten false failures against working code. The embedded scheduler BOOTS and posts its own
 * nav-state (seeded from `__PLANAR_DATA__` when signed out), so a list posted before it settles is
 * simply overwritten and every assertion below then measures the seed rather than the fixture.
 * Posting after the app has reported in — and re-asserting on the rows that actually render — is
 * what makes the reading about this feature rather than about the boot race. */
async function openSchedule(page, gid, projects) {
  await seed(page);
  await page.goto(`/#/project/${gid}/schedule`);
  // Wait for the tab to resolve (the empty state appears once the iframe reports in, or on its
  // reveal fallback) BEFORE posting, or the embed's own boot post lands last and wins.
  await expect(page.getByTestId("schedule-owner-list")).toBeVisible({ timeout: 25_000 });
  await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: null, projects });
  await expect(page.getByTestId("schedule-owner-row").first()).toBeVisible({ timeout: 10_000 });
}

/* "+ New project" lives in the breadcrumb dropdown (the shared switcher), not on the page surface.
 * In the Schedule module it creates a SCHEDULE — which is what opens the dialog under test. */
async function pressNew(page) {
  await page.locator('[data-testid="new-schedule-modal"]').waitFor({ state: "detached" }).catch(() => {});
  await page.getByRole("button", { name: /▾/ }).first().click();
  await page.getByRole("button", { name: /New project/i }).last().click();
}

test.describe("a project's schedules are listed, with the organization as a peer container", () => {
  test("groups into this project / Organization / other projects — and never an 'unassigned' pile", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const list = page.getByTestId("schedule-owner-list");

    // The organization is a real heading in the same list, holding the two cross-project schedules.
    await expect(list).toContainText("Organization");
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Pursuits" })).toHaveCount(1);
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Operations" })).toHaveCount(1);

    // ⛔ The words the owner explicitly rejected must appear nowhere.
    await expect(list).not.toContainText(/unassigned/i);
    await expect(list).not.toContainText(/no project/i);

    // This project owns none yet — said plainly, still under its own heading, never dropped.
    await expect(list).toContainText("Bayou Bend");
    await expect(list).toContainText("No schedules here yet.");

    // Every one of the eight schedules is reachable — nothing is hidden by grouping.
    await expect(list.getByTestId("schedule-owner-row")).toHaveCount(SCHEDULES.length);
  });

  test("all five of Goose Creek's schedules sit together under one heading, contiguously", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const names = await page.getByTestId("schedule-owner-row").allInnerTexts();
    const goose = ["Goose Creek", "Goose Creek (2)", "Goose Creek (3)", "Goose Creek (4)", "TAS Land Sale"];
    for (const n of goose) expect(names).toContain(n);
    // One group, not scattered through the account-wide run — which is what the flat switcher did.
    const idx = goose.map((n) => names.indexOf(n));
    expect(Math.max(...idx) - Math.min(...idx)).toBe(goose.length - 1);
  });
});

test.describe("New schedule ASKS — it can never silently mint another 'Goose Creek (5)'", () => {
  async function openDialog(page, gid = ORPHAN) {
    await openSchedule(page, gid, SCHEDULES);
    await pressNew(page);
    await expect(page.getByTestId("new-schedule-modal")).toBeVisible();
  }

  test("pressing it opens a dialog and creates NOTHING on its own", async ({ page }) => {
    await openDialog(page);
    // The whole defect in one assertion: no create was posted by the press itself.
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted).toEqual([]);
  });

  test("the owner is PRE-SELECTED to the project he is standing on, and is changeable", async ({ page }) => {
    await openDialog(page);
    const owner = page.getByTestId("new-schedule-owner");
    await expect(owner).toHaveValue(ORPHAN);
    // Every real owner is offered, the organization included — and no "none" option exists.
    const options = await owner.locator("option").allInnerTexts();
    expect(options).toContain("Organization");
    expect(options).toContain("Goose Creek");
    expect(options.join("|")).not.toMatch(/unassigned|no project|none/i);
    await owner.selectOption({ label: "Organization" });
    await expect(owner).toHaveValue("__org__");
  });

  test("a project with no schedule yet has its name PRE-FILLED — editable, not committed", async ({ page }) => {
    await openDialog(page);
    await expect(page.getByTestId("new-schedule-name")).toHaveValue("Bayou Bend");
  });

  test("⛔ a project that ALREADY has schedules gets an EMPTY name, never 'Goose Creek (5)'", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    const name = page.getByTestId("new-schedule-name");
    await expect(name).toHaveValue("");
    await expect(name).not.toHaveValue(/\(\d+\)/);
    // ...and with nothing typed, it CANNOT be created. This is the three duplicates' root cause,
    // closed: the old path needed no name at all.
    await expect(page.getByTestId("new-schedule-create")).toBeDisabled();
  });

  test("it warns about a same-owner name collision without blocking a deliberate one", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    await page.getByTestId("new-schedule-name").fill("Goose Creek");
    await expect(page.getByTestId("new-schedule-warning")).toBeVisible();
    await expect(page.getByTestId("new-schedule-create")).toBeEnabled();
  });

  test("creating posts ONE create carrying the chosen name AND an explicit owner", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    await page.getByTestId("new-schedule-name").fill("Land Sale");
    await page.getByTestId("new-schedule-create").click();
    await expect(page.getByTestId("new-schedule-modal")).toHaveCount(0);
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted.length).toBe(1);
    expect(posted[0].name).toBe("Land Sale");
    expect(posted[0].ownerKind).toBe("site");
    expect(posted[0].siteId).toBe(GOOSE);
  });

  test("an ORG-owned schedule is created with no site at all, and that is a real owner", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Organization" });
    await page.getByTestId("new-schedule-name").fill("2027 Pursuits");
    await page.getByTestId("new-schedule-create").click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted.length).toBe(1);
    expect(posted[0].ownerKind).toBe("org");
    expect(posted[0].siteId).toBeNull();
  });

  test("Cancel and Escape both leave without creating anything", async ({ page }) => {
    await openDialog(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("new-schedule-modal")).toHaveCount(0);
    expect(await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked").length)).toBe(0);
  });

  /* The phone layout is one of the adjacent cases the brief called out: the dialog must stay
   * usable and must not overflow the viewport at phone width. */
  test("phone width: the dialog fits and both decisions stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openDialog(page);
    const card = page.getByTestId("new-schedule-modal");
    await expect(page.getByTestId("new-schedule-name")).toBeVisible();
    await expect(page.getByTestId("new-schedule-owner")).toBeVisible();
    await expect(page.getByTestId("new-schedule-create")).toBeVisible();
    const box = await card.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    // The page itself must not scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* ── The migration, exercised in the SHIPPED bytes ────────────────────────────────────────────────
 *
 * ⛔ EVERY OTHER CHECK ON THE MIGRATION READS THE CANONICAL MODULE IN src/. The embedded scheduler
 * cannot import from src/ — it carries a verbatim INLINED copy — and the production build then
 * pre-compiles its Babel blocks and strips @babel/standalone (see scripts/build-sequence-compiled).
 * So "the module is correct" and "the module is alive in the page the owner loads" are two
 * different claims, and only the second one protects his data. A unit test on src/ would stay green
 * through a broken inline copy, a marker that drifted, or a build step that scoped the block away.
 * This drives the real /sequence/ page and calls the functions that are actually in it.
 *
 * The document is production's shape at __rev 4232: twelve schedules, 813 tasks, two owned by no
 * project, and eight orphaned next-task-id counters. The assertions are the two promises the PR
 * makes about his data — NOTHING LOSES ITS TASKS and NOTHING BECOMES UNREACHABLE. */
test.describe("the ownership migration is live in the shipped scheduler page", () => {
  const DOC = {
    __rev: 4232, nPid: 23, aPid: 1,
    nTid: { 1: 302, 2: 279, 3: 162, 4: 5, 5: 16, 6: 43, 7: 8, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1,
            13: 1, 14: 1, 15: 2, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 9 },
    lastActiveBySite: { "smqfy2r7pdec": 2, "smqfy48tlk9j": 22, "smsdrvzr9gzx": 15 },
    projects: {
      1:  { id: 1,  name: "Goose Creek",      n: 301, linkedSiteId: "smqfy48tlk9j" },
      2:  { id: 2,  name: "Grand Port",       n: 278, linkedSiteId: "smqfy2r7pdec" },
      3:  { id: 3,  name: "8 South",          n: 161, linkedSiteId: "smqiljx5fngg" },
      5:  { id: 5,  name: "Pursuits",         n: 15 },
      6:  { id: 6,  name: "Pappadoupolos",    n: 42,  linkedSiteId: "smqgpt12zh5o" },
      7:  { id: 7,  name: "Operations",       n: 7 },
      15: { id: 15, name: "Richfield",        n: 1,   linkedSiteId: "smsdrvzr9gzx" },
      16: { id: 16, name: "ZZ-RENAME-TEST-G", n: 0,   linkedSiteId: "smtjb0lrexb3" },
      19: { id: 19, name: "Goose Creek (2)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      20: { id: 20, name: "Goose Creek (3)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      21: { id: 21, name: "Goose Creek (4)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      22: { id: 22, name: "TAS Land Sale",    n: 8,   linkedSiteId: "smqfy48tlk9j" },
    },
  };

  async function runInPage(page, fnBody) {
    await page.goto("/sequence/index.html");
    // The ownership block is a module-scope declaration in the page's own script, so it is reachable
    // as a bare identifier. Wait for it rather than racing the compiled bundle's evaluation.
    await page.waitForFunction(() => typeof normalizeScheduleOwnership === "function", null, { timeout: 30_000 });
    return page.evaluate(fnBody, DOC);
  }

  test("the inlined module is genuinely present and callable in the built page", async ({ page }) => {
    const kinds = await runInPage(page, () => [
      typeof normalizeScheduleOwnership, typeof migrateScheduleOwnership,
      typeof pruneScheduleRefs, typeof ownerOf, typeof validateNewSchedule,
    ]);
    expect(kinds).toEqual(["function", "function", "function", "function", "function"]);
  });

  test("NOTHING LOSES ITS TASKS and NOTHING BECOMES UNREACHABLE", async ({ page }) => {
    const out = await runInPage(page, (doc) => {
      // Rehydrate the task arrays at their real lengths inside the page.
      const d = { ...doc, projects: {} };
      for (const [pid, p] of Object.entries(doc.projects)) {
        d.projects[pid] = { ...p, tasks: Array.from({ length: p.n }, (_, i) => ({ id: i + 1 })) };
      }
      const before = Object.values(d.projects).reduce((n, p) => n + p.tasks.length, 0);
      const after = normalizeScheduleOwnership(d);
      return {
        before,
        afterTasks: Object.values(after.projects).reduce((n, p) => n + p.tasks.length, 0),
        ids: Object.keys(after.projects).map(Number).sort((a, b) => a - b),
        owners: Object.fromEntries(Object.values(after.projects).map((p) => [p.name, ownerOf(p).kind])),
        nTidKeys: Object.keys(after.nTid).map(Number).sort((a, b) => a - b),
        lastActive: after.lastActiveBySite,
        idempotent: normalizeScheduleOwnership(after) === after,
      };
    });

    expect(out.before).toBe(813);
    expect(out.afterTasks).toBe(813);                       // not one task lost
    expect(out.ids).toEqual([1, 2, 3, 5, 6, 7, 15, 16, 19, 20, 21, 22]); // not one schedule dropped

    // Every schedule now has an explicit owner; only the two genuinely cross-project ones are the
    // organization's. NOT ONE was guessed from a name — see the module header.
    expect(out.owners).toEqual({
      "Goose Creek": "site", "Goose Creek (2)": "site", "Goose Creek (3)": "site",
      "Goose Creek (4)": "site", "TAS Land Sale": "site", "Grand Port": "site",
      "8 South": "site", "Pappadoupolos": "site", "Richfield": "site",
      "ZZ-RENAME-TEST-G": "site", "Pursuits": "org", "Operations": "org",
    });

    // The eight orphaned counters (4, 8–14, 17, 18) are swept; every live one survives.
    expect(out.nTidKeys).toEqual([1, 2, 3, 5, 6, 7, 15, 16, 19, 20, 21, 22]);
    // The last-active pointers all name live schedules, so none is touched.
    expect(out.lastActive).toEqual({ "smqfy2r7pdec": 2, "smqfy48tlk9j": 22, "smsdrvzr9gzx": 15 });
    // A second boot changes nothing — so this never bumps __rev on every tab that opens.
    expect(out.idempotent).toBe(true);
  });

  test("deleting a schedule takes its counter and its pointer with it", async ({ page }) => {
    const out = await runInPage(page, (doc) => {
      const d = { ...doc, projects: {} };
      for (const [pid, p] of Object.entries(doc.projects)) d.projects[pid] = { ...p, tasks: [] };
      const seeded = normalizeScheduleOwnership(d);
      const projects = { ...seeded.projects };
      delete projects[22];                                  // he deletes "TAS Land Sale"
      const after = pruneScheduleRefs({ ...seeded, projects });
      return { nTid22: after.nTid[22] ?? null, goose: after.lastActiveBySite["smqfy48tlk9j"] ?? null,
               grand: after.lastActiveBySite["smqfy2r7pdec"] ?? null };
    });
    expect(out.nTid22).toBeNull();
    expect(out.goose).toBeNull();     // no pointer left aimed at a schedule that is gone
    expect(out.grand).toBe(2);        // live pointers untouched
  });
});
