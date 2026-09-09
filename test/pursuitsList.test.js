import { describe, it, expect } from "vitest";
import {
  nextContractualDate, pursuitsTable, quietDaysByGroupFromRecency, quietDaysByGroupFromRows, nextLineTone, isQuietEmphasized,
  allPursuitsUndated,
} from "../src/workspaces/dashboard/lib/pursuitsList.js";

const NOW = new Date(2026, 8, 6).getTime(); // Sep 6, 2026, local midnight

describe("nextContractualDate", () => {
  it("picks the SOONEST upcoming of the three fields", () => {
    const p = { feasibilityExpiry: "2026-09-20", loiDate: "2026-09-12", closingDate: "2026-11-01" };
    expect(nextContractualDate(p, NOW)).toEqual({ label: "LOI response due", date: "2026-09-12", days: 6 });
  });

  it("ignores a date that has already passed", () => {
    const p = { feasibilityExpiry: "2026-08-01", loiDate: null, closingDate: "2026-10-01" };
    expect(nextContractualDate(p, NOW)).toEqual({ label: "Closing", date: "2026-10-01", days: expect.any(Number) });
  });

  it("returns null when nothing is set or everything has passed", () => {
    expect(nextContractualDate({}, NOW)).toBe(null);
    expect(nextContractualDate({ feasibilityExpiry: "2020-01-01" }, NOW)).toBe(null);
  });
});

describe("pursuitsTable", () => {
  const base = { role: "pursuit", status: "active" };
  it("sorts ascending by soonest upcoming date; undated sorts to the bottom", () => {
    const projects = [
      { ...base, groupId: "a", name: "Undated", county: "harris" },
      { ...base, groupId: "b", name: "Soon", county: "harris", loiDate: "2026-09-10" },
      { ...base, groupId: "c", name: "Later", county: "harris", closingDate: "2026-12-01" },
    ];
    const rows = pursuitsTable(projects, {}, { nowMs: NOW });
    expect(rows.map((r) => r.name)).toEqual(["Soon", "Later", "Undated"]);
  });

  it("never lets quiet time drive the sort — a stale-but-dated pursuit still outranks an undated one, and a near-deadline pursuit beats a quiet one", () => {
    const projects = [
      { ...base, groupId: "quiet", name: "Quiet but dated", county: "harris", closingDate: "2026-10-01" },
      { ...base, groupId: "fresh", name: "Fresh but undated", county: "harris" },
      { ...base, groupId: "urgent", name: "Near deadline", county: "harris", loiDate: "2026-09-08" },
    ];
    const quietDaysByGroup = { quiet: 400, fresh: 0, urgent: 0 };
    const rows = pursuitsTable(projects, quietDaysByGroup, { nowMs: NOW });
    // The near-deadline pursuit leads despite no quiet signal; the quiet-but-dated one still
    // outranks the undated one even though it's the "staler" of the two by quiet time.
    expect(rows.map((r) => r.name)).toEqual(["Near deadline", "Quiet but dated", "Fresh but undated"]);
  });

  it("excludes tracked records and settled stages (complete/dead)", () => {
    const projects = [
      { ...base, groupId: "a", name: "Tracked", role: "tracked", loiDate: "2026-09-08" },
      { ...base, groupId: "b", name: "Dead deal", status: "dead", loiDate: "2026-09-08" },
      { ...base, groupId: "c", name: "Live pursuit", loiDate: "2026-09-08" },
    ];
    const rows = pursuitsTable(projects, {}, { nowMs: NOW });
    expect(rows.map((r) => r.name)).toEqual(["Live pursuit"]);
  });

  it("carries the quietDays value through per row without using it for sorting", () => {
    const projects = [{ ...base, groupId: "a", name: "P", loiDate: "2026-09-08" }];
    const rows = pursuitsTable(projects, { a: 42 }, { nowMs: NOW });
    expect(rows[0].quietDays).toBe(42);
  });

  it("handles empty/missing input without throwing", () => {
    expect(pursuitsTable(null, null)).toEqual([]);
    expect(pursuitsTable([], {})).toEqual([]);
  });

  // B1407824 — the Pursuit column shortens a long name at this pure model layer rather than
  // leaving it to the cell's own CSS clamp (which has no idea where a comma/period/hyphen sits).
  // See test/projects.test.js for shortenDisplayName's own case table; this just proves the wire.
  it("shortens a long pursuit name, never on a dangling comma", () => {
    const projects = [{ ...base, groupId: "a", name: "ALUMAX RD, NASHVILLE, TX 75569", county: "bowie" }];
    const rows = pursuitsTable(projects, {}, { nowMs: NOW });
    expect(rows[0].name.length).toBeLessThan("ALUMAX RD, NASHVILLE, TX 75569".length);
    expect(rows[0].name).not.toMatch(/[,.\-\s]…$/);
    expect(rows[0].name.endsWith("…")).toBe(true);
  });

  // B1407824 — the exact reported production case: the stored name FITS under the Pursuit
  // column's own limit (nothing to cut for space), but itself dangles on a bare trailing comma.
  it("cleans a short name that itself dangles on a comma, even though nothing needed cutting for space", () => {
    const projects = [{ ...base, groupId: "a", name: "ALUMAX RD, NASH,", county: "bowie" }];
    const rows = pursuitsTable(projects, {}, { nowMs: NOW });
    expect(rows[0].name).toBe("ALUMAX RD, NASH");
  });

  // B1411504 — confirmed on the owner's real portfolio: every open pursuit has all three
  // contractual-date fields unset, so `next` is null on every row and the OLD comparator's
  // `ad==null && bd==null → return 0` left Array.sort's stability to present raw insertion order
  // as if it were a sort. A sort keyed on a value no row has must not present an arbitrary order
  // as meaningful — this asserts the fallback is a REAL, defensible order (alphabetical), not
  // whatever order the caller happened to hand in.
  it("undated-vs-undated ties break ALPHABETICALLY, never insertion order (no arbitrary sort)", () => {
    const projects = [
      { ...base, groupId: "z", name: "Zebra Site", county: "harris" },
      { ...base, groupId: "a", name: "Alpha Site", county: "harris" },
      { ...base, groupId: "m", name: "Mid Site", county: "harris" },
    ];
    const rows = pursuitsTable(projects, {}, { nowMs: NOW });
    expect(rows.map((r) => r.name)).toEqual(["Alpha Site", "Mid Site", "Zebra Site"]);
  });

  it("still never lets quiet time decide the undated tie-break", () => {
    const projects = [
      { ...base, groupId: "z", name: "Zebra Site", county: "harris" },
      { ...base, groupId: "a", name: "Alpha Site", county: "harris" },
    ];
    // Zebra is far quieter (staler) than Alpha; alphabetical order must still win.
    const rows = pursuitsTable(projects, { z: 400, a: 0 }, { nowMs: NOW });
    expect(rows.map((r) => r.name)).toEqual(["Alpha Site", "Zebra Site"]);
  });
});

