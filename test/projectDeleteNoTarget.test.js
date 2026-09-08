import { describe, it, expect, beforeEach, vi } from "vitest";

/* ⛔ B1358128 — "DELETE NOTHING" MUST NEVER ANSWER "OK".
 *
 * The switcher's confirmation could lose its target mid-gesture (see menuLayers.js) and then call
 * the store with `undefined`. `deleteSiteGroup(undefined)` found no local plans, refused to ask the
 * cloud (no group id to ask about) and resolved `{ ok: true, removed: 0 }` — ZERO network traffic,
 * no error, nothing thrown — so the caller moved the notes out, dropped the project from this
 * device's cache and routed the user home while `public.sites.deleted_at` was never written. That
 * is the whole "the app deleted it, the database never heard" shape the owner measured on
 * production: `notes_trees.rev` moved, and not one PATCH to `rest/v1/sites`.
 *
 * RED-PROOF: delete the `if (!groupId)` guard in storage.js's `deleteSiteGroup` and the first case
 * below goes red (`ok` comes back true) while nothing else in the suite notices — which is exactly
 * how the defect survived.
 */
const h = vi.hoisted(() => ({ events: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (event, message) => { h.events.push({ event, message }); },
}));

import { deleteSiteGroup, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { deleteProject } from "../src/shared/projects/projects.js";

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

describe("a project delete with no project behind it fails LOUDLY", () => {
  beforeEach(() => { mockLocalStorage(); h.events = []; setActiveUser("owner-uid-1"); });

  for (const missing of [undefined, null, ""]) {
    it(`deleteSiteGroup(${JSON.stringify(missing)}) reports a failure, not a clean no-op`, async () => {
      const res = await deleteSiteGroup(missing);
      expect(res.ok).toBe(false);
      expect(res.removed).toBe(0);
      expect(String(res.error)).toMatch(/nothing was deleted/i);
      expect(h.events.map((e) => e.event)).toContain("delete-no-group-id");
    });
  }

  it("deleteProject() refuses an absent id before it ever reaches the engine", async () => {
    const res = await deleteProject(undefined);
    expect(res.ok).toBe(false);
    expect(res.removed).toBe(0);
  });

  it("a REAL id that names nothing still reports the honest `ok:true, removed:0` — the two cases stay distinct", async () => {
    const res = await deleteSiteGroup("a-real-but-unknown-id");
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(0);
  });
});
