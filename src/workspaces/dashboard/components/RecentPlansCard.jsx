/* RecentPlansCard — the Dashboard's real-render thumbnail card (NEW-1, 2026-09-08). Owner intent,
 * verbatim from the brief: "the only card that would make Planyr read as a design tool rather than
 * a list app... he recognizes his own site plans by their shape faster than by their name." Every
 * other card on this screen is text and numbers; this one is pictures — a 2x2 grid of the four
 * most recently edited plans across every project, each a real render of that plan's boundary,
 * buildings, truck courts/paving and parking (site-planner/lib/planThumbnail.js), never an icon or
 * a generic shape.
 *
 * The thumbnail itself is a cached SVG string (site-planner/lib/siteThumbnail.js writes it on
 * every real save) — this component never renders a live plan; it drops the cached string straight
 * into an <img data: URI>. A plan with no cached thumbnail yet (thumbnailSvg === null — saved
 * before this feature shipped) is generated lazily, once, via recentPlansThumbnailFallback.js, and
 * never re-attempted once a value (even "" — genuinely nothing drawable) comes back.
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { recentPlansLayoutMode, countForMode } from "../lib/recentPlansLayout.js";
import { relativeTimeShort } from "../lib/relativeTime.js";
import { lazyGenerateThumbnail } from "../lib/recentPlansThumbnailFallback.js";

const MONO_FONT = "ui-monospace, monospace"; // same stack as ParcelDataPanel.jsx's MONO_FONT
const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };

function svgDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function useMeasuredBox() {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

function PlanThumbCell({ plan, svg, onOpen }) {
  const hasImage = !!svg;
  const cannotRender = svg === ""; // attempted, nothing drawable
  return (
    <button
      type="button"
      onClick={onOpen}
      title={plan.name}
      style={{
        display: "flex", flexDirection: "column", gap: 4, minWidth: 0, minHeight: 0,
        background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer",
        font: "inherit", color: "inherit",
      }}
    >
      <div
        style={{
          position: "relative", width: "100%", flex: 1, minHeight: 0,
          background: "var(--surface-base)", border: "1px solid var(--border-default)",
          borderRadius: RADIUS.md, overflow: "hidden",
          display: hasImage ? "block" : "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {hasImage ? (
          <img src={svgDataUri(svg)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : cannotRender ? (
          <span style={{ fontSize: 11, color: "var(--text-secondary)", padding: "0 8px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {plan.name}
          </span>
        ) : null /* still generating — an empty faint panel, never a placeholder icon */}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "none" }}>
        {plan.name}
      </div>
      <div style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: "var(--text-secondary)", flex: "none" }}>
        {relativeTimeShort(plan.updatedAt)}
      </div>
    </button>
  );
}

export function RecentPlansCard({ plans, onOpenProject }) {
  const [wrapRef, box] = useMeasuredBox();
  // thumbnailSvg from the fetch, overridden per-id once a lazy generation resolves.
  const [generated, setGenerated] = useState({});
  const requestedRef = useRef(new Set());

  const mode = box.width > 0 ? recentPlansLayoutMode(box) : "grid2x2";
  const shown = (plans || []).slice(0, countForMode(mode));

  useEffect(() => {
    let live = true;
    for (const plan of shown) {
      const known = generated[plan.id] !== undefined ? generated[plan.id] : plan.thumbnailSvg;
      if (known !== null || requestedRef.current.has(plan.id)) continue;
      requestedRef.current.add(plan.id);
      lazyGenerateThumbnail(plan.id).then((svg) => {
        if (!live) return;
        setGenerated((g) => ({ ...g, [plan.id]: svg == null ? "" : svg }));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((p) => p.id).join(",")]);

  if (!shown.length) {
    return <div ref={wrapRef} style={EMPTY}>No plans yet — your first saved plan will show up here.</div>;
  }

  return (
    <div
      ref={wrapRef}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: mode === "grid2x2" ? "1fr 1fr" : "1fr",
        gap: 10,
        height: "100%",
        minHeight: 0,
      }}
    >
      {shown.map((plan) => {
        const svg = generated[plan.id] !== undefined ? generated[plan.id] : plan.thumbnailSvg;
        return (
          <PlanThumbCell
            key={plan.id}
            plan={plan}
            svg={svg}
            onOpen={() => onOpenProject?.(plan)}
          />
        );
      })}
    </div>
  );
}
