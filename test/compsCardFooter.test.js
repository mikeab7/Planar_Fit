/* DEFECT 4 (adversarial review of PR #1564, 2026-09-08) — the Comps card's footer printed TWO
 * CONTRADICTORY SENTENCES in one panel. With a single peer on Michael's real account it rendered
 * the heading "Against your last 1 in Harris County, TX" and, directly beneath it, "Not enough
 * comps in Harris County, TX yet to compare — this one stands alone." One says a comparison is
 * being drawn; the next says there is nothing to compare against. Reproduce the source reading with
 * `npx vite-node ui-audit/review-2026-09-08/probe-comps-production-rows.mjs`.
 *
 * The model half of the card is covered by `compsCardModel.test.js`; this file exists because the
 * contradiction lived in the JSX, where no model test could see it. It renders the real component
 * through react-dom/server — the same no-DOM idiom `compsPanelLocation.test.js` uses. The address
 * hook's network branch never runs under SSR (useEffect doesn't fire), so what's asserted here is
 * the synchronous fallback exactly as that file documents.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompsCard from "../src/workspaces/dashboard/components/CompsCard.jsx";
import { buildCompsCardData, MIN_PEERS_FOR_SCALE } from "../src/workspaces/dashboard/lib/compsCardModel.js";

const lease = (id, { rate = 6, createdAt = "2026-09-01", county = "harris", sf = 600000, basis = "nnn" } = {}) => ({
  id, compType: "lease", createdAt, anchor: { kind: "pin", county, lat: 29.9, lon: -95.2 },
  leaseRate: rate, leaseRatePeriod: "annual", leaseRateExpense: basis, leaseSizeSf: sf,
});

const render = (comps) => renderToStaticMarkup(createElement(CompsCard, { data: buildCompsCardData(comps) }));

/** The heading is a CLAIM that a comparison is being drawn — its presence is the thing under test,
 * so match its distinctive wording rather than the whole line (the peer count varies). */
const HEADING = /Against your last/;
const STANDS_ALONE = /stands alone|not enough to place/i;

describe("CompsCard footer: one statement, never two contradictory ones", () => {
  it("with no peers: the stands-alone line ONLY — no comparison heading, no scale", () => {
    const html = render([lease("f", { createdAt: "2026-09-08" })]);
    expect(html).toMatch(/No comparable comps in Harris County, TX yet — this one stands alone\./);
    expect(html).not.toMatch(HEADING);
    expect(html).not.toMatch(/<svg/);
  });

  it("with one peer — Michael's real account — the heading is GONE, not printed above a denial", () => {
    const html = render([lease("f", { createdAt: "2026-09-08" }), lease("p1", { createdAt: "2026-09-01" })]);
    expect(html).toMatch(/Only one other comparable comp in Harris County, TX yet/);
    expect(html).not.toMatch(HEADING);
    expect(html).not.toMatch(/<svg/);
  });

  it("with two peers — still below the minimum — still one line and no scale", () => {
    const html = render(["f", "p1", "p2"].map((id, i) => lease(id, { createdAt: `2026-09-0${8 - i}` })));
    expect(html).toMatch(/Only 2 other comparable comps in Harris County, TX yet/);
    expect(html).not.toMatch(HEADING);
    expect(html).not.toMatch(/<svg/);
  });

  it("at the minimum: the heading and the scale appear, and the denial does NOT", () => {
    const comps = ["f", "p1", "p2", "p3"].map((id, i) => lease(id, { rate: 6 + i, createdAt: `2026-09-0${8 - i}` }));
    const html = render(comps);
    expect(comps.length - 1).toBe(MIN_PEERS_FOR_SCALE);
    expect(html).toMatch(/Against your last 3 in Harris County, TX/);
    expect(html).toMatch(/<svg/);
    expect(html).not.toMatch(STANDS_ALONE);
  });

  it("a comp with no recorded rate says so once, and draws nothing", () => {
    const html = render([{ ...lease("f", { createdAt: "2026-09-08" }), leaseRate: null }]);
    expect(html).toMatch(/rate isn&#x27;t recorded yet/); // react-dom escapes the apostrophe
    expect(html).not.toMatch(HEADING);
    expect(html).not.toMatch(/<svg/);
  });

  it("the excluded note names the real reason — a gross peer held out of an NNN scale", () => {
    const html = render([
      lease("f", { createdAt: "2026-09-08" }),
      lease("g1", { createdAt: "2026-09-01", basis: "gross" }),
    ]);
    expect(html).toMatch(/1 nearby comp excluded — not quoted NNN\./);
  });
});
