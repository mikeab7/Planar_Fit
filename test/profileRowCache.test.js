/* profileRowCache — NEW-1 (a project-open perf report measured `profiles?select=prefs`/`select=*`
 * fetched 5-8 times on one cold load, because several independent modules each read the SAME row
 * with their own direct Supabase call). This is the shared cache that collapses those into one
 * fetch per uid: concurrent callers share one in-flight request, a settled read is kept for the
 * TTL window, and a failed read is evicted immediately (never cached as a failure) so the next
 * caller retries rather than being stuck failing for the rest of the window.
 *
 * The supabase client module is mocked (same approach as authCaptcha.test.js / reviewDeleteSafety.test.js)
 * so this never makes a real network call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ calls: 0, impl: null }));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.calls++;
            return h.impl();
          },
        }),
      }),
    }),
  },
}));

import { getProfileRow, invalidateProfileRow } from "../src/shared/profile/profileRowCache.js";

beforeEach(() => {
  h.calls = 0;
  h.impl = async () => ({ data: { id: "u1", prefs: { compsRatePeriod: "monthly" } }, error: null });
  invalidateProfileRow(); // clear every cached row between tests — no cross-test pollution
});

describe("getProfileRow — coalescing + session cache", () => {
  it("fetches once and returns the row", async () => {
    const row = await getProfileRow("u1");
    expect(row).toEqual({ id: "u1", prefs: { compsRatePeriod: "monthly" } });
    expect(h.calls).toBe(1);
  });

  it("a second call for the SAME uid is served from cache — no second fetch", async () => {
    await getProfileRow("u1");
    await getProfileRow("u1");
    await getProfileRow("u1");
    expect(h.calls).toBe(1);
  });

  it("concurrent callers for the same uid share ONE in-flight request", async () => {
    const [a, b, c] = await Promise.all([getProfileRow("u1"), getProfileRow("u1"), getProfileRow("u1")]);
    expect(h.calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a DIFFERENT uid is never served the other uid's cached row", async () => {
    h.impl = async () => ({ data: { id: "whoever-was-asked" }, error: null });
    const rowA = await getProfileRow("u1");
    const rowB = await getProfileRow("u2");
    expect(h.calls).toBe(2);
    expect(rowA).not.toBe(rowB);
  });

  it("no uid resolves to null without ever fetching", async () => {
    expect(await getProfileRow(null)).toBe(null);
    expect(await getProfileRow(undefined)).toBe(null);
    expect(h.calls).toBe(0);
  });

  it('a real fetch error REJECTS — never silently collapsed to null — so a caller can still tell "no row" apart from "the read failed" (userPrefs.js / compsRatePeriodPrefs.js both depend on this)', async () => {
    h.impl = async () => ({ data: null, error: { message: "offline" } });
    await expect(getProfileRow("u1")).rejects.toBeTruthy();
  });

  it("a failed read is NOT cached — the next call retries instead of failing for the whole TTL window", async () => {
    h.impl = async () => ({ data: null, error: { message: "offline" } });
    await expect(getProfileRow("u1")).rejects.toBeTruthy();
    expect(h.calls).toBe(1);
    h.impl = async () => ({ data: { id: "u1" }, error: null });
    const row = await getProfileRow("u1");
    expect(row).toEqual({ id: "u1" });
    expect(h.calls).toBe(2);
  });

  it("invalidateProfileRow(uid) forces the NEXT read to be fresh, not the cached pre-write row (every save path calls this after a successful write)", async () => {
    await getProfileRow("u1");
    expect(h.calls).toBe(1);
    h.impl = async () => ({ data: { id: "u1", prefs: { compsRatePeriod: "annual" } }, error: null });
    invalidateProfileRow("u1");
    const row = await getProfileRow("u1");
    expect(h.calls).toBe(2);
    expect(row.prefs.compsRatePeriod).toBe("annual");
  });

  it("invalidateProfileRow() with no argument clears EVERY cached uid", async () => {
    await getProfileRow("u1");
    await getProfileRow("u2");
    expect(h.calls).toBe(2);
    invalidateProfileRow();
    await getProfileRow("u1");
    await getProfileRow("u2");
    expect(h.calls).toBe(4);
  });

  it("a signed-out row (maybeSingle finds nothing) caches the null and still counts as one fetch", async () => {
    h.impl = async () => ({ data: null, error: null });
    const a = await getProfileRow("u1");
    const b = await getProfileRow("u1");
    expect(a).toBe(null);
    expect(b).toBe(null);
    expect(h.calls).toBe(1);
  });
});
