import { describe, it, expect } from "vitest";
import { createElementSync, nextOpForStatus, RETRYABLE_UNCHANGED } from "../src/workspaces/site-planner/lib/elementSync.js";

/* ROUND EIGHT of the false stale-tab banner (B1482352) — the regression that would have caught it.
 *
 * PROVENANCE: this file is written against a FIRST-HAND MEASUREMENT of the reported instance, not
 * against the prior rounds' explanation. Read out of `public.client_errors` on production
 * (`lyeqzkuiwngunutlkkmi`), site `smtvt0w2r5yv` ("Aldine Bender 1", created 17:31:39), tab
 * `f7c2144b`, build `4e2e164`, 2026-09-10:
 *
 *   17:32:20.386–.412  element-assembly-joined ×4      → closeAssemblies folds a 7-member assembly
 *   17:32:20.497       element-op-refreshed            → e1455136azvoda, cls "create"
 *   17:32:20.498       element-atomic-rollback ops:5   streak 1
 *   17:32:21.646       element-atomic-rollback ops:5   streak 2
 *   17:32:22.817       element-atomic-rollback ops:6   streak 3
 *   17:32:23.422       element-atomic-rollback ops:7   streak 4  → assembly-split-unresolved  BANNER 1
 *   17:32:23.786       element-atomic-rollback ops:7   streak 5  → assembly-split-unresolved  BANNER 2
 *   17:32:26.971                                       streak 6  → assembly-split-unresolved  BANNER 3
 *   17:32:33.319       element-create-collision        → e1455136azvoda "create hit a live row"
 *
 * `select count(distinct updated_by) from site_elements where site_id='smtvt0w2r5yv'` → **1**.
 * One account, one tab, no collaborator, a site four minutes old. The `client-stale` banner says
 * "This tab is out of date — your recent changes here can't be saved", which is a claim about a
 * foreign writer. There was none. THE TAB DEADLOCKED AGAINST ITS OWN COMMITTED ROW.
 *
 * TWO INDEPENDENT DEFECTS, and both are needed to produce the photograph the owner sent:
 *   (1) NON-CONVERGENCE — `commit_elements_atomic` aborts the whole call on ANY non-`ok` status,
 *       and `onAtomicRollback` re-queued every op VERBATIM. A `create` answered `exists` can never
 *       succeed at any rev, so the identical batch was re-sent until the streak ran out.
 *   (2) RE-ANNOUNCEMENT — past the streak threshold EVERY further refusal re-emitted `client-stale`,
 *       and `useToasts` appends unconditionally. Three emits → `TOAST_CAP` 2 shown + "+1 more".
 *
 * The prior seven rounds all fixed the AUTHORSHIP question ("did this row originate from my own
 * account?"). That question is settled and CI-gated (`isOwnWrite`, docs/DATA.md §2 inv. 5) and it
 * is not the one that failed here — `client-stale` is deliberately exempt from that gate. The
 * question that had no single authority was CONVERGENCE: "can this op ever succeed if I send it
 * again unchanged?" `nextOpForStatus` is that authority.
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

/* A server that behaves like the real `commit_elements` + `commit_elements_atomic` pair:
 *  - a create against a row it already holds → `exists`
 *  - an update/delete against a row it does not hold → `missing`
 *  - `p_atomic` + ANY non-ok status → the whole call rolls back, `applied:false`
 * `alreadyHas` seeds rows the server holds that the CLIENT's shadow does not know about — exactly
 * the measured state (this tab's own create landed at rev 5; the ack never came back). */
function harness({ alreadyHas = [], alwaysConflict = false } = {}) {
  const commits = [];
  const events = [];
  const timers = [];
  let clock = 1000;
  const rows = new Map(alreadyHas.map((id) => [id, 5]));
  const live = { els: [], markups: [], measures: [], callouts: [], parcels: [] };

  const sync = createElementSync({
    siteId: "s1",
    selfUid: () => "me",                       // ONE account. There is no second writer anywhere here.
    commit: async (ops, opt) => {
      commits.push(ops.map((o) => o.op + ":" + o.id));
      const results = ops.map((o) => {
        if (alwaysConflict) return { id: o.id, status: "conflict", row: { id: o.id, rev: (rows.get(o.id) || 5) + 1, data: { id: o.id, poison: Math.random() }, updated_by: "me" } };
        if (o.op === "create" && rows.has(o.id)) return { id: o.id, status: "exists", row: { id: o.id, rev: rows.get(o.id), updated_by: "me" } };
        if (o.op !== "create" && !rows.has(o.id)) return { id: o.id, status: "missing" };
        const rev = (rows.get(o.id) || 0) + 1;
        return { id: o.id, status: "ok", rev, _commit: () => rows.set(o.id, rev) };
      });
      const bad = results.some((r) => r.status !== "ok");
      const strip = results.map(({ _commit, ...r }) => r);
      if (opt && opt.atomic) {
        if (bad) return { ok: true, sentAtomic: true, applied: false, results: strip }; // nothing landed
        results.forEach((r) => r._commit && r._commit());
        return { ok: true, sentAtomic: true, applied: true, results: strip };
      }
      results.forEach((r) => r._commit && r._commit());
      return { ok: true, results: strip };
    },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    liveCollections: () => live,
    debounceMs: 750,
  });
  sync.seed([]);

  const settle = async (rounds = 40) => {
    for (let i = 0; i < rounds; i++) {
      await tick();
      const due = timers.splice(0);
      due.forEach((t) => t.fn());
      await tick();
    }
  };
  return { sync, commits, events, live, rows, settle, staleCount: () => events.filter((e) => e.type === "client-stale").length };
}

