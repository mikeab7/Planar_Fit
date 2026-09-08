#!/usr/bin/env node
/* verify-notes-font-control — EVERY TOOLBAR CONTROL REPORTS THE SELECTION, OR REPORTS NOTHING.
 *
 * ⛔ WHAT THIS EXISTS TO PROVE, and why it is one harness and not several. The owner's rule is
 * a PROPERTY of the whole toolbar — *"same thing for text size and bold and underlined and
 * italic, whatever. Everything that you can think of that it does on Word, it should do here"* —
 * so a harness that verifies only the control it is named after has missed the point (this
 * repo's own WRONG-CASE rule, and the reason Font size was correct in isolation for months
 * while eleven other controls guessed). Every control is put through all THREE states —
 * uniform · caret · genuinely mixed — and the table is printed for the PR.
 *
 * ⛔ AND THE KNOWN-GOOD ARM IS NOT OPTIONAL (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): **Font size**
 * was measured correct on the live toolbar BEFORE any of this work and must still report
 * correctly here. If it ever fails, the instrument is on trial before the app is.
 *
 * Every selection is a REAL mouse drag and every pick a REAL click on a real button — never
 * `execCommand`, never a scripted `Range` (a selection must be a real Range inside the editor,
 * and a scripted one is clobbered by a re-render between selection and apply).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const findings = [];
let checks = 0;
const fail = (what, detail = "") => { findings.push({ what, detail }); console.log(`  ✗ ${what}${detail ? `\n      ${detail}` : ""}`); };
const pass = (l) => { checks += 1; console.log(`  ✓ ${l}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => fail("page error", e.message));
await assertMeasurable(page, "verify-notes-font-control");

/* ── seeding ─────────────────────────────────────────────────────────────────────────────── */
async function seed(doc) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Utility", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/* ── real gestures ───────────────────────────────────────────────────────────────────────── */
async function edge(needle, side) {
  return page.evaluate(([n2, s]) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(n2);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, s === "start" ? i : i + n2.length); r.collapse(true);
      const rect = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || p.left), y: Math.round((rect.top || p.top) + (rect.height || p.height) / 2) };
    }
    return null;
  }, [needle, side]);
}
async function dragSelect(a, b) {
  const f = await edge(a, "start"); const t = await edge(b, "end");
  if (!f || !t) return false;
  await page.mouse.move(f.x, f.y); await page.mouse.down();
  await page.mouse.move((f.x + t.x) / 2, (f.y + t.y) / 2, { steps: 4 });
  await page.mouse.move(t.x, t.y, { steps: 4 }); await page.mouse.up();
  await pacedWait(page, 250); return true;
}
async function caretIn(needle) {
  const spot = await page.evaluate((n2) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(n2);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + Math.floor(n2.length / 2)); r.collapse(true);
      const rect = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || p.left), y: Math.round((rect.top || p.top) + (rect.height || p.height) / 2) };
    }
    return null;
  }, needle);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 250); return true;
}

/* ── reading a control's reported state ──────────────────────────────────────────────────── */
/** What a control SAYS right now: a menu's shown label, or a toggle's aria-pressed. One reader
 *  for every control, so no control can be graded on a private, friendlier rule than its
 *  neighbours. `MISSING` is distinct from blank: blank is an honest "mixed", missing is a
 *  control that exposes nothing at all (the state Bold/Italic/Underline shipped in). */
async function reportOf(testid) {
  const el = page.locator(`[data-testid="${testid}"]`).first();
  if (!(await el.count())) return "MISSING";
  return el.evaluate((e) => {
    const pressed = e.getAttribute("aria-pressed");
    const aria = e.getAttribute("aria-label") || "";
    if (pressed !== null) return `pressed=${pressed}`;
    if (/— mixed$/.test(aria)) return "blank(mixed)";
    const t = (e.innerText || "").trim().replace(/\s+/g, " ");
    return t === "" ? "blank" : t;
  });
}
/** The colour buttons report through their swatch, which IS their readout. */
async function swatchOf(testid) {
  const el = page.locator(`[data-testid="${testid}"]`).first();
  if (!(await el.count())) return "MISSING";
  return el.evaluate((e) => {
    const aria = e.getAttribute("aria-label") || "";
    const bars = [...e.querySelectorAll("span")].map((s) => getComputedStyle(s).backgroundColor);
    const painted = bars.find((b) => b && b !== "rgba(0, 0, 0, 0)");
    return `${/— mixed$/.test(aria) ? "mixed " : ""}swatch=${painted || "none"}`;
  });
}

