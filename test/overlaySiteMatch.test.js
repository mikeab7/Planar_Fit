import { describe, it, expect } from "vitest";
import { findMatchingSiteForOverlay, SITE_MATCH_BUFFER_FT } from "../src/shared/sitePlans/lib/overlaySiteMatch.js";

// The owner's real Airtex plan (site_plan_overlays id aa2d8163) and the real Core 5 - West Hardy
// tracked site (trk8eef7db4d0) it was backfilled onto — same production coordinates
// test/compSiteMatch.test.js already uses, so this suite proves the rule against the exact case
// that motivated it, not a synthetic one. `imgW`/`imgH`/`ftPerPx` are chosen so the drawn
// footprint is exactly the owner's own measured "3,000 x 3,882 ft" (ftPerPx: 1, so pixels==feet;
// half-height is therefore 1,941 ft — the number every offset below is measured against).
const AIRTEX_OVERLAY = {
  centerLat: 29.9878389243674, centerLon: -95.3966972081149,
  ftPerPx: 1, imgW: 3000, imgH: 3882, rotationDeg: 0,
  docTitle: "C5IP_Airtex_BldgA_PropertyFlyer_Rd5",
};
const CORE5 = { id: "trk8eef7db4d0", groupId: "trk8eef7db4d0", site: "Core 5 - West Hardy", origin: { lat: 29.9862907597668, lon: -95.3968627418879 } };

// A point due south of the plan's own centre, `ft` away — dLat only, so the approximate
// ft-per-degree conversion (~364,000 ft/deg at this latitude) only has to be right to within the
// margins each test below leaves itself (order of a few hundred feet, not a handful).
const southOf = (ft, name) => ({ id: name, groupId: name, site: name, origin: { lat: 29.9878389243674 - ft / 364000, lon: -95.3966972081149 } });

describe("overlaySiteMatch", () => {
  it("matches a site whose own point falls inside the plan's drawn rectangle (the real Airtex/Core 5 case)", () => {
    const match = findMatchingSiteForOverlay(AIRTEX_OVERLAY, [CORE5]);
    expect(match).toEqual({ groupId: "trk8eef7db4d0", name: "Core 5 - West Hardy", matchedBy: "footprint" });
  });

  it("the fixed buffer tolerates a site's point sitting just past the drawn crop, without scaling with plan size", () => {
    // Half-height 1,941 ft + the 300 ft buffer = 2,241 ft is the edge; 2,000 ft sits comfortably
    // inside it.
    const justInsideBuffer = southOf(2000, "Just inside the buffer");
    expect(findMatchingSiteForOverlay(AIRTEX_OVERLAY, [justInsideBuffer])).toEqual({ groupId: "Just inside the buffer", name: "Just inside the buffer", matchedBy: "footprint" });
    expect(SITE_MATCH_BUFFER_FT).toBe(300);
  });

  it("does NOT match a site outside the plan's footprint+buffer, even one that sits inside a comp-calibrated 0.5mi (2,640 ft) radius", () => {
    // 2,500 ft is past the 2,241 ft footprint+buffer edge, but well inside the OLD comp radius —
    // exactly the false-positive class this module exists to close.
    const pastFootprint = southOf(2500, "Past the footprint, inside the old comp radius");
    expect(findMatchingSiteForOverlay(AIRTEX_OVERLAY, [pastFootprint])).toBeNull();
  });

  it("prefers the site closest to the plan's own center when more than one falls inside the footprint", () => {
    const near = southOf(100, "near");
    const far = southOf(1500, "far");
    const match = findMatchingSiteForOverlay(AIRTEX_OVERLAY, [far, near]);
    expect(match.groupId).toBe("near");
  });

  it("falls back to an exact normalized-title match when no site's point falls inside the drawing at all", () => {
    const outside = southOf(2500, "Outside the drawing");
    const byName = { id: "byname", groupId: "byname", site: "  c5ip_airtex_bldga_propertyflyer_rd5  ", origin: null };
    const match = findMatchingSiteForOverlay(AIRTEX_OVERLAY, [outside, byName]);
    expect(match).toEqual({ groupId: "byname", name: "  c5ip_airtex_bldga_propertyflyer_rd5  ", matchedBy: "name" });
  });

  it("returns null when nothing plausibly matches — the caller mints a new tracked site", () => {
    expect(findMatchingSiteForOverlay(AIRTEX_OVERLAY, [southOf(2500, "Outside")])).toBeNull();
    expect(findMatchingSiteForOverlay(AIRTEX_OVERLAY, [])).toBeNull();
  });

  it("refuses an unplaced overlay (no ftPerPx/imgW/imgH) rather than reporting a false containment", () => {
    expect(findMatchingSiteForOverlay({ centerLat: 29.98, centerLon: -95.39, docTitle: "" }, [CORE5])).toBeNull();
  });

  it("ignores a candidate site with no resolved origin and no matching title", () => {
    const noOrigin = { id: "s2", groupId: "s2", site: "Blank planner site", origin: null };
    expect(findMatchingSiteForOverlay(AIRTEX_OVERLAY, [noOrigin])).toBeNull();
  });
});
