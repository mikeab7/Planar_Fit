/* NEW-2 (2026-09-08) — the pure half of the ArcGIS-Online official-organization pass.
 *
 * WHAT THIS GUARDS. `probe-statewide-parcels.mjs` used to resolve a state's parcel candidate from
 * that state's own `.gov` GIS host only. This sandbox reaches `*.arcgis.com` and cannot reach most
 * state `.gov` domains, so a state publishing the SAME dataset to its own ArcGIS Online
 * organizational account was reachable all along and was never looked for — which is how
 * California (13.1M parcels, CAL FIRE) and Rhode Island (394k parcels, RIGIS) both sat on record
 * as `no-free-source` / `Candidate: none found`. New York had already been rescued by exactly
 * this route and it was filed as a one-off rather than a method.
 *
 * The network half is a thin wrapper; every DECISION is pure and lives here.
 */
import { describe, it, expect } from "vitest";
import {
  classifyPublisher, isCommercialPublisher, looksParcelShaped, serviceLayerUrl,
  assessKnownGood, stateQueries, makeOrgResolver, searchState, namesTheState,
  KNOWN_GOOD, KNOWN_BAD, VERIFIED_STATE_ORGS, COMMERCIAL_PUBLISHERS,
} from "../ui-audit/lib/agolParcelSearch.mjs";

describe("the vacuity guard — the pass must report its own known answers before any score", () => {
  it("is NOT vacuous: every known-good arm reads official, every known-bad arm reads excluded", () => {
    const { vacuous, failures } = assessKnownGood();
    expect(failures).toEqual([]);
    expect(vacuous).toBe(false);
  });

  it("goes VACUOUS when the classifier is mutated to reject everything — a filter tightened into a confident clean zero", () => {
    // The exact failure this guard exists for: a search-and-filter pipeline that returns nothing
    // looks identical, downstream, to a world that contains nothing.
    const rejectAll = () => ({ tier: "excluded", reason: "mutant" });
    const { vacuous, failures } = assessKnownGood(rejectAll);
    expect(vacuous).toBe(true);
    expect(failures.some((f) => /KNOWN-GOOD CA/.test(f))).toBe(true);
  });

  it("goes VACUOUS when the classifier is mutated to admit everything — the other direction", () => {
    const admitAll = () => ({ tier: "official", reason: "mutant" });
    const { vacuous, failures } = assessKnownGood(admitAll);
    expect(vacuous).toBe(true);
    expect(failures.some((f) => /KNOWN-BAD data_regrid/.test(f))).toBe(true);
  });
});

describe("classifyPublisher — three tiers, and the middle one never discards", () => {
  const ny = KNOWN_GOOD.find((k) => k.state === "NY");
  const ri = KNOWN_GOOD.find((k) => k.state === "RI");
  const ca = KNOWN_GOOD.find((k) => k.state === "CA");

  it("a verified state organization is official, by orgId — the stable key, never the display name", () => {
    expect(classifyPublisher(ny).tier).toBe("official");
    expect(classifyPublisher(ri).tier).toBe("official");
    expect(Object.keys(VERIFIED_STATE_ORGS)).toContain("bz1uwWPKUInZBK94"); // CAL FIRE
  });

  it("Wyoming is admitted by the NAME HEURISTIC alone — the heuristic path is live, not dead behind the registry", () => {
    // "Wyoming Department of Revenue" names its state and names a government body. This arm
    // exists so a registry that quietly became the ONLY admission route is caught.
    const wy = KNOWN_GOOD.find((k) => k.state === "WY");
    const bare = classifyPublisher({ ...wy, registry: {} });
    expect(bare.tier).toBe("official");
    expect(bare.reason).toMatch(/state-agency/);
  });

  /* ⛔ CALIFORNIA'S OWN PUBLISHER FAILS THE HEURISTIC, and that is the finding, not a defect.
   * Resolved live 2026-09-08, CAL FIRE's ArcGIS organization is called exactly "CAL FIRE" — it
   * names neither "California" nor any government body. An earlier draft of the lib ASSUMED it
   * was called "California Department of Forestry and Fire Protection" and asserted it as a
   * heuristic pass; both the assumption and the assertion were wrong. */
  it("California — the state this pass was written to find — is NOT reachable by the name heuristic, and must still never be discarded", () => {
    const bare = classifyPublisher({ ...ca, registry: {} });
    expect(bare.tier).toBe("review");
    expect(bare.tier).not.toBe("excluded");
    expect(classifyPublisher(ca).tier).toBe("official"); // the registry is what promotes it
  });

  /* ⛔ THE CENTRAL PROPERTY. Resolved live 2026-09-08: New York's ArcGIS organization is called
   * "ShareGIS NY" and Rhode Island's "  RIDEM - Map Room" — neither name says "state", "New York"
   * or "Rhode Island" in a form a name heuristic can read. A two-way filter therefore DISCARDS
   * two of the three real state publishers this repo has verified, and each discard reads
   * downstream as an authoritative `no-free-source`. That is exactly how CA and RI were lost. */
  it("a real state publisher whose org NAME says nothing governmental falls to review, NEVER to excluded", () => {
    for (const k of [ny, ri, ca]) {
      const bare = classifyPublisher({ ...k, registry: {} });
      expect(bare.tier).toBe("review");
      expect(bare.tier).not.toBe("excluded");
    }
  });

  it("an unresolvable organization is review, never official and never discarded", () => {
    const v = classifyPublisher({ owner: "paul.platosh_CFO", orgName: "", stateName: "Oregon", stateAbbr: "OR" });
    expect(v.tier).toBe("review");
    expect(v.reason).toBe("org-unresolved");
  });

  it("excluded fires only on a POSITIVE marker — a named vendor or a named local/academic body", () => {
    for (const k of KNOWN_BAD) expect(classifyPublisher(k).tier).toBe("excluded");
    expect(classifyPublisher({ orgName: "County of Sonoma", stateName: "California", stateAbbr: "CA" }).reason).toMatch(/not-statewide/);
  });

  it("a commercial vendor is excluded even when its title reads like a government dataset, in every state", () => {
    // Regrid ranks first in nearly every state search; the owner has declined paid data, so this
    // is a publisher-level exclusion applied to all 51 rows, never a per-state special case.
    for (const st of [["California", "CA"], ["Texas", "TX"], ["Rhode Island", "RI"]]) {
      const v = classifyPublisher({ owner: "data_regrid", orgName: "Regrid", stateName: st[0], stateAbbr: st[1] });
      expect(v.tier).toBe("excluded");
      expect(v.reason).toBe("commercial-vendor");
    }
    expect(isCommercialPublisher({ owner: "landgrid_data" })).toBe(true);
    expect(COMMERCIAL_PUBLISHERS).toContain("regrid");
  });

  it("a state's own agency is not confused with a same-named university or county", () => {
    expect(classifyPublisher({ orgName: "California State University, Stanislaus", stateName: "California", stateAbbr: "CA" }).tier).toBe("excluded");
    expect(classifyPublisher({ orgName: "Wyoming Department of Revenue", stateName: "Wyoming", stateAbbr: "WY" }).tier).toBe("official");
  });
});

