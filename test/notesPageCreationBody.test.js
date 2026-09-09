/* B1405008 — A PAGE CAN LAND IN THE NOTES INDEX WITH NO BODY ROW, AND NOTHING EVER NOTICED.
 *
 * ⛔ THE REPORT, measured on production. `notes_trees` for a real account carried a page
 * (`pg_mtthtq7h1scx8jg`, "Untitled page") with NO row for it in `notes_pages` — not live, not
 * deleted, not purged. It sat in the sidebar, clickable, for 12+ hours with nothing behind it.
 * The control: seven sibling pages made the same night each got a `notes_pages` row within
 * about two seconds of their tree entry.
 *
 * ⛔ THE MECHANISM, traced through the actual code (`Notes.jsx`'s `handleAddPage` /
 * `handleAddSubpage`, `NoteEditor.jsx`'s save debounce, `notesStore.js`'s `pushPending`). A
 * page created without a template got a tree node immediately (`addPage` + `persistTree`,
 * which pushes the TREE on its own schedule) and NOTHING wrote its body — `writePage` only
 * ever ran from `NoteEditor`'s `onUpdate`, which fires once per keystroke and only after the
 * user actually types. `sync.pages` (the set `pushPending` reads to decide what to push) is
 * marked dirty ONLY by `writePage`, so a page nobody typed into never entered it — not a
 * failed write, a write that was NEVER ATTEMPTED. Seven-of-eight got a body because he
 * happened to type into them within a couple of seconds; the eighth is the one he didn't.
 *
 * ⛔ THE FIX: `notesStore.js`'s `createPage` writes the body FIRST, synchronously, as part of
 * creating the page, before the tree node is ever handed back to a caller to persist — so
 * there is no window in which an entry can be visible with nothing behind it, regardless of
 * whether or how soon the user types. `Notes.jsx`'s two creation handlers now go through it
 * exclusively; `addPage` alone (the old, incomplete path) is no longer called from there.
 *
 * ⛔ THIS SUITE'S CENTRAL GUARD is `assertNoBodylessEntries` — every id in the LIVE tree must
 * have a body row once a sync has run. Per this repo's own verification bar ("prove a new
 * guard goes RED before trusting it green"), the MUTATION block below reconstructs the OLD
 * path (`addPage` + `writeTree`, with no body write — literally what `handleAddPage` did
 * before this fix) and proves the SAME guard fails it. `createPage` did not exist on `main`
 * before this change; the reconstruction uses only functions that existed unchanged either
 * side of it, so the guard's teeth do not depend on the new function being present to fail.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addPage, allPageIds, migrate } from "../src/workspaces/notes/lib/notesModel.js";

const UID = "u_bodyoncreate";

/* ---- the server: one row per table, same shape notesTreeWriteThrough.test.js uses, trimmed
 * to what this suite needs (no images). `rev` is owned by the server, exactly as the deployed
 * trigger owns it, so a guarded push whose `rev` filter misses reads as a conflict. */
function fakeServer() {
  return { tree: null, treeRev: 0, pages: new Map() };
}

function clientFor(server) {
  const runSelect = (table, filters) => {
    if (table === "notes_trees") return server.tree == null ? [] : [{ data: server.tree, rev: server.treeRev }];
    let rows = [...server.pages.entries()].map(([id, r]) => ({ id, ...r }));
    if (filters.id !== undefined) {
      const want = Array.isArray(filters.id) ? new Set(filters.id) : new Set([filters.id]);
      rows = rows.filter((r) => want.has(r.id));
    }
    return rows;
  };

  const runWrite = (table, op, payload, filters) => {
    if (table === "notes_trees") {
      if (op === "insert") {
        if (server.tree != null) return { rows: [], error: { code: "23505", message: "duplicate key" } };
        server.tree = payload.data; server.treeRev = 1;
        return { rows: [{ rev: 1 }], error: null };
      }
      if (filters.rev !== undefined && filters.rev !== server.treeRev) return { rows: [], error: null };
      server.tree = payload.data; server.treeRev += 1;
      return { rows: [{ rev: server.treeRev }], error: null };
    }
    const rows = [];
    for (const p of [payload].flat()) {
      const id = p.id ?? filters.id;
      const prev = server.pages.get(id);
      if (op === "update" && filters.rev !== undefined && prev && filters.rev !== prev.rev) continue;
      const rev = (prev?.rev || 0) + 1;
      server.pages.set(id, { ...(prev || {}), ...p, rev });
      rows.push({ id, rev });
    }
    return { rows, error: null };
  };

  const builder = (table, op, payload) => {
    const filters = {};
    const exec = () => {
      if (op === "select") return { data: runSelect(table, filters), error: null };
      const r = runWrite(table, op, payload, filters);
      return { data: r.error ? null : r.rows, error: r.error };
    };
    const self = {
      eq(col, val) { filters[col] = val; return self; },
      in(col, vals) { filters[col] = vals; return self; },
      select() { return self; },
      maybeSingle() { const { data, error } = exec(); return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error }); },
      then(res, rej) { const { data, error } = exec(); return Promise.resolve({ data, error }).then(res, rej); },
    };
    return self;
  };

  return {
    from(table) {
      return {
        select: () => builder(table, "select"),
        insert: (p) => builder(table, "insert", p),
        update: (p) => builder(table, "update", p),
        upsert: (p) => builder(table, "upsert", p),
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: "not stored" } }), remove: async () => ({ error: null }) }) },
  };
}

