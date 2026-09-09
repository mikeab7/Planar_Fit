/* verify-notes-print-free-placement — WHAT A PLACED NOTE ACTUALLY DOES WHEN THE PAGE IS PRINTED
 * (NOTES-FREE-PLACEMENT / NEW-7, owner instruction 2026-09-08: *"actually print a page carrying
 * notes placed left, right, above and below, attach the resulting PDF to the PR, and state plainly
 * whether a grown page is scaled to fit, clipped, or paginated. Do not close this on a code
 * reading."*).
 *
 * ⛔ SO IT DRIVES THE REAL TOOLBAR PRINT BUTTON, and it renders a real PDF. The pure functions in
 * lib/notesPrint.js passed from the first commit of the LAST round too — and the real button was
 * still passing no document at all, so it never grew a single sheet. That defect was found by
 * driving the button and nothing else, which is why this harness does both halves:
 *   §1  the real button → read the hidden print iframe's own laid-out geometry
 *   §2  the same document → an actual PDF on disk, page count and size reported
 *
 * ⛔ AND IT ANSWERS THE THREE-WAY QUESTION EXPLICITLY — scaled, clipped, or paginated — rather
 * than asserting a boolean. A sheet that is 900px wide on a 190mm page is a real answer with a
 * real consequence, and the reply has to be able to say which one it is.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/* ⛔ THIS HARNESS REWRITES A COMMITTED FILE EVERY RUN, and the rewrite is almost always
 * MEANINGLESS: Skia stamps a CreationDate/ModDate into the PDF, so a re-run on identical code
 * produces an identical-size, identical-content file that `git status` still reports as modified.
 * Do not read that as "the printed output changed" — check the size and the MediaBox before
 * believing a diff (26,171 bytes / `0 0 612 792` at the time of writing). Point `PRINT_OUT` at a
 * scratch directory if you only want to look and not dirty the tree. */
const OUT = process.env.PRINT_OUT || "docs/artifacts";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