/* ⛔ THESE TWO CASES WERE FOUND BY THE PASS'S OWN FIRST FULL 51-STATE RUN, not by review — the
 * pass reported them about itself and both were fixed before it shipped. Kept as regressions. */
describe("cross-state contamination — ArcGIS Online ranks by relevance, not by geography", () => {
  const flOrg = { owner: "FloridaGIO", orgName: "State of Florida Geographic Information Office", orgId: "Gh9awoU677aKree0" };

  it("a verified organization promotes ONLY for its own state — Florida's layer must not read official under Washington", () => {
    // Measured on the first full run: a search for "Washington statewide parcels" returned
    // Florida's statewide cadastral layer, and a bare registry lookup stamped it `official` for WA.
    const wa = classifyPublisher({ ...flOrg, stateName: "Washington", stateAbbr: "WA" });
    expect(wa.tier).toBe("excluded");
    expect(wa.reason).toMatch(/another-state \(FL\)/);
    expect(classifyPublisher({ ...flOrg, stateName: "Florida", stateAbbr: "FL" }).tier).toBe("official");
  });

  it("every candidate records whether it is linked to the state at all, and an unlinked one is still not excluded on that alone", () => {
    // The link test is not sound in one direction, which is why it buckets rather than discards:
    // Rhode Island's real statewide layer is titled `Tax_Parcels`, published by "RIDEM - Map Room",
    // and names its state in neither.
    const noise = classifyPublisher({ owner: "admin_canadacadastral", orgName: "Community Property Map of Canada", title: "Canada Lands Parcel Mapping", stateName: "Maine", stateAbbr: "ME" });
    expect(noise.stateLink).toBe("none");
    expect(noise.tier).toBe("review"); // recorded for a human, not discarded
    const byTitle = classifyPublisher({ owner: "x", orgName: "Some Map Room", title: "Georgia Statewide Parcels", stateName: "Georgia", stateAbbr: "GA" });
    expect(byTitle.stateLink).toBe("title-names-state");
  });

  it("namesTheState matches a full name or a standalone postal abbreviation, never a substring of a word", () => {
    expect(namesTheState("WI Department of Administration", "Wisconsin", "WI")).toBe(true);
    expect(namesTheState("State of Florida Geographic Information Office", "Florida", "FL")).toBe(true);
    expect(namesTheState("CAL FIRE", "California", "CA")).toBe(false); // "cal" is not a CA token
    expect(namesTheState("MassGIS - Bureau of Geographic Information", "Massachusetts", "MA")).toBe(false);
  });
});

