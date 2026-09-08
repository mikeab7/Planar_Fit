/* mapNotes — the pure map-note model (NEW-1).
 *
 * Covers the three things a map note must get right and a comp already does: the row round-trip
 * (same anchor columns, same nullability), the validation that refuses an unsaveable note in
 * sentences rather than a Postgres constraint name, and the headline that can never be empty.
 *
 * Plus the ONE rule that separates a note from a comp, asserted rather than commented: nothing in
 * this module can produce, request or imply an owning site — B843792 makes every comp acquire one,
 * materializing a new tracked site when nothing matches, and a note must never do that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  rowToMapNote, mapNoteToRow, emptyMapNote, mapNoteHeadline, mapNoteHasText,
  validateMapNote, sortMapNotesByRecency, NOTE_TITLE_MAX, NOTE_BODY_MAX,
} from "../src/shared/mapNotes/lib/mapNotes.js";

const pinRow = {
  id: "n1", user_id: "u1", team_id: null, project_id: null,
  title: "Fence line", body: "Old fence sits ~10 ft inside the north line.",
  anchor_kind: "pin", lat: 29.78, lon: -95.81, county: "harris",
  parcel_apn: null, parcel_geom: null,
  created_at: "2026-09-08T10:00:00Z", updated_at: "2026-09-08T10:00:00Z",
};
const parcelRow = {
  ...pinRow, id: "n2", anchor_kind: "parcel", parcel_apn: "1234567",
  parcel_geom: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  project_id: "smabc123",
};

describe("rowToMapNote / mapNoteToRow: the anchor is a comp's, verbatim", () => {
  it("reads a pin row into the same anchor shape a comp uses", () => {
    const n = rowToMapNote(pinRow);
    expect(n.anchor).toEqual({ kind: "pin", lat: 29.78, lon: -95.81, county: "harris", parcelApn: null, parcelGeom: null });
    expect(n.title).toBe("Fence line");
    expect(n.projectId).toBeNull();
  });

  it("keeps a parcel row's identity snapshot so the shape draws without re-querying the county", () => {
    const n = rowToMapNote(parcelRow);
    expect(n.anchor.kind).toBe("parcel");
    expect(n.anchor.parcelApn).toBe("1234567");
    expect(n.anchor.parcelGeom.type).toBe("Polygon");
    expect(n.projectId).toBe("smabc123");
  });

  it("round-trips through mapNoteToRow without inventing or dropping a field", () => {
    const row = mapNoteToRow(rowToMapNote(parcelRow));
    expect(row.anchor_kind).toBe("parcel");
    expect(row.lat).toBe(parcelRow.lat);
    expect(row.parcel_apn).toBe("1234567");
    expect(row.project_id).toBe("smabc123");
    expect(row.body).toBe(parcelRow.body);
  });

  it("never writes user_id — the column defaults to auth.uid() and RLS checks it", () => {
    expect(Object.keys(mapNoteToRow(rowToMapNote(pinRow)))).not.toContain("user_id");
  });

  it("writes a blank title as NULL, not an empty string, and trims it", () => {
    expect(mapNoteToRow({ ...emptyMapNote({ kind: "pin", lat: 1, lon: 2 }), title: "   " }).title).toBeNull();
    expect(mapNoteToRow({ ...emptyMapNote({ kind: "pin", lat: 1, lon: 2 }), title: "  Gate  " }).title).toBe("Gate");
  });

  it("leaves project_id null when no site was picked — a note never acquires one", () => {
    expect(mapNoteToRow(emptyMapNote({ kind: "pin", lat: 1, lon: 2 })).project_id).toBeNull();
  });
});

describe("validateMapNote: refuses in sentences, never silently repairs", () => {
  const anchor = { kind: "pin", lat: 29.78, lon: -95.81 };

  it("passes a note with a body and a real anchor", () => {
    expect(validateMapNote({ ...emptyMapNote(anchor), body: "Culvert here" })).toEqual([]);
  });

  it("passes a title-only note (the title IS text)", () => {
    expect(validateMapNote({ ...emptyMapNote(anchor), title: "Gate" })).toEqual([]);
  });

  it("refuses a note with no text at all rather than writing a pin nobody can find", () => {
    expect(validateMapNote(emptyMapNote(anchor))).toContain("Type a note before saving.");
  });

  it("refuses a note with no place", () => {
    expect(validateMapNote({ ...emptyMapNote(null), body: "x" })[0]).toMatch(/no place on the map/);
  });

  it("refuses a parcel anchor carrying no parcel — the DB check, said as a sentence", () => {
    const bad = { ...emptyMapNote({ kind: "parcel", lat: 1, lon: 2 }), body: "x" };
    expect(validateMapNote(bad)[0]).toMatch(/no parcel to draw/);
  });

  it("accepts a parcel anchor with EITHER an APN or a geometry (the DB check is an OR)", () => {
    expect(validateMapNote({ ...emptyMapNote({ kind: "parcel", lat: 1, lon: 2, parcelApn: "9" }), body: "x" })).toEqual([]);
    expect(validateMapNote({ ...emptyMapNote({ kind: "parcel", lat: 1, lon: 2, parcelGeom: {} }), body: "x" })).toEqual([]);
  });

  it("refuses an over-long title or body", () => {
    expect(validateMapNote({ ...emptyMapNote(anchor), title: "x".repeat(NOTE_TITLE_MAX + 1) }).join(" ")).toMatch(/title under/);
    expect(validateMapNote({ ...emptyMapNote(anchor), body: "x".repeat(NOTE_BODY_MAX + 1) }).join(" ")).toMatch(/note under/);
  });

  it("refuses a NaN coordinate — a pin at 'not a number' is not a place", () => {
    expect(validateMapNote({ ...emptyMapNote({ kind: "pin", lat: Number.NaN, lon: 2 }), body: "x" })[0]).toMatch(/no place/);
  });
});

describe("mapNoteHeadline: never empty, so a note can always be reopened", () => {
  it("prefers the title", () => expect(mapNoteHeadline(rowToMapNote(pinRow))).toBe("Fence line"));
  it("falls back to the body's first non-blank line", () => {
    expect(mapNoteHeadline({ title: "", body: "\n  Drainage ditch\nmore" })).toBe("Drainage ditch");
  });
  it("truncates a very long first line rather than returning a paragraph", () => {
    const h = mapNoteHeadline({ body: "y".repeat(200) });
    expect(h.length).toBe(NOTE_TITLE_MAX);
    expect(h.endsWith("…")).toBe(true);
  });
  it("names an empty note rather than returning an empty string", () => {
    expect(mapNoteHeadline({})).toBe("Untitled note");
    expect(mapNoteHasText({})).toBe(false);
  });
});

describe("sortMapNotesByRecency", () => {
  it("puts the most recently edited first and is stable on a tie", () => {
    const a = { id: "a", updatedAt: "2026-09-01T00:00:00Z" };
    const b = { id: "b", updatedAt: "2026-09-08T00:00:00Z" };
    const c = { id: "c", updatedAt: "2026-09-08T00:00:00Z" };
    expect(sortMapNotesByRecency([a, c, b]).map((n) => n.id)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate its input", () => {
    const list = [{ id: "a", updatedAt: "2026-09-01T00:00:00Z" }, { id: "b", updatedAt: "2026-09-08T00:00:00Z" }];
    sortMapNotesByRecency(list);
    expect(list.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

/* ⛔ THE RULE THAT SEPARATES A NOTE FROM A COMP, asserted on the real source rather than trusted to
 * a comment. B843792 made every comp acquire an owning site — creating a tracked one from the
 * comp's own location when nothing matched. A note must NEVER do that, and it must never reach the
 * Notes WORKSPACE's document store either. Both would be silent, and both would be discovered as
 * junk in the owner's sites list / notebook rather than as a failing test. */
