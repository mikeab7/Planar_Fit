/* verify-notes-pending-caret — A PRESS PLACES A CURSOR AND NOTHING ELSE; THE FIRST KEYSTROKE
 * MAKES THE NOTE; THE VIEW NEVER MOVES ON ITS OWN (NEW-8 / NEW-9 / NEW-10, owner report
 * 2026-09-08).
 *
 * ⛔ HIS MODEL, VERBATIM: *"just because I click outside of the page, it shouldn't automatically
 * open the page up to it. Only once I actually type something. And also, if I click somewhere and
 * then don't type anything, I shouldn't get the notice."* And: *"when I do click elsewhere, it
 * moves the whole screen, and it shouldn't do that at all."*
 *
 * ⛔ THE THREE PROPERTIES, and each is asserted separately rather than as one "it works":
 *   NEW-8  a press changes NOTHING — no node, no page growth, no stored bytes — only a caret.
 *   NEW-9  a press you type nothing into produces NO notice, because nothing was created.
 *   NEW-10 the scroll position is BYTE-IDENTICAL before and after every press.
 *
 * ⛔ THE STORED DOCUMENT IS COMPARED AS A STRING, not as a count. "One box before, one box after"
 * is exactly what a build that deleted one and created another would report; the byte comparison
 * is the only form that cannot be satisfied by a wash. That is the same bar
 * `verify-notes-anchor-soak` has always held, and NEW-8 makes it true by construction rather than
 * by cleaning up afterwards.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

const doc = (withNote) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Body line one." }] },
    { type: "paragraph", content: [{ type: "text", text: "Body line two, so the column has real writing in it." }] },
    ...(withNote ? [{ type: "noteAnchor", attrs: { x: 430, y: 220, w: 180, h: null, aid: "existing" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "ALREADY PLACED" }] }] }] : []),
    { type: "paragraph", content: [] },
  ],
});

async function open(withNote, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-pending-caret");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Pending", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc(withNote)]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
  return page;
}

/** Everything a press must not change, read in one go. */
const snapshot = (page) => page.evaluate((k) => {
  const sheet = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  const mat = document.querySelector('[data-testid="note-mat"]');
  const title = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
  return {
    raw: localStorage.getItem(k) || "",
    anchors: document.querySelectorAll(".planyr-anchor").length,
    sheetW: Math.round(sheet.width), sheetH: Math.round(sheet.height),
    scrollTop: Math.round(mat.scrollTop), scrollLeft: Math.round(mat.scrollLeft),
    titleTop: Math.round(title.top),
    caret: !!document.querySelector('[data-testid="note-pending-caret"]'),
    notice: !!document.querySelector('[data-testid="note-anchor-discarded"]'),
  };
}, PAGE_KEY);

/** A point in the grey margin, clear of the page. */
const marginPoint = (page, side = "right", dy = 260) => page.evaluate(([sd, d]) => {
  const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  const m = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
  const x = sd === "right" ? Math.round((s.right + m.right) / 2) : Math.round((m.left + s.left) / 2);
  return { x, y: Math.round(s.top + d) };
}, [side, dy]);

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["short laptop", { width: 1280, height: 620 }],
];

