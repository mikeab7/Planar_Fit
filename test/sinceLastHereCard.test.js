import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SinceLastHereCard } from "../src/workspaces/dashboard/components/SinceLastHereCard.jsx";
import { buildSinceLastHereFeed } from "../src/workspaces/dashboard/lib/sinceLastHereFeed.js";

const DAY = 86400000;
const NOW = new Date(2026, 8, 8, 12, 0, 0).getTime();

// `renderToStaticMarkup` never runs effects/handlers — this checks what actually PAINTS, the same
// technique test/dashboardCardGrowth.test.js already uses for this same workspace.
describe("SinceLastHereCard — rendering", () => {
  it("shows the calm empty-state line when nothing happened", () => {
    const feed = buildSinceLastHereFeed({ now: NOW, lastVisitAt: NOW - 2 * DAY });
    const html = renderToStaticMarkup(createElement(SinceLastHereCard, { feed, now: NOW }));
    expect(html).toMatch(/Nothing happened since your last visit\./);
  });

  it("bolds the noun, and renders the sub-line and a short-form age", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Grand Port South", county: "Waller", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed({ now: NOW, lastVisitAt: NOW - 2 * DAY, sites, buildingCountBySite: { s1: 14 }, sqftBySite: { s1: 412000 } });
    const html = renderToStaticMarkup(createElement(SinceLastHereCard, { feed, now: NOW }));
    expect(html).toMatch(/<b[^>]*>Grand Port South<\/b>/);
    expect(html).toMatch(/14 buildings/);
    expect(html).toMatch(/412,000 SF/);
    expect(html).toMatch(/>1d</); // shortAge(now - 1 day)
  });

  it("groups rows under uppercase day dividers once the feed spans more than one day", () => {
    const sites = [
      { id: "s1", group_id: "g1", site: "Today Plan", county: "Harris", status: "pursuit", created_at: new Date(NOW - 3600000).toISOString(), updated_at: new Date(NOW - 3600000).toISOString() },
      { id: "s2", group_id: "g2", site: "Yesterday Plan", county: "Harris", status: "pursuit", created_at: new Date(NOW - DAY - 3600000).toISOString(), updated_at: new Date(NOW - DAY - 3600000).toISOString() },
    ];
    const feed = buildSinceLastHereFeed({ now: NOW, lastVisitAt: NOW - 3 * DAY, sites });
    const html = renderToStaticMarkup(createElement(SinceLastHereCard, { feed, now: NOW }));
    expect(html).toMatch(/TODAY/);
    expect(html).toMatch(/YESTERDAY/);
  });

  it("does NOT render day dividers when every row falls on the same day", () => {
    const sites = [
      { id: "s1", group_id: "g1", site: "Plan A", county: "Harris", status: "pursuit", created_at: new Date(NOW - 3600000).toISOString(), updated_at: new Date(NOW - 3600000).toISOString() },
      { id: "s2", group_id: "g2", site: "Plan B", county: "Harris", status: "pursuit", created_at: new Date(NOW - 7200000).toISOString(), updated_at: new Date(NOW - 7200000).toISOString() },
    ];
    const feed = buildSinceLastHereFeed({ now: NOW, lastVisitAt: NOW - 3 * DAY, sites });
    const html = renderToStaticMarkup(createElement(SinceLastHereCard, { feed, now: NOW }));
    expect(html).not.toMatch(/TODAY/);
  });

  it("reports the overflow count when the feed is capped", () => {
    const comps = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`, title: `Comp ${i}`, compType: "land", landPrice: 100000, landSizeValue: 5, landSizeUnit: "ac",
      createdAt: new Date(NOW - (i + 1) * 3600000).toISOString(), projectId: "s1",
    }));
    const feed = buildSinceLastHereFeed({ now: NOW, lastVisitAt: NOW - 2 * DAY, comps });
    const html = renderToStaticMarkup(createElement(SinceLastHereCard, { feed, now: NOW }));
    expect(html).toMatch(/\+3 more since your last visit/);
  });
});
