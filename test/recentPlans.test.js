import { describe, it, expect } from "vitest";
import { pickRecentPlans } from "../src/workspaces/dashboard/lib/recentPlans.js";

const row = (over) => ({ id: "s1", group_id: "g1", site: "My Plan", name: null, updated_at: "2026-09-01T00:00:00Z", thumbnail_svg: null, ...over });

describe("pickRecentPlans", () => {
  it("takes the top `limit` rows in the order given (the fetch already sorts newest-first)", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" }), row({ id: "d" }), row({ id: "e" })];
    expect(pickRecentPlans(rows, 4).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("prefers the `site` field for the display name, falling back to `name`, then Untitled", () => {
    expect(pickRecentPlans([row({ site: "Bain", name: "ignored" })], 1)[0].name).toBe("Bain");
    expect(pickRecentPlans([row({ site: null, name: "Only name" })], 1)[0].name).toBe("Only name");
    expect(pickRecentPlans([row({ site: null, name: null })], 1)[0].name).toBe("Untitled");
    expect(pickRecentPlans([row({ site: "  " })], 1)[0].name).toBe("Untitled");
  });

  it("groupId falls back to id for a plan with no group_id", () => {
    expect(pickRecentPlans([row({ group_id: null })], 1)[0].groupId).toBe("s1");
  });

  it("passes thumbnail_svg through as null (never generated), '' (nothing drawable), or the real string", () => {
    expect(pickRecentPlans([row({ thumbnail_svg: null })], 1)[0].thumbnailSvg).toBeNull();
    expect(pickRecentPlans([row({ thumbnail_svg: "" })], 1)[0].thumbnailSvg).toBe("");
    expect(pickRecentPlans([row({ thumbnail_svg: "<svg/>" })], 1)[0].thumbnailSvg).toBe("<svg/>");
  });

  it("handles empty/missing input without throwing", () => {
    expect(pickRecentPlans(null, 4)).toEqual([]);
    expect(pickRecentPlans([], 4)).toEqual([]);
    expect(pickRecentPlans([null, undefined, { id: "ok" }], 4)).toHaveLength(1);
  });
});
