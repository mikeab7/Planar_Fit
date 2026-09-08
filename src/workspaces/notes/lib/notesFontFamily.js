/* notesFontFamily — WHICH TYPEFACE IS THIS TEXT IN? (NEW-1 / NEW-2)
 *
 * ⛔ HIS REPORT: he highlighted one line of a pasted Outlook signature — *"so the two names
 * highlighted are the same text size? also it should tell me what font I've selected or am
 * using."* Both halves were real, and measured on planyr.io: "Jerry Hayley" and "Kandice
 * Cabets" sit on ONE line at the SAME size (11px each) in TWO DIFFERENT TYPEFACES (Calibri and
 * the app's own Inter). Nothing on screen could name that difference — the Font control read
 * **Default** for text that was genuinely Calibri, and read **Default** again for a selection
 * spanning both, indistinguishable from a uniform one.
 *
 * ⛔ THE ROOT CAUSE, AND IT IS A STRING-COMPARISON BUG, NOT A READ THAT NEVER HAPPENS. The
 * control did read the mark. Word puts `font-family:"Calibri",sans-serif` on the run, and
 * Tiptap's `fontFamily` attribute deliberately stores that string VERBATIM (its own comment:
 * "Prefer the raw inline `style` attribute so unquoted or single-quoted multi-word names are
 * preserved"). The palette's Calibri option is the DIFFERENT string `Calibri, Candara,
 * sans-serif`. A native `<select>` handed a `value` matching no `<option>` silently falls back
 * to its FIRST option — which is "Default". So a correct read plus an exact-string compare
 * produced a confident wrong answer, on every pasted run, in total silence.
 *
 * The fix is to compare what a person means by "what font is this": the FIRST family in the
 * stack, which is the one the browser actually uses when it has it. Everything after it is a
 * fallback chain, and two stacks that start with Calibri are the same answer to his question.
 *
 * PURE — no DOM, no editor, no React — so the comparison rule is unit-testable on plain
 * strings, the same split `notesMixedSelection.js` already uses for the size case.
 */

/** The first family in a CSS `font-family` stack, with its quoting and padding removed but its
 *  ORIGINAL CASING kept — `'"Segoe UI",sans-serif'` → `Segoe UI`. `null` for anything that
 *  names no family at all, which includes the empty string: a paste can leave `fontFamily: ""`
 *  behind (measured — a run carrying only `font-size` stores an empty family), and an empty
 *  string is "no font declared", never a font called "". */
export function firstFamily(css) {
  if (typeof css !== "string") return null;
  const first = css.split(",")[0].trim().replace(/^['"]|['"]$/g, "").trim();
  return first || null;
}

/** The comparison key for "is this the same typeface": the first family, lower-cased, with
 *  interior runs of whitespace collapsed. `null` stays `null` — and that is a REAL, distinct
 *  answer meaning "every run agrees on having no font of its own", not a missing one. */
export function familyKey(css) {
  const first = firstFamily(css);
  return first ? first.toLowerCase().replace(/\s+/g, " ") : null;
}

/** The palette option a stored value corresponds to, matched by `familyKey` rather than by the
 *  exact stack string — so Word's `"Calibri",sans-serif` finds the Calibri option. `null` when
 *  the family is not one of the six offered (a real, common case: a paste can carry any font
 *  the sender had), which is what makes the off-list label below necessary rather than a nicety. */
export function matchFontOption(css, fonts) {
  const key = familyKey(css);
  if (!key) return null;
  return (fonts || []).find((f) => f.value && familyKey(f.value) === key) || null;
}

/** What the control should SHOW. A matched option shows the palette's own label; an unmatched
 *  family shows its REAL NAME rather than "Default" — his explicit ask, *"show the real family
 *  name even when it is not one of the six offered"*. Nothing declared shows the Default label,
 *  because that is the honest answer: this text is in the note's own font. */
export function fontDisplayLabel(css, fonts) {
  const matched = matchFontOption(css, fonts);
  if (matched) return matched.label;
  return firstFamily(css) || (fonts || []).find((f) => f.value == null)?.label || "Default";
}
