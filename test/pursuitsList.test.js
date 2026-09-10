import { describe, it, expect } from "vitest";
import {
  pursuitsTable, quietDaysByGroupFromRecency, quietDaysByGroupFromRows, isQuietEmphasized,
} from "../src/workspaces/dashboard/lib/pursuitsList.js";

const NOW = new Date(2026, 8, 6).getTime(); // Sep 6, 2026, local midnight

// B1342848 (owner instruction, 2026-09-09: "remove the deal date from pursuits") — the card's
// "Next" column and its soonest-contractual-date sort are gone; see pursuitsList.js's header.
// The table now sorts alphabetically, unconditionally, and no longer reads/returns any
// contractual-date field at all — these cases replace the pre-removal sort suite.
describe("pursuitsTable", () => {
  const base = { role: "pursuit", status: "active" };

  it("sorts alphabetically by name", () => {
    const projects = [
      { ...base, groupId: "z", name: "Zebra Site", county: "harris" },
      { ...base, groupId: "a", name: "Alpha Site", county: "harris" },
      { ...base, groupId: "m", name: "Mid Site", county: "harris" },
    ];
    const rows = pursuitsTable(projects, {});
    expect(rows.map((r) => r.name)).toEqual(["Alpha Site", "Mid Site", "Zebra Site"]);
  });

  // Quiet time is real, available, and deliberately NOT the sort — the owner explicitly rejected
  // quiet-first ordering when this card was designed ("I don't know that something that's been
  // quiet the longest should really be the one at the top"). Alphabetical order must win
  // regardless of how stale a row is.
  it("never lets quiet time drive the sort", () => {
    const projects = [
      { ...base, groupId: "z", name: "Zebra Site", county: "harris" },
      { ...base, groupId: "a", name: "Alpha Site", county: "harris" },
    ];
    const rows = pursuitsTable(projects, { z: 400, a: 0 }); // Zebra is far quieter (staler) than Alpha
    expect(rows.map((r) => r.name)).toEqual(["Alpha Site", "Zebra Site"]);
  });

  it("excludes tracked records and settled stages (complete/dead)", () => {
    const projects = [
      { ...base, groupId: "a", name: "Tracked", role: "tracked" },
      { ...base, groupId: "b", name: "Dead deal", status: "dead" },
      { ...base, groupId: "c", name: "Live pursuit" },
    ];
    const rows = pursuitsTable(projects, {});
    expect(rows.map((r) => r.name)).toEqual(["Live pursuit"]);
  });

  it("carries the quietDays value through per row without using it for sorting", () => {
    const projects = [{ ...base, groupId: "a", name: "P" }];
    const rows = pursuitsTable(projects, { a: 42 });
    expect(rows[0].quietDays).toBe(42);
  });

  it("never returns a contractual-date field on a row", () => {
    const projects = [{ ...base, groupId: "a", name: "P", feasibilityExpiry: "2026-09-20" }];
    const rows = pursuitsTable(projects, {});
    expect(rows[0]).not.toHaveProperty("next");
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
    const rows = pursuitsTable(projects, {});
    expect(rows[0].name.length).toBeLessThan("ALUMAX RD, NASHVILLE, TX 75569".length);
    expect(rows[0].name).not.toMatch(/[,.\-\s]…$/);
    expect(rows[0].name.endsWith("…")).toBe(true);
  });

  // B1407824 — the exact reported production case: the stored name FITS under the Pursuit
  // column's own limit (nothing to cut for space), but itself dangles on a bare trailing comma.
  it("cleans a short name that itself dangles on a comma, even though nothing needed cutting for space", () => {
    const projects = [{ ...base, groupId: "a", name: "ALUMAX RD, NASH,", county: "bowie" }];
    const rows = pursuitsTable(projects, {});
    expect(rows[0].name).toBe("ALUMAX RD, NASH");
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

describe("isQuietEmphasized", () => {
  it("emphasizes at/after 10 days, not before", () => {
    expect(isQuietEmphasized(9)).toBe(false);
    expect(isQuietEmphasized(10)).toBe(true);
    expect(isQuietEmphasized(null)).toBe(false);
  });
});
