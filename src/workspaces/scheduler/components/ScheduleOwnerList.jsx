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
 * It selects, and — since B1404352 (see that note below) — it also creates, renames and deletes.
 * Ownership itself is read through the shared `partitionSchedules`, never re-derived here — one
 * answer to "who owns this", the whole point of src/shared/schedule/scheduleOwnership.js.
 *
 * ⛔ B1396192 (SUPERSEDED BY NEW-1) — THIS USED TO RENDER ONLY INSIDE Scheduler.jsx'S EMPTY STATE,
 * so the moment a routed project HAD a schedule (any schedule), every one of its OTHER schedules
 * — and the Organization's — became unreachable from that project's Schedule tab. That was the
 * owner's whole original complaint (B1380336/B1380337) restated one level up: Goose Creek's own
 * "TAS Land Sale" schedule stayed unreachable from Goose Creek's Schedule tab, the instant Goose
 * Creek's FIRST schedule loaded. This component itself was already correct — the bug was purely
 * about WHERE it was mounted. B1396192's fix added a SECOND call site, the header's "Schedules"
 * button/dropdown (`ScheduleSwitcher` in ScheduleToolbar.jsx). NEW-1 (2026-09-10) removed that
 * button outright once B1435888's `ScheduleCrumb` (below) took over the same job from the
 * breadcrumb, which is where the user already looks to see where they are. The two remaining call
 * sites are Scheduler.jsx's empty state (a project with no schedule yet) and `ScheduleCrumb.jsx`.
 *
 * ⛔ B1435888 — TWO OPTIONAL PROPS FOR THE ROW-1 BREADCRUMB'S OWN SCHEDULE LEVEL (`ScheduleCrumb.jsx`,
 * "Schedule access: project and schedule become two separate breadcrumb levels"). `showOther`
 * (default true) hides the "Other projects" group when false — the breadcrumb's own dropdown is
 * scoped to THIS project + the Organization only, per the owner-picked mockup; the empty-state's
 * own inline call site keeps every group. `createLabel` overrides the generic "New schedule" row
 * text (the breadcrumb passes "New schedule in <Project>"). Neither prop changes anything for an
 * existing caller that doesn't pass it.
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
 *
 * ⛔ B1404352 — RENAME AND DELETE, per row, when `onRename`/`onDelete` are passed in. Owner's own
 * live click-test on planyr.io found zero rename/remove affordance anywhere for a SCHEDULE (the
 * project breadcrumb's kebab only ever reaches the one schedule linked to the CURRENT project —
 * see B1358128/B1361681 — so a project's OTHER schedules, and every org-owned one, were
 * unreachable). This is that control, on every row this list already shows. No dialog boxes
 * (owner rule): rename swaps the row's label for an inline `<input>`; delete swaps the ROW for an
 * inline "Delete “name”? …" / Keep it / Delete confirmation, matching the shape
 * `SitePlansSection`'s kebab menu and `MapNoteEditor`'s delete row already use elsewhere in this
 * app, never a same-button relabel (B1389520's own lesson: growing a label in place can shift a
 * second click onto an adjacent control). A same-owner name collision WARNS, exactly like
 * creating a schedule does (`validateNewSchedule`) — he's allowed to name two schedules alike on
 * purpose; what he isn't allowed is to do it without knowing.
 *
 * ⛔ NEW-1 — RENAME/DUPLICATE/DELETE COLLAPSED INTO ONE KEBAB PER ROW (owner report, 2026-09-10,
 * measured live on Goose Creek: every row rendered THREE always-visible icon buttons — Rename,
 * Duplicate, Delete — twelve buttons on screen for four schedules, four of them a red trash icon
 * a short distance from the row click that opens a 305-task schedule. Verbatim: "we don't need
 * these options that visible, this should just be like three dots or something."). Each row now
 * renders ONE kebab trigger (`schedule-owner-kebab`) opening an `AnchoredMenu` with Rename /
 * Duplicate / a divider / Delete (styled destructive) — the same portal-menu idiom
 * `SitePlansSection`'s `OverlayRow` and `ProjectBreadcrumb`'s own per-row kebab already use
 * elsewhere in this app. The kebab is ALWAYS visible (not hover-revealed): `ProjectBreadcrumb`
 * already tried hover-reveal for this exact shape (its own NEW-2, B439) and reverted it — "it was
 * hover-revealed, which left touch and keyboard users with no rename at all" — so this starts from
 * that lesson rather than re-learning it; it costs nothing on this list, since it is one small
 * control per row rather than three. The rename/delete inline-edit and inline-confirm subtrees
 * (`editing`/`confirming` below) are UNCHANGED — only how you REACH Rename/Duplicate/Delete moved,
 * never what happens once you do. The label + task count are now ONE button spanning the row's
 * full width (`minWidth:0` flex-grow, same as before) so a click anywhere on the row besides the
 * kebab still switches schedules; the kebab's own `onClick` stops propagation so opening the menu
 * can never fire a row select as a side effect.
 */
import { useMemo, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";
import { MenuItem } from "../../../shared/ui/controls.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import {
  ORG_OWNER_LABEL, partitionSchedules, ownerKeyOf, nameCollision, normalizeName, describeScheduleDelete,
} from "../../../shared/schedule/scheduleOwnership.js";

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

// B1404352 — Rename/Delete icons, drawn in this app's own idiom (stroke, currentColor) rather
// than a text glyph or emoji — same reasoning as ProjectBreadcrumb.jsx's PencilIcon/TrashIcon,
// duplicated here rather than imported: that file's copies are module-private, and a shared
// icon module doesn't exist yet for this repo's handful of per-file drawn icons (see that
// file's own header note on the same choice for its OrgIcon).
const PencilIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M4 20h4L20 8l-4-4L4 16z" />
    <path d="M14.5 5.5L18.5 9.5" />
  </svg>
);
const TrashIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
// B1435888 — same drawn idiom, duplicated from ProjectBreadcrumb.jsx's own DuplicateIcon (module-
// private there too — see that file's own note on why there's no shared icon module yet). This is
// "Duplicate schedule", relocated here from the old flat project/schedule breadcrumb kebab: that
// menu's "Duplicate" row posted a SCHEDULE id, and once the breadcrumb's project level became a
// genuine, uncontrolled site-project switcher (B1435888) it had no schedule id to resolve any more
// — duplicating a schedule belongs on the schedule's own row, not the project's.
const DuplicateIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);
// NEW-1 — the per-row manage affordance, drawn (not a `⋯` text glyph — the platform font's own
// rendering) in this file's own idiom, same reasoning as ProjectBreadcrumb.jsx's KebabIcon.
const KebabIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
  </svg>
);

