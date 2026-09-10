/* CompsCard — the Dashboard's Comps card (NEW-COMPS-CARD, replacing the old bare-count card).
 * Shows the most recently ADDED comp, placed against its real peers, instead of a count that reads
 * the same every morning. Pure presentational component: `data` is `compsCardModel.js`'s
 * `buildCompsCardData(comps)` result, computed once in Dashboard.jsx's own `cardData` useMemo —
 * every other Dashboard card follows the same "derivation happens before this renders" rule
 * (DashboardCards.jsx's own header). The one exception is the featured comp's resolved street
 * address, which is inherently asynchronous (a reverse-geocode network call) and belongs to
 * PRESENTATION, not data derivation — that lives in `useCompAddress` below, mirroring
 * shared/comps/components/CompsPanel.jsx's own `useCompLocationText` hook exactly (a deliberately
 * separate, self-contained resolver — this card is not kept alive between Dashboard visits, so
 * there's no reason to share a persistent cache with the comps panel).
 *
 * ⛔ The reverse-geocode call reaches external hosts (geocode.arcgis.com / nominatim.openstreetmap.org)
 * this sandbox's egress blocks — see `site-planner/lib/geocode.js`'s own header. That path is
 * therefore a LIVE-VERIFY item (VERIFICATION.md), same as every other GIS network call in this
 * repo; the synchronous fallback (county name, or coordinates) is what's verified here and is
 * never wrong, just less specific.
 */
