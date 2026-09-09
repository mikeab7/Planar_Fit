/* notesFontFamily / the toolbar's three-state readouts — the PURE decisions (NEW-1, NEW-2,
 * NEW-4, NEW-TOOLBAR-STATE).
 *
 * The browser half is ui-audit/verify-notes-font-control.mjs, which drives every control on the
 * real toolbar through all three states. This half pins the rules that harness cannot express as
 * cheaply: the string comparison that made a Calibri run read "Default", the unit conversion that
 * made 11pt and 11px the same number, and the walkers behind every control's readout.
 */
import { describe, it, expect } from "vitest";
import { familyKey, firstFamily, fontDisplayLabel, matchFontOption } from "../src/workspaces/notes/lib/notesFontFamily.js";
import { FONTS } from "../src/workspaces/notes/lib/notesFormatPalette.js";
import { fontSizePx, blockFontSize } from "../src/workspaces/notes/lib/notesSpacing.js";
import {
  MIXED, formatDisplayValue, selectionAlignments, selectionFontFamilies, selectionListKinds,
  selectionMarkAttrs, selectionMarkPresence, togglePressed,
} from "../src/workspaces/notes/lib/notesMixedSelection.js";
import { inheritedStyle } from "../src/workspaces/notes/lib/notesPasteInherit.js";

describe("familyKey — two stacks naming the same typeface are the same answer", () => {
  it("matches Word's own quoted stack against the palette's", () => {
    // THE BUG, in one line: these two strings are different and the typeface is the same.
    expect(familyKey('"Calibri",sans-serif')).toBe(familyKey("Calibri, Candara, sans-serif"));
  });
  it("keeps the real name's casing for display, and lower-cases only the key", () => {
    expect(firstFamily("'Segoe UI',Tahoma,sans-serif")).toBe("Segoe UI");
    expect(familyKey("'Segoe UI',Tahoma,sans-serif")).toBe("segoe ui");
  });
  it("treats an empty declaration as no font — never as a font called ''", () => {
    // A pasted run carrying only `font-size` stored `fontFamily: ""`. That is not a typeface.
    for (const v of ["", "   ", null, undefined, 7]) expect(familyKey(v)).toBeNull();
  });
});

describe("fontDisplayLabel — the control names the typeface, or says Default honestly", () => {
  it("names a palette font by the palette's label", () => {
    expect(fontDisplayLabel('"Calibri",sans-serif', FONTS)).toBe("Calibri");
    expect(matchFontOption('"Calibri",sans-serif', FONTS).label).toBe("Calibri");
  });
  it("names an OFF-PALETTE font by its real name rather than calling it Default", () => {
    expect(fontDisplayLabel("'Segoe UI',Tahoma,sans-serif", FONTS)).toBe("Segoe UI");
    expect(matchFontOption("'Segoe UI',Tahoma,sans-serif", FONTS)).toBeNull();
  });
  it("says Default only when nothing is declared", () => {
    expect(fontDisplayLabel(null, FONTS)).toBe("Default");
    expect(fontDisplayLabel("", FONTS)).toBe("Default");
  });
});

describe("fontSizePx — one unit, so two sizes can never read as one number (NEW-4)", () => {
  it("converts the point sizes Word and Outlook actually emit", () => {
    expect(fontSizePx("11pt")).toBe(14.67);      // his "Contacts:" run
    expect(fontSizePx("11.0pt")).toBe(14.67);
    expect(fontSizePx("11px")).toBe(11);         // his "713-416-5353" run
    // The whole defect, asserted directly: these two must not collapse to the same number.
    expect(fontSizePx("11pt")).not.toBe(fontSizePx("11px"));
  });
  it("passes px and bare numbers through unchanged", () => {
    expect(fontSizePx("18px")).toBe(18);
    expect(fontSizePx("18")).toBe(18);
    expect(fontSizePx(18)).toBe(18);
  });
  it("handles the other absolute CSS units", () => {
    expect(fontSizePx("1in")).toBe(96);
    expect(fontSizePx("1pc")).toBe(16);
    expect(fontSizePx("2.54cm")).toBe(96);
  });
  it("REFUSES a relative unit rather than guessing a base", () => {
    // A guessed base is a wrong number that looks right — worse here than no number at all.
    for (const v of ["1.2em", "1.2rem", "120%", "larger", "inherit", "", null, "0px", "-3px"]) {
      expect(fontSizePx(v)).toBeNull();
    }
  });
  it("makes a block's derived strut agree with its runs' real size", () => {
    // Before the fix `num("11pt")` was 11, so the block wrote font-size:11px under 14.67px text.
    expect(blockFontSize([{ fontSize: "11pt" }, { fontSize: "11pt" }])).toBe(14.67);
    expect(blockFontSize([{ fontSize: "11pt" }, { fontSize: "11px" }])).toBeNull();  // honestly disagree
  });
});

/* A `doc` shaped like ProseMirror's — `nodesBetween` plus the `resolve` the list walker needs.
 * Deliberately hand-built rather than mocked from the real schema: these are pure decisions and
 * must be provable without an editor. */
