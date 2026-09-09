/* notesResolvedValue — A CONTROL REPORTS THE VALUE, NOT WHETHER A MARK IS STORED (NEW-7 / NEW-8)
 *
 * ⛔ THE OWNER'S TWO REPORTS, AND THEY ARE ONE DEFECT IN TWO PLACES.
 *   NEW-7: *"The notes module can't even call any text at default. There's always a name to it."*
 *          A run with no font mark renders in a real typeface — the app's own — and the control
 *          answered "Default", which is not a font. Two "Default" runs could not be told apart,
 *          and nothing on screen said what Default resolves to.
 *   NEW-8: *"one shows a black line under the A and the other doesn't, so it seems like they're
 *          different font colours even though they both look black."* Measured on his own note:
 *          every run computes to the IDENTICAL black, stored THREE ways — no colour mark at all
 *          (Quadvest, Kandice Cabets) · a `color: inherit` mark (Contacts:, Jerry Hayley, 713-…)
 *          · an explicit colour equal to the note's own ink (jerry@, Simon Sequeira, O: 281-).
 *
 * **The controls were reporting WHETHER A MARK IS STORED. What a person needs is the RESOLVED
 * VALUE.** A mark that says `inherit` is not a colour. An absent font mark is still a font.
 *
 * Measured before the fix, one run per encoding (the full table, with the exact values, is on
 * the backlog item and in the PR — a source comment should carry the RULE, and the ledger the
 * evidence):
 *
 *     stored                              swatch shown       agreement with a no-mark run
 *     ──────────────────────────────────────────────────────────────────────────────────
 *     (no colour mark)                    the default ink    —
 *     a `color: inherit` mark             NOTHING            reported as MIXED   ← his report
 *     an explicit colour = the default    the default ink    reported as MIXED
 *     an explicit real red                red                genuinely different ✓
 *
 * So two identical-looking runs disagreed, and a third showed no colour at all. All three are
 * one question — *what colour is this text?* — and this module answers it once.
 *
 * PURE: no DOM, no editor, no React. The font half needs the live document to resolve (only the
 * browser knows what an unstyled run is actually rendered in), so that lives in the toolbar; what
 * is pure here is the vocabulary — which keywords mean "no value", and when two spellings of one
 * colour are the same colour.
 */

/** CSS-wide keywords, plus the two that mean "whatever the parent is". None of these is a value:
 *  a mark carrying one is indistinguishable, on screen, from no mark at all — which is exactly
 *  why it must not read differently in the control. */
const NON_VALUES = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "currentcolor", "auto", "none", "transparent"]);

/** A hex (three- or six-digit) or a functional rgb/rgba value → a canonical comma-joined triple,
 *  or `null` if this is not a colour we can compare. Deliberately NOT a general CSS colour parser:
 *  named colours and the modern colour spaces would each need a table, and every colour this app
 *  writes or receives from Word is one of those two forms. Anything else falls through and is
 *  compared as its own literal text,
 *  which is the conservative direction — two spellings we cannot prove equal stay different. */
function rgbTriple(value) {
  const s = String(value).trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((n) => Math.round(parseFloat(n)));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return parts.join(",");
  }
  return null;
}

/** ⛔ THE ONE RULE: what colour is this, really? `null` means "no colour of its own" — and a
 *  `color: inherit` mark IS that, not a mystery third state. Everything else comes back in one
 *  canonical spelling, so the same colour written as a hex and in functional notation cannot
 *  read as two different colours. */
export function resolvedColor(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || NON_VALUES.has(s.toLowerCase())) return null;
  return rgbTriple(s) || s.toLowerCase();
}

/** The same question for a whole selection: a run carrying `inherit`, and a run carrying nothing,
 *  must produce the SAME answer, or the control reports a disagreement nobody can see.
 *
 *  `defaultValue` is what "no colour of its own" actually paints as (the note's own text colour).
 *  Passing it folds the third encoding in too — an explicit colour that happens to equal the
 *  default is, on screen, the default — which is what makes all three of his encodings agree.
 *  Omit it and only the first two fold together. */
export function resolvedColorsAgree(values, defaultValue) {
  const fallback = defaultValue == null ? null : resolvedColor(defaultValue);
  return values.map((v) => resolvedColor(v) ?? fallback);
}

/** Is this stored value one of the keywords that should never have been stored as a value?
 *  Used at the paste boundary to stop them being created in the first place. */
export function isNonValue(value) {
  return value != null && NON_VALUES.has(String(value).trim().toLowerCase());
}

/** ⛔ HOW A DEFAULT IS NAMED, and the shape is the owner's own words: *"name it AND mark it as
 *  the default rather than replacing the name with the word — readable as 'Inter, the standard
 *  one', never a category label standing in for a name."*
 *
 *  So the control shows the real typeface plus a quiet marker that this is what the note uses
 *  when nothing else is chosen. It never shows the bare word "Default", which names no font and
 *  cannot be compared against anything. */
export function defaultFontLabel(resolvedName) {
  const name = (resolvedName || "").trim();
  return name ? `${name} · standard` : "Standard";
}
