/* compsCardModel — pure model behind the Dashboard's Comps card (NEW-COMPS-CARD). The card itself
 * (components/CompsCard.jsx) is a dumb renderer over what this module computes, same "pure model +
 * dumb renderer" split every other visualization in this repo follows (site-planner/lib/yieldBar.js
 * is the precedent cited when this was built) — so the peer-set rule, the scale geometry and the
 * comparison sentence are all unit-testable without a browser or a network call.
 *
 * WHY A CARD REPLACES A COUNT: a raw "N comps recorded" reads the same every morning and tells the
 * owner nothing actionable — the count only changes when HE adds one. Showing the most recently
 * added comp, placed against its real peers, is a fact that's actually new each time he looks.
 *
 * THE PEER-SET RULE, stated once here because every other function in this file exists to serve
 * it: peers are comps of the SAME comp type, in the SAME county, in a COMPARABLE SIZE BAND as the
 * featured comp — never a blend across counties, deal types, or wildly different building sizes,
 * and never an average of every comp the owner has ever entered. A comp missing a county or a
 * resolvable size can never join the peer set (there's nothing honest to compare it on) — it's
 * EXCLUDED and counted, never silently dropped or averaged in.
 */
import {
  landPricePerSf, buildingPricePerSf, annualLeaseRate, landPricePerAreaUnit, landSizeSf,
} from "../../../shared/comps/lib/comps.js";

export const TYPE_LABEL = { land: "Land", building_sale: "Building sale", lease: "Lease" };

// Typical industrial size tiers — a peer set is bucketed into one of these, never a continuous
// tolerance band, so "comparable" means something a reader can state in plain words (matching the
// worked example: "buildings over five hundred thousand square feet").
export const SIZE_BANDS = [
  { key: "under100k", max: 100000, rangeText: "under 100,000 SF" },
  { key: "100to250k", max: 250000, rangeText: "100,000–250,000 SF" },
  { key: "250to500k", max: 500000, rangeText: "250,000–500,000 SF" },
  { key: "over500k", max: Infinity, rangeText: "over 500,000 SF" },
];

/** Which band a size (SF) falls into, or null for a missing/non-positive size — null is the
 * signal that disqualifies a comp from the peer set, never a guessed band. */
export function sizeBandFor(sf) {
  if (sf == null || !Number.isFinite(sf) || sf <= 0) return null;
  return SIZE_BANDS.find((b) => sf < b.max) || SIZE_BANDS[SIZE_BANDS.length - 1];
}

/** The noun a size band reads naturally with, per comp type — "sites" for land (nothing is built
 * yet), "buildings" for a sale or a lease. */
function bandNoun(compType) {
  return compType === "land" ? "sites" : "buildings";
}

/** A size band's sentence-ready phrase for THIS comp type, e.g. "buildings over 500,000 SF" or
 * "sites under 100,000 SF". */
export function bandSentenceLabel(band, compType) {
  if (!band) return null;
  return `${bandNoun(compType)} ${band.rangeText}`;
}

/** The comp's own SIZE, in square feet, following its OWN type's size field — a land comp reads
 * its land size (converted from acres when quoted that way), a building sale its building SF, a
 * lease its leased SF. Null when the size isn't recorded. */
export function compSizeSf(comp) {
  if (!comp) return null;
  if (comp.compType === "land") return landSizeSf(comp.landSizeValue, comp.landSizeUnit);
  if (comp.compType === "building_sale") return comp.bldgSizeSf ?? null;
  if (comp.compType === "lease") return comp.leaseSizeSf ?? null;
  return null;
}

/** The comp's headline RATE — the single biggest number the card renders. Type-honest: a lease's
 * annualized $/SF/yr rate (carrying its NNN/gross basis for the chip), a building sale's $/SF
 * price, a land comp's price per its OWN recorded unit (AC or SF) — never a cross-type average and
 * never a borrowed unit. Null when the comp doesn't carry enough to compute one (never guessed). */
export function compHeadlineRate(comp) {
  if (!comp) return null;
  if (comp.compType === "lease") {
    const v = annualLeaseRate(comp);
    return v == null ? null : { value: v, unit: "$/SF/yr", basis: comp.leaseRateExpense || null };
  }
  if (comp.compType === "building_sale") {
    const v = buildingPricePerSf(comp);
    return v == null ? null : { value: v, unit: "$/SF", basis: null };
  }
  if (comp.compType === "land") {
    const r = landPricePerAreaUnit(comp);
    return r == null ? null : { value: r.value, unit: `$/${r.unit.toUpperCase()}`, basis: null };
  }
  return null;
}

/** Same-county, same-type, same-size-band peers for `featured` — the ONE place the peer-set rule
 * (this file's own header) is enforced. Returns `{ peers, excludedCount, band, county }`.
 * `peers` is `[{ comp, rate }]`, ready for the scale. `excludedCount` counts same-type comps that
 * are disqualified specifically because they're missing a county, a resolvable size, or a
 * computable rate — never comps that are simply a different type/county/band, which aren't
 * exclusions, just non-matches. Never mutates its input. */
