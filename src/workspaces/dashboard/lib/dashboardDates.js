/* dashboardDates — tiny shared date-formatting helpers for the Needs-attention and Pursuits
 * cards (B1161792/B1161793, NEW-1/NEW-2). Split out because both cards need to print a
 * plain-date field ("YYYY-MM-DD", as the Scheduler and the site model both store dates) as a
 * short label without a timezone-shift bug — `new Date("2026-09-10")` parses as UTC midnight,
 * which prints as the PREVIOUS day in any timezone west of UTC. Parsing the three numeric parts
 * and constructing a local `Date` avoids that entirely.
 */

/** "2026-09-10" → "Sep 10" (or null for anything unparseable/empty). */
export function formatShortDate(isoDate) {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole calendar days from `nowMs` to `isoDate` (negative = in the past). Null when unparseable. */
export function daysUntil(isoDate, nowMs = Date.now()) {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (Number.isNaN(target)) return null;
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((target - startOfToday.getTime()) / 86400000);
}

const MIN_MS = 60000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** A row's own age, in the SHORT form ("12m" · "5h" · "3d" · "6w" · "2 Jul") — the "Since you were
 * last here" card's per-row right-aligned label (B1366384, NEW-1). Coarse on purpose: this is a
 * scanning surface, not a log. `null`/unparseable → "". */
export function shortAge(ms, nowMs = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = Math.max(0, nowMs - ms);
  if (d < MIN_MS) return "now";
  if (d < HOUR_MS) return `${Math.floor(d / MIN_MS)}m`;
  if (d < DAY_MS) return `${Math.floor(d / HOUR_MS)}h`;
  if (d < WEEK_MS) return `${Math.floor(d / DAY_MS)}d`;
  if (d < 60 * DAY_MS) return `${Math.floor(d / WEEK_MS)}w`;
  try {
    const then = new Date(ms);
    const sameYear = then.getFullYear() === new Date(nowMs).getFullYear();
    return then.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  } catch (_) { return ""; }
}

/** The card HEADER's span — plain English, no digits crowd, idiomatic singular ("a minute" / "an
 * hour" / "a day" / "a week"), never abbreviated. This is the ONE number the card admits to
 * showing (root CLAUDE.md's "never quote measurements in chat" is about Michael-facing prose, not
 * this — an elapsed span IS the point of this card's header — but it still reads as a sentence,
 * never a raw duration). Beyond ~2 months it falls back to a calendar date, same shape as
 * `shortAge`. `null`/unparseable → "a while". */
export function spanWords(ms, nowMs = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return "a while";
  const d = Math.max(0, nowMs - ms);
  const MONTH_MS = 30 * DAY_MS;
  // "hour" starts with a silent h ("an hour"); every other word here takes the plain article.
  const plural = (n, word) => (n === 1 ? `a${word === "hour" ? "n" : ""} ${word}` : `${n} ${word}s`);
  if (d < 90000) return "a minute";
  if (d < HOUR_MS) return plural(Math.max(1, Math.round(d / MIN_MS)), "minute");
  if (d < DAY_MS) return plural(Math.max(1, Math.round(d / HOUR_MS)), "hour");
  if (d < WEEK_MS) return plural(Math.max(1, Math.round(d / DAY_MS)), "day");
  if (d < MONTH_MS) return plural(Math.max(1, Math.round(d / WEEK_MS)), "week");
  if (d < 2 * MONTH_MS) return plural(Math.max(1, Math.round(d / MONTH_MS)), "month");
  try {
    const then = new Date(ms);
    const sameYear = then.getFullYear() === new Date(nowMs).getFullYear();
    return then.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  } catch (_) { return "a while"; }
}

/** Local-calendar-day key ("2026-09-08") for grouping feed rows under day dividers — never UTC,
 * which would misfile anything near midnight for anyone west of UTC (the same bug `formatShortDate`
 * above already avoids). */
export function dayKey(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "TODAY" · "YESTERDAY" · "MON, SEP 8" (uppercase, for the feed's quiet day dividers) — computed
 * against the LOCAL calendar day, not a 24h rolling window, so a divider always lines up with a
 * real midnight the way a person thinks about "yesterday". */
export function dayDividerLabel(ms, nowMs = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const key = dayKey(ms);
  if (key === dayKey(nowMs)) return "TODAY";
  if (key === dayKey(nowMs - DAY_MS)) return "YESTERDAY";
  try {
    return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  } catch (_) { return key; }
}