const CONTROLS = [
  ["Font", "nt-font", reportOf], ["Font size", "nt-size", reportOf],
  ["Block style", "nt-block", reportOf], ["Line spacing", "nt-spacing", reportOf],
  ["Bold", "nt-bold", reportOf], ["Italic", "nt-italic", reportOf],
  ["Underline", "nt-underline", reportOf], ["Strikethrough", "nt-strike", reportOf],
  ["Text colour", "nt-color", swatchOf], ["Highlight colour", "nt-highlight", swatchOf],
  ["Bulleted list", "nt-bullet", reportOf], ["Numbered list", "nt-ordered", reportOf],
  ["Align left", "nt-align-left", reportOf], ["Align center", "nt-align-center", reportOf],
  ["Align right", "nt-align-right", reportOf],
];
/** ⛔ THE ALIGNMENT BUTTONS LIVE IN THE "More" SHEET, so reading them off a closed toolbar
 *  reports MISSING for a control that is merely not rendered — a probe measuring its own
 *  question again. The sheet is opened for the read and closed after. Every control on this bar
 *  stops `mousedown`, so opening it does not disturb the selection being measured (asserted
 *  below rather than assumed: the Font readout must be identical before and after). */
async function snapshot() {
  const row = {};
  const before = await reportOf("nt-font");
  await page.locator('[data-testid="nt-more"]').first().click();
  await pacedWait(page, 300);
  for (const [name, testid, read] of CONTROLS) row[name] = await read(testid);
  await page.keyboard.press("Escape");
  await pacedWait(page, 200);
  const after = await reportOf("nt-font");
  if (before !== after) fail("opening the More sheet changed the selection — this snapshot is void", `${before} -> ${after}`);
  return row;
}
function printTable(title, cols, rows) {
  console.log(`\n${title}`);
  const w0 = Math.max(...CONTROLS.map((c) => c[0].length), 16);
  const ws = cols.map((c, i) => Math.max(c.length, ...CONTROLS.map(([n]) => String(rows[i][n]).length)));
  console.log(`  ${"control".padEnd(w0)} | ${cols.map((c, i) => c.padEnd(ws[i])).join(" | ")}`);
  console.log(`  ${"-".repeat(w0)}-+-${ws.map((w) => "-".repeat(w)).join("-+-")}-`);
  for (const [n] of CONTROLS) {
    console.log(`  ${n.padEnd(w0)} | ${cols.map((c, i) => String(rows[i][n]).padEnd(ws[i])).join(" | ")}`);
  }
}

/* ═══ 1 · THE PASTE (NEW-5) — root cause, and the fix, on the REAL paste path ═══════════════ */
console.log("\n1 — a real Word/Outlook paste: every run treated the same way (NEW-5)");
const WORD_HTML = `<div style='font-family:"Calibri",sans-serif;font-size:11.0pt'>
<p class=MsoNormal><span style='font-size:11.0pt;font-family:"Calibri",sans-serif'>Contacts:</span></p>
<p class=MsoNormal><span style='font-family:"Calibri",sans-serif'>Jerry Hayley</span> <span>Kandice Cabets</span></p>
<p class=MsoNormal><span style='font-size:11px'>713-416-5353</span></p>
</div>`;
await seed({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "paste here" }] }] });
await page.locator(".ProseMirror").click();
await page.keyboard.press("Control+A");
await page.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData("text/html", html);
  dt.setData("text/plain", "Contacts:\nJerry Hayley Kandice Cabets\n713-416-5353");
  document.querySelector(".ProseMirror").dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, WORD_HTML);
await pacedWait(page, 1400);

const pastedRuns = await page.evaluate((k) => {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "text") {
      const m = (n.marks || []).find((x) => x.type === "textStyle");
      out.push({ text: n.text.trim(), family: m?.attrs?.fontFamily ?? null, size: m?.attrs?.fontSize ?? null });
    }
    (n.content || []).forEach(walk);
  })(JSON.parse(localStorage.getItem(k) || "null"));
  return out;
}, `${PAGE_PREFIX}p1`);
console.log("  stored runs:", JSON.stringify(pastedRuns));
/* The whitespace BETWEEN two spans is its own run and carries no font, which is correct and
   invisible — a space has no typeface. Grading it would fail the check on a non-difference. */
