/* relativeTime — a short "how long ago" string, down to minutes (NEW-1, 2026-09-08). Distinct
 * from DashboardCards.jsx's own day/month-only `relativeDays`: the Recent Plans card's timestamp
 * line is the one place on this screen a plan saved moments ago needs to read as more recent than
 * "today".
 */
export function relativeTimeShort(iso, nowMs = Date.now()) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Math.max(0, nowMs - then);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.round(day / 30);
  return month <= 1 ? "1mo ago" : `${month}mo ago`;
}
