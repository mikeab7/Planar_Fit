/* ScheduleOwnerList — "which schedules does this project have, and which am I looking at?"
 *
 * A project may own several schedules (the owner's own Goose Creek carries a master schedule and a
 * land-sale schedule), and before this there was nowhere that said so: the account-wide breadcrumb
 * switcher listed every schedule in one flat run with no indication of which belonged to the
 * project he was standing on, so "does this project have another schedule?" had no answer on
 * screen. This is that answer — the routed project's own schedules first, then the ORGANIZATION's
 * (the container for the schedules that genuinely span deals, Pursuits and Operations), then
 * everything belonging to another project.
 *
 * The organization is a peer heading in the same list, never an "unassigned" or "no project"
 * bucket — owner rule, 2026-09-08: everything lives under something.
 *
 * Purely a switcher: it selects, it never creates, renames or deletes (those stay on the
 * breadcrumb's own kebab, which already has them and already confirms). Ownership itself is read
 * through the shared `partitionSchedules`, never re-derived here — one answer to "who owns this",
 * the whole point of src/shared/schedule/scheduleOwnership.js.
 *
 * ⛔ B1396192 — THIS USED TO RENDER ONLY INSIDE Scheduler.jsx'S EMPTY STATE, so the moment a
 * routed project HAD a schedule (any schedule), every one of its OTHER schedules — and the
 * Organization's — became unreachable from that project's Schedule tab. That was the owner's
 * whole original complaint (B1380336/B1380337) restated one level up: Goose Creek's own "TAS Land
 * Sale" schedule stayed unreachable from Goose Creek's Schedule tab, the instant Goose Creek's
 * FIRST schedule loaded. This component itself was already correct — the bug was purely about
 * WHERE it was mounted. It now renders from TWO call sites: Scheduler.jsx's empty state (a
 * project with no schedule yet — unchanged), and the header's "Schedules" button/dropdown
 * (`ScheduleSwitcher` in ScheduleToolbar.jsx — new, covers every other case, incl. Grid/Split/
 * Gantt and the phone-width header's horizontal-scroll toolbar).
 *
 * ⛔ B1397568 — "＋ New schedule" IS NOW A ROW IN THIS LIST, when `onCreate` is passed in. The
 * create dialog (NewScheduleModal) already worked from a project that already has a schedule —
 * it was reachable via the breadcrumb's generic "＋ New project" row, confirmed live by
 * B1396192's own AUDIT-FIRST note. What the owner actually reported missing was a control HE
 * COULD FIND from the panel he was already using: he opened this exact list (the header's
 * "Schedules" dropdown), switched schedules successfully, and then searched the page for "new
 * schedule" / "create schedule" / "add schedule" / "+ new" / "link an existing" and matched
 * NONE of them — because the real control says "New project" (a generic, per-workspace label
 * that gives no hint it creates a SCHEDULE) and sits in a different menu (the project
 * breadcrumb) than the one he was looking at. So this is a discoverability fix, not a second
 * creation mechanism: the row below calls the SAME `onCreate` the caller already wires to
 * `newProjectAction`/`NewScheduleModal`, just reachable from the list that actually answers
 * "what schedules exist here" instead of a separately-named menu. Deliberately NOT passed from
 * Scheduler.jsx's own empty-state call site — that surface already has its own "Create
 * schedule" / "Link an existing schedule" buttons (LinkSchedulePanel) immediately above this
 * list, and a second create row there would be a redundant control for the one case that
 * already had a clear one.
 */
import { useMemo } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";
import { ORG_OWNER_LABEL, partitionSchedules } from "../../../shared/schedule/scheduleOwnership.js";

const ACCENT = MODULE_ACCENT.scheduler;

const wrap = {
  padding: SPACE.md, display: "flex", flexDirection: "column", gap: SPACE.xxs,
  fontFamily: "system-ui, sans-serif",
};
const heading = {
  fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--text-secondary)", padding: `${SPACE.md}px ${SPACE.sm}px ${SPACE.xxs}px`,
};
const rowBase = {
  display: "flex", alignItems: "center", gap: SPACE.md, width: "100%", textAlign: "left",
  padding: `${SPACE.sm}px ${SPACE.md}px`, borderRadius: RADIUS.md,
  border: "1px solid transparent", background: "none", cursor: "pointer",
  fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-primary)",
};
const emptyNote = {
  fontSize: FONT_SIZE.control, color: "var(--text-secondary)",
  padding: `${SPACE.sm}px ${SPACE.md}px`, lineHeight: 1.45,
};
const divider = { height: 1, background: "var(--border-default)", margin: `${SPACE.xs}px 0` };
const createRow = {
  ...rowBase, fontWeight: 700, color: ACCENT,
};

function Group({ title, schedules, activeId, onSelect, emptyText }) {
  if (!schedules.length && !emptyText) return null;
  return (
    <>
      <div style={heading}>{title}</div>
      {schedules.length === 0
        ? <div style={emptyNote}>{emptyText}</div>
        : schedules.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                data-testid="schedule-owner-row"
                data-schedule-id={String(s.id)}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect?.(s.id)}
                style={{
                  ...rowBase,
                  fontWeight: active ? 600 : 400,
                  borderColor: active ? ACCENT : "transparent",
                  background: active ? "var(--hover-chrome)" : "none",
                }}
              >
                <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name || "Untitled schedule"}
                </span>
              </button>
            );
          })}
    </>
  );
}

export default function ScheduleOwnerList({
  schedules = [], activeId = null, siteId = null, siteName = null, onSelect,
  // Optional — the header dropdown (ScheduleSwitcher) passes this; Scheduler.jsx's empty-state
  // call site does not (that surface already offers Create/Link via LinkSchedulePanel). See this
  // file's own header, B1397568.
  onCreate,
}) {
  const { here, org, elsewhere } = useMemo(() => partitionSchedules(schedules, siteId), [schedules, siteId]);
  return (
    <div style={wrap} data-testid="schedule-owner-list">
      {siteId != null && (
        <Group
          title={siteName || "This project"}
          schedules={here}
          activeId={activeId}
          onSelect={onSelect}
          emptyText="No schedules here yet."
        />
      )}
      <Group title={ORG_OWNER_LABEL} schedules={org} activeId={activeId} onSelect={onSelect} />
      <Group title="Other projects" schedules={elsewhere} activeId={activeId} onSelect={onSelect} />
      {onCreate && (
        <>
          <div style={divider} />
          <button
            type="button"
            data-testid="schedule-owner-create"
            title="New schedule — create another schedule for this project or the Organization"
            onClick={onCreate}
            style={createRow}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
            <span>New schedule</span>
          </button>
        </>
      )}
    </div>
  );
}
