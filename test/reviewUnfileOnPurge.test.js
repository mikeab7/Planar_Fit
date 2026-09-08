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
 * Same minimal chainable supabase mock as test/reviewDeleteSafety.test.js.
 */
const h = vi.hoisted(() => ({
  exec: () => ({ data: [], error: null }),
  calls: [],
}));

function builder(table) {
  const ops = [];
  const settle = () => { const r = h.exec({ table, ops }); h.calls.push({ table, ops }); return r; };
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

const callsFor = (table) => h.calls.filter((c) => c.table === table);

beforeEach(() => { h.calls = []; h.exec = () => ({ data: [], error: null }); });

describe("unfileReviewsForDeletedProject", () => {
  it("no groupId → a no-op, never queries anything", async () => {
    const r = await unfileReviewsForDeletedProject(null);
    expect(r).toEqual({ ok: true, unfiled: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it("nulls project_id for every doc_reviews row filed under the group, scoped by eq(project_id, groupId)", async () => {
    h.exec = () => ({ data: [{ id: "d1" }, { id: "d2" }], error: null });
    const r = await unfileReviewsForDeletedProject("smtov116eka7");
    expect(r).toEqual({ ok: true, unfiled: 2 });
    const call = callsFor("doc_reviews")[0];
    expect(call.ops[0]).toEqual(["update", { project_id: null }]);
    expect(call.ops.some((o) => o[0] === "eq" && o[1] === "project_id" && o[2] === "smtov116eka7")).toBe(true);
  });

  it("nothing filed under the group → ok:true, unfiled:0", async () => {
    h.exec = () => ({ data: [], error: null });
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r).toEqual({ ok: true, unfiled: 0 });
  });

  it("a real write failure is reported, never swallowed", async () => {
    h.exec = () => ({ data: null, error: { message: "network down" } });
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
  });

  it("a thrown error is caught and reported, never propagates", async () => {
    h.exec = () => { throw new Error("boom"); };
    const r = await unfileReviewsForDeletedProject("group-1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
});
