/* agolParcelSearch.mjs — NEW-2 (2026-09-08): the SECOND resolution pass for
 * `probe-statewide-parcels.mjs`, searching official state-agency ArcGIS Online organizations
 * instead of state `.gov` GIS hosts.
 *
 * ⛔ THE BLIND SPOT THIS EXISTS TO CLOSE, stated plainly because it cost two real states.
 * Every earlier pass of that probe resolved a state's candidate from that STATE'S OWN `.gov` GIS
 * host, plus whatever a web-search research pass surfaced. This build environment reaches
 * `*.arcgis.com` and CANNOT reach most state `.gov` domains — so a state that publishes the SAME
 * dataset to its own ArcGIS Online ORGANIZATIONAL ACCOUNT was reachable the whole time and was
 * never systematically looked for. New York was already rescued by exactly that route
 * (`ny_statewide` in counties.js says so in its own comment) and it was treated as a one-off
 * workaround for one state rather than as the default second pass for all fifty. A hand-run of
 * this pass over 13 `no-free-source` states returned TWO real, live, official statewide layers —
 * California (13,138,000 parcels, published by the CA Dept. of Forestry & Fire Protection) and
 * Rhode Island (394,167 parcels, published by the RIGIS state clearinghouse itself) — both of
 * which this repo had on record as `no-free-source` with `Candidate: none found`. That hit rate
 * is the argument for doing it properly rather than by hand.
 *
 * ⛔ THE KNOWN-GOOD ARM IS PART OF THE PASS, NOT AN EXTRA (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 * A search-and-filter pipeline is exactly the shape that fails silently: tighten a filter one
 * notch too far and it returns a clean, plausible, confident ZERO for every state, and nothing
 * downstream can tell that apart from "there is genuinely nothing out there." That rule's
 * checkable form is that a harness asserting a property must carry at least one arm whose
 * expected value is known INDEPENDENTLY of the code under test, and must FAIL if that arm does
 * not report its known value — a run that exercises only the unknown arms is VACUOUS and must
 * say so rather than print a score. So this pass carries `KNOWN_GOOD` (below): two items that
 * MUST come back official — New York's `NYSGIS_GPO` and California's `ITS.CALFIRE` — and
 * `assessKnownGood` reports VACUOUS rather than a score when either goes missing.
 *
 * ⛔ COMMERCIAL CATALOGUE ITEMS ARE EXCLUDED IN EVERY STATE. Regrid's "USA Nationwide Parcel
 * Boundaries" ranks first in nearly every state search on ArcGIS Online and is a paid vendor's
 * catalogue item, not free data. The owner has declined paid data, so it is filtered by publisher
 * in all 51 rows — never state by state.
 *
 * Pure classification lives here (unit-tested in `test/agolParcelSearch.test.js`); the network
 * calls are the thin `searchState`/`orgName` wrappers at the bottom, injected with a fetcher so
 * the pure half is testable with no network at all.
 */

/* Publishers that are COMMERCIAL data vendors. Matched against both the AGOL owner account and
 * the resolved organization name, case-insensitively. This is a denylist on purpose: it must
 * catch the vendor even when its item's title reads like a government dataset. */
export const COMMERCIAL_PUBLISHERS = [
  "regrid", "landgrid", "loveland technologies",
  "corelogic", "attom", "lightbox", "digitalmap", "boundary solutions",
  "reonomy", "costar", "cotality", "first american", "parcelquest", "dmp data",
];

