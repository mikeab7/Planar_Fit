import { describe, it, expect } from "vitest";
import { recentPlansLayoutMode, countForMode, MIN_THUMB_PX } from "../src/workspaces/dashboard/lib/recentPlansLayout.js";

describe("recentPlansLayoutMode", () => {
  it("picks the full 2x2 grid at a generous size", () => {
    expect(recentPlansLayoutMode({ width: 500, height: 400 })).toBe("grid2x2");
  });

  it("drops to two thumbnails when the card is too narrow for a 2x2 grid of recognizable thumbnails", () => {
    expect(recentPlansLayoutMode({ width: 150, height: 400 })).toBe("row2");
  });

  it("drops to two thumbnails when the card is too short for two full rows", () => {
    expect(recentPlansLayoutMode({ width: 500, height: 140 })).toBe("row2");
  });

  it("never throws on missing/invalid dimensions, and never picks grid2x2 for a zero-size box", () => {
    expect(recentPlansLayoutMode({})).toBe("row2");
    expect(recentPlansLayoutMode({ width: NaN, height: undefined })).toBe("row2");
  });

  it("a 2x2 cell width at the chosen threshold never renders a thumbnail smaller than MIN_THUMB_PX", () => {
    // The narrowest width that still returns grid2x2 must yield a cell >= MIN_THUMB_PX.
    for (let w = 50; w <= 600; w += 5) {
      const mode = recentPlansLayoutMode({ width: w, height: 500 });
      if (mode === "grid2x2") {
        const cellW = (w - 10) / 2;
        expect(cellW).toBeGreaterThanOrEqual(MIN_THUMB_PX);
      }
    }
  });
});

describe("countForMode", () => {
  it("grid2x2 shows four, row2 shows two", () => {
    expect(countForMode("grid2x2")).toBe(4);
    expect(countForMode("row2")).toBe(2);
  });
});
