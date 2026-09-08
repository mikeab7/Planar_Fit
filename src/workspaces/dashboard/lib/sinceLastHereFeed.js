/* sinceLastHereFeed — the pure engine behind the "Since you were last here" dashboard card
 * (B1366384, NEW-1).
 *
 * ⛔ THERE IS NO EVENT LOG IN THIS APP. Audited before writing a line of this file: no
 * `activity_log`/`audit_log`/`event_log` table exists anywhere in the schema, and nothing on the
 * client records "X happened at time T" as a standalone fact. So this feed is derived entirely
 * from timestamps and state that already exist on the records themselves — plans, comps and notes
 * genuinely stamp `createdAt`/`updatedAt` (comps and, going forward, plans, on the DATABASE row;
 * notes on the synced page-tree node); a project rename stamps `siteRenamedAt` (the same field
 * `projectName.js` already treats as authoritative). Two of the five categories this card covers —
 * a schedule date moving, and a task being marked done — have NO such stamp anywhere (the embedded
 * Scheduler's `planar_data` blob is a live document with no per-field history), so those two are
 * answered the only honest way available without inventing an event log: by keeping a small
 * SNAPSHOT of what this account's plans/tasks looked like as of the last visit, and diffing the
 * current state against it. That snapshot is exactly as reliable as "since you were last here"
 * already promises to be — it only ever compares two dashboard visits, never claims to reconstruct
 * history from before this feature shipped.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER, and why: Gantt tasks carry no reliable per-task owner
 * (root CLAUDE.md's owner constraint #1 — tasks don't need one), so "tasks completed" is read off
 * the health field flipping to "green" for ANY task in this account's own schedule data (which is
 * already scoped to this account by RLS — there is no cross-account visibility here to filter).
 * ⛔ HOW SCHEDULE EVENTS ARE TIMESTAMPED, and why it is not `windowStartMs` (B<PENDING>, 2026-09-08).
 * The two snapshot-diffed kinds (`schedule-slip`, `tasks-completed`) have no exact occurrence time
 * — re-confirmed against production before this fix, not assumed: `public.planar_data` carries NO
 * `updated_at` column, and no task object in the live document carries a temporal field of any
 * kind (32 distinct task keys; none records when a field last changed). The first cut stamped them
 * at `windowStartMs` — the OLDEST instant the change could possibly have happened. That is a valid
 * lower bound and a catastrophic sort key: with the rows sorted newest-first and capped, an event
 * stamped at the floor of the window sorts BELOW every real-stamped event in it, so a returning
 * user who has been away long enough to overflow the cap loses 100% of their schedule rows, every
 * time — measured at 3 of 3 on a one-month absence.
 * The honest fix has two independent halves, because either alone still fails:
 *   (a) STAMP AT A MEASURED UPPER BOUND, not the floor. `public.planar_history` is an append-only
 *       ring of dated writes of this same document, so its newest `created_at` is a real, observed
 *       moment: the schedule was last written THEN, and a change we detect by diff therefore
 *       happened at or before it. `scheduleLastWriteAt` carries that in (one indexed row, no blob).
 *       Where it is unavailable the bound loosens to `now`, never tightens to a guess. Either way
 *       the row is marked `tsApprox` and carries its real `tsEarliest`/`tsLatest` interval, so no
 *       consumer can mistake the point for an exact stamp.
 *   (b) CAP FAIRLY ACROSS KINDS. (a) alone is not enough: a schedule last written early in a long
 *       window legitimately stamps old, and would be cut again for an honest reason. So the cap
 *       reserves one slot per event kind present before any kind takes a second, then fills what is
 *       left by real recency. A date moving is the most consequential thing that can happen while
 *       he is away; the cap may shorten that story, never delete it.
 * No other event kind has this problem: plan-created/renamed/edited, comp-added and note-written
 * every one reads a real recorded stamp off the record itself (`created_at`, `siteRenamedAt`,
 * `updated_at`, `createdAt`) and is exact.
 *
 * "Plans meaningfully edited" is scoped to whichever plans the Pursuits card already fetched
 * building geometry for (the touched-pursuit set) — reusing an existing, already-paid-for fetch
 * rather than adding a new account-wide element scan. A plan outside that set (tracked/complete/
 * dead, or a pursuit nobody opened this session) simply cannot report an edit; it can still report
 * being created or renamed, which read off real stamps with no such limit.
 */

