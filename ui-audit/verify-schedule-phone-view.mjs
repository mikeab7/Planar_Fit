// B1281648 (RECURRENCE ×3 of B1241745) — owner report, on a real iPhone, 2026-09-07, after THREE
// prior shipped fixes (#1490, #1497, #1504): "Nothing happens, it's stays or goes to gant or
// grid."
//
// ROOT CAUSE, this time: every prior fix kept Split, at phone width, showing exactly ONE pane at
// a time — first via its own switcher (#1490), then via the header's existing Grid/Split/Gantt
// pill repointed to a `phonePane` state (#1497), then with that pill's own highlight bug fixed so
// it correctly kept reading "Split" (#1504). None of that mattered: a SINGLE pane behind the
// "Split" tab is visually and functionally IDENTICAL to just tapping Grid or Gantt directly, so
// from the owner's chair, tapping "Split" looked like nothing happened — no matter how correct
// the pill's own bookkeeping was underneath.
//
// FIX: Split now renders BOTH the task grid AND the Gantt chart at once at every width. At
// desktop width it's the existing resizable side-by-side layout (`DesktopSplitView`, unchanged).
// At phone width (`isMobile`) it's a NEW stacked layout (`PhoneSplitView`): grid on top, Gantt on
// the bottom, each independently scrollable, with a visible divider between them — so it is
// immediately obvious Split is a third thing, not a relabelled Grid or Gantt. Grid and Gantt
// picked directly are UNCHANGED at any width — still full-height, single-pane.
//
// ⛔ HONESTY FLAG, carried over verbatim from the dispatch that produced this fix: a simulated
// phone viewport in Playwright/Chromium is NOT proof this works on a real iPhone. This harness
// has now passed on TWO builds the owner reported as broken (the #1497 and #1504 builds both
// passed this file's own predecessor before he tested them on his device) — the same shape as
// this repo's FOREGROUND-OR-VOID incidents, where every rig passed while the real device failed
// because the rig kept the page in a state the device did not have. A green run below is
// NECESSARY and NOWHERE NEAR SUFFICIENT. His iPhone is the only real confirmation; see V930736 in
// VERIFICATION.md. WebKit (materially closer to real Mobile Safari than Chromium's device
// emulation) was re-checked this session and is still not installable in this sandbox — only
// Chromium is pre-provisioned at /opt/pw-browsers, and the environment explicitly forbids running
// a fresh `playwright install` here — so Chromium + Playwright device descriptors remains the
// ceiling this harness can reach.
//
// This harness proves, live, in emulated Chromium:
//  1. PORTRAIT phone (390×844, touch): Split shows BOTH panes at once, stacked, each with real
//     non-zero height and real content — never one pane, never a blank shell.
//  2. Tapping INTO Split from Grid, and from Gantt, at portrait phone width — both panes appear
//     immediately, not just on a fresh load.
//  3. The two stacked panes scroll INDEPENDENTLY (scrolling one leaves the other's scroll
//     position untouched).
//  4. Rotating mid-session (portrait → landscape → portrait) while in Split, and crossing the
//     768px isMobile breakpoint in both directions — both panes stay visible and real throughout,
//     never a blank frame, whether stacked (narrow) or side-by-side (wide).
//  5. The on-screen-keyboard case, approximated: focusing a Grid cell for edit, then shrinking the
//     viewport height the way iOS reduces the visible area for the keyboard — both panes still
//     render without erroring.
//  6. The grid-row-to-Gantt-row height parity fix (B1241746) still holds inside the stacked
//     layout — a grid row and a Gantt row are still the same height, even though the two are no
//     longer positioned side by side.
//  7. Landscape phone (832×380) and standard desktop (1600×900): unchanged from before — Split
//     already showed both panes there, byte-identical.
//  8. Grid and Gantt picked directly (not Split) are UNCHANGED at every width.
//  9. RED-PROOF: the core "both panes render with real content" assertion is reproduced failing
//     against the pre-fix build (see the bottom of this file's run log / the PR description for
//     the revert-and-rerun result) — this file's own comment does not substitute for having
//     actually done that; the PR records the numbers.
//
// Same boot pattern as ui-audit/verify-gantt-arrow-virtualization.mjs (curl-cached CDN deps routed
// locally — this sandbox's Chromium cannot reach the public internet — real React/react-dom from
// node_modules). Logged-out, no external GIS/Supabase needed (ATTEMPT-BEFORE-YOU-PARK).
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const NM = new URL("../node_modules/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const CA = "/root/.ccr/ca-bundle.crt";
const curlCache = (file, url) => {
  const fp = join(tmpdir(), file);
  if (!existsSync(fp)) execFileSync("curl", ["-sSL", ...(existsSync(CA) ? ["--cacert", CA] : []), "-o", fp, url], { stdio: "ignore" });
  return readFileSync(fp);
};
const LIB = {
  "react-dom/18.2.0/umd/react-dom.production.min.js": readFileSync(join(NM, "react-dom/umd/react-dom.production.min.js")),
  "react/18.2.0/umd/react.production.min.js": readFileSync(join(NM, "react/umd/react.production.min.js")),
  "@babel/standalone": curlCache("planyr-babel-standalone-7.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
  "@supabase/supabase-js": curlCache("planyr-supabase-js-2.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
};
const routeCDN = async (page) => { await page.route("**/*", (route) => {
  const u = route.request().url();
  for (const key of Object.keys(LIB)) if (u.includes(key)) return route.fulfill({ status: 200, contentType: "text/javascript", body: LIB[key] });
  if (/^https?:\/\/localhost/.test(u) || /127\.0\.0\.1/.test(u)) return route.continue();
  return route.abort();
}); };

const mkInject = (view) => `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view=${JSON.stringify(view)}; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,start,end,dur,parentId,preds){return {id:id,name:name,start:start,end:end,
    duration:dur,parentId:parentId,predecessors:preds||[],health:"gray",percentComplete:0,
    responsibleParty:"",cost:"",notes:[],isExpanded:true};};
  var day=function(n){var mo=1+Math.floor(n/26), da=1+(n%26); return "2027-"+String(mo).padStart(2,"0")+"-"+String(da).padStart(2,"0");};
  var tasks=[];
  for (var i=1; i<=10; i++) tasks.push(mk(i, "Task "+i, day(i), day(i+2), 2, null, i>1?[{id:i-1,type:"FS"}]:[]));
  p.tasks=tasks;
  d.aPid=pid;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

let currentView = "grid";
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${mkInject(currentView)}`);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/sequence/`;

const BENIGN = [/supabase\.co/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// Which ONE of the header pill's own three tabs currently reads as selected (fontWeight 600).
const activeTab = (page) => page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".hdr-view button")];
  const active = tabs.find((b) => getComputedStyle(b).fontWeight === "600");
  return active ? active.textContent.trim() : null;
});

// Reads both panes' real, on-screen state at once — the thing this whole recurrence is about.
const readBothPanes = (page) => page.evaluate(() => {
  const gridBox = document.querySelector('[data-grid-scroll="1"]')?.getBoundingClientRect() || null;
  const ganttPane = document.querySelector('[data-split-pane="gantt"]') || document.querySelector('[data-gantt-bar]')?.closest("[data-split-pane]") || null;
  const gridRows = document.querySelectorAll("[data-task-row]").length;
  const ganttBars = document.querySelectorAll("[data-gantt-bar]").length;
  const stacked = !!document.querySelector('[data-split-stack="1"]');
  return {
    gridW: gridBox ? Math.round(gridBox.width) : 0, gridH: gridBox ? Math.round(gridBox.height) : 0,
    gridRows, ganttBars, stacked,
  };
});

async function boot(page, view) {
  currentView = view;
  const real = [];
  page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  await routeCDN(page);
  await assertMeasurable(page, "verify-schedule-phone-view");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => real.push("GOTO: " + e.message));
  await page.waitForSelector(".hdr-view", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return real;
}

// ── 1. PORTRAIT phone, arriving already on Split — BOTH panes, real, stacked ──
{
  console.log("── Portrait phone (390×844, touch), Split (arriving already saved) ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const p1 = await readBothPanes(page);
  ok(p1.stacked, `phone-width Split renders the stacked layout, not the desktop side-by-side one`);
  ok(p1.gridH > 50 && p1.gridRows > 0, `the Grid pane is real — non-zero height (${p1.gridH}px), real rows (${p1.gridRows})`);
  ok(p1.ganttBars > 0, `the Gantt pane ALSO renders, at the same time as Grid — real bars (${p1.ganttBars} found)`);
  ok((await activeTab(page)) === "Split", `the pill reads "Split" as active (got "${await activeTab(page)}")`);
  // Both panes must have real, independent, non-zero box heights, not one collapsed to 0.
  const boxes = await page.evaluate(() => {
    const g = document.querySelector('[data-split-pane="grid"]')?.getBoundingClientRect();
    const t = document.querySelector('[data-split-pane="gantt"]')?.getBoundingClientRect();
    return { g: g ? Math.round(g.height) : 0, t: t ? Math.round(t.height) : 0 };
  });
  ok(boxes.g > 50 && boxes.t > 50, `BOTH stacked panes have real, non-zero height at once (grid=${boxes.g}px, gantt=${boxes.t}px) — not one pane, not a hidden shell`);
  ok(real.length === 0, `no uncaught page errors (portrait Split arrival, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-phone-portrait-split-stacked.png" }).catch(() => {});
  await ctx.close();
}

// ── 2. PORTRAIT phone, TAPPING INTO Split from Grid — both panes appear immediately ──
{
  console.log("── Portrait phone (390×844, touch), TAPPING INTO Split from Grid ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "grid");
  ok((await activeTab(page)) === "Grid", `arrives on Grid with "Grid" active (got "${await activeTab(page)}")`);
  const before = await readBothPanes(page);
  ok(before.ganttBars === 0, `plain Grid shows no Gantt bars before tapping Split (${before.ganttBars})`);
  await page.locator(".hdr-view button", { hasText: "Split" }).tap();
  await page.waitForTimeout(400);
  const after = await readBothPanes(page);
  ok((await activeTab(page)) === "Split", `tapping Split visibly selects "Split" on the pill (got "${await activeTab(page)}")`);
  ok(after.gridRows > 0 && after.ganttBars > 0, `tapping Split from Grid shows BOTH panes immediately — real rows (${after.gridRows}) AND real bars (${after.ganttBars}), the fix for "nothing happens"`);
  ok(real.length === 0, `no uncaught page errors (grid-to-split, ${real.length})`);
  await ctx.close();
}

// ── 2b. PORTRAIT phone, TAPPING INTO Split from Gantt — both panes appear immediately ──
{
  console.log("── Portrait phone (390×844, touch), TAPPING INTO Split from Gantt ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "gantt");
  await page.locator(".hdr-view button", { hasText: "Split" }).tap();
  await page.waitForTimeout(400);
  const after = await readBothPanes(page);
  ok(after.gridRows > 0 && after.ganttBars > 0, `tapping Split from Gantt shows BOTH panes immediately (rows=${after.gridRows}, bars=${after.ganttBars})`);
  ok((await activeTab(page)) === "Split", `"Split" is active after tapping into it from Gantt (got "${await activeTab(page)}")`);
  ok(real.length === 0, `no uncaught page errors (gantt-to-split, ${real.length})`);
  await ctx.close();
}

// ── 3. The two stacked panes scroll INDEPENDENTLY ──
{
  console.log("── Portrait phone Split: the two stacked panes scroll independently ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const before = await page.evaluate(() => ({
    grid: document.querySelector('[data-grid-scroll="1"]')?.scrollTop ?? null,
    gantt: [...document.querySelectorAll('[data-split-pane="gantt"] div')].find((d) => d.scrollHeight > d.clientHeight)?.scrollTop ?? null,
  }));
  // Scroll the Grid pane only, via a real wheel event inside it.
  const gridBox = await page.locator('[data-grid-scroll="1"]').boundingBox();
  await page.mouse.move(gridBox.x + gridBox.width / 2, gridBox.y + gridBox.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    grid: document.querySelector('[data-grid-scroll="1"]')?.scrollTop ?? null,
    gantt: [...document.querySelectorAll('[data-split-pane="gantt"] div')].find((d) => d.scrollHeight > d.clientHeight)?.scrollTop ?? null,
  }));
  ok(after.grid > (before.grid ?? 0), `scrolling inside the Grid pane actually moved it (before=${before.grid}, after=${after.grid})`);
  ok((after.gantt ?? 0) === (before.gantt ?? 0), `scrolling the Grid pane left the Gantt pane's own scroll position UNTOUCHED (before=${before.gantt}, after=${after.gantt}) — independent scroll, no cross-pane sync`);
  ok(real.length === 0, `no uncaught page errors (independent scroll, ${real.length})`);
  await ctx.close();
}

