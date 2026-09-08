import { describe, it, expect } from "vitest";
import { planThumbnailSvg } from "../src/workspaces/site-planner/lib/planThumbnail.js";

const boundary = { id: "p1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] };
const building = { id: "e1", type: "building", cx: 20, cy: 20, w: 30, h: 20, rot: 0 };

describe("planThumbnailSvg", () => {
  it("returns null for a missing model", () => {
    expect(planThumbnailSvg(null)).toBeNull();
  });

  it("returns null for a model with nothing drawable (no parcels, no elements)", () => {
    expect(planThumbnailSvg({ id: "s1", parcels: [], els: [] })).toBeNull();
  });

  it("renders a boundary-only plan as a single stroked path, no fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [boundary], els: [] });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("<path");
    expect((svg.match(/<path/g) || []).length).toBe(1);
    expect(svg).toContain('fill="none"');
  });

  it("renders a building element filled with the building TYPE color", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [building] });
    expect(svg).toContain("#f3ece1"); // TYPE.building.fill, planStyle.js
  });

  it("excludes an inactive parcel from the boundary", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [{ ...boundary, active: false }], els: [building] });
    // only the building path should be present
    expect((svg.match(/<path/g) || []).length).toBe(1);
  });

  it("excludes an element whose type has no style entry, rather than drawing an undefined fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [{ id: "x", type: "not-a-real-type", cx: 0, cy: 0, w: 10, h: 10 }] });
    expect(svg).toBeNull();
  });

  it("respects a per-parcel custom fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [{ ...boundary, fill: "#123456", fillOpacity: 0.4 }], els: [] });
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill-opacity="0.4"');
  });

  it("draws elements in z/type-band order (road under building)", () => {
    const road = { id: "r1", type: "road", pts: [{ x: 0, y: 40 }, { x: 100, y: 40 }], travelW: 24, curb: 1 };
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [building, road] });
    // road (Z_LAYER 0) must be painted before building (Z_LAYER 5)
    expect(svg.indexOf("#b9b4a8")).toBeGreaterThan(-1); // TYPE.road.fill
    expect(svg.indexOf("#b9b4a8")).toBeLessThan(svg.indexOf("#f3ece1"));
  });

  it("never throws on malformed element geometry", () => {
    expect(() => planThumbnailSvg({ id: "s1", parcels: [], els: [{ id: "e", type: "building" }, null, {}] })).not.toThrow();
  });
});
