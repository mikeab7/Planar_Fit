import { COUNTIES } from "/home/user/planyr/src/workspaces/site-planner/lib/counties.js";
import { countyLabel } from "/home/user/planyr/src/workspaces/dashboard/lib/compsCardModel.js";
const keys = Object.keys(COUNTIES);
console.log("total county keys:", keys.length);
const bad = [];
for (const k of keys) {
  const lbl = countyLabel(k);
  const entry = COUNTIES[k];
  const realState = entry?.state || entry?.st || "?";
  const claimed = lbl?.split(", ")[1];
  if (realState !== "?" && claimed && claimed !== realState) bad.push([k, lbl, realState]);
}
console.log("\nMISLABELLED (card says X, registry says Y):", bad.length);
for (const b of bad.slice(0,40)) console.log(`  ${b[0].padEnd(18)} card="${b[1]}"  actual state=${b[2]}`);
console.log("\nsample of all labels:");
for (const k of keys.slice(0,6)) console.log(`  ${k.padEnd(18)} -> ${countyLabel(k)}`);
for (const k of keys.filter(k=>!k.startsWith("co_")&&!["harris","fortbend","chambers","waller","montgomery","brazoria","galveston","liberty","austintx"].includes(k))) console.log(`  ${k.padEnd(18)} -> ${countyLabel(k)}   [registry state=${COUNTIES[k]?.state}]`);