/* ⛔ THE REGISTRY OF ORGANIZATIONS ALREADY VERIFIED OFFICIAL, keyed by ArcGIS Online `orgId`
 * (stable; an org's display NAME is not — see below). Every entry's `orgName` is the value
 * RESOLVED LIVE from `sharing/rest/portals/<orgId>` on 2026-09-08, never one typed from memory.
 *
 * ⛔ WHY A REGISTRY EXISTS AT ALL, and this is the measured finding that shaped the whole file:
 * AN ORGANIZATION'S NAME IS NOT A RELIABLE SIGNAL OF WHETHER IT IS A STATE AGENCY. Of the fifteen
 * publishers behind this repo's own wired statewide sources, resolved live, roughly a third carry
 * a name no heuristic can read as governmental:
 *     Wyoming Department of Revenue · Montana Geographic Information · State of Connecticut   ← readable
 *     CAL FIRE  ·  ShareGIS NY  ·  RIDEM - Map Room  ·  MassGIS - Bureau of Geographic Information
 *     Utah Automated Geographic Reference Center (AGRC)                                       ← NOT
 * California's publisher is called "CAL FIRE" — not "California Department of Forestry and Fire
 * Protection", which is what an earlier draft of this file ASSUMED it was called. New York's is
 * "ShareGIS NY" and Rhode Island's "RIDEM - Map Room". So a name heuristic strong enough to be
 * useful still rejects the publishers of THREE states this repo has already wired, including the
 * one state it had ALREADY rescued by this exact route. That is the argument for the three-tier
 * verdict below: a filter forced to decide "official or not" from a name will silently discard
 * real official sources, and each discard reads downstream as an authoritative `no-free-source` —
 * precisely the failure this whole item exists to correct.
 *
 * The registry GROWS as states are verified; it is never the only admission route, and a miss
 * here costs a `review` row (a lead a human sees), never an exclusion. */
export const VERIFIED_STATE_ORGS = {
  // The three that motivated this pass.
  bz1uwWPKUInZBK94: { state: "CA", owner: "ITS.CALFIRE", orgName: "CAL FIRE", evidence: "CA Dept. of Forestry & Fire Protection, a state agency; 13,138,000 parcels measured 2026-09-08" },
  EbVsqZ18sv1kVJ3k: { state: "NY", owner: "NYSGIS_GPO", orgName: "ShareGIS NY", evidence: "NYS ITS Geospatial Services + Dept. of Taxation & Finance ORPTS; already wired as ny_statewide" },
  HAt3zp2GOzn12Lxk: { state: "RI", owner: "RIGIS_ADMIN", orgName: "RIDEM - Map Room", evidence: "RI Dept. of Environmental Management / RIGIS state clearinghouse; 394,167 parcels measured from the owner's own browser 2026-09-08" },
  // Publishers behind statewide sources this repo ALREADY wires — verified by the fact that their
  // service is in counties.js, so the registry starts useful rather than starting empty.
  "7HDiw78fcUiM2BWn": { state: "AK", owner: "SOA-DNR", orgName: "Alaska Department of Natural Resources ArcGIS Online", evidence: "publisher of the wired ak_statewide layer" },
  "3FL1kr7L4LvwA2Kb": { state: "CT", owner: "CT OPM", orgName: "State of Connecticut", evidence: "publisher of the wired ct_statewide layer" },
  Gh9awoU677aKree0: { state: "FL", owner: "FGIO", orgName: "State of Florida Geographic Information Office", evidence: "publisher of the wired fl_statewide layer" },
  hGdibHYSPO59RG1h: { state: "MA", owner: "MassGIS", orgName: "MassGIS - Bureau of Geographic Information", evidence: "publisher of the wired ma_statewide layer" },
  qnjIrwR8z5Izc0ij: { state: "MT", owner: "MSL", orgName: "Montana Geographic Information", evidence: "publisher of the wired mt_statewide layer" },
  GOcSXpzwBHyk2nog: { state: "ND", owner: "NDGISHUB", orgName: "State of North Dakota", evidence: "publisher of the wired nd_statewide layer" },
  MlJ0G8iWUyC7jAmu: { state: "OH", owner: "OGRIP", orgName: "Ohio Geographically Referenced Information Program", evidence: "publisher of the wired oh_statewide layer" },
  YuVBSS7Y1of2Qud1: { state: "TN", owner: "TN STS GIS", orgName: "State of Tennessee STS GIS", evidence: "publisher of the wired tn_statewide layer" },
  "99lidPhWCzftIe9K": { state: "UT", owner: "UGRC", orgName: "Utah Automated Geographic Reference Center (AGRC)", evidence: "publisher of the wired ut_statewide layer" },
  n6uYoouQZW75n5WI: { state: "WI", owner: "WI DOA", orgName: "WI Department of Administration", evidence: "publisher of the wired wi_statewide layer" },
  r0iJ85SKZ4zAzz3P: { state: "WY", owner: "wyo-prop-div", orgName: "Wyoming Department of Revenue", evidence: "publisher of the wired wy_statewide layer" },
};

