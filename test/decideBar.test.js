/* NEW-1 (2026-09-08) — the map toolbar's decide bar.
 *
 * The toolbar stopped asking "what are you making?" before the user had pointed at any ground; it
 * asks afterwards, on a bar carrying three verbs at once. Three pure decisions drive that bar, and
 * they are tested here because a regression in ANY of them still renders a perfectly good-looking
 * toolbar — the sticky answer silently reverting to "Plan a site" every time, an unavailable verb
 * leading a bar that cannot run it, a bar that thinks it is about parcels when it is about a pin.
 * No screenshot, pixel diff or e2e path in this repo can tell those apart from correct behaviour.
 */
import { describe, it, expect } from "vitest";
import { decideTargetOf, orderVerbs, verbLabel } from "../src/workspaces/site-planner/lib/decideBar.js";

const ALL = ["site", "comp", "siteplan", "note"];   // B1372144 added the fourth

describe("decideTargetOf — which ground the bar is about", () => {
  it("is null with nothing pointed at, which is what shows the at-rest row instead", () => {
    expect(decideTargetOf({ selectedCount: 0, hasPin: false })).toBe(null);
    expect(decideTargetOf({})).toBe(null);
    expect(decideTargetOf()).toBe(null);
  });

  it("reads parcels for any non-empty selection — a multi-lot assembly is one target, not none", () => {
    // B941152's defect in its pure form: a 2+ parcel selection once had no primary action at all.
    expect(decideTargetOf({ selectedCount: 1 })).toBe("parcels");
    expect(decideTargetOf({ selectedCount: 7 })).toBe("parcels");
  });

  it("reads pin for a raw point", () => {
    expect(decideTargetOf({ selectedCount: 0, hasPin: true })).toBe("pin");
  });

  it("prefers parcels when both are somehow set, so three verbs never mean two things at once", () => {
    expect(decideTargetOf({ selectedCount: 2, hasPin: true })).toBe("parcels");
  });
});

describe("orderVerbs — the sticky answer", () => {
  it("leads with Plan a site on a fresh session (no stored verb)", () => {
    expect(orderVerbs(ALL, null)[0]).toBe("site");
  });

  it("leads with the last verb chosen — the whole point, since ground-first costs a click per comp", () => {
    expect(orderVerbs(ALL, "comp")[0]).toBe("comp");
    expect(orderVerbs(ALL, "siteplan")[0]).toBe("siteplan");
  });

  it("keeps every verb present and each exactly once, whichever one leads", () => {
    for (const last of [null, "site", "comp", "siteplan", "nonsense"]) {
      const out = orderVerbs(ALL, last);
      expect([...out].sort()).toEqual([...ALL].sort());
    }
  });

  it("never leads with a verb it cannot run — a comp with nowhere to go falls back to site", () => {
    const noComp = (k) => k !== "comp";
    const out = orderVerbs(ALL, "comp", noComp);
    expect(out[0]).toBe("site");
    expect(out).not.toContain("comp");
  });

  it("falls back past an unavailable site too, rather than returning an empty bar", () => {
    const out = orderVerbs(ALL, "comp", (k) => k === "siteplan");
    expect(out).toEqual(["siteplan"]);
  });

  it("returns nothing when nothing is available, so the bar renders no dead buttons", () => {
    expect(orderVerbs(ALL, "site", () => false)).toEqual([]);
    expect(orderVerbs([], null)).toEqual([]);
  });

  it("ignores a stored verb that is not a real verb (a stale or hand-edited session value)", () => {
    // B1372144 — this case used "note" as its example of an unreal verb; "note" is a real verb now
    // (the fourth), so the example moved to a key nothing has ever shipped. The property under test
    // is unchanged: an unrecognised stored verb must not lead the bar, and "site" is the fallback.
    expect(orderVerbs(ALL, "sketch")[0]).toBe("site");
    expect(orderVerbs(ALL, "note")[0]).toBe("note");   // and a REAL stored verb still leads
  });
});

describe("verbLabel — how each verb reads", () => {
  it("says Plan a site in the singular, the owner's own wording (2026-09-08)", () => {
    expect(verbLabel("site", 0)).toBe("Plan a site");
    expect(verbLabel("site", 1)).toBe("Plan a site");
  });

  it("counts the lots in the plural, the wording this button already carried", () => {
    expect(verbLabel("site", 2)).toBe("Plan 2 parcels");
    expect(verbLabel("site", 11)).toBe("Plan 11 parcels");
  });

  it("leaves the other two alone at every count — a comp is one comp however it is anchored", () => {
    for (const n of [0, 1, 5]) {
      expect(verbLabel("comp", n)).toBe("Log a comp");
      expect(verbLabel("siteplan", n)).toBe("Place a site plan");
    }
  });

  /* ⛔ SUPERSEDED BY B1372144, and the original is kept in words because the reason it existed is
     the reason it may now change. This test read: "has no fourth verb — 'add a note' is a concept
     this app does not have yet, and inventing a label here would be the first half of inventing the
     feature", asserting `verbLabel("note", 1) === ""`. That was right: a label with no record, no
     marker and no editor behind it is a button that lies. B1372144 built the concept —
     `public.map_notes`, a marker, an editor, a layer toggle — so the label is now backed by a verb
     that does something, and the guard changes shape rather than disappearing: the FOURTH verb
     reads correctly, and an UNKNOWN key still returns "" (which is what actually stops a label
     being invented ahead of its feature). */
  it("reads the fourth verb, 'Add a note', the same however much ground is selected", () => {
    for (const n of [0, 1, 2, 9]) expect(verbLabel("note", n)).toBe("Add a note");
  });

  it("still returns '' for a verb key that has no feature behind it", () => {
    for (const k of ["", "nonsense", "sketch", "measure", undefined]) expect(verbLabel(k, 1)).toBe("");
  });
});
