import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* B1424624 — the Sites-panel row's project name collapsed to a single-character stub on a real
 * production project (his own duplicated ALUMAX pair, both rows carrying "no boundary" AND
 * "no location" at once — the exact filtered view the Dashboard's "N projects need fixing" link
 * lands on, per #1589/B1401952). Root cause, measured live in a real browser (see
 * ui-audit/verify-sites-panel-name-clip.mjs, the actual RED-PROOF for this item — jsdom has no
 * real flexbox engine, so a computed-layout assertion cannot live here): the two standing-fact
 * flag chips were `flex:"none"` (refuse to shrink) while the name span had no min-width floor, so
 * on this panel's fixed 232px width every pixel of negative space landed on the name — down to
 * under 3px, not even one glyph — before either 71px-wide chip gave up anything. The identical
 * shape squeezed the filter row's "Filter by name…" input against the sort <select>'s longest
 * option ("Recently touched," also `flex:"none"`), reading "Filter by n".
 *
 * This file is a SOURCE GUARD, not a layout proof — it pins the STRUCTURAL fix (the name/input
 * floors exist; the chips/select can shrink) so a future edit can't silently re-widen the flags
 * back to `flex:"none"` without a fast, no-browser test catching it. The mutation check proves the
 * extraction actually distinguishes the pre-fix shape from the fix, not merely "found something". */

const SRC = fileURLToPath(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url));

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Sites-panel row — the name gets a floor, the standing-fact flags shrink first (B1424624)", () => {
  const code = stripComments(readFileSync(SRC, "utf8"));

  it("the name span carries an explicit min-width floor, not just flex:1", () => {
    expect(code).toMatch(/const NAME_MIN_PX = \d+;/);
    // the name <span> itself must reference the floor, not merely declare it unused
    expect(code).toMatch(/flex: "1 1 auto", minWidth: NAME_MIN_PX/);
  });

  it("the standing-fact flag chips (\"no boundary\" / \"no location\") can shrink — never flex:\"none\"", () => {
    // The declaration is a single line, but its border carries a template literal
    // (`` `1px solid ${PAL.panelLine}` ``) whose `${...}` closing brace breaks a naive
    // `[^}]*` scan — match to end-of-line instead (`.` excludes newlines by default).
    const styleDecl = code.match(/const rowFlagBadgeStyle = \{.*\};/);
    expect(styleDecl, "rowFlagBadgeStyle declaration not found").not.toBeNull();
    expect(styleDecl[0]).not.toMatch(/flex:\s*"none"/);
    expect(styleDecl[0]).toMatch(/flex:\s*"0 1 auto"/);
    expect(styleDecl[0]).toMatch(/minWidth:\s*0/);
  });

  it("the filter input has its own floor, and the sort <select> beside it can shrink", () => {
    expect(code).toMatch(/const FILTER_MIN_PX = \d+;/);
    expect(code).toMatch(/minWidth: FILTER_MIN_PX/);
    // the <select> block: flex:none must be gone in favor of a shrinkable flex value
    const selectBlock = code.match(/<select value=\{sitesPanelPrefs\.sort\}[\s\S]*?<\/select>/);
    expect(selectBlock, "sort <select> block not found").not.toBeNull();
    expect(selectBlock[0]).not.toMatch(/flex:\s*"none"/);
    expect(selectBlock[0]).toMatch(/flex:\s*"0 1 auto"/);
  });

  // Mutation check (WRONG-CASE/DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 shape): replay the EXACT pre-fix
  // literal for the flag-chip style and prove these same assertions catch it, so a passing test
  // above is known to distinguish the fix from the defect rather than from an unrelated string.
  it("mutation check: the pre-fix rowFlagBadgeStyle literal fails the shrink assertion", () => {
    const broken = 'const rowFlagBadgeStyle = { flex: "none", fontSize: 9.5, fontWeight: 700, color: PAL.muted, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.pill, padding: "1px 6px", whiteSpace: "nowrap" };';
    const styleDecl = broken.match(/const rowFlagBadgeStyle = \{.*\};/);
    expect(styleDecl[0]).toMatch(/flex:\s*"none"/); // reproduces the reported defect
    expect(styleDecl[0]).not.toMatch(/minWidth:\s*0/);
  });
});
