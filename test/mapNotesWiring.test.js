/* Map notes — the WIRING rules, asserted on the real source (NEW-1).
 *
 * These are the three properties that cannot be checked from the pure modules alone, and each one
 * is a defect this repo has already paid for once:
 *  1. ONE placement mechanism, not two. The brief's own words: "generalise the naming where you
 *     touch it rather than cloning a second parallel mechanism — a second copy of this is how the
 *     two comp-anchor paths got out of step before (HARDENING-12)."
 *  2. What is PAINTED is gated on its own layer checkbox and NOTHING else — B831778's decoupling
 *     rule ("If selecting the Comps tab hides site pins, the design has failed"), which the notes
 *     layer now has to obey too.
 *  3. DELETE IS SOFT. A hard delete of a note would be unrecoverable and silent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const finder = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/shared/mapNotes/lib/mapNotesStore.js", import.meta.url), "utf8");

describe("one placement mechanism, generalised — never a second copy", () => {
  it("the pin-drop path is intent-routed, not duplicated per consumer", () => {
    expect(finder).toMatch(/const placePinAt = async \(latlng\) =>/);
    expect(finder).toMatch(/pinIntentRef\.current/);
    // A second, note-specific pin-drop mode/handler is exactly the clone the brief forbids.
    expect(finder).not.toMatch(/placeNotePinAt|placingNotePin|setPlacingNotePin/);
  });

  it("arming an anchor takes the intent as a parameter, defaulting to comp so no caller changed", () => {
    expect(finder).toMatch(/const armAnchor = \(kind, intent = "comp"\) =>/);
  });

  it("the parcel anchor comes from the SHARED derivation, not a second reading of `selected`", () => {
    expect(finder).toMatch(/parcelAnchorFromSelection\(selected, asm\)/);
    const anchorLib = readFileSync(new URL("../src/workspaces/site-planner/lib/compParcelAnchor.js", import.meta.url), "utf8");
    expect(anchorLib).toMatch(/export function parcelAnchorFromSelection/);
    // the old name stays exported, so an in-flight branch importing it still resolves
    expect(anchorLib).toMatch(/export const compAnchorFromSelection = parcelAnchorFromSelection/);
  });

  it("arming a NOTE pin does not re-point the comp toolbar's sticky anchor kind", () => {
    expect(finder).toMatch(/if \(intent === "comp"\) setLastCompAnchorKind\(kind\)/);
  });
});

describe("what is painted is decided by the layer checkboxes and nothing else (B831778)", () => {
  it("ships a Notes toggle beside Sites and Comps, with a count", () => {
    expect(finder).toContain('data-testid="map-show-notes"');
    expect(finder).toMatch(/Notes\{mapNotes\.length \? ` \(\$\{mapNotes\.length\}\)` : ""\}/);
    expect(finder).toMatch(/planarfit:mapShowNotes:v1/);   // remembered across reloads, like its neighbours
  });

  it("the notes layer effect is gated on the checkbox, never on `mode` or the rail tab", () => {
    const eff = finder.slice(finder.indexOf("(showNotesLayer ? mapNotes : [])"));
    const deps = eff.slice(eff.indexOf("}, ["), eff.indexOf("}, [") + 80);
    expect(deps).toContain("showNotesLayer");
    expect(deps).not.toContain("mode");
    expect(deps).not.toContain("panelTab");
  });

  it("a failed notes load is surfaced, never silently drawn as an empty layer (LOUD-FAILURE)", () => {
    expect(finder).toContain('data-testid="map-notes-error"');
  });
});

describe("delete is soft, keyed on (owner, id) the way comps are", () => {
  it("the delete the UI calls stamps deleted_at rather than deleting the row", () => {
    const del = store.slice(store.indexOf("export async function deleteMapNote"), store.indexOf("export async function restoreMapNote"));
    expect(del).toMatch(/update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(del).not.toMatch(/\.delete\(/);
  });

  it("a soft delete that matched no row is reported, never treated as success (B209's class)", () => {
    for (const fn of ["deleteMapNote", "restoreMapNote", "updateMapNote"]) {
      const body = store.slice(store.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 800), `${fn} must not report a write it did not get`).toMatch(/if \(!data|if \(!Array\.isArray\(data\)/);
    }
  });

  it("the live list excludes soft-deleted notes and a restore path exists", () => {
    expect(store).toMatch(/\.is\("deleted_at", null\)/);
    expect(store).toMatch(/export async function restoreMapNote/);
  });

  it("MapFinder only ever calls the SOFT delete — never the purge", () => {
    expect(finder).toMatch(/deleteMapNote/);
    expect(finder).not.toMatch(/permanentlyDeleteMapNote/);
  });
});
