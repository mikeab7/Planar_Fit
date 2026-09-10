/* CompsPanel's comp-pin reverse-geocode cache (NEW-2 — a project-open perf report measured six
 * reverse-geocode calls firing the instant the Comps panel mounted, once per pin/parcel-anchored
 * comp, with no persistence: a fresh page load re-resolved every one of them again). This covers
 * the pure, localStorage-backed half: `pinCacheKey` (the lat/lon rounding that keys the cache)
 * and the `readPinAddrStorage`/`persistPinAddr` pair that makes a resolved address survive a
 * reload instead of being geocoded once per page load, forever.
 *
 * localStorage is stubbed the same way test/colorRecents.test.js does — this repo's vitest
 * config runs in a plain Node environment (no jsdom), so there's no browser storage global
 * unless the test provides one.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { pinCacheKey, readPinAddrStorage, persistPinAddr, PIN_ADDR_STORAGE_KEY, PIN_ADDR_STORAGE_MAX } from "../src/shared/comps/components/CompsPanel.jsx";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

beforeEach(() => { store.clear(); });

describe("pinCacheKey", () => {
  it("keys on lat/lon rounded to 6 decimal places", () => {
    expect(pinCacheKey({ lat: 29.7323267, lon: -94.8692291 })).toBe("29.732327,-94.869229");
  });
  it("returns null for anything without numeric lat/lon (site_plan anchors, malformed rows)", () => {
    expect(pinCacheKey(null)).toBe(null);
    expect(pinCacheKey({ kind: "site_plan" })).toBe(null);
    expect(pinCacheKey({ lat: "29.7", lon: -94.8 })).toBe(null); // a string lat is not a number
  });
});

describe("readPinAddrStorage / persistPinAddr — the disk-persisted half", () => {
  it("starts empty when nothing has ever been persisted", () => {
    expect(readPinAddrStorage()).toEqual({});
  });

  it("a persisted address round-trips through the SAME key persistPinAddr wrote it under", () => {
    const key = pinCacheKey({ lat: 29.7323267, lon: -94.8692291 });
    persistPinAddr(key, "123 Main St, Baytown, TX");
    expect(readPinAddrStorage()).toEqual({ [key]: "123 Main St, Baytown, TX" });
  });

  it("survives being read back as though from a fresh page load (a plain JSON round trip)", () => {
    persistPinAddr("29.0,-95.0", "One address");
    persistPinAddr("30.0,-96.0", "Another address");
    const raw = JSON.parse(store.get(PIN_ADDR_STORAGE_KEY));
    expect(raw).toEqual({ "29.0,-95.0": "One address", "30.0,-96.0": "Another address" });
  });

  it("a garbled/foreign value under the storage key is ignored, never thrown — falls back to empty", () => {
    store.set(PIN_ADDR_STORAGE_KEY, "not json at all {{{");
    expect(readPinAddrStorage()).toEqual({});
    store.set(PIN_ADDR_STORAGE_KEY, JSON.stringify([1, 2, 3])); // an array, not the expected object shape
    expect(readPinAddrStorage()).toEqual({});
  });

  it("is bounded — persisting past PIN_ADDR_STORAGE_MAX trims the OLDEST entries, not the newest", () => {
    for (let i = 0; i < PIN_ADDR_STORAGE_MAX + 5; i++) persistPinAddr(`k${i}`, `addr${i}`);
    const stored = readPinAddrStorage();
    expect(Object.keys(stored)).toHaveLength(PIN_ADDR_STORAGE_MAX);
    expect(stored.k0).toBeUndefined(); // the earliest entries were trimmed
    expect(stored[`k${PIN_ADDR_STORAGE_MAX + 4}`]).toBe(`addr${PIN_ADDR_STORAGE_MAX + 4}`); // the most recent survives
  });

  it("never throws when localStorage itself throws (quota exceeded / private mode)", () => {
    const real = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => persistPinAddr("29.0,-95.0", "An address")).not.toThrow();
    globalThis.localStorage.setItem = real;
  });
});