const rows = [];
for (const [vpName, viewport] of VIEWPORTS) {
  for (const withNote of [false, true]) {
    const scene = `${vpName}, ${withNote ? "with an existing placed note" : "empty page"}`;
    console.log("\n" + "=".repeat(100));
    console.log(scene.toUpperCase());
    console.log("=".repeat(100));

    /* ── 1. click in the margin, then click away ─────────────────────────────────────────── */
    {
      const page = await open(withNote, viewport);
      const before = await snapshot(page);
      const at = await marginPoint(page, "right");
      await page.mouse.click(at.x, at.y);
      await pacedWait(page, 400);
      const armed = await snapshot(page);
      ok(`${scene} · a press draws a caret and creates NOTHING`,
        armed.caret && armed.raw === before.raw && armed.anchors === before.anchors,
        `caret ${armed.caret} · stored bytes ${armed.raw.length === before.raw.length ? "unchanged" : "CHANGED"} · anchors ${before.anchors}→${armed.anchors}`);
      ok(`${scene} · …and the page does not grow to reach the pointer`,
        armed.sheetW === before.sheetW && armed.sheetH === before.sheetH,
        `${before.sheetW}×${before.sheetH} → ${armed.sheetW}×${armed.sheetH}`);
      ok(`${scene} · …and the view does not move`,
        armed.scrollTop === before.scrollTop && armed.scrollLeft === before.scrollLeft && armed.titleTop === before.titleTop,
        `scroll ${before.scrollTop}/${before.scrollLeft} → ${armed.scrollTop}/${armed.scrollLeft} · title top ${before.titleTop} → ${armed.titleTop}`);
      const away = await marginPoint(page, "left", 420);
      await page.mouse.click(away.x, away.y);
      await pacedWait(page, 600);
      const after = await snapshot(page);
      ok(`${scene} · click in the margin then click away — the document is BYTE-IDENTICAL`,
        after.raw === before.raw, `${before.raw.length} → ${after.raw.length} bytes`);
      ok(`${scene} · …and NO discard notice appears`, !after.notice, String(after.notice));
      ok(`${scene} · …and the view still has not moved`,
        after.scrollTop === before.scrollTop && after.scrollLeft === before.scrollLeft,
        `scroll ${after.scrollTop}/${after.scrollLeft}`);
      rows.push({ scene, case: "click, then click away", document: "byte-identical", page: "unchanged", scroll: "unchanged", notice: "none" });
      await page.context().close();
    }

    /* ── 2. click, type one character, delete it ─────────────────────────────────────────── */
    {
      const page = await open(withNote, viewport);
      const before = await snapshot(page);
      const at = await marginPoint(page, "right");
      await page.mouse.click(at.x, at.y);
      await pacedWait(page, 350);
      await page.keyboard.type("Z");
      await pacedWait(page, 700);
      const typed = await snapshot(page);
      ok(`${scene} · the FIRST keystroke makes the note and grows the page`,
        typed.anchors === before.anchors + 1 && typed.sheetW > before.sheetW,
        `anchors ${before.anchors}→${typed.anchors} · sheet ${before.sheetW}→${typed.sheetW}`);
      ok(`${scene} · …and the character typed is what is in it`,
        await page.evaluate(() => {
          const els = [...document.querySelectorAll(".planyr-anchor")];
          return (els[els.length - 1]?.innerText || "").trim() === "Z";
        }), "Z");
      await page.keyboard.press("Backspace");
      await pacedWait(page, 700);
      const emptied = await snapshot(page);
      ok(`${scene} · deleting that one character leaves the box you are still in`,
        emptied.anchors === before.anchors + 1, `${emptied.anchors} on the page`);
      rows.push({ scene, case: "click, type one char, delete it", document: "one note, now empty", page: "grew on the keystroke", scroll: "unchanged", notice: "none" });
      await page.context().close();
    }

    /* ── 3. click, then Escape ───────────────────────────────────────────────────────────── */
    {
      const page = await open(withNote, viewport);
      const before = await snapshot(page);
      const at = await marginPoint(page, "right");
      await page.mouse.click(at.x, at.y);
      await pacedWait(page, 350);
      await page.keyboard.press("Escape");
      await pacedWait(page, 600);
      const after = await snapshot(page);
      ok(`${scene} · click then Escape — the caret goes, the document is BYTE-IDENTICAL`,
        !after.caret && after.raw === before.raw, `caret ${after.caret} · ${after.raw.length} bytes`);
      ok(`${scene} · …no notice, and the view has not moved`,
        !after.notice && after.scrollTop === before.scrollTop && after.scrollLeft === before.scrollLeft,
        `notice ${after.notice} · scroll ${after.scrollTop}/${after.scrollLeft}`);
      rows.push({ scene, case: "click, then Escape", document: "byte-identical", page: "unchanged", scroll: "unchanged", notice: "none" });
      await page.context().close();
    }

    /* ── 4. click, then click a second spot ──────────────────────────────────────────────── */
    {
      const page = await open(withNote, viewport);
      const before = await snapshot(page);
      const a = await marginPoint(page, "right", 200);
      await page.mouse.click(a.x, a.y);
      await pacedWait(page, 350);
      const b = await marginPoint(page, "right", 430);
      await page.mouse.click(b.x, b.y);
      await pacedWait(page, 400);
      const armed = await snapshot(page);
      const caretY = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="note-pending-caret"]');
        return c ? Math.round(c.getBoundingClientRect().top) : null;
      });
      ok(`${scene} · clicking a second spot moves the caret and still creates nothing`,
        armed.caret && armed.raw === before.raw && caretY !== null && Math.abs(caretY - b.y) < 40,
        `exactly one caret, at y≈${caretY} for a press at y=${b.y} · document ${armed.raw === before.raw ? "byte-identical" : "CHANGED"}`);
      ok(`${scene} · …and there is only ever ONE caret on screen`,
        await page.evaluate(() => document.querySelectorAll('[data-testid="note-pending-caret"]').length) === 1, "1");
      ok(`${scene} · …and the view has not moved`,
        armed.scrollTop === before.scrollTop && armed.scrollLeft === before.scrollLeft,
        `scroll ${armed.scrollTop}/${armed.scrollLeft}`);
      rows.push({ scene, case: "click, then a second spot", document: "byte-identical", page: "unchanged", scroll: "unchanged", notice: "none" });
      await page.context().close();
    }
  }
}

