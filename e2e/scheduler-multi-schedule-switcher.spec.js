/* Diagnostic probe for NEW-1 (B1112449/B1112450 recurrence) — drives the REAL
 * Scheduler -> AppHeader -> ProjectBreadcrumb chain with a bridged payload shaped exactly like
 * the owner's live production report: a site with TWO linked schedules sharing one linkedSiteId.
 * Bypasses the embedded iframe's own boot (it loads React/Babel from a CDN this sandbox can't
 * reach) by posting the bridge message directly, same idiom as e2e/schedule-link-panel.spec.js.
 *
 * ⛔ B1435888 — the first test below is UPDATED for the two-independent-breadcrumb-levels
 * redesign; it used to assert the OLD combined crumb ("ZZ-RENAME-TEST-G (2)" in the PROJECT
 * crumb, two rows in the PROJECT dropdown). Disambiguation now lives entirely in the SCHEDULE
 * crumb (a schedule's own name, e.g. "ZZ-RENAME-TEST-G (2)", already disambiguates itself — no
 * relabeling needed) — the project crumb shows the plain project name and its dropdown lists
 * projects only. The telemetry instrument (second test) is unaffected: it never asserted on
 * crumb content, only that the bridge payload itself gets captured.
 */
import { test, expect } from "@playwright/test";

const GID = "g-zzmulti";

function seed(page) {
  return page.addInitScript(([gid]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: "ZZ-RENAME-TEST-G", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
  }, [GID]);
}

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);
const navState = (projects, activeId, section = "projects") =>
  ({ type: "planar:nav-state", section, activeId, projects });

test("a site with two linked schedules: the PROJECT crumb stays plain, the SCHEDULE crumb disambiguates and offers both rows", async ({ page }) => {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });

  const projectCrumb = page.locator('[data-testid="project-crumb"]:visible');
  await expect(projectCrumb).toBeVisible({ timeout: 15_000 });

  // Post the real bridged shape: two schedules, same linkedSiteId, second one active.
  await postSeq(page, navState(
    [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
      { id: 18, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
    ],
    18,
    "projects",
  ));
  await page.waitForTimeout(600);

  // The PROJECT crumb names only the project — never a schedule's disambiguated name.
  await expect(projectCrumb).toContainText("ZZ-RENAME-TEST-G");
  await expect(projectCrumb).not.toContainText("ZZ-RENAME-TEST-G (2)");

  // The SCHEDULE crumb (the second, independent breadcrumb level) names the ACTIVE schedule —
  // its own name already disambiguates it, with no relabeling needed.
  const scheduleCrumb = page.locator('[data-testid="schedule-crumb"]:visible');
  await expect(scheduleCrumb).toBeVisible({ timeout: 10_000 });
  await expect(scheduleCrumb).toContainText("ZZ-RENAME-TEST-G (2)");

  // Its own dropdown offers both of this project's schedules as selectable rows.
  await scheduleCrumb.click();
  const rows = page.locator('[data-testid="schedule-owner-row"]:visible');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  const texts = await rows.allInnerTexts();
  expect(texts.some((t) => t.startsWith("ZZ-RENAME-TEST-G\n") || t === "ZZ-RENAME-TEST-G")).toBe(true);
  expect(texts.some((t) => t.startsWith("ZZ-RENAME-TEST-G (2)"))).toBe(true);
});

test("a multi-linked-schedule bridge payload is captured to telemetry (B1112449/B1112450 recurrence instrument)", async ({ page }) => {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });
  const crumb = page.locator('[data-testid="project-crumb"]:visible');
  await expect(crumb).toBeVisible({ timeout: 15_000 });

  await postSeq(page, navState(
    [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
      { id: 18, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
    ],
    18,
    "projects",
  ));
  await page.waitForTimeout(600);

  const recent = await page.evaluate(() => (window.pfTelemetry ? window.pfTelemetry.recent() : []));
  const hit = recent.find((r) => (r.source || "").includes("schedule-multi-link-payload"));
  expect(hit).toBeTruthy();
  expect(hit.message).toContain(GID);
  expect(hit.message).toMatch(/"id":16/);
  expect(hit.message).toMatch(/"id":18/);
});