export function buildPeerSet(allComps, featured) {
  const county = featured?.anchor?.county || null;
  const band = featured ? sizeBandFor(compSizeSf(featured)) : null;
  if (!featured || !county || !band) return { peers: [], excludedCount: 0, band, county };
  let excludedCount = 0;
  const peers = [];
  for (const c of allComps || []) {
    if (!c || c.id === featured.id) continue;
    if (c.compType !== featured.compType) continue;
    const cCounty = c.anchor?.county || null;
    const cBand = sizeBandFor(compSizeSf(c));
    const cRate = compHeadlineRate(c);
    if (!cCounty || !cBand || cRate == null) { excludedCount++; continue; }
    if (cCounty !== county || cBand.key !== band.key) continue;
    peers.push({ comp: c, rate: cRate.value });
  }
  return { peers, excludedCount, band, county };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

function ordinalWord(n) { return ORDINAL_WORDS[n] || `${n}th`; }
function countWord(n) { return COUNT_WORDS[n] || String(n); }

function rankPhrase(rank, total) {
  if (rank === 1) return `the highest of the ${countWord(total)}`;
  if (rank === total) return `the lowest of the ${countWord(total)}`;
  return `${ordinalWord(rank)} highest of the ${countWord(total)}`;
}

function deltaPhrase(delta) {
  const abs = Math.abs(delta);
  if (abs < 0.005) return "right at the median";
  const dir = delta > 0 ? "above" : "below";
  if (abs < 1) {
    const cents = Math.round(abs * 100);
    return `${cents} cent${cents === 1 ? "" : "s"} ${dir} the median`;
  }
  return `$${abs.toFixed(2)} ${dir} the median`;
}

/** The one plain-English sentence naming where the featured comp lands among its peers, e.g.
 * "second highest of the eight, and five cents above the median for buildings over 500,000 SF in
 * Harris County, TX." Null whenever there's nothing honest to say — fewer than three peers is the
 * caller's own "peer set is too small" case, not this function's to word. `peerSet` is a
 * `buildPeerSet` result; `featuredRate`/`compType`/`countyLabel` are read off the featured comp. */
export function peerComparisonSentence({ featuredRate, peerSet, compType, countyLabel }) {
  const peers = peerSet?.peers || [];
  if (featuredRate == null || peers.length < 3) return null;
  const peerRates = peers.map((p) => p.rate);
  const total = peerRates.length + 1;
  const sortedDesc = [...peerRates, featuredRate].sort((a, b) => b - a);
  const rank = sortedDesc.indexOf(featuredRate) + 1;
  const bandLabel = bandSentenceLabel(peerSet.band, compType);
  return `${rankPhrase(rank, total)}, and ${deltaPhrase(featuredRate - median(peerRates))} for ${bandLabel} in ${countyLabel}.`;
}

/** Pure geometry for the horizontal peer-comparison scale — every position a FRACTION (0..1) along
 * the low→high domain, never a pixel; the renderer scales fractions to whatever width it has. The
 * domain is the min/max of peers+featured TOGETHER, so the featured dot can never fall outside the
 * drawn rule even when it's the new high or low. A single-value domain (every rate identical)
 * centers everything rather than dividing by zero. */
export function compScaleLayout(featuredRate, peerRates) {
  const all = [...peerRates, featuredRate];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  const frac = (v) => (span > 0 ? (v - min) / span : 0.5);
  return { min, max, peerFracs: peerRates.map(frac), featuredFrac: frac(featuredRate) };
}

/** A county routing key ("harris", "co_denver" — see shared/CLAUDE.md's County ROUTING KEYS note:
 * a `co_` prefix means Colorado, no prefix means Texas) formatted as a short display name. This is
 * deliberately a light, dependency-free formatter rather than a lookup into the full `COUNTIES` GIS
 * registry (site-planner/lib/counties.js) — that module is sized for the map workspace, not a
 * Dashboard card that loads on every visit, and every routing key this app mints already reads as
 * a plain county name once split on its underscore/prefix. Null for no key. */
export function countyLabel(countyKey) {
  if (!countyKey) return null;
  const isColorado = countyKey.startsWith("co_");
  const raw = isColorado ? countyKey.slice(3) : countyKey;
  const words = raw.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (!words.length) return null;
  return `${words.join(" ")} County, ${isColorado ? "CO" : "TX"}`;
}

/** `countyLabel`'s pieces, shaped for `compLocationText.js`'s `pinFallbackText(anchor, countyEntry)`
 * — `{ name, state }`, matching its own `entry.name`/`entry.state` read exactly. */
export function countyEntry(countyKey) {
  const label = countyLabel(countyKey);
  if (!label) return null;
  const [name, state] = label.split(", ");
  return { name, state };
}

/** "today" / "1 day ago" / "N days ago" / "N months ago" — the same convention this Dashboard's
 * other cards already use (DashboardCards.jsx's own `relativeDays`), reproduced here so this pure
 * model has no dependency on a component file. */
export function relativeTimeLabel(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** The most recently ADDED comp — `createdAt` ("Date entered," immutable), never `compDate` (the
 * deal's own Executed date, which can be backdated or left blank) — this card is about what's NEW
 * on the account, not what the deal date says. Null for an empty list. */
export function mostRecentlyAddedComp(comps) {
  if (!comps || !comps.length) return null;
  return [...comps].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
}

/** The whole card's derived data in one call — what the fetch layer hands the component. */
export function buildCompsCardData(comps) {
  const featured = mostRecentlyAddedComp(comps);
  if (!featured) return { featured: null, total: 0 };
  const peerSet = buildPeerSet(comps, featured);
  const rate = compHeadlineRate(featured);
  const cLabel = countyLabel(featured.anchor?.county || null);
  const sentence = rate == null ? null : peerComparisonSentence({
    featuredRate: rate.value, peerSet, compType: featured.compType, countyLabel: cLabel,
  });
  return { featured, total: comps.length, peerSet, rate, countyLabel: cLabel, sentence };
}