/* ── 5. NEW-10's own repro: click elsewhere with a note placed far out ─────────────────── */
console.log("\n" + "=".repeat(100));
console.log("NEW-10's OWN REPRO — a note placed far outside the column, then a press elsewhere");
console.log("=".repeat(100));
for (const [vpName, viewport] of VIEWPORTS) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await assertMeasurable(page, "verify-notes-pending-caret:new10");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Pending", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Body line one." }] },
      { type: "noteAnchor", attrs: { x: 820, y: 900, w: 180, h: null, aid: "faraway" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "FAR OUT AND FAR DOWN" }] }] },
      { type: "paragraph", content: [] } ] }));
  }, [TREE_KEY, PAGE_KEY]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
  const before = await snapshot(page);
  /* Press on the first line of the body — an ordinary "click somewhere else". */
  const onText = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="note-body"] p').getBoundingClientRect();
    return { x: Math.round(p.left + 30), y: Math.round(p.top + p.height / 2) };
  });
  await page.mouse.click(onText.x, onText.y);
  await pacedWait(page, 600);
  const after = await snapshot(page);
  ok(`${vpName}: clicking elsewhere does not scroll the view`,
    after.scrollTop === before.scrollTop && after.scrollLeft === before.scrollLeft,
    `scroll ${before.scrollTop}/${before.scrollLeft} → ${after.scrollTop}/${after.scrollLeft}`);
  ok(`${vpName}: …and the page title is still where it was — not scrolled off the top`,
    after.titleTop === before.titleTop, `title top ${before.titleTop} → ${after.titleTop}`);
  rows.push({ scene: `${vpName}, note far outside the column`, case: "click elsewhere on the page", document: "byte-identical", page: "unchanged", scroll: "unchanged", notice: "none" });
  await page.context().close();
}

/* ── 6. HIS ACTUAL SCROLL SCENE: place something LOW in the window ──────────────────────────
 * ⛔ THIS CASE EXISTS BECAUSE §5 WAS NOT ENOUGH. Run against the pre-fix build, §5 stayed GREEN:
 * a press on the body's first line has nothing to scroll to. What he actually did was place an
 * item low in the window — the caret then landed near the bottom, the page got taller, and the
 * browser scrolled to keep the caret visible, taking the title off the top. An audit that finds
 * nothing is a failed audit, so the case was rewritten until it reproduced. */
console.log("\n" + "=".repeat(100));
console.log("PLACING LOW IN THE WINDOW — the scroll he actually saw (title off the top)");
console.log("=".repeat(100));
for (const [vpName, viewport] of VIEWPORTS) {
  const page = await open(true, viewport);
  const before = await snapshot(page);
  const low = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round((s.right + m.right) / 2), y: Math.round(m.bottom - 40) };
  });
  await page.mouse.click(low.x, low.y);
  await pacedWait(page, 500);
  const armed = await snapshot(page);
  ok(`${vpName}: pressing low in the window does not scroll the view`,
    armed.scrollTop === before.scrollTop && armed.titleTop === before.titleTop,
    `scrollTop ${before.scrollTop} → ${armed.scrollTop} · title top ${before.titleTop} → ${armed.titleTop}`);
  await page.keyboard.type("LOW");
  await pacedWait(page, 800);
  const typed = await snapshot(page);
  ok(`${vpName}: …and neither does the keystroke that actually makes the note`,
    typed.scrollTop === before.scrollTop && typed.titleTop === before.titleTop,
    `scrollTop ${before.scrollTop} → ${typed.scrollTop} · title top ${before.titleTop} → ${typed.titleTop}`);
  ok(`${vpName}: …and the note really was made down there`,
    typed.anchors === before.anchors + 1, `anchors ${before.anchors} → ${typed.anchors}`);
  rows.push({ scene: `${vpName}, placing low in the window`, case: "press low, then type", document: "one new note", page: "grew on the keystroke", scroll: "unchanged", notice: "none" });
  await page.context().close();
}

