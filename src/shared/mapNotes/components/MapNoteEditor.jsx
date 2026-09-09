/* MapNoteEditor — the small card that opens on a map note: read it, edit it, delete it.
 *
 * Deliberately SMALL. A map note is a short piece of text pinned to a place; a document belongs in
 * the Notes workspace (src/workspaces/notes), which this component does not import, link to, or
 * know about. See db/map_notes.sql's header for why that split is load-bearing rather than tidy.
 *
 * INLINE EDITOR, never a dialog box (owner rule, 2026-06-17: no window.prompt/confirm/alert). The
 * delete confirmation swaps the action row for a dedicated Confirm/Keep-it pair (NEW-1,
 * B1372144-HARDENING-1) rather than relabeling the Delete button in place — see that swap's own
 * comment below for why the relabel version could be misclicked into a silent no-op.
 *
 * LOUD-FAILURE — every save/delete failure is shown in the card, in the words the store handed
 * back, and the card STAYS OPEN with the user's text intact. Nothing here reports a success it did
 * not get: the parent's `onSaved` only ever runs on a row the server actually returned.
 *
 * ⛔ THE SITE DROPDOWN IS OPTIONAL AND CREATES NOTHING. It links a note to an ALREADY-EXISTING
 * site, and "No site" is both the default and a real, permanent answer — a note is an annotation
 * on the ground, not a record about a property. Do not add a "create a site from this note" path
 * here; that is exactly what B843792 does for comps and exactly what this feature must not do.
 */
import React, { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE, SPACE } from "../../ui/designTokens.js";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, validateMapNote, mapNoteHeadline } from "../lib/mapNotes.js";

const INPUT_STYLE = {
  width: "100%", boxSizing: "border-box",
  background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: FONT_SIZE.control, fontFamily: "inherit",
};

/**
 * props:
 *  - note            the note being edited: a saved row, or a fresh one from emptyMapNote(anchor)
 *  - sites           [{id,name}] for the optional link dropdown — EXISTING sites only
 *  - saving/busy     handled internally; the parent only supplies the async actions
 *  - onSave(note)    → { data, error }  (parent calls insertMapNote/updateMapNote)
 *  - onDelete(id)    → { error }        (parent calls deleteMapNote — SOFT)
 *  - onClose()
 */
export default function MapNoteEditor({ note, sites = [], onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(note?.title || "");
  const [body, setBody] = useState(note?.body || "");
  const [projectId, setProjectId] = useState(note?.projectId || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const bodyRef = useRef(null);
  const isNew = !note?.id;

  // Re-seed when the card is pointed at a DIFFERENT note (clicking a second marker while one is
  // open) — keyed on id so a re-render of the same note never stomps what the user is typing.
  useEffect(() => {
    setTitle(note?.title || ""); setBody(note?.body || "");
    setProjectId(note?.projectId || ""); setErr(""); setConfirmDel(false);
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isNew && bodyRef.current) bodyRef.current.focus(); }, [isNew]);

  const draft = { ...(note || {}), title, body, projectId: projectId || null };
  const problems = validateMapNote(draft);

  const save = async () => {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr("");
    try {
      const res = await onSave(draft);
      if (res?.error) { setErr(res.error.message || String(res.error)); return; }
      onClose?.();
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const confirmRemove = async () => {
    setBusy(true); setErr("");
    try {
      const res = await onDelete(note.id);
      if (res?.error) { setErr(res.error.message || String(res.error)); return; }
      onClose?.();
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div
      data-testid="map-note-editor"
      // Stop map gestures underneath: a drag inside the card must not pan the map behind it.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } }}
      style={{
        display: "flex", flexDirection: "column", gap: SPACE.sm,
        width: 300, maxWidth: "calc(100vw - 24px)",
        background: "var(--surface-raised)", color: "var(--text-primary)",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
        boxShadow: "0 10px 30px rgba(28,25,20,0.22)", // design-exempt: shadow tint, matches the map's other floating panels (ContextMenu)
        padding: SPACE.xl,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
        <span style={{ width: SPACE.sm, height: SPACE.sm, borderRadius: RADIUS.pill, background: "var(--accent-notes)", flex: "none" }} />
        <span style={{ flex: 1, fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          {isNew ? "New note" : "Note"}
        </span>
        <span style={{ fontSize: FONT_SIZE.micro, color: "var(--text-secondary)" }}>
          {note?.anchor?.kind === "parcel" ? "On a parcel" : "Dropped pin"}
        </span>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={NOTE_TITLE_MAX}
        placeholder="Title (optional)"
        aria-label="Note title"
        data-testid="map-note-title"
        style={INPUT_STYLE}
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={NOTE_BODY_MAX}
        rows={5}
        placeholder="Type your note…"
        aria-label="Note text"
        data-testid="map-note-body"
        style={{ ...INPUT_STYLE, resize: "vertical", minHeight: 84, lineHeight: 1.45 }}
      />

      {/* Optional link to an EXISTING site — never creates one. "No site" is a real answer. */}
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Link this note to a site"
        data-testid="map-note-site"
        style={{ ...INPUT_STYLE, padding: `${SPACE.xs}px ${SPACE.sm}px` }}
      >
        <option value="">No site</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
      </select>

      {err && (
        <div role="alert" data-testid="map-note-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{err}</div>
      )}

      {/* ⛔ CONFIRM IS A SEPARATE ROW, NEVER A RELABEL OF THE SAME BUTTON IN PLACE — the SitePlansSection
          kebab menu's "the menu swaps its OWN content for a confirm step rather than closing" pattern,
          copied here rather than reinvented, because the relabel version has a real hazard: "Delete"
          growing to "Delete — sure?" in a fixed-width row shrinks the flex spacer next to it, which
          shifts Cancel/Save left underneath wherever the user's second click lands. A miss there reads
          as "I clicked Delete and it just closed" with zero network traffic — exactly the reported
          defect, and exactly the class LOUD-FAILURE exists to prevent. Replacing the whole row means
          the second click can only ever land on a control that belongs to the confirm step itself. */}
      {confirmDel ? (
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          <span style={{ flex: 1, fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>Delete this note?</span>
          <Button variant="ghost" onClick={() => setConfirmDel(false)} disabled={busy}>Keep it</Button>
          <Button variant="danger" onClick={confirmRemove} disabled={busy} data-testid="map-note-delete-confirm">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          {!isNew && (
            <Button variant="ghost" onClick={() => setConfirmDel(true)} disabled={busy} data-testid="map-note-delete"
              title="Delete this note" style={{ color: "var(--danger-text)" }}>
              Delete
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => onClose?.()} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || problems.length > 0}
            accent="var(--accent-notes)" onAccent="var(--on-accent-notes)"
            data-testid="map-note-save"
            title={problems.length ? problems[0] : `Save ${mapNoteHeadline(draft)}`}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
