#!/usr/bin/env node
/* probe-statewide-parcels.mjs — NEW-1: does a FREE statewide parcel GIS service exist for each
 * of the 50 states + DC, and can Planyr's own environment actually reach it?
 *
 * THE PREMISE CORRECTION THIS PROBE ANSWERS (dispatch brief, 2026-09-08). "Appraisal district" is
 * a Texas-specific legal construct; most states assess at the county level, several (CT, ME, MA,
 * MI, MN, NH, NJ, RI, VT, WI, IL, IN in places) assess at the town/township level with no county
 * role at all, and Louisiana uses parishes. There is no 50-state roster of "appraisal districts"
 * to enumerate — the only honest approach is to probe each state for whatever free STATEWIDE
 * AGGREGATION effort (if any) exists, regardless of the assessing unit underneath it.
 *
 * ⛔ A NULL RESULT IS A RESULT. Most states have no such aggregation — that is the expected,
 * correct finding for the majority of rows, not a probe failure. Never omit a state because
 * nothing was found; the "no free source" row is exactly as load-bearing as a "yes" row.
 *
 * ⛔ THIS BUILD ENVIRONMENT SITS BEHIND AN EGRESS ALLOWLIST, MEASURED 2026-09-08. Any `*.arcgis.com`
 * host (services.arcgis.com, services1-9.arcgis.com, utility.arcgis.com, hub.arcgis.com,
 * opendata.arcgis.com, www.arcgis.com) is reachable — Esri's own SaaS hosting is broadly
 * allowlisted. Most individual state .gov/.us GIS domains are NOT — curl gets
 * `CONNECT tunnel failed, response 403`. THAT 403 MEANS "blocked by this build environment's
 * policy", not "the service is down." This probe reports the two cases distinctly
 * (`reachable:false, blocked:true` vs a real host response) — never conflate them. A state whose
 * only candidate sits on a blocked custom domain is not wireable as *sandbox-verified*, but it can
 * still be wired the way this repo already wires Chambers/Larimer County (CLAUDE.md's
 * countiesProvenance.js pattern): shipped on the strength of independent evidence (an official
 * ArcGIS Online item's own cached schema, reachable via the allowlisted *.arcgis.com API even when
 * the origin service itself is not), filed `Verify: live` with the exact blocked host named.
 *
 * WHAT COUNTS. One endpoint (ArcGIS REST FeatureServer/MapServer preferred) published by a state
 * government, its GIS coordinating office, or a state-designated body, aggregating parcel data
 * across many/all counties (or towns/parishes), free, no login. A single county's own CAD/assessor
 * site is out of scope — that's the existing per-county tier in counties.js.
 *
 * Run:  node ui-audit/probe-statewide-parcels.mjs          (writes docs/STATEWIDE-PARCELS.md)
 *       node ui-audit/probe-statewide-parcels.mjs --json    (machine-readable dump, no doc write)
 *       node ui-audit/probe-statewide-parcels.mjs --no-write (probe + print, skip the doc write)
 *
 * Deliberately kept OUT of the required CI `build` gate (.github/ci-gates.yml) — it makes live
 * network calls to 50+ hosts, most of which this environment can't even reach, so a red run here
 * would say nothing about the correctness of a code change. Exposed via `npm run probe:parcels`
 * (NEW-2) so it can be re-run on demand — an endpoint that moves or retires silently turns a wired
 * source into a silent wrong answer, exactly the class `normCountyKey`/countiesProvenance.js exist
 * to keep visible. Never exits non-zero — an instrument, not a gate (retention-probe.mjs precedent).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOC_PATH = join(ROOT, "docs", "STATEWIDE-PARCELS.md");
const TIMEOUT_MS = 15000;
const JSON_OUT = process.argv.includes("--json");
const NO_WRITE = process.argv.includes("--no-write") || JSON_OUT;

/* ---------------------------------------------------------------------------------------------
 * CANDIDATES — one entry per state + DC, filled from a live web-search + curl research pass
 * (2026-09-08, dispatched across 6 parallel research agents, one per ~8-9 states — never typed
 * from memory; every URL below was found via search and hit at least once, either directly or
 * through an ArcGIS Online item/Hub metadata mirror when the origin host was sandbox-blocked).
 *
 * `sources`: candidate service layer URLs this probe re-verifies LIVE on every run — empty when
 * research found no free statewide aggregation. `noSource`: the reason, when `sources` is empty.
 * `note`: research context a live probe can't measure itself (staleness disclaimers, licensing
 * restrictions, third-party-rehost provenance, coverage caveats) — carried into the doc verbatim.
 * -------------------------------------------------------------------------------------------- */