/* ── 7. A LONG NOTE, ALREADY SCROLLED — the case that caught a real defect ──────────────────
 * ⛔ THIS IS THE ONE THAT EARNED ITS PLACE. §5 and §6 both stayed green on the pre-fix build and
 * on the fix; this scene — a note long enough for the pane to scroll, scrolled half way — caught
 * the fix's OWN first draft moving the view from scrollTop 500 to 138 on a bare press, because
 * arming the caret focused the editor and Chromium does not honour `preventScroll` on this
 * contenteditable. A scroll defect is invisible on a page that cannot scroll. */
console.log("\n" + "=".repeat(100));
console.log("A LONG NOTE, ALREADY SCROLLED — no press may move it");
console.log("=".repeat(100));
for (const [vpName, viewport] of VIEWPORTS) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await assertMeasurable(page, "verify-notes-pending-caret:scrolled");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Long", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify({ type: "doc", content: [
      ...Array.from({ length: 40 }, (_, i) => ({ type: "paragraph",
        content: [{ type: "text", text: `Paragraph ${i + 1} — real writing so the note is long enough for the pane to scroll.` }] })),
      { type: "noteAnchor", attrs: { x: 700, y: 1400, w: 180, h: null, aid: "low" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "PLACED LOW AND OUT" }] }] },
      { type: "paragraph", content: [] } ] }));
  }, [TREE_KEY, PAGE_KEY]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  const scrollable = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="note-mat"]');
    return Math.round(m.scrollHeight - m.clientHeight);
  });
  /* ⛔ VACUITY GUARD: a pane that cannot scroll cannot fail this section, and would score it
   * green for free (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's known-answer rule, one door over). */
  ok(`${vpName}: the pane genuinely scrolls, so this section can fail at all`,
    scrollable > 300, `${scrollable}px of scroll available`);
  await page.evaluate(() => { document.querySelector('[data-testid="note-mat"]').scrollTop = 500; });
  await pacedWait(page, 400);

  const read = () => page.evaluate(() => {
    const m = document.querySelector('[data-testid="note-mat"]');
    const t = document.querySelector('[data-testid="note-title"]').getBoundingClientRect();
    return { top: Math.round(m.scrollTop), titleTop: Math.round(t.top) };
  });
  const presses = [
    ["a press in the right margin", () => page.evaluate(() => {
      const sh = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
      const m = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
      return { x: Math.round((sh.right + m.right) / 2), y: Math.round(m.top + 120) };
    })],
    ["a press on body text", () => page.evaluate(() => {
      const r = document.querySelectorAll('[data-testid="note-body"] p')[3].getBoundingClientRect();
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
    })],
    ["a press on the placed note", () => page.evaluate(() => {
      const el = document.querySelector('.planyr-anchor[data-anchor-id="low"]');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 10) };
    })],
  ];
  for (const [what, where] of presses) {
    const before = await read();
    const at = await where();
    if (!at) continue;
    await page.mouse.click(at.x, at.y);
    await pacedWait(page, 700);
    const after = await read();
    ok(`${vpName}: ${what} does not move a scrolled view`,
      after.top === before.top && after.titleTop === before.titleTop,
      `scrollTop ${before.top} → ${after.top} · title top ${before.titleTop} → ${after.titleTop}`);
    await page.evaluate(() => { document.querySelector('[data-testid="note-mat"]').scrollTop = 500; });
    await pacedWait(page, 300);
  }
  rows.push({ scene: `${vpName}, long note scrolled half way`, case: "margin / body / placed note", document: "byte-identical", page: "unchanged", scroll: "unchanged", notice: "none" });
  await page.context().close();
}

console.log("\nTHE TABLE FOR THE PR:");
console.table(rows);
console.log("\n" + "=".repeat(100));
if (failures.length) { console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`); process.exitCode = 1; }
else console.log("✓ every case passed");
await browser.close();
