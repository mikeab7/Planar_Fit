/* The white-knockout pixel pass (B654) — pure, no DOM: near-white (all channels ≥ 247)
 * goes fully transparent; linework and tinted fills keep their alpha. */
import { describe, it, expect, vi } from "vitest";
import { knockoutNearWhite, knockoutCanvas } from "../src/workspaces/site-planner/lib/overlayPdf.js";

const px = (...rgba) => new Uint8ClampedArray(rgba);

/* A fake 2D context recording every getImageData/putImageData call. Each band is seeded with a
 * distinct fill so a test can tell which band a written call belongs to. `data` is a real
 * Uint8ClampedArray (as pdf.js/the DOM would hand back) so `knockoutNearWhite` runs unmodified. */
function fakeCtx(bandFill) {
  const calls = { get: [], put: [] };
  return {
    calls,
    getImageData(x, y, w, h) {
      calls.get.push({ x, y, w, h });
      const fill = bandFill(y);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3]; }
      return { data, width: w, height: h };
    },
    putImageData(img, x, y) {
      calls.put.push({ x, y, alpha0: img.data[3] });
    },
  };
}

describe("knockoutNearWhite (B654)", () => {
  it("zeroes alpha for near-white pixels only (threshold 247 per channel)", () => {
    const d = px(
      255, 255, 255, 255, // pure white -> knocked out
      247, 247, 247, 255, // at threshold -> knocked out
      246, 255, 255, 255, // one channel below -> kept
      0, 0, 0, 255,       // black linework -> kept
      250, 240, 250, 255, // tinted near-white (g below) -> kept
    );
    knockoutNearWhite(d);
    expect(d[3]).toBe(0);
    expect(d[7]).toBe(0);
    expect(d[11]).toBe(255);
    expect(d[15]).toBe(255);
    expect(d[19]).toBe(255);
  });
  it("mutates in place and returns the same array; empty input is a no-op", () => {
    const d = px(255, 255, 255, 200);
    expect(knockoutNearWhite(d)).toBe(d);
    expect(d[3]).toBe(0); // knocked out regardless of prior alpha
    expect(knockoutNearWhite(px()).length).toBe(0);
  });
  it("leaves color channels untouched (alpha-only pass)", () => {
    const d = px(255, 255, 255, 255, 10, 20, 30, 40);
    knockoutNearWhite(d);
    expect([...d]).toEqual([255, 255, 255, 0, 10, 20, 30, 40]);
  });
});

/* NEW-1 (canvas freeze on cold load with PDF overlays) — `knockoutCanvas` used to run its
 * per-band getImageData/putImageData loop as ONE unbroken synchronous stretch (measured: ~350ms
 * of one uninterruptible call stack per real overlay, doubled with two overlays open on a cold
 * load — the reported multi-second freeze). It now drives the same bands through
 * `paintSchedule.runBudgeted`, yielding a real macrotask between budgeted batches. These tests
 * inject a fake clock + a fake (non-yielding but COUNTED) yield function, so they run instantly
 * and deterministically while still PROVING the yielding actually happens — the same shape
 * `paintSchedule.test.js` uses for `runBudgeted` itself. */
describe("knockoutCanvas (NEW-1 — bands must not run as one synchronous block)", () => {
  it("knocks out each band independently and writes it back at the right offset", async () => {
    // Two 512px bands stacked in a 1000px-tall image (second band is the 488px remainder).
    // Band 0 seeded pure white (knocks out); band 1 seeded black linework (stays opaque).
    const ctx = fakeCtx((y) => (y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    await knockoutCanvas(ctx, 10, 1000, { now: () => 0, yieldFn: async () => {} });
    expect(ctx.calls.get).toEqual([{ x: 0, y: 0, w: 10, h: 512 }, { x: 0, y: 512, w: 10, h: 488 }]);
    expect(ctx.calls.put).toEqual([{ x: 0, y: 0, alpha0: 0 }, { x: 0, y: 512, alpha0: 255 }]);
  });

  it("actually YIELDS between budgeted batches instead of draining synchronously (the regression this closes)", async () => {
    // Four bands (2048px tall). A clock that crosses the budget after every single band forces
    // `runBudgeted` to yield after each one (paintSchedule's own generator yields after ANY op
    // that trips the budget check, trailing op included — see paintSchedule.test.js). The count
    // that matters here isn't the exact number so much as that it is NOT ZERO: if `knockoutCanvas`
    // ever reverts to one plain synchronous loop, `yieldFn` is called zero times and this fails.
    const ctx = fakeCtx(() => [255, 255, 255, 255]);
    let t = 0;
    const now = () => { t += 100; return t; }; // every op alone "costs" 100ms > any sane budget
    const yieldFn = vi.fn(async () => {});
    await knockoutCanvas(ctx, 10, 2048, { budgetMs: 40, now, yieldFn });
    expect(ctx.calls.get.length).toBe(4); // every band still runs, exactly once
    expect(yieldFn).toHaveBeenCalledTimes(4); // yields after every band — proves real chunking
  });

  it("never yields for a small image that finishes inside one budget window", async () => {
    const ctx = fakeCtx(() => [0, 0, 0, 255]);
    const yieldFn = vi.fn(async () => {});
    await knockoutCanvas(ctx, 10, 100, { now: () => 0, yieldFn }); // one band, well under budget
    expect(ctx.calls.get.length).toBe(1);
    expect(yieldFn).not.toHaveBeenCalled();
  });

  it("stays tainted-canvas-safe: a getImageData throw is swallowed, not propagated", async () => {
    const ctx = {
      getImageData() { throw new DOMException("tainted", "SecurityError"); },
      putImageData() {},
    };
    await expect(knockoutCanvas(ctx, 10, 10, { now: () => 0, yieldFn: async () => {} })).resolves.toBeUndefined();
  });

  it("works with its real default scheduler (genuine MessageChannel macrotask, no injected fakes)", async () => {
    const ctx = fakeCtx(() => [255, 255, 255, 255]);
    await knockoutCanvas(ctx, 4, 4); // tiny image — one band, real timers/real yield primitive
    expect(ctx.calls.put).toEqual([{ x: 0, y: 0, alpha0: 0 }]);
  });
});
