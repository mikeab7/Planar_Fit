# Adversarial review probes — the four Dashboard cards (2026-09-08)

Reproducible evidence for the adversarial review of PR #1561 (Locations map), #1562 (Recent
plans), #1563 (Since you were last here) and #1564 (Comps).

**These are probes, not gates.** They print findings; they do not assert. Nothing here runs in CI.
(The one exception to "nothing here is a gate" is that a probe's finding, once fixed, gets a real
guard in `test/` — B1376672's is `test/countyStateQualifier.test.js`, which DOES run in CI.)
They exist so every claim in the review can be re-derived by someone who doubts it, rather than
taken on a session's word — the same reason `docs/AGENT-RULES.md` exists.

Run any of them with `npx vite-node ui-audit/review-2026-09-08/<file>`. They import the real
shipped modules; they mock nothing. Paths inside are absolute (`/home/user/planyr/...`) because
they were written against the review sandbox — adjust if your checkout lives elsewhere.

| Probe | What it asks | What it found |
| --- | --- | --- |
| `probe-comps-production-rows.mjs` | Run Michael's four real production comps through `buildCompsCardData` | Featured comp renders `$0.64 /SF/yr` (recorded `annual` where every sibling is `monthly`); footer prints "Against your last 1 in Harris County, TX" directly above "this one stands alone" |
| `probe-comps-peer-set.mjs` | Does the peer set separate NNN from gross, and normalize land units? Do the sentence and the dots agree? | No to all three. NNN vs GROSS share one scale; land comps in acres and in SF share one scale (43,560× apart, producing "$129996.90 above the median"); four tied rates report as "the highest of the four" |
| `probe-feed-month-away.mjs` | A returning user gone a month — which rows survive the 12-row cap? | 17 events derived, 12 shown, and all 3 schedule events land in the hidden 5. Schedule rows are stamped at the window *start*, so they sort last and are cut first, every time. **✅ FIXED — B1373536; re-run now shows 3 of 3 surviving** |
| `probe-thumbnail-size.mjs` | How large can a plan thumbnail get, and are values escaped into the SVG? | No cap: 300 shapes × 40 vertices → ~185 KB; 600 × 40 → ~380 KB. A quote character in a parcel stroke breaks out of its attribute (rendering corruption, not XSS — the SVG is shown via `<img>`) . **✅ FIXED — B1373536; re-run now caps at 19.4 KB and escapes the injection** |
| `probe-county-label.mjs` | Does `compsCardModel.countyLabel` agree with the county registry? | Agrees for all 18 configured keys today. The exposure is upstream: `MapFinder.resolveCompCounty` calls `countyKeyForName(name)` with **no state**, so a point in Montgomery County PA / Liberty County GA / Chambers County AL resolves to the Texas key and prints "…County, TX" |
| `probe-comp-county-state.mjs` | **FIXED — B1376672.** Follows the finding above one level up: which key does a point actually get, end to end, through the real national county geometry? | Reproduced 4 of 4 (Norristown PA, Hinesville GA, Lanett AL, Hamilton GA all took a Texas key), and caught a second half nobody had noticed — a Denver point took **no** county at all. Both fixed by passing the state at all five call sites; the probe now prints the before/after columns side by side and its known-good arms hold |

## Two findings that need no probe — BOTH RESOLVED after filing

> **Status, 2026-09-08 20:39Z.** PR #1564 pushed a merge of `main` (`10a4368`) that resolved both
> of the findings below. Re-verified directly against its head, not inferred from the diff:
> `git grep fetchCompsCounts` on that branch returns nothing (no caller remains), and
> `push("totalRent"` is absent from `shared/comps/lib/comps.js` (the owner's removal survived).
> They were true when measured and are kept here as the record — the *pattern* is what matters:
> when one branch rewrites a shared file that another branch's already-merged code depends on,
> git has nothing to flag, and building the merge is the only way to see it.
>
> PR #1563 is still merge-conflicted against `main` and cannot land unattended.
>
> **Update, 2026-09-08 (B1373536).** #1563's seven conflicts are now resolved on
> `claude/dashboard-card-defects-jq1nai`, which carries the feed fix on top of them — the feed
> defect lives in a file that exists nowhere else, so there was no way to fix it without landing
> that branch. That PR supersedes #1563. Its resolution of `Dashboard.jsx` drops the
> `fetchCompsCounts` import, which is finding 1 above arriving exactly as predicted.

1. **Merging #1564 breaks the build.** Its branch rewrote `dashboard/lib/dashboardCompsFetch.js`,
   dropping `fetchCompsCounts` — which `Dashboard.jsx` on `main` imports and calls for the merged
   map/pipeline cards. Only one side changed that file, so git auto-merges it with no conflict; the
   failure surfaces only at build time:
   `"fetchCompsCounts" is not exported by ".../dashboardCompsFetch.js"`.
   Reproduce: merge `origin/main` and `origin/claude/comps-dashboard-card-tfkaym`, resolve the
   `Dashboard.jsx` conflict, `npm run build`.
2. **#1564's merge base predates #1559**, so its side of `shared/comps/lib/comps.js` still carries
   the "Total annual rent (face)" row the owner had removed that same day. Taking "the newer
   branch" on that conflict silently reverts an owner instruction.

## What was NOT verified

This sandbox cannot sign in (the proxy blocks the Supabase auth handshake — the standing
`Blocker: auth`). Unverified: the reverse-geocoded address on the Comps card, drag/resize
smoothness and topo-background drift with all ten cards *populated*, and real phone hardware.
The database reconciliation was done by reading `planyr_production` directly (read-only).

`probe-comps-production-rows.mjs` embeds four real comp records verbatim, because the headline
finding only reproduces with the real values.