import { useEffect, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import Chip from "../../../shared/ui/Chip.jsx";
import { pinFallbackText, siteplanLocationText } from "../../../shared/comps/lib/compLocationText.js";
import {
  TYPE_LABEL, compSizeSf, relativeTimeLabel, countyEntry, compScaleLayout, MIN_PEERS_FOR_SCALE,
  formatRateValue as fmtRateValue,
} from "../lib/compsCardModel.js";

const MUTED = { fontSize: 12, color: "var(--text-secondary)" };
const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const UPPER_LABEL = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" };

/* PeriodToggle — the small, quiet "per year / per month" switch (NEW-COMPS-CARD, the period
 * toggle). Flipping it is what re-normalizes the featured rate, the peer scale, both tick labels
 * and the sentence underneath all together — the toggle itself carries none of that logic; it
 * just reports the chosen period up to `onChangePeriod`, and everything downstream already reads
 * off `period` (see compsCardModel.js's header). `onChangePeriod` is optional so an embedding that
 * hasn't wired persistence yet still renders (no toggle shown, current behavior unchanged).
 * MODULE-SCOPE-COMPONENTS: defined here, not inside CompsCard's render body.
 * The whole card is one big `onClick`/`onKeyDown` button (opens the comp) — every event here is
 * stopped from bubbling so a press on the toggle can never also open the comp underneath it. */
function PeriodToggle({ period, onChangePeriod }) {
  if (!onChangePeriod) return null;
  const stop = (e) => { e.stopPropagation(); };
  const seg = (key, label) => {
    const active = period === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={(e) => { e.stopPropagation(); if (!active) onChangePeriod(key); }}
        style={{
          border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
          fontSize: 10.5, fontWeight: active ? 700 : 500, padding: "2px 4px", borderRadius: RADIUS.sm,
          color: active ? "var(--accent)" : "var(--text-secondary)",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      role="group" aria-label="Rate period"
      onClick={stop} onKeyDown={stop}
      style={{ display: "flex", alignItems: "center", gap: 1, flex: "none" }}
    >
      {seg("annual", "per year")}
      <span aria-hidden="true" style={{ color: "var(--text-tertiary)", fontSize: 10 }}>·</span>
      {seg("monthly", "per month")}
    </div>
  );
}

/** The featured comp's address — the synchronous fallback (county name, or a site-plan's own
 * title) immediately, upgraded to a real reverse-geocoded street address once that resolves (pin
 * and parcel anchors both resolve the same way — B1149586's own fix, mirrored here rather than
 * showing a bare APN). `geocode.js` is dynamically imported so the Dashboard's own bundle — loaded
 * on every visit — never statically pulls in the Site Planner workspace's code for this one call. */
function useCompAddress(comp) {
  const anchor = comp?.anchor || null;
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    setResolved(null);
    if (!anchor || (anchor.kind !== "pin" && anchor.kind !== "parcel")) return undefined;
    let live = true;
    import("../../site-planner/lib/geocode.js")
      .then(({ reverseGeocodeLatLon }) => reverseGeocodeLatLon(anchor.lat, anchor.lon))
      .then((ans) => { if (live) setResolved(ans?.label || null); })
      .catch(() => { if (live) setResolved(null); });
    return () => { live = false; };
    // `anchor` (not its individual fields) — it's a stable reference off `comp`, which itself only
    // changes identity when the fetched comps list actually changes (Dashboard.jsx's own useMemo).
  }, [anchor]);

  if (!anchor) return null;
  if (anchor.kind === "site_plan") return siteplanLocationText(anchor, null) || pinFallbackText(anchor, countyEntry);
  return resolved || pinFallbackText(anchor, countyEntry);
}

/** The horizontal peer-comparison scale — a thin rule, a tick + label at each end (the peer set's
 * low/high rate), every peer as a small muted dot, and the featured comp as a larger accent dot
 * with a soft halo and a "this one" label. Pure geometry (fractions) comes from
 * `compScaleLayout`; this only maps those fractions onto an SVG viewBox. */
function CompScale({ featuredRate, peerRates }) {
  const { min, max, peerFracs, featuredFrac } = compScaleLayout(featuredRate, peerRates);
  const W = 240, H = 40, PAD = 14, Y = 21;
  const x = (f) => PAD + f * (W - 2 * PAD);
  const tickLabelStyle = { fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fill: "var(--text-secondary)" };
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}
      role="img" aria-label={`Peer rate scale from ${fmtRateValue(min)} to ${fmtRateValue(max)}, this comp at ${fmtRateValue(featuredRate)}`}>
      <line x1={PAD} y1={Y} x2={W - PAD} y2={Y} stroke="var(--border-default)" strokeWidth={1.5} />
      <line x1={PAD} y1={Y - 4} x2={PAD} y2={Y + 4} stroke="var(--text-tertiary)" strokeWidth={1.5} />
      <line x1={W - PAD} y1={Y - 4} x2={W - PAD} y2={Y + 4} stroke="var(--text-tertiary)" strokeWidth={1.5} />
      <text x={PAD} y={Y + 15} fontSize={FONT_SIZE.micro} textAnchor="start" style={tickLabelStyle}>{fmtRateValue(min)}</text>
      <text x={W - PAD} y={Y + 15} fontSize={FONT_SIZE.micro} textAnchor="end" style={tickLabelStyle}>{fmtRateValue(max)}</text>
      {peerFracs.map((f, i) => (
        <circle key={i} cx={x(f)} cy={Y} r={2.5} fill="var(--text-tertiary)" opacity={0.65} />
      ))}
      <circle cx={x(featuredFrac)} cy={Y} r={9} fill="var(--accent)" opacity={0.18} />
      <circle cx={x(featuredFrac)} cy={Y} r={4.5} fill="var(--accent)" stroke="var(--surface-base)" strokeWidth={1.5} />
      <text x={x(featuredFrac)} y={Y - 12} fontSize={FONT_SIZE.micro} fontWeight={700} textAnchor="middle" fill="var(--accent)">this one</text>
    </svg>
  );
}

