import { buildCompsCardData, buildPeerSet, compScaleLayout, compHeadlineRate, compSizeSf, countyLabel, sizeBandFor } from "/home/user/planyr/src/workspaces/dashboard/lib/compsCardModel.js";
import { countyKeyForName } from "/home/user/planyr/src/workspaces/site-planner/lib/counties.js";

const L = (o) => ({ compType: "lease", anchor: { county: "harris", lat: 29, lon: -95 }, ...o });

console.log("========== A. LAND: unit mixing inside one peer set ==========");
const land = (id, price, val, unit, created) => ({ id, compType: "land", createdAt: created,
  landPrice: price, landSizeValue: val, landSizeUnit: unit, anchor: { county: "harris" } });
// all ~20-acre tracts in Harris County. Two entered in acres, two in SF. Same real value ~$3/SF.
const landSet = [
  land("new", 2600000, 20, "ac", "2026-09-08"),      // $130,000/AC
  land("p1", 2600000, 20, "ac", "2026-09-01"),       // $130,000/AC
  land("p2", 2600000, 871200, "sf", "2026-08-01"),   // $2.98/SF  <-- same deal, other unit
  land("p3", 2700000, 871200, "sf", "2026-07-01"),   // $3.10/SF
];
const a = buildCompsCardData(landSet);
console.log("featured:", a.featured.id, "rate:", a.rate);
console.log("peers:", a.peerSet.peers.map(p => `${p.comp.id}=${p.rate.toFixed(2)}`).join("  "));
console.log("scale:", JSON.stringify(compScaleLayout(a.rate.value, a.peerSet.peers.map(p=>p.rate))));
console.log("SENTENCE:", a.sentence);

console.log("\n========== B. LEASE: NNN vs GROSS mixed in one peer set ==========");
const leaseSet = [
  L({ id:"new", createdAt:"2026-09-08", leaseRate:5.00, leaseRatePeriod:"annual", leaseRateExpense:"nnn", leaseSizeSf:600000 }),
  L({ id:"g1", createdAt:"2026-09-01", leaseRate:11.00, leaseRatePeriod:"annual", leaseRateExpense:"gross", leaseSizeSf:600000 }),
  L({ id:"g2", createdAt:"2026-08-01", leaseRate:12.00, leaseRatePeriod:"annual", leaseRateExpense:"gross", leaseSizeSf:600000 }),
  L({ id:"n1", createdAt:"2026-07-01", leaseRate:5.20, leaseRatePeriod:"annual", leaseRateExpense:"nnn", leaseSizeSf:600000 }),
];
const b = buildCompsCardData(leaseSet);
console.log("peers:", b.peerSet.peers.map(p=>`${p.comp.id}=${p.rate}(${p.comp.leaseRateExpense})`).join("  "));
console.log("SENTENCE:", b.sentence);

console.log("\n========== C. SPARSE: exactly 2 peers (asked-for case) ==========");
const c = buildCompsCardData(leaseSet.slice(0,3));
console.log("peers:", c.peerSet.peers.length, "sentence:", JSON.stringify(c.sentence));
console.log("scale still computable?", JSON.stringify(compScaleLayout(c.rate.value, c.peerSet.peers.map(p=>p.rate))));

console.log("\n========== D. TIES: featured rate equals a peer ==========");
const ties = [
  L({ id:"new", createdAt:"2026-09-08", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"t1", createdAt:"2026-09-01", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"t2", createdAt:"2026-08-01", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"t3", createdAt:"2026-07-01", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
];
const d = buildCompsCardData(ties);
console.log("SENTENCE:", d.sentence);
console.log("scale:", JSON.stringify(compScaleLayout(d.rate.value, d.peerSet.peers.map(p=>p.rate))));

console.log("\n========== E. Featured is 2nd of 4 but sentence rank? (dots vs words) ==========");
const rank = [
  L({ id:"new", createdAt:"2026-09-08", leaseRate:7, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"r1", createdAt:"2026-09-01", leaseRate:9, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"r2", createdAt:"2026-08-01", leaseRate:7, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"r3", createdAt:"2026-07-01", leaseRate:5, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
];
const e = buildCompsCardData(rank);
const eScale = compScaleLayout(e.rate.value, e.peerSet.peers.map(p=>p.rate));
console.log("peer rates:", e.peerSet.peers.map(p=>p.rate), "featured:", e.rate.value);
console.log("SENTENCE:", e.sentence);
console.log("featuredFrac:", eScale.featuredFrac, "peerFracs:", eScale.peerFracs);

console.log("\n========== F. Cross-state county contamination ==========");
for (const [n,s] of [["Montgomery","PA"],["Montgomery","TX"],["Jefferson","AL"],["Liberty","GA"],["Chambers","AL"],["Adams","IL"],["Loudoun","VA"]]) {
  const key = countyKeyForName(n); // MapFinder's resolveCompCounty passes NO state
  console.log(`  point in ${n} County, ${s}  -> key=${JSON.stringify(key)} -> card prints ${JSON.stringify(countyLabel(key))}`);
}

console.log("\n========== G. LAND size bands ==========");
for (const ac of [5, 20, 50, 100]) console.log(`  ${ac} acres -> band ${sizeBandFor(ac*43560)?.key} ("sites ${sizeBandFor(ac*43560)?.rangeText}")`);

console.log("\n========== H. excludedCount counts non-peers too? ==========");
const ex = [
  L({ id:"new", createdAt:"2026-09-08", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:600000 }),
  L({ id:"faraway", createdAt:"2026-09-01", leaseRate:6, leaseRatePeriod:"annual", leaseSizeSf:null, anchor:{county:"co_denver"} }),
];
const h = buildPeerSet(ex, ex[0]);
console.log("  a Denver comp with no size -> excludedCount =", h.excludedCount, "(claimed to mean 'would-be peers'); peers =", h.peers.length);
