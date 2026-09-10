/* B1497890 — WIRING GUARDS for the Dashboard's Comps card reverse-geocode fix.
 *
 * The Comps card's `useCompAddress` used to fire an uncached reverse-geocode network call the
 * instant the card mounted — every single Dashboard visit, forever, whether or not the card had
 * ever scrolled onto screen. The fix (mirroring B1497889/PR 1636's identical fix for
 * CompsPanel.jsx, "the same eager-reverse-geocode habit, a third implementation") is two things:
 * share the pin-address cache instead of a second, uncached implementation, and defer the network
 * call behind an on-screen gate. The cache's pure half now lives in the dependency-free
 * `shared/comps/lib/pinAddrCache.js` (split out of CompsPanel.jsx, which re-exports it unchanged)
 * — pointing CompsCard.jsx's dynamic import at CompsPanel.jsx directly, instead, once measurably
 * leaked unrelated chunks onto the Site Planner route's bundle; see pinAddrCache.js's own header.
 *
 * Neither half is a pure library — `useCompAddress`/`useOnScreen` are React effects that need a
 * real DOM + a real IntersectionObserver to exercise (this repo's vitest config is deliberately
 * Node-only, no jsdom — vitest.config.js's own header), and CompsCard's existing SSR-based tests
 * (compsCardFooter.test.js) already document that an effect-driven network branch never runs under
 * `renderToStaticMarkup`. So — same shape as test/parcelOfflineWiring.test.js — these are SOURCE
 * guards proving the fix is actually WIRED, not a fresh reimplementation of what
 * test/compPinAddrCache.test.js already proves about the cache functions themselves. The live
 * network half is LIVE-VERIFY, same as every other GIS call in this repo (see CompsCard.jsx's own
 * header) and is tracked in VERIFICATION.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const card = readFileSync(resolve(here, "../src/workspaces/dashboard/components/CompsCard.jsx"), "utf8");

describe("CompsCard shares the pin-address disk cache (never a parallel one, never through the heavy component chunk)", () => {
  /* Mutation: replace the pinAddrCache.js dynamic import with a bare `localStorage.getItem(...)`
     call (or drop it) → this goes red. */
  it("dynamically imports pinAddrCache.js's pinCacheKey/readPinAddrStorage/persistPinAddr", () => {
    expect(card).toMatch(/import\(["']\.\.\/\.\.\/\.\.\/shared\/comps\/lib\/pinAddrCache\.js["']\)/);
    expect(card).toMatch(/pinCacheKey/);
    expect(card).toMatch(/readPinAddrStorage/);
    expect(card).toMatch(/persistPinAddr/);
  });

  /* Mutation: point the dynamic import at CompsPanel.jsx's component path instead → this goes red.
     Importing the component file directly is exactly the regression pinAddrCache.js's own header
     documents (it leaked jurisdiction/compMarkerIcon/localDb/countyKeys onto the Site route). */
  it("never dynamically imports the CompsPanel.jsx component file", () => {
    expect(card).not.toMatch(/import\(["'][^"']*shared\/comps\/components\/CompsPanel\.jsx["']\)/);
  });

  /* The whole point: a cache hit must short-circuit BEFORE the network call, not just alongside
     it — otherwise every visit still pays for the fetch and only skips the write. */
  it("checks the cache before calling reverseGeocodeLatLon, not after", () => {
    const cacheCheckIdx = card.indexOf("readPinAddrStorage()[key]");
    const networkCallIdx = card.indexOf("reverseGeocodeLatLon(anchor.lat, anchor.lon)");
    expect(cacheCheckIdx).toBeGreaterThan(-1);
    expect(networkCallIdx).toBeGreaterThan(-1);
    expect(cacheCheckIdx).toBeLessThan(networkCallIdx);
  });

  /* Never re-invent PIN_ADDR_STORAGE_KEY / a second localStorage.setItem for this cache — that
     would be exactly the "third implementation" this item was filed to close. */
  it("never writes its own localStorage key for the pin-address cache", () => {
    expect(card).not.toMatch(/localStorage\.(get|set)Item/);
    expect(card).not.toMatch(/compPinAddr/);
  });
});

describe("CompsCard defers the reverse-geocode network call until the card is on screen", () => {
  /* Mutation: call useCompAddress(featured) with no second argument → this goes red (the gate
     would be wired but never actually threaded through). */
  it("useCompAddress is invoked with the on-screen gate, not called unconditionally", () => {
    expect(card).toMatch(/useCompAddress\(featured,\s*onScreen\)/);
  });

  it("useOnScreen observes the card's own root element via IntersectionObserver", () => {
    expect(card).toMatch(/IntersectionObserver/);
    expect(card).toMatch(/ref=\{rootRef\}/);
  });

  /* The gate must fail OPEN (fire immediately) rather than never firing at all when
     IntersectionObserver isn't available — this repo's own telemetry gate follows the identical
     rule ("the gate FAILS OPEN — never silence a real user over a throwing property read"). */
  it("fails open when IntersectionObserver is unavailable", () => {
    expect(card).toMatch(/typeof IntersectionObserver === ["']undefined["']/);
  });

  /* The synchronous fallback (county name / site-plan title) must still render immediately even
     while the network half is gated — nothing may go blank while deferred. */
  it("enabled only gates the network branch — the synchronous fallback still returns unconditionally", () => {
    const enabledGuardIdx = card.indexOf("if (!enabled) return undefined;");
    const fallbackIdx = card.indexOf("return resolved || pinFallbackText(anchor, countyEntry);");
    expect(enabledGuardIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(-1);
    // The fallback return sits OUTSIDE the effect (after it), so it is never behind the `enabled` guard.
    const effectEndIdx = card.indexOf("}, [anchor, enabled]);");
    expect(effectEndIdx).toBeGreaterThan(enabledGuardIdx);
    expect(fallbackIdx).toBeGreaterThan(effectEndIdx);
  });
});
