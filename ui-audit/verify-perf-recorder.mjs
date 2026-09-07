#!/usr/bin/env node
/* verify-perf-recorder — THE TWO GUARDS THE ALWAYS-ON PERFORMANCE RECORDER SHIPS WITH (NEW-1).
 *
 * ⛔ GUARD 1 — OVERHEAD, MEASURED RATHER THAN CLAIMED. The recorder exists to explain a session
 * that gets slower the longer it runs. An instrument that allocates per frame would be a garbage-
 * collection schedule, and a GC pause is indistinguishable from the jank being hunted. So the cost
 * of its hot path is MEASURED, in a real browser, two ways:
 *   (a) TIME, DIRECTLY — `window.pfRec.__benchFrame(n)` drives the REAL per-frame function over
 *       synthetic timestamps and reports µs/frame. This is the strong timing measurement: an A/B on
 *       a noisy page can hide a small constant, a direct microbenchmark cannot.
 *   ⛔ (a) DOES NOT COVER ALLOCATION, AND THIS FILE DELIBERATELY DOES NOT PRETEND TO. Planting a
 *       real per-frame object plus a per-frame string in the hot path moved (a) from 0.05 to
 *       0.07 µs/frame — nowhere near its 2 µs bound — because a young-generation bump allocation
 *       in a tight loop costs about twenty nanoseconds. The cost was never the point: the GC
 *       schedule it creates an hour later is, and that is exactly the jank being hunted.
 *       A heap-delta arm over `performance.memory` WAS built for this and then REMOVED, because it
 *       could not discriminate and a guard that cannot fail on its own defect is decoration:
 *         · without `--enable-precise-memory-info` the value is quantised to 100 KB and cached for
 *           twenty minutes, so the planted defect read exactly 0 on every run;
 *         · with the flag, ambient growth (a timer tick, V8 taking a page, the evaluate call
 *           itself) only ADDS and a scavenge only SUBTRACTS, so the MAX read 33.6 bytes/frame on a
 *           hot path that allocates nothing and the MIN read −21.5 on one that allocates ~48. Both
 *           statistics were measured, both were wrong, and no third one rescues a signal that noisy
 *           at this granularity.
 *       The allocation property is guarded DETERMINISTICALLY instead, by a source rule over the hot
 *       path in `test/perfRecorder.test.js` — which fails on that same planted object immediately.
 *   (b) A/B — the same scripted gesture with the recorder ON and with it OFF (`?perfrec=off`,
 *       which is also the field kill switch), interleaved, comparing median frame time. This is the
 *       weaker but more honest end-to-end read: it includes the observers, the counter timer and
 *       the input listeners, none of which the microbenchmark touches.
 *
 * ⛔ GUARD 2 — ANTI-ROT. A recorder that never fires is indistinguishable from a healthy app. That
 * is exactly the failure mode `count-pond-invocations --assert` and the decode/annotation fault
 * arms exist to close, and it is the one this file must not repeat. So a deliberate stall is
 * INDUCED and a capture is asserted to FIRE. **If the induced-stall arm comes back clean, this
 * exits 1 as NOT OBSERVING** — a green from an instrument that saw nothing is worse than a red.
 * A CONTROL arm drives the identical gesture with no stall and asserts NOTHING fires, so the guard
 * proves the trigger discriminates rather than merely that it is loud.
 *
 *   node ui-audit/verify-perf-recorder.mjs --build
 *   ... --json
 *
 * It needs NO external host, NO sign-in and NO plan fixture: the recorder is installed from
 * main.jsx and works on any route, so this runs hermetically here — which is the whole point of
 * putting it in CI's reach rather than filing it as a live check.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const PORT = Number(arg("--port", 4187));

/* ── the stated bounds ──────────────────────────────────────────────────────────────────────
 * Chosen BEFORE the measurement, and stated here so a later run cannot quietly move them.
 *   SELF_US_MAX 2.0   — two microseconds per frame is 0.012% of a 16.7 ms frame budget and 0.01%
 *                       of the owner's 20 ms one. Anything with a per-frame allocation or an
 *                       accidental O(window) scan lands orders of magnitude above it.
 *   AB_MS_MAX 0.6     — the end-to-end median frame-time difference between ON and OFF. Bigger
 *                       than the microbenchmark bound because it also carries the observers and
 *                       the counter timer, and because a browser's own run-to-run frame noise is
 *                       of this order (this repo's measured harness floor is ±6.3%).
 */
