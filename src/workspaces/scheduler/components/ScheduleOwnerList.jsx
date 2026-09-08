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
    </div>
  );
}