/** A browser window: its own localStorage, its own module instance, one shared server.
 *  `breakPageWrites` optionally makes the PAGE-body key throw on write while the tree key
 *  keeps working — a real, if rare, storage failure mid-creation. */
async function openWindow(server, { breakPageWrites = false } = {}) {
  const mem = new Map();
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (breakPageWrites && k.includes(":page:")) throw new DOMException("quota exceeded", "QuotaExceededError");
      mem.set(k, String(v));
    },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  globalThis.window = {
    localStorage,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  };
  globalThis.document = { visibilityState: "visible" };

  vi.resetModules();
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: clientFor(server) }));
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  return { store, localStorage };
}

const focus = (w) => { globalThis.window.localStorage = w.localStorage; };
const readTree = (w) => migrate(w.store.readTreeRaw());

/** Every live page id, cross-checked against the SERVER's own row set — the invariant this
 *  whole suite exists to prove. Throws (rather than returning a boolean) so a failure names
 *  exactly which id is bodyless, the way this repo's other teeth-proofs do. */
function assertNoBodylessEntries(server) {
  if (server.tree == null) return; // nothing published yet
  const ids = allPageIds(migrate(server.tree));
  const orphans = ids.filter((id) => !server.pages.has(id));
  if (orphans.length) {
    throw new Error(`${orphans.length} tree entr${orphans.length === 1 ? "y" : "ies"} with no notes_pages row: ${orphans.join(", ")}`);
  }
}

