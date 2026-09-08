/* MAP.md generator (B637; narrowed by NEW-1/B<PENDING>, 2026-09-08). This used to require the
 * committed repo-root MAP.md's file/export inventory to exactly match a fresh scan of the source
 * tree on every PR — dropped because that meant every PR that added/removed/renamed a file, or
 * changed a primary export (an extremely common shape of change), also had to regenerate and
 * commit MAP.md, so any two such PRs open at once conflicted on it by construction (see
 * .github/ci-gates.yml's "Generated-index touch guard"). MAP.md is now refreshed by a scheduled
 * job instead (.github/workflows/regen-derived-docs.yml), so it can be briefly stale between
 * refreshes — expected and fine, since nothing in the app reads it at runtime. `auditMap()` and
 * its `--check` CLI mode still exist for that job and for local use.
 *
 * What's still worth asserting here, decoupled from whether the committed file happens to be
 * fresh right now: the generator runs cleanly and returns the documented shape, and it never
 * reintroduces the volatile generated-at stamp this same item removed (a date/commit-hash header
 * that changed on every regen even with zero real content change — a PR was once observed whose
 * entire diff was "Refresh MAP.md's generated-at stamp"). */
import { describe, it, expect } from "vitest";
import { auditMap, render } from "../scripts/build-map.mjs";

describe("MAP.md generator", () => {
  it("runs cleanly and reports the documented shape", () => {
    const { ok, problems, todos, drift } = auditMap();
    expect(typeof ok).toBe("boolean");
    expect(Array.isArray(problems)).toBe(true);
    expect(Array.isArray(todos)).toBe(true);
    expect(drift === null || typeof drift === "object").toBe(true);
  });

  /* Built from a FRESH render, never the currently-committed MAP.md — that file can be briefly
   * stale between the scheduled job's refreshes (by design, see this file's own header), so a
   * regression test has to exercise the generator itself, not today's regen state. */
  it("a fresh render's header carries no volatile date/commit-hash stamp", () => {
    const header = render([{ path: "src/main.jsx", owner: "infra", exports: ["default"] }], new Map())
      .split("\n").slice(0, 6).join("\n");
    expect(header).not.toMatch(/Generated \d{4}-\d{2}-\d{2}/);
    expect(header).not.toMatch(/@ `[0-9a-f]{7,}`/);
  });
});
