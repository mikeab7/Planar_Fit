/* stubSupabase — a minimal, faithful PostgREST/auth stand-in for a SIGNED-IN browser harness.
 *
 * ⛔ WHY IT EXISTS. This sandbox's proxy CORS-blocks the real Supabase auth handshake, which is
 * the standing `Blocker: auth` behind ~80 parked live checks — so every project-level harness in
 * this repo drives the app LOGGED OUT, and the signed-in half of the app (the half where the only
 * thing that matters is whether a row in Postgres actually moved) has never been observable here
 * at all. That is the observability gap DANGEROUS-MEANS-UNOBSERVABLE names: a whole class of
 * "the app said it saved / said it deleted and the database never heard about it" bug is invisible
 * to every existing check, which is exactly the class that keeps reaching the owner.
 *
 * ⛔ IT MUST HONOUR THE QUERY, NOT JUST THE PATH. A stub that answers every GET with "all rows"
 * is not a cheap approximation, it is a DIFFERENT APP: the first version of this returned the full
 * table to `deleted_at=not.is.null`, so the Recently-deleted bin believed every live project was
 * binned and the 30-day purge then HARD-DELETED all of them — a failure invented entirely by the
 * instrument. Filters are parsed and applied here for that reason.
 *
 * Supports the operators this app actually sends: eq, in, is.null / not.is.null, gt/gte/lt/lte,
 * neq, plus `select`, `order`, `limit`, and Prefer: return=representation semantics.
 */

const opOf = (raw) => {
  const s = String(raw);
  if (s.startsWith("not.")) { const inner = opOf(s.slice(4)); return (v) => !inner(v); }
  const [op, ...rest] = s.split(".");
  const val = rest.join(".");
  switch (op) {
    case "eq": return (v) => String(v) === val;
    case "neq": return (v) => String(v) !== val;
    case "is": return (v) => (val === "null" ? v === null || v === undefined : String(v) === val);
    case "gt": return (v) => v > val;
    case "gte": return (v) => v >= val;
    case "lt": return (v) => v < val;
    case "lte": return (v) => v <= val;
    case "in": {
      const set = new Set(val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")));
      return (v) => set.has(String(v));
    }
    default: return () => true;
  }
};

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export function applyQuery(rows, url) {
  const params = new URL(url).searchParams;
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    const pred = opOf(raw);
    out = out.filter((r) => pred(r[key]));
  }
  const order = params.get("order");
  if (order) {
    const [field, dir] = order.split(".");
    out = [...out].sort((a, b) => {
      const av = a[field] ?? "", bv = b[field] ?? "";
      return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
    });
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

/* Install the stub on a Playwright BrowserContext.
 *   tables — { sites: [...], comps: [...] , ... } mutable row arrays
 *   wire   — an array every request is pushed onto: { method, table, url, body }
 * Returns the wire array. */
export function installStubSupabase(ctx, { host = "stub.supabase.co", tables = {}, session, wire = [], control = {} } = {}) {
  return ctx.route(`**${host}/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    let body = null;
    try { body = req.postData(); } catch (_) {}
    const table = (url.match(/\/rest\/v1\/([A-Za-z0-9_]+)/) || [])[1] || null;
    wire.push({ method: req.method(), table, url, body });
    const H = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(data) });
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: { ...H, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (/\/auth\/v1\/user/.test(url)) return json(session.user);
    if (/\/auth\/v1\/token/.test(url)) return json(session);
    if (/\/auth\/v1\//.test(url)) return json({});
    if (!table) return json([]);
    /* `control.failWrites` lets a harness make the database REJECT writes mid-run, so the
     * "a rejected delete must leave the project visible" property can be driven in a real browser
     * rather than only asserted at unit level (B1361683). Reads keep working, exactly as they do
     * when a write is refused by RLS. */
    if (control.failWrites && req.method() !== "GET" && req.method() !== "HEAD")
      return json({ message: "stubbed write failure", code: "XXFAIL" }, 500);
    const rows = tables[table] || (tables[table] = []);
    const matched = applyQuery(rows, url);
    if (req.method() === "GET") return json(matched);
    if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { ...H, "content-range": `0-${Math.max(0, matched.length - 1)}/${matched.length}` }, body: "" });
    if (req.method() === "PATCH") {
      let patch = {}; try { patch = JSON.parse(body || "{}"); } catch (_) {}
      matched.forEach((r) => Object.assign(r, patch));
      return json(matched);
    }
    if (req.method() === "DELETE") {
      for (const r of matched) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
      return json(matched);
    }
    if (req.method() === "POST") { // upsert
      let payload = []; try { payload = JSON.parse(body || "[]"); } catch (_) {}
      const list = Array.isArray(payload) ? payload : [payload];
      for (const p of list) {
        const existing = rows.find((r) => r.id === p.id);
        if (existing) Object.assign(existing, p); else rows.push({ ...p });
      }
      return json(list);
    }
    return json([]);
  }).then(() => wire);
}