const iconBtn = {
  display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
  width: 22, height: 22, padding: 0, borderRadius: RADIUS.sm, border: "none",
  background: "none", cursor: "pointer", color: "var(--text-secondary)",
};
// NEW-1 — one row inside the kebab's dropdown: icon + label, the same shape SitePlansSection's
// OverlayRow menu items already use.
const menuItemRow = { display: "flex", alignItems: "center", gap: 6 };
const renameInput = {
  flex: "1 1 auto", minWidth: 0, padding: "3px 6px", borderRadius: RADIUS.sm,
  border: `1px solid ${ACCENT}`, outline: "none", background: "var(--surface-raised)",
  color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control,
};
const warningText = {
  display: "block", fontSize: FONT_SIZE.micro, color: "var(--warn-text)",
  padding: `2px ${SPACE.sm}px 0`, lineHeight: 1.4,
};
const confirmWrap = {
  display: "flex", flexDirection: "column", gap: SPACE.xs, width: "100%",
  padding: `${SPACE.sm}px ${SPACE.md}px`, borderRadius: RADIUS.md,
  border: "1px solid var(--danger)", background: "var(--hover-chrome)",
};
const confirmText = { fontSize: FONT_SIZE.control, color: "var(--text-primary)", lineHeight: 1.4 };
const confirmActions = { display: "flex", justifyContent: "flex-end", gap: SPACE.xs };
const confirmBtnBase = {
  cursor: "pointer", border: "none", borderRadius: RADIUS.sm,
  padding: "5px 10px", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700,
};
const confirmBtnGhost = { ...confirmBtnBase, background: "none", color: "var(--text-secondary)" };
const confirmBtnDanger = { ...confirmBtnBase, background: "var(--danger)", color: "var(--on-accent)" };

