import { describe, it, expect } from "vitest";
import {
  sizeBandFor, bandSentenceLabel, compSizeSf, compHeadlineRate, buildPeerSet,
  peerComparisonSentence, compScaleLayout, countyLabel, countyEntry, relativeTimeLabel,
  mostRecentlyAddedComp, buildCompsCardData, SIZE_BANDS, TYPE_LABEL,
} from "../src/workspaces/dashboard/lib/compsCardModel.js";

describe("compsCardModel: sizeBandFor", () => {
  it("buckets into the four industrial tiers", () => {
    expect(sizeBandFor(50000).key).toBe("under100k");
    expect(sizeBandFor(150000).key).toBe("100to250k");
    expect(sizeBandFor(300000).key).toBe("250to500k");
    expect(sizeBandFor(900000).key).toBe("over500k");
  });
  it("is null for missing/zero/negative — the disqualifying signal, never a guessed band", () => {
    expect(sizeBandFor(null)).toBeNull();
    expect(sizeBandFor(undefined)).toBeNull();
    expect(sizeBandFor(0)).toBeNull();
    expect(sizeBandFor(-5)).toBeNull();
    expect(sizeBandFor(NaN)).toBeNull();
  });
  it("boundary values land in the band they enter, never the one they're leaving", () => {
    expect(sizeBandFor(100000).key).toBe("100to250k");
    expect(sizeBandFor(500000).key).toBe("over500k");
  });
});

describe("compsCardModel: bandSentenceLabel", () => {
  it("uses 'sites' for land and 'buildings' for a sale or lease", () => {
    const band = SIZE_BANDS.find((b) => b.key === "over500k");
    expect(bandSentenceLabel(band, "land")).toBe("sites over 500,000 SF");
    expect(bandSentenceLabel(band, "building_sale")).toBe("buildings over 500,000 SF");
    expect(bandSentenceLabel(band, "lease")).toBe("buildings over 500,000 SF");
  });
  it("is null with no band", () => {
    expect(bandSentenceLabel(null, "lease")).toBeNull();
  });
});

describe("compsCardModel: compSizeSf", () => {
  it("reads each type's own size field", () => {
    expect(compSizeSf({ compType: "building_sale", bldgSizeSf: 250000 })).toBe(250000);
    expect(compSizeSf({ compType: "lease", leaseSizeSf: 40000 })).toBe(40000);
    expect(compSizeSf({ compType: "land", landSizeValue: 2, landSizeUnit: "ac" })).toBeCloseTo(87120, 5);
  });
  it("is null when the size isn't recorded, and for a null comp", () => {
    expect(compSizeSf({ compType: "building_sale" })).toBeNull();
    expect(compSizeSf(null)).toBeNull();
  });
});

describe("compsCardModel: compHeadlineRate", () => {
  it("lease: annualized rate, carrying its basis for the chip", () => {
    const r = compHeadlineRate({ compType: "lease", leaseRate: 0.5, leaseRatePeriod: "monthly", leaseRateExpense: "nnn" });
    expect(r.value).toBeCloseTo(6, 5);
    expect(r.unit).toBe("$/SF/yr");
    expect(r.basis).toBe("nnn");
  });
  it("building sale: $/SF price, no basis", () => {
    const r = compHeadlineRate({ compType: "building_sale", bldgPrice: 500000, bldgSizeSf: 25000 });
    expect(r.value).toBeCloseTo(20, 5);
    expect(r.unit).toBe("$/SF");
    expect(r.basis).toBeNull();
  });
  it("land: price per the comp's OWN recorded unit, AC or SF", () => {
    const perAcre = compHeadlineRate({ compType: "land", landPrice: 87120, landSizeValue: 1, landSizeUnit: "ac" });
    expect(perAcre.unit).toBe("$/AC");
    const perSf = compHeadlineRate({ compType: "land", landPrice: 100000, landSizeValue: 10000, landSizeUnit: "sf" });
    expect(perSf.unit).toBe("$/SF");
  });
  it("is null when the comp doesn't carry enough to compute one — never guessed", () => {
    expect(compHeadlineRate({ compType: "lease", leaseRate: 7 })).toBeNull(); // no period
    expect(compHeadlineRate({ compType: "building_sale" })).toBeNull();
    expect(compHeadlineRate(null)).toBeNull();
  });
});

