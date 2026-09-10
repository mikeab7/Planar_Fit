/* hostThrottle.mjs — B1461731: per-HOST pacing + circuit breaking for the discovery/probe
 * tooling (probe-statewide-parcels.mjs, the neighbour walk, the health sweep).
 *
 * THE CASE THIS WAS BUILT FOR. During Nevada's outage window one query took 18 SECONDS to return
 * an error, and the host later stopped responding entirely for a period. A probe/discovery script
 * that keeps querying a host in that state — especially the neighbour walk, which can issue
 * several requests in a row against the SAME host while exploring one server's directory tree —
 * is retrying into exactly the problem, not backing off from it.
 *
 * ONE BREAKER, NOT TWO. This reuses the app's own runtime circuit breaker
 * (src/workspaces/site-planner/lib/sourceHealth.js) rather than inventing a second definition of
 * "this source is unhealthy" — same threshold, same cooldown, same slowness-awareness (B1461731
 * also extended that module to trip on a response that keeps answering just short of a timeout,
 * not only on outright failures). The only difference here is the KEY: the app's breaker is keyed
 * per COUNTY (one source per click candidate); this is keyed per HOSTNAME, because a probe walks
 * many services that can share one host, and a struggling host affects all of them at once. The
 * two never collide — this runs in a separate Node process from the browser runtime, so there is
 * no shared in-memory state to reason about, only shared LOGIC.
 *
 * A single bad response never opens the breaker (SOURCE_FAIL_THRESHOLD is 3 consecutive), so the
 * neighbour walk can still try a handful of sibling services on a host right after one of them
 * errors — it only backs off once that host has shown a genuine pattern, not a one-off.
 */
import {
  recordSourceResult, isSourceOpen, sourceCooldownMs, resetSourceHealth, SOURCE_SLOW_MS,
} from "../../src/workspaces/site-planner/lib/sourceHealth.js";

export { SOURCE_SLOW_MS as HOST_SLOW_MS };

export function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return String(url || ""); }
}

// Is this host's breaker currently open? (thin re-export under the host-facing name)
export const isHostOpen = (url, now = Date.now()) => isSourceOpen(hostnameOf(url), now);
export const hostCooldownMs = (url, now = Date.now()) => sourceCooldownMs(hostnameOf(url), now);
export const resetHostHealth = resetSourceHealth;

/* Record one request's outcome against its host's breaker. `ok` — did the transport succeed (an
 * ArcGIS `{error}` body still counts as the host having ANSWERED; that's a source-level problem,
 * not a host-level one — see probeSource/walkForReplacement, which check the body separately).
 * `ms` — how long it took; a response ≥ HOST_SLOW_MS counts toward the streak exactly like a
 * failure would, even when `ok` is true (the Nevada 18-second-error case is both at once, and
 * counts once — `recordSourceResult` doesn't double-penalize). Returns the hostname used as the
 * breaker key, for logging. */
export function recordHostOutcome(url, ok, ms, now = Date.now()) {
  const host = hostnameOf(url);
  recordSourceResult(host, ok, now, { ms });
  return host;
}

const _lastCallAt = new Map(); // hostname -> ms timestamp this host was last called

// A floor on spacing between requests to the SAME host — cheap insurance against a burst of
// same-host candidates (the neighbour walk's own directory-then-services-then-layers sequence)
// firing back-to-back at a host that may already be struggling. Not a queue or a real limiter,
// just a minimum gap; scripts here already await each request serially.
export const MIN_HOST_GAP_MS = 250;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Wait out any remaining gap since this host was last called, then mark this call as having
 * happened now. Call it immediately before issuing a request. Injectable clock/sleep for tests. */
export async function waitForHostSlot(url, { minGapMs = MIN_HOST_GAP_MS, now = Date.now, sleepImpl = defaultSleep } = {}) {
  const host = hostnameOf(url);
  const last = _lastCallAt.get(host);
  const t = now();
  if (last != null) {
    const wait = minGapMs - (t - last);
    if (wait > 0) await sleepImpl(wait);
  }
  _lastCallAt.set(host, now());
  return host;
}

export function resetHostThrottle() { _lastCallAt.clear(); }