/* Words that make an organization a GOVERNMENT of a whole state. An org must carry one of these
 * AND its own state's name (see `classifyPublisher`) — "Department" alone matches a county's
 * planning department just as well. */
const GOV_WORDS = [
  "department", "dept", "division", "office", "agency", "commission", "bureau",
  "authority", "board", "state of", "geological survey", "geographic information",
  "geospatial", "information technology", "natural resources", "revenue", "taxation",
  "administration", "conservation", "transportation", "emergency management",
];

/* Organizations that are NOT a state government even when they carry a state's name and a
 * government word: a county/city/town, a school district, a university, a consultancy, a
 * utility, a tribe's own government (real, sovereign — simply not the STATE aggregation this
 * probe is looking for), or an association of local governments. Checked BEFORE `GOV_WORDS`. */
const NOT_STATEWIDE = [
  "county", "counties", "parish", "borough of", "city of", "town of", "township", "village of",
  "municipal", "school", "university", "college", "institute of technology",
  "consult", "engineering", "surveying", "llc", ", inc", " inc.", "corporation", "company",
  "association of governments", "council of governments", "regional planning", "metropolitan",
  "water district", "utility", "electric", "tribe", "tribal", "nation of", "chamber of commerce",
];

/* A parcel-shaped TITLE. Deliberately loose — the real discriminator is the measured service
 * (polygon geometry, a parcel-ish field, a state-scale feature count), not the words in a title.
 * This only keeps the shortlist small enough to be worth probing. */
const PARCEL_TITLE = /parcel|cadastr|tax\s*lot|taxlot|property\s*bound|tax\s*map|land\s*record/i;

/* Titles that read parcel-shaped but name something else entirely. Each of these is a real false
 * lead this repo has already paid for or been warned about: state-OWNED land is not general
 * private parcels (Arizona's ASLD State_Trust_Parcels, Missouri's FMDCrealEstate), a leases layer
 * is a facilities register (Oregon's "State Parcels" by paul.platosh_CFO, which resolves to
 * DHS_Leases — 146 POINTS of lease numbers and monthly rent), and "SD_Parcels" turned out to mean
 * Substantial Damage, not South Dakota. */
const FALSE_LEAD_TITLE =
  /lease|state[\s_-]*trust|state[\s_-]*owned|state[\s_-]*land|conservation\s*easement|substantial\s*damage|wilderness|right[\s_-]*of[\s_-]*way|viewer\s*link|index\s*of/i;

/* A title that positively names ONE local jurisdiction — "Westchester County Parcels", "Madison
 * County Parcels", "City of Pacific Grove Parcel Map". These are real parcel layers and often
 * published by the state's own organization (Utah AGRC publishes per-county LIR layers alongside
 * its statewide one), so the publisher check cannot catch them; the title is the only signal.
 * Overridden whenever the title ALSO claims statewide scope, so a layer honestly called
 * "Statewide County Parcels" is not thrown away on a word. */
const LOCAL_SCOPE_TITLE = /\b(county|counties|parish|borough|township|city of|town of|village of)\b/i;
const STATEWIDE_TITLE = /statewide|state[\s_-]*wide|state of|all counties/i;

const lc = (v) => String(v == null ? "" : v).toLowerCase();

/* Is this publisher a commercial data vendor? Checked first and independently of everything
 * else, so a vendor can never be admitted by a strong org-name match. */
export function isCommercialPublisher({ owner = "", orgName = "" } = {}) {
  const hay = `${lc(owner)} ${lc(orgName)}`;
  return COMMERCIAL_PUBLISHERS.some((v) => hay.includes(v));
}