afterEach(() => { vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js"); });

describe("createPage — the body is written before the entry can ever be seen", () => {
  it("the body is readable locally the instant creation returns, before any sync runs", async () => {
    const w = await openWindow(fakeServer());
    focus(w);
    w.store.setNotesScope(UID);

    const r = w.store.createPage(readTree(w), { projectId: null });
    expect(r.ok).toBe(true);
    expect(r.pageId).toBeTruthy();

    // No writeTree, no sync tick — yet the body already exists on disk.
    const body = w.store.readPage(r.pageId);
    expect(body).not.toBeNull();
    expect(body.type).toBe("doc");
  });

  it("a template's content is seeded the same way, still before the tree is touched", async () => {
    const w = await openWindow(fakeServer());
    focus(w);
    w.store.setNotesScope(UID);

    const seed = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Template body" }] }] };
    const r = w.store.createPage(readTree(w), { projectId: null }, seed);
    expect(r.ok).toBe(true);
    expect(w.store.readPage(r.pageId)).toEqual(seed);
  });

  it("a subpage under an id that does not exist creates neither a body nor a tree change", async () => {
    const w = await openWindow(fakeServer());
    focus(w);
    w.store.setNotesScope(UID);

    const before = readTree(w);
    const r = w.store.createPage(before, { parentId: "no-such-parent" });
    expect(r.ok).toBe(false);
    expect(r.pageId).toBeNull();
    expect(allPageIds(r.tree)).toEqual(allPageIds(before));
  });

  /* ⛔ THE FAILURE PATH — LOUD, NOT SILENT. If the body write itself fails (a real storage
   * failure), the caller contract is: do not persist the tree. This is what makes the fix an
   * ORDERING fix rather than a race — the entry simply never becomes visible when its body
   * could not be written, the same way a template failing today would leave nothing behind. */
  it("a body write that fails must not leave a tree entry with nothing behind it", async () => {
    const w = await openWindow(fakeServer(), { breakPageWrites: true });
    focus(w);
    w.store.setNotesScope(UID);

    const before = readTree(w);
    const r = w.store.createPage(before, { projectId: null });
    expect(r.ok).toBe(false);

    // The caller contract (mirrored from Notes.jsx's handleAddPage/handleAddSubpage): never
    // persist `r.tree` when `r.ok` is false.
    if (r.ok) w.store.writeTree(r.tree);

    // So the tree actually on disk — the one a reload or a sync would read — is unchanged.
    expect(allPageIds(readTree(w))).toEqual(allPageIds(before));
    expect(w.store.readPage(r.pageId)).toBeNull();
  });
});

describe("the fix closes the cloud gap — a created page's body reaches notes_pages", () => {
  it("creating, then syncing, gives the server BOTH a tree entry and a page row", async () => {
    const server = fakeServer();
    const w = await openWindow(server);
    focus(w);
    w.store.setNotesScope(UID);
    await w.store.startNotesSync({});

    const r = w.store.createPage(readTree(w), { projectId: null });
    expect(r.ok).toBe(true);
    w.store.writeTree(r.tree);           // exactly what the real handler does next
    await w.store.refreshNotesSync();

    expect(allPageIds(migrate(server.tree))).toContain(r.pageId);
    expect(server.pages.has(r.pageId)).toBe(true);          // ⛔ this is the line that used to fail
    assertNoBodylessEntries(server);
  });

  it("two windows creating at the same time both get their body pushed — no orphan either side", async () => {
    const server = fakeServer();
    const A = await openWindow(server);
    focus(A); A.store.setNotesScope(UID);
    await A.store.startNotesSync({});

    const B = await openWindow(server);
    focus(B); B.store.setNotesScope(UID);
    await B.store.startNotesSync({});

    focus(A);
    const ra = A.store.createPage(readTree(A), { id: "p_from_a", projectId: null });
    A.store.writeTree(ra.tree);
    await A.store.refreshNotesSync();

    focus(B);
    await B.store.refreshNotesSync();      // picks up A's tree first
    const rb = B.store.createPage(readTree(B), { id: "p_from_b", projectId: null });
    B.store.writeTree(rb.tree);
    await B.store.refreshNotesSync();

    focus(A);
    await A.store.refreshNotesSync();

    expect(allPageIds(migrate(server.tree)).sort()).toEqual(["p_from_a", "p_from_b"].sort());
    expect(server.pages.has("p_from_a")).toBe(true);
    expect(server.pages.has("p_from_b")).toBe(true);
    assertNoBodylessEntries(server);
  });

  it("a page created with no network yet still has a body once it finally syncs", async () => {
    const server = fakeServer();
    const w = await openWindow(server);
    focus(w);
    w.store.setNotesScope(UID);
    // Deliberately no startNotesSync() yet — creation must not depend on being online.
    const r = w.store.createPage(readTree(w), { projectId: null });
    expect(r.ok).toBe(true);
    w.store.writeTree(r.tree);
    expect(w.store.readPage(r.pageId)).not.toBeNull();     // durable locally, offline

    await w.store.startNotesSync({});
    await w.store.refreshNotesSync();
    expect(server.pages.has(r.pageId)).toBe(true);
  });
});

/* ⛔ THE MUTATION CHECK, in this repo's own established idiom (see notesTreeWriteThrough.test.js's
 * closing block): reconstruct the OLD, pre-fix path with the SAME guard, and prove the guard
 * actually catches it. `addPage` + `writeTree` — with no body write in between — is literally
 * what `Notes.jsx`'s `handleAddPage` called before this fix. */
describe("⛔ MUTATION: the OLD path — a tree entry with no body write at all — fails this suite's own guard", () => {
  it("addPage + writeTree, with nothing writing a body, leaves a tree entry the server has no row for", async () => {
    const server = fakeServer();
    const w = await openWindow(server);
    focus(w);
    w.store.setNotesScope(UID);
    await w.store.startNotesSync({});

    // The reconstructed OLD `handleAddPage`: tree only, never `writePage`.
    const add = addPage(readTree(w), { id: "p_old_way", projectId: null });
    w.store.writeTree(add.tree);
    await w.store.refreshNotesSync();

    expect(allPageIds(migrate(server.tree))).toContain("p_old_way");   // the entry is live and visible
    expect(server.pages.has("p_old_way")).toBe(false);                  // …and nothing is behind it
    expect(() => assertNoBodylessEntries(server)).toThrow(/p_old_way/); // the guard catches it
  });
});

describe("the editor's read path never throws on a genuinely bodyless page", () => {
  it("readPage returns null (never throws) for an id nothing was ever written for", async () => {
    const w = await openWindow(fakeServer());
    focus(w);
    w.store.setNotesScope(UID);

    expect(() => w.store.readPage("never-written")).not.toThrow();
    expect(w.store.readPage("never-written")).toBeNull();

    // What NoteEditor.jsx actually does: `readPage(pageId) || EMPTY_DOC`.
    const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
    const initialDoc = w.store.readPage("never-written") || EMPTY_DOC;
    expect(initialDoc).toEqual(EMPTY_DOC);
  });
});