const MS_PER_DAY = 86400000;
const OWN_ACTION_DEBOUNCE_MS = 30000; // "his own actions from thirty seconds ago" — never shown
const FIRST_VISIT_FALLBACK_MS = 24 * 60 * 60 * 1000; // no prior mark at all: look back one day
const CAP_ROWS = 12;
const MAX_TASK_NAMES_SHOWN = 4;

export const KIND_META = {
  "plan-created": { glyph: "+", accent: "site" },
  "plan-renamed": { glyph: "✎", accent: "site" }, // ✎
  "plan-edited": { glyph: "▦", accent: "site" }, // ▦
  "schedule-slip": { glyph: "↷", accent: "schedule" }, // ↷
  "tasks-completed": { glyph: "✓", accent: "schedule" }, // ✓
  "comp-added": { glyph: "$", accent: "site" },
  "note-written": { glyph: "▤", accent: "notes" }, // ▤
};

function parseLocalDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ""));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isNaN(t) ? null : t;
}

function leafTasks(tasks) {
  const parentIds = new Set();
  for (const t of tasks) { if (t && t.parentId != null) parentIds.add(t.parentId); }
  return tasks.filter((t) => t && !parentIds.has(t.id));
}

function fmtInt(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

function statusLabel(status) {
  const MAP = { pursuit: "Pursuit", active: "Active", onhold: "On hold", complete: "Complete", dead: "Dead" };
  return MAP[status] || null;
}

function planIdentity(site) {
  return { groupId: site.group_id || site.id, siteId: site.id };
}

/** "Harris County · Pursuit" — real, already-fetched facts, used as the sub-line's fallback
 * substance whenever a plan's building geometry isn't in the touched set (a freshly created plan
 * that isn't a pursuit, or one nobody opened this session). */
function planContextLine(site) {
  const bits = [];
  if (site.county) bits.push(`${site.county} County`);
  const label = statusLabel(site.status);
  if (label) bits.push(label);
  return bits.join(" · ");
}

function buildingsLine(buildingCount, sqft) {
  const n = buildingCount || 0;
  return `${n} building${n === 1 ? "" : "s"} · ${fmtInt(sqft)} SF`;
}

/** Plan events (created / renamed / meaningfully edited) — at most ONE per plan per visit,
 * priority created > renamed > edited, so one plan never produces three rows for what is really
 * one story. Also returns the next `plans` snapshot: a full replace of the touched-pursuit set
 * (dropped plans that cycled out of it are simply not carried forward — they contribute nothing
 * either way until they're touched again). */
function buildPlanEvents({ sites, buildingCountBySite, sqftBySite, prevPlanSnapshot, windowStartMs }) {
  const rows = [];
  const nextPlans = {};
  for (const site of sites || []) {
    if (!site || !site.id) continue;
    const { groupId, siteId } = planIdentity(site);
    const createdMs = Date.parse(site.created_at || "");
    const updatedMs = Date.parse(site.updated_at || "");
    const renamedMs = site.siteRenamedAt != null ? Number(site.siteRenamedAt) : NaN;
    const hasBuildingData = Object.prototype.hasOwnProperty.call(buildingCountBySite || {}, siteId);
    const name = (site.site || site.name || "Untitled site").trim() || "Untitled site";

    let fired = false;

    if (Number.isFinite(createdMs) && createdMs >= windowStartMs) {
      const line = hasBuildingData
        ? buildingsLine(buildingCountBySite[siteId], sqftBySite[siteId])
        : planContextLine(site);
      rows.push({
        id: `plan-created:${siteId}`,
        kind: "plan-created",
        ts: createdMs,
        parts: [{ text: "New plan " }, { text: name, bold: true }],
        subline: line || "New plan",
        open: { kind: "project", groupId },
      });
      fired = true;
    }

    if (!fired && Number.isFinite(renamedMs) && renamedMs >= windowStartMs) {
      rows.push({
        id: `plan-renamed:${siteId}`,
        kind: "plan-renamed",
        ts: renamedMs,
        parts: [{ text: "Renamed to " }, { text: name, bold: true }],
        subline: planContextLine(site) || "Renamed",
        open: { kind: "project", groupId },
      });
      fired = true;
    }

    if (!fired && hasBuildingData && Number.isFinite(updatedMs) && updatedMs >= windowStartMs) {
      const prev = prevPlanSnapshot ? prevPlanSnapshot[siteId] : null;
      const nowCount = buildingCountBySite[siteId] || 0;
      const nowSqft = sqftBySite[siteId] || 0;
      if (prev && (prev.buildingCount !== nowCount || Math.abs((prev.sqft || 0) - nowSqft) > 25)) {
        rows.push({
          id: `plan-edited:${siteId}:${updatedMs}`,
          kind: "plan-edited",
          ts: updatedMs,
          parts: [{ text: name, bold: true }, { text: " updated" }],
          subline: buildingsLine(nowCount, nowSqft),
          open: { kind: "project", groupId },
        });
      }
    }

    if (hasBuildingData) {
      nextPlans[siteId] = { name, buildingCount: buildingCountBySite[siteId] || 0, sqft: sqftBySite[siteId] || 0 };
    }
  }
  return { rows, nextPlans };
}

/** Schedule events (a milestone's date moving, and bulk task completion) — diffed against the
 * per-task snapshot from the last visit, since nothing in the schedule data itself records when a
 * field last changed. See this module's header for how these are timestamped and why it is NOT
 * `windowStartMs`: they carry the tightest MEASURED upper bound available (`scheduleLastWriteAt`,
 * the newest `planar_history` write of this document; `now` when that is unavailable), clamped so
 * an approximate row can never suppress itself against the own-action debounce, and marked
 * `tsApprox` with the real `[tsEarliest, tsLatest]` interval they are known to lie in. */
function buildScheduleEvents({ scheduleProjects, prevTaskSnapshot, windowStartMs, approxTs, tsLatest }) {
  const rows = [];
  const nextTasks = {};
  const projects = scheduleProjects && typeof scheduleProjects === "object" ? Object.values(scheduleProjects) : [];
  for (const p of projects) {
    if (!p || p.id == null) continue;
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    const leaves = leafTasks(tasks);
    const prevProject = (prevTaskSnapshot && prevTaskSnapshot[p.id]) || {};
    const nextProject = {};
    const projectName = (p.name && String(p.name).trim()) || "Untitled schedule";
    const completedNames = [];

    for (const t of leaves) {
      if (!t || t.id == null) continue;
      nextProject[t.id] = { end: t.end || null, health: t.health || null, name: (t.name && String(t.name).trim()) || "" };
      const prev = prevProject[t.id];
      if (!prev) continue;

      if (prev.end && t.end && prev.end !== t.end) {
        const oldMs = parseLocalDate(prev.end);
        const newMs = parseLocalDate(t.end);
        if (oldMs != null && newMs != null) {
          const days = Math.round((newMs - oldMs) / MS_PER_DAY);
          if (days !== 0) {
            const taskName = nextProject[t.id].name || `Task #${t.id}`;
            rows.push({
              id: `schedule-slip:${p.id}:${t.id}`,
              kind: "schedule-slip",
              ts: approxTs,
              tsApprox: true,
              tsEarliest: windowStartMs,
              tsLatest,
              parts: [
                { text: "Milestone " },
                { text: taskName, bold: true },
                { text: days > 0 ? ` slipped ${days} day${days === 1 ? "" : "s"}` : ` moved up ${-days} day${-days === 1 ? "" : "s"}` },
              ],
              subline: `${projectName} · ${days > 0 ? "+" : ""}${days}d`,
              open: { kind: "task", linkedSiteId: p.linkedSiteId || null, taskId: t.id },
            });
          }
        }
      }

      if (prev.health !== "green" && t.health === "green") {
        completedNames.push(nextProject[t.id].name || `Task #${t.id}`);
      }
    }

    if (completedNames.length) {
      const shown = completedNames.slice(0, MAX_TASK_NAMES_SHOWN);
      const more = completedNames.length - shown.length;
      rows.push({
        id: `tasks-completed:${p.id}:${windowStartMs}`,
        kind: "tasks-completed",
        ts: approxTs,
        tsApprox: true,
        tsEarliest: windowStartMs,
        tsLatest,
        parts: [
          { text: `Closed ${completedNames.length} task${completedNames.length === 1 ? "" : "s"} on ` },
          { text: projectName, bold: true },
        ],
        subline: `${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`,
        open: { kind: "schedule", linkedSiteId: p.linkedSiteId || null },
      });
    }

    nextTasks[p.id] = nextProject;
  }
  return { rows, nextTasks };
}

// A small, local re-implementation of `shared/comps/lib/comps.js`'s `compHeadline` — see
// dashboardCompsRecentFetch.js's header for why this file never imports that module.
function compRateLine(comp) {
  if (comp.compType === "land") {
    const price = comp.landPrice, sizeValue = comp.landSizeValue;
    if (!price || !sizeValue) return "Land comp";
    const unit = comp.landSizeUnit === "ac" ? "ac" : "sf";
    return `$${fmtInt(price / sizeValue)}/${unit === "ac" ? "AC" : "SF"} land`;
  }
  if (comp.compType === "building_sale") {
    if (!comp.bldgPrice || !comp.bldgSizeSf) return "Building sale";
    return `$${fmtInt(comp.bldgPrice / comp.bldgSizeSf)}/SF sale`;
  }
  if (comp.compType === "lease") {
    if (comp.leaseRate == null) return "Lease comp";
    const period = comp.leaseRatePeriod === "monthly" ? "/mo" : "/yr";
    const basis = comp.leaseRateExpense ? ` ${String(comp.leaseRateExpense).toUpperCase()}` : "";
    return `$${comp.leaseRate}/SF${period}${basis}`;
  }
  return "Comp";
}

function compSizeText(comp) {
  if (comp.compType === "land") {
    if (!comp.landSizeValue) return "";
    return `${fmtInt(comp.landSizeValue)} ${comp.landSizeUnit === "sf" ? "SF" : "ac"}`;
  }
  if (comp.compType === "building_sale") {
    return comp.bldgSizeSf ? `${fmtInt(comp.bldgSizeSf)} SF` : "";
  }
  if (comp.compType === "lease") {
    return comp.leaseSizeSf ? `${fmtInt(comp.leaseSizeSf)} SF` : "";
  }
  return "";
}

/** Comp events — `compRateLine` above states the rate; this adds its size alongside, since a rate
 * with no size is half the deal. */
function buildCompEvents({ comps }) {
  return (comps || []).map((comp) => {
    const ts = Date.parse(comp.createdAt || "");
    const size = compSizeText(comp);
    const rate = compRateLine(comp);
    const noun = comp.title || "New comp";
    return {
      id: `comp-added:${comp.id}`,
      kind: "comp-added",
      ts: Number.isFinite(ts) ? ts : 0,
      parts: [{ text: "New comp " }, { text: noun, bold: true }],
      subline: [rate, size].filter(Boolean).join(" · ") || "New comp",
      open: { kind: "comp", comp },
    };
  }).filter((r) => r.ts > 0);
}

/** Note events — a page with no words yet carries no substance, so it is dropped rather than
 * shown with an empty quote (root CLAUDE.md's "if a row cannot carry substance, it does not
 * belong in the feed"). */
function buildNoteEvents({ notePages }) {
  return (notePages || [])
    .filter((p) => p.opening)
    .map((p) => ({
      id: `note-written:${p.id}`,
      kind: "note-written",
      ts: p.createdAt,
      parts: [{ text: "New note " }, { text: p.title, bold: true }],
      subline: `“${p.opening}”`,
      open: { kind: "note", pageId: p.id, projectId: p.projectId, orgScope: p.orgScope },
    }));
}

/**
 * Take at most `cap` rows out of `rows` (already sorted newest-first) WITHOUT letting any one
 * event kind be eliminated wholesale.
 *
 * Plain `slice(0, cap)` ranks purely on the timestamp, which is correct only while every kind's
 * timestamp is equally precise. Two of the seven kinds are snapshot-diffed and can only carry an
 * approximate one (see this module's header), so a plain slice systematically deletes exactly the
 * rows that matter most. Instead: one reserved pass hands each kind present its single newest row,
 * then every remaining slot is filled by real recency across what is left. With `cap` at or above
 * the number of kinds — 12 against 7 here — a kind present in the feed ALWAYS reaches the card.
 * The result is re-sorted newest-first so the card still reads as a chronology.
 */
export function capRowsFairlyByKind(rows, cap) {
  if (!Array.isArray(rows) || rows.length <= cap) return (rows || []).slice();
  if (cap <= 0) return [];
  const taken = new Set();
  const seenKind = new Set();
  for (const r of rows) {                      // reserved pass — newest row of each kind
    if (taken.size >= cap) break;
    if (seenKind.has(r.kind)) continue;
    seenKind.add(r.kind);
    taken.add(r);
  }
  for (const r of rows) {                      // fill the rest by real recency
    if (taken.size >= cap) break;
    taken.add(r);
  }
  return rows.filter((r) => taken.has(r));     // `rows` order === newest-first
}

/**
 * Build the whole feed. Pure — no Date.now() default, so a caller (and every test) controls the
 * clock explicitly.
 *
 * @param {object} args
 * @param {number} args.now
 * @param {number|null} args.lastVisitAt — null on a genuine first visit under this feature
 * @param {Array}  args.sites — fetchSiteSummaries() rows (created_at/updated_at/siteRenamedAt included)
 * @param {object} args.buildingCountBySite — { [siteId]: N } for the touched-pursuit set only
 * @param {object} args.sqftBySite — { [siteId]: sqft } for the same set
 * @param {object|null} args.scheduleProjects — fetchScheduleProjects()'s raw projects map
 * @param {Array}  args.comps — fetchRecentComps() rows (already createdAt-filtered)
 * @param {Array}  args.notePages — fetchRecentNotePages() rows (already createdAt-filtered)
 * @param {object} args.prevSnapshot — the stored { plans, tasks } from the last visit
 */
export function buildSinceLastHereFeed({
  now,
  lastVisitAt,
  sites = [],
  buildingCountBySite = {},
  sqftBySite = {},
  scheduleProjects = null,
  comps = [],
  notePages = [],
  prevSnapshot = { plans: {}, tasks: {} },
  scheduleLastWriteAt = null,
}) {
  const isFirstVisit = lastVisitAt == null;
  const windowStartMs = isFirstVisit ? now - FIRST_VISIT_FALLBACK_MS : lastVisitAt;

  // The tightest MEASURED upper bound on when a snapshot-diffed schedule change happened: the
  // newest write of the schedule document itself. Unavailable → `now`, which is a looser bound but
  // still a true one. Then clamped into the window at both ends: never before `windowStartMs` (a
  // write that predates the last visit cannot explain a change detected against it — the real
  // change is later, and this is a stale ring), and never inside the own-action debounce (an
  // approximate row must not be able to suppress ITSELF as "something you just did" — the debounce
  // exists to hide known-recent actions, and this time is not known).
  const lastWrite = Number(scheduleLastWriteAt);
  const tsLatest = Math.min(Number.isFinite(lastWrite) && lastWrite > 0 ? lastWrite : now, now);
  const scheduleTs = Math.min(Math.max(tsLatest, windowStartMs), now - OWN_ACTION_DEBOUNCE_MS);

  const plan = buildPlanEvents({ sites, buildingCountBySite, sqftBySite, prevPlanSnapshot: prevSnapshot.plans, windowStartMs });
  const schedule = buildScheduleEvents({
    scheduleProjects, prevTaskSnapshot: prevSnapshot.tasks, windowStartMs,
    approxTs: scheduleTs, tsLatest,
  });
  const compRows = buildCompEvents({ comps });
  const noteRows = buildNoteEvents({ notePages });

  const allRows = [...plan.rows, ...schedule.rows, ...compRows, ...noteRows]
    .filter((r) => now - r.ts >= OWN_ACTION_DEBOUNCE_MS)
    .sort((a, b) => b.ts - a.ts);

  const capped = capRowsFairlyByKind(allRows, CAP_ROWS);
  const overflowCount = allRows.length - capped.length;

  const nextSnapshot = { plans: plan.nextPlans, tasks: schedule.nextTasks };
  const spanAnchor = isFirstVisit ? windowStartMs : lastVisitAt;

  return {
    rows: capped,
    totalCount: allRows.length,
    overflowCount,
    spanAnchorMs: spanAnchor,
    nextSnapshot,
    nextLastVisitAt: now,
  };
}
