/* LocationsMapCard — the Dashboard's "Locations" card (NEW-1, owner chat block 2026-09-08):
 * "a new dashboard card that shows where everything is on a map... this card should say what
 * the product is the moment the page loads." Nothing else on the Dashboard is geographic, and
 * geography is the whole argument for Planyr over a spreadsheet — so this is a real interactive
 * map, not a picture.
 *
 * MAP LIBRARY: Leaflet — the same library every other map surface in this app already uses
 * (site-planner/MapFinder.jsx, the food workspace's FoodMap.jsx, SetLocationDialog.jsx). No
 * second mapping library was introduced. This file is its own lazy chunk (Dashboard.jsx
 * React.lazy()-imports it) so Leaflet's real weight never rides the Dashboard's own bundle —
 * the Dashboard is the app's landing page and loads on every session.
 *
 * BASEMAP: Esri's Light/Dark Gray Canvas (`Canvas/World_Light_Gray_Base` +
 * `Canvas/World_Dark_Gray_Base`, same free/keyless `server.arcgisonline.com` host this app
 * already uses everywhere else for imagery/topo/labels — see site-planner/lib/basemaps.js and
 * food/components/FoodMap.jsx). Deliberately NOT the aerial imagery those two use: this card's
 * brief asks for a quiet backdrop with no bright photography and no loud road colors, sitting
 * under the pins the way DashboardTopoBackground sits under the cards — Esri's Gray Canvas is
 * built for exactly that job (a reference basemap meant to recede behind data), and it ships in
 * a genuine light AND dark variant, so the card reads correctly in both themes without any
 * color-filter trick. The `_Reference` companion tile adds faint place/road labels on top.
 * (Not independently verified against the live tile host from this sandbox — the egress proxy
 * blocks every external tile host here, the same known gap FoodMap.jsx's own header already
 * flags for its Esri/CARTO sources — flagged honestly rather than claimed proven.)
 *
 * THREE MARKER WEIGHTS (dashboardMapMarkers.js is the pure derivation this file only renders):
 * Active projects are filled accent pins with a soft halo and their name beside them (loudest).
 * Pursuits are hollow accent rings with a lighter label. Comps are small quiet grey dots with no
 * label. Active/Pursuit markers are real DOM (Leaflet divIcons), so they read `var(--accent)`
 * etc. directly and re-theme for free; comps are SVG circleMarkers, whose fill is an Esri/SVG
 * presentation attribute — those don't reliably resolve var(), so they use the JS palette mirror
 * (shared/theme/palette.js) the same way every other Leaflet-painted layer in this app does
 * (see FoodMap.jsx's own header on exactly this point).
 *
 * FIT-ON-LOAD: the map fits itself to the extent of every plottable point ONCE, at mount, and
 * never re-fits itself afterward (a comps-toggle change never yanks the camera).
 *
 * MISSING LOCATIONS ARE NEVER SILENTLY DROPPED: anything without a usable lat/lon cannot be
 * drawn, so a quiet counted line under the map says how many projects/pursuits are missing one,
 * and clicking it opens the Site Planner's project list (module:"site-planner", no project id)
 * where every one of them is reachable to fix via "Set location…".
 *
 * EMPTY STATE: an account with nothing in its open pipeline and no comps recorded shows a short
 * line, never an empty grey map rectangle. A non-empty account where NOTHING has a location yet
 * also skips the (pointless) empty map and leads with the missing-location line instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme, usePalette } from "../../../shared/theme/ThemeProvider.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { ToggleChip } from "../../../shared/ui/controls.jsx";
import { openPipelineProjects, mapMarkers, missingLocationCount } from "../lib/dashboardMapMarkers.js";

const CANVAS_TILES = {
  light: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    refUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    attribution: "&copy; Esri",
  },
  dark: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    refUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    attribution: "&copy; Esri",
  },
};
const MAX_ZOOM = 19;
const SINGLE_POINT_ZOOM = 13;
const FIT_MAX_ZOOM = 15;
const FIT_PADDING = [26, 26];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Real DOM (Leaflet divIcons render literal innerHTML into the page), so var(--x) tokens resolve
// and re-theme for free — no palette/redraw dependency, unlike the comp circleMarkers below.
function activeIcon(name) {
  const label = escapeHtml(name || "");
  return L.divIcon({
    className: "dash-map-marker dash-map-marker--active",
    html: `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
      <span style="position:relative;width:20px;height:20px;flex:none;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:0;border-radius:999px;background:var(--accent);opacity:0.24;"></span>
        <span style="position:relative;width:12px;height:12px;border-radius:999px;background:var(--accent);border:2px solid var(--surface-raised);"></span>
      </span>
      <span style="font-size:12px;font-weight:700;color:var(--text-primary);text-shadow:0 0 3px var(--surface-raised),0 0 5px var(--surface-raised);">${label}</span>
    </span>`,
    iconSize: null, iconAnchor: [10, 10],
  });
}
function pursuitIcon(name) {
  const label = escapeHtml(name || "");
  return L.divIcon({
    className: "dash-map-marker dash-map-marker--pursuit",
    html: `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
      <span style="width:12px;height:12px;flex:none;border-radius:999px;background:transparent;border:2px solid var(--accent);box-sizing:border-box;"></span>
      <span style="font-size:10.5px;font-weight:500;color:var(--text-secondary);text-shadow:0 0 3px var(--surface-raised),0 0 5px var(--surface-raised);">${label}</span>
    </span>`,
    iconSize: null, iconAnchor: [7, 7],
  });
}

function LegendDot({ hollow }) {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: RADIUS.pill, flex: "none",
      background: hollow ? "transparent" : "var(--accent)",
      border: hollow ? "2px solid var(--accent)" : "none",
      boxSizing: "border-box",
    }} />
  );
}
function CompDot() {
  return <span style={{ width: 6, height: 6, borderRadius: RADIUS.pill, flex: "none", background: "var(--text-tertiary)" }} />;
}

const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };

export default function LocationsMapCard({ projects, comps, onOpenProject, onFixLocations }) {
  const { resolved } = useTheme();
  const palette = usePalette();
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [showComps, setShowComps] = useState(true);

  const openProjects = useMemo(() => openPipelineProjects(projects), [projects]);
  const allMarkers = useMemo(() => mapMarkers(projects, comps), [projects, comps]);
  const missingCount = useMemo(() => missingLocationCount(projects), [projects]);
  const compsTotal = comps ? comps.length : 0;
  const compsPlotted = useMemo(() => allMarkers.filter((m) => m.kind === "comp").length, [allMarkers]);
  const visibleMarkers = useMemo(
    () => (showComps ? allMarkers : allMarkers.filter((m) => m.kind !== "comp")),
    [allMarkers, showComps],
  );

  const nothingPlaced = openProjects.length === 0 && compsTotal === 0;
  const hasMap = allMarkers.length > 0;

  // Mount the Leaflet map once, only when there is at least one plottable point — never an
  // empty grey rectangle (the JSX below only renders the host div when hasMap is true, so this
  // effect's `allMarkers.length > 0` precondition always holds by the time it can run).
  useEffect(() => {
    if (!hasMap || !hostRef.current || mapRef.current) return undefined;
    const first = allMarkers[0];
    const map = L.map(hostRef.current, {
      center: [first.lat, first.lon], zoom: SINGLE_POINT_ZOOM,
      zoomControl: true, fadeAnimation: false, trackResize: false,
    });
    layerRef.current = L.layerGroup([]).addTo(map);
    mapRef.current = map;

    // Fit to the extent of every plottable point, once, on load — never re-fit later (a comps
    // toggle must not yank the camera).
    if (allMarkers.length > 1) {
      const bounds = L.latLngBounds(allMarkers.map((m) => [m.lat, m.lon]));
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
    } else {
      map.setView([first.lat, first.lon], SINGLE_POINT_ZOOM);
    }

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { try { map.invalidateSize({ animate: false }); } catch (_) { /* torn down mid-tick */ } });
      resizeObserver.observe(hostRef.current);
    }
    return () => { resizeObserver?.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMap]);

  // The quiet Esri Gray Canvas basemap — swapped whole between the light/dark variant so the
  // card reads correctly in both themes, same "recreate rather than setUrl" pattern FoodMap.jsx
  // uses for its own basemap toggle (setUrl alone doesn't carry a new maxNativeZoom).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const src = resolved === "dark" ? CANVAS_TILES.dark : CANVAS_TILES.light;
    const base = L.tileLayer(src.url, { maxZoom: MAX_ZOOM, maxNativeZoom: src.maxNativeZoom, attribution: src.attribution }).addTo(map);
    const ref = L.tileLayer(src.refUrl, { maxZoom: MAX_ZOOM, maxNativeZoom: src.maxNativeZoom }).addTo(map);
    return () => { try { map.removeLayer(base); map.removeLayer(ref); } catch (_) { /* map already torn down */ } };
  }, [resolved, hasMap]);

  // Paint the markers. Comps first (quietest, bottom), pursuits next, active last (loudest, on
  // top) — later-added Leaflet layers paint over earlier ones within a shared pane.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const m of visibleMarkers) {
      if (m.kind === "comp") {
        L.circleMarker([m.lat, m.lon], {
          radius: 3, weight: 0, fillColor: palette.textTertiary, fillOpacity: 0.55, interactive: false,
        }).addTo(layer);
      }
    }
    for (const m of visibleMarkers) {
      if (m.kind === "pursuit") {
        L.marker([m.lat, m.lon], { icon: pursuitIcon(m.name) })
          .on("click", () => onOpenProject?.(m.project))
          .addTo(layer);
      }
    }
    for (const m of visibleMarkers) {
      if (m.kind === "active") {
        L.marker([m.lat, m.lon], { icon: activeIcon(m.name), zIndexOffset: 1000 })
          .on("click", () => onOpenProject?.(m.project))
          .addTo(layer);
      }
    }
  }, [visibleMarkers, palette, onOpenProject]);

  if (nothingPlaced) {
    return <div style={EMPTY} data-testid="locations-map-empty">Nothing placed yet — add a project or a comp to see it on the map.</div>;
  }

  const missingLine = missingCount > 0 && (
    <div
      role="button" tabIndex={0} data-testid="locations-map-missing"
      onClick={() => onFixLocations?.()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFixLocations?.(); } }}
      style={{ fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", flex: "none" }}
    >
      {missingCount} {missingCount === 1 ? "project's" : "projects'"} location{missingCount === 1 ? " needs" : "s need"} fixing →
    </div>
  );

  if (!hasMap) {
    // Something is placed, but none of it has a location yet — skip the pointless empty map.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", justifyContent: "center" }}>
        <div style={EMPTY} data-testid="locations-map-unlocated">Nothing has a location on the map yet.</div>
        {missingLine}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }} data-testid="locations-map-card">
      <div
        ref={hostRef}
        data-testid="locations-map-host"
        style={{ flex: 1, minHeight: 120, borderRadius: RADIUS.md, overflow: "hidden", border: "1px solid var(--border-default)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flex: "none" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-secondary)" }}>
          <LegendDot /> Active
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-secondary)" }}>
          <LegendDot hollow /> Pursuit
        </span>
        <ToggleChip active={showComps} onClick={() => setShowComps((v) => !v)} style={{ marginLeft: "auto" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <CompDot /> Comps{compsPlotted ? ` · ${compsPlotted}` : ""}
          </span>
        </ToggleChip>
      </div>
      {missingLine}
    </div>
  );
}
