import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { placeMenu } from "../src/shared/ui/anchoredMenuPlacement.js";

/* NEW-1 (map-finder split-button audit, 2026-09-02) — both Map finder split-button caret menus
 * ("Select parcels" ▾ "Start blank" / "Place comp" ▾ On the map|On a parcel|On a site plan) used
 * to anchor their AnchoredMenu with `placement="below-left"`. AnchoredMenu positions off the
 * CARET button (the trailing, narrow half of the split control), and the caret's own right edge
 * IS the whole split control's right edge (it's the last flex segment) — so "below-left" left-
 * aligns the menu to the CARET's left edge, which sits deep inside the control, and a 200px panel
 * spills 178px out past the control's own right edge over open map with nothing under it.
 * "below-right" right-aligns the menu to the anchor's right edge instead, which is exactly the
 * control's right edge — the menu then reads as belonging to the button that opened it.
 *
 * This file has two halves: a SOURCE GUARD (both call sites in MapFinder.jsx actually pass
 * "below-right", not "below-left") and a PURE MATH proof, using the real rects measured on
 * deployed planyr.io (viewport 1600×465), that "below-right" lands the menu's right edge on the
 * control's right edge to within 1px — with a mutation check alongside it showing what
 * "below-left" would have produced (the reported ~178px overhang), so the assertion is proven to
 * actually distinguish the fixed behavior from the broken one, not just from "some other number".
 */

const SRC = fileURLToPath(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url));

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Pull the <AnchoredMenu ...> opening tag (attributes only, up to the first `>`) that follows the
// given anchorRef, so the assertion reads the REAL prop value rather than assuming a marker's
// nearby text describes it.
function anchoredMenuTagFor(src, anchorRefName) {
  const clean = stripComments(src);
  const marker = `anchorRef={${anchorRefName}}`;
  const i = clean.indexOf(marker);
  if (i < 0) throw new Error(`marker not found: ${marker}`);
  const tagStart = clean.lastIndexOf("<AnchoredMenu", i);
  if (tagStart < 0) throw new Error(`<AnchoredMenu ...> not found before ${marker}`);
  const tagEnd = clean.indexOf(">", i);
  if (tagEnd < 0) throw new Error(`no closing '>' found for the <AnchoredMenu> tag opened for ${marker}`);
  return clean.slice(tagStart, tagEnd + 1);
}

describe("Map finder split-button menus — REMOVED, and they stay removed (NEW-1, 2026-09-08)", () => {
  /* ⛔ Both menus this file was written for are GONE. The map toolbar went ground-first: you point
   * at ground first (Select parcels · Draw · Drop a pin) and a decide bar then asks what it is,
   * with all three verbs live at once. "Start blank" became the first-class "Draw" button and the
   * three comp anchors became ordinary two-step paths, so neither caret nor either menu exists.
   * The source guard below is INVERTED rather than deleted: B1074768's real risk was a menu
   * anchored so it hangs off its own control, and the cheapest permanent form of that guarantee is
   * that these two controls do not come back. The pure placement math beneath it is kept as-is —
   * it proves `placeMenu`, which every OTHER AnchoredMenu in the app still relies on. */
  it("neither caret button nor its menu exists in MapFinder any more", () => {
    const code = stripComments(readFileSync(SRC, "utf8"));
    for (const gone of ["startBlankMenuBtnRef", "placeCompMenuBtnRef", "startBlankMenuOpen", "placeCompMenuOpen"]) {
      expect(code, `${gone} came back`).not.toContain(gone);
    }
  });

  it("the toolbar's own first-class Draw button is what replaced the caret's one menu item", () => {
    const code = stripComments(readFileSync(SRC, "utf8"));
    expect(code).toContain('data-testid="map-toolbar-draw"');
    expect(code).toContain("startBlankHere()");
  });

  // Proven against a known-broken fixture (WRONG-CASE / DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the
  // extractor the pure-math half still documents must actually catch the pre-fix shape, not merely
  // fail to find anything. Kept so the reasoning that produced B1074768's fix stays legible.
  it("extractor catches the pre-fix shape on a planted broken fixture", () => {
    const broken = `
      <AnchoredMenu open={startBlankMenuOpen} onClose={() => setStartBlankMenuOpen(false)}
        anchorRef={startBlankMenuBtnRef} placement="below-left" width={200} gap={6}
        zIndex={MAP_CHROME_Z.panel} panelStyle={menuPanelStyle}>
    `;
    const tag = anchoredMenuTagFor(broken, "startBlankMenuBtnRef");
    expect(tag).toMatch(/placement="below-left"/);
    expect(tag).not.toMatch(/placement="below-right"/);
  });
});