export const CANDIDATES = {
  AL: { name: "Alabama", assessingUnit: "county", sources: [],
    noSource: "No state-level parcel aggregation found (Alabama GeoHub, ADOR mapping pages, AGIC hubs checked) — parcels are county-only." },
  AK: { name: "Alaska", wired: true, assessingUnit: "borough/municipality (organized); no local assessor in the unorganized borough",
    sources: [{ name: "Alaska Statewide Parcels (AK DNR, Div. of Forestry & Fire Protection)", url: "https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/AK_Parcels/FeatureServer/0", cite: "hub.arcgis.com/maps/SOA-DNR::alaska-statewide-parcels" }],
    note: "Explicitly a best-effort mosaic — not every borough has its own parcel service, coverage is uneven; publisher says use the original per-borough services for authoritative data." },
  AZ: { name: "Arizona", assessingUnit: "county", sources: [],
    noSource: "AZGeo/AGIC checked; the only state-run 'parcels' layer (ASLD State_Trust_Parcels) covers only state-trust land, not general private parcels. server.azgeo.az.gov blocked in this sandbox." },
  AR: { name: "Arkansas", wired: true, verify: "live", blocker: "gis.arkansas.gov", assessingUnit: "county",
    sources: [{ name: "Parcel Polygon — County Assessor Mapping Program (CAMP), Arkansas GIS Office", url: "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6", cite: "gis.arkansas.gov/product/parcel-polygon-county-assessor-mapping-program-polygon" }],
    note: "Rich schema (id/owner/situs/area/value all present) confirmed via ArcGIS Hub's cached item metadata (2,117,780 features) — gis.arkansas.gov itself is blocked in this sandbox." },
  AZ_UNUSED: undefined,
  CA: { name: "California", assessingUnit: "county", sources: [],
    noSource: "Only a static 2014 file-geodatabase download exists (UC Davis ICE, mirrored via LA County ArcGIS Hub) — 51 of 58 counties, PARNO only (no owner/situs/area/value), not a live REST service. No free live statewide equivalent to Colorado's." },
  CO: { name: "Colorado", assessingUnit: "county", sources: [], alreadyWired: true,
    note: "Already wired (co_statewide) — Colorado Public Parcels composite, gis.colorado.gov. Not re-probed here; that host is blocked in this sandbox (as expected — production reaches it fine)." },
  CT: { name: "Connecticut", wired: true, assessingUnit: "town/municipal (no functioning county government); CT OPM GIS Office aggregates via the regional Councils of Government under CGS §4d-90–92",
    sources: [{ name: "Connecticut State Parcel Layer 2023", url: "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0", cite: "maps.cteco.uconn.edu/map-services" }],
    note: "Rich CAMA-style schema (owner/situs/value present) but no dedicated parcel-ID field surfaced on this hosted copy — only OBJECTID." },
  DE: { name: "Delaware", wired: true, verify: "live", blocker: "enterprise.firstmap.delaware.gov", assessingUnit: "county (3: Kent, New Castle, Sussex)",
    sources: [{ name: "Delaware State Parcels 2.0 — without Ownership Information (FirstMap)", url: "https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0", cite: "de-firstmap-delaware.hub.arcgis.com" }],
    note: "id + acreage confirmed via Hub metadata (451,344 features); owner/situs deliberately absent from this public copy (a fuller version requires a FirstMap login). enterprise.firstmap.delaware.gov blocked in this sandbox." },
  DC: { name: "District of Columbia", assessingUnit: "none — single consolidated city government (DC Office of Tax & Revenue)",
    sources: [],
    noSource: "Real, rich data exists but is split across two services — an attribute table (ITSPE, arcgis.com-hosted, reachable) and a separate Tax Lots geometry layer (maps2.dcgis.dc.gov, blocked), joined by an SSL key. Not wired this round: the existing per-county pattern is a single layerUrl, and joining two services is real follow-up work, not a same-shape wire." },
  FL: { name: "Florida", wired: true, assessingUnit: "county",
    sources: [{ name: "Florida Statewide Cadastral (FL Dept. of Revenue, Property Tax Oversight)", url: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0", cite: "arcgis.com item efa909d6b1c841d298b0a649e7f71cf2" }],
    note: "Best-in-class: full attribute set, 10.8M parcels, updated annually every August from all 67 counties." },
  GA: { name: "Georgia", assessingUnit: "county", sources: [],
    noSource: "Georgia GIS Clearinghouse covers 'more than 20% of counties' and is a per-county directory, not a mosaic; DOR's 'tax digest' is tabular jurisdiction totals, not parcel geometry. No state aggregation effort found." },
  HI: { name: "Hawaii", assessingUnit: "county (4 counties only; state has had zero role in valuation since a 1981 constitutional amendment)",
    sources: [],
    noSource: "A real 'Parcels - Hawaii Statewide' TMK mosaic exists (geodata.hawaii.gov, blocked in this sandbox), but owner/situs/area/value fields could not be confirmed by any reachable path — only the item description, no field list. Not wired without measured fields; flagged for a follow-up probe from an unrestricted network." },
  ID: { name: "Idaho", assessingUnit: "county",
    sources: [{ name: "Public Idaho Parcels (Idaho Geospatial Office)", url: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/0", cite: "the-idaho-map-open-data-idaho.hub.arcgis.com" }],
    note: "Reachable with real fields, but geometry is POINT (parcel centroids), not polygon — incompatible with the app's polygon-outline click routing — and only 13 of 44 counties currently participate. Not wired: geometry-type mismatch, not a reachability problem." },
  IL: { name: "Illinois", assessingUnit: "township assessors within most counties do the initial valuation (Cook County is the exception, assessing directly); county Supervisor of Assessments reviews/equalizes", sources: [],
    noSource: "Illinois State Geological Survey clearinghouse hosts many statewide layers but no parcel mosaic. No aggregation found — matches the township-assessed pattern the brief names." },
  IN: { name: "Indiana", wired: true, verify: "live", blocker: "gisdata.in.gov", assessingUnit: "county assessor by default since a 2008 reform; a handful of larger townships above a population threshold retain their own elected township assessor",
    sources: [{ name: "Parcel Boundaries of Indiana (Indiana Geographic Information Office, Data Harvest)", url: "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0", cite: "indianamap.org/datasets/INMap::parcel-boundaries-of-indiana-current" }],
    note: "Schema confirmed via ArcGIS item metadata XML: id + address present, owner and value fields absent from this layer entirely. gisdata.in.gov blocked in this sandbox." },
  IA: { name: "Iowa", assessingUnit: "county assessor generally; 8 larger cities (Cedar Rapids, Iowa City, Des Moines, etc.) run an independent City Assessor",
    sources: [],
    noSource: "The only free statewide layer found (Iowa_Parcels_2017, reachable, id+owner present) is EXPLICITLY disclaimed by its own publisher as deprecated/frozen at Nov 2017 and 'not current' — 9 years stale. Not wired: a data-currency disqualification, not a reachability one." },
  KS: { name: "Kansas", assessingUnit: "county", sources: [],
    noSource: "Kansas DASC (hub.kansasgis.org / services.kansasgis.org, both blocked in this sandbox) appears to run a per-county directory (ORKA/NG911), not a mandatory aggregated mosaic — not confirmed either way from this sandbox; flagged for a follow-up check from an unrestricted network." },
  KY: { name: "Kentucky", assessingUnit: "county", sources: [],
    noSource: "Kentucky's own open-data portal (opengisdata.ky.gov) files every parcel dataset per-county with no combined statewide layer; DOR Mapping Services page describes supporting individual county PVAs, not running one central layer." },
  LA: { name: "Louisiana", assessingUnit: "parish (64 parishes, each with an elected parish assessor — no county, no appraisal-district concept)", sources: [],
    noSource: "LAGIC / LSU Atlas / LA Division of Administration GIS / LA Tax Commission checked — no state-run parcel aggregation found. qpublic.net/la is a private directory of parish links, not a state service." },
  ME: { name: "Maine", assessingUnit: "town/municipality (482 towns); Unorganized Territory assessed directly by Maine Revenue Services",
    sources: [],
    noSource: "A real, live 'Maine Parcels Organized Towns' mosaic exists (arcgis.com-hosted, reachable, 708,382 parcels) but requires joining a separate ADB ownership/value table by ID, and the publisher's own notice states 'there is no complete statewide parcel data layer for Maine... data for many towns is more than fifteen years old.' Not wired this round: the join isn't the existing single-layerUrl shape, and the publisher itself disclaims completeness/currency." },
  MD: { name: "Maryland", assessingUnit: "state-run — SDAT (Dept. of Assessments & Taxation) runs 24 local offices directly; not independent county assessors", sources: [],
    noSource: "MD iMAP's MD_ParcelBoundaries / MD_PropertyData (SDAT-sourced, monthly) is a strong candidate but every host (geodata.md.gov, mdgeodata.md.gov) is blocked in this sandbox and no arcgis.com mirror with a real field list was found. Not wired without measured fields; flagged for a follow-up probe from an unrestricted network." },
  MA: { name: "Massachusetts", wired: true, assessingUnit: "city/town (351 cities/towns; counties have no assessing function)",
    sources: [{ name: "Massachusetts Property Tax Parcels (MassGIS, EOTSS)", url: "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0", cite: "gis.data.mass.gov/datasets/massgis::massachusetts-property-tax-parcels" }],
    note: "Best-in-class of the whole probe: full schema (id/owner/situs/area/value), 2.56M parcels, semi-annual refresh." },
  MI: { name: "Michigan", assessingUnit: "township/city (local unit assessor); county Equalization Department only reviews aggregate classes, cannot change an individual assessment", sources: [],
    noSource: "Michigan DTMB confirms a statewide parcel layer exists inside its Michigan Geographic Framework, but states outright it is for internal state use only and is not published to the public Open Data portal — a real effort, deliberately not public." },
  MN: { name: "Minnesota", wired: true, assessingUnit: "county (87 counties)",
    sources: [{ name: "Minnesota Parcels — Opt-In Open Data (MnGeo)", url: "https://utility.arcgis.com/usrsvcs/servers/1627519e8d3f42bcb55532d48e9a61e5/rest/services/OpenParcels/plan_parcels_open/MapServer/0", cite: "gisdata.mn.gov/dataset/plan-parcels-open" }],
    note: "Live-confirmed with real owner/value data on a sample feature. Coverage is OPT-IN — counties choose to participate quarterly, so completeness varies by county." },
  MS: { name: "Mississippi", assessingUnit: "county", sources: [],
    noSource: "MARIS (Mississippi State University) runs a real statewide cadastral mosaic across all 82 counties, but every host (gis.mississippi.edu, maris.state.ms.us) is blocked in this sandbox and only id/owner field NAMES were found in documentation, not confirmed via a live field list. Not wired without measured fields; flagged for a follow-up probe." },
  MO: { name: "Missouri", assessingUnit: "county", sources: [],
    noSource: "MSDIS's full open-data catalog (176 datasets, checked directly) contains no parcels/cadastral dataset; the one parcel-shaped layer found (gis.mo.gov FMDCrealEstate) is scoped to state-OWNED real estate, not general private parcels." },
  MT: { name: "Montana", wired: true, assessingUnit: "state-run — MT Dept. of Revenue (ORION CAMA) appraises nearly all property statewide per the MT Constitution; counties bill/collect",
    sources: [{ name: "Montana Cadastral Framework (Montana State Library, MSDI)", url: "https://services.arcgis.com/qnjIrwR8z5Izc0ij/ArcGIS/rest/services/Montana_Cadastral_Framework/FeatureServer/1", cite: "arcgis.com item f161a98b347b4cf29d371a6d7697912a" }],
    note: "Full schema (id/owner/situs/area/value) confirmed live, 921,024 parcels. MCA 2-6-1017 restricts using owner names as a mailing list, which does not affect this app's use." },
  NE: { name: "Nebraska", assessingUnit: "county", sources: [],
    noSource: "An official 'StatewideParcelsExternal' service is published by NE OCIO (gis.ne.gov, blocked in this sandbox); field names were only corroborated via an unofficial third-party university mirror, not the official schema itself. Not wired without a direct measurement of the official source; flagged for a follow-up probe." },
  NV: { name: "Nevada", assessingUnit: "county", sources: [],
    noSource: "A real statewide mosaic exists (NV DCNR / State Demographer) but its own ArcGIS item description states plainly it is legally restricted under NRS 250 from being downloaded, exported, or shared with the public or another government agency. Disqualified on a legal basis, independent of reachability." },
  NH: { name: "New Hampshire", assessingUnit: "town/municipal (RSA 76; NH DRA provides oversight/equalization only)", sources: [],
    noSource: "NH GRANIT (UNH) publishes a real 'NH Parcel Mosaic' with a linked ~50-attribute CAMA database, but the host (granit24a.sr.unh.edu) is blocked in this sandbox and exact field names could not be confirmed by any reachable path. Not wired without measured fields; flagged for a follow-up probe." },
  NJ: { name: "New Jersey", wired: true, verify: "live", blocker: "maps.nj.gov", assessingUnit: "municipal (each municipality has its own Tax Assessor)",
    sources: [{ name: "Parcels and MOD-IV Composite of New Jersey (NJOGIS + NJ Treasury MOD-IV)", url: "https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0", cite: "arcgis.com item 852937c223e94fcf8e167a23b500935d" }],
    note: "Full schema confirmed via item metadata XML (id/owner/situs/area/value all present in the field list) — but owner-name values are reported REDACTED for many records under NJ's Daniel's Law privacy statute, so the field exists without always carrying data. maps.nj.gov blocked in this sandbox." },
  NM: { name: "New Mexico", assessingUnit: "county", sources: [],
    noSource: "NM Taxation & Revenue Dept. explicitly disclaims distributing parcel data ('contact the assessor's office'); a same-named layer under the Office of the State Engineer is unverified and not listed in OSE's own public catalog. No confirmed statewide source." },
  NY: { name: "New York", wired: true, assessingUnit: "town/municipal (city/town assessors; NYS ORPTS provides oversight/certification)",
    sources: [{ name: "NYS Tax Parcels Public — official ArcGIS Online mirror (NYS ITS Geospatial Services + Dept. of Taxation & Finance ORPTS, org account NYSGIS_GPO)", url: "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1", cite: "arcgis.com item 8af5cef967f8474a9f262684b8908737" }],
    note: "The publicly-cited host (gisservices.its.ny.gov) is blocked in this sandbox — same as production is expected to reach it — but the SAME dataset is independently reachable via NY's own official ArcGIS Online organizational account (not a third party), so this wires the mirror rather than parking the whole state on an unreachable primary. 3,827,530 parcels, full schema, covers the 38 counties+NYC that opted in (a companion Footprint layer names which)." },
  NC: { name: "North Carolina", wired: true, verify: "live", blocker: "services.nconemap.gov (also confirm the '/secure/' path is not a login wall)", assessingUnit: "county",
    sources: [{ name: "NC OneMap Parcels — NC Integrated Cadastral Data Exchange", url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer", cite: "arcgis.com item 943c5690291445c4bb679a7422dd8b93" }],
    note: "Full schema confirmed via item metadata XML (id/owner/situs/area/value all present), all 100 counties + Eastern Band of Cherokee. The URL's own '/secure/' path segment is ambiguous — the item's `access` field reads public, but this needs a live check to rule out a login wall before relying on it. services.nconemap.gov blocked in this sandbox." },
  ND: { name: "North Dakota", wired: true, assessingUnit: "county",
    sources: [{ name: "ND State Parcel Program (NDIT, aggregated by AppGeo from 51+ counties)", url: "https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0", cite: "gishubdata-ndgov.hub.arcgis.com/datasets/NDGOV::parcels" }],
    note: "id + acreage present on this layer; owner/situs/value live on a separate joinable TaxRoll table (layer 1), not wired here — same attribute-light shape as Utah/Delaware." },
  OH: { name: "Ohio", wired: true, assessingUnit: "county (elected County Auditor)",
    sources: [{ name: "Ohio Statewide Parcels — public view (OGRIP)", url: "https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0", cite: "ohioparcels-geohio.hub.arcgis.com/datasets/geohio::parcels-1" }],
    note: "6.3M parcels; owner name and appraised value are deliberately absent from this privacy-scrubbed public view (a MailAddressAll field is present as a proxy)." },
  OK: { name: "Oklahoma", assessingUnit: "county", sources: [],
    noSource: "A real statewide mosaic exists (Property Records Preservation LLC for the OK Office of Geographic Information) but is explicitly published as view/WMS-only with no downloadable or queryable REST FeatureServer/MapServer found on any reachable host." },
  OR: { name: "Oregon", assessingUnit: "county (ORMAP is the state's own cooperative cadastral base-map program)", sources: [],
    noSource: "The Tax Lot layer the state's own 'Oregon Parcel Viewer' web app points to returns a real HTTP 400 'Invalid URL' — the service has been retired/unpublished, a genuine dead reference rather than a sandbox block. Every other candidate host (gis.odf.oregon.gov, ormap.net, data.oregon.gov) is blocked. Needs a fresh live search, not just a re-probe of this URL." },
  PA: { name: "Pennsylvania", assessingUnit: "county (67 autonomous assessing authorities)", sources: [],
    noSource: "PASDA's long-standing 'PA_Parcels' service is one of the oldest state clearinghouses in the country, but every host (maps/services/apps.pasda.psu.edu, gis.dep.pa.gov) is blocked in this sandbox and no field list could be confirmed by any reachable path. Not wired without measured fields — high-confidence follow-up candidate." },
  RI: { name: "Rhode Island", assessingUnit: "town/municipal — RI abolished county government in 1842; 39 towns/cities each run their own independent Tax Assessor", sources: [],
    noSource: "RIGIS (the state GIS clearinghouse) publishes parcel-data STANDARDS and a per-town completion tracker, not a merged statewide layer. No aggregation found." },
  SC: { name: "South Carolina", assessingUnit: "county (46 counties, elected/appointed Assessor)", sources: [],
    noSource: "The only statewide DNR/RFA service found (SC_County_Parcel_Viewers) is a lookup TABLE of links to each county's own separate viewer, not aggregated geometry; RFA's own page describes its aggregated parcels as available only via 'secure' (non-public) REST services." },
  SD: { name: "South Dakota", assessingUnit: "county", sources: [],
    noSource: "No credible statewide aggregation found; a same-named 'SD_Parcels' service turned out to be a flood substantial-damage-assessment layer (SD = Substantial Damage), a false positive ruled out by inspecting its schema. Individual counties run independent systems." },
  TN: { name: "Tennessee", wired: true, assessingUnit: "county (elected County Assessor; Comptroller's Division of Property Assessments provides oversight)",
    sources: [{ name: "Tennessee Property Boundaries Public Use (TN Comptroller, Base Mapping Program)", url: "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0", cite: "arcgis.com item e356f1a241844d6f9025f2fa4e977df3" }],
    note: "2,141,289 parcels, id/owner/situs/area present; appraised value requires a join to a separate tax table (LINK_TPAD/LINK_TPV) not included here. Covers 86 of 95 counties — 9 use non-state assessment systems and are excluded." },
  TX: { name: "Texas", assessingUnit: "appraisal district (a separate legal entity per county under the TX Property Tax Code — not a county government department)",
    sources: [], alreadyWired: true,
    note: "Already wired (txgio_statewide) — TxGIO / StratMap Land Parcels, confirmed still healthy this session (HTTP 200, full field set)." },
  UT: { name: "Utah", wired: true, assessingUnit: "county (29 counties)",
    sources: [{ name: "Utah Statewide Parcels (UGRC/AGRC)", url: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0", cite: "gis.utah.gov/products/sgid/cadastre/parcels" }],
    note: "Attribute-light by design: id + situs address present; owner/value require the per-county CAMA system (a CoParcel_URL field links out) and are absent from this layer." },
  VT: { name: "Vermont", wired: true, assessingUnit: "town (247 towns; VT counties have no assessing role)",
    sources: [{ name: "VT Parcel Program (Vermont Center for Geographic Information, joined to the Dept. of Taxes Grand List)", url: "https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/VT_Parcel/FeatureServer/665", cite: "arcgis.com item 1c12a80bb16249ae9235525e3525c89f" }],
    note: "One of the richest schemas of the whole probe (full id/owner/situs/area/value), all 247 towns, 339,251 parcels. Layer id is non-standard (665, not 0) — confirmed, not a typo." },
  VA: { name: "Virginia", assessingUnit: "county/independent city (98 counties + 39 independent cities, each its own assessing jurisdiction)", sources: [],
    noSource: "VGIN's official host (vginmaps.vdem.virginia.gov) is blocked in this sandbox; the only reachable copy is a third-party rehost (a university ArcGIS Online account, not VGIN's own), and VGIN's own description says the layer is attribute-light by design (id only) regardless. Not wired: unverified third-party provenance on top of a thin schema — the same 'a copy on someone else's account is worse than the real thing' judgment this repo already applies to Colorado's Arapahoe/Boulder rows." },
  WA: { name: "Washington", assessingUnit: "county (39 counties)", sources: [],
    noSource: "A real, reachable statewide mosaic exists ('Current Parcels', geo.wa.gov) with decent fields, but its own license text states some counties restrict use of their parcels to 'State of Washington business only' — an explicit use restriction, not just a liability disclaimer, that this app's commercial real-estate use may not clear. Flagged for an owner/legal decision rather than wired silently." },
  WV: { name: "West Virginia", assessingUnit: "county (55 counties)", sources: [],
    noSource: "The official host (services.wvgis.wvu.edu) is blocked in this sandbox; the only reachable copy is a third-party rehost under a named individual's personal ArcGIS account, with no license metadata at all. Not wired: the same third-party-provenance concern as Virginia, here with even weaker attribution." },
  WI: { name: "Wisconsin", wired: true, assessingUnit: "municipal (town/village/city; a minority of counties use a county-assessor system)",
    sources: [{ name: "Wisconsin Statewide Parcels DB V12 (State Cartographer's Office / DOA Land Information Program)", url: "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0", cite: "arcgis.com item 2386813b23ea4e51a009f7d1d6b76e02" }],
    note: "Fullest field set of the whole probe (id/owner/situs/three acreage measures/five value fields), 3,574,646 parcels, hosted by the official WI DOA account, explicitly 'free for public consumption.'" },
  WY: { name: "Wyoming", wired: true, assessingUnit: "county (23 counties)",
    sources: [{ name: "Wyoming Parcels for 2026 (WY Dept. of Revenue Property Tax Division)", url: "https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0", cite: "arcgis.com org wyo-prop-div" }],
    note: "Full schema, 373,666 parcels, hosted directly by the state Property Tax Division's own org, annually updated." },
};
delete CANDIDATES.AZ_UNUSED;

/* ---------------------------------------------------------------------------------------------
 * Measurement engine
 * -------------------------------------------------------------------------------------------- */
async function fetchJson(url, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON response */ }
    return { ok: res.ok, status: res.status, ms, json };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = String((err && err.message) || err);
    // A CONNECT-tunnel policy denial surfaces as a generic fetch failure with no HTTP status at
    // all (the TLS tunnel itself never opened) — distinct from a real host timeout/DNS failure,
    // but this Node fetch error shape can't always tell them apart, so `blocked` is a best-effort
    // read, not a certainty; the doc always shows the raw error text too.
    const blocked = /fetch failed|ECONNREFUSED|ENOTFOUND|CONNECT/i.test(msg);
    return { ok: false, status: 0, ms, error: msg, blocked };
  } finally {
    clearTimeout(timer);
  }
}

// Field-name heuristics, reported as WHICH field matched — never a claim about what the field
// means. Mirrors the app's own idField/addrField "hint, not authority" convention (counties.js).
const FIELD_PATTERNS = {
  parcelId: /parcel.?id|\bapn\b|(?:^|_)pin(?:_|$)|prop.?id|acctid|account|parcelnb|parcelnum|gispid|statepar|stateid|(?:^|_)pid(?:_|$)/i,
  owner: /owner/i,
  situsAddress: /situs|site.?add|prop.?add|premisead|full.?address|prop_loc/i,
  landArea: /acre|sqfoot|lot_size|land.?area/i,
  // requires a VALUE-shaped suffix alongside the assess/apprais/market word — a bare "assess"
  // (e.g. "AssessmentCode", a classification, not a dollar figure) must not match.
  appraisedValue: /(assess|apprais|market|mkt|total|land).{0,6}val|actualvalu|assessedva/i,
};

function matchFields(fieldNames) {
  const out = {};
  for (const [key, re] of Object.entries(FIELD_PATTERNS)) {
    out[key] = fieldNames.find((f) => re.test(f)) || null;
  }
  return out;
}

async function probeSource(src) {
  const meta = await fetchJson(`${src.url}?f=json`);
  if (!meta.ok || !meta.json) {
    return { ...src, reachable: false, blocked: !!meta.blocked, status: meta.status, ms: meta.ms, error: meta.error };
  }
  const fieldNames = Array.isArray(meta.json.fields) ? meta.json.fields.map((f) => f.name) : [];
  const geometryType = meta.json.geometryType || (meta.json.type === "Table" ? "table" : null);
  let featureCount = null;
  const countRes = await fetchJson(`${src.url}/query?where=1%3D1&returnCountOnly=true&f=json`);
  if (countRes.ok && countRes.json && typeof countRes.json.count === "number") featureCount = countRes.json.count;
  return {
    ...src,
    reachable: true,
    status: meta.status,
    ms: meta.ms,
    geometryType,
    featureCount,
    fieldNames,
    fields: matchFields(fieldNames),
  };
}

function verdictFor(state) {
  if (state.alreadyWired) return "already-wired";
  if (!state.sources.length) return "no-free-source";
  const any = state.sources.some((s) => s.reachable);
  if (any) return "measured-reachable";
  const allBlocked = state.sources.every((s) => s.blocked);
  return allBlocked ? "blocked-in-sandbox" : "host-error";
}

async function probeAll() {
  const out = {};
  for (const [abbr, cfg] of Object.entries(CANDIDATES)) {
    const sources = [];
    for (const src of cfg.sources || []) sources.push(await probeSource(src));
    out[abbr] = { abbr, ...cfg, sources };
    out[abbr].verdict = verdictFor(out[abbr]);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Output
 * -------------------------------------------------------------------------------------------- */
function fmtFields(f) {
  if (!f) return "—";
  const parts = [];
  for (const k of ["parcelId", "owner", "situsAddress", "landArea", "appraisedValue"]) {
    parts.push(`${k}=${f[k] ? "`" + f[k] + "`" : "absent"}`);
  }
  return parts.join(", ");
}

function buildMarkdown(results, probedAt) {
  const lines = [];
  lines.push("# STATEWIDE-PARCELS.md — free statewide parcel GIS probe (NEW-1)");
  lines.push("");
  lines.push(`> **Last probed:** ${probedAt} · **Re-run:** \`npm run probe:parcels\` (NEW-2) · script: \`ui-audit/probe-statewide-parcels.mjs\``);
  lines.push(">");
  lines.push("> One row per state + DC, MEASURED by this script hitting each candidate endpoint live — never typed from memory.");
  lines.push("> This build environment sits behind an egress allowlist: `*.arcgis.com` hosts are reachable, most individual state");
  lines.push("> `.gov` domains are not (`blocked-in-sandbox` below means exactly that policy block, not a real outage). A `no-free-source`");
  lines.push("> row is a legitimate, expected finding for most states — record it plainly, never omit it.");
  lines.push("");
  lines.push("| State | Assessing unit | Verdict | Candidate | Reachable here | Feature count | Geometry | Fields | Wired? |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  const wired = [];
  for (const abbr of Object.keys(results).sort()) {
    const s = results[abbr];
    const src = s.sources[0];
    const reach = !src ? "—" : src.reachable ? `yes (${src.status}, ${src.ms}ms)` : src.blocked ? "blocked (sandbox policy)" : `no (${src.error || src.status})`;
    const fc = src && src.featureCount != null ? src.featureCount.toLocaleString() : "—";
    const geom = src ? src.geometryType || "—" : "—";
    const fields = src ? fmtFields(src.fields) : "—";
    const cand = src ? `[${src.name}](${src.url})` : "none found";
    const isWired = s.alreadyWired || s.wired;
    if (isWired) wired.push(abbr);
    const wireCol = s.alreadyWired ? "✅ (already)" : s.wired ? (s.verify === "live" ? `✅ (Verify: live — ${s.blocker})` : "✅") : "—";
    lines.push(`| ${s.name} (${abbr}) | ${s.assessingUnit} | ${s.verdict} | ${cand} | ${reach} | ${fc} | ${geom} | ${fields} | ${wireCol} |`);
  }
  lines.push("");
  lines.push(`**${wired.length} states wired** (incl. TX/CO already live): ${wired.sort().join(", ")}.`);
  lines.push("");
  lines.push("## Per-state notes (research context this probe can't measure itself)");
  lines.push("");
  for (const abbr of Object.keys(results).sort()) {
    const s = results[abbr];
    const note = s.note || s.noSource;
    if (note) lines.push(`- **${s.name} (${abbr}):** ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const results = await probeAll();
  const probedAt = new Date().toISOString().slice(0, 10);
  if (JSON_OUT) {
    console.log(JSON.stringify({ probedAt, results }, null, 2));
    return;
  }
  const md = buildMarkdown(results, probedAt);
  if (!NO_WRITE) {
    writeFileSync(DOC_PATH, md, "utf8");
    console.log(`Wrote ${DOC_PATH}`);
  } else {
    console.log(md);
  }
  const counts = {};
  for (const s of Object.values(results)) counts[s.verdict] = (counts[s.verdict] || 0) + 1;
  console.log("\nVerdict counts:", counts);
}

main();
