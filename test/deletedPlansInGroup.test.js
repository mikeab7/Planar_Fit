import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1469872 (owner report, 2026-09-10) — "a plan binned inside a live project is invisible in the
 * bin but hard-deleted at 30 days." `listDeletedProjects()` already refuses to list a project as
 * deleted while its group still has a live plan (B1336576); `listDeletedPlansInGroup` is the real,
 * reachable surface for exactly the plans that filter hides — the site-planner workspace's plan
 * menu's own "Recently deleted" section. See storage.js's own headers on both functions.
 */
const h = vi.hoisted(() => ({
  cloudDeletedRowsResult: { ok: true, supported: true, rows: [] },
}));

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => []),
  cloudDeletedRows: vi.fn(async () => h.cloudDeletedRowsResult),
  cloudUpsert: vi.fn(async () => ({ ok: true })),
  cloudDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudHardDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => ({ ok: true, exists: false, deleted: false })),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));

import { listDeletedPlansInGroup, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  h.cloudDeletedRowsResult = { ok: true, supported: true, rows: [] };
  vi.clearAllMocks();
  setActiveUser("u-owner");
});

describe("listDeletedPlansInGroup — the per-project plan trash", () => {
  it("returns only the soft-deleted rows belonging to the requested group", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", site: "Concept A", deleted_at: "2026-08-12T19:49:01.000Z" },
        { id: "plan-b", group_id: "group-2", site: "Other project", deleted_at: "2026-08-13T00:00:00.000Z" },
      ],
    };
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(true);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0]).toMatchObject({ id: "plan-a", name: "Concept A" });
  });

  it("falls back to a row's own id as its group when it carries no group_id (a fresh single-plan project's anchor)", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [{ id: "solo-anchor", group_id: null, site: "Solo", deleted_at: "2026-08-12T00:00:00.000Z" }],
    };
    const r = await listDeletedPlansInGroup("solo-anchor");
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].id).toBe("solo-anchor");
  });

  it("names an untitled row instead of leaving it blank", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [{ id: "plan-a", group_id: "group-1", site: null, name: null, deleted_at: "2026-08-12T00:00:00.000Z" }],
    };
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.plans[0].name).toBe("Untitled plan");
  });

  it("sorts most-recently-deleted first", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "older", group_id: "group-1", site: "Older", deleted_at: "2026-08-01T00:00:00.000Z" },
        { id: "newer", group_id: "group-1", site: "Newer", deleted_at: "2026-08-20T00:00:00.000Z" },
      ],
    };
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.plans.map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("returns an empty, honest list when signed out or given no group", async () => {
    setActiveUser(null);
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(false);
    expect(r.plans).toEqual([]);
  });

  it("is honest about a failed fetch rather than reporting an empty list as a clean one", async () => {
    h.cloudDeletedRowsResult = { ok: false, supported: true, rows: [], error: "offline" };
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.ok).toBe(false);
    expect(r.plans).toEqual([]);
  });

  it("reports unsupported (pre-migration DB) rather than a false-empty bin", async () => {
    h.cloudDeletedRowsResult = { ok: true, supported: false, rows: [] };
    const r = await listDeletedPlansInGroup("group-1");
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(false);
    expect(r.plans).toEqual([]);
  });
});