export default function CompsCard({ data, onOpenComp, onAddComp, onChangePeriod }) {
  const featured = data?.featured || null;
  const address = useCompAddress(featured); // called unconditionally — safe on null (returns null)

  if (!featured) {
    return (
      <div>
        <div style={EMPTY}>No comps recorded yet.</div>
        <button
          onClick={onAddComp}
          style={{
            marginTop: 8, background: "none", border: "none", padding: 0, font: "inherit",
            color: "var(--accent)", fontWeight: 700, fontSize: FONT_SIZE.control, cursor: "pointer",
          }}
        >
          + Add a comp
        </button>
      </div>
    );
  }

  const { peerSet, rate, countyLabel, sentence } = data;
  const peers = peerSet?.peers || [];
  const excludedCount = peerSet?.excludedCount || 0;
  const scaleReady = rate != null && peers.length >= MIN_PEERS_FOR_SCALE;
  const addedAgo = relativeTimeLabel(featured.createdAt);
  const typeLabel = TYPE_LABEL[featured.compType] || "Comp";
  const sizeSf = compSizeSf(featured);
  const specParts = [];
  if (sizeSf != null) specParts.push(`${Math.round(sizeSf).toLocaleString()} SF`);
  if (featured.clearHeightFt != null) specParts.push(`${Number(featured.clearHeightFt).toLocaleString()} ft clear`);
  if (featured.yearBuilt != null) specParts.push(`built ${featured.yearBuilt}`);
  // The reason comes from the model (`buildPeerSet`), which is the only thing that knows WHY a comp
  // was held out — a fixed "missing county or size" stopped being true once a mismatched lease basis
  // or land unit became an exclusion too.
  const excludedNote = excludedCount > 0
    ? ` (${excludedCount} nearby comp${excludedCount === 1 ? "" : "s"} excluded — ${peerSet?.excludedReason || "not comparable"}.)`
    : "";
  // ⛔ BELOW `MIN_PEERS_FOR_SCALE` THE CARD SAYS ONE THING, ONCE. It used to print the "Against your
  // last N …" heading and, directly beneath it, "this one stands alone" — two sentences contradicting
  // each other inside one panel (adversarial review, 2026-09-08; on Michael's real account it read
  // "Against your last 1 in Harris County, TX" above "this one stands alone"). The heading is a claim
  // that a comparison is being drawn, so it renders only when one actually is.
  const where = countyLabel || "this county";
  const sparseLine = rate == null
    ? "This comp's rate isn't recorded yet, so it can't be placed against its peers."
    : peers.length === 0
      ? `No comparable comps in ${where} yet — this one stands alone.`
      : `Only ${peers.length === 1 ? "one other comparable comp" : `${peers.length} other comparable comps`} in ${where} yet — not enough to place this one on a scale.`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenComp?.(featured)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenComp?.(featured); } }}
      style={{ display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", borderRadius: RADIUS.sm, outline: "none" }}
    >
      <div
        style={{
          fontSize: 16, // design-exempt: dashboard KPI headline — the address is this card's identity line; the app's 14px type-scale ceiling reads too small to lead a card, so this one deliberately sits above it rather than growing the shared scale for a single card.
          fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.25,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}
      >
        {address || "Address unavailable"}
      </div>

      <div style={UPPER_LABEL}>{[countyLabel, addedAgo].filter(Boolean).join(" · ")}</div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        {rate != null ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 28, // design-exempt: the single biggest number on the card, per spec — the largest KPI figure in the app, deliberately above the shared FONT_SIZE ceiling for the same reason as the headline literal above.
                fontWeight: 800, color: "var(--accent)", lineHeight: 1,
                fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS,
              }}
            >
              {fmtRateValue(rate.value)}
            </span>
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{rate.unit.replace(/^\$/, "")}</span>
          </div>
        ) : (
          <div style={MUTED}>Rate not recorded</div>
        )}
        {/* Only a LEASE rate carries a period at all (a land $/AC or a building-sale $/SF price
            doesn't) — the toggle only ever shows when it would actually do something. */}
        {rate?.period != null && <PeriodToggle period={rate.period} onChangePeriod={onChangePeriod} />}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rate?.basis && <Chip tone="neutral" text={rate.basis.toUpperCase()} />}
        <Chip tone="neutral" text={typeLabel} />
      </div>

      {specParts.length > 0 && (
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>
          {specParts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: "var(--text-tertiary)", margin: "0 5px" }} aria-hidden="true">·</span>}
              {p}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 2, padding: "10px 12px", borderRadius: RADIUS.sm, background: "var(--surface-base)", display: "flex", flexDirection: "column", gap: 8 }}>
        {scaleReady ? (
          <>
            <div style={UPPER_LABEL}>Against your last {peers.length} in {where}</div>
            <CompScale featuredRate={rate.value} peerRates={peers.map((p) => p.rate)} />
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", lineHeight: 1.4 }}>{sentence}{excludedNote}</div>
          </>
        ) : (
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.4 }}>
            {sparseLine}{excludedNote}
          </div>
        )}
      </div>
    </div>
  );
}