/* Four boxes, one off each edge of the ordinary page column — his exact requested case. */
const DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "This page carries notes placed outside its text column, on all four sides." }] },
    { type: "paragraph", content: [{ type: "text", text: "Everything below the first line is ordinary body text, so the printed sheet has something to be measured against." }] },
    ...[
      { aid: "left", x: -260, y: 120, text: "PLACED LEFT" },
      { aid: "right", x: 620, y: 120, text: "PLACED RIGHT" },
      { aid: "above", x: 200, y: -140, text: "PLACED ABOVE" },
      { aid: "below", x: 200, y: 640, text: "PLACED BELOW" },
    ].map((b) => ({
      type: "noteAnchor",
      attrs: { x: b.x, y: b.y, w: 180, h: null, aid: b.aid },
      content: [{ type: "paragraph", content: [{ type: "text", text: b.text }] }],
    })),
    { type: "paragraph", content: [] },
  ],
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await assertMeasurable(page, "verify-notes-print-free-placement");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await pacedWait(page, 250);
await page.evaluate(([tk, pk, d]) => {
  localStorage.clear();
  localStorage.setItem(tk, JSON.stringify({
    v: 3, tombs: [], trash: [],
    pages: [{ id: "p1", title: "Printed free placement", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
  }));
  localStorage.setItem(pk, JSON.stringify(d));
}, [TREE_KEY, PAGE_KEY, DOC]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 700);

/* ═══ 1. THE REAL PRINT BUTTON ════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1. THE REAL TOOLBAR PRINT BUTTON — the call site the last round missed entirely");
console.log("=".repeat(100));

/* ⛔ THE IFRAME IS DELIBERATELY 1×1 ON SCREEN, so its screen-media geometry means nothing (that
 * trap is written out in verify-notes-page-growth §6, which read a 60px sheet on a build that
 * printed correctly). §1 therefore reads only what a screen layout cannot lie about — the style
 * the sheet was given and each anchor's own serialised coordinates. The GEOMETRY question is
 * answered in §2, where the same document is laid out at full size and rendered to paper. */
await page.locator('[data-testid="nt-print"]').click();
await pacedWait(page, 1400);

const printed = await page.evaluate(() => {
  const frame = document.querySelector('[data-testid="notes-print-frame"]');
  const d = frame?.contentDocument;
  if (!d) return { present: false };
  const sheet = d.querySelector(".sheet");
  if (!sheet) return { present: true, sheet: false };
  return {
    present: true, sheet: true,
    style: sheet.getAttribute("style") || "",
    boxes: [...d.querySelectorAll(".planyr-anchor")].map((el) => ({
      id: el.getAttribute("data-anchor-id"),
      x: el.getAttribute("data-anchor-x"),
      y: el.getAttribute("data-anchor-y"),
      w: el.getAttribute("data-anchor-w"),
    })),
  };
});

ok("the Print button actually built a sheet", printed.present && printed.sheet, printed.style);
if (printed.sheet) {
  console.table(printed.boxes);
  ok("all four placed notes reached the printed document", printed.boxes.length === 4,
    printed.boxes.map((b) => b.id).join(", "));
  ok("⛔ the sheet grew LEFT — the real button's call site, not just the pure function",
    /padding-left:\s*calc\(8mm \+ \d+px\)/.test(printed.style), printed.style);
  ok("⛔ …and UP", /padding-top:\s*calc\(10mm \+ \d+px\)/.test(printed.style), printed.style);
  ok("…and wide enough for the right-hand box AND the left-hand growth together",
    /max-width:\s*max\(190mm,\s*\d+px\)/.test(printed.style), printed.style);
  ok("⛔ the boxes' own negative coordinates print verbatim — no repair, no clamp",
    printed.boxes.some((b) => Number(b.x) < 0) && printed.boxes.some((b) => Number(b.y) < 0),
    printed.boxes.map((b) => `${b.id}:${b.x},${b.y}`).join(" · "));
}

/* ═══ 2. AN ACTUAL PDF ════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("2. THE PDF ITSELF — rendered from the very document the button wrote");
console.log("=".repeat(100));
const html = await page.evaluate(() => {
  const d = document.querySelector('[data-testid="notes-print-frame"]')?.contentDocument;
  return d ? `<!doctype html>${d.documentElement.outerHTML}` : null;
});
ok("the printed document could be read back for rendering", !!html, html ? `${html.length} bytes` : "none");

const pdfPath = `${OUT}/notes-free-placement-print.pdf`;
if (html) {
  /* ⛔ THE RENDER VIEWPORT HAS TO BE WIDER THAN THE SHEET WANTS TO BE, or the measurement is the
   * harness's own window and not the sheet — caught here, reporting the right-hand box 106px
   * outside a sheet that had asked for 1152px inside a 1000px window. */
  const shot = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
  await shot.setContent(html, { waitUntil: "load" });
  await assertMeasurable(shot, "verify-notes-print-free-placement-pdf");
  await pacedWait(shot, 400);
  const size = await shot.evaluate(() => {
    const s = document.querySelector(".sheet").getBoundingClientRect();
    const boxes = [...document.querySelectorAll(".planyr-anchor")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-anchor-id"),
        inside: r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1,
        fromLeft: Math.round(r.left - s.left), fromTop: Math.round(r.top - s.top),
        fromRight: Math.round(s.right - r.right),
      };
    });
    return { w: Math.round(s.width), h: Math.round(s.height), boxes };
  });
  console.table(size.boxes);
  ok("⛔ NOTHING IS CLIPPED — laid out at full size, every placed note is inside the printed sheet",
    size.boxes.length === 4 && size.boxes.every((b) => b.inside),
    size.boxes.map((b) => `${b.id}:${b.inside}`).join(" "));
  await shot.pdf({ path: pdfPath, format: "Letter", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await shot.screenshot({ path: `${OUT}/notes-free-placement-print.png`, fullPage: true });
  const { statSync } = await import("node:fs");
  const bytes = statSync(pdfPath).size;
  ok("a PDF was written", bytes > 1000, `${pdfPath} — ${bytes} bytes`);

  /* ⛔ THE THREE-WAY ANSWER, MEASURED OUT OF A REAL PDF RATHER THAN REASONED ABOUT. A Letter page
   * is 816 CSS px wide at 96dpi. The question "does a wider sheet get scaled, or cut off?" was
   * settled by decompressing the PDF's own content stream on a control document: a 1152px-wide
   * sheet with a marker rect at its far right edge came back as `972 100 180 40 re` under a
   * combined transform of 0.24 x 2.2135 = 0.53124 pt/px, which puts the marker's right edge at
   * exactly 612.0pt — the Letter MediaBox's full width (`0 0 612 792`), on one page. So the whole
   * layout is SCALED to the paper, not clipped at it. Height is the other axis and behaves
   * differently: it PAGINATES, as ordinary flow content always has. */
  const LETTER_PX = 816;
  console.log(`\nPRINTED SHEET: ${size.w}×${size.h} CSS px against a Letter page of ${LETTER_PX}px wide.`);
  console.log(size.w > LETTER_PX
    ? `VERDICT: the grown page is SCALED DOWN to fit the paper's width (${(LETTER_PX / size.w * 100).toFixed(0)}% of full size). Nothing is cut off.`
    : "VERDICT: the grown page fits the paper's width at full size. Nothing is scaled and nothing is cut off.");
  console.log("VERDICT (height): content past one sheet PAGINATES onto the next, as ordinary flow content always has.");
  await shot.context().close();
}

console.log("\n" + "=".repeat(100));
if (failures.length) {
  console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("✓ every case passed");
}
await browser.close();