// A single schedule row — plain, editing (inline rename), or confirming (inline delete). Module
// scope (MODULE-SCOPE-COMPONENTS): defining this inside ScheduleOwnerList's render body would
// remount it, and a new type every render, every keystroke while a menu is open elsewhere.
function ScheduleRow({
  s, active, onSelect, canManage,
  editing, editVal, onEditValChange, onCommitRename, onCancelRename, onStartRename, editWarning,
  confirming, onStartConfirm, onCancelConfirm, onCommitDelete,
  onDuplicate,
}) {
  const label = s.name || "Untitled schedule";
  if (confirming) {
    return (
      <div style={confirmWrap} data-testid="schedule-owner-row-confirm" data-schedule-id={String(s.id)}>
        <div style={confirmText}>{describeScheduleDelete(s.name, s.taskCount)}</div>
        <div style={confirmActions}>
          <button type="button" data-testid="schedule-owner-delete-cancel" onClick={onCancelConfirm} style={confirmBtnGhost}>
            Keep it
          </button>
          <button type="button" data-testid="schedule-owner-delete-confirm" onClick={onCommitDelete} style={confirmBtnDanger}>
            Delete
          </button>
        </div>
      </div>
    );
  }
  if (editing) {
    return (
      <div style={{ ...rowBase, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 0 }} data-testid="schedule-owner-row-editing" data-schedule-id={String(s.id)}>
        <input
          autoFocus
          value={editVal}
          onChange={(e) => onEditValChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onCommitRename(); }
            else if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
          }}
          onBlur={onCommitRename}
          aria-label={`Rename “${label}”`}
          data-testid="schedule-owner-rename-input"
          style={renameInput}
        />
        {editWarning && <span style={warningText}>{editWarning}</span>}
      </div>
    );
  }
  return (
    <ScheduleRowResting
      s={s} active={active} onSelect={onSelect} canManage={canManage} label={label}
      onStartRename={onStartRename} onDuplicate={onDuplicate} onStartConfirm={onStartConfirm}
    />
  );
}