const SELF_US_MAX = 2.0;
const AB_MS_MAX = 0.6;

/* Compress the trigger's 50-second calibration so the guard runs in seconds. This drives the REAL
 * trigger — nothing is stubbed; only its clock constants move. */
const FAST = {
  counterMs: 500,
  idleStopMs: 1200,
  bootRunMs: 2500,
  trigger: {
    baselineSkipMs: 300,
    baselineWindowMs: 2500,
    baselineMinFrames: 60,
    baselineMaxFrames: 300,
    sustainMs: 1200,
    sustainMinFrames: 6,
    cooldownMs: 2000,
    maxAuto: 3,
    bootWindowMs: 2500,
  },
};

if (process.argv.includes("--build")) {
  process.stderr.write("  · building…\n");
  const r = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) { console.error("build failed"); process.exit(2); }
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`No build at ${DIST}. Re-run with --build.`);
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = p.slice(p.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function openPage({ recorder = true, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  if (fast) await ctx.addInitScript((cfg) => { window.__PLANYR_PERFREC = cfg; }, FAST);
  /* Everything external is blocked — this harness must be hermetic. */
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-perf-recorder");
  await page.goto(recorder ? BASE : `${BASE}?perfrec=off`, { waitUntil: "load" });
  /* The recorder is armed in an idle gap after boot, so it is not there the instant load fires. */
  if (recorder) await page.waitForFunction(() => !!window.pfRec, null, { timeout: 30000 });
  else await page.waitForTimeout(6000);
  return { ctx, page };
}

/* Drive real input for `ms`, recording per-frame deltas from an INDEPENDENT rAF loop (never the
 * recorder's own — a measurement that reads the thing it is measuring proves nothing). */
async function driveAndMeasure(page, ms, { burn = 0 } = {}) {
  await page.evaluate((burnMs) => {
    window.__probe = { d: [], prev: 0, stop: false };
    const tick = (t) => {
      if (window.__probe.prev) window.__probe.d.push(t - window.__probe.prev);
      window.__probe.prev = t;
      if (burnMs > 0) { const end = performance.now() + burnMs; while (performance.now() < end) { /* deliberate stall */ } }
      if (!window.__probe.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, burn);

  const t0 = Date.now();
  let x = 400, y = 400, dir = 1;
  while (Date.now() - t0 < ms) {
    x += 9 * dir;
    if (x > 900 || x < 300) dir = -dir;
    y = 400 + Math.round(Math.sin(x / 40) * 60);
    await page.mouse.move(x, y);
  }
  const deltas = await page.evaluate(() => { window.__probe.stop = true; return window.__probe.d.slice(); });
  const v = deltas.filter((d) => d > 0 && d < 2000).sort((a, b) => a - b);
  return { frames: v.length, medianMs: v.length ? v[Math.floor(v.length / 2)] : null };
}

const out = { bounds: { selfUsMax: SELF_US_MAX, abMsMax: AB_MS_MAX }, overhead: {}, antiRot: {} };
let failures = [];

/* ── GUARD 1a — the hot path, measured directly ─────────────────────────────────────────────── */
{
  const { ctx, page } = await openPage({ recorder: true });
  // Warm the JIT, then take the median of five runs — a first run measures compilation.
  await page.evaluate(() => window.pfRec.__benchFrame(20000));
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(await page.evaluate(() => window.pfRec.__benchFrame(50000)));
  runs.sort((a, b) => a - b);
  out.overhead.selfUsPerFrame = runs[2];
  out.overhead.selfRuns = runs;

  await ctx.close();

  if (!(out.overhead.selfUsPerFrame >= 0)) failures.push("the per-frame microbenchmark did not run — pfRec.__benchFrame is missing");
  else if (out.overhead.selfUsPerFrame > SELF_US_MAX) failures.push(`per-frame cost ${out.overhead.selfUsPerFrame} µs exceeds the stated ${SELF_US_MAX} µs bound`);
}

/* ── GUARD 1b — end to end, recorder ON vs OFF, interleaved ──────────────────────────────────── */
{
  const on = [], off = [];
  for (let rep = 0; rep < 3; rep++) {
    for (const recorder of [true, false]) {
      const { ctx, page } = await openPage({ recorder });
      if (recorder && !(await page.evaluate(() => !!window.pfRec))) { await ctx.close(); failures.push("the ON arm had no recorder — the A/B would have compared two OFF arms"); continue; }
      if (!recorder && (await page.evaluate(() => !!window.pfRec))) { await ctx.close(); failures.push("?perfrec=off did NOT disable the recorder — the A/B is vacuous"); continue; }
      const r = await driveAndMeasure(page, 3000);
      (recorder ? on : off).push(r.medianMs);
      await ctx.close();
    }
  }
  const med = (a) => { const v = a.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
  out.overhead.onMedianMs = med(on);
  out.overhead.offMedianMs = med(off);
  out.overhead.deltaMs = out.overhead.onMedianMs != null && out.overhead.offMedianMs != null
    ? Math.round((out.overhead.onMedianMs - out.overhead.offMedianMs) * 100) / 100 : null;
  out.overhead.onRuns = on; out.overhead.offRuns = off;
  if (out.overhead.deltaMs == null) failures.push("the A/B produced no comparable medians");
  else if (out.overhead.deltaMs > AB_MS_MAX) failures.push(`the recorder added ${out.overhead.deltaMs} ms to the median frame, past the stated ${AB_MS_MAX} ms bound`);
}

/* ── GUARD 2 — ANTI-ROT: induce a stall, assert a capture FIRES ──────────────────────────────── */
{
  // CONTROL: the same driving with no induced stall must NOT fire.
  const { ctx: c1, page: p1 } = await openPage({ recorder: true });
  await driveAndMeasure(p1, 4000);                       // calibrate the baseline on smooth frames
  await driveAndMeasure(p1, 4000);                       // …and keep going, still smooth
  out.antiRot.control = await p1.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  await c1.close();

  // STALL: calibrate on smooth frames, then burn the main thread for several seconds.
  const { ctx: c2, page: p2 } = await openPage({ recorder: true });
  await driveAndMeasure(p2, 4000);
  const baseline = await p2.evaluate(() => window.pfRec.state().baselineMs);
  await driveAndMeasure(p2, 5000, { burn: 70 });
  out.antiRot.stall = await p2.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  out.antiRot.baselineMs = baseline;
  await c2.close();

  const fired = (out.antiRot.stall.captures || []).filter((c) => c.kind === "auto").length;
  const controlFired = (out.antiRot.control.captures || []).filter((c) => c.kind === "auto").length;
  out.antiRot.firedOnStall = fired;
  out.antiRot.firedOnControl = controlFired;

  if (out.antiRot.stall.baselineMs == null) failures.push("NOT OBSERVING: the trigger never sealed a baseline, so it could not have fired for any reason");
  else if (fired === 0) failures.push(`NOT OBSERVING: a deliberate stall produced NO capture (baseline ${out.antiRot.stall.baselineMs} ms, window mean ${out.antiRot.stall.windowMeanMs} ms) — a recorder that cannot fire is indistinguishable from a healthy app`);
  if (controlFired > 0) failures.push(`the CONTROL arm fired ${controlFired} time(s) with no induced stall — the trigger is not discriminating, it is just loud`);
}

/* ── the MANUAL control, which no auto-trigger test can exercise ─────────────────────────────── */
{
  const { ctx, page } = await openPage({ recorder: true });
  await driveAndMeasure(page, 2500);
  const before = await page.evaluate(() => window.pfRec.captures().length);
  const took = await page.evaluate(() => window.pfRec.capture("manual"));
  const after = await page.evaluate(() => window.pfRec.captures());
  await ctx.close();
  out.manual = { took, added: after.length - before, kind: after.length ? after[after.length - 1].kind : null };
  if (!took || out.manual.added !== 1) failures.push("the manual capture path did not produce a capture");
  if (out.manual.kind !== "manual") failures.push("a manual capture is not marked as owner-reported — his perception must stay distinguishable from the threshold's");
}

/* ── GUARD 3 — BOOT WINDOW (NEW-3): a capture must be producible for the boot window, WITH ZERO
 * interaction — the exact case the owner reports (a resumed plan opening on a hard reload) and
 * the exact case the steady-state trigger structurally cannot see (no baseline exists yet).
 *
 * ⛔ THE EARLY-BURN ARM IS THE ONE THAT MATTERS MOST, and it exists because of what reading
 * `main.jsx` found: `installPerfRecorder` is itself deferred to `requestIdleCallback(…, {timeout:
 * 9000})` — DELIBERATELY, so the recorder's own arrival never competes with the four busy seconds
 * B1431 attributed to the boot. So on a genuinely busy boot the recorder may not even be
 * INSTALLED until several seconds in — which sounds like it defeats this whole fix, except that
 * `observeTasks()` subscribes with `{buffered: true}`, and a buffered PerformanceObserver
 * retroactively delivers every matching entry recorded since navigation start, however late the
 * observer itself was created. This arm proves that property holds for real rather than assuming
 * it: it burns the main thread from an `addInitScript` — BEFORE the page's own first script runs,
 * long before any idle callback could possibly fire — and only then waits for the recorder to
 * install and checks that the boot capture still landed. If this arm goes red, the whole design
 * is unsound on a real busy boot even though the "burn right after install" case would look fine.
 *
 * ⛔ NEW-1 (2026-09-07) — THIS ARM USED TO COMPUTE `earlyBurnFrames` AND PRINT IT WITHOUT EVER
 * ASSERTING ON IT, so this whole guard was green whether or not the boot judgment's own facts
 * actually reached a durable capture. Two real boot captures landed from the owner's own signed-in
 * machine on 2026-09-06 (V900704) — both carried nonzero frame tracks (23 and 63 frames) — and on
 * 2026-09-07 the owner decided a FRAMELESS boot capture on THIS PARTICULAR ARM (the pre-install
 * burn) is a correct, accepted outcome, not a defect: `feedBootTask` fires synchronously inside the
 * buffered `PerformanceObserver`'s replay callback, the instant `observeTasks()` subscribes — before
 * the boot free-run's own `requestAnimationFrame` loop has ticked even once. So `earlyBurnFrames`
 * is legitimately 0 here and **must never be asserted `> 0`** — see `CLAUDE.md`'s NEW-1 entry;
 * don't re-open this a third time. What GUARD 3 asserts instead are the bounds that ARE true on
 * current main: a pre-install burn produces a boot capture at all (already covered below by
 * `earlyBurnFires`), and that capture's own `bootTrigger`/`bootTaskMs`/`bootTaskCount` are real,
 * non-empty facts. Those three fields are NOT on `window.pfRec.captures()`'s trimmed in-memory
 * record (`perfRecorder.js`'s `rec` carries only `bootTrigger`) — they exist only on the FULL
 * capture object, which `perfRecorder.js`'s existing, unmodified `capture()` already persists to
 * IndexedDB via `perfCaptureStore.js` (DB `planyr`, store `kv`, keys prefixed `perfcap:`). So this
 * guard reads that store directly (`readIdbCaptures`/`pollForPersistedBootCapture` below) — a plain
 * IndexedDB cursor walk mirroring `originStore.js`'s own `walkOriginStore`, not a recorder change. */
async function openPageWithEarlyBurn(burnMs) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  /* Prime the ON-DEVICE "kv" IndexedDB store (same DB "planyr" / store "kv" / version 1 schema
   * `localDb.js` owns) BEFORE anything else runs. `originStore.js`'s `putOriginRecord` — the write
   * `perfCaptureStore.js` uses, unmodified — opens WITHOUT a version and deliberately does nothing
   * if the store doesn't exist yet, because creating it is `localDb.js`'s job alone. On a real
   * signed-in boot that store already exists from a prior session; this harness starts every
   * context from a brand-new empty profile, so nothing has created it yet and the boot capture's
   * write would silently no-op — not a recorder defect, a fixture gap this guard closes itself. */
  await ctx.addInitScript(() => {
    try {
      const req = indexedDB.open("planyr", 1);
      req.onupgradeneeded = () => { try { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); } catch (_) { /* ignore */ } };
    } catch (_) { /* ignore */ }
  });
  await ctx.addInitScript((cfg) => { window.__PLANYR_PERFREC = cfg; }, FAST);
  await ctx.addInitScript((ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* deliberate stall, before the recorder can possibly install */ }
  }, burnMs);
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-perf-recorder");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.pfRec, null, { timeout: 30000 });
  return { ctx, page };
}

/* Read the FULL, persisted capture objects straight out of the browser's own IndexedDB store —
 * never `window.pfRec`, which only exposes the trimmed in-memory summary. Plain cursor walk over
 * DB "planyr" / store "kv" / key prefix "perfcap:", the exact shape `originStore.js`'s own
 * `walkOriginStore` already uses — reproduced here rather than imported because this script drives
 * the page from the outside and has no loader for app ES modules. Resolves []  on any failure. */
async function readIdbCaptures(page) {
  return page.evaluate(() => new Promise((resolve) => {
    try {
      const req = indexedDB.open("planyr");
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db || !db.objectStoreNames.contains("kv")) { resolve([]); return; }
        let tx;
        try { tx = db.transaction("kv", "readonly"); } catch (_) { resolve([]); return; }
        const out = [];
        tx.onerror = () => resolve(out);
        tx.onabort = () => resolve(out);
        let cur;
        try {
          const range = IDBKeyRange.bound("perfcap:", "perfcap:￿", false, true);
          cur = tx.objectStore("kv").openCursor(range);
        } catch (_) { resolve(out); return; }
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { resolve(out); return; }
          try { out.push(JSON.parse(c.value)); } catch (_) { /* a malformed row is skipped, not fatal */ }
          c.continue();
        };
        cur.onerror = () => resolve(out);
      };
    } catch (_) { resolve([]); }
  }));
}

