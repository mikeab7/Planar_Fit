/* notesMixedSelection — DOES A SELECTION AGREE ON ONE VALUE, OR IS IT MIXED? (B1139216)
 *
 * ⛔ HIS REPORT: *"when i highlight it all and try to click 11 it doesnt work, issue seems to be
 * that when i higlight it all it shows as text size 11 even though there are multiple sizes."*
 * Measured on planyr.io: three blocks at 24px/18px/9px, all three selected — the Font size box
 * read "24", the FIRST block's size, presented as the whole selection's. `editor.getAttributes()`
 * / `editor.isActive()` answer "what mark or node attribute sits at one position" (the selection's
 * `$from`, in practice) — that is exactly right for a caret, which by definition has one value,
 * and exactly wrong for a RANGE, which can honestly disagree with itself. The Line spacing control
 * already sidesteps this by never showing a value at all; Font size and Block style are different —
 * the whole point of putting Font size on the row (B1371) was so a person could SEE what size their
 * text is — so the fix is to compute agreement over the WHOLE range, not to give up on showing state.
 *
 * The decision is here, pure, so it can be unit-tested with plain arrays and a fake `doc` shaped
 * like ProseMirror's (a `nodesBetween(from, to, cb)` that calls back with node-shaped objects) —
 * the same split this module already uses for `notesEnterInherit.js` (a pure decision, exercised
 * for real by a browser harness — `ui-audit/verify-notes-mixed-format.mjs` here).
 */

/** Sentinel meaning "the values disagree" — never a real font size, heading level or block kind,
 *  so `=== MIXED` is unambiguous. A Symbol rather than a string/null so it can never collide with
 *  a real attribute value (including `null`, which is itself a real, meaningful answer: "every run
 *  in the selection agrees on having NO override"). */
export const MIXED = Symbol("notes-mixed-selection");

/** The one value every item in `values` shares, or MIXED the moment two disagree. An empty array
 *  is `null` (nothing there to disagree with), not MIXED — a selection that touches no text has no
 *  opinion, and treating "nothing found" as "conflicting" would blank the box when there is nothing
 *  wrong. */
export function uniformValue(values) {
  if (!values || !values.length) return null;
  const seen = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== seen) return MIXED;
  }
  return seen;
}

/** What a formatting control should DISPLAY: a caret has exactly one value by definition, so a
 *  collapsed selection always trusts `caretValue` (the editor's own `getAttributes`/`isActive`
 *  read, unchanged from before this fix — rule 1 in NoteToolbar.jsx's own header: every active
 *  state comes from the editor, never a second, mirrored source of truth). Only a real RANGE asks
 *  whether every touched run/block agrees. */
export function formatDisplayValue({ selectionEmpty, caretValue, rangeValues }) {
  if (selectionEmpty) return caretValue ?? null;
  return uniformValue(rangeValues);
}

/** Every text run's `textStyle.fontSize` touched by `[from, to)` — `null` for a run carrying no
 *  explicit override, so "every run in range agrees on no override" is a real, distinct uniform
 *  answer from "every run agrees on 18px". Non-text nodes (images, a table's cell borders, …)
 *  contribute nothing — they have no font size to disagree about. */
export function selectionFontSizes(doc, from, to) {
  const sizes = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = (node.marks || []).find((m) => m.type && m.type.name === "textStyle");
    sizes.push((mark && mark.attrs && mark.attrs.fontSize) || null);
  });
  return sizes;
}

/** Every textblock's "shape" touched by `[from, to)`, in the same two-way vocabulary the block-
 *  style control already offers: `h${level}` for a heading, `"p"` for everything else (an ordinary
 *  paragraph, a list item's paragraph, a blockquote's, a code block — the control itself only ever
 *  distinguishes heading-or-not, so a third bucket here would claim a precision the UI doesn't
 *  have). */
export function selectionBlockShapes(doc, from, to) {
  const shapes = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    shapes.push(node.type.name === "heading" ? `h${node.attrs.level}` : "p");
  });
  return shapes;
}

/** Every textblock's `lineHeight` attribute touched by `[from, to)` (NEW-SPACING-3) — the Line
 *  spacing control's own version of `selectionFontSizes`/`selectionBlockShapes`. `lineHeight`
 *  lives on both `paragraph` and `heading` (notesSpacing.js), so this walks every textblock,
 *  not one named type; `null` is a real, distinct answer ("this block carries no override"),
 *  the same convention `selectionFontSizes` uses. */
