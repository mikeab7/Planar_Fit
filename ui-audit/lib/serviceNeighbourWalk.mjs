/* serviceNeighbourWalk.mjs — B1461730: when a wired ArcGIS parcel source goes missing (its
 * service reports zero layers, or its configured layer index 404s), walk its own REST server for
 * a same-shaped replacement instead of only reporting "the source failed."
 *
 * THE CASE THIS WAS BUILT FOR. Nevada's `County_Parcels_in_Nevada` service was republished ONE
 * SERVICE NAME OVER on the exact same host (arcgis.water.nv.gov), as `County_Parcels_In_
 * Nevada_Yellow`, with the old name left behind as an empty shell (0 layers; `/0` → 404). A probe
 * that only reports "Nevada is down" throws away information that was sitting one directory
 * listing away — the replacement was in the SAME FOLDER, on the SAME SERVER, with an
 * unmistakably related name.
 *
 * THE SHAPE. An ArcGIS Server REST directory answers `?f=json` at every level with the same
 * envelope: a service ROOT lists `{layers:[...]}`; a FOLDER lists `{folders:[...], services:
 * [{name, type}]}`. Given a failed layer URL, this:
 *   1. parses it into { restBase, folder, serviceName, serviceType } — pure, no network;
 *   2. lists the SAME folder's services first (the Nevada case: a rename never leaves its folder);
 *   3. falls back to every SIBLING folder at the server root if nothing plausible turns up there;
 *   4. scores every candidate service by NAME SIMILARITY to the failed one (shared tokens) — a
 *      whole unrelated service on the same host must not come back as a "candidate";
 *   5. for the surviving candidates, resolves a real layer (preferring a polygon layer named
 *      "parcel", falling back to the first polygon or the first layer) and MEASURES it — feature
 *      count, field names — the same query shape `probeSource` in probe-statewide-parcels.mjs uses
 *      (no `resultRecordCount`: a sibling on the same server may share the pagination-rejection
 *      quirk the Nevada Yellow service has, so this never sends one — see counties.js's own
 *      nv_statewide comment for the measured "Pagination is not supported" behavior);
 *   6. when the caller supplies the LAST KNOWN GOOD facts (feature count, field names — exactly
 *      what identified the Nevada replacement: an identical 1,394,188 count and field list),
 *      flags which candidates MATCH rather than merely resemble by name.
 *
 * Reports every plausible candidate it measured — confirmed matches and near-misses alike — and
 * NEVER silently narrows to one guess or auto-applies anything: a human (or the calling probe's
 * report) decides. Pure aside from the injected `fetchJson` (the SAME timeout-aware wrapper
 * probe-statewide-parcels.mjs already uses), so this is unit-testable with no real network.
 */

const trim = (u) => String(u || "").trim().replace(/\/+$/, "");

/* Parse an ArcGIS REST service or layer URL into its parts. Accepts either a LAYER url
 * (".../rest/services/Folder/Service/MapServer/0") or a bare SERVICE url (no trailing layer id).
 * Returns null for anything that doesn't look like an ArcGIS REST services URL. */
export function parseArcgisServiceUrl(url) {
  const m = /^(https?:\/\/[^/]+)((?:\/[^/]+)*\/rest\/services)\/(.+?)\/(MapServer|FeatureServer)(?:\/(\d+))?\/?$/i.exec(trim(url));
  if (!m) return null;
  const [, origin, restPath, folderAndService, serviceType, layerId] = m;
  const restBase = origin + restPath;
  const parts = folderAndService.split("/").filter(Boolean);
  const serviceName = parts.pop() || "";
  const folder = parts.join("/"); // "" when the service sits at the REST root
  return { restBase, folder, serviceName, serviceType, layerId: layerId != null ? Number(layerId) : null };
}

