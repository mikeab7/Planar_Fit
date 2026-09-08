import { describe, it, expect } from "vitest";
import { relativeTimeShort } from "../src/workspaces/dashboard/lib/relativeTime.js";

const NOW = Date.parse("2026-09-08T12:00:00Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

describe("relativeTimeShort", () => {
  it("reads 'just now' for under a minute", () => {
    expect(relativeTimeShort(minsAgo(0), NOW)).toBe("just now");
  });
  it("reads minutes under an hour", () => {
    expect(relativeTimeShort(minsAgo(5), NOW)).toBe("5m ago");
    expect(relativeTimeShort(minsAgo(59), NOW)).toBe("59m ago");
  });
  it("reads hours under a day", () => {
    expect(relativeTimeShort(minsAgo(60), NOW)).toBe("1h ago");
    expect(relativeTimeShort(minsAgo(23 * 60), NOW)).toBe("23h ago");
  });
  it("reads days under a month", () => {
    expect(relativeTimeShort(minsAgo(24 * 60), NOW)).toBe("1d ago");
    expect(relativeTimeShort(minsAgo(29 * 24 * 60), NOW)).toBe("29d ago");
  });
  it("reads months beyond that", () => {
    expect(relativeTimeShort(minsAgo(31 * 24 * 60), NOW)).toBe("1mo ago");
    expect(relativeTimeShort(minsAgo(95 * 24 * 60), NOW)).toBe("3mo ago");
  });
  it("handles empty/invalid input without throwing", () => {
    expect(relativeTimeShort(null, NOW)).toBe("");
    expect(relativeTimeShort(undefined, NOW)).toBe("");
    expect(relativeTimeShort("not a date", NOW)).toBe("");
  });
  it("never goes negative for a timestamp that is (barely) in the future — clock skew", () => {
    const future = new Date(NOW + 5000).toISOString();
    expect(relativeTimeShort(future, NOW)).toBe("just now");
  });
});
