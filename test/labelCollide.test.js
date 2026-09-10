import { describe, it, expect } from "vitest";
import { boxesOverlap, resolveLabelVisibility } from "../src/workspaces/dashboard/lib/labelCollide.js";

const box = (left, top, right, bottom) => ({ left, top, right, bottom });

describe("boxesOverlap", () => {
  it("reports overlapping boxes as colliding", () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
  });

  it("reports disjoint boxes as clear", () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(false);
  });

  it("honors a padding budget — near-misses inside the pad still count as colliding", () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10), 0)).toBe(false);
    expect(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10), 4)).toBe(true);
  });
});

describe("resolveLabelVisibility", () => {
  it("shows every label when none collide", () => {
    const items = [
      { id: "a", kind: "active", box: box(0, 0, 10, 10) },
      { id: "b", kind: "pursuit", box: box(50, 0, 60, 10) },
    ];
    expect(resolveLabelVisibility(items)).toEqual(new Set(["a", "b"]));
  });

  it("owner report — two colliding pins ('Goose Creek and Grand Port') keep only one label", () => {
    const items = [
      { id: "goose-creek", kind: "pursuit", box: box(0, 0, 40, 10) },
      { id: "grand-port", kind: "pursuit", box: box(2, 1, 42, 11) },
    ];
    const visible = resolveLabelVisibility(items);
    expect(visible.size).toBe(1);
  });

  it("active always wins over pursuit on a collision, regardless of input order", () => {
    const collidingPursuitFirst = [
      { id: "pursuit-1", kind: "pursuit", box: box(0, 0, 40, 10) },
      { id: "active-1", kind: "active", box: box(2, 1, 42, 11) },
    ];
    expect(resolveLabelVisibility(collidingPursuitFirst)).toEqual(new Set(["active-1"]));

    const collidingActiveFirst = [
      { id: "active-1", kind: "active", box: box(2, 1, 42, 11) },
      { id: "pursuit-1", kind: "pursuit", box: box(0, 0, 40, 10) },
    ];
    expect(resolveLabelVisibility(collidingActiveFirst)).toEqual(new Set(["active-1"]));
  });

  it("two colliding actives: one wins, never zero", () => {
    const items = [
      { id: "active-1", kind: "active", box: box(0, 0, 40, 10) },
      { id: "active-2", kind: "active", box: box(2, 1, 42, 11) },
    ];
    const visible = resolveLabelVisibility(items);
    expect(visible.size).toBe(1);
  });

  it("a label that lost a collision can still win against a THIRD label with room", () => {
    // active-1 and pursuit-1 collide (pursuit-1 loses); pursuit-2 sits clear of both.
    const items = [
      { id: "active-1", kind: "active", box: box(0, 0, 40, 10) },
      { id: "pursuit-1", kind: "pursuit", box: box(2, 1, 42, 11) },
      { id: "pursuit-2", kind: "pursuit", box: box(100, 0, 140, 10) },
    ];
    expect(resolveLabelVisibility(items)).toEqual(new Set(["active-1", "pursuit-2"]));
  });

  it("respects the padding budget passed through", () => {
    const items = [
      { id: "a", kind: "active", box: box(0, 0, 10, 10) },
      { id: "b", kind: "pursuit", box: box(11, 0, 20, 10) },
    ];
    expect(resolveLabelVisibility(items, 0)).toEqual(new Set(["a", "b"]));
    expect(resolveLabelVisibility(items, 4)).toEqual(new Set(["a"]));
  });

  it("handles empty/missing input without throwing", () => {
    expect(resolveLabelVisibility([])).toEqual(new Set());
    expect(resolveLabelVisibility(null)).toEqual(new Set());
  });
});
