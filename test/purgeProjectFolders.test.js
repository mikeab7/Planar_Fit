import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1235169 — "Delete forever" and the 30-day expiry purge abandoned a purged project's
 * `project_folders` rows and its Google Drive folder tree: `cloudHardDelete` only ever removed the
 * `sites` row, and nothing else in storage.js ever referenced `project_folders` at all. Measured on
 * production: 15 abandoned Drive trees, 1,995 real folders, none with a surviving `sites` or
 * `project_folders` row.
 *
 * This proves the WIRING in storage.js's purgeDeletedProject / purgeExpiredDeletedProjects: one
 * folder purge per site GROUP (a project is a group, never a single plan — `project_folders.
 * project_id` is the group id), best-effort (a folder-purge failure must never fail the sites purge
 * that already genuinely happened), and LOUD on failure (reportClientEvent), never silent. The
 * folder/Drive purge mechanics themselves (deleting rows, resolving + trashing the Drive root) are
 * covered separately: folderMirror.test.js (`purgeProjectDrive`, server-side) and the client
 * wrapper's own contract is exercised through this mock.
 */
const h = vi.hoisted(() => ({
  cloudDeletedRowsResult: { ok: true, supported: true, rows: [] },
  hardDeleteResults: {},
  purgeProjectFoldersResult: { ok: true, rowsDeleted: true, driveTrashed: true },
  // B1164193 — defaults to "the group is genuinely gone" (no live plans left), which is what
  // every PRE-EXISTING test below assumes; the new live-siblings tests override it per case.
  cloudCheckDeletedResult: { ok: true, exists: false, deleted: false },
  // B1340368 — the same "genuinely gone" confirmation is also what unfiles any Doc Review
  // documents still filed under the purged group (project_id → null).
  unfileResult: { ok: true, unfiled: 0 },
}));

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => []),
  cloudDeletedRows: vi.fn(async () => h.cloudDeletedRowsResult),
  cloudUpsert: vi.fn(async () => ({ ok: true })),
  cloudDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudHardDelete: vi.fn(async (uid, id) => h.hardDeleteResults[id] || { ok: true, removed: 1 }),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => h.cloudCheckDeletedResult),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));
vi.mock("../src/workspaces/library/lib/folders.js", () => ({
  purgeProjectFolders: vi.fn(async () => h.purgeProjectFoldersResult),
}));
vi.mock("../src/workspaces/doc-review/lib/reviewStore.js", () => ({
  unfileReviewsForDeletedProject: vi.fn(async () => h.unfileResult),
}));

import { purgeDeletedProject, purgeExpiredDeletedProjects, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import { purgeProjectFolders } from "../src/workspaces/library/lib/folders.js";
import { unfileReviewsForDeletedProject } from "../src/workspaces/doc-review/lib/reviewStore.js";

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
  h.hardDeleteResults = {};
  h.purgeProjectFoldersResult = { ok: true, rowsDeleted: true, driveTrashed: true };
  h.cloudCheckDeletedResult = { ok: true, exists: false, deleted: false };
  h.unfileResult = { ok: true, unfiled: 0 };
  vi.clearAllMocks();
  setActiveUser("u-owner");
});

describe("purgeDeletedProject — purges the project's folder tree ONCE per group (B1235169)", () => {
  it("passes the explicit groupId through to the folder purge, once, even for a multi-plan group", async () => {
    const r = await purgeDeletedProject(["plan-a", "plan-b"], "group-1");
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(2);
    expect(purgeProjectFolders).toHaveBeenCalledTimes(1);
    expect(purgeProjectFolders).toHaveBeenCalledWith("group-1");
  });

  it("defaults to the first purged id when no groupId is given (a fresh single-plan project's group anchors on its own id)", async () => {
    await purgeDeletedProject(["plan-solo"]);
    expect(purgeProjectFolders).toHaveBeenCalledWith("plan-solo");
  });

  it("a folder-purge failure is reported LOUDLY but never fails the sites purge that already happened", async () => {
    h.purgeProjectFoldersResult = { ok: false, error: "Drive unreachable" };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(true); // the sites purge succeeded — that's what `ok` reports
    expect(r.purged).toBe(1);
    expect(reportClientEvent).toHaveBeenCalledWith(
      "project-folder-purge-failed",
      expect.any(String),
      expect.objectContaining({ groupId: "group-1", error: "Drive unreachable" }),
    );
  });

  it("never attempts a folder purge when nothing was actually purged", async () => {
    h.hardDeleteResults["plan-a"] = { ok: false, error: "network down" };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(false);
    expect(r.purged).toBe(0);
    expect(purgeProjectFolders).not.toHaveBeenCalled();
  });
});

/* B1164193 (found while investigating B1164192, "Richfield reads as deleted") — a purge must
 * never destroy a project's shared Drive folder tree while the project still has LIVE plans
 * hanging off the same group. This is the exact shape measured live on the owner's account
 * ("Richfield", "Woods Road": one soft-deleted plan sharing a group with several live ones) —
 * closed here so a "Delete forever" or the 30-day expiry sweep on that ONE plan can never cascade
 * into trashing the shared folder tree the still-open siblings depend on.
 */