export function selectionLineHeights(doc, from, to) {
  const heights = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    heights.push(node.attrs?.lineHeight ?? null);
  });
  return heights;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * EVERY CONTROL REPORTS THE SELECTION, OR REPORTS NOTHING (NEW-TOOLBAR-STATE)
 *
 * ⛔ THE OWNER MADE THIS A STANDING RULE, not a fix for two controls: *"When I highlight
 * multiple texts, assuming that they're one font, they should state the font. When I'm typing
 * in a font, it should state the font. If I select multiple text types and it's got different
 * ones, then it shouldn't say a font. And then same thing for text size and bold and underlined
 * and italic, whatever. Everything that you can think of that it does on Word, it should do
 * here."*
 *
 * THREE STATES, NO EXCEPTIONS. A **uniform** selection shows the real value read off the whole
 * range · a **caret** shows what the next typed character would get · a **genuinely mixed**
 * range shows NOTHING — blank for a value control, indeterminate for a toggle. **A control that
 * cannot answer honestly goes blank rather than guessing, and "Default" is a guess.**
 *
 * ⛔ AND THE POINT OF PUTTING THEM ALL HERE: a per-control mixed check is the failure, not the
 * fix. Font size was made correct in isolation (B1139216) and eleven other controls stayed
 * wrong for months, because nothing about a bespoke check in one control says anything about
 * the next one. These readers are the ONE mechanism; a control that grows its own is a defect.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Every text run's `textStyle.fontFamily` touched by `[from, to)` — the sibling of
 *  `selectionFontSizes`, and the reader behind NEW-1/NEW-2. Values come back RAW (the exact
 *  stack string the run stores, e.g. Word's `"Calibri",sans-serif`); comparing them is
 *  `notesFontFamily.js`'s `familyKey`'s job, not this walk's, because two different stacks
 *  can honestly be the same typeface and only that module knows the rule. */
export function selectionFontFamilies(doc, from, to) {
  const families = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = (node.marks || []).find((m) => m.type && m.type.name === "textStyle");
    families.push((mark && mark.attrs && mark.attrs.fontFamily) || null);
  });
  return families;
}

/** Does each text run touched by `[from, to)` carry `markName`? One boolean per run, so
 *  `uniformValue` answers all-on / all-off / MIXED — which is exactly the three states a
 *  toggle needs and the two states `editor.isActive` can express. `isActive` on a RANGE
 *  answers "does this mark cover the WHOLE range", so half-bold text reports a confident
 *  **false** — indistinguishable from text with no bold in it anywhere. That is the guess
 *  this replaces. */
export function selectionMarkPresence(doc, from, to, markName) {
  const flags = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    flags.push((node.marks || []).some((m) => m.type && m.type.name === markName));
  });
  return flags;
}

/** One attribute of one mark, per text run — `textStyle.color`, `highlight.color`. A run
 *  without the mark contributes `null`, which is the real answer "this run has no colour of
 *  its own", and therefore disagrees honestly with a run that has one. */
export function selectionMarkAttrs(doc, from, to, markName, attr) {
  const values = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = (node.marks || []).find((m) => m.type && m.type.name === markName);
    values.push((mark && mark.attrs && mark.attrs[attr]) ?? null);
  });
  return values;
}

/** Every textblock's alignment touched by `[from, to)`. `"left"` and `null` are the SAME
 *  answer — left is the body default and is what an unaligned paragraph already does — so
 *  they are normalised to `null` rather than reported as a disagreement nobody can see. */
export function selectionAlignments(doc, from, to) {
  const aligns = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    const a = node.attrs?.textAlign ?? null;
    aligns.push(a === "left" ? null : a);
  });
  return aligns;
}

/** The list each textblock in `[from, to)` sits in — `"bulletList"` / `"orderedList"` /
 *  `"taskList"`, or `null` for a block in no list. Needs `doc.resolve` (a list is an ANCESTOR,
 *  and `nodesBetween`'s callback sees only one parent), which is the one thing a fake `doc` in
 *  a unit test has to provide beyond `nodesBetween`. */
export function selectionListKinds(doc, from, to) {
  const kinds = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    const $pos = doc.resolve(pos);
    let kind = null;
    for (let d = $pos.depth; d > 0; d -= 1) {
      const name = $pos.node(d).type.name;
      if (name === "bulletList" || name === "orderedList" || name === "taskList") { kind = name; break; }
    }
    kinds.push(kind);
  });
  return kinds;
}

/** ⛔ THE THREE STATES OF A TOGGLE, as the string `aria-pressed` actually takes.
 *  `"mixed"` is a STANDARD `aria-pressed` value, not an invention — screen readers announce it
 *  as "partially pressed" — which is why the accessible answer and the painted answer can be
 *  one value rather than two that drift.
 *
 *  ⛔ AND `"false"` IS NOT THE SAME AS ABSENT, which is what shipped: `aria-pressed={active ?
 *  "true" : undefined}` gave Bold/Italic/Underline/Strikethrough **no state at all** whenever
 *  they were off — measured on the live toolbar, absent in every sampled case. A toggle that
 *  says nothing when it is off is not a toggle to anyone who cannot see the highlight. */
export function togglePressed({ selectionEmpty, caretValue, rangeValues }) {
  const value = formatDisplayValue({ selectionEmpty, caretValue, rangeValues });
  if (value === MIXED) return "mixed";
  return value ? "true" : "false";
}
