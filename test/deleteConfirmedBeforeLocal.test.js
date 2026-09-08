import { describe, it, expect, beforeEach, vi } from "vitest";

/* ⛔ B1361683 — THE LOCAL PROJECT LIST MUST NOT DROP A PROJECT AHEAD OF A CONFIRMED SERVER DELETE.
 *
 * A second, independent way to produce the same lie B1358128 (×2) produced by another route, and it
 * survives that fix completely: once the id arrives the write goes out, but a REJECTED write (offline,
 * an RLS/ownership mismatch, a 5xx) used to leave the project already erased from
 * `planarfit:sites:cloud:<uid>`. It then stayed gone across a full reload — the picker reads that
 * cache — while the row sat untouched in Postgres, so it came back later on another device. The
 * project vanishing and staying vanished is exactly what makes this class frightening rather than
 * annoying, so the ordering is asserted, not just intended.
 *
 * RED-PROOF (both directions, run before this file was finished):
 *   • Restore the old ordering (delete + `writeSites` before the cloud call) → "a REJECTED cloud
 *     delete leaves the project in the local list" and the two tombstone cases go red.
 *   • Drop the `serverHadNoRow` probe (treat every `removed:0` as a refusal) → "a plan the server
 *     has never seen is still deletable" goes red, which is the bug the naive version of this fix
 *     would have introduced: a local-only plan stranded on screen, permanently undeletable.
 */
const h = vi.hoisted(() => ({ deleteResult: null, checkResult: null, deleteCalls: 0, events: [] }));
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudDelete: async () => { h.deleteCalls += 1; return h.deleteResult; },
  cloudCheckDeleted: async () => h.checkResult,
  cloudUpsert: async () => ({ ok: true }),
  cloudDeleteGroup: async () => ({ ok: true, removed: 0 }),
  cloudHardDelete: async () => ({ ok: true }),
  cloudRestore: async () => ({ ok: true }),
  cloudDeletedRows: async () => ({ ok: true, rows: [] }),
  cloudList: async () => ({ ok: true, rows: [] }),
  clearSiteVersions: () => {},
  keepaliveCloudPush: () => {},
  fetchSiteForReconcile: async () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (event, message, data) => { h.events.push({ event, message, data }); },
}));

import { deleteSite, setActiveUser, saveSite, loadSitesList, mergePulledSites, _readSiteTombs, _recentlyDeleted } from "../src/workspaces/site-planner/lib/storage.js";

const UID = "owner-uid-1";
function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}
const seed = (id) => saveSite({ id, groupId: id, site: "ZZ Confirm", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], settings: {} });
const listed = (id) => loadSitesList().some((s) => s.id === id);

describe("a project leaves the local list only once the server confirms (B1361683)", () => {
  beforeEach(() => {
    mockLocalStorage();
    h.deleteResult = null; h.checkResult = null; h.deleteCalls = 0; h.events = [];
    _recentlyDeleted.clear();
    setActiveUser(UID);
  });

  it("a CONFIRMED cloud delete removes the project locally", async () => {
    seed("zz-ok");
    h.deleteResult = { ok: true, removed: 1 };
    const res = await deleteSite("zz-ok");
    expect(res.ok).toBe(true);
    expect(listed("zz-ok")).toBe(false);
  });

  it("a REJECTED cloud delete leaves the project in the local list", async () => {
    seed("zz-fail");
    h.deleteResult = { ok: false, error: "network down" };
    const res = await deleteSite("zz-fail");
    expect(res.ok).toBe(false);
    expect(listed("zz-fail")).toBe(true); // ← the whole point: it must still be there
  });

  it("a rejected delete leaves NO tombstone behind, so the kept project is still savable", async () => {
    seed("zz-fail2");
    h.deleteResult = { ok: false, error: "network down" };
    await deleteSite("zz-fail2");
    expect(_recentlyDeleted.has("zz-fail2")).toBe(false);
    expect(Object.keys(_readSiteTombs(UID))).not.toContain("zz-fail2");
    // and it really is savable — the B1202176 poisoning must not recur
    expect(saveSite({ id: "zz-fail2", groupId: "zz-fail2", site: "ZZ Confirm", name: "Concept A", parcels: [], els: [], measures: [], settings: {} })).toBe(true);
  });

  it("a confirmed delete DOES keep its tombstone (a stale flush must not resurrect it)", async () => {
    seed("zz-tomb");
    h.deleteResult = { ok: true, removed: 1 };
    await deleteSite("zz-tomb");
    expect(_recentlyDeleted.has("zz-tomb")).toBe(true);
    expect(Object.keys(_readSiteTombs(UID))).toContain("zz-tomb");
  });

  it("a zero-row delete the server CANNOT see (RLS/ownership) keeps the project and reports a failure", async () => {
    seed("zz-rls");
    h.deleteResult = { ok: true, removed: 0 };
    h.checkResult = { ok: true, exists: true, deleted: false }; // the row is really there, we just can't touch it
    const res = await deleteSite("zz-rls");
    expect(res.ok).toBe(false);
    expect(listed("zz-rls")).toBe(true);
    expect(h.events.map((e) => e.event)).toContain("delete-not-confirmed");
  });

  it("a plan the server has never seen is still deletable — a local-only plan is not stranded", async () => {
    seed("zz-localonly");
    h.deleteResult = { ok: true, removed: 0 };
    h.checkResult = { ok: true, exists: false, deleted: false }; // no such row anywhere
    const res = await deleteSite("zz-localonly");
    expect(res.ok).toBe(true);
    expect(listed("zz-localonly")).toBe(false);
  });

  it("an INCONCLUSIVE existence check keeps the project — the safe direction is always to keep", async () => {
    seed("zz-unknown");
    h.deleteResult = { ok: true, removed: 0 };
    h.checkResult = { ok: false }; // offline / a blip
    const res = await deleteSite("zz-unknown");
    expect(res.ok).toBe(false);
    expect(listed("zz-unknown")).toBe(true);
  });

  /* ⛔ THE LEG THAT MAKES THE REAL-WORLD CASE DANGEROUS, and the reason the browser harness cannot
   * see this bug: a device that re-pulls from the cloud would normally HEAL a wrongly-erased local
   * list — the row is still there server-side, so the next pull brings the project back. What
   * defeats that healing is a durable tombstone, which the old ordering left behind on a FAILED
   * delete. That combination is what turns "vanished" into "vanished for good, across reloads and
   * on this device only". Asserted end to end here, through the real merge. */
  it("after a REJECTED delete, the next cloud pull brings the project back (no tombstone suppresses it)", async () => {
    seed("zz-heal");
    h.deleteResult = { ok: false, error: "network down" };
    await deleteSite("zz-heal");
    const row = { id: "zz-heal", group_id: "zz-heal", site: "ZZ Confirm", name: "Concept A", updated_at: new Date().toISOString(), data: { id: "zz-heal", groupId: "zz-heal", site: "ZZ Confirm", name: "Concept A", updatedAt: Date.now() } };
    const { map } = mergePulledSites({}, [row], UID, _readSiteTombs(UID), { now: Date.now() });
    expect(map["zz-heal"]).toBeTruthy();
  });

  it("signed OUT, nothing is asked of any server and the removal is immediate", async () => {
    setActiveUser(null);
    seed("zz-local");
    const res = await deleteSite("zz-local");
    expect(res.skipped).toBe(true);
    expect(h.deleteCalls).toBe(0);
    expect(listed("zz-local")).toBe(false);
  });
});
