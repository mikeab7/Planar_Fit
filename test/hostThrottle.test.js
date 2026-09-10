/* B1461731 — per-host pacing + circuit breaking for the discovery/probe tooling. Reuses the app's
 * own sourceHealth.js breaker logic (one behaviour, keyed per hostname here instead of per county)
 * so "this source is unhealthy" isn't defined twice.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  hostnameOf, isHostOpen, hostCooldownMs, resetHostHealth, recordHostOutcome, HOST_SLOW_MS,
  waitForHostSlot, resetHostThrottle, MIN_HOST_GAP_MS,
} from "../ui-audit/lib/hostThrottle.mjs";
import { SOURCE_FAIL_THRESHOLD, SOURCE_COOLDOWN_MS } from "../src/workspaces/site-planner/lib/sourceHealth.js";

describe("hostnameOf", () => {
  it("extracts the hostname from a real URL", () => {
    expect(hostnameOf("https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/Foo/MapServer/0")).toBe("arcgis.water.nv.gov");
  });

  it("falls back to the raw string for something unparseable, never throws", () => {
    expect(hostnameOf("not a url")).toBe("not a url");
    expect(hostnameOf(null)).toBe("");
  });
});

describe("recordHostOutcome / isHostOpen — the Nevada window: an 18s error, then total non-response", () => {
  beforeEach(resetHostHealth);
  const url = "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0";

  it("stays closed below the failure threshold", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD - 1; i++) recordHostOutcome(url, false, 18000, t);
    expect(isHostOpen(url, t)).toBe(false);
  });

  it("opens after N consecutive failures on the SAME host, keyed by hostname not by full URL", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordHostOutcome(url, false, 18000, t);
    // a DIFFERENT service on the same host reads the same open breaker
    const sibling = "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0";
    expect(isHostOpen(sibling, t)).toBe(true);
    expect(hostCooldownMs(url, t)).toBe(SOURCE_COOLDOWN_MS);
  });

  it("a single slow-but-ok response does not open the breaker (the neighbour walk can still try siblings)", () => {
    const t = 1000;
    recordHostOutcome(url, true, HOST_SLOW_MS + 1000, t);
    expect(isHostOpen(url, t)).toBe(false);
  });

  it("repeated slow-but-ok responses open the breaker exactly like repeated failures would", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordHostOutcome(url, true, HOST_SLOW_MS + 1000, t);
    expect(isHostOpen(url, t)).toBe(true);
  });

  it("a fast, healthy response resets the streak", () => {
    const t = 1000;
    recordHostOutcome(url, false, 18000, t);
    recordHostOutcome(url, false, 18000, t);
    recordHostOutcome(url, true, 120, t); // healthy — resets
    recordHostOutcome(url, false, 18000, t); // fresh streak of 1
    expect(isHostOpen(url, t)).toBe(false);
  });

  it("auto-resumes once the cooldown elapses", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordHostOutcome(url, false, 18000, t);
    expect(isHostOpen(url, t + SOURCE_COOLDOWN_MS + 1)).toBe(false);
  });
});

describe("waitForHostSlot — a minimum gap between requests to the same host", () => {
  beforeEach(resetHostThrottle);
  const url = "https://example.test/arcgis/rest/services/Foo/Bar/MapServer/0";

  it("does not wait for the first call to a host", async () => {
    let clock = 5000;
    const now = () => clock;
    let slept = 0;
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    expect(slept).toBe(0);
  });

  it("waits out the remaining gap for a second call issued too soon", async () => {
    let clock = 5000;
    const now = () => clock;
    let slept = 0;
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    clock += 50; // only 50ms elapsed, gap floor is MIN_HOST_GAP_MS
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    expect(slept).toBe(MIN_HOST_GAP_MS - 50);
  });

  it("does not wait once the gap has already naturally elapsed", async () => {
    let clock = 5000;
    const now = () => clock;
    let slept = 0;
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    clock += MIN_HOST_GAP_MS + 10;
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    expect(slept).toBe(0);
  });

  it("paces different hosts independently", async () => {
    let clock = 5000;
    const now = () => clock;
    let slept = 0;
    await waitForHostSlot(url, { now, sleepImpl: async (ms) => { slept += ms; } });
    await waitForHostSlot("https://other.test/arcgis/rest/services/X/Y/MapServer/0", { now, sleepImpl: async (ms) => { slept += ms; } });
    expect(slept).toBe(0); // a different host is never throttled by the first host's timing
  });
});
