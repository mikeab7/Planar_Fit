/* notesResolvedValue — REPORT THE VALUE, NOT WHETHER A MARK IS STORED (NEW-7 / NEW-8 / NEW-9).
 *
 * The browser half is ui-audit/verify-notes-font-control.mjs §3b, which drives the three real
 * encodings of one colour on the real toolbar and is RED-PROVEN against untouched main. This half
 * pins the vocabulary: which CSS keywords are not values, and when two spellings of one colour are
 * the same colour.
 */
import { describe, it, expect } from "vitest";
import {
  defaultFontLabel, isNonValue, resolvedColor, resolvedColorsAgree,
} from "../src/workspaces/notes/lib/notesResolvedValue.js";
import { MIXED, uniformValue } from "../src/workspaces/notes/lib/notesMixedSelection.js";

describe("resolvedColor — `inherit` is not a colour", () => {
  it("treats every CSS-wide keyword as no value at all", () => {
    // The reported case: a mark reading `inherit` painted NO swatch, while an identical-looking
    // run with no mark painted the default. Both are "this text has no colour of its own".
    for (const v of ["inherit", "INHERIT", " inherit ", "initial", "unset", "revert",
                     "currentColor", "transparent", "none", "auto", "", "   ", null, undefined]) {
      expect(resolvedColor(v), `${JSON.stringify(v)} should resolve to null`).toBeNull();
    }
  });

  it("canonicalises hex and rgb() so one colour cannot read as two", () => {
    expect(resolvedColor("#1B1E26")).toBe(resolvedColor("rgb(27, 30, 38)"));
    expect(resolvedColor("#1b1e26")).toBe(resolvedColor("rgb(27,30,38)"));
    expect(resolvedColor("#abc")).toBe(resolvedColor("#aabbcc"));
    expect(resolvedColor("rgba(192, 57, 43, 0.5)")).toBe(resolvedColor("#C0392B"));
  });

  it("keeps genuinely different colours different", () => {
    expect(resolvedColor("#C0392B")).not.toBe(resolvedColor("#1B1E26"));
  });

  it("does not pretend to parse a colour it cannot — it compares it as itself", () => {
    // Conservative on purpose: two spellings we cannot PROVE equal stay different, rather than
    // being folded together on a guess.
    expect(resolvedColor("rebeccapurple")).toBe("rebeccapurple");
    expect(resolvedColor("color-mix(in srgb, red, blue)")).toBe("color-mix(in srgb, red, blue)");
  });
});

describe("resolvedColorsAgree — his three encodings of one black", () => {
  const DEFAULT_INK = "rgb(27, 30, 38)";
  /* Exactly what his Silvestri note holds: no mark (Quadvest, Kandice Cabets) · `color: inherit`
   * (Contacts:, Jerry Hayley, 713-…) · explicit rgb(27,30,38) (jerry@, Simon Sequeira, O: 281-).
   * All three paint the same black. */
  const HIS_NOTE = [null, "inherit", "rgb(27, 30, 38)"];

  it("folds all three into ONE answer, so identical-looking runs stop reading as mixed", () => {
    const resolved = resolvedColorsAgree(HIS_NOTE, DEFAULT_INK);
    expect(new Set(resolved).size).toBe(1);
    expect(uniformValue(resolved)).not.toBe(MIXED);
  });

  it("is what changed: the raw marks DO disagree, which is why the control reported mixed", () => {
    expect(uniformValue(HIS_NOTE)).toBe(MIXED);      // the old behaviour, asserted so it stays fixed
  });

  it("still reports a genuinely different colour as a disagreement", () => {
    expect(uniformValue(resolvedColorsAgree([null, "#C0392B"], DEFAULT_INK))).toBe(MIXED);
    expect(uniformValue(resolvedColorsAgree(["#1B1E26", "#C0392B"], DEFAULT_INK))).toBe(MIXED);
  });

  it("folds `inherit` and 'no mark' together even with NO default supplied — the highlight case", () => {
    // Highlight's default is "no highlight", so nothing is passed; the two must still agree.
    expect(uniformValue(resolvedColorsAgree([null, "inherit"]))).toBeNull();
    expect(uniformValue(resolvedColorsAgree([null, "#FEF08A"]))).toBe(MIXED);
  });

  it("without a default, an explicit default-coloured run is NOT folded into 'no colour'", () => {
    // The third encoding only folds in when we know what the default paints as. Stated as a test
    // so the dependency is visible rather than incidental.
    expect(uniformValue(resolvedColorsAgree([null, "rgb(27, 30, 38)"]))).toBe(MIXED);
  });
});

describe("isNonValue — what gets stripped at the paste boundary", () => {
  it("catches the keywords a pasted document actually carries", () => {
    expect(isNonValue("inherit")).toBe(true);
    expect(isNonValue("  INHERIT ")).toBe(true);
    expect(isNonValue("transparent")).toBe(true);
  });
  it("never strips a real value", () => {
    for (const v of ["#C0392B", "rgb(27, 30, 38)", "Calibri, sans-serif", "11pt", null, ""]) {
      expect(isNonValue(v), `${JSON.stringify(v)} must survive`).toBe(false);
    }
  });
});

describe("defaultFontLabel — a name, marked as the default; never the word instead of a name", () => {
  it("names the typeface and marks it as standard", () => {
    // Owner: "name it AND mark it as the default rather than replacing the name with the word —
    // readable as 'Inter, the standard one', never a category label standing in for a name."
    expect(defaultFontLabel("Inter")).toBe("Inter · standard");
    expect(defaultFontLabel("Inter")).toContain("Inter");
    expect(defaultFontLabel("Inter")).not.toBe("Default");
  });
  it("falls back without inventing a font name it does not have", () => {
    expect(defaultFontLabel(null)).toBe("Standard");
    expect(defaultFontLabel("")).toBe("Standard");
  });
});
