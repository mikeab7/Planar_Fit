/* B1340368 — scripts/audit-orphan-doc-reviews.mjs's own pure half: `statusByProjectId` folds
 * `sites` rows into a per-project-id liveness status keyed by EITHER a row's own `id` (a
 * legacy/solo project) or its `group_id` (the ordinary case), reusing audit-orphan-folders.mjs's
 * `bucketFor` verbatim rather than a second copy of the same live/soft_deleted/never_existed rule.
 */
import { describe, it, expect } from "vitest";
import { bucketFor } from "../scripts/audit-orphan-folders.mjs";
import { statusByProjectId } from "../scripts/audit-orphan-doc-reviews.mjs";

describe("statusByProjectId", () => {
  it("no sites row at all for a given project id → undefined status → never_existed", () => {
    const status = statusByProjectId([{ id: "other", group_id: "other", deleted_at: null }]);
    expect(bucketFor(status.get("gone"))).toBe("never_existed");
  });

  it("a solo project matched by its own id (no distinct group_id) reads live", () => {
    const status = statusByProjectId([{ id: "solo", group_id: "solo", deleted_at: null }]);
    expect(bucketFor(status.get("solo"))).toBe("live");
  });

  it("the B1164192 shape — anchor soft-deleted, sibling live, matched by GROUP id — reads live", () => {
    const status = statusByProjectId([
      { id: "smsdrvzr9gzx", group_id: "smsdrvzr9gzx", deleted_at: "2026-08-29T00:00:00Z" },
      { id: "concept-b", group_id: "smsdrvzr9gzx", deleted_at: null },
    ]);
    expect(bucketFor(status.get("smsdrvzr9gzx"))).toBe("live");
  });

  it("every row for a project id soft-deleted → soft_deleted", () => {
    const status = statusByProjectId([{ id: "dead", group_id: "dead", deleted_at: "2026-08-01T00:00:00Z" }]);
    expect(bucketFor(status.get("dead"))).toBe("soft_deleted");
  });

  it("a project id matched only by a DIFFERENT row's own id (not its group_id) still resolves", () => {
    // A doc filed directly under one specific plan's id, where that plan is itself the anchor
    // and carries no separate group_id value distinct from its own id.
    const status = statusByProjectId([{ id: "plan-x", group_id: null, deleted_at: null }]);
    expect(bucketFor(status.get("plan-x"))).toBe("live");
  });

  it("empty sites table → every project id is never_existed", () => {
    const status = statusByProjectId([]);
    expect(bucketFor(status.get("anything"))).toBe("never_existed");
  });
});
