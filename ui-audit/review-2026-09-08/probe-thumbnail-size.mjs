import { planThumbnailSvg } from "/home/user/planyr/src/workspaces/site-planner/lib/planThumbnail.js";
import { TYPE } from "/home/user/planyr/src/workspaces/site-planner/lib/planStyle.js";
console.log("TYPE keys:", Object.keys(TYPE).join(", "));
// a boundary + N pond-ish polygons with many vertices (surveyed rings, per CLAUDE.md's own B233153 note)
const poly = (cx, cy, r, n) => Array.from({length:n}, (_,i)=>({x:cx+r*Math.cos(2*Math.PI*i/n), y:cy+r*Math.sin(2*Math.PI*i/n)}));
function model(nEls, verts) {
  return {
    id:"x", settings:{},
    parcels:[{active:true, points:[{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}]}],
    els: Array.from({length:nEls},(_,i)=>({ id:"e"+i, type:"pond", z:i, points: poly(200+(i%40)*120, 200+Math.floor(i/40)*180, 60, verts) })),
  };
}
for (const [n,v] of [[10,8],[100,8],[300,8],[300,40],[600,40]]) {
  const svg = planThumbnailSvg(model(n,v));
  const uri = svg ? encodeURIComponent(svg).length : 0;
  console.log(`  ${String(n).padStart(4)} elements x ${String(v).padStart(3)} vertices -> svg ${svg?(svg.length/1024).toFixed(1):0} KB, data-URI ${(uri/1024).toFixed(1)} KB`);
}
// escaping probe
const m = model(1,4); m.parcels[0].stroke = '"/><script>x</script><path d="';
const s = planThumbnailSvg(m);
console.log("\nunescaped attribute interpolation? boundary stroke injected ->", s.slice(0,240));