/* `perfRecorder.js`'s `capture()` fires the IndexedDB write and does NOT await it, so poll a few
 * short beats rather than assuming one read lands after it. */
async function pollForPersistedBootCapture(page, { tries = 6, intervalMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    const caps = await readIdbCaptures(page);
    const boot = caps.find((c) => c && c.bootTrigger);
    if (boot) return boot;
    await page.waitForTimeout(intervalMs);
  }
  return null;
}

{
  out.boot = {};

  // CONTROL: zero interaction, zero induced stall, for the whole boot free-run window. Must NOT
  // fire, but frames must still have been collected — the free-run itself has to be running.
  const { ctx: c1, page: p1 } = await openPage({ recorder: true });
  await p1.waitForTimeout(FAST.bootRunMs + 500);
  out.boot.control = await p1.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  await c1.close();

  // EARLY BURN: the main thread is busy from before the recorder could possibly install.
  const { ctx: c2, page: p2 } = await openPageWithEarlyBurn(300);
  await p2.waitForTimeout(1500);   // let the buffered PerformanceObserver entry land
  out.boot.earlyBurn = await p2.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  out.boot.persistedBootCapture = await pollForPersistedBootCapture(p2);
  await c2.close();

  const controlBootFires = (out.boot.control.captures || []).filter((c) => c.bootTrigger).length;
  const earlyBurnFires = (out.boot.earlyBurn.captures || []).filter((c) => c.bootTrigger).length;
  out.boot.controlFramesCollected = out.boot.control.frames || 0;
  out.boot.controlBootFires = controlBootFires;
  out.boot.earlyBurnBootFires = earlyBurnFires;
  const burnCap = (out.boot.earlyBurn.captures || []).find((c) => c.bootTrigger);
  out.boot.earlyBurnFrames = burnCap ? burnCap.frames : null;

  if (out.boot.controlFramesCollected === 0) failures.push("BOOT FREE-RUN NOT OBSERVING: zero frames were collected with no interaction at all — the boot free-run window is not running");
  if (controlBootFires > 0) failures.push(`the boot CONTROL arm fired ${controlBootFires} time(s) with no induced task — the boot judgment is not discriminating`);
  if (earlyBurnFires === 0) failures.push("BOOT TRIGGER NOT OBSERVING: a 300 ms task that ran BEFORE the recorder could install produced no boot capture — the buffered PerformanceObserver pickup did not work as assumed");

  /* NEW-1 — GUARD 3 previously asserted nothing about the boot judgment's OWN facts (bootTrigger /
   * bootTaskMs / bootTaskCount), only that a boot capture fired at all. `earlyBurnFrames` above is
   * printed but deliberately NEVER asserted `> 0` — see the header note above `openPageWithEarlyBurn`
   * for why 0 is the decided-correct reading on this exact arm. These bounds ARE asserted, because
   * they are true on current main and their absence would mean the boot judgment's verdict never
   * reached a durable capture. */
  const persisted = out.boot.persistedBootCapture;
  if (!persisted) {
    failures.push("BOOT CAPTURE NOT PERSISTED: no boot-triggered capture reached the device's own capture store (IndexedDB) — GUARD 3's boot arm produced nothing durable to assert on");
  } else {
    if (!persisted.bootTrigger) failures.push(`the persisted boot capture's own bootTrigger is falsy (${JSON.stringify(persisted.bootTrigger)}) — the boot judgment's verdict did not reach the stored capture`);
    if (!(persisted.bootTaskMs > 0)) failures.push(`the persisted boot capture's bootTaskMs is ${persisted.bootTaskMs}, not a positive number`);
    if (!(persisted.bootTaskCount > 0)) failures.push(`the persisted boot capture's bootTaskCount is ${persisted.bootTaskCount}, not a positive number`);
  }
}

