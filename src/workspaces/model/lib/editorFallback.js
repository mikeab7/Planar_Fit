/* Model workspace — the in-cell editor's KEYSTROKE FALLBACK (B######, "cell entry silently
 * truncates to the first character after about 22 entries").
 *
 * MEASURED live on production: typing straight down a column (click a blank cell, type a
 * value, press Enter, repeat) stores every entry in full for a while, then — with no error, no
 * marker, nothing in the UI — every later entry stores only its FIRST typed character. Every
 * kind of content is hit identically (a number, a formula, a plain label), which is the tell
 * that this has nothing to do with WHAT is typed and everything to do with WHERE the keystroke
 * lands. A reload clears the condition completely; clicking a different cell does not.
 *
 * THE MECHANISM: `startEdit` seeds `editValue` with the very first character from the grid
 * CONTAINER's own `onKeyDown` (nothing is being edited yet, so the container is what has DOM
 * focus) and mounts the in-cell `<input>`, which claims focus itself via `autoFocus`. Every
 * character typed AFTER that is meant to land in the input's own `onChange`. But nothing
 * GUARANTEES the input has actually taken DOM focus by the time the next keystroke arrives —
 * a slow-enough render (more rows, more formulas, more undo history — exactly the kind of cost
 * that grows over a long session, which is why this got WORSE the longer the session ran) can
 * leave the container still focused for one or more further keydowns. Those keydowns still
 * reach this same `onKeyDown` (bubbling, since there is only ever one handler for the whole
 * grid) — and the container's `if (edit) {...}` branch used to handle ONLY Enter/Tab/Escape and
 * silently swallow everything else, on the assumption that any other key must have already been
 * handled by the (focused) input. When that assumption is wrong, the keystroke is lost outright:
 * not deferred, not queued — gone. `editValue` is left holding just the seed character, and
 * whatever gets committed on the next Enter is that one character.
 *
 * THE FIX is not "make the input focus faster" (there is no way to prove that race closed for
 * every future slow render) — it is to never let a keystroke meant for the active edit be
 * silently dropped in the first place (LOUD-FAILURE, generalized to input): whenever a keydown
 * reaches the container while `edit` is active and the event's real target is NOT the in-cell
 * input, this module decides how to apply it directly to `editValue` — the exact same outcome
 * the input's own `onChange` would have produced, so it makes no difference to the user whether
 * the input had focus yet or not. Pure and DOM-free so the whole class is unit-testable without
 * mounting a browser.
 */

/** Whether this event's `target` is the row/cell editor that OUGHT to be handling `key`. When it
 *  is, the input's own controlled `onChange` has already applied the keystroke (or will, for the
 *  native default action still to run) and the container must do nothing more — applying it a
 *  second time here would duplicate every character. */
export function editorHasFocus(eventTarget, inputEl) {
  return !!inputEl && eventTarget === inputEl;
}

/** What a keydown that reached the CONTAINER (never the input) while a cell is mid-edit should
 *  do to `editValue` — or `null` for a key this fallback has no opinion on (arrows, Home/End,
 *  a modifier chord, …), which the caller leaves completely alone. Mirrors exactly what a plain
 *  `<input>` does with the same keystroke: a bare printable character inserts (at the end —
 *  the input's own caret is always at the end here, per its `onFocus` selection-range handler),
 *  Backspace removes the last character. */
export function fallbackEditAction(key, { ctrlKey = false, metaKey = false, altKey = false } = {}) {
  if (ctrlKey || metaKey || altKey) return null;
  if (key === "Backspace") return "backspace";
  if (key.length === 1) return "insert";
  return null;
}

/** Apply one fallback action to the current `editValue`, returning the next value. */
export function applyFallbackEdit(editValue, action, key) {
  if (action === "insert") return editValue + key;
  if (action === "backspace") return editValue.slice(0, -1);
  return editValue;
}
