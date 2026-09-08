/* mapNotes — the pure shape of a map note: row <-> object mapping, display text, and validation.
 * No Leaflet, no Supabase, no React here, so every rule below is unit-testable (test/mapNotes.test.js).
 *
 * A map note is a short piece of text pinned to a place. It mirrors a comp's ANCHOR exactly
 * (shared/comps/lib/comps.js's rowToComp/compToRow, same field names, same nullability) and
 * replaces every deal column with one payload: `body` (the note) plus an optional `title`.
 *
 * ⛔ A NOTE NEVER CREATES A SITE. `projectId` is an OPTIONAL link to an already-existing site and
 * is null when there is none — see db/map_notes.sql's header for why this is the one place a note
 * deliberately departs from a comp (B843792 made every comp acquire an owning site, materializing
 * one when nothing matched; doing that per note would fill the sites list with junk).
 */

/** Longest a note's title may be. A title is a LABEL — the body is where text goes — and this is
 * also what keeps a marker tooltip to one line. Enforced by `validateMapNote`, not silently cut. */
export const NOTE_TITLE_MAX = 80;
/** Longest a note's body may be. A map note is short by definition; a document belongs in the
 * Notes workspace, which this module deliberately does not touch. */
export const NOTE_BODY_MAX = 2000;

export function rowToMapNote(r) {
  return {
    id: r.id,
    userId: r.user_id,
    teamId: r.team_id || null,
    projectId: r.project_id || null,
    title: r.title || "",
    body: r.body || "",
    anchor: {
      kind: r.anchor_kind,
      lat: Number(r.lat),
      lon: Number(r.lon),
      county: r.county || null,
      parcelApn: r.parcel_apn || null,
      parcelGeom: r.parcel_geom || null,
    },
    deletedAt: r.deleted_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The write shape. `user_id` is deliberately absent — the column defaults to auth.uid() and RLS
 * checks it, exactly as comps does, so a client can never claim another user's authorship. */
export function mapNoteToRow(note) {
  return {
    // A whitespace-only title is NO title — trim FIRST, then null. `"   " ? trim : null` writes an
    // empty string, which then reads back as a titled note with a blank label (caught by test).
    title: (note.title ? String(note.title).trim() : "") || null,
    body: note.body ? String(note.body) : "",
    team_id: note.teamId || null,
    project_id: note.projectId || null,
    anchor_kind: note.anchor?.kind,
    lat: note.anchor?.lat,
    lon: note.anchor?.lon,
    county: note.anchor?.county || null,
    parcel_apn: note.anchor?.parcelApn || null,
    parcel_geom: note.anchor?.parcelGeom || null,
    updated_at: new Date().toISOString(),
  };
}

/** A blank note seeded with a just-placed anchor — the create path's starting value. */
export function emptyMapNote(anchor = null) {
  return { title: "", body: "", projectId: null, teamId: null, anchor: anchor || null };
}

/** What the marker tooltip and any list row call this note. Falls back to the body's first line,
 * then to a named placeholder — never an empty string, so a note can always be found and reopened
 * even when the user saved it without typing anything (LOUD-FAILURE's spirit: an untitled note is
 * visibly untitled, never invisible). */
export function mapNoteHeadline(note) {
  const t = (note?.title || "").trim();
  if (t) return t;
  const firstLine = (note?.body || "").split("\n").map((s) => s.trim()).find(Boolean);
  if (firstLine) return firstLine.length > NOTE_TITLE_MAX ? `${firstLine.slice(0, NOTE_TITLE_MAX - 1)}…` : firstLine;
  return "Untitled note";
}

/** Whether this note carries any text at all. An anchor with no text is a pin with nothing on it —
 * the editor refuses to SAVE one rather than writing an empty row nobody can find later. */
export function mapNoteHasText(note) {
  return Boolean((note?.title || "").trim() || (note?.body || "").trim());
}

/** Every reason this note cannot be saved, as plain sentences (empty array = saveable). Returned
 * rather than thrown so the editor can show them inline; nothing here silently repairs the note. */
export function validateMapNote(note) {
  const out = [];
  const a = note?.anchor;
  if (!a || typeof a.lat !== "number" || typeof a.lon !== "number" || Number.isNaN(a.lat) || Number.isNaN(a.lon)) {
    out.push("This note has no place on the map yet.");
  } else if (a.kind !== "pin" && a.kind !== "parcel") {
    out.push("This note's anchor is not a pin or a parcel.");
  } else if (a.kind === "parcel" && !a.parcelApn && !a.parcelGeom) {
    // db/map_notes.sql's map_notes_parcel_anchor_has_identity, checked client-side too so the
    // failure reads as a sentence here instead of a Postgres constraint name from the network.
    out.push("This parcel anchor carries no parcel to draw.");
  }
  if (!mapNoteHasText(note)) out.push("Type a note before saving.");
  if ((note?.title || "").trim().length > NOTE_TITLE_MAX) out.push(`Keep the title under ${NOTE_TITLE_MAX} characters.`);
  if ((note?.body || "").length > NOTE_BODY_MAX) out.push(`Keep the note under ${NOTE_BODY_MAX} characters.`);
  return out;
}

/** Newest-first by last edit — the order the map layer and any future list read in. Pure, total,
 * and stable for equal timestamps (falls back to id) so a re-render never reshuffles the list. */
export function sortMapNotesByRecency(notes) {
  return [...(notes || [])].sort((a, b) => {
    const ta = Date.parse(a?.updatedAt || a?.createdAt || "") || 0;
    const tb = Date.parse(b?.updatedAt || b?.createdAt || "") || 0;
    if (tb !== ta) return tb - ta;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
