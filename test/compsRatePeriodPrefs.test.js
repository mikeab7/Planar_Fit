import { describe, it, expect } from "vitest";
import { DEFAULT_COMPS_RATE_PERIOD, _normalizePeriod } from "../src/shared/comps/lib/compsRatePeriodPrefs.js";

describe("compsRatePeriodPrefs — _normalizePeriod (the pure half)", () => {
  it("recognizes exactly 'monthly'", () => {
    expect(_normalizePeriod("monthly")).toBe("monthly");
  });
  it("anything else — unset, garbage, the wrong case — falls back to the default (annual)", () => {
    expect(_normalizePeriod("annual")).toBe(DEFAULT_COMPS_RATE_PERIOD);
    expect(_normalizePeriod(null)).toBe(DEFAULT_COMPS_RATE_PERIOD);
    expect(_normalizePeriod(undefined)).toBe(DEFAULT_COMPS_RATE_PERIOD);
    expect(_normalizePeriod("Monthly")).toBe(DEFAULT_COMPS_RATE_PERIOD);
    expect(_normalizePeriod(42)).toBe(DEFAULT_COMPS_RATE_PERIOD);
  });
  it("the default itself is annual — an account that never touches the toggle sees today's behavior", () => {
    expect(DEFAULT_COMPS_RATE_PERIOD).toBe("annual");
  });
});
