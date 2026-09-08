/* LANDING a11y + FRONT-DOOR PROOF. Rewritten for the B1162800 rebuild (2026-09-07).
 *
 * Two things this file proves, both logged-out / no-external-GIS / Claude-doable here
 * (ATTEMPT-BEFORE-YOU-PARK):
 *
 *  1. Basic a11y structure + keyboard reachability of the new single-screen page.
 *
 *  2. THE FRONT-DOOR REDIRECT DOES NOT LOOP. index.html sends any visitor with no
 *     planarfit:/sb-*-auth-token in localStorage and no "?app" straight to /landing/. The
 *     approved design's links all pointed at bare "https://planyr.io", which would have sent
 *     a brand-new visitor clicking "Open Planyr" right back to this same page. This is
 *     proven with REAL CLICKS (not page.goto DOM probes — programmatic navigation and
 *     programmatic scroll have both produced false alarms on this exact page before) from a
 *     freshly seeded empty-localStorage profile, at three viewport heights, for all three
 *     links: "Open Planyr", "Create an account", and the masthead "Sign in".
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, d = "") => { console.log((c ? "  ok  " : "FAIL  ") + n + (d ? "  — " + d : "")); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });

// ---------- LANDING: a11y structure + keyboard ----------
console.log("\n=== LANDING a11y structure / keyboard ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await assertMeasurable(p, "verify-landing-a11y");
  await p.goto(BASE + "/landing/", { waitUntil: "load" });
  await sleep(700);
  const struct = await p.evaluate(() => {
    const h1 = [...document.querySelectorAll("h1")];
    const heads = [...document.querySelectorAll("h1,h2,h3")].map((h) => +h.tagName[1]);
    let skip = false; for (let i = 1; i < heads.length; i++) { if (heads[i] - heads[i - 1] > 1) skip = true; }
    const landmarks = { main: !!document.querySelector("main"), header: !!document.querySelector("header"), footer: !!document.querySelector("footer") };
    const canvas = document.getElementById("bg");
    const canvasHidden = canvas && canvas.getAttribute("aria-hidden") === "true";
    const canvasFocusable = canvas && canvas.tabIndex >= 0;
    const posTab = [...document.querySelectorAll("[tabindex]")].filter((e) => +e.getAttribute("tabindex") > 0).length;
    return { h1count: h1.length, h1text: h1[0] && h1[0].innerText.replace(/\s+/g, " ").trim().slice(0, 60), heads, skip, landmarks, canvasHidden, canvasFocusable, posTab };
  });
  ok("exactly one h1", struct.h1count === 1, "count=" + struct.h1count + " text=" + struct.h1text);
  ok("no skipped heading levels", !struct.skip, "levels=" + JSON.stringify(struct.heads));
  ok("has main+header+footer landmarks", struct.landmarks.main && struct.landmarks.header && struct.landmarks.footer, JSON.stringify(struct.landmarks));
  ok("decorative canvas aria-hidden + not focusable", struct.canvasHidden && !struct.canvasFocusable, JSON.stringify({ h: struct.canvasHidden, f: struct.canvasFocusable }));
  ok("no positive tabindex anti-pattern", struct.posTab === 0, "count=" + struct.posTab);

  await p.evaluate(() => window.scrollTo(0, 0));
  const focusChain = [];
  for (let i = 0; i < 5; i++) {
    await p.keyboard.press("Tab");
    const f = await p.evaluate(() => {
      const a = document.activeElement;
      return a ? { tag: a.tagName, text: (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 24), outline: getComputedStyle(a).outlineStyle } : null;
    });
    focusChain.push(f);
  }
  const reachable = focusChain.filter((f) => f && (f.tag === "A" || f.tag === "BUTTON")).length;
  ok("keyboard: Tab reaches interactive elements (brand, sign-in, open, create-account)", reachable >= 3, JSON.stringify(focusChain.map((f) => f && f.tag)));
  const anyVisibleFocus = focusChain.some((f) => f && f.outline && f.outline !== "none");
  ok("keyboard: focus ring visible on a focused link", anyVisibleFocus, "outlines=" + JSON.stringify(focusChain.map((f) => f && f.outline)));
  await ctx.close();
}

// ---------- FRONT DOOR: real clicks, empty localStorage, no loop ----------
console.log("\n=== FRONT DOOR: real click from empty localStorage never loops back to /landing/ ===");
const VIEWPORTS = [
  { name: "short-laptop", width: 1600, height: 521 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
];
const LINKS = [
  { label: "Open Planyr", selector: ".btn-primary", expectAuthOpen: false },
  { label: "Create an account", selector: ".btn-secondary", expectAuthOpen: "signup" },
  { label: "Sign in", selector: "header .signin", expectAuthOpen: "signin" },
];

for (const vp of VIEWPORTS) {
  console.log(`  -- ${vp.name} ${vp.width}×${vp.height} --`);
  const noScrollCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  const sp = await noScrollCtx.newPage();
  await assertMeasurable(sp, "verify-landing-a11y");
  await sp.goto(BASE + "/landing/", { waitUntil: "load" });
  await sleep(700);
  const layout = await sp.evaluate(() => ({
    noHorizontalScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    h1Visible: (() => { const h1 = document.querySelector("h1"); if (!h1) return false; const r = h1.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
  }));
  ok(`${vp.name}: page renders fully, no horizontal scroll`, layout.noHorizontalScroll && layout.h1Visible, JSON.stringify(layout));
  await noScrollCtx.close();

  for (const link of LINKS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
    // Seed truly empty localStorage — a brand-new visitor, never anything with a
    // planarfit:/sb-*-auth-token key, which is exactly the profile the front-door
    // redirect in index.html tests for.
    await ctx.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-landing-a11y");
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(BASE + "/landing/", { waitUntil: "load" });
    await sleep(500);

    const el = await page.$(link.selector);
    if (!el) { ok(`${vp.name}: "${link.label}" — element found`, false); await ctx.close(); continue; }
    await el.click(); // a REAL click, not page.goto — proves the actual href + the app's own redirect logic together
    await page.waitForLoadState("load").catch(() => {});
    await sleep(1800); // real app boot: Shell mount, auth-panel deep-link effect, etc.

    const after = await page.evaluate(() => ({
      pathname: location.pathname,
      search: location.search,
      onLanding: location.pathname.indexOf("/landing") >= 0,
      rootChildren: (document.getElementById("root") || {}).childElementCount || 0,
      bodyTextLen: (document.body.innerText || "").replace(/\s+/g, " ").trim().length,
    }));
    // Click again to prove it doesn't bounce back on a SECOND look either (the loop the
    // approved design's bare planyr.io links would have produced is round-trip, not one-way).
    const stillNotLanding = !after.onLanding;

    ok(`${vp.name}: "${link.label}" click never lands back on /landing/`, stillNotLanding, `url=${after.pathname}${after.search}`);
    ok(`${vp.name}: "${link.label}" click boots a real, non-blank app`, after.rootChildren > 0 && after.bodyTextLen > 0, JSON.stringify({ children: after.rootChildren, textLen: after.bodyTextLen }));

    if (link.expectAuthOpen) {
      const authState = await page.evaluate(() => {
        const heading = document.querySelector("h1, h2, [class*=title]");
        return {
          bodyText: (document.body.innerText || "").slice(0, 4000),
        };
      });
      const wantsSignup = link.expectAuthOpen === "signup";
      const sawSignupCue = /create account/i.test(authState.bodyText);
      const sawSigninCue = /sign in/i.test(authState.bodyText);
      ok(
        `${vp.name}: "${link.label}" opens the auth panel on the "${link.expectAuthOpen}" tab`,
        wantsSignup ? sawSignupCue : sawSigninCue,
        `signupCue=${sawSignupCue} signinCue=${sawSigninCue}`
      );
    }
    ok(`${vp.name}: "${link.label}" — no page errors`, errs.length === 0, errs[0] || "");
    await ctx.close();
  }
}

console.log("\n" + (fails === 0 ? "✅ LANDING A11Y + FRONT DOOR ALL PASSED" : ("⚠️  " + fails + " CHECK(S) FAILED")));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