await browser.close();
server.close();

if (JSON_OUT) { console.log(JSON.stringify({ ...out, failures }, null, 2)); process.exit(failures.length ? 1 : 0); }

console.log("\nPERFORMANCE RECORDER — overhead + anti-rot\n");
console.log("  OVERHEAD (guard 1)");
console.log(`    hot path, TIME                ${out.overhead.selfUsPerFrame} µs/frame   (bound ${SELF_US_MAX})   runs: ${(out.overhead.selfRuns || []).join(", ")}`);
console.log("    hot path, ALLOCATION          guarded deterministically in test/perfRecorder.test.js — see this file's header");
console.log(`    median frame, recorder ON     ${out.overhead.onMedianMs} ms   (${(out.overhead.onRuns || []).join(", ")})`);
console.log(`    median frame, recorder OFF    ${out.overhead.offMedianMs} ms   (${(out.overhead.offRuns || []).join(", ")})`);
console.log(`    difference                    ${out.overhead.deltaMs} ms   (bound ${AB_MS_MAX})`);
console.log("\n  ANTI-ROT (guard 2)");
console.log(`    baseline sealed at            ${out.antiRot.baselineMs} ms`);
console.log(`    captures on an INDUCED STALL  ${out.antiRot.firedOnStall}   ← must be ≥ 1, or this guard is not observing`);
console.log(`    captures on the CONTROL       ${out.antiRot.firedOnControl}   ← must be 0`);
console.log(`    stall window mean             ${out.antiRot.stall?.windowMeanMs} ms over ${out.antiRot.stall?.windowFrames} frames`);
console.log("\n  MANUAL CONTROL");
console.log(`    a press produced a capture    ${out.manual?.took ? "yes" : "NO"}, marked "${out.manual?.kind}"`);
console.log("\n  BOOT WINDOW (guard 3)");
console.log(`    frames collected, zero interaction   ${out.boot?.controlFramesCollected}   ← must be > 0 (the free-run proof)`);
console.log(`    boot captures on the CONTROL         ${out.boot?.controlBootFires}   ← must be 0`);
console.log(`    boot captures on an EARLY burn        ${out.boot?.earlyBurnBootFires}   ← must be ≥ 1, or this guard is not observing`);
console.log(`    persisted capture's bootTrigger       ${JSON.stringify(out.boot?.persistedBootCapture?.bootTrigger)}   ← must be truthy`);
console.log(`    persisted capture's bootTaskMs        ${out.boot?.persistedBootCapture?.bootTaskMs}   ← must be > 0`);
console.log(`    persisted capture's bootTaskCount     ${out.boot?.persistedBootCapture?.bootTaskCount}   ← must be > 0`);
console.log(`    that capture's own frame count       ${out.boot?.earlyBurnFrames}   (0 here is a DECIDED, ACCEPTED reading — never assert >0 on this arm; see the 2026-09-07 note above openPageWithEarlyBurn and CLAUDE.md's NEW-1 entry)`);

if (failures.length) {
  console.error(`\n⛔ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(1);
}
console.log("\n✅ the recorder costs less than the stated bound, fires on a real stall, stays silent without one, and records an owner-reported capture.");