function fakeDoc(nodes) {
  return {
    nodesBetween(from, to, cb) { nodes.forEach((n, i) => cb(n, i)); },
    resolve(pos) {
      const chain = nodes[pos].ancestors || [];
      return { depth: chain.length, node: (d) => chain[d - 1] };
    },
  };
}
const textRun = (marks) => ({ isText: true, isTextblock: false, marks });
const block = (attrs, ancestors) => ({ isText: false, isTextblock: true, attrs, ancestors });

describe("the shared selection readers — ONE mechanism, not one per control", () => {
  it("selectionFontFamilies returns each run's RAW stack, null for a run with none", () => {
    const doc = fakeDoc([
      textRun([{ type: { name: "textStyle" }, attrs: { fontFamily: '"Calibri",sans-serif' } }]),
      textRun([]),
    ]);
    expect(selectionFontFamilies(doc, 0, 2)).toEqual(['"Calibri",sans-serif', null]);
  });

  it("selectionMarkPresence answers per run, which is what makes MIXED reachable", () => {
    const doc = fakeDoc([textRun([{ type: { name: "bold" } }]), textRun([])]);
    expect(selectionMarkPresence(doc, 0, 2, "bold")).toEqual([true, false]);
    // `editor.isActive` on this range returns a confident FALSE — the guess this replaces.
    expect(togglePressed({ selectionEmpty: false, rangeValues: [true, false] })).toBe("mixed");
  });

  it("selectionMarkAttrs distinguishes 'no colour' from 'a colour'", () => {
    const doc = fakeDoc([
      textRun([{ type: { name: "textStyle" }, attrs: { color: "#C0392B" } }]),
      textRun([]),
    ]);
    expect(selectionMarkAttrs(doc, 0, 2, "textStyle", "color")).toEqual(["#C0392B", null]);
  });

  it("selectionAlignments treats left and unset as the SAME answer", () => {
    // They render identically, so reporting them as a disagreement would blank the control
    // for a difference nobody can see.
    const doc = fakeDoc([block({ textAlign: "left" }), block({}), block({ textAlign: "center" })]);
    expect(selectionAlignments(doc, 0, 3)).toEqual([null, null, "center"]);
    expect(formatDisplayValue({ selectionEmpty: false, rangeValues: [null, null] })).toBeNull();
    expect(formatDisplayValue({ selectionEmpty: false, rangeValues: [null, "center"] })).toBe(MIXED);
  });

  it("selectionListKinds finds the list ANCESTOR, not the block's own type", () => {
    const doc = fakeDoc([
      block({}, [{ type: { name: "bulletList" } }, { type: { name: "listItem" } }]),
      block({}, []),
    ]);
    expect(selectionListKinds(doc, 0, 2)).toEqual(["bulletList", null]);
  });

  it("togglePressed gives the three states aria-pressed actually takes", () => {
    expect(togglePressed({ selectionEmpty: false, rangeValues: [true, true] })).toBe("true");
    expect(togglePressed({ selectionEmpty: false, rangeValues: [false, false] })).toBe("false");
    expect(togglePressed({ selectionEmpty: false, rangeValues: [true, false] })).toBe("mixed");
    // A caret has one value by definition and trusts the editor's own read (storedMarks included).
    expect(togglePressed({ selectionEmpty: true, caretValue: true })).toBe("true");
    expect(togglePressed({ selectionEmpty: true, caretValue: false })).toBe("false");
    // "false" is NOT absent — the state Bold/Italic/Underline/Strikethrough shipped in.
    expect(togglePressed({ selectionEmpty: true, caretValue: false })).not.toBeUndefined();
  });
});

/* A minimal stand-in element tree: `style` as a plain object is exactly the surface
 * `inheritedStyle` uses, so the walk is provable without a DOM. */
function el(style, parent) {
  return { nodeType: 1, tagName: "SPAN", style, parentElement: parent, classList: { contains: () => false } };
}
describe("inheritedStyle — the walk behind the paste fix (NEW-5)", () => {
  const body = { nodeType: 1, tagName: "BODY", style: {}, parentElement: null, classList: { contains: () => false } };
  it("finds a font declared on an ancestor, which is how Word actually writes one", () => {
    const div = el({ fontFamily: '"Calibri",sans-serif' }, body);
    const p = el({}, div);
    const span = el({}, p);                       // "Kandice Cabets" — a BARE span
    expect(inheritedStyle(span, "fontFamily")).toBe('"Calibri",sans-serif');
  });
  it("prefers the run's OWN declaration over an inherited one", () => {
    const div = el({ fontFamily: "Arial" }, body);
    const span = el({ fontFamily: "Georgia" }, div);
    expect(inheritedStyle(span, "fontFamily")).toBe("Georgia");
  });
  it("returns null when nothing in the chain declares one", () => {
    expect(inheritedStyle(el({}, el({}, body)), "fontFamily")).toBeNull();
  });
  it("STOPS at the live editor, so the app's own font is never written into a document", () => {
    const pm = { nodeType: 1, tagName: "DIV", style: { fontFamily: "Inter" }, parentElement: body, classList: { contains: (c) => c === "ProseMirror" } };
    expect(inheritedStyle(el({}, pm), "fontFamily")).toBeNull();
  });
});
