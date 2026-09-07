/* DashboardCard — the one card shell every Dashboard card renders inside (B1213313, NEW-1
 * arrangeable-grid rework). Resting state is clean (just a title); Customize mode reveals a drag
 * handle (the title row only — not the card body, so a card with a scrollable list stays
 * scrollable) and a remove control. The resize affordance (drag the bottom-right corner) is
 * react-grid-layout's own doing, painted on the grid-item wrapper this card fills — see
 * Dashboard.jsx's own note on why that wrapper (a plain `<div>`, not this component) is the
 * element react-grid-layout positions and clones a resize handle onto.
 *
 * `showDragHandle` is separate from `customizing`: on a narrow/single-column layout (Dashboard.jsx
 * renders a plain stack there, no react-grid-layout at all — "don't let a phone drag-resize a
 * grid it cannot see") Customize mode still needs to work for remove/add/reset, but there is no
 * drag gesture to offer, so the grip glyph and grab cursor are left off.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { IconButton } from "../../../shared/ui/controls.jsx";

export default function DashboardCard({ title, customizing, showDragHandle = true, onRemove, children }) {
  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        background: "var(--surface-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <span
          className={showDragHandle ? "dashboard-card-drag-handle" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: customizing && showDragHandle ? "grab" : "default" }}
        >
          {customizing && showDragHandle && (
            <span aria-hidden="true" title="Drag to reorder" style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1, flex: "none" }}>⠿⠿</span>
          )}
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
        </span>
        {customizing && (
          <IconButton size={22} onClick={onRemove} title="Remove this card">
            <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
          </IconButton>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
