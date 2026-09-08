import { describe, it, expect, beforeEach, vi } from "vitest";

/* ⛔ B1303824 (OWNER-BLOCKING, 2026-09-07) — deleting a project whose plans this device's local
 * cache has never cached (created on another device/session, or a cloud pull that hasn't landed
 * here yet) used to report a clean `{ok:true, removed:0}` with ZERO network traffic — a real,
 * live cloud project read as "deleted" in the switcher and never actually moved. Measured live:
 * 3/3 delete attempts on two real projects produced only GET traffic, `sites.deleted_at` never
 * moved, and the project stayed listed after a hard reload.
 *
 * Proven here against a REAL mocked Supabase client (same pattern as
 * test/deletedProjectGate.test.js) so the assertion is a genuine round trip through
 * `deleteSiteGroup` → `cloudDeleteGroup`, not a stand-in for it.
 *
 * RED-PROOF: reverting storage.js's `deleteSiteGroup` to its pre-fix body —
 *   if (!plans.length) return Promise.resolve({ ok: true, removed: 0 });
 * — turns "issues a write" red on every case below while `removed:0` stays true, exactly the
 * false-success shape the owner measured live.
 */
const h = vi.hoisted(() => ({ rows: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (field, val) => Promise.resolve({ data: h.rows.filter((r) => r && r[field] === val), error: null }),
      }),
      update: (patch) => ({
        eq: (field, val) => ({
          select: async () => {
            const matched = h.rows.filter((r) => r && r[field] === val);
            matched.forEach((r) => Object.assign(r, patch));
            return { data: matched.map((r) => ({ id: r.id })), error: null };
          },
        }),
      }),
    }),
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: () => {} }));

import { deleteSiteGroup, setActiveUser, saveSite, loadPlansOfGroup } from "../src/workspaces/site-planner/lib/storage.js";

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

describe("deleteSiteGroup — the cloud fallback for a group this device's cache never cached (B1303824)", () => {
  beforeEach(() => {
    mockLocalStorage();
    h.rows = [];
    setActiveUser("owner-uid-1"); // signed in
  });

  it("a group with a live cloud row but NO local plans issues a real soft-delete write", async () => {
    // The row is real in the cloud (another device/session created it, or it just hasn't been
    // pulled here yet) but this browser's localStorage cache has never seen it.
    h.rows = [{ id: "ghost-g1", group_id: "ghost-g1", site: "Untitled site", deleted_at: null }];
    expect(loadPlansOfGroup("ghost-g1")).toHaveLength(0); // the local-cache-empty precondition

    const res = await deleteSiteGroup("ghost-g1");

    expect(res.ok).toBe(true);
    expect(res.removed).toBe(1);
    expect(h.rows[0].deleted_at).not.toBeNull(); // the write actually landed
  });

  it("a multi-plan cloud group (anchor + siblings) is fully soft-deleted by group id", async () => {
    h.rows = [
      { id: "ghost-g2", group_id: "ghost-g2", site: "Multi Plan", deleted_at: null },
      { id: "ghost-g2-p2", group_id: "ghost-g2", site: "Multi Plan", deleted_at: null },
    ];
    const res = await deleteSiteGroup("ghost-g2");
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(2);
    expect(h.rows.every((r) => r.deleted_at)).toBe(true);
  });

  it("nothing locally AND nothing in the cloud is a clean, honest no-op", async () => {
    const res = await deleteSiteGroup("truly-nonexistent");
    expect(res).toEqual({ ok: true, removed: 0 });
  });

  it("signed OUT, an empty local cache stays a clean no-op (no cloud call attempted)", async () => {
    setActiveUser(null);
    h.rows = [{ id: "ghost-g3", group_id: "ghost-g3", site: "Should not be touched", deleted_at: null }];
    const res = await deleteSiteGroup("ghost-g3");
    expect(res).toEqual({ ok: true, removed: 0 });
    expect(h.rows[0].deleted_at).toBeNull(); // never touched — signed out has no account to ask
  });

  it("a group WITH local plans still deletes through the ordinary per-plan path (unaffected)", async () => {
    saveSite({ id: "local-g1", groupId: "local-g1", site: "Cached Plan", els: [] });
    h.rows = [{ id: "local-g1", group_id: "local-g1", site: "Cached Plan", deleted_at: null }];
    const res = await deleteSiteGroup("local-g1");
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(1);
    expect(h.rows[0].deleted_at).not.toBeNull();
    expect(loadPlansOfGroup("local-g1")).toHaveLength(0);
  });
});
