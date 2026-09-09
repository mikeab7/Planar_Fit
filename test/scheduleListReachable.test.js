/* B1396192 — follow-on to PR #1578 (B1380336/B1380337). ScheduleOwnerList (the grouped
 * here/Organization/elsewhere schedule list) rendered ONLY inside Scheduler.jsx's "no schedule
 * yet" empty state — so the instant a routed project HAD a schedule, every one of that project's
 * OTHER schedules (and the Organization's) became unreachable from its own Schedule tab. Owner
 * repro: Goose Creek's "TAS Land Sale" schedule was unreachable from Goose Creek's own Schedule
 * tab the moment Goose Creek's first schedule loaded.
 *
 * The fix moved the list to a header button ("Schedules", ScheduleSwitcher in ScheduleToolbar.jsx)
 * rendered from ScheduleCenter — which structurally CANNOT depend on whether the project has a
 * schedule, because it is never given that information at all. This file guards both halves:
 * (1) a render proof that the switcher mounts regardless of how many schedules exist, and
 * (2) a structural guard that ScheduleCenter's own source never references `showEmptyState` (the
 * variable a future edit would have to reach for to re-introduce the bug) and that Scheduler.jsx
 * passes real schedule data into it unconditionally, not from inside a showEmptyState-gated block.
 *
 * The real, in-browser proof (a genuine schedule loaded, opening the dropdown, seeing every
 * group) lives in ui-audit/verify-schedule-list-reachable.mjs — mutation-proven live against a
 * pre-fix build (see that file's own header and the PR body). This file is the fast, CI-runnable
 * half; renderToStaticMarkup needs no jsdom, matching this repo's other toolbar render guards
 * (scheduleToolbarReserve.test.js).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleCenter } from "../src/workspaces/scheduler/components/ScheduleToolbar.jsx";

const TOOLBAR = {
  ready: true, settled: true, view: "grid", section: "projects", isMobile: false,
  zoomPct: 100, zoomable: false, reviewCount: 0, reviewOpen: false, saveStatus: "saved",
  savePulse: false, fileLinked: false, offlineFallback: false, authRequired: false, activePanel: null,
};

describe("ScheduleCenter — the 'Schedules' switcher mounts regardless of schedule count", () => {
  it("mounts with ZERO schedules (the shape a project with none of its own would pass)", () => {
    const html = renderToStaticMarkup(createElement(ScheduleCenter, {
      toolbar: TOOLBAR, post: () => {}, schedules: [], activeId: null, siteId: "site1", siteName: "Woods Road",
    }));
    expect(html).toContain('data-testid="schedule-switcher-btn"');
  });

  it("mounts IDENTICALLY (same button present) with FIVE schedules under the routed site — the exact Goose Creek shape", () => {
    const schedules = [
      { id: "1", name: "Goose Creek", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
      { id: "19", name: "Goose Creek", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
      { id: "20", name: "Goose Creek", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
      { id: "21", name: "Goose Creek", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
      { id: "22", name: "TAS Land Sale", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
    ];
    const html = renderToStaticMarkup(createElement(ScheduleCenter, {
      toolbar: TOOLBAR, post: () => {}, schedules, activeId: "1", siteId: "gc", siteName: "Goose Creek",
    }));
    expect(html).toContain('data-testid="schedule-switcher-btn"');
  });

  it("does not render at all while the toolbar isn't ready or isn't on the Projects section — unchanged prior behavior", () => {
    const notReady = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...TOOLBAR, ready: false }, post: () => {} }));
    const dashboard = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...TOOLBAR, section: "reports" }, post: () => {} }));
    expect(notReady).not.toContain("schedule-switcher-btn");
    expect(dashboard).not.toContain("schedule-switcher-btn");
  });
});

const TOOLBAR_SRC = readFileSync(
  fileURLToPath(new URL("../src/workspaces/scheduler/components/ScheduleToolbar.jsx", import.meta.url)),
  "utf8",
);
const SCHEDULER_SRC = readFileSync(
  fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)),
  "utf8",
);

describe("Structural guard — the switcher's mount point cannot be re-gated on emptiness", () => {
  it("ScheduleCenter's own function body never references showEmptyState — it isn't given that variable, so it structurally cannot branch on it", () => {
    const start = TOOLBAR_SRC.indexOf("export function ScheduleCenter(");
    expect(start, "ScheduleCenter's definition was not found — this guard's slice markers moved").toBeGreaterThan(-1);
    const end = TOOLBAR_SRC.indexOf("\nexport function ScheduleActions(", start);
    expect(end, "ScheduleActions' definition was not found after ScheduleCenter").toBeGreaterThan(start);
    const body = TOOLBAR_SRC.slice(start, end);
    expect(body).toContain("<ScheduleSwitcher");
    expect(body).not.toMatch(/showEmptyState/);
  });

  it("Scheduler.jsx passes real schedule data into ScheduleCenter (not defaulted-empty) from the single, unconditional AppHeader render", () => {
    // The non-org AppHeader (the org branch above it has its own separate, unrelated call) is the
    // ONLY place ScheduleCenter is invoked with real data — assert the props are wired, and that
    // this is the one AppHeader call reached on every render of the routed-project view (never
    // duplicated inside a `{showEmptyState && (...)}` block, which is exactly how the original bug
    // happened to ScheduleOwnerList).
    const idx = SCHEDULER_SRC.indexOf("<ScheduleCenter\n");
    expect(idx, "the non-org <ScheduleCenter ...> call was not found").toBeGreaterThan(-1);
    const call = SCHEDULER_SRC.slice(idx, SCHEDULER_SRC.indexOf("/>", idx));
    expect(call).toContain("schedules={projects}");
    expect(call).toContain("siteId={projectId}");
    expect(call).toContain("siteName={routedSiteName}");
    expect(call).toContain("onSelectSchedule={selectSchedule}");
    // There must be exactly ONE <ScheduleCenter invocation in the whole file (the org branch
    // renders AgendaView instead, never a second copy of this one) — so this can't be duplicated
    // into a conditional branch without this count changing.
    expect(SCHEDULER_SRC.match(/<ScheduleCenter/g)?.length).toBe(1);
  });
});