// A building plus two bonded children — the shape `closeAssemblies` folds into one atomic batch.
const assembly = () => [
  { id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 50 },
  { id: "c1", type: "paving", attachedTo: "b1", cx: 0, cy: 60, w: 100, h: 20 },
  { id: "c2", type: "paving", attachedTo: "b1", cx: 0, cy: 90, w: 100, h: 20 },
];

describe("nextOpForStatus — the ONE answer to 'can this op succeed if I resend it unchanged?'", () => {
  it("only `ok` and `conflict` are retryable unchanged", () => {
    expect([...RETRYABLE_UNCHANGED].sort()).toEqual(["conflict", "ok"]);
  });
  it("a create answered `exists` is RECAST to an update — never resent", () => {
    expect(nextOpForStatus("create", "exists")).toMatchObject({ action: "recast", cls: "update" });
  });
  it("an update answered `missing` is RECAST to a create", () => {
    expect(nextOpForStatus("update", "missing")).toMatchObject({ action: "recast", cls: "create" });
  });
  it("a delete answered `missing` is DROPPED — there is nothing left to delete", () => {
    expect(nextOpForStatus("delete", "missing")).toMatchObject({ action: "drop" });
  });
  it("anything answered `deleted` is DROPPED — a tombstone cannot be written through", () => {
    expect(nextOpForStatus("update", "deleted")).toMatchObject({ action: "drop" });
    expect(nextOpForStatus("create", "deleted")).toMatchObject({ action: "drop" });
    expect(nextOpForStatus("delete", "deleted")).toMatchObject({ action: "drop" });
  });
  it("`conflict` resends unchanged (the rev is adopted separately) — the one case the old code handled", () => {
    expect(nextOpForStatus("update", "conflict")).toMatchObject({ action: "resend", cls: "update" });
  });
  it("an unknown or absent status FAILS OPEN to resend — never worse than before", () => {
    expect(nextOpForStatus("update", undefined)).toMatchObject({ action: "resend" });
    expect(nextOpForStatus("update", "something-new")).toMatchObject({ action: "resend" });
  });
  it("every verdict carries a stated reason (it is reported to telemetry, never silent)", () => {
    for (const s of ["ok", "conflict", "exists", "missing", "deleted", undefined])
      for (const c of ["create", "update", "delete"])
        expect(nextOpForStatus(c, s).reason).toBeTruthy();
  });
});

