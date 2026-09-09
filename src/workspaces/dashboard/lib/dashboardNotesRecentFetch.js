/* dashboardNotesRecentFetch — the notes the "Since you were last here" card needs: pages CREATED
 * since a given moment, with their opening words (never just "a note was written").
 *
 * Deliberately does NOT import anything from workspaces/notes/lib — that module tree is large
 * (the editor, the sync engine, the version history…) and importing even its leaf-most pieces
 * risks hoisting a shared chunk onto every route (the same bundle reasoning notesKeys.js's own
 * header states, and the same reason `releaseCanvas.js` is duplicated rather than shared between
 * doc-review and site-planner). So this file carries its own tiny, read-only copies of the two
 * things it needs: walking the page TREE (`notes_trees.data`, `{v, pages:[{id,title,createdAt,
 * updatedAt,pages,projectId?,orgScope?}], trash, tombs}` — see notesModel.js's own header for the
 * authoritative shape) and flattening a ProseMirror document to plain text. Both are read-only and
 * a few lines each; if the real shape ever changes, `test/dashboardSinceLastHere.test.js` and this
 * card going quietly empty are the signals to come back and update the copy.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const OPENING_WORD_COUNT = 12;
const OPENING_CHAR_CAP = 140;

/** Walk the live page tree (never `tree.trash`), returning a flat list of
 * `{id, title, createdAt, projectId, orgScope}` — a subpage inherits its ROOT's project/org,
 * exactly as notesModel.js's `projectOfPage` derives it (never stored a second time). */
function flattenNotesTree(tree) {
  const out = [];
  const walk = (node, rootProjectId, rootOrgScope) => {
    if (!node || typeof node !== "object") return;
    out.push({
      id: node.id,
      title: (node.title && String(node.title).trim()) || "Untitled page",
      createdAt: Number.isFinite(node.createdAt) ? node.createdAt : null,
      projectId: rootProjectId,
      orgScope: rootOrgScope,
    });
    for (const child of Array.isArray(node.pages) ? node.pages : []) walk(child, rootProjectId, rootOrgScope);
  };
  for (const root of Array.isArray(tree?.pages) ? tree.pages : []) {
    walk(root, root?.projectId ?? null, !!root?.orgScope);
  }
  return out;
}

/** Flatten a ProseMirror document to plain text, text nodes only, stopping once there's enough
 * for an "opening words" preview — never the whole document. */
function docOpeningText(doc, capChars = OPENING_CHAR_CAP) {
  let out = "";
  const walk = (node) => {
    if (!node || out.length >= capChars) return;
    if (typeof node.text === "string") out += (out ? " " : "") + node.text;
    for (const child of Array.isArray(node.content) ? node.content : []) {
      if (out.length >= capChars) return;
      walk(child);
    }
  };
  walk(doc);
  return out.trim().slice(0, capChars);
}

/** First ~N words of a page's opening text, with a trailing "…" if it was cut short. "" if the
 * page has no words yet (a blank page is real and common — never fabricated). */
export function openingWords(doc, wordCount = OPENING_WORD_COUNT) {
  const text = docOpeningText(doc);
  if (!text) return "";
  const words = text.split(/\s+/).filter(Boolean);
  const took = words.slice(0, wordCount).join(" ");
  return took.length < text.length || words.length > wordCount ? `${took}…` : took;
}

/** Every LIVE page created at/after `sinceMs` (epoch ms), with its opening words. Returns [] on
 * any failure or if the account has never written a note. */
export async function fetchRecentNotePages(uid, sinceMs) {
  if (!supabase || !uid || !Number.isFinite(sinceMs)) return [];
  try {
    const { data: treeRow, error: treeErr } = await supabase.from("notes_trees").select("data").eq("user_id", uid).maybeSingle();
    if (treeErr || !treeRow?.data) return [];
    const candidates = flattenNotesTree(treeRow.data).filter((p) => p.createdAt != null && p.createdAt >= sinceMs);
    if (!candidates.length) return [];

    const ids = candidates.map((p) => p.id);
    const { data: bodyRows, error: bodyErr } = await supabase
      .from("notes_pages")
      .select("id, doc")
      .eq("user_id", uid)
      .in("id", ids)
      .is("deleted_at", null);
    if (bodyErr) return [];
    const bodyById = new Map((bodyRows || []).map((r) => [r.id, r.doc]));

    return candidates
      .map((p) => ({ ...p, opening: openingWords(bodyById.get(p.id)) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (_) {
    return [];
  }
}