/* Classify an AGOL publisher for one state. Returns `{ tier, reason }` with THREE tiers, never
 * two — and the middle one is the whole point of this file:
 *
 *   "official"  — a verified state organization (registry hit), or an org whose resolved name
 *                 both names the state and names a government body. Wireable evidence.
 *   "review"    — parcel-shaped, published by somebody this pass CANNOT positively classify.
 *                 SURFACED for a human to adjudicate, never dropped.
 *   "excluded"  — a commercial data vendor, or a publisher that is positively NOT the state
 *                 (a county/city, a school or university, a consultancy, a utility).
 *
 * ⛔ THE MIDDLE TIER IS NOT A HEDGE, IT IS THE FIX. A two-way filter has to decide "official or
 * not" from metadata that does not reliably carry the answer (see VERIFIED_STATE_ORGS above:
 * "ShareGIS NY" and "RIDEM - Map Room" are both real state publishers whose names say so
 * nowhere), and every state it gets wrong reads downstream as `no-free-source` — a confident
 * "nothing exists here" produced by a filter, which is EXACTLY the failure that lost California
 * and Rhode Island in the first place. A null is a finding, never a disposition; `review` is how
 * that rule is honoured mechanically rather than remembered.
 *
 * `excluded` is deliberately the only tier that discards, and it only ever fires on a POSITIVE
 * marker — a named vendor, or a named local/academic body — never on an absence of one. */
export function classifyPublisher({ owner = "", orgName = "", orgId = "", title = "", stateName = "", stateAbbr = "", registry = VERIFIED_STATE_ORGS } = {}) {
  if (isCommercialPublisher({ owner, orgName }))
    return { tier: "excluded", reason: "commercial-vendor" };

  const known = orgId && registry && registry[orgId];
  /* ⛔ A REGISTRY HIT ONLY PROMOTES FOR ITS OWN STATE, and this clause is here because the first
   * full 51-state run got it wrong: ArcGIS Online ranks by relevance, not by geography, so a
   * search for "Washington statewide parcels" returned FLORIDA's statewide cadastral layer and
   * Utah's county parcels — and a bare registry lookup stamped both `official` under WA. An org
   * this file has POSITIVELY identified as another state's is the clearest `excluded` there is. */
  if (known && stateAbbr && known.state !== stateAbbr)
    return { tier: "excluded", reason: `verified-org-of-another-state (${known.state})`, stateLink: "none" };
  if (known) return { tier: "official", reason: `verified-state-org (${known.owner})`, stateLink: "verified-org" };

  const org = lc(orgName);
  const local = org && NOT_STATEWIDE.find((w) => org.includes(w));
  if (local) return { tier: "excluded", reason: `not-statewide (${local.trim()})`, stateLink: "none" };

  const namesState = namesTheState(org, stateName, stateAbbr);
  /* Whether this candidate is tied to the state being searched AT ALL. Recorded, never used to
   * discard: a search hit with no link is almost always cross-state relevance noise (Canada's
   * cadastre answered a search for Maine), but Rhode Island's own layer is titled `Tax_Parcels`
   * by an org called "RIDEM - Map Room" and links to its state through NEITHER — so an unlinked
   * row is reported in its own clearly-labelled bucket and left out of the headline count, rather
   * than dropped. Dropping it is how a state gets recorded as `Candidate: none found`. */
  const stateLink = namesState ? "org-names-state" : namesTheState(title, stateName, stateAbbr) ? "title-names-state" : "none";

  if (!org) return { tier: "review", reason: "org-unresolved", stateLink };

  const gov = GOV_WORDS.find((w) => org.includes(w));
  if (namesState && gov) return { tier: "official", reason: `state-agency (${gov})`, stateLink };

  /* Everything else is UNDECIDED, and says so with the specific thing that was missing — so a
   * reader of the doc can tell "this org is not a government body" from "this org's name simply
   * never mentions its own state", which are very different reasons to go and look. */
  return {
    tier: "review",
    stateLink,
    reason: !namesState && !gov ? "org-names-neither-the-state-nor-a-government-body"
      : !namesState ? "org-does-not-name-the-state"
      : "org-names-no-government-body",
  };
}

/* Does this text name the state — by full name, or by its postal abbreviation as a standalone
 * token? Shared by the publisher check and the item-title check so the two cannot drift. Pure. */
export function namesTheState(text, stateName = "", stateAbbr = "") {
  const t = lc(text);
  if (!t) return false;
  if (stateName && t.includes(lc(stateName))) return true;
  return !!(stateAbbr && new RegExp(`(^|[^a-z])${lc(stateAbbr)}([^a-z]|$)`, "i").test(t));
}