describe("round eight — a single tab must never accuse itself of being out of date", () => {
  /* ⛔ THE RED-PROOF TEST. On the code as it stood before this fix, `onAtomicRollback` re-queued
   * the `exists` create verbatim; the batch was re-sent identically until the streak tripped and
   * this assertion saw 1. Verified failing before the fix, passing after. */
  it("an assembly carrying a member the server already has CONVERGES — no banner, one account, one tab", async () => {
    const h = harness({ alreadyHas: ["c2"] });        // this tab's own create landed; the ack never came back
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle();
    expect(h.staleCount()).toBe(0);
    // …and it converged by RECASTING, not by luck: the last call carries an update for c2, not a create.
    expect(h.commits[h.commits.length - 1]).toContain("update:c2");
    expect(h.commits[h.commits.length - 1]).not.toContain("create:c2");
  });

  it("the identical create is never re-sent twice — the deadlock cannot re-form", async () => {
    const h = harness({ alreadyHas: ["c2"] });
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle();
    const createsOfC2 = h.commits.filter((ops) => ops.includes("create:c2")).length;
    expect(createsOfC2).toBe(1);                      // sent once, refused once, recast — never repeated
  });

  it("an update against a row the server does not have is recast to a create, not spun on", async () => {
    const h = harness();                              // server holds NOTHING…
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle(3);
    h.rows.clear();                                   // …and then loses the rows underneath us
    h.live.els = assembly().map((e) => ({ ...e, cx: e.cx + 5 }));
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle();
    expect(h.staleCount()).toBe(0);
  });

  /* ⛔ THE SECOND DEFECT, INDEPENDENT OF THE FIRST. Even where a stall is GENUINE and cannot be
   * converged away, the banner is news exactly once. Before the latch, every refusal past the
   * threshold pushed another toast — streaks 4, 5 and 6 on the owner's own session, which is the
   * "+1 more" in his screenshot. `alwaysConflict` is an honestly un-convergeable server: every op
   * conflicts forever against data that never matches, so the streak really does run out. */
  it("a GENUINELY unresolvable stall raises the banner ONCE, however many rounds it takes", async () => {
    const h = harness({ alwaysConflict: true });
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle(60);
    expect(h.staleCount()).toBe(1);
    expect(h.commits.length).toBeGreaterThan(3);       // it really did keep trying — this is not a no-op pass
  });

  /* ⛔ THIS is the stacking exactly as it happened, and the shape the first draft of this test MISSED.
   * Once the streak trips, the engine emits and RETURNS — so a stall on its own produces one banner
   * and stops. What put three on the owner's screen is that HE KEPT WORKING: every further edit
   * re-enters `flush()` (reconcile → enqueue → schedule → flush), is refused again, increments the
   * streak past the threshold again, and — before the latch — announced again. Streaks 4, 5 and 6
   * on his session, 3.5 seconds apart, while he was placing his second building. A test that only
   * lets the engine spin by itself passes on the BROKEN code, which is why this one drives edits. */
  it("continuing to work during an unresolvable stall does NOT stack a second banner", async () => {
    const h = harness({ alwaysConflict: true });
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle(60);
    expect(h.staleCount()).toBe(1);
    for (let n = 1; n <= 4; n++) {                     // he keeps nudging the plan, as anyone would
      h.live.els = assembly().map((e) => ({ ...e, cx: e.cx + n }));
      h.sync.reconcile({ els: h.live.els }, {});
      await h.settle(20);
    }
    expect(h.staleCount()).toBe(1);                    // ONE banner, not one per edit
  });

  /* ⛔ LOUD-FAILURE — the one `drop` verdict that discards the user's own work must not be quiet.
   * An update refused because the row is tombstoned is an edit being thrown away; it gets the same
   * Restore offer `processResults` gives it, under the same authorship gate. */
  it("an op dropped because the row is tombstoned still offers Restore — it is never silently discarded", async () => {
    const events = [];
    const timers = [];
    let clock = 1000;
    const live = { els: [], markups: [], measures: [], callouts: [], parcels: [] };
    const sync = createElementSync({
      siteId: "s1",
      selfUid: () => "me",
      commit: async (ops, opt) => {
        const results = ops.map((o) => (o.id === "c2"
          ? { id: o.id, status: "deleted", row: { id: o.id, rev: 9, deleted_by: "someone-else", deleted_at: "t" } }
          : { id: o.id, status: "ok", rev: 1 }));
        // Mirror `commit_elements_atomic.sql` exactly: roll back ONLY when some op is non-ok.
        const bad = results.some((r) => r.status !== "ok");
        return opt && opt.atomic
          ? { ok: true, sentAtomic: true, applied: !bad, results }
          : { ok: true, results };
      },
      now: () => clock,
      setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
      clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
      /* ⛔ THE HARNESS MUST MODEL THE REAL WIRING, OR IT MANUFACTURES A FINDING. `edit-vs-deleted`
       * carries `removeFromCanvas: true`, and `SitePlanner.jsx` acts on it — the element leaves the
       * canvas. Without that, `reconcile` re-reads the live collections and re-mints the create
       * forever, and the harness's own omission reads as a convergence bug in the app. Measured:
       * dropping this line alone produces a `client-stale` the real app never sees. */
      onEvent: (e) => {
        events.push(e);
        if (e.type === "edit-vs-deleted") live.els = live.els.filter((x) => x.id !== e.id);
      },
      liveCollections: () => live,
      debounceMs: 750,
    });
    sync.seed([]);
    live.els = assembly();
    sync.reconcile({ els: live.els }, {});
    for (let i = 0; i < 20; i++) { await tick(); timers.splice(0).forEach((t) => t.fn()); await tick(); sync.reconcile({ els: live.els }, {}); }
    expect(events.filter((e) => e.type === "edit-vs-deleted" && e.id === "c2")).toHaveLength(1);
    expect(events.filter((e) => e.type === "client-stale")).toHaveLength(0);  // converged, so no banner
  });

  it("retryNow() re-arms the banner, so a SECOND genuine stall is still announced", async () => {
    const h = harness({ alwaysConflict: true });
    h.live.els = assembly();
    h.sync.reconcile({ els: h.live.els }, {});
    await h.settle(60);
    expect(h.staleCount()).toBe(1);
    h.sync.retryNow();
    await h.settle(60);
    expect(h.staleCount()).toBe(2);                    // a latch, not a mute
  });
});