/* The rects below were measured live on deployed planyr.io at 1600×465 while these two controls
 * still existed. They are kept verbatim as a REGRESSION FIXTURE for `placeMenu` itself — real
 * numbers from a real split control, which is exactly the geometry (a narrow trailing caret whose
 * right edge is the whole control's right edge) that any future split button in this app would
 * reproduce. This half is not about the map toolbar any more; it is about the placement math. */
describe("AnchoredMenu placement math (pure, measured planyr.io split-control rects)", () => {
  // Site mode — "Select parcels" ▾ caret, measured live (viewport 1600×465):
  //   primary x887.3 w109.0 right 996.3 · caret x996.3 w22.0 right 1018.3 · control 887.3→1018.3
  const siteCaret = { left: 996.3, top: 72.9, right: 1018.3, bottom: 102.9, width: 22.0, height: 30 };
  const siteControlRight = 1018.3; // === siteCaret.right, by construction (caret is the trailing flex segment)

  // Comp mode — "Place comp" ▾ caret:
  //   primary x895.3 w92.9 right 988.2 · caret x988.2 w22 right 1010.2 · control 895.3→1010.2
  const compCaret = { left: 988.2, top: 72.9, right: 1010.2, bottom: 102.9, width: 22, height: 30 };
  const compControlRight = 1010.2; // === compCaret.right

  const VIEW = { viewportW: 1600, viewportH: 465 };
  const GAP = 6; // matches the gap={6} both call sites pass

  it("Select parcels: below-right lands menu.right within 1px of the control's right edge", () => {
    const p = placeMenu({ anchorRect: siteCaret, menuW: 148, menuH: 42.3, ...VIEW, placement: "below-right", gap: GAP, margin: 8 });
    expect(p).not.toBeNull();
    expect(Math.abs((p.left + 148) - siteControlRight)).toBeLessThanOrEqual(1);
  });

  it("Place comp: below-right lands menu.right within 1px of the control's right edge", () => {
    const p = placeMenu({ anchorRect: compCaret, menuW: 200, menuH: 42.3 * 3, ...VIEW, placement: "below-right", gap: GAP, margin: 8 });
    expect(p).not.toBeNull();
    expect(Math.abs((p.left + 200) - compControlRight)).toBeLessThanOrEqual(1);
  });

  // Mutation check: reverting the anchor to caret.left (the pre-fix "below-left" placement)
  // reproduces the reported ~178px overhang past the control's own right edge, which is exactly
  // what proves the "within 1px" assertions above are checking the real fix, not an accident.
  it("mutation check: below-left (the pre-fix anchor) overhangs the control by ~178px, both buttons", () => {
    const siteBroken = placeMenu({ anchorRect: siteCaret, menuW: 148, menuH: 42.3, ...VIEW, placement: "below-left", gap: GAP, margin: 8 });
    const siteOverhang = (siteBroken.left + 148) - siteControlRight;
    expect(siteOverhang).toBeGreaterThan(100); // was 178px at width 200; still grossly overhanging at 148

    const compBroken = placeMenu({ anchorRect: compCaret, menuW: 200, menuH: 42.3 * 3, ...VIEW, placement: "below-left", gap: GAP, margin: 8 });
    const compOverhang = (compBroken.left + 200) - compControlRight;
    expect(compOverhang).toBeCloseTo(178, 0); // the exact reported defect: menu.left = caret.left, width 200
  });
});
