/* generated-doc-touch-guard.mjs (NEW-1, B1358128). Fails CI if a branch modifies a GENERATED
 * file — MAP.md, BACKLOG_OPEN.md, docs/UI-INVENTORY.md — instead of leaving them for the
 * scheduled regen job. Pure verdict only; the real-git half (`runGate`) is exercised live by CI
 * on every push, same shape as `test/mintGuard.test.js` vs. `check-mint.mjs`'s `runGate`. */
import { describe, it, expect } from "vitest";
import { verdict, isRegenBranch, GENERATED_DOCS, REGEN_BRANCH_PREFIX } from "../scripts/generated-doc-touch-guard.mjs";

describe("generated-doc-touch-guard verdict", () => {
  it("passes a branch that touches none of the generated docs", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: ["src/app/Shell.jsx", "BACKLOG.md"] });
    expect(v.ok).toBe(true);
    expect(v.touched).toEqual([]);
  });

  it("fails an ordinary branch that touches MAP.md", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: ["src/app/Shell.jsx", "MAP.md"] });
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual(["MAP.md"]);
  });

  it("fails an ordinary branch that touches BACKLOG_OPEN.md alongside BACKLOG.md", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: ["BACKLOG.md", "BACKLOG_OPEN.md"] });
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual(["BACKLOG_OPEN.md"]);
  });

  it("fails an ordinary branch that touches docs/UI-INVENTORY.md", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: ["docs/UI-INVENTORY.md"] });
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual(["docs/UI-INVENTORY.md"]);
  });

  it("reports every touched generated file, not just the first", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: [...GENERATED_DOCS, "src/app/Shell.jsx"] });
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual(GENERATED_DOCS);
  });

  it("exempts a push to main outright, even one that touches all three", () => {
    const v = verdict({ branchNames: ["main"], changedFiles: GENERATED_DOCS });
    expect(v.ok).toBe(true);
  });

  it("exempts refs/heads/main too (a push event's GITHUB_REF_NAME shape)", () => {
    const v = verdict({ branchNames: ["refs/heads/main"], changedFiles: ["MAP.md"] });
    expect(v.ok).toBe(true);
  });

  it("exempts the scheduled regen branch when its diff touches ONLY generated docs", () => {
    const v = verdict({ branchNames: [`${REGEN_BRANCH_PREFIX}-20260908120000`], changedFiles: GENERATED_DOCS });
    expect(v.ok).toBe(true);
    expect(v.touched).toEqual(GENERATED_DOCS);
  });

  it("does NOT exempt the regen branch if its diff touches anything else — the escape hatch must stay narrow", () => {
    const v = verdict({
      branchNames: [`${REGEN_BRANCH_PREFIX}-20260908120000`],
      changedFiles: [...GENERATED_DOCS, "src/app/Shell.jsx"],
    });
    expect(v.ok).toBe(false);
    expect(v.touched).toEqual(GENERATED_DOCS);
  });

  it("does not exempt a branch that merely contains the regen prefix as a substring, not a prefix", () => {
    expect(isRegenBranch("claude/not-chore/regen-derived-docs-lookalike")).toBe(false);
    expect(isRegenBranch(`${REGEN_BRANCH_PREFIX}-anything`)).toBe(true);
  });

  it("passes cleanly when nothing changed at all", () => {
    const v = verdict({ branchNames: ["claude/some-feature"], changedFiles: [] });
    expect(v.ok).toBe(true);
    expect(v.touched).toEqual([]);
  });
});