// NEW-1 — the resting (not editing/confirming) row, split out so its own `menuOpen`/kebab-anchor
// state (below) doesn't have to be threaded through ScheduleRow's editing/confirming branches,
// which never need it. Module scope (MODULE-SCOPE-COMPONENTS) — same reasoning as ScheduleRow
// itself: an inline function here would remount on every parent render.
function ScheduleRowResting({ s, active, onSelect, canManage, label, onStartRename, onDuplicate, onStartConfirm }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const kebabRef = useRef(null);
  const hasDivider = !!(onStartConfirm && (onStartRename || onDuplicate));
  return (
    <div
      data-testid="schedule-owner-row"
      data-schedule-id={String(s.id)}
      style={{ ...rowBase, cursor: "default", padding: `${SPACE.xs}px ${SPACE.sm}px ${SPACE.xs}px ${SPACE.md}px` }}
    >
      {/* NEW-1 — the label AND the task count are now ONE button spanning the row (flex-grow),
          so a click anywhere on the row besides the kebab switches schedules — not just a click
          landing exactly on the name text. */}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect?.(s.id)}
        style={{
          all: "unset", boxSizing: "border-box", cursor: "pointer", flex: "1 1 auto", minWidth: 0,
          display: "flex", alignItems: "center", gap: SPACE.xs,
        }}
      >
        <span style={{
          fontWeight: active ? 600 : 400, color: active ? ACCENT : "inherit", minWidth: 0, flex: "1 1 auto",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </span>
        {/* B1435888 — the task count, right-aligned beside the name (the breadcrumb's own
            dropdown asked for this; shown here for every caller since it's a small, harmless
            addition and the header's "Schedules" panel benefits from the same at-a-glance
            count). Absent entirely when the embedded app hasn't reported a count for this row
            (sanitizeProjects only carries `taskCount` when the bridge sent one) — never a
            fabricated 0. */}
        {s.taskCount != null && (
          <span style={{ flex: "none", fontSize: FONT_SIZE.micro, color: "var(--text-tertiary)" }}>
            {s.taskCount}
          </span>
        )}
      </button>
      {/* NEW-1 — ONE kebab per row, replacing the three always-visible Rename/Duplicate/Delete
          icon buttons (owner report: "twelve buttons on screen at once, four of them
          destructive"). ALWAYS visible (never hover-revealed — see this file's header note on
          why) so it works identically on a mouse, a touchscreen laptop, and via keyboard focus.
          `stopPropagation` on the trigger's own click keeps opening the menu from ever also
          firing the row's onSelect. */}
      {canManage && (
        <div style={{ position: "relative", flex: "none" }}>
          <button
            type="button"
            ref={kebabRef}
            data-testid="schedule-owner-kebab"
            title={`More actions for “${label}”`}
            aria-label={`More actions for “${label}”`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            style={{
              ...iconBtn,
              background: menuOpen ? "var(--hover-ghost)" : "transparent",
              color: menuOpen ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <KebabIcon />
          </button>
          {/* ⛔ B1358128/B735 — a SECOND portal layer, stacked ABOVE this list's own host menu
              (`ScheduleCrumb`'s dropdown, zIndex 4000 default) when this list is nested inside
              one: without a HIGHER declared zIndex, AnchoredMenu's own document-level dismiss
              listener (menuLayers.js's `pressBelongsToHigherMenu`) cannot tell this menu apart
              from "a press outside" and closes the PARENT dropdown mid-click — which unmounts
              this whole subtree before the click finishes, silently swallowing Rename/Duplicate/
              Delete. Same fix, same reasoning as ProjectBreadcrumb.jsx's own per-row kebab
              (zIndex 5000 against its dropdown's 4000) — matched here so the two nest the same
              way regardless of which menu wraps this list. */}
          <AnchoredMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={kebabRef} placement="below-right" width={168} zIndex={5000}>
            {onStartRename && (
              <MenuItem data-testid="schedule-owner-rename" title={`Rename “${label}”`} aria-label={`Rename “${label}”`}
                onClick={() => { setMenuOpen(false); onStartRename(s); }} style={menuItemRow}>
                <PencilIcon />Rename
              </MenuItem>
            )}
            {onDuplicate && (
              <MenuItem data-testid="schedule-owner-duplicate" title={`Duplicate “${label}”`} aria-label={`Duplicate “${label}”`}
                onClick={() => { setMenuOpen(false); onDuplicate(s.id); }} style={menuItemRow}>
                <DuplicateIcon />Duplicate
              </MenuItem>
            )}
            {hasDivider && <div style={divider} />}
            {onStartConfirm && (
              <MenuItem data-testid="schedule-owner-delete" title={`Delete “${label}”`} aria-label={`Delete “${label}”`}
                onClick={() => { setMenuOpen(false); onStartConfirm(s); }} style={{ ...menuItemRow, color: "var(--danger-text)" }}>
                <TrashIcon />Delete
              </MenuItem>
            )}
          </AnchoredMenu>
        </div>
      )}
    </div>
  );
}

function Group({ title, schedules, activeId, onSelect, emptyText, manage }) {
  if (!schedules.length && !emptyText) return null;
  const canManage = !!(manage && (manage.onStartRename || manage.onStartConfirm || manage.onDuplicate));
  return (
    <>
      <div style={heading}>{title}</div>
      {schedules.length === 0
        ? <div style={emptyNote}>{emptyText}</div>
        : schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              s={s}
              active={s.id === activeId}
              onSelect={onSelect}
              canManage={canManage}
              editing={manage?.editingId === s.id}
              editVal={manage?.editVal ?? ""}
              editWarning={manage?.editingId === s.id ? manage?.editWarning : null}
              onEditValChange={manage?.onEditValChange}
              onCommitRename={() => manage?.onCommitRename(s)}
              onCancelRename={manage?.onCancelRename}
              onStartRename={manage?.onStartRename}
              confirming={manage?.confirmId === s.id}
              onStartConfirm={manage?.onStartConfirm}
              onCancelConfirm={manage?.onCancelConfirm}
              onCommitDelete={() => manage?.onCommitDelete(s)}
              onDuplicate={manage?.onDuplicate}
            />
          ))}
    </>
  );
}

export default function ScheduleOwnerList({
  schedules = [], activeId = null, siteId = null, siteName = null, onSelect,
  // Optional — the header dropdown (ScheduleSwitcher) passes this; Scheduler.jsx's empty-state
  // call site does not (that surface already offers Create/Link via LinkSchedulePanel). See this
  // file's own header, B1397568.
  onCreate,
  // B1404352 — optional, independently: rename a schedule (id, newName) or delete one (id).
  // Neither call site is required to wire both — matches onCreate's own pattern, and keeps a
  // future read-only listing possible without a dead prop.
  onRename, onDelete,
  // B1435888 — optional, independently again: duplicate a schedule (id). Relocated here from the
  // old project/schedule breadcrumb kebab — see this file's own header note above the imports and
  // DuplicateIcon's note.
  onDuplicate,
  showOther = true,
  createLabel = "New schedule",
}) {
  const { here, org, elsewhere } = useMemo(() => partitionSchedules(schedules, siteId), [schedules, siteId]);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  const startRename = (s) => { setConfirmId(null); setEditingId(s.id); setEditVal(s.name || ""); };
  const cancelRename = () => setEditingId(null);
  const commitRename = (s) => {
    const v = (editVal || "").trim();
    setEditingId(null);
    if (!v || v === s.name) return; // empty or unchanged — keep the prior name, no-op
    onRename?.(s.id, v);
  };
  const startConfirm = (s) => { setEditingId(null); setConfirmId(s.id); };
  const cancelConfirm = () => setConfirmId(null);
  const commitDelete = (s) => { setConfirmId(null); onDelete?.(s.id); };

  // A same-owner name collision WARNS, live, exactly like creating a schedule does
  // (validateNewSchedule) — never blocks: he's allowed to name two schedules alike on purpose.
  const editingSchedule = editingId != null ? schedules.find((p) => p && p.id === editingId) : null;
  const editWarning = editingSchedule && nameCollision(schedules, ownerKeyOf(editingSchedule), editVal, editingId)
    ? `There is already a schedule called “${normalizeName(editVal)}” here.`
    : null;

  const manage = (onRename || onDelete || onDuplicate) ? {
    editingId, editVal, editWarning,
    onEditValChange: setEditVal,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onStartRename: onRename ? startRename : undefined,
    confirmId,
    onStartConfirm: onDelete ? startConfirm : undefined,
    onCancelConfirm: cancelConfirm,
    onCommitDelete: commitDelete,
    onDuplicate,
  } : null;

  return (
    <div style={wrap} data-testid="schedule-owner-list">
      {siteId != null && (
        <Group
          title={siteName || "This project"}
          schedules={here}
          activeId={activeId}
          onSelect={onSelect}
          emptyText="No schedules here yet."
          manage={manage}
        />
      )}
      <Group title={ORG_OWNER_LABEL} schedules={org} activeId={activeId} onSelect={onSelect} manage={manage} />
      {showOther && <Group title="Other projects" schedules={elsewhere} activeId={activeId} onSelect={onSelect} manage={manage} />}
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
            <span>{createLabel}</span>
          </button>
        </>
      )}
    </div>
  );
}