describe("looksParcelShaped — title triage, and the false leads already paid for", () => {
  it("keeps parcel-shaped titles", () => {
    for (const t of ["Tax_Parcels", "California Statewide Parcels Public View", "NYS Tax Parcels Public", "Statewide Cadastral", "Tax Lot Polygons"])
      expect(looksParcelShaped({ title: t })).toBe(true);
  });

  /* Each of these is a real false lead: Oregon's "State Parcels" resolves to a facilities-LEASES
   * layer (146 points of lease numbers and monthly rent), Arizona's only state "parcels" layer
   * covers state-TRUST land, and "SD_Parcels" turned out to mean Substantial Damage. */
  it("rejects the known false leads by name", () => {
    for (const t of ["DHS_Leases", "State Parcels Lease Register", "ASLD State_Trust_Parcels", "SD_Parcels Substantial Damage Assessment", "State Owned Land Parcels"])
      expect(looksParcelShaped({ title: t })).toBe(false);
  });

  it("rejects a title that names ONE local jurisdiction — a state org publishes per-county layers beside its statewide one", () => {
    // Utah AGRC publishes "Utah Salt Lake County Parcels LIR" from the very organization that
    // publishes the statewide layer, so the publisher check cannot separate them; the title is
    // the only signal, and this was real noise on the first full run.
    for (const t of ["Westchester County Parcels", "Utah Salt Lake County Parcels LIR", "Johnston County NC Parcels 2023", "2024 Parcel Map — City of Pacific Grove"])
      expect(looksParcelShaped({ title: t })).toBe(false);
  });

  it("...but a claim of statewide scope overrides that, so an honest 'Statewide County Parcels' is not thrown away on a word", () => {
    expect(looksParcelShaped({ title: "Statewide County Parcels" })).toBe(true);
    expect(looksParcelShaped({ title: "State of Ohio Parcels — all counties" })).toBe(true);
  });

  it("rejects unrelated layers outright", () => {
    for (const t of ["Sewered Areas", "2026 Zoning Polygons", "Septic Systems in Narragansett"])
      expect(looksParcelShaped({ title: t })).toBe(false);
  });
});

describe("serviceLayerUrl — a layer id is a GUESS and the caller must measure it", () => {
  it("appends the layer id to a service root", () => {
    expect(serviceLayerUrl({ url: "https://x.arcgis.com/a/arcgis/rest/services/P/FeatureServer" }))
      .toBe("https://x.arcgis.com/a/arcgis/rest/services/P/FeatureServer/0");
    expect(serviceLayerUrl({ url: "https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/" }, 0))
      .toBe("https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0");
  });

  it("honours a non-zero layer id — Hawaii is layer 25 and New Hampshire layer 1, both trap cases", () => {
    expect(serviceLayerUrl({ url: "https://h/arcgis/rest/services/ParcelsZoning/MapServer" }, 25)).toMatch(/MapServer\/25$/);
  });

  it("passes an already-specific layer URL through, and refuses anything else", () => {
    expect(serviceLayerUrl({ url: "https://x/rest/services/P/FeatureServer/7" })).toMatch(/FeatureServer\/7$/);
    expect(serviceLayerUrl({ url: "https://example.com/download.zip" })).toBeNull();
    expect(serviceLayerUrl({})).toBeNull();
  });
});

describe("the network wrappers are thin, and never fetch beyond what they are asked", () => {
  it("runs several differently-worded queries per state — the one that found California is not the one that finds a 'Tax Parcels'", () => {
    const qs = stateQueries("Rhode Island");
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.some((q) => /statewide parcels/i.test(q))).toBe(true);
    expect(qs.some((q) => /tax parcels/i.test(q))).toBe(true);
    expect(qs.every((q) => q.includes("Rhode Island"))).toBe(true);
  });

  it("searchState de-duplicates by item id across those queries and records which one found it", async () => {
    const calls = [];
    const fetchJson = async (url) => {
      calls.push(url);
      return { json: { results: [{ id: "same", title: "Tax_Parcels", owner: "RIGIS_ADMIN" }] } };
    };
    const out = await searchState("Rhode Island", { fetchJson });
    expect(calls).toHaveLength(stateQueries("Rhode Island").length);
    expect(out).toHaveLength(1);
    expect(out[0].foundBy).toBe(stateQueries("Rhode Island")[0]);
    // Every query is scoped to public Feature/Map Services — never a whole-portal sweep.
    for (const u of calls) expect(decodeURIComponent(u)).toMatch(/access:public/);
  });

  it("the org resolver memoises — many items share one organization, and one lookup answers for all of them", async () => {
    let hits = 0;
    const orgName = makeOrgResolver({ fetchJson: async () => { hits++; return { json: { name: "ShareGIS NY" } }; } });
    expect(await orgName("EbVsqZ18sv1kVJ3k")).toBe("ShareGIS NY");
    expect(await orgName("EbVsqZ18sv1kVJ3k")).toBe("ShareGIS NY");
    expect(hits).toBe(1);
    expect(await orgName("")).toBe(""); // no id, no request
    expect(hits).toBe(1);
  });
});
