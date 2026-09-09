/* mapNoteMarkerIcon — the map-note marker (NEW-1).
 *
 * The brief asks for a marker "visually distinct from a comp marker". That is the thing under test
 * here, and it is asserted against the REAL comp marker rather than described in a comment: three
 * things are drawn on this map (site pin · comp tag · note bubble) and two of them must never be
 * confusable. Colour AND shape, not colour alone — the map is read over aerial imagery, and B433's
 * colorblind reasoning applies to telling a note from a comp as much as to two deal stages.
 */
import { describe, it, expect } from "vitest";
import { mapNoteMarkerSvg, mapNoteMarkerSize, NOTE_MARKER_COLOR } from "../src/shared/mapNotes/lib/mapNoteMarkerIcon.js";
import { compMarkerSvg, compMarkerColor, compMarkerSize } from "../src/shared/comps/lib/compMarkerIcon.js";
import { PALETTES } from "../src/shared/theme/palette.js";

describe("the note marker is distinct from a comp marker", () => {
  it("uses a colour no comp type uses", () => {
    for (const t of ["land", "building_sale", "lease", "unknown"]) {
      expect(compMarkerColor(t).toLowerCase()).not.toBe(NOTE_MARKER_COLOR.toLowerCase());
    }
  });

  it("uses a different SHAPE, not just a different hue — a bubble with a tail, never a rotated tag", () => {
    const note = mapNoteMarkerSvg();
    expect(note).not.toMatch(/rotate\(45/);      // the comp tag's signature
    expect(compMarkerSvg("lease")).toMatch(/rotate\(45/);
    expect(note).toMatch(/<path d="M /);          // the tail
  });

  it("anchors at the TAIL TIP, while a comp tag anchors at its centre", () => {
    const { size, anchor } = mapNoteMarkerSize(false);
    expect(anchor).toEqual([size[0] / 2, size[1]]);       // bottom-centre = the tail's point
    const comp = compMarkerSize(false);
    expect(comp.anchor).toEqual([comp.size[0] / 2, comp.size[0] / 2]); // centre
  });
});

describe("the note marker follows the map-marker rules", () => {
  it("is solid-filled with a hard white keyline — never hollow over aerial imagery (B434)", () => {
    const svg = mapNoteMarkerSvg();
    expect(svg).toContain(`fill="${PALETTES.light.onAccentNotes}"`);
    expect(svg).toContain(`fill="${NOTE_MARKER_COLOR}"`);
    expect(svg).not.toMatch(/fill="none"/);
  });

  it("carries no drop-shadow halo (B850016 — a blur is exactly the glow the owner rejected)", () => {
    expect(mapNoteMarkerSvg()).not.toMatch(/drop-shadow|filter=/);
    expect(mapNoteMarkerSvg({ selected: true })).not.toMatch(/drop-shadow|filter=/);
  });

  it("takes its colour from the shared theme mirror, not a hand-picked hex", () => {
    expect(NOTE_MARKER_COLOR).toBe(PALETTES.light.accentNotes);
  });

  it("grows when selected, keeping the tail anchored", () => {
    const a = mapNoteMarkerSize(false), b = mapNoteMarkerSize(true);
    expect(b.size[0]).toBeGreaterThan(a.size[0]);
    expect(b.size[1]).toBeGreaterThan(a.size[1]);
    expect(b.anchor).toEqual([b.size[0] / 2, b.size[1]]);
  });

  it("declares a viewBox matching its own size, so Leaflet's iconSize cannot crop it", () => {
    const { size } = mapNoteMarkerSize(false);
    expect(mapNoteMarkerSvg()).toContain(`viewBox="0 0 ${size[0]} ${size[1]}"`);
  });
});
