import { describe, it, expect } from "vitest";
import { pressIsAboveLayer, layersOf, MENU_LAYER_ATTR } from "../src/shared/ui/menuLayers.js";

/* ⛔ B1358128 — the verdict behind "a press inside the menu stacked above me is not a press
 * outside me". Its absence is what closed the project switcher the moment its own per-row
 * Rename/Delete menu was pressed, which erased that menu's target mid-gesture and turned project
 * delete into a silent no-op (and Rename into nothing at all). Pure, so the rule is pinned here
 * and the browser half only has to prove it is WIRED (e2e/menu-layer-nesting.spec.js). */
describe("menuLayers — which overlay a press belongs to", () => {
  it("a press inside a STRICTLY higher layer belongs to that layer", () => {
    expect(pressIsAboveLayer([5000], 4000)).toBe(true);
    expect(pressIsAboveLayer([4000, 5001], 4000)).toBe(true);
  });
  it("a SIBLING menu at the same level does NOT count as above — it must still dismiss me", () => {
    // The property that keeps "open one menu, click another menu's trigger" working.
    expect(pressIsAboveLayer([4000], 4000)).toBe(false);
    expect(pressIsAboveLayer([3000], 4000)).toBe(false);
  });
  it("a press in no menu at all is an outside press", () => {
    expect(pressIsAboveLayer([], 4000)).toBe(false);
    expect(pressIsAboveLayer(null, 4000)).toBe(false);
  });
  it("junk values never accidentally suppress a dismissal", () => {
    expect(pressIsAboveLayer(["", "abc", null, undefined, NaN], 4000)).toBe(false);
    expect(pressIsAboveLayer([5000], "not-a-number")).toBe(false);
  });
  it("layersOf walks the ancestor chain and ignores unmarked nodes", () => {
    const mk = (attr, parent) => ({
      getAttribute: (k) => (k === MENU_LAYER_ATTR ? attr : null),
      parentElement: parent || null,
    });
    const outer = mk("4000", null);
    const middle = mk(null, outer);
    const inner = mk("5001", middle);
    expect(layersOf(inner)).toEqual(["5001", "4000"]);
    expect(layersOf(null)).toEqual([]);
  });
});
