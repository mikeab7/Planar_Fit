/* B1435888 — "Duplicate schedule" moved from the old flat project/schedule breadcrumb's kebab menu
 * (Rename/Duplicate/Delete, one press posting a bridged `planar:nav-duplicate`) onto the
 * schedule's own row in the SCHEDULE crumb's dropdown — an inline icon button beside the Rename
 * and Delete icons B1404352 already put there, not a submenu.
 *
 * Why it moved: "Schedule access: project and schedule become two separate breadcrumb levels"
 * (B1435888) turned the breadcrumb's PROJECT level into a genuine, uncontrolled Site Planner
 * project switcher — it lists real projects and has no schedule id to resolve any more, so the
 * old kebab's "Duplicate" row would have posted a SITE group id where the embedded app expects a
 * schedule id (a silent no-op) had it stayed there. Duplicating a SCHEDULE now lives with the
 * schedule, on the new SCHEDULE crumb (`ScheduleCrumb.jsx` → `ScheduleOwnerList.jsx`).
 *
 * Runs LOGGED OUT, following e2e/schedule-ownership.spec.js's own seeding + bridge-driving
 * pattern: a Site Planner project in the legacy local store, plus the embedded scheduler's
 * nav-state posted in exactly as the real iframe would post it.
 *
 * RED-PROOF: every testid this file locates below the crumb (`schedule-crumb`,
 * `schedule-owner-duplicate`) is new to this schedule row in this PR; `git stash` on this branch
 * and the first locator below fails (element not found).
 *
 * ⛔ NEW-1 (2026-09-10) — Rename/Duplicate/Delete moved BEHIND a per-row kebab
 * (`schedule-owner-kebab`); this drives that kebab before locating Duplicate, since it no longer
 * renders as an always-visible row icon.
 */
import { test, expect } from "@playwright/test";

const GID = "g-duptest";

function seed(page) {
  return page.addInitScript(([gid]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: "ZZ Duplicate Test", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
    localStorage.setItem("planyr.theme", "light");

    /* Record what the shell POSTS into the iframe, so "did clicking Duplicate actually ask for
     * the right thing" is observable without the embedded app itself. Same-origin, so wrapping is
     * allowed — same technique e2e/schedule-ownership.spec.js's own seed() uses. */
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
  }, [GID]);
}

const SCHEDULES = [
  { id: 1, name: "ZZ Duplicate Test", ownerKind: "site", linkedSiteId: GID, linkedSiteName: "ZZ Duplicate Test", taskCount: 3 },
];

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);

test.describe("B1435888 — Duplicate is reachable from the SCHEDULE crumb's own row", () => {
  test("the schedule crumb's dropdown renders Rename, Duplicate and Delete on the row, and Duplicate posts the schedule's own id", async ({ page }) => {
    await seed(page);
    await page.goto(`/#/project/${GID}/schedule`);

    // Wait for the tab to resolve (the empty state's own list appears once the iframe reports in)
    // BEFORE posting the fixture, exactly like schedule-ownership.spec.js's openSchedule — or the
    // embed's own boot post lands last and wins.
    await expect(page.getByTestId("schedule-owner-list")).toBeVisible({ timeout: 25_000 });
    await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: 1, projects: SCHEDULES });

    // Open the SCHEDULE crumb (the second breadcrumb level, right beside the project crumb).
    const scheduleCrumb = page.getByTestId("schedule-crumb");
    await expect(scheduleCrumb).toBeVisible({ timeout: 10_000 });
    await scheduleCrumb.click();

    const row = page.getByTestId("schedule-owner-row").filter({ hasText: "ZZ Duplicate Test" });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByTestId("schedule-owner-kebab").click();
    await expect(page.getByTestId("schedule-owner-rename")).toBeVisible();
    const duplicateBtn = page.getByTestId("schedule-owner-duplicate");
    await expect(duplicateBtn).toBeVisible();
    await expect(page.getByTestId("schedule-owner-delete")).toBeVisible();

    await duplicateBtn.click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-duplicate"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-duplicate", id: 1 }]);
  });
});
