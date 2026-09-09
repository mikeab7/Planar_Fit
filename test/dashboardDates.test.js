import { describe, it, expect } from "vitest";
import { formatShortDate, daysUntil, shortAge, spanWords, dayKey, dayDividerLabel } from "../src/workspaces/dashboard/lib/dashboardDates.js";

describe("formatShortDate", () => {
  it("formats a plain YYYY-MM-DD date without a timezone shift", () => {
    expect(formatShortDate("2026-09-10")).toBe(new Date(2026, 8, 10).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });
  it("returns null for empty/unparseable input", () => {
    expect(formatShortDate(null)).toBe(null);
    expect(formatShortDate("")).toBe(null);
    expect(formatShortDate("not a date")).toBe(null);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days from now to a future date", () => {
    const now = new Date(2026, 8, 1, 15, 30).getTime(); // Sep 1, mid-afternoon
    expect(daysUntil("2026-09-08", now)).toBe(7);
  });
  it("returns a negative count for a past date", () => {
    const now = new Date(2026, 8, 10).getTime();
    expect(daysUntil("2026-09-01", now)).toBe(-9);
  });
  it("returns null for empty/unparseable input", () => {
    expect(daysUntil(null)).toBe(null);
    expect(daysUntil("nope")).toBe(null);
  });
});

describe("shortAge", () => {
  const now = new Date(2026, 8, 8, 12, 0, 0).getTime();
  it("renders the short (single-letter-unit) forms", () => {
    expect(shortAge(now - 5 * 60000, now)).toBe("5m");
    expect(shortAge(now - 3 * 3600000, now)).toBe("3h");
    expect(shortAge(now - 2 * 86400000, now)).toBe("2d");
    expect(shortAge(now - 20 * 86400000, now)).toBe("2w");
  });
  it("renders a calendar date past ~2 months", () => {
    const ms = now - 90 * 86400000;
    expect(shortAge(ms, now)).toBe(new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  });
  it("returns '' for empty/unparseable input", () => {
    expect(shortAge(null, now)).toBe("");
    expect(shortAge(0, now)).toBe("");
  });
});

describe("spanWords", () => {
  const now = new Date(2026, 8, 8, 12, 0, 0).getTime();
  it("uses idiomatic singulars", () => {
    expect(spanWords(now - 60000, now)).toBe("a minute");
    expect(spanWords(now - 3600000, now)).toBe("an hour");
    expect(spanWords(now - 86400000, now)).toBe("a day");
    expect(spanWords(now - 7 * 86400000, now)).toBe("a week");
  });
  it("uses plural digit counts beyond one", () => {
    expect(spanWords(now - 2 * 3600000, now)).toBe("2 hours");
    expect(spanWords(now - 21 * 86400000, now)).toBe("3 weeks");
  });
  it("falls back to 'a while' for empty/unparseable input", () => {
    expect(spanWords(null, now)).toBe("a while");
  });
});

describe("dayKey / dayDividerLabel", () => {
  it("keys by the LOCAL calendar day, not UTC", () => {
    const lateEvening = new Date(2026, 8, 8, 23, 30).getTime();
    expect(dayKey(lateEvening)).toBe("2026-09-08");
  });
  it("labels today/yesterday, uppercase elsewhere", () => {
    const now = new Date(2026, 8, 8, 12, 0).getTime();
    expect(dayDividerLabel(now, now)).toBe("TODAY");
    expect(dayDividerLabel(now - 86400000, now)).toBe("YESTERDAY");
    const older = new Date(2026, 8, 1, 9, 0).getTime();
    expect(dayDividerLabel(older, now)).toBe(dayDividerLabel(older, now).toUpperCase());
  });
});