function leaseComp(id, { county = "harris", sf = 600000, rate = 5, createdAt = "2026-09-01" } = {}) {
  return {
    id, compType: "lease", createdAt,
    anchor: { county },
    leaseSizeSf: sf, leaseRate: rate, leaseRatePeriod: "annual", leaseRateExpense: "nnn",
  };
}

describe("compsCardModel: buildPeerSet", () => {
  it("matches same county + same type + same size band, excludes the featured comp itself", () => {
    const featured = leaseComp("f", { county: "harris", sf: 600000 });
    const comps = [
      featured,
      leaseComp("p1", { county: "harris", sf: 550000 }),
      leaseComp("p2", { county: "harris", sf: 900000 }),
    ];
    const { peers, excludedCount } = buildPeerSet(comps, featured);
    expect(peers.map((p) => p.comp.id).sort()).toEqual(["p1", "p2"]);
    expect(excludedCount).toBe(0);
  });
  it("a different county is simply not a peer — not counted as excluded", () => {
    const featured = leaseComp("f", { county: "harris" });
    const comps = [featured, leaseComp("p1", { county: "waller" })];
    const { peers, excludedCount } = buildPeerSet(comps, featured);
    expect(peers).toHaveLength(0);
    expect(excludedCount).toBe(0);
  });
  it("a different comp type is simply not a peer — not counted as excluded", () => {
    const featured = leaseComp("f", { county: "harris" });
    const comps = [featured, { id: "p1", compType: "building_sale", anchor: { county: "harris" }, bldgSizeSf: 600000, bldgPrice: 1000000, createdAt: "2026-09-01" }];
    const { peers, excludedCount } = buildPeerSet(comps, featured);
    expect(peers).toHaveLength(0);
    expect(excludedCount).toBe(0);
  });
  it("a different size band is simply not a peer — not counted as excluded", () => {
    const featured = leaseComp("f", { county: "harris", sf: 600000 }); // over500k
    const comps = [featured, leaseComp("p1", { county: "harris", sf: 50000 })]; // under100k
    const { peers, excludedCount } = buildPeerSet(comps, featured);
    expect(peers).toHaveLength(0);
    expect(excludedCount).toBe(0);
  });
  it("a same-type comp missing county or size is EXCLUDED and counted, never silently skipped or included", () => {
    const featured = leaseComp("f", { county: "harris", sf: 600000 });
    const missingCounty = { ...leaseComp("p1", { sf: 600000 }), anchor: { county: null } };
    const missingSize = { ...leaseComp("p2", { county: "harris" }), leaseSizeSf: null };
    const missingRate = { ...leaseComp("p3", { county: "harris", sf: 600000 }), leaseRate: null, leaseRatePeriod: null };
    const comps = [featured, missingCounty, missingSize, missingRate];
    const { peers, excludedCount } = buildPeerSet(comps, featured);
    expect(peers).toHaveLength(0);
    expect(excludedCount).toBe(3);
  });
  it("the featured comp itself missing a county or size yields an empty peer set (never crashes)", () => {
    const featured = { ...leaseComp("f"), anchor: { county: null } };
    expect(buildPeerSet([featured], featured).peers).toHaveLength(0);
    const noSize = { ...leaseComp("f2", { county: "harris" }), leaseSizeSf: null };
    expect(buildPeerSet([noSize], noSize).peers).toHaveLength(0);
  });
  it("never mutates its input array", () => {
    const featured = leaseComp("f", { county: "harris" });
    const comps = [featured, leaseComp("p1", { county: "harris" })];
    const snapshot = JSON.stringify(comps);
    buildPeerSet(comps, featured);
    expect(JSON.stringify(comps)).toBe(snapshot);
  });
});

