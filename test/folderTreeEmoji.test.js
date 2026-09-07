/* B1307664 — the Library folder tree's decorative folder emoji (📁/📂).
 *
 * The bug: every row in the tree — and the "what the standard structure will look like"
 * preview shown before a project is scaffolded — painted a literal folder emoji beside the
 * name. In a list whose rows are ALL folders it carries no information (the disclosure
 * triangle already says "this is a folder, and whether it's open"), and being an emoji
 * rather than a themed icon, `color: T.accentText` on it silently did nothing.
 *
 * Two checks, because the row-emoji and the preview-emoji sit in different, unreachable-under-
 * SSR render branches: a behavioral render of the empty-project preview (the one branch that
 * DOES run with no seeded state), and a source sweep for the two glyphs so a regression in the
 * populated-tree row (only reachable once Supabase-backed rows exist, which needs a live
 * project) can't silently come back unnoticed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FolderTree from "../src/workspaces/library/components/FolderTree.jsx";

const SRC_PATH = new URL("../src/workspaces/library/components/FolderTree.jsx", import.meta.url);
const SRC = readFileSync(SRC_PATH, "utf8");
const FOLDER_EMOJI = ["\u{1F4C1}", "\u{1F4C2}"]; // 📁 📂

describe("FolderTree — no decorative folder emoji (B1307664)", () => {
  it("renders the empty-project template preview with no folder emoji", () => {
    // Effects (the Supabase load) don't run under renderToStaticMarkup, so a signed-in,
    // project-selected tree renders with its INITIAL state: rows=[] → the tree.length===0
    // branch, which is exactly the "Create the standard N-folder structure" preview this
    // item calls out (previewRows). Confirm we actually landed on that branch before
    // trusting the negative assertion (DRIVER-SCROLL §6 — a probe that can't prove it saw
    // the case under test is worthless).
    const html = renderToStaticMarkup(
      createElement(FolderTree, { signedIn: true, projectId: "test-project", projectName: "Test Project" }),
    );
    expect(html).toContain("01. Organization"); // proves the template preview actually rendered
    for (const glyph of FOLDER_EMOJI) expect(html).not.toContain(glyph);
  });

  it("renders no folder emoji when signed out or with no project either", () => {
    expect(renderToStaticMarkup(createElement(FolderTree, { signedIn: false }))).not.toMatch(/[\u{1F4C1}\u{1F4C2}]/u);
    expect(renderToStaticMarkup(createElement(FolderTree, { signedIn: true, projectId: null }))).not.toMatch(/[\u{1F4C1}\u{1F4C2}]/u);
  });

  it("source sweep: the glyphs never appear anywhere in the module (guards the populated-tree row, unreachable under SSR)", () => {
    for (const glyph of FOLDER_EMOJI) expect(SRC).not.toContain(glyph);
  });

  it("the per-row muted rolled-up file-count mark (NEW-2) is still wired: unpinned rows show a T.faint count only when count > 0, pinned rows show the star instead", () => {
    // Structural guard, not a full render (the count/star only appear once real rows are
    // seeded, which needs a live Supabase project) — pins this exact ternary shape so it
    // can't regress silently now that the emoji it used to sit beside is gone.
    expect(SRC).toMatch(/pinnedIds\s*&&\s*pinnedIds\.has\(node\.id\)\s*\?[\s\S]{0,200}★[\s\S]{0,200}:\s*count\s*\?[\s\S]{0,200}T\.faint/);
  });
});
