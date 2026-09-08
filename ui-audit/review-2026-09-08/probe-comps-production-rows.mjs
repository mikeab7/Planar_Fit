import { buildCompsCardData } from "/home/user/planyr/src/workspaces/dashboard/lib/compsCardModel.js";
// verbatim from public.comps on planyr_production, 2026-09-08
const rows = [
 {id:"989b10b8", createdAt:"2026-09-08T20:22:47.225877Z", compType:"lease", anchor:{county:"harris",kind:"pin",lat:29.9,lon:-95.2}, title:"Generation Park - Exeter/Enchanted Rock", leaseRate:0.64,  leaseRatePeriod:"annual",  leaseRateExpense:"nnn", leaseSizeSf:648720},
 {id:"3c9e2473", createdAt:"2026-09-04T18:08:30.393593Z", compType:"lease", anchor:{county:"chambers",kind:"pin",lat:29.8,lon:-94.6}, title:"Tesla - TGS DC4",           leaseRate:0.645, leaseRatePeriod:"monthly", leaseRateExpense:"nnn", leaseSizeSf:1218956},
 {id:"45f9e6d0", createdAt:"2026-09-04T18:06:30.940209Z", compType:"lease", anchor:{county:"chambers",kind:"pin",lat:29.8,lon:-94.6}, title:"Tesla - TGS 800K SF",        leaseRate:0.58,  leaseRatePeriod:"monthly", leaseRateExpense:"nnn", leaseSizeSf:800405},
 {id:"ddb5a9e5", createdAt:"2026-09-03T21:55:51.424631Z", compType:"lease", anchor:{county:"harris",kind:"pin",lat:29.95,lon:-95.4}, title:"Core 5 - West Hardy",        leaseRate:0.65,  leaseRatePeriod:"monthly", leaseRateExpense:"nnn", leaseSizeSf:613208},
];
const d = buildCompsCardData(rows);
console.log("FEATURED (card headline):", d.featured.title);
console.log("HEADLINE RATE RENDERED  :", `$${d.rate.value.toLocaleString(undefined,{minimumFractionDigits:d.rate.value<10?2:0,maximumFractionDigits:d.rate.value<10?2:0})} ${d.rate.unit.replace(/^\$/,"")}`);
console.log("county label            :", d.countyLabel, " | total:", d.total);
console.log("PEERS FOUND             :", d.peerSet.peers.length, d.peerSet.peers.map(p=>`${p.comp.title}=$${p.rate.toFixed(2)}`));
console.log("excludedCount           :", d.peerSet.excludedCount);
console.log("scaleReady (needs >=3)  :", d.rate!=null && d.peerSet.peers.length>=3);
console.log("sentence                :", JSON.stringify(d.sentence));
console.log("");
console.log("=> FOOTER LINE 1 renders : \"Against your last "+d.peerSet.peers.length+" in "+d.countyLabel+"\"");
console.log("=> FOOTER LINE 2 renders : \"Not enough comps in "+d.countyLabel+" yet to compare — this one stands alone.\"");
console.log("");
console.log("annualized rates of all four (what a peer scale would plot):");
for (const r of rows) console.log(`   ${r.title.padEnd(38)} $${(r.leaseRatePeriod==="monthly"?r.leaseRate*12:r.leaseRate).toFixed(2)}/SF/yr  [${r.leaseRatePeriod}]`);