describe("compsCardModel: peerComparisonSentence", () => {
  it("is null with fewer than three peers — 'too small' is the caller's own message, not this one's", () => {
    const featured = leaseComp("f", { county: "harris", rate: 5 });
    const peerSet = { peers: [{ comp: leaseComp("p1"), rate: 4 }], band: SIZE_BANDS[3] };
    expect(peerComparisonSentence({ featuredRate: 5, peerSet, compType: "lease", countyLabel: "Harris County, TX" })).toBeNull();
  });
  it("names the highest/lowest/nth-highest rank, the median delta, the band and the county", () => {
    const peerSet = {
      band: SIZE_BANDS.find((b) => b.key === "over500k"),
      peers: [
        { rate: 4.90 }, { rate: 4.95 }, { rate: 4.80 }, { rate: 4.70 }, { rate: 4.60 }, { rate: 4.50 }, { rate: 4.40 },
      ],
    };
    // featured = 4.95 -> sorted desc: 4.95(featured tie w/ 4.95 peer), indexOf finds first match.
    // Use a distinct featured rate to avoid a tie ambiguity in the assertion.
    const sentence = peerComparisonSentence({ featuredRate: 5.0, peerSet, compType: "lease", countyLabel: "Harris County, TX" });
    expect(sentence).toBe("the highest of the eight, and 30 cents above the median for buildings over 500,000 SF in Harris County, TX.");
  });
  it("reads 'the lowest' for the bottom rank", () => {
    const peerSet = { band: SIZE_BANDS[3], peers: [{ rate: 5 }, { rate: 6 }, { rate: 7 }] };
    const sentence = peerComparisonSentence({ featuredRate: 1, peerSet, compType: "lease", countyLabel: "Harris County, TX" });
    expect(sentence).toMatch(/^the lowest of the four, and/);
  });
  it("reads 'second highest' style ordinals for a middle rank", () => {
    const peerSet = { band: SIZE_BANDS[3], peers: [{ rate: 10 }, { rate: 8 }, { rate: 6 }] };
    const sentence = peerComparisonSentence({ featuredRate: 9, peerSet, compType: "lease", countyLabel: "Harris County, TX" });
    expect(sentence).toMatch(/^second highest of the four, and/);
  });
  it("phrases a small delta in cents, and names the direction (above/below/at the median)", () => {
    const peerSet = { band: SIZE_BANDS[3], peers: [{ rate: 5.00 }, { rate: 5.00 }, { rate: 5.00 }] };
    expect(peerComparisonSentence({ featuredRate: 5.05, peerSet, compType: "lease", countyLabel: "X" })).toMatch(/5 cents above the median/);
    expect(peerComparisonSentence({ featuredRate: 4.95, peerSet, compType: "lease", countyLabel: "X" })).toMatch(/5 cents below the median/);
    expect(peerComparisonSentence({ featuredRate: 5.00, peerSet, compType: "lease", countyLabel: "X" })).toMatch(/right at the median/);
  });
  it("uses whole dollars once the delta reaches a dollar", () => {
    const peerSet = { band: SIZE_BANDS[3], peers: [{ rate: 5 }, { rate: 5 }, { rate: 5 }] };
    expect(peerComparisonSentence({ featuredRate: 7, peerSet, compType: "lease", countyLabel: "X" })).toMatch(/\$2\.00 above the median/);
  });
});

describe("compsCardModel: compScaleLayout", () => {
  it("maps rates to 0..1 fractions across the peers+featured domain", () => {
    const { min, max, peerFracs, featuredFrac } = compScaleLayout(10, [0, 5, 20]);
    expect(min).toBe(0);
    expect(max).toBe(20);
    expect(peerFracs).toEqual([0, 0.25, 1]);
    expect(featuredFrac).toBeCloseTo(0.5, 5);
  });
  it("the featured value can never fall outside the domain, even as the new high or low", () => {
    const { featuredFrac } = compScaleLayout(0, [5, 10]);
    expect(featuredFrac).toBe(0);
    const { featuredFrac: hi } = compScaleLayout(20, [5, 10]);
    expect(hi).toBe(1);
  });
  it("a zero-span domain (every rate identical) centers everything instead of dividing by zero", () => {
    const { peerFracs, featuredFrac } = compScaleLayout(5, [5, 5]);
    expect(peerFracs).toEqual([0.5, 0.5]);
    expect(featuredFrac).toBe(0.5);
  });
});

