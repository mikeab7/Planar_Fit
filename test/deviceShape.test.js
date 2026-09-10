import { describe, it, expect } from "vitest";
import { isPhoneShape } from "../src/workspaces/site-planner/lib/deviceShape.js";

// B1447443 — a large iPhone in LANDSCAPE is wider than the width-only phone/desktop breakpoint,
// so it silently took the desktop layout on a screen that is desktop-wide but phone-SHORT, and
// the module rail's last two entries were clipped with no way to scroll to them. `isPhoneShape`
// widens the width-only test with a second path: a coarse pointer AND a short viewport.

describe("isPhoneShape", () => {
  it("a plain narrow width is phone-shaped regardless of pointer (unchanged legacy behaviour)", () => {
    expect(isPhoneShape({ narrowWidth: true, shortHeight: false, coarsePointer: false })).toBe(true);
    expect(isPhoneShape({ narrowWidth: true, shortHeight: false, coarsePointer: true })).toBe(true);
  });

  it("a landscape phone — wide, short, touch — is phone-shaped (the B1447443 case)", () => {
    expect(isPhoneShape({ narrowWidth: false, shortHeight: true, coarsePointer: true })).toBe(true);
  });

  it("a real desktop window is never phone-shaped, at any height, because it is never coarse-pointer", () => {
    expect(isPhoneShape({ narrowWidth: false, shortHeight: true, coarsePointer: false })).toBe(false);
    expect(isPhoneShape({ narrowWidth: false, shortHeight: false, coarsePointer: false })).toBe(false);
  });

  it("a wide, TALL touch device (an iPad in landscape) is not phone-shaped — height is what distinguishes it", () => {
    expect(isPhoneShape({ narrowWidth: false, shortHeight: false, coarsePointer: true })).toBe(false);
  });

  it("neither signal set", () => {
    expect(isPhoneShape({ narrowWidth: false, shortHeight: false, coarsePointer: false })).toBe(false);
  });

  it("missing/undefined fields never throw and read as false", () => {
    expect(isPhoneShape({})).toBe(false);
  });
});
