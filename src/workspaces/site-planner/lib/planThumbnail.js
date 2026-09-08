/* planThumbnail — a pure, DOM-free SVG-string render of a plan's drawn geometry, built for the
 * Dashboard's "Recent plans" thumbnail card (NEW-1, 2026-09-08). Given only a plan model (no live
 * app state — no React tree, no Leaflet map, no mounted canvas), so it can run right after a save
 * (site-planner/lib/siteThumbnail.js) or lazily from the Dashboard (which dynamic-imports this
 * module — see dashboard/lib/recentPlansThumbnails.js — so it never rides that workspace's own
 * bundle).
 *
 * Deliberately NOT the real export pipeline (exportSheet.js): that clones the LIVE mounted <svg>
 * and needs a rendered canvas + Leaflet instance. This instead reuses the same pure geometry
 * primitives the canvas and the export pipeline are both built on — elToRingFeet + the TYPE style
 * palette (planStyle.js) — so a thumbnail is a real render of the boundary plus every drawn
 * element (building, paving/truck-court, parking, trailer, pond, sidewalk, landscape, road),
 * painted in the same z-order the canvas uses and in the app's own TYPE colors — never an icon,
 * a placeholder, or a generic shape.
 *
 * Output is an SVG string on a fixed 4:3 viewBox, content CONTAIN-fit (padded, centered, aspect
 * preserved — never stretched) with a transparent background, so it drops straight into an
 * `<img src="data:image/svg+xml,...">` over whatever panel/theme surrounds it. Being vector text
 * (not a raster), it stays crisp at any thumbnail size the dashboard renders it at.
 */
import { parcelsOf, elementsOf } from "./siteModel.js";
import { elToRingFeet, TYPE, elStyle, byZ } from "./planStyle.js";

const VB_W = 400, VB_H = 300; // 4:3 — arbitrary viewBox units; vector output scales to any render size
const PAD_FRAC = 0.07;
const BOUNDARY_STROKE = "#6b6558";

const round2 = (n) => Math.round(n * 100) / 100;
const finitePt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

function extendBBox(bbox, ring) {
  for (const p of ring) {
    if (!finitePt(p)) continue;
    if (p.x < bbox.minX) bbox.minX = p.x;
    if (p.x > bbox.maxX) bbox.maxX = p.x;
    if (p.y < bbox.minY) bbox.minY = p.y;
    if (p.y > bbox.maxY) bbox.maxY = p.y;
  }
}

function ringPathD(ring) {
  let d = "";
  ring.forEach((p, i) => { d += `${i === 0 ? "M" : "L"}${round2(p.x)} ${round2(p.y)} `; });
  return d + "Z";
}

/**
 * Render a plan model to an SVG string, or null when there's nothing drawable (no active
 * boundary and no element with real geometry) — the caller's cue to show a plan-name-over-empty-
 * panel instead of a blank/broken image.
 */
export function planThumbnailSvg(model) {
  if (!model) return null;

  const boundaryRings = parcelsOf(model)
    .filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3)
    .map((p) => ({ p, ring: p.points.filter(finitePt) }))
    .filter((r) => r.ring.length >= 3);

  const elRings = elementsOf(model)
    .filter(Boolean)
    .sort(byZ)
    .map((el) => ({ el, ring: el && TYPE[el.type] ? elToRingFeet(el) : null }))
    .filter((r) => Array.isArray(r.ring) && r.ring.length >= 3 && r.ring.every(finitePt));

  if (!boundaryRings.length && !elRings.length) return null;

  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  boundaryRings.forEach(({ ring }) => extendBBox(bbox, ring));
  elRings.forEach(({ ring }) => extendBBox(bbox, ring));
  const spanX = bbox.maxX - bbox.minX, spanY = bbox.maxY - bbox.minY;
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) return null;

  const padX = spanX * PAD_FRAC, padY = spanY * PAD_FRAC;
  const vx0 = bbox.minX - padX, vy0 = bbox.minY - padY;
  const vw = spanX + 2 * padX, vh = spanY + 2 * padY;
  const scale = Math.min(VB_W / vw, VB_H / vh);
  const drawW = vw * scale, drawH = vh * scale;
  const offX = (VB_W - drawW) / 2 - vx0 * scale;
  const offY = (VB_H - drawH) / 2 - vy0 * scale;
  const toView = (ring) => ring.map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY }));

  const parts = [];
  // Boundary — outline only by default (matching the canvas's own "unfilled unless the user set
  // a fill" convention, planStyle.js's parcelDefaultStyle), a real fill if the parcel has one.
  boundaryRings.forEach(({ p, ring }) => {
    const hasFill = !!p.fill;
    const fillAttr = hasFill ? ` fill="${p.fill}" fill-opacity="${p.fillOpacity ?? 1}"` : ' fill="none"';
    parts.push(`<path d="${ringPathD(toView(ring))}"${fillAttr} stroke="${p.stroke || BOUNDARY_STROKE}" stroke-width="1.5" />`);
  });
  // Drawn elements, in the same paint order (type band, then z) the live canvas uses.
  elRings.forEach(({ el, ring }) => {
    const st = elStyle(el, model.settings);
    parts.push(`<path d="${ringPathD(toView(ring))}" fill="${st.fill}" fill-opacity="${st.fillOpacity}" stroke="${st.stroke}" stroke-width="0.75" />`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}">${parts.join("")}</svg>`;
}