// Token-overlap (Jaccard) similarity between two service names — case/punctuation-insensitive, so
// "County_Parcels_in_Nevada" vs "County_Parcels_In_Nevada_Yellow" scores high on shared tokens
// (county/parcels/nevada) despite the different casing and the added "Yellow" token.
export function serviceNameSimilarity(a, b) {
  const tokenize = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const A = tokenize(a), B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

// A candidate must share at least this much of its name with the failed service to be worth
// measuring at all — filters out an unrelated service that merely lives on the same host.
export const MIN_NAME_SIMILARITY = 0.2;

async function listDirectory(url, { fetchJson }) {
  const r = await fetchJson(`${url}?f=json`);
  if (!r.ok || !r.json || r.json.error) return null;
  return { folders: Array.isArray(r.json.folders) ? r.json.folders : [], services: Array.isArray(r.json.services) ? r.json.services : [] };
}

// ArcGIS folder listings report a service's `name` either bare ("Foo") or folder-prefixed
// ("BaseLayers/Foo") depending on server version — build the full URL without double-prefixing.
function serviceEntryUrl(restBase, folder, entry) {
  const name = entry.name || "";
  const alreadyPrefixed = folder && (name === folder || name.startsWith(`${folder}/`));
  const path = alreadyPrefixed ? name : (folder ? `${folder}/${name}` : name);
  return `${restBase}/${path}/${entry.type}`;
}

// The bare service name is always the path segment right before /MapServer or /FeatureServer.
function serviceNameFromUrl(serviceUrl) {
  const parts = trim(serviceUrl).split("/");
  return parts[parts.length - 2] || "";
}

/* Resolve a candidate SERVICE url to one real layer — preferring a polygon layer named "parcel",
 * else the first polygon layer, else layer 0. Returns { layerId: null, layers: [] } for a service
 * that itself has zero layers (the exact Nevada failure mode, so a same-named empty shell
 * elsewhere on the server is reported as such rather than silently skipped), or null if the
 * service itself couldn't be reached at all. */
async function pickLayer(serviceUrl, { fetchJson }) {
  const r = await fetchJson(`${serviceUrl}?f=json`);
  if (!r.ok || !r.json || r.json.error) return null;
  const layers = Array.isArray(r.json.layers) ? r.json.layers : [];
  if (!layers.length) return { layerId: null, layers: [] };
  const polys = layers.filter((l) => /polygon/i.test(l.geometryType || ""));
  const named = polys.find((l) => /parcel/i.test(l.name || "")) || polys[0] || layers[0];
  return { layerId: named.id, layers };
}

/* Measure one parcel LAYER url — metadata, ArcGIS error body, feature count, field names. Checks
 * the JSON body at BOTH the metadata call and the count query (B1461729 — an HTTP 200 with a JSON
 * `{error}` body is a failure regardless of status), and never sends `resultRecordCount` (a
 * sibling on the same server may reject pagination just like the confirmed Nevada Yellow service
 * does — counties.js's nv_statewide comment). Exported as the one shared "is this parcel layer
 * actually alive" check — the neighbour walk's per-candidate measurement AND the periodic health
 * sweep (parcel-source-health-sweep.mjs) both call this rather than keeping two copies. */
export async function measureParcelLayer(layerUrl, { fetchJson }) {
  const meta = await fetchJson(`${layerUrl}?f=json`);
  if (!meta.ok || !meta.json) return { url: layerUrl, ok: false, error: meta.error || `HTTP ${meta.status}` };
  if (meta.json.error) return { url: layerUrl, ok: false, arcgisError: true, error: meta.json.error.message || "ArcGIS error" };
  const fieldNames = Array.isArray(meta.json.fields) ? meta.json.fields.map((f) => f.name) : [];
  const geometryType = meta.json.geometryType || null;
  const c = await fetchJson(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const countError = c.json && c.json.error;
  if (countError) return { url: layerUrl, ok: false, arcgisError: true, geometryType, fieldNames, error: countError.message || "ArcGIS error" };
  const featureCount = c.ok && c.json && typeof c.json.count === "number" ? c.json.count : null;
  return { url: layerUrl, ok: true, geometryType, fieldNames, featureCount };
}

/* Does a measured candidate match the LAST KNOWN GOOD facts for the source it's replacing? Feature
 * count within a small tolerance (a mosaic can drift a handful of parcels between republishes —
 * the Nevada replacement matched EXACTLY, 1,394,188, but that exactness isn't assumed here) and
 * every previously-seen field name still present. */
export function candidateMatchesKnownGood(candidate, knownGood) {
  if (!candidate || !candidate.ok) return false;
  if (!knownGood) return null; // nothing to compare against — the caller only wanted candidates listed
  const { featureCount, fieldNames } = knownGood;
  const countOk = featureCount == null || (candidate.featureCount != null &&
    Math.abs(candidate.featureCount - featureCount) <= Math.max(1, Math.round(featureCount * 0.005)));
  const fieldsOk = !fieldNames || !fieldNames.length ||
    fieldNames.every((f) => candidate.fieldNames.includes(f));
  return countOk && fieldsOk;
}

/* Walk a failed source's own REST server for a same-shaped replacement. `failedUrl` is the
 * service's configured layer (or service) URL; `knownGood` (optional) is `{featureCount,
 * fieldNames}` from the last time this source was healthy, used to flag CONFIRMED matches rather
 * than mere name-alikes. `fetchJson` is the caller's injected, timeout-aware fetch wrapper.
 *
 * Returns { ok, failedUrl, candidatesChecked, results: [...] } — every candidate this walk
 * measured, sorted best-first (a confirmed match, then by name similarity). Never throws for a
 * network/parse failure along the way; a directory that can't be listed is simply skipped, same
 * as every other injected-fetchJson helper in this repo (probeSource's own convention). */
export async function walkForReplacement({ failedUrl, knownGood, fetchJson, maxCandidates = 20, sameFolderOnly = false }) {
  const parsed = parseArcgisServiceUrl(failedUrl);
  if (!parsed) return { ok: false, reason: "not a recognizable ArcGIS REST services URL", failedUrl, candidatesChecked: 0, results: [] };
  const { restBase, folder, serviceName } = parsed;

  const candidateUrls = new Map(); // url -> raw name (for similarity scoring)
  const addFromDir = (dir, dirFolder) => {
    if (!dir) return;
    for (const svc of dir.services) {
      if (svc.type !== "MapServer" && svc.type !== "FeatureServer") continue;
      const url = serviceEntryUrl(restBase, dirFolder, svc);
      if (serviceNameFromUrl(url) === serviceName && dirFolder === folder) continue; // the failed service itself
      candidateUrls.set(url, svc.name || serviceNameFromUrl(url));
    }
  };

  const sameFolderUrl = folder ? `${restBase}/${folder}` : restBase;
  const sameFolderDir = await listDirectory(sameFolderUrl, { fetchJson });
  addFromDir(sameFolderDir, folder);

  if (!sameFolderOnly) {
    // Same-folder search comes first (the Nevada case: a rename never leaves its folder) — only
    // walk sibling folders too when the caller hasn't asked to stay local.
    const rootDir = folder ? await listDirectory(restBase, { fetchJson }) : sameFolderDir;
    for (const f of (rootDir && rootDir.folders) || []) {
      if (f === folder) continue;
      const sub = await listDirectory(`${restBase}/${f}`, { fetchJson });
      addFromDir(sub, f);
    }
  }

  const scored = [...candidateUrls.entries()]
    .map(([url, name]) => ({ url, name, similarity: serviceNameSimilarity(serviceName, serviceNameFromUrl(url) || name) }))
    .filter((c) => c.similarity >= MIN_NAME_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxCandidates);

  const results = [];
  for (const c of scored) {
    const picked = await pickLayer(c.url, { fetchJson });
    if (!picked) { results.push({ ...c, ok: false, reason: "service unreachable" }); continue; }
    if (picked.layerId == null) { results.push({ ...c, ok: false, reason: "service has zero layers" }); continue; }
    const layerUrl = `${c.url}/${picked.layerId}`;
    const measured = await measureParcelLayer(layerUrl, { fetchJson });
    const matchesKnownGood = candidateMatchesKnownGood(measured, knownGood);
    results.push({ ...c, ...measured, url: layerUrl, matchesKnownGood });
  }
  results.sort((a, b) => (b.matchesKnownGood === true) - (a.matchesKnownGood === true) || b.similarity - a.similarity);
  return { ok: true, failedUrl, candidatesChecked: results.length, results };
}