/* Is this item worth the two requests it costs to probe? Title-level triage only. */
export function looksParcelShaped({ title = "", name = "" } = {}) {
  const hay = `${title} ${name}`;
  if (FALSE_LEAD_TITLE.test(hay)) return false;
  if (LOCAL_SCOPE_TITLE.test(hay) && !STATEWIDE_TITLE.test(hay)) return false;
  return PARCEL_TITLE.test(hay);
}

/* The service-layer URL an AGOL item points at. An item's `url` is the SERVICE root
 * (…/FeatureServer, …/MapServer); this probe wants a LAYER. Returns the service root plus the
 * layer id appended, or null when the item carries no usable service URL.
 *
 * ⛔ LAYER 0 IS A GUESS AND IS LABELLED AS ONE by the caller. This repo has hit the trap twice
 * already — Hawaii's statewide mosaic is layer 25 (layer 0 is a GROUP layer with zero fields) and
 * New Hampshire's polygons are layer 1 (layer 0 is POINT geometry) — so a shortlisted candidate is
 * always MEASURED (geometry + fields + count) before it is believed, never wired off this guess. */
export function serviceLayerUrl(item, layerId = 0) {
  const url = String((item && item.url) || "").replace(/\/+$/, "");
  if (!/\/(Feature|Map)Server$/i.test(url)) {
    // Already a layer URL, or something else entirely.
    return /\/(Feature|Map)Server\/\d+$/i.test(url) ? url : null;
  }
  return `${url}/${layerId}`;
}

/* THE KNOWN-GOOD ARMS (see the header). Four publishers whose correct classification is known
 * INDEPENDENTLY of this file, every `orgName` RESOLVED LIVE 2026-09-08 rather than assumed. All
 * four must come back `official`, and each states what it must ALSO do with the registry emptied.
 *
 * ⛔ THIS ARM HAS ALREADY EARNED ITS PLACE TWICE, on its own first two runs, which is the whole
 * argument for the rule that requires one. The first draft classified purely on organization
 * NAME, and its New York arm was written from an ASSUMED name; resolved, New York's org is
 * "ShareGIS NY". Corrected, the CALIFORNIA arm was STILL assumed ("California Department of
 * Forestry and Fire Protection") and is really "CAL FIRE" — which fails the same heuristic. A
 * name-only filter would therefore have reported a confident clean zero for both states, one of
 * them the state this pass was written to find. `heuristicOnly` pins that down permanently. */
export const KNOWN_GOOD = [
  {
    state: "WY", stateName: "Wyoming", stateAbbr: "WY",
    owner: "wyo-prop-div", orgId: "r0iJ85SKZ4zAzz3P", orgName: "Wyoming Department of Revenue",
    title: "Wyoming Parcels for 2026",
    // The arm the NAME HEURISTIC alone must carry, so the heuristic path is proven live and not
    // quietly dead behind the registry. Its org names its state and names a government body.
    heuristicOnly: "official",
  },
  {
    state: "CA", stateName: "California", stateAbbr: "CA",
    owner: "ITS.CALFIRE", orgId: "bz1uwWPKUInZBK94", orgName: "CAL FIRE",
    title: "California Statewide Parcels Public View",
    // "CAL FIRE" names neither "California" nor a government body in any form a heuristic can
    // read. Registry-admitted; with the registry emptied it must fall to `review` — SURFACED to a
    // human — and NEVER to `excluded`. That is the property that actually protects a real source.
    heuristicOnly: "review",
  },
  {
    state: "NY", stateName: "New York", stateAbbr: "NY",
    owner: "NYSGIS_GPO", orgId: "EbVsqZ18sv1kVJ3k", orgName: "ShareGIS NY",
    title: "NYS Tax Parcels Public",
    heuristicOnly: "review",
  },
  {
    state: "RI", stateName: "Rhode Island", stateAbbr: "RI",
    owner: "RIGIS_ADMIN", orgId: "HAt3zp2GOzn12Lxk", orgName: "  RIDEM - Map Room",
    title: "Tax_Parcels",
    heuristicOnly: "review",
  },
];

