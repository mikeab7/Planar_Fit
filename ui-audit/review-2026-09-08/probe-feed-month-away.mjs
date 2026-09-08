import { buildSinceLastHereFeed } from "/home/user/planyr/src/workspaces/dashboard/lib/sinceLastHereFeed.js";
import { recentPlansLayoutMode, countForMode } from "/home/user/planyr/src/workspaces/dashboard/lib/recentPlansLayout.js";
const DAY=86400000, now=Date.parse("2026-09-08T20:00:00Z"), lastVisit=now-30*DAY;
const iso=(t)=>new Date(t).toISOString();
// 14 plan/comp events spread over the month + 3 schedule slips + a task-completion batch
const sites=[], comps=[], counts={}, sqft={};
for (let i=0;i<10;i++) sites.push({ id:"s"+i, group_id:"g"+i, site:"Plan "+i, county:"harris", status:"pursuit",
  created_at: iso(lastVisit + (i+1)*2*DAY), updated_at: iso(lastVisit+(i+1)*2*DAY) });
for (let i=0;i<4;i++) comps.push({ id:"c"+i, compType:"lease", createdAt: iso(lastVisit+(i+1)*5*DAY), title:"Comp "+i,
  leaseRate:0.65, leaseRatePeriod:"monthly", leaseRateExpense:"nnn", leaseSizeSf:600000 });
const scheduleProjects={ p1:{ id:"p1", name:"Bain Industrial", linkedSiteId:"s1", tasks:[
  {id:1,name:"Site civil permit",end:"2026-10-01",health:"amber"},
  {id:2,name:"Foundation start",end:"2026-11-15",health:"amber"},
  {id:3,name:"TCO",end:"2027-02-01",health:"green"},
]}};
const prevSnapshot={ plans:{}, tasks:{ p1:{ 1:{end:"2026-09-10",health:"amber",name:"Site civil permit"},
  2:{end:"2026-10-20",health:"amber",name:"Foundation start"}, 3:{end:"2027-02-01",health:"amber",name:"TCO"} } } };
const f = buildSinceLastHereFeed({ now, lastVisitAt:lastVisit, sites, buildingCountBySite:counts, sqftBySite:sqft,
  scheduleProjects, comps, notePages:[], prevSnapshot });
console.log("total events derived:", f.totalCount, "| shown:", f.rows.length, "| overflow (hidden):", f.overflowCount);
console.log("\nrows in the order the card renders them:");
f.rows.forEach((r,i)=>console.log(`  ${String(i+1).padStart(2)}. [${r.kind.padEnd(16)}] ${new Date(r.ts).toISOString().slice(0,10)}  ${r.parts.map(p=>p.text).join("")}`));
const kinds = f.rows.map(r=>r.kind);
console.log("\nschedule rows that survived the 12-row cap:", kinds.filter(k=>k.startsWith("schedule")||k.startsWith("tasks")).length);
console.log("schedule rows that EXISTED:", 2 /*slips*/ + 1 /*completion batch*/);
console.log("\nRecentPlans at its own minH: mode =", recentPlansLayoutMode({width:471,height:194}), "-> shows", countForMode(recentPlansLayoutMode({width:471,height:194})), "plans");
console.log("RecentPlans at default 6x8   : mode =", recentPlansLayoutMode({width:711,height:334}), "-> shows", countForMode(recentPlansLayoutMode({width:711,height:334})), "plans");