describe("a map note creates nothing", () => {
  const files = [
    "src/shared/mapNotes/lib/mapNotes.js",
    "src/shared/mapNotes/lib/mapNotesStore.js",
    "src/shared/mapNotes/lib/mapNoteMarkerIcon.js",
    "src/shared/mapNotes/components/MapNoteEditor.jsx",
  ].map((f) => [f, readFileSync(new URL(`../${f}`, import.meta.url), "utf8")]);

  it("never calls the comp path's site-materialization helper", () => {
    for (const [f, src] of files) {
      expect(src, `${f} must not create an owning site`).not.toMatch(/resolveOrCreateTrackedSiteForComp|createTrackedSite/);
    }
  });

  it("never writes to the sites table or the Notes workspace's document stores", () => {
    for (const [f, src] of files) {
      expect(src, `${f} must not touch sites`).not.toMatch(/from\(["']sites["']\)/);
      // CODE, not prose — these files deliberately EXPLAIN the split in their headers, so strip
      // comments before asserting nothing actually reaches the Notes workspace's stores.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} must not read/write the Notes workspace's stores`).not.toMatch(/from\(["'](notes_pages|notes_trees|notes_images)["']\)/);
      expect(code, `${f} must not import the Notes workspace`).not.toMatch(/from\s+["'][^"']*workspaces\/notes/);
    }
  });

  it("keeps the SQL's project_id an optional reference with no default and no backfill", () => {
    const sql = readFileSync(new URL("../src/shared/mapNotes/db/map_notes.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/project_id\s+text references public\.sites\(id\) on delete set null/);
    expect(sql).not.toMatch(/insert into public\.sites/i);
  });
});

describe("map_notes.sql mirrors comps.sql's ownership, sharing and soft-delete shape", () => {
  const sql = readFileSync(new URL("../src/shared/mapNotes/db/map_notes.sql", import.meta.url), "utf8");

  it("is idempotent — safe to re-run in the SQL editor, like every other db/ file here", () => {
    expect(sql).toMatch(/create table if not exists public\.map_notes/);
    expect(sql).toMatch(/drop policy if exists/);
    expect(sql).toMatch(/drop trigger if exists/);
  });

  it("enables RLS and ships exactly the four comp policies", () => {
    expect(sql).toMatch(/alter table public\.map_notes enable row level security/);
    for (const verb of ["for select", "for insert", "for update", "for delete"]) {
      expect(sql, `missing a policy ${verb}`).toContain(verb);
    }
  });

  it("shares team READ but keeps WRITE owner-only — never team_sharing's any-member-may-edit", () => {
    const update = sql.slice(sql.indexOf('create policy "update own map notes"'), sql.indexOf('create policy "delete own map notes"'));
    expect(update).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    expect(update).not.toMatch(/is_team_member\(team_id\)\s*\)?\s*;/); // team membership only gates the team_id you may SET
    const select = sql.slice(sql.indexOf('create policy "select own or team map notes"'), sql.indexOf('create policy "insert own map notes"'));
    expect(select).toMatch(/is_team_member\(team_id\)/);
  });

  it("carries soft delete and the parcel-identity constraint", () => {
    expect(sql).toMatch(/deleted_at\s+timestamptz/);
    expect(sql).toMatch(/map_notes_parcel_anchor_has_identity/);
  });
});