/* Controls that must classify `excluded`, so a filter loosened into uselessness is caught from
 * the other side too — a pass that admits everything is as broken as one that admits nothing.
 * Every one is a real result this repo has actually seen in an AGOL parcel search. */
export const KNOWN_BAD = [
  { stateName: "California", stateAbbr: "CA", owner: "data_regrid", orgId: "KzeiCaQsMoeCfoCq", orgName: "Regrid", title: "Regrid USA Nationwide Parcel Boundaries", why: "commercial vendor — ranks first in nearly every state search; the owner has declined paid data" },
  { stateName: "California", stateAbbr: "CA", owner: "sc_prmdgis", orgName: "County of Sonoma", title: "Sonoma County", why: "a county, not the state" },
  { stateName: "California", stateAbbr: "CA", owner: "soshields_CSUStanislaus", orgName: "California State University, Stanislaus", title: "CA Statewide Parcels Public", why: "a university rehost of the state's own data, not the state" },
];

/* ⛔ THE VACUITY GUARD (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Returns `{ vacuous, failures }`. A
 * run whose known arms do not report their known answers has measured its own filter rather than
 * the world, and must NOT print a score. Checks three properties, not one:
 *   (a) every KNOWN_GOOD classifies `official` with the registry in place;
 *   (b) every KNOWN_GOOD still reaches at least `review` with the registry EMPTIED — i.e. the
 *       filter cannot DISCARD a real state source, only fail to auto-promote it;
 *   (c) every KNOWN_BAD classifies `excluded`. */
export function assessKnownGood(classify = classifyPublisher) {
  const failures = [];
  for (const k of KNOWN_GOOD) {
    const v = classify(k);
    if (v.tier !== "official") failures.push(`KNOWN-GOOD ${k.state} (${k.owner}) → ${v.tier}, expected official: ${v.reason}`);
    const bare = classify({ ...k, registry: {} });
    if (bare.tier !== k.heuristicOnly)
      failures.push(`KNOWN-GOOD ${k.state} (${k.owner}) with the registry emptied → ${bare.tier}, expected ${k.heuristicOnly}: ${bare.reason}`);
  }
  for (const k of KNOWN_BAD) {
    const v = classify(k);
    if (v.tier !== "excluded") failures.push(`KNOWN-BAD ${k.owner} (${k.why}) → ${v.tier}, expected excluded`);
  }
  return { vacuous: failures.length > 0, failures };
}

/* ---------------------------------------------------------------------------------------------
 * Network wrappers — thin on purpose; every decision above is pure and tested without them.
 * -------------------------------------------------------------------------------------------- */
const AGOL = "https://www.arcgis.com/sharing/rest";

/* The queries run per state. Several, because AGOL's relevance ranking is title-weighted and the
 * one that found California ("California statewide parcels") is not the one that would find a
 * state whose layer is called "Tax Parcels" or "Cadastral". */
export const stateQueries = (stateName) => [
  `${stateName} statewide parcels`,
  `${stateName} tax parcels`,
  `${stateName} parcels cadastral`,
  `${stateName} statewide cadastral parcels`,
];

export async function searchState(stateName, { fetchJson, num = 12 } = {}) {
  const seen = new Map();
  for (const q of stateQueries(stateName)) {
    const url =
      `${AGOL}/search?f=json&num=${num}&sortField=numviews&sortOrder=desc&q=` +
      encodeURIComponent(`${q} AND (type:"Feature Service" OR type:"Map Service") AND access:public`);
    const res = await fetchJson(url);
    const results = (res && res.json && res.json.results) || [];
    for (const r of results) if (!seen.has(r.id)) seen.set(r.id, { ...r, foundBy: q });
  }
  return [...seen.values()];
}

/* Resolve an organization id to its real NAME, memoised — many items share an org. */
export function makeOrgResolver({ fetchJson }) {
  const cache = new Map();
  return async function orgName(orgId) {
    if (!orgId) return "";
    if (cache.has(orgId)) return cache.get(orgId);
    const res = await fetchJson(`${AGOL}/portals/${encodeURIComponent(orgId)}?f=json`);
    const name = (res && res.json && res.json.name) || "";
    cache.set(orgId, name);
    return name;
  };
}