describe("compsCardModel: countyLabel / countyEntry", () => {
  it("a plain key reads as a Texas county", () => {
    expect(countyLabel("harris")).toBe("Harris County, TX");
    expect(countyLabel("fort_bend")).toBe("Fort Bend County, TX");
  });
  it("a co_ prefix reads as a Colorado county, prefix stripped", () => {
    expect(countyLabel("co_denver")).toBe("Denver County, CO");
  });
  it("is null with no key", () => {
    expect(countyLabel(null)).toBeNull();
    expect(countyLabel("")).toBeNull();
  });
  it("countyEntry matches compLocationText.js's expected {name, state} shape", () => {
    expect(countyEntry("harris")).toEqual({ name: "Harris County", state: "TX" });
    expect(countyEntry("co_denver")).toEqual({ name: "Denver County", state: "CO" });
    expect(countyEntry(null)).toBeNull();
  });
});

describe("compsCardModel: relativeTimeLabel", () => {
  it("today / 1 day / N days / N months, matching the Dashboard's existing convention", () => {
    const now = Date.now();
    expect(relativeTimeLabel(new Date(now).toISOString())).toBe("today");
    expect(relativeTimeLabel(new Date(now - 86400000).toISOString())).toBe("1 day ago");
    expect(relativeTimeLabel(new Date(now - 5 * 86400000).toISOString())).toBe("5 days ago");
    expect(relativeTimeLabel(new Date(now - 62 * 86400000).toISOString())).toBe("2 months ago");
  });
  it("is null with no timestamp", () => {
    expect(relativeTimeLabel(null)).toBeNull();
  });
});

describe("compsCardModel: mostRecentlyAddedComp", () => {
  it("picks the comp with the newest createdAt — 'Date entered', never the deal's Executed date", () => {
    const comps = [
      { id: "a", createdAt: "2026-08-01T00:00:00Z" },
      { id: "b", createdAt: "2026-09-05T00:00:00Z" },
      { id: "c", createdAt: "2026-09-01T00:00:00Z" },
    ];
    expect(mostRecentlyAddedComp(comps).id).toBe("b");
  });
  it("is null for an empty or missing list", () => {
    expect(mostRecentlyAddedComp([])).toBeNull();
    expect(mostRecentlyAddedComp(null)).toBeNull();
  });
});

describe("compsCardModel: buildCompsCardData (integration)", () => {
  it("returns total:0, featured:null for an empty account", () => {
    expect(buildCompsCardData([])).toEqual({ featured: null, total: 0 });
  });
  it("assembles featured + peer set + rate + sentence for a real account", () => {
    const comps = [
      leaseComp("f", { county: "harris", sf: 600000, rate: 5.0, createdAt: "2026-09-06" }),
      leaseComp("p1", { county: "harris", sf: 550000, rate: 4.9, createdAt: "2026-01-01" }),
      leaseComp("p2", { county: "harris", sf: 700000, rate: 4.8, createdAt: "2026-01-02" }),
      leaseComp("p3", { county: "harris", sf: 900000, rate: 4.7, createdAt: "2026-01-03" }),
    ];
    const data = buildCompsCardData(comps);
    expect(data.featured.id).toBe("f");
    expect(data.total).toBe(4);
    expect(data.peerSet.peers).toHaveLength(3);
    expect(data.rate.value).toBeCloseTo(5.0, 5);
    expect(data.countyLabel).toBe("Harris County, TX");
    expect(data.sentence).toMatch(/^the highest of the four, and/);
  });
  it("names TYPE_LABEL for every comp type (sanity — the chip vocabulary)", () => {
    expect(TYPE_LABEL).toEqual({ land: "Land", building_sale: "Building sale", lease: "Lease" });
  });
});