describe("purgeProjectFoldersFor — never purges a project's shared folders while the group still has live plans (B1164193)", () => {
  it("purgeDeletedProject skips the folder/Drive purge and reports it LOUDLY when the group still has a live plan", async () => {
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: false };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(true); // the sites purge of the one named plan still succeeded
    expect(r.purged).toBe(1);
    expect(purgeProjectFolders).not.toHaveBeenCalled();
    expect(reportClientEvent).toHaveBeenCalledWith(
      "project-folder-purge-skipped",
      expect.any(String),
      expect.objectContaining({ groupId: "group-1" }),
    );
  });

  /* ⛔ B1469872 (owner report, 2026-09-10) — this test used to assert the OLD, wrong behaviour:
   * that the expired plan row itself was still hard-deleted here ("the one expired anchor plan is
   * still hard-deleted"), with only the folder/Drive cascade held back. That was the live data-loss
   * bug — `listDeletedProjects` already refuses to SHOW a live-group plan as deleted, but this
   * function still DESTROYED it on schedule with no restore ever having been offered anywhere.
   * `purgeExpiredDeletedProjects` now asks `groupStillHasLivePlans` (the SAME helper this describe
   * block already covers for the folder cascade) before hard-deleting the ROW at all, not just
   * before touching its shared folders — see storage.js's own header on the fix. */
  it("purgeExpiredDeletedProjects leaves an expired plan's ROW alone (not just its folders) while its group still has live siblings", async () => {
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: false };
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [{ id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() }],
    };
    const r = await purgeExpiredDeletedProjects();
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(0);   // the row itself is left soft-deleted, not destroyed
    expect(r.skipped).toBe(1);  // — and the skip is counted, not silently dropped
    expect(purgeProjectFolders).not.toHaveBeenCalled(); // its still-live siblings' folders are untouched too
    expect(reportClientEvent).toHaveBeenCalledWith(
      "plan-purge-skipped-live-group",
      expect.any(String),
      expect.objectContaining({ id: "smsdrvzr9gzx", groupId: "smsdrvzr9gzx" }),
    );
  });

  it("still purges the folder tree once the whole group is genuinely gone (no live plans left)", async () => {
    h.cloudCheckDeletedResult = { ok: true, exists: false, deleted: false };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.purged).toBe(1);
    expect(purgeProjectFolders).toHaveBeenCalledWith("group-1");
  });

  it("fails SAFE — an inconclusive liveness check skips the purge rather than risking it on a maybe", async () => {
    h.cloudCheckDeletedResult = { ok: false };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.purged).toBe(1);
    expect(purgeProjectFolders).not.toHaveBeenCalled();
    expect(reportClientEvent).toHaveBeenCalledWith("project-folder-purge-skipped", expect.any(String), expect.objectContaining({ groupId: "group-1" }));
  });
});

/* B1340368 (found while checking whether the same stale-pointer pattern feeds any other
 * surface than the Dashboard's Last-document card) — a project purge must clear any Doc
 * Review documents still filed under that group, or they keep pointing at a group id nothing
 * can ever resolve live again. Uses the SAME "genuinely gone" confirmation this file's
 * B1164193 tests already exercise for the folder purge — never a second liveness question. */
describe("purgeProjectFoldersFor — unfiles Doc Review documents once the group is genuinely gone (B1340368)", () => {
  it("unfiles documents filed under a group once it has no live plans left", async () => {
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.purged).toBe(1);
    expect(unfileReviewsForDeletedProject).toHaveBeenCalledWith("group-1");
  });

  it("never unfiles anything while the group still has a live plan — same guard as the folder purge", async () => {
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: false };
    await purgeDeletedProject(["plan-a"], "group-1");
    expect(unfileReviewsForDeletedProject).not.toHaveBeenCalled();
  });

  it("an inconclusive liveness check skips unfiling too — fails safe, same as the folder purge", async () => {
    h.cloudCheckDeletedResult = { ok: false };
    await purgeDeletedProject(["plan-a"], "group-1");
    expect(unfileReviewsForDeletedProject).not.toHaveBeenCalled();
  });

  it("an unfiling failure is reported LOUDLY but never fails the sites purge that already happened", async () => {
    h.unfileResult = { ok: false, error: "network down" };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(true);
    expect(reportClientEvent).toHaveBeenCalledWith(
      "doc-review-unfile-failed",
      expect.any(String),
      expect.objectContaining({ groupId: "group-1", error: "network down" }),
    );
  });

  it("runs for the expiry sweep too, once per distinct group", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
        { id: "plan-c", group_id: "group-2", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    };
    await purgeExpiredDeletedProjects();
    expect(unfileReviewsForDeletedProject).toHaveBeenCalledTimes(2);
    expect(unfileReviewsForDeletedProject.mock.calls.map((c) => c[0]).sort()).toEqual(["group-1", "group-2"]);
  });
});

describe("purgeExpiredDeletedProjects — one folder purge per GROUP, not per plan (B1235169)", () => {
  it("purges the folder tree once even when several plans of the same group expire together", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
        { id: "plan-b", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    };
    const r = await purgeExpiredDeletedProjects();
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(2);
    expect(purgeProjectFolders).toHaveBeenCalledTimes(1);
    expect(purgeProjectFolders).toHaveBeenCalledWith("group-1");
  });

  it("purges each distinct group's folders separately", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
        { id: "plan-c", group_id: "group-2", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    };
    await purgeExpiredDeletedProjects();
    expect(purgeProjectFolders).toHaveBeenCalledTimes(2);
    expect(purgeProjectFolders.mock.calls.map((c) => c[0]).sort()).toEqual(["group-1", "group-2"]);
  });

  it("falls back to the row's own id when it carries no group_id", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [{ id: "plan-solo", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() }],
    };
    await purgeExpiredDeletedProjects();
    expect(purgeProjectFolders).toHaveBeenCalledWith("plan-solo");
  });
});
