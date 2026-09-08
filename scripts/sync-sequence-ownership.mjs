#!/usr/bin/env node
// scripts/sync-sequence-ownership.mjs
//
// Inline the canonical schedule-ownership module (src/shared/schedule/scheduleOwnership.js) into
// the standalone scheduler page (public/sequence/index.html). The scheduler is a self-contained
// HTML file with in-browser Babel — it cannot `import` from src/ at runtime — so the module lives
// there as a verbatim copy between the SCHEDULE-OWNERSHIP markers. This script is the only writer
// of that copy.
//
// Same shape, and deliberately the same shape, as scripts/sync-sequence-formula.mjs: the shell
// (Scheduler.jsx's New-schedule modal and its per-project schedule list) and the embedded app
// (which owns the document and applies the migration on load) must agree on who owns a schedule
// BYTE FOR BYTE. Two hand-kept copies of "which schedules live under this project" is exactly the
// second implementation of a one-answer function that docs/DATA.md forbids.
//
// Usage:  node scripts/sync-sequence-ownership.mjs           (writes the HTML)
//         node scripts/sync-sequence-ownership.mjs --check    (exit 1 if out of sync)
//
// test/scheduleOwnership-inline-sync.test.js runs the same comparison so CI fails on drift.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src/shared/schedule/scheduleOwnership.js");
const HTML = resolve(ROOT, "public/sequence/index.html");
const START = "/* SCHEDULE-OWNERSHIP:START */";
const END = "/* SCHEDULE-OWNERSHIP:END */";

// Text strictly between the markers, normalised the same way the formula sync normalises it, so a
// trailing-whitespace-only difference can never be reported as drift.
export function ownershipBody(text, label) {
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error(`SCHEDULE-OWNERSHIP markers not found in ${label}`);
  return text.slice(i + START.length, j).replace(/^\n/, "").replace(/\n[ \t]*$/, "\n");
}

export function buildSyncedHtml(srcText, htmlText) {
  const body = ownershipBody(srcText, "source module");
  const i = htmlText.indexOf(START);
  const j = htmlText.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("SCHEDULE-OWNERSHIP markers not found in public/sequence/index.html");
  return `${htmlText.slice(0, i + START.length)}\n${body}${htmlText.slice(j)}`;
}

function main() {
  const check = process.argv.includes("--check");
  const srcText = readFileSync(SRC, "utf8");
  const htmlText = readFileSync(HTML, "utf8");
  const next = buildSyncedHtml(srcText, htmlText);
  if (next === htmlText) { console.log("✓ scheduler ownership module already in sync"); return; }
  if (check) { console.error("✗ scheduler ownership module is OUT OF SYNC — run: node scripts/sync-sequence-ownership.mjs"); process.exit(1); }
  writeFileSync(HTML, next);
  console.log("✓ inlined src/shared/schedule/scheduleOwnership.js into public/sequence/index.html");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