// ── 4. Rotate mid-session while in Split, both directions — both panes stay real throughout ──
{
  console.log("── Rotate mid-session while in Split (portrait → landscape → portrait) ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  const landscape = await readBothPanes(page);
  ok(landscape.gridRows > 0 && landscape.ganttBars > 0, `landscape (844×390, clears isMobile) still shows both panes, now side by side (rows=${landscape.gridRows}, bars=${landscape.ganttBars}, stacked=${landscape.stacked})`);
  ok(!landscape.stacked, `landscape uses the desktop side-by-side layout, not the phone stack (stacked=${landscape.stacked})`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const portraitAgain = await readBothPanes(page);
  ok(portraitAgain.gridRows > 0 && portraitAgain.ganttBars > 0, `rotating back to portrait keeps BOTH panes visible, now re-stacked (rows=${portraitAgain.gridRows}, bars=${portraitAgain.ganttBars})`);
  ok(portraitAgain.stacked, `rotating back to portrait re-enters the stacked layout (stacked=${portraitAgain.stacked})`);
  ok((await activeTab(page)) === "Split", `"Split" is still active after the round-trip rotation (got "${await activeTab(page)}")`);
  ok(real.length === 0, `no uncaught page errors (rotation, ${real.length})`);
  await ctx.close();
}

// ── 5. Cross the 768px breakpoint in BOTH directions while in Split — both panes stay real ──
{
  console.log("── Cross the isMobile breakpoint both directions while in Split ──");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.waitForTimeout(500);
  const wide = await readBothPanes(page);
  ok(wide.gridRows > 0 && wide.ganttBars > 0, `crossing narrow→wide (1024px) keeps both panes real (rows=${wide.gridRows}, bars=${wide.ganttBars})`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const narrow = await readBothPanes(page);
  ok(narrow.gridRows > 0 && narrow.ganttBars > 0, `crossing wide→narrow (390px) keeps both panes real, now stacked (rows=${narrow.gridRows}, bars=${narrow.ganttBars}, stacked=${narrow.stacked})`);
  ok(real.length === 0, `no uncaught page errors (breakpoint crossing, ${real.length})`);
  await ctx.close();
}

// ── 6. On-screen-keyboard approximation: focus a Grid cell, shrink the viewport height ──
{
  console.log("── Portrait phone Split, approximating the on-screen keyboard opening while editing ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const nameCell = page.locator('[data-task-row="1"]').first();
  await nameCell.tap();
  await page.waitForTimeout(200);
  // iOS shrinks the visible viewport height when the keyboard opens — approximated here as a
  // straight viewport resize. NOT a real keyboard: no visualViewport event, no real inset. Stated
  // plainly per the brief's own honesty requirement — see this file's header comment.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(300);
  const withKeyboard = await readBothPanes(page);
  ok(withKeyboard.gridRows > 0 && withKeyboard.ganttBars > 0, `both panes keep rendering (not erroring out) with a shrunk viewport approximating the keyboard (rows=${withKeyboard.gridRows}, bars=${withKeyboard.ganttBars})`);
  await page.setViewportSize({ width: 390, height: 844 });
  ok(real.length === 0, `no uncaught page errors (keyboard-shrink approximation, ${real.length})`);
  await ctx.close();
}

// ── 7. B1241746's row-height parity fix still holds inside the STACKED layout ──
{
  console.log("── Portrait phone Split: grid-row / Gantt-row height parity (B1241746) still holds when stacked ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const heights = await page.evaluate(() => {
    const gridRow = document.querySelector('[data-task-row]')?.getBoundingClientRect();
    const ganttRow = document.querySelector('[data-gantt-row]')?.getBoundingClientRect();
    return { grid: gridRow ? gridRow.height : null, gantt: ganttRow ? ganttRow.height : null };
  });
  ok(heights.grid != null && heights.gantt != null, `both a grid row and a Gantt row were found (grid=${heights.grid}, gantt=${heights.gantt})`);
  ok(Math.abs((heights.grid ?? 0) - (heights.gantt ?? 0)) < 0.5, `a grid row and a Gantt row render at the SAME height even stacked, not side by side (grid=${heights.grid?.toFixed(2)}px, gantt=${heights.gantt?.toFixed(2)}px)`);
  ok(real.length === 0, `no uncaught page errors (row-height parity, ${real.length})`);
  await ctx.close();
}

// ── 8. Landscape phone (832×380) — unchanged: real two-pane side-by-side Split ──
{
  console.log("── Landscape phone (832×380, touch, clears 768px isMobile threshold) ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13 Pro Max landscape"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const p = await readBothPanes(page);
  ok(p.gridRows > 0 && p.ganttBars > 0, `landscape phone still shows the real two-pane Split (rows=${p.gridRows}, bars=${p.ganttBars})`);
  ok(!p.stacked, `landscape phone uses the desktop side-by-side layout, unchanged (stacked=${p.stacked})`);
  ok((await activeTab(page)) === "Split", `"Split" reads active in the real two-pane view (got "${await activeTab(page)}")`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && zbox.height >= 44 && zbox.width >= 44, `Gantt zoom button still meets the 44px touch floor at landscape phone width (${zbox ? `${zbox.width.toFixed(0)}x${zbox.height.toFixed(0)}` : "not found"})`);
  ok(real.length === 0, `no uncaught page errors (landscape two-pane, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-phone-landscape-split.png" }).catch(() => {});
  await ctx.close();
}

// ── 9. Grid and Gantt picked DIRECTLY at phone width — unchanged, full-height, single-pane ──
{
  console.log("── Portrait phone (390×844, touch): Grid and Gantt picked directly are unchanged ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "grid");
  const gridOnly = await readBothPanes(page);
  ok(gridOnly.gridRows > 0 && gridOnly.ganttBars === 0, `plain Grid: only the grid renders, no Gantt bars, no split-stack wrapper (rows=${gridOnly.gridRows}, bars=${gridOnly.ganttBars}, stacked=${gridOnly.stacked})`);
  ok(!gridOnly.stacked, `plain Grid never renders the split-stack wrapper`);
  await page.locator(".hdr-view button", { hasText: "Gantt" }).tap();
  await page.waitForTimeout(400);
  const ganttOnly = await readBothPanes(page);
  ok(ganttOnly.ganttBars > 0 && ganttOnly.gridRows === 0, `plain Gantt: only bars render, no grid rows, no split-stack wrapper (bars=${ganttOnly.ganttBars}, rows=${ganttOnly.gridRows}, stacked=${ganttOnly.stacked})`);
  ok(!ganttOnly.stacked, `plain Gantt never renders the split-stack wrapper`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && zbox.height >= 44 && zbox.width >= 44, `Gantt zoom button meets the 44px touch floor at portrait phone width (${zbox ? `${zbox.width.toFixed(0)}x${zbox.height.toFixed(0)}` : "not found"})`);
  ok(real.length === 0, `no uncaught page errors (plain grid/gantt at phone width, ${real.length})`);
  await ctx.close();
}

// ── 10. Standard DESKTOP viewport (mouse) — Split unchanged, zoom buttons unchanged, pill untouched ──
{
  console.log("── Standard desktop (1600×900, mouse) — pixel-parity check ──");
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const p = await readBothPanes(page);
  ok(p.gridRows > 0 && p.ganttBars > 0, `desktop Split still shows BOTH panes at once, unchanged (rows=${p.gridRows}, bars=${p.ganttBars})`);
  ok(!p.stacked, `desktop Split still uses the resizable side-by-side layout, never the phone stack`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && Math.round(zbox.height) === 21, `desktop zoom button height is byte-identical to before this fix (21px, got ${zbox ? zbox.height.toFixed(1) : "n/a"})`);
  const splitWeight = await page.locator(".hdr-view button", { hasText: "Split" }).evaluate((el) => getComputedStyle(el).fontWeight);
  ok(splitWeight === "600", `Split tab is still shown as active on desktop (fontWeight 600, got ${splitWeight})`);
  ok(real.length === 0, `no uncaught page errors (desktop split, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-desktop-split.png" }).catch(() => {});
  await ctx.close();
}

await browser.close(); server.close();

console.log("\n" + (fails.length === 0
  ? "✅ PASS — B1281648 (Split at phone width now shows both panes, stacked) verified in emulated Chromium. This is NOT proof it works on a real iPhone — see this file's own header comment and V930736 in VERIFICATION.md."
  : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
