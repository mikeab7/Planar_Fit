import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1340368 — docProjectLiveness is the shared "is this doc's filed project actually still
 * live" check behind the Dashboard's Last-document card and Library Home's Pinned/Recent
 * lists. Mock the supabase client the same way test/deletedProjectGate.test.js already does
 * for cloudCheckDeleted — `h.rows` is the in-memory `sites` table, queried via `.in()` here
 * rather than `.eq()` (this module batches many candidate ids into two round trips).
 */
const h = vi.hoisted(() => ({ rows: [], error: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (field, vals) => Promise.resolve({
          data: h.error ? null : h.rows.filter((r) => r && vals.includes(r[field])),
          error: h.error,
        }),
      }),
    }),
  },
}));

import { liveProjectIds, docProjectIsDead } from "../src/shared/projects/docProjectLiveness.js";

describe("liveProjectIds — batched group-aware liveness, mirrors cloudCheckDeleted's own rule", () => {
  beforeEach(() => { h.rows = []; h.error = null; });

  it("no candidates → empty set, no query", async () => {
    const live = await liveProjectIds([]);
    expect(live.size).toBe(0);
  });

  it("a live row (matched by its own id) is live", async () => {
    h.rows = [{ id: "p1", group_id: "p1", deleted_at: null }];
    const live = await liveProjectIds(["p1"]);
    expect(live.has("p1")).toBe(true);
  });

  it("an anchor soft-deleted but a live sibling in its group (the B1164192 shape) still reads the GROUP id live", async () => {
    h.rows = [
      { id: "anchor", group_id: "anchor", deleted_at: "2026-08-29T00:00:00Z" },
      { id: "sibling", group_id: "anchor", deleted_at: null },
    ];
    const live = await liveProjectIds(["anchor"]);
    expect(live.has("anchor")).toBe(true);
  });

  it("a project id with NO trace anywhere (hard-purged or never real) is not live", async () => {
    h.rows = [];
    const live = await liveProjectIds(["gone"]);
    expect(live.has("gone")).toBe(false);
  });

  it("a project id whose every row is soft-deleted is not live", async () => {
    h.rows = [{ id: "dead", group_id: "dead", deleted_at: "2026-08-01T00:00:00Z" }];
    const live = await liveProjectIds(["dead"]);
    expect(live.has("dead")).toBe(false);
  });

  it("batches several distinct candidates in one pass, live and dead correctly separated", async () => {
    h.rows = [
      { id: "alive1", group_id: "alive1", deleted_at: null },
      { id: "alive2", group_id: "alive2", deleted_at: null },
      { id: "dead1", group_id: "dead1", deleted_at: "2026-08-01T00:00:00Z" },
    ];
    const live = await liveProjectIds(["alive1", "alive2", "dead1", "never-existed"]);
    expect([...live].sort()).toEqual(["alive1", "alive2"]);
  });

  it("dedupes candidate ids before querying", async () => {
    h.rows = [{ id: "p1", group_id: "p1", deleted_at: null }];
    const live = await liveProjectIds(["p1", "p1", "p1"]);
    expect(live.has("p1")).toBe(true);
  });

  it("throws on a real fetch error — never silently reports 'none live'", async () => {
    h.error = { message: "network down" };
    await expect(liveProjectIds(["p1"])).rejects.toThrow();
  });
});

describe("docProjectIsDead — the pure per-doc predicate, given a resolved liveIds Set", () => {
  it("a doc with no project_id is never dead — nothing to go stale", () => {
    expect(docProjectIsDead({ project_id: null }, new Set())).toBe(false);
  });

  it("a falsy doc is not itself 'project dead' — that's a separate 'not found' question for the caller", () => {
    expect(docProjectIsDead(null, new Set(["x"]))).toBe(false);
  });

  it("a filed doc whose project is in the live set is not dead", () => {
    expect(docProjectIsDead({ project_id: "p1" }, new Set(["p1"]))).toBe(false);
  });

  it("a filed doc whose project is NOT in the live set is dead", () => {
    expect(docProjectIsDead({ project_id: "p1" }, new Set(["other"]))).toBe(true);
  });

  it("no liveIds info at all (null — check not yet run / failed) fails OPEN, never dead on a maybe", () => {
    expect(docProjectIsDead({ project_id: "p1" }, null)).toBe(false);
  });
});
