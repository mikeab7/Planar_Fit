/* Model workspace — B1287888 ("cell entry silently truncates to the first character after about 22
 * entries"). MEASURED live on production: typing straight down a column (click a blank cell,
 * type a value, press Enter, repeat) stored every entry in full for a while, then silently
 * stored only the FIRST typed character of every later entry — no error, no marker, nothing in
 * the UI. Every kind of content was hit identically (numbers, formulas, plain text), which is
 * the tell that this was never about WHAT was typed.
 *
 * ROOT CAUSE (see lib/editorFallback.js's own header for the full mechanism): the grid
 * container's own `onKeyDown` is the ONE handler for the whole sheet — the in-cell `<input>` has
 * no listener of its own, so a keystroke that reaches this handler while `edit` is active used
 * to be handled ONLY if it was Enter/Tab/Escape, on the assumption every other key had already
 * been applied by the (focused) input's own `onChange`. Nothing guarantees that focus has
 * actually landed on the input by the time the next keystroke arrives — a slow-enough render
 * (more rows, more undo history, exactly the kind of cost that grows over a long session) can
 * leave the container itself still focused, and every key typed in that gap was silently
 * dropped: not deferred, gone. `editValue` was left holding only the seed character `startEdit`
 * plants there, so the next Enter committed just that one character.
 *
 * These tests drive the REAL production functions (`lib/editorFallback.js`'s own exports, and
 * `lib/sheetModel.js`'s real commit path) through 40+ consecutive cell entries, exactly the
 * "click a cell, type a value, press Enter, repeat down the column" repro — asserting every
 * stored value round-trips in FULL. `bugHuntGuards.test.js`'s live-browser proof
 * (`.scratch-verify-fix.mjs`-equivalent behaviour) is documented on the item; these are the
 * fast, CI-runnable half that gates every PR (e2e/ only runs on schedule/dispatch, so nothing in
 * e2e/ runs before a merge).
 */
import { describe, it, expect } from "vitest";
import { editorHasFocus, fallbackEditAction, applyFallbackEdit } from "../src/workspaces/model/lib/editorFallback.js";
import {
  createWorkbook, applyToActiveSheet, setActiveSheet, commitCellText, activeSheetEntry, rawAt,
} from "../src/workspaces/model/lib/sheetModel.js";

/** Simulates typing one full value into a cell EXACTLY the way SheetView's container does when
 *  the in-cell `<input>` has not yet taken DOM focus: `seed` is the first character (handled by
 *  `startEdit`, unconditionally captured — the input doesn't need to exist yet for that one),
 *  every further character is a keydown that reaches the CONTAINER (never the input), resolved
 *  through the real `fallbackEditAction`/`applyFallbackEdit` pair. */
function typeViaFallback(fullText) {
  let editValue = fullText[0];
  for (const key of fullText.slice(1)) {
    const action = fallbackEditAction(key, {});
    editValue = applyFallbackEdit(editValue, action, key);
  }
  return editValue;
}

describe("editorFallback — the container never silently drops a keystroke meant for the editor", () => {
  it("editorHasFocus is true only when the event's real target IS the in-cell input", () => {
    const input = {};
    const container = {};
    expect(editorHasFocus(input, input)).toBe(true);
    expect(editorHasFocus(container, input)).toBe(false);
    expect(editorHasFocus(container, null)).toBe(false); // input not mounted at all
  });

  it("resolves a bare printable character to insert, Backspace to backspace, and leaves navigation/modifier keys alone", () => {
    expect(fallbackEditAction("7", {})).toBe("insert");
    expect(fallbackEditAction("=", {})).toBe("insert");
    expect(fallbackEditAction("Backspace", {})).toBe("backspace");
    expect(fallbackEditAction("ArrowLeft", {})).toBe(null);
    expect(fallbackEditAction("Enter", {})).toBe(null);
    expect(fallbackEditAction("Tab", {})).toBe(null);
    expect(fallbackEditAction("Escape", {})).toBe(null);
    // A Ctrl/Cmd/Alt chord is never plain text entry (Ctrl+C, Cmd+V, …) — leave it alone even
    // when `key` happens to be a single printable character.
    expect(fallbackEditAction("c", { ctrlKey: true })).toBe(null);
    expect(fallbackEditAction("v", { metaKey: true })).toBe(null);
  });

  it("applyFallbackEdit appends on insert and drops the last character on backspace", () => {
    expect(applyFallbackEdit("10", "insert", "1")).toBe("101");
    expect(applyFallbackEdit("101", "backspace", "Backspace")).toBe("10");
    expect(applyFallbackEdit("", "backspace", "Backspace")).toBe("");
  });

  it("reconstructs a multi-character entry typed entirely through the fallback path — the exact failure mode measured live", () => {
    expect(typeViaFallback("101101")).toBe("101101");
    expect(typeViaFallback("=SUM(B33:B34)+B36")).toBe("=SUM(B33:B34)+B36");
    expect(typeViaFallback("Net operating income")).toBe("Net operating income");
    expect(typeViaFallback("0.06")).toBe("0.06");
  });
});

describe("cell entry — 40 consecutive commits round-trip in full through the real cell-entry path (B1287888)", () => {
  it("stores every typed value in full even when every entry is typed through the container fallback (input never focused)", () => {
    let workbook = createWorkbook();
    const activeSheetId = workbook.activeSheetId;
    const N = 40;
    const values = Array.from({ length: N }, (_, i) => `${101101 + i * 1001}`);

    for (let row = 0; row < N; row++) {
      const typed = typeViaFallback(values[row]);
      expect(typed).toBe(values[row]); // nothing lost before it ever reaches the model
      workbook = applyToActiveSheet(setActiveSheet(workbook, activeSheetId), commitCellText, row, 0, typed);
    }

    const sheet = activeSheetEntry(workbook).sheet;
    for (let row = 0; row < N; row++) {
      expect(rawAt(sheet, row, 0)).toBe(values[row]);
    }
  });

  it("round-trips a mix of numbers, a percent, formulas and plain text — the bug hit every kind of content identically", () => {
    let workbook = createWorkbook();
    const activeSheetId = workbook.activeSheetId;
    const entries = [
      "1685", "0.06", "5400", "650",
      "=B9*B25*12", "=SUM(B33:B34)+B36", "Net operating income",
    ];
    entries.forEach((value, row) => {
      const typed = typeViaFallback(value);
      workbook = applyToActiveSheet(setActiveSheet(workbook, activeSheetId), commitCellText, row, 0, typed);
    });
    const sheet = activeSheetEntry(workbook).sheet;
    entries.forEach((value, row) => expect(rawAt(sheet, row, 0)).toBe(value));
  });
});