describe("allPursuitsUndated", () => {
  it("true only when every row lacks a next date", () => {
    expect(allPursuitsUndated([{ next: null }, { next: null }])).toBe(true);
  });
  it("false when at least one row has a date", () => {
    expect(allPursuitsUndated([{ next: null }, { next: { days: 3 } }])).toBe(false);
  });
  it("false for an empty list — a distinct, already-handled empty state", () => {
    expect(allPursuitsUndated([])).toBe(false);
  });
});

describe("quietDaysByGroupFromRecency", () => {
  it("converts ms timestamps to whole days since now", () => {
    const msByGroup = { a: NOW - 5 * 86400000, b: NOW };
    expect(quietDaysByGroupFromRecency(msByGroup, NOW)).toEqual({ a: 5, b: 0 });
  });
  it("skips a null/missing entry rather than producing NaN", () => {
    expect(quietDaysByGroupFromRecency({ a: null }, NOW)).toEqual({});
  });
});

describe("quietDaysByGroupFromRows", () => {
  const iso = (n) => new Date(NOW - n * 86400000).toISOString();

  it("uses the LATEST real element edit per plan, maxed across every plan in a group", () => {
    const elementRecencyRows = [
      { site_id: "p1", updated_at: iso(20) },
      { site_id: "p1", updated_at: iso(3) },  // p1's real latest edit: 3 days ago
      { site_id: "p2", updated_at: iso(9) },  // sibling plan in the SAME group, older edit
    ];
    const siteRows = [
      { id: "p1", group_id: "g1", updated_at: iso(3) },
      { id: "p2", group_id: "g1", updated_at: iso(9) },
    ];
    expect(quietDaysByGroupFromRows(elementRecencyRows, siteRows, NOW)).toEqual({ g1: 3 });
  });

  it("a plan with NO live element rows falls back to its own header updated_at (a real, if coarser, fact)", () => {
    const siteRows = [{ id: "p1", group_id: "g1", updated_at: iso(14) }];
    expect(quietDaysByGroupFromRows([], siteRows, NOW)).toEqual({ g1: 14 });
  });

  it("opening a plan without editing it never resets this — no new element row means no change", () => {
    const elementRecencyRows = [{ site_id: "p1", updated_at: iso(30) }];
    const siteRows = [{ id: "p1", group_id: "g1", updated_at: iso(0) }]; // header touched by merely opening it
    // The real edit (30 days ago) wins over the header's "just now" — opening/viewing is not editing.
    expect(quietDaysByGroupFromRows(elementRecencyRows, siteRows, NOW)).toEqual({ g1: 30 });
  });

  it("handles empty/missing input without throwing", () => {
    expect(quietDaysByGroupFromRows([], [])).toEqual({});
    expect(quietDaysByGroupFromRows(null, null)).toEqual({});
  });
});

describe("nextLineTone", () => {
  it("red under 7 days, accent under 14, muted beyond and when undated", () => {
    expect(nextLineTone(3)).toBe("danger");
    expect(nextLineTone(6)).toBe("danger");
    expect(nextLineTone(7)).toBe("accent");
    expect(nextLineTone(13)).toBe("accent");
    expect(nextLineTone(14)).toBe("muted");
    expect(nextLineTone(30)).toBe("muted");
    expect(nextLineTone(null)).toBe("muted");
  });
});

describe("isQuietEmphasized", () => {
  it("emphasizes at/after 10 days, not before", () => {
    expect(isQuietEmphasized(9)).toBe(false);
    expect(isQuietEmphasized(10)).toBe(true);
    expect(isQuietEmphasized(null)).toBe(false);
  });
});