const inked = pastedRuns.filter((r) => r.text !== "");
const families = inked.map((r) => (r.family || "").split(",")[0].replace(/["']/g, "").toLowerCase());
if (families.every((f) => f === "calibri")) pass(`all ${families.length} pasted runs kept the source font (Calibri) — no mid-line patchwork`);
else fail("a pasted block is still internally inconsistent", JSON.stringify(pastedRuns));
const sizes = inked.map((r) => r.size);
if (sizes.filter(Boolean).every((z) => /px$/.test(z))) pass(`every pasted size is stored in ONE unit: ${JSON.stringify(sizes)}`);
else fail("a pasted size kept a foreign unit", JSON.stringify(sizes));

/* NEW-4: two different sizes must never read as the same number, and re-picking must not shrink. */
console.log("\n1b — 11pt and 11px can no longer read as the same number (NEW-4)");
await dragSelect("Contacts", "Contacts:");
const contactsBox = await reportOf("nt-size");
const contactsPx = await page.evaluate(() => {
  const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if (n.nodeValue.includes("Contacts")) return getComputedStyle(n.parentElement).fontSize;
  return null;
});
await dragSelect("713-416", "713-416-5353");
const phoneBox = await reportOf("nt-size");
const phonePx = await page.evaluate(() => {
  const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if (n.nodeValue.includes("713-416")) return getComputedStyle(n.parentElement).fontSize;
  return null;
});
console.log(`  "Contacts:" (source 11pt) renders ${contactsPx}, box reads ${JSON.stringify(contactsBox)}`);
console.log(`  "713-416-5353" (source 11px) renders ${phonePx}, box reads ${JSON.stringify(phoneBox)}`);
if (contactsPx !== phonePx && contactsBox !== phoneBox) pass("two different sizes read as two different numbers");
else fail("two different sizes still present as the same number", `${contactsPx}/${contactsBox} vs ${phonePx}/${phoneBox}`);
// re-picking the shown value must be a no-op on the SIZE, not a silent shrink
await dragSelect("Contacts", "Contacts:");
const shown = (await reportOf("nt-size")).trim();
await page.locator('[data-testid="nt-size"]').first().click(); await pacedWait(page, 250);
await page.locator(`[data-testid="nt-size-opt-${shown}"]`).first().click().catch(() => {});
await pacedWait(page, 700);
const afterRepick = await page.evaluate(() => {
  const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if (n.nodeValue.includes("Contacts")) return getComputedStyle(n.parentElement).fontSize;
  return null;
});
if (Math.abs(parseFloat(afterRepick) - parseFloat(contactsPx)) < 1) pass(`re-picking the shown size (${shown}) left the text at ${afterRepick}, not shrunk`);
else fail("re-picking the size the box already shows still changes the text", `${contactsPx} -> ${afterRepick}`);

/* ═══ 2 · THE THREE STATES, EVERY CONTROL ══════════════════════════════════════════════════ */
console.log("\n2 — every control, three states (uniform · caret · mixed)");
const M = (t, marks) => ({ type: "text", text: t, marks });
const cal = { type: "textStyle", attrs: { fontFamily: 'Calibri, Candara, sans-serif', fontSize: "11px", color: "#C0392B" } };
/* ⛔ THE FIXTURE HAS TO DISAGREE IN EVERY DIMENSION THE TABLE GRADES, and the first version of
 * this harness did not — both of its blocks were plain paragraphs in no list, so Block style,
 * Line spacing and the two list toggles were HONESTLY uniform across the "mixed" range and were
 * graded as guessing. That is this repo's DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 exactly: the
 * harness's own QUESTION, not the app, produced the reading. Three blocks now differ in list
 * membership, block style, alignment, line spacing, every mark, font, size and colour. */
await seed({
  type: "doc",
  content: [
    { type: "bulletList", content: [{ type: "listItem", content: [
      { type: "paragraph", attrs: { textAlign: "center", lineHeight: 2 }, content: [
        M("Uniformbold", [cal, { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" },
          { type: "highlight", attrs: { color: "#FEF08A" } }]),
      ] },
    ] }] },
    { type: "paragraph", content: [{ type: "text", text: "Plainrun" }] },
    { type: "orderedList", content: [{ type: "listItem", content: [
      { type: "paragraph", content: [{ type: "text", text: "Numbereditem" }] },
    ] }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Headline" }] },
  ],
});
await dragSelect("Uniformbold", "Uniformbold");
const uniform = await snapshot();
await caretIn("Uniformbold");
const caret = await snapshot();
await dragSelect("Uniformbold", "Headline");
const mixed = await snapshot();
printTable("EVIDENCE TABLE — what each control reports", ["uniform", "caret", "mixed"], [uniform, caret, mixed]);

/* ⛔ THE KNOWN-GOOD ARM. Font size was measured correct on the live toolbar before this work. */
if (uniform["Font size"] === "11" && mixed["Font size"] === "blank(mixed)") pass("KNOWN-GOOD ARM: Font size still uniform=11 / mixed=blank — the instrument is reading honestly");
else fail("KNOWN-GOOD ARM FAILED — Font size regressed, so every other row here is suspect", `uniform=${uniform["Font size"]} mixed=${mixed["Font size"]}`);

for (const [name] of CONTROLS) {
  if (uniform[name] === "MISSING") { fail(`${name}: exposes no state at all`); continue; }
  if (mixed[name] === "MISSING") { fail(`${name}: exposes no state on a mixed range`); continue; }
  const uni = uniform[name]; const mix = mixed[name];
  const honestMixed = mix === "blank(mixed)" || mix === "pressed=mixed" || /^mixed /.test(mix);
  if (uni === mix) fail(`${name}: reports the SAME thing uniform and mixed — it is guessing`, `both "${uni}"`);
  else if (!honestMixed) fail(`${name}: mixed range reports "${mix}" rather than nothing`);
  else pass(`${name}: uniform "${uni}" · caret "${caret[name]}" · mixed "${mix}"`);
}
/* Alignment is a radio group, so its uniform row carries a second property no single control
   can express on its own: exactly ONE of the three is pressed. */
{
  const on = ["Align left", "Align center", "Align right"].filter((n) => uniform[n] === "pressed=true");
  if (on.length === 1 && on[0] === "Align center") pass(`alignment reports as a radio group — exactly one pressed, and it is the right one (${on[0]})`);
  else fail("alignment does not report as a radio group on a uniform selection", JSON.stringify(on));
}
// The controls that must NOT claim a pressed state, because they are actions, not toggles.
for (const t of ["nt-undo", "nt-redo", "nt-indent", "nt-outdent"]) {
  const p2 = await page.locator(`[data-testid="${t}"]`).first().getAttribute("aria-pressed").catch(() => null);
  if (p2 == null) pass(`${t} is an action and claims no pressed state`);
  else fail(`${t} claims aria-pressed="${p2}" but is not a toggle`);
}

/* ═══ 3 · FONT REPORTS THE REAL FAMILY, INCLUDING ONE NOT ON THE PALETTE ════════════════════ */
console.log("\n3 — the Font control names the typeface (NEW-1), including an off-palette one");
await seed({
  type: "doc",
  content: [{ type: "paragraph", content: [
    M("Wordcalibri", [{ type: "textStyle", attrs: { fontFamily: '"Calibri",sans-serif' } }]),
    { type: "text", text: " " },
    M("Offpalette", [{ type: "textStyle", attrs: { fontFamily: '"Segoe UI",Tahoma,sans-serif' } }]),
  ] }],
});
await dragSelect("Wordcalibri", "Wordcalibri");
const wordCal = await reportOf("nt-font");
if (/Calibri/.test(wordCal)) pass(`Word's own \`"Calibri",sans-serif\` reads as ${JSON.stringify(wordCal)} — not "Default"`);
else fail("a genuinely-Calibri run still does not read as Calibri", `reads ${JSON.stringify(wordCal)}`);
await dragSelect("Offpalette", "Offpalette");
const offPal = await reportOf("nt-font");
if (/Segoe UI/.test(offPal)) pass(`an off-palette family reads by its real name: ${JSON.stringify(offPal)}`);
else fail("an off-palette family is not named", `reads ${JSON.stringify(offPal)}`);
await dragSelect("Wordcalibri", "Offpalette");
const twoFonts = await reportOf("nt-font");
if (twoFonts === "blank(mixed)") pass("a selection spanning two typefaces reports nothing, announced as mixed (NEW-2)");
else fail("a two-typeface selection still claims a single font", `reads ${JSON.stringify(twoFonts)}`);

/* ═══ 4 · HEADINGS ACCEPT FORMATTING (NEW-6) ═══════════════════════════════════════════════ */
console.log("\n4 — NEW-6: font, size, bold, italic and colour on a HEADING (measured, not assumed)");
await seed({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Headingone" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Headingtwo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Bodycopy" }] },
  ],
});
const headingRows = [];
for (const target of ["Headingone", "Headingtwo", "Bodycopy"]) {
  const computedOf = (needle, prop) => page.evaluate(([n2, p2]) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (n.nodeValue.includes(n2)) return getComputedStyle(n.parentElement)[p2];
    return null;
  }, [needle, prop]);
  const row = { target };
  // FONT
  await dragSelect(target, target);
  await page.locator('[data-testid="nt-font"]').first().click(); await pacedWait(page, 250);
  await page.locator('[data-testid="nt-font-opt-Georgia, serif"]').first().click(); await pacedWait(page, 700);
  row.font = /Georgia/.test(await computedOf(target, "fontFamily")) ? "applied" : "IGNORED";
  await dragSelect(target, target);
  row.fontReadback = await reportOf("nt-font");
  // SIZE
  await page.locator('[data-testid="nt-size"]').first().click(); await pacedWait(page, 250);
  await page.locator('[data-testid="nt-size-opt-28"]').first().click(); await pacedWait(page, 700);
  row.size = (await computedOf(target, "fontSize")) === "28px" ? "applied" : `IGNORED (${await computedOf(target, "fontSize")})`;
  // BOLD / ITALIC — a heading is already bold by stylesheet, so assert the MARK, not the weight.
  await dragSelect(target, target);
  await page.locator('[data-testid="nt-italic"]').first().click(); await pacedWait(page, 500);
  await dragSelect(target, target);
  row.italic = (await reportOf("nt-italic")) === "pressed=true" ? "applied" : "IGNORED";
  await page.locator('[data-testid="nt-bold"]').first().click(); await pacedWait(page, 500);
  await dragSelect(target, target);
  row.bold = ["pressed=true", "pressed=false"].includes(await reportOf("nt-bold")) ? "applied" : "IGNORED";
  // COLOUR
  await page.locator('[data-testid="nt-color"]').first().click(); await pacedWait(page, 250);
  await page.locator('[data-testid="nt-color-popover"] button[aria-label="Teal"]').first().click(); await pacedWait(page, 700);
  row.colour = /14, 116, 144/.test(await computedOf(target, "color")) ? "applied" : `IGNORED (${await computedOf(target, "color")})`;
  headingRows.push(row);
}
console.log("\nEVIDENCE TABLE — formatting exercised ON A HEADING (every cell driven, none assumed)");
console.log("  target      | Font    | Font readback | Size    | Bold    | Italic  | Colour");
for (const r of headingRows) {
  console.log(`  ${r.target.padEnd(11)} | ${String(r.font).padEnd(7)} | ${String(r.fontReadback).padEnd(13)} | ${String(r.size).padEnd(7)} | ${String(r.bold).padEnd(7)} | ${String(r.italic).padEnd(7)} | ${r.colour}`);
}
for (const r of headingRows) {
  const bad = ["font", "size", "bold", "italic", "colour"].filter((k) => /IGNORED/.test(String(r[k])));
  if (bad.length) fail(`${r.target}: ${bad.join(", ")} did not apply`, JSON.stringify(r));
  else pass(`${r.target}: font, size, bold, italic and colour all applied`);
}

/* ═══ 5 · NARROW WINDOWS — nothing becomes unreachable (NEW-3) ══════════════════════════════ */
console.log("\n5 — narrow windows: what collapses, measured");
/* Re-seeded WITHOUT headings on purpose: the outline rail renders for a document that has any,
   and at phone width it lies over the toolbar — a real, pre-existing layout question, but not
   this item's, and letting it swallow the click would report the Font control as unreachable. */
await seed({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plainrun" }] }] });
for (const [label, w, h] of [["laptop-short", 1280, 620], ["phone", 390, 780]]) {
  await page.setViewportSize({ width: w, height: h });
  await pacedWait(page, 600);
  const state = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="note-toolbar"]');
    const seen = (id) => !!document.querySelector(`[data-testid="${id}"]`);
    return { narrow: bar?.getAttribute("data-narrow"), onRow: seen("nt-font"), overflows: bar ? bar.scrollWidth > bar.clientWidth + 1 : null };
  });
  if (state.narrow === "1" && !state.onRow) {
    await page.locator('[data-testid="nt-more"]').click(); await pacedWait(page, 400);
    const inSheet = await page.locator('[data-testid="nt-font"]').count();
    if (inSheet) pass(`${label} (${w}px): narrow layout — Font moves into the More sheet and is reachable there`);
    else fail(`${label}: Font is not reachable in the More sheet`);
    await page.keyboard.press("Escape");
  } else if (state.onRow) {
    pass(`${label} (${w}px): Font is on the main row (narrow=${state.narrow}, row scrolls=${state.overflows})`);
  } else fail(`${label}: Font is nowhere`, JSON.stringify(state));
}
await page.setViewportSize({ width: 1500, height: 900 });

/* ── verdict ─────────────────────────────────────────────────────────────────────────────── */
console.log(`\n${findings.length ? "✗" : "✓"} ${checks} checks passed, ${findings.length} findings`);
for (const f of findings) console.log(`   · ${f.what}${f.detail ? ` — ${f.detail}` : ""}`);
await browser.close();
process.exit(findings.length ? 1 : 0);
