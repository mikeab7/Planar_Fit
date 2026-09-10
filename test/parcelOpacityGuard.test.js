import { describe, it, expect } from "vitest";
import { guardRasterOpacity } from "../src/workspaces/site-planner/lib/parcelOpacityGuard.js";

/* Fakes stand in for esri-leaflet's RasterLayer + Leaflet's Map/pane — just enough shape for
 * guardRasterOpacity to operate on (it never touches window/document itself, only what it's
 * handed), matching esri-leaflet 3.0.19's real RasterLayer.js/DynamicMapLayer.js contract this
 * module was written against (see that file's own header). */
function makePane() {
  const children = [];
  return {
    children,
    querySelectorAll(sel) {
      if (sel !== "img.leaflet-image-layer") return [];
      return children.filter((c) => c.className === "leaflet-image-layer");
    },
  };
}

function makeMap() {
  const layers = new Set();
  return {
    hasLayer(l) { return layers.has(l); },
    addLayer(l) { layers.add(l); },
    removeLayer(l) { layers.delete(l); },
    eachLayer(fn) { Array.from(layers).forEach(fn); },
    getBounds() { return this._bounds; },
    _bounds: null,
  };
}

function makeLayer({ opacity = 1 } = {}) {
  const pane = makePane();
  const map = makeMap();
  const handlers = {};
  // Simulates esri-leaflet's own `_renderImage`: synchronously creates the Overlay (an
  // <img>-backed mini-layer) and `.addTo(map)`s it — exactly the ordering guardRasterOpacity's
  // own header documents ("created and .addTo()'d SYNCHRONOUSLY inside _renderImage"). Neither
  // it nor the wrapped version returns the Overlay (both are void functions in production), so
  // a caller finds it the same way the guard itself does — via the pane's newest <img>.
  const origRenderImage = function () {
    const img = { className: "leaflet-image-layer", isConnected: true, style: { opacity: "0" } };
    pane.children.push(img);
    const overlay = { _image: img, _bounds: null, _map: map, setOpacity(v) { img.style.opacity = String(v); } };
    map.addLayer(overlay);
  };
  const layer = {
    options: { opacity },
    _currentImage: null,
    _map: map,
    _renderImage: origRenderImage,
    onRemove() {},
    getPane: () => pane,
    on(ev, cb) { handlers[ev] = cb; },
  };
  return { layer, pane, map, handlers };
}

// Render one image and return the Overlay object the map registered for it.
function renderOne(layer, map, pane) {
  layer._renderImage();
  const img = pane.children[pane.children.length - 1];
  let overlay = null;
  map.eachLayer((l) => { if (l._image === img) overlay = l; });
  return overlay;
}

describe("guardRasterOpacity — orphan cleanup on teardown", () => {
  it("removes a still-loading (never promoted to _currentImage) image when the layer is torn down", () => {
    const { layer, map, pane } = makeLayer();
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane); // simulates onAdd's first request — still "loading"
    expect(map.hasLayer(overlay)).toBe(true);
    layer.onRemove(map); // e.g. leaving select mode, closing the identify tool, an alias's last ref going
    expect(map.hasLayer(overlay)).toBe(false); // the orphan is gone, not left sitting at opacity 0 forever
  });

  it("leaves the layer's OWN current (already-shown) image for esri-leaflet's own cleanup", () => {
    const { layer, map, pane } = makeLayer();
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane);
    layer._currentImage = overlay; // esri-leaflet's onOverlayLoad already promoted it
    layer.onRemove(map);
    // Not swept by the orphan guard — still present after OUR onRemove (the wrapped original,
    // which is esri-leaflet's own onRemove in production, is what actually removes _currentImage).
    expect(map.hasLayer(overlay)).toBe(true);
  });

  it("tolerates a pending image that already detached itself (isConnected false)", () => {
    const { layer, map, pane } = makeLayer();
    guardRasterOpacity(layer);
    renderOne(layer, map, pane);
    pane.children[0].isConnected = false;
    expect(() => layer.onRemove(map)).not.toThrow();
  });

  it("sweeps more than one still-pending image (a second cycle superseding the first before either resolves)", () => {
    const { layer, map, pane } = makeLayer();
    guardRasterOpacity(layer);
    const a = renderOne(layer, map, pane);
    const b = renderOne(layer, map, pane);
    expect(map.hasLayer(a)).toBe(true);
    expect(map.hasLayer(b)).toBe(true);
    layer.onRemove(map);
    expect(map.hasLayer(a)).toBe(false);
    expect(map.hasLayer(b)).toBe(false);
  });
});

describe("guardRasterOpacity — self-heal on \"load\"", () => {
  it("forces opacity when the current image still matches the live view but wasn't raised", () => {
    const { layer, map, pane, handlers } = makeLayer({ opacity: 1 });
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane);
    overlay._bounds = { equals: () => true }; // still exactly the current view
    layer._currentImage = overlay;
    expect(overlay._image.style.opacity).toBe("0"); // esri-leaflet's own raise silently never ran
    handlers.load();
    expect(overlay._image.style.opacity).toBe("1");
  });

  it("does NOT force opacity for a stale image whose bounds no longer match the view", () => {
    const { layer, map, pane, handlers } = makeLayer({ opacity: 1 });
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane);
    overlay._bounds = { equals: () => false }; // the view moved on — esri-leaflet's own call
    layer._currentImage = overlay;
    handlers.load();
    expect(overlay._image.style.opacity).toBe("0"); // left alone, never forced visible
  });

  it("is a no-op when the layer isn't attached to a map at load time", () => {
    const { layer, map, pane, handlers } = makeLayer({ opacity: 1 });
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane);
    overlay._bounds = { equals: () => true };
    layer._currentImage = overlay;
    layer._map = null; // layer already torn down
    expect(() => handlers.load()).not.toThrow();
    expect(overlay._image.style.opacity).toBe("0");
  });

  it("is a no-op when there is no current image at all (a genuinely failed/discarded load)", () => {
    const { layer, handlers } = makeLayer({ opacity: 1 });
    guardRasterOpacity(layer);
    layer._currentImage = null;
    expect(() => handlers.load()).not.toThrow();
  });

  it("clears a settled image out of the pending set, so a later teardown doesn't re-touch it", () => {
    const { layer, map, pane, handlers } = makeLayer({ opacity: 1 });
    guardRasterOpacity(layer);
    const overlay = renderOne(layer, map, pane);
    overlay._bounds = { equals: () => true };
    layer._currentImage = overlay;
    handlers.load();
    expect(map.hasLayer(overlay)).toBe(true); // shown correctly
    layer.onRemove(map); // a later, unrelated teardown
    // Still present — it's now genuinely current, not a leftover the sweep should have opinions about.
    expect(map.hasLayer(overlay)).toBe(true);
  });
});
