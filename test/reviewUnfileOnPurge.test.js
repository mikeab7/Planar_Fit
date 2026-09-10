import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1340368 — unfileReviewsForDeletedProject is the write-time half of the "Last document card
 * offers a document filed under a purged project" fix: called ONLY from storage.js's
 * purgeProjectFoldersFor, at the point that function has already confirmed (via
 * groupStillHasLivePlans) the whole group has no live plan left. Clears doc_reviews.project_id
 * (→ "Unfiled") for every document still filed under that now-permanently-gone group, so
 * nothing keeps offering a document pointed at a group id that can never resolve live again.
 *
 * Deliberately NOT a foreign key (see this module's own header): a plain ON DELETE SET NULL FK
 * would fire on the ANCHOR row's own delete, which can happen while its GROUP is still alive
 * through other plans — exactly the B1164192 anchor-vs-group shape this whole family exists to
 * stop re-introducing.
 *
 * ⛔ B1340368 (×2), recurrence 2026-09-09 — this function used to null ONLY the
 * flat `project_id` mirror column. That left the review's own RECORD (the `data` jsonb, which
 * `reviewRowFor` mirrors the flat column FROM on every ordinary save) still carrying the dead
 * project id — and `reviewStore.loadReview` hands that jsonb back as the authoritative record,
 * which is exactly what DocReview.jsx's open path navigates by. So a document this function had
 * already made safe to OFFER (the Dashboard/Library checks read the flat column) could still
 * ROUTE to the dead project the instant it was opened. It now reads each affected row's `data`
 * back and nulls the record's own `projectId` too — SELECT first, then one UPDATE per row —
 * which is why the mock below scripts the SELECT and UPDATE steps separately instead of
 * expecting one bulk statement.
 *
 * Same minimal chainable supabase mock as test/reviewDeleteSafety.test.js.
 */
const h = vi.hoisted(() => ({
  selectRows: [],
  selectError: null,
  updateError: null,
  throwSync: false,
  calls: [],
}));

function builder(table) {
  const ops = [];
  const settle = () => {
    if (h.throwSync) throw new Error("boom");
    const isSelect = ops.some((o) => o[0] === "select");
    const r = isSelect
      ? { data: h.selectError ? null : h.selectRows, error: h.selectError }
      : { data: null, error: h.updateError };
    h.calls.push({ table, ops });
    return r;
  };
  const b = { then(resolve, reject) { try { resolve(settle()); } catch (e) { reject(e); } } };
  for (const m of ["select", "update", "delete", "upsert", "insert", "eq", "neq", "is", "not", "lt", "contains", "limit", "order", "or"])
    b[m] = (...args) => { ops.push([m, ...args]); return b; };
  return b;
}

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabaseConfigured: () => true,
  supabaseRest: () => ({ url: "http://x", anon: "a" }),
  currentAccessToken: () => "tok",
  connectionInfo: () => ({}),
  testConnection: async () => ({ ok: true }),
  supabase: { from: (t) => builder(t), auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
}));
vi.mock("../src/workspaces/site-planner/lib/auth.js", () => ({
  signUp: async () => ({}), signIn: async () => ({}), signOut: async () => ({}),
  resetPassword: async () => ({}), updatePassword: async () => ({}),
  getUser: async () => ({ id: "u1" }),
  onAuthChange: () => () => {},
}));

import { unfileReviewsForDeletedProject } from "../src/workspaces/doc-review/lib/reviewStore.js";

const updateCalls = () => h.calls.filter((c) => c.table === "doc_reviews" && c.ops.some((o) => o[0] === "update"));
const selectCalls = () => h.calls.filter((c) => c.table === "doc_reviews" && c.ops.some((o) => o[0] === "select"));

beforeEach(() => { h.calls = []; h.selectRows = []; h.selectError = null; h.updateError = null; h.throwSync = false; });

describe("unfileReviewsForDeletedProject", () => {
  it("no groupId → a no-op, never queries anything", async () => {
    const r = await unfileReviewsForDeletedProject(null);
    expect(r).toEqual({ ok: true, unfiled: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it("nothing filed under the group → ok:true, unfiled:0, no update issued", async () => {
    h.selectRows = [];
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r).toEqual({ ok: true, unfiled: 0 });
    expect(updateCalls()).toHaveLength(0);
  });

  it("selects rows scoped by eq(project_id, groupId), then nulls project_id AND the record's own data.projectId for each", async () => {
    h.selectRows = [
      { id: "d1", data: { projectId: "smtov116eka7", title: "A", markups: [1] } },
      { id: "d2", data: { projectId: "smtov116eka7", title: "B" } },
    ];
    const r = await unfileReviewsForDeletedProject("smtov116eka7");
    expect(r).toEqual({ ok: true, unfiled: 2 });

    const sel = selectCalls()[0];
    expect(sel.ops.some((o) => o[0] === "eq" && o[1] === "project_id" && o[2] === "smtov116eka7")).toBe(true);

    const updates = updateCalls();
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      const payload = u.ops.find((o) => o[0] === "update")[1];
      expect(payload.project_id).toBeNull();
      expect(payload.data.projectId).toBeNull();
    }
    // the rest of each record's data survives — this is a targeted field clear, not a wipe.
    const d1Update = updates.find((u) => u.ops.some((o) => o[0] === "eq" && o[1] === "id" && o[2] === "d1"));
    expect(d1Update.ops.find((o) => o[0] === "update")[1].data).toEqual({ projectId: null, title: "A", markups: [1] });
  });

  it("a row whose record disagrees with the group being purged is left alone (its data is untouched, only the mirror column is cleared)", async () => {
    h.selectRows = [{ id: "d3", data: { projectId: "some-other-project", title: "C" } }];
    const r = await unfileReviewsForDeletedProject("smtov116eka7");
    expect(r).toEqual({ ok: true, unfiled: 1 });
    const payload = updateCalls()[0].ops.find((o) => o[0] === "update")[1];
    expect(payload.project_id).toBeNull();
    expect(payload.data).toEqual({ projectId: "some-other-project", title: "C" });
  });

  it("a row with no data payload at all still clears the flat mirror without throwing", async () => {
    h.selectRows = [{ id: "d4", data: null }];
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r).toEqual({ ok: true, unfiled: 1 });
    const payload = updateCalls()[0].ops.find((o) => o[0] === "update")[1];
    expect(payload).toEqual({ project_id: null, data: null });
  });

  it("a failed SELECT is reported, never swallowed, and issues no updates", async () => {
    h.selectError = { message: "network down" };
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
    expect(updateCalls()).toHaveLength(0);
  });

  it("a failed per-row UPDATE is reported, never swallowed", async () => {
    h.selectRows = [{ id: "d1", data: { projectId: "group-1" } }];
    h.updateError = { message: "write failed" };
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r.ok).toBe(false);
    expect(r.unfiled).toBe(0);
    expect(r.error).toBe("write failed");
  });

  it("a thrown error is caught and reported, never propagates", async () => {
    h.throwSync = true;
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
});
