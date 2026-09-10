/* PursuitsCard — the Dashboard's "Pursuits" card (B1161793, NEW-2, Direction C's second real
 * content card — replacing the placeholder "Pursuits by activity" card, per the owner's
 * approved design). A table of open pursuits.
 *
 * Columns, left to right: Pursuit (name, county underneath) / Yield / Quiet for. Acres was
 * explicitly dropped early in this card's design ("Yield is what he compares two deals on;
 * acreage is a detail you look up once you are inside the deal").
 *
 * ⛔ B1342848 (owner instruction, 2026-09-09: "remove the deal date from pursuits") — the "Next"
 * column (the nearest contractual-date field + countdown) and its sort are gone; see
 * pursuitsList.js's header for why and for what this supersedes. The table now sorts
 * alphabetically, unconditionally, so there's no "no deal dates set yet" banner to show either —
 * an alphabetical list needs no disclaimer the way a fallback pretending to be a date sort did.
 */
import { isQuietEmphasized } from "../lib/pursuitsList.js";

const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const dayWord = (n) => (n === 1 ? "day" : "days");

const thStyle = (align) => ({
  textAlign: align, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--text-secondary)", padding: "0 8px 6px 0", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap",
});
const tdStyle = (align) => ({
  textAlign: align, padding: "7px 8px 7px 0", borderBottom: "1px solid var(--border-default)", verticalAlign: "top",
});

function formatSf(sqft) {
  if (!sqft) return "—";
  return `${Math.round(sqft).toLocaleString()} SF`;
}

function QuietCell({ days }) {
  if (days == null) return <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>—</span>;
  const emphasized = isQuietEmphasized(days);
  return (
    <span style={{ fontSize: emphasized ? 13 : 12, fontWeight: emphasized ? 700 : 500, color: emphasized ? "var(--text-primary)" : "var(--text-secondary)" }}>
      {days} {dayWord(days)}
    </span>
  );
}

export function PursuitsCard({ rows, yieldBySite, onOpenProject }) {
  if (!rows || !rows.length) return <div style={EMPTY}>No open pursuits right now.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Pursuit</th>
            <th style={thStyle("right")}>Yield</th>
            <th style={thStyle("right")}>Quiet for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.groupId}
              onClick={() => onOpenProject?.(r)}
              role={onOpenProject ? "button" : undefined}
              tabIndex={onOpenProject ? 0 : undefined}
              onKeyDown={onOpenProject ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenProject(r); } } : undefined}
              style={{ cursor: onOpenProject ? "pointer" : "default" }}
            >
              <td style={tdStyle("left")}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{r.name}</div>
                {r.county && <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>{r.county}</div>}
              </td>
              <td style={{ ...tdStyle("right"), fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{formatSf(yieldBySite?.[r.siteId])}</td>
              <td style={{ ...tdStyle("right"), whiteSpace: "nowrap" }}><QuietCell days={r.quietDays} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
