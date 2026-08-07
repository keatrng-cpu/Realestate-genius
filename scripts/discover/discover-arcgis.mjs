#!/usr/bin/env node
/**
 * discover-arcgis.mjs — nationwide discovery of free, machine-readable
 * parcel / zoning services published by US jurisdictions.
 *
 * Calibration reference (verified live, no key, no licence gate):
 *   https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer/0
 *   38,857 parcel-level records with zoning joined (Zone1/Zone2), PUD number,
 *   conditional-use flag, lot width + depth, year built, units, value, owner.
 *
 * Pipeline
 *   1. SEARCH   ArcGIS Online item search (/sharing/rest/search) across every
 *               state x a term matrix. Optionally ArcGIS Hub DCAT-US feeds.
 *   2. PROBE    For each candidate service: root ?f=pjson -> layer ?f=pjson ->
 *               returnCountOnly -> a 25-row sample to check the zoning field
 *               is actually populated rather than an empty column.
 *   3. LOCATE   Layer extent centroid -> Census TIGERweb state + county FIPS.
 *   4. SCORE    Documented 0-100 rubric (see RUBRIC below).
 *   5. EMIT     src/lib/ingest/registry/sources.json + field-aliases.json
 *
 * Politeness: 3 concurrent requests max, inter-request delay, exponential
 * backoff on 429/5xx, descriptive User-Agent, 20s timeout.
 *
 * Resumable: every completed search query and every probed layer is appended
 * to scripts/discover/.cache/*.jsonl. Re-running skips finished work; pass
 * --reset to start clean, or --refresh to re-probe everything while keeping
 * the search results.
 *
 * Usage
 *   node scripts/discover/discover-arcgis.mjs                 # full run
 *   node scripts/discover/discover-arcgis.mjs --budget=25     # 25 min cap
 *   node scripts/discover/discover-arcgis.mjs --phase=search
 *   node scripts/discover/discover-arcgis.mjs --phase=probe --max-probe=400
 *   node scripts/discover/discover-arcgis.mjs --phase=emit    # rebuild JSON
 *   node scripts/discover/discover-arcgis.mjs --dcat          # + hub DCAT feeds
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_CONCEPTS, detectConcepts, detectStandardsFields } from './concepts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const CACHE = path.join(__dirname, '.cache');
const REGISTRY_DIR = path.join(REPO, 'src', 'lib', 'ingest', 'registry');

const F = {
  queriesDone: path.join(CACHE, 'queries-done.jsonl'),
  items: path.join(CACHE, 'items.jsonl'),
  probed: path.join(CACHE, 'probed.jsonl'),
  geo: path.join(CACHE, 'geo-cache.json'),
  hubs: path.join(CACHE, 'hubs.jsonl'),
};

const UA =
  'realestate-genius-discovery/0.1 (+open-data parcel/zoning inventory; contact: keatrng@gmail.com)';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};
const OPT = {
  phase: String(arg('phase', 'all')),
  budgetMin: Number(arg('budget', 30)),
  maxProbe: Number(arg('max-probe', 900)),
  perState: Number(arg('per-state', 60)),
  concurrency: Math.min(3, Number(arg('concurrency', 3))),
  dcat: Boolean(arg('dcat', false)),
  reset: Boolean(arg('reset', false)),
  refresh: Boolean(arg('refresh', false)),
  verbose: Boolean(arg('verbose', false)),
};
const DEADLINE = Date.now() + OPT.budgetMin * 60_000;
const outOfTime = () => Date.now() > DEADLINE;

// ---------------------------------------------------------------------------
// Scoring rubric — documented, and calibrated so Fargo lands ~95/100.
// ---------------------------------------------------------------------------
export const RUBRIC = {
  version: '1.0.0',
  maxScore: 100,
  weights: {
    kind_parcel_with_zoning: 40,
    kind_zoning_districts: 18,
    kind_parcels_only: 12,
    pud_flag: 8,
    cup_flag: 8,
    lot_width: 5,
    lot_depth: 5,
    lot_area: 4,
    record_count: 10, // log-scaled, full marks at >= 20,000 records
    structure_attrs: 10, // year_built / unit_count / building_sqft / assessed_value, 2.5 each
    identity_attrs: 5, // owner / situs_address / legal_description, 1.67 each
    freshness: 5, // last edit within 12 months
  },
  notes: [
    'A zoning-district BOUNDARY layer is not the same thing as dimensional standards.',
    'No score in this registry implies setbacks, height, FAR or ADU rules are available.',
  ],
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const vlog = (...a) => OPT.verbose && console.log('  ·', ...a);

function ensureDirs() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
}
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Global politeness gate: at most OPT.concurrency in-flight, spaced requests.
let inFlight = 0;
let lastStart = 0;
const MIN_GAP_MS = 120;
async function gate() {
  while (inFlight >= OPT.concurrency) await sleep(25);
  const wait = lastStart + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  inFlight++;
}

let reqCount = 0;
async function getJson(url, { retries = 3, timeoutMs = 20_000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await gate();
    try {
      reqCount++;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!res.ok) return { __httpError: res.status, __body: text.slice(0, 300) };
      try {
        return JSON.parse(text);
      } catch {
        return { __parseError: true, __body: text.slice(0, 300) };
      }
    } catch (err) {
      if (attempt === retries) return { __networkError: String(err && err.message ? err.message : err) };
      await sleep(800 * Math.pow(2, attempt) + Math.random() * 400);
    } finally {
      inFlight--;
    }
  }
  return { __networkError: 'exhausted' };
}

async function pool(items, worker, size = OPT.concurrency) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: size }, async () => {
    while (queue.length) {
      if (outOfTime()) return;
      const item = queue.shift();
      try {
        const r = await worker(item);
        if (r) results.push(r);
      } catch (e) {
        vlog('worker error', e && e.message);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
const STATES = [
  ['AL', 'Alabama', '01'], ['AK', 'Alaska', '02'], ['AZ', 'Arizona', '04'], ['AR', 'Arkansas', '05'],
  ['CA', 'California', '06'], ['CO', 'Colorado', '08'], ['CT', 'Connecticut', '09'], ['DE', 'Delaware', '10'],
  ['DC', 'District of Columbia', '11'], ['FL', 'Florida', '12'], ['GA', 'Georgia', '13'], ['HI', 'Hawaii', '15'],
  ['ID', 'Idaho', '16'], ['IL', 'Illinois', '17'], ['IN', 'Indiana', '18'], ['IA', 'Iowa', '19'],
  ['KS', 'Kansas', '20'], ['KY', 'Kentucky', '21'], ['LA', 'Louisiana', '22'], ['ME', 'Maine', '23'],
  ['MD', 'Maryland', '24'], ['MA', 'Massachusetts', '25'], ['MI', 'Michigan', '26'], ['MN', 'Minnesota', '27'],
  ['MS', 'Mississippi', '28'], ['MO', 'Missouri', '29'], ['MT', 'Montana', '30'], ['NE', 'Nebraska', '31'],
  ['NV', 'Nevada', '32'], ['NH', 'New Hampshire', '33'], ['NJ', 'New Jersey', '34'], ['NM', 'New Mexico', '35'],
  ['NY', 'New York', '36'], ['NC', 'North Carolina', '37'], ['ND', 'North Dakota', '38'], ['OH', 'Ohio', '39'],
  ['OK', 'Oklahoma', '40'], ['OR', 'Oregon', '41'], ['PA', 'Pennsylvania', '42'], ['RI', 'Rhode Island', '44'],
  ['SC', 'South Carolina', '45'], ['SD', 'South Dakota', '46'], ['TN', 'Tennessee', '47'], ['TX', 'Texas', '48'],
  ['UT', 'Utah', '49'], ['VT', 'Vermont', '50'], ['VA', 'Virginia', '51'], ['WA', 'Washington', '53'],
  ['WV', 'West Virginia', '54'], ['WI', 'Wisconsin', '55'], ['WY', 'Wyoming', '56'],
];
const FIPS_TO_USPS = Object.fromEntries(STATES.map(([a, , f]) => [f, a]));

// ---------------------------------------------------------------------------
// PHASE 1 — ArcGIS Online item search
// ---------------------------------------------------------------------------
const SEARCH_TERMS = [
  'zoning parcels',
  'zoning districts',
  'parcels',
  'zoning',
];

function buildQueries() {
  const qs = [];
  for (const [abbr, name] of STATES) {
    for (const term of SEARCH_TERMS) {
      qs.push({
        key: `${abbr}|${term}`,
        state: abbr,
        q: `(${term}) AND "${name}" AND (type:"Feature Service" OR type:"Map Service")`,
      });
    }
  }
  // Statewide aggregators are disproportionately valuable: one endpoint can
  // cover every jurisdiction in a state.
  for (const [abbr, name] of STATES) {
    qs.push({
      key: `${abbr}|statewide`,
      state: abbr,
      q: `(statewide parcels OR statewide cadastral OR "${name}" parcels) AND (type:"Feature Service" OR type:"Map Service")`,
    });
  }
  return qs;
}

async function phaseSearch() {
  const done = new Set(readJsonl(F.queriesDone).map((r) => r.key));
  const queries = buildQueries().filter((q) => !done.has(q.key));
  log(`[search] ${queries.length} queries pending (${done.size} already done)`);

  const seen = new Set(readJsonl(F.items).map((i) => i.id));

  await pool(queries, async (query) => {
    let start = 1;
    let collected = 0;
    while (start > 0 && collected < OPT.perState) {
      if (outOfTime()) return;
      const url =
        'https://www.arcgis.com/sharing/rest/search?f=json' +
        `&num=100&start=${start}` +
        '&sortField=numViews&sortOrder=desc' +
        `&q=${encodeURIComponent(query.q)}`;
      const j = await getJson(url);
      if (!j || !Array.isArray(j.results)) break;
      for (const r of j.results) {
        if (!r.url || seen.has(r.id)) continue;
        if (!looksRelevant(r)) continue;
        seen.add(r.id);
        appendJsonl(F.items, {
          id: r.id,
          title: r.title,
          owner: r.owner,
          orgId: r.orgId ?? null,
          type: r.type,
          url: r.url,
          tags: r.tags || [],
          snippet: r.snippet || null,
          description: (r.description || '').slice(0, 1200) || null,
          licenseInfo: (r.licenseInfo || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) || null,
          accessInformation: r.accessInformation || null,
          access: r.access || null,
          extent: r.extent || null,
          modified: r.modified || null,
          numViews: r.numViews || 0,
          hintState: query.state,
        });
        collected++;
      }
      start = j.nextStart > 0 ? j.nextStart : -1;
    }
    appendJsonl(F.queriesDone, { key: query.key, at: new Date().toISOString() });
    vlog(`search ${query.key}: +${collected}`);
  });

  log(`[search] item pool now ${seen.size} unique items`);
}

const RELEVANT_RE = /\b(zon|parcel|cadastr|land ?use|landuse|property|tax ?lot|lot line)/i;
const IRRELEVANT_RE = /\b(hydrant|sewer|storm ?water|water ?main|traffic|bike|trail|tree|crime|election|precinct|school ?bus|snow|pavement|bridge|sign ?inventory|light ?pole|manhole|wetland|soil|flood ?zone only)\b/i;

function looksRelevant(item) {
  const hay = `${item.title || ''} ${(item.tags || []).join(' ')} ${item.snippet || ''}`;
  if (IRRELEVANT_RE.test(hay) && !/zon|parcel/i.test(item.title || '')) return false;
  return RELEVANT_RE.test(hay);
}

// ---------------------------------------------------------------------------
// PHASE 1b — ArcGIS Hub DCAT-US feeds (optional, --dcat)
// ---------------------------------------------------------------------------
/**
 * Hub site domains are NOT derivable from the org id — they are arbitrary
 * (`gis-fcgmd.opendata.arcgis.com`, `equitable-property-value-PopeCounty.hub.arcgis.com`,
 * `fiscalhub.gis.cuyahogacounty.gov`). The authoritative list is the `url` field
 * on `Hub Site Application` items in ArcGIS Online.
 */
async function discoverHubDomains() {
  const hosts = new Set();
  const queries = [
    'type:"Hub Site Application" AND (zoning OR parcels OR "land use")',
    'type:"Hub Site Application" AND (GIS OR "open data") AND (county OR city)',
    'type:"Site Application" AND (zoning OR parcels)',
  ];
  for (const q of queries) {
    let start = 1;
    while (start > 0 && start < 800) {
      if (outOfTime()) break;
      const j = await getJson(
        `https://www.arcgis.com/sharing/rest/search?f=json&num=100&start=${start}&q=${encodeURIComponent(q)}`
      );
      if (!j || !Array.isArray(j.results)) break;
      for (const r of j.results) {
        if (!r.url) continue;
        try {
          hosts.add(new URL(r.url.startsWith('http') ? r.url : `https://${r.url}`).host);
        } catch {
          /* malformed url on the item */
        }
      }
      start = j.nextStart > 0 ? j.nextStart : -1;
    }
  }
  return [...hosts];
}

async function phaseDcat() {
  const items = readJsonl(F.items);
  const doneHubs = new Set(readJsonl(F.hubs).map((h) => h.host));
  const hosts = (await discoverHubDomains()).filter((h) => !doneHubs.has(h));

  log(`[dcat] ${hosts.length} hub domains to fetch (${doneHubs.size} already done)`);
  const seen = new Set(items.map((i) => i.id));

  await pool(hosts, async (host) => {
    if (outOfTime()) return;
    const j = await getJson(`https://${host}/api/feed/dcat-us/1.1.json`, { retries: 1, timeoutMs: 25_000 });
    const datasets = Array.isArray(j && j.dataset) ? j.dataset : [];
    let added = 0;
    for (const d of datasets) {
      const title = d.title || '';
      if (!RELEVANT_RE.test(title + ' ' + (d.keyword || []).join(' '))) continue;
      const dist = (d.distribution || []).find(
        (x) => /GeoService|esri|FeatureServer|MapServer/i.test(`${x.format || ''} ${x.accessURL || ''}`)
      );
      const url = dist && (dist.accessURL || dist.downloadURL);
      if (!url || !/(Feature|Map)Server/i.test(url)) continue;
      const id = `dcat:${host}:${d.identifier || title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      appendJsonl(F.items, {
        id,
        title,
        owner: host,
        orgId: null,
        type: 'Feature Service',
        url,
        tags: d.keyword || [],
        snippet: (d.description || '').slice(0, 300) || null,
        description: (d.description || '').slice(0, 1200) || null,
        licenseInfo: d.license || null,
        accessInformation: d.publisher && d.publisher.name ? d.publisher.name : null,
        access: 'public',
        extent: null,
        modified: d.modified ? Date.parse(d.modified) || null : null,
        numViews: 0,
        hintState: null,
        viaDcat: host,
      });
      added++;
    }
    appendJsonl(F.hubs, { host, datasets: datasets.length, added, at: new Date().toISOString() });
    vlog(`dcat ${host}: ${datasets.length} datasets, +${added}`);
  });
}

// ---------------------------------------------------------------------------
// PHASE 2 — probe services
// ---------------------------------------------------------------------------
const LAYER_NAME_RE = /(zon|parcel|cadastr|land ?use|landuse|tax ?lot|property)/i;

/** Prioritise candidates: joined-looking titles first, then popularity. */
function prioritise(items) {
  const scoreItem = (it) => {
    const t = `${it.title || ''} ${it.snippet || ''}`.toLowerCase();
    let s = 0;
    if (/zon/.test(t) && /parcel/.test(t)) s += 1000; // the Fargo shape
    else if (/zon/.test(t)) s += 500;
    else if (/parcel/.test(t)) s += 300;
    if (/statewide|state ?of/.test(t)) s += 200;
    if (/county/.test(t)) s += 40;
    s += Math.min(200, Math.log10(1 + (it.numViews || 0)) * 40);
    return s;
  };
  // Spread across states so we get breadth, not 400 Texas layers.
  const byState = new Map();
  for (const it of items) {
    const k = it.hintState || 'ZZ';
    if (!byState.has(k)) byState.set(k, []);
    byState.get(k).push(it);
  }
  for (const arr of byState.values()) arr.sort((a, b) => scoreItem(b) - scoreItem(a));
  const out = [];
  let round = 0;
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const arr of byState.values()) {
      if (round < arr.length) {
        out.push(arr[round]);
        anyLeft = true;
      }
    }
    round++;
  }
  return out;
}

function normaliseServiceUrl(u) {
  return String(u).replace(/\/+$/, '').replace(/\?.*$/, '');
}

/** Hand-verified endpoints that AGO item search cannot see (self-hosted ArcGIS Server). */
function loadSeeds() {
  const p = path.join(__dirname, 'seeds.json');
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (j.seeds || []).map((s, i) => ({
      id: `seed:${i}:${s.url}`,
      title: s.title || null,
      owner: s.accessInformation || null,
      type: 'Feature Service',
      url: s.url,
      tags: [],
      snippet: s.why || null,
      description: s.why || null,
      licenseInfo: s.licenseInfo || null,
      accessInformation: s.accessInformation || null,
      access: 'public',
      extent: null,
      modified: null,
      numViews: 1e9, // always probe seeds first
      hintState: s.hintState || null,
      isSeed: true,
    }));
  } catch {
    return [];
  }
}

async function phaseProbe() {
  const items = [...loadSeeds(), ...readJsonl(F.items)];
  const alreadyProbed = new Set(OPT.refresh ? [] : readJsonl(F.probed).map((p) => p.serviceUrl));

  // Dedup services, keeping the richest item metadata per URL.
  const byService = new Map();
  for (const it of items) {
    if (!it.url) continue;
    const u = normaliseServiceUrl(it.url);
    if (!/(Feature|Map)Server/i.test(u)) continue;
    if (!byService.has(u) || (it.numViews || 0) > (byService.get(u).numViews || 0)) {
      byService.set(u, { ...it, url: u });
    }
  }
  const candidates = prioritise([...byService.values()]).filter((c) => !alreadyProbed.has(c.url));
  const todo = candidates.slice(0, OPT.maxProbe);
  log(`[probe] ${byService.size} unique services; ${alreadyProbed.size} already probed; probing ${todo.length}`);

  let n = 0;
  await pool(todo, async (item) => {
    if (outOfTime()) return;
    const rec = await probeService(item);
    appendJsonl(F.probed, rec);
    n++;
    if (n % 20 === 0) log(`[probe] ${n}/${todo.length} (${reqCount} requests, ${Math.round((DEADLINE - Date.now()) / 60000)} min left)`);
  });
  log(`[probe] done, ${n} services this run`);
}

async function probeService(item) {
  const base = {
    serviceUrl: item.url,
    itemId: item.id,
    itemTitle: item.title || null,
    owner: item.owner || null,
    licenseInfo: item.licenseInfo || null,
    accessInformation: item.accessInformation || null,
    itemModified: item.modified || null,
    hintState: item.hintState || null,
    numViews: item.numViews || 0,
    probedAt: new Date().toISOString(),
    layers: [],
  };

  // A URL may already point at a layer.
  const layerSuffix = item.url.match(/\/(\d+)$/);
  let layerUrls = [];

  if (layerSuffix) {
    layerUrls = [{ url: item.url, id: Number(layerSuffix[1]), name: item.title }];
  } else {
    const root = await getJson(`${item.url}?f=pjson`);
    if (!root || root.__networkError || root.__httpError || root.__parseError) {
      base.error = root && (root.__networkError || `http ${root.__httpError}` || 'parse');
      return base;
    }
    if (root.error) {
      base.error = root.error.message || 'service error';
      base.requiresAuth = /token|unauthor|forbidden/i.test(JSON.stringify(root.error));
      return base;
    }
    const layers = [...(root.layers || []), ...(root.tables || [])];
    const named = layers.filter((l) => LAYER_NAME_RE.test(l.name || ''));
    const pick = (named.length ? named : layers).slice(0, 4);
    layerUrls = pick.map((l) => ({ url: `${item.url}/${l.id}`, id: l.id, name: l.name }));
    base.serviceLayerCount = layers.length;
  }

  for (const lyr of layerUrls) {
    if (outOfTime()) break;
    const probed = await probeLayer(lyr.url, lyr.id);
    if (probed) base.layers.push(probed);
  }
  return base;
}

async function probeLayer(layerUrl, layerId) {
  const meta = await getJson(`${layerUrl}?f=pjson`);
  if (!meta || meta.__networkError || meta.__httpError || meta.__parseError) {
    return { layerUrl, layerId, ok: false, error: meta && (meta.__networkError || `http ${meta.__httpError}` || 'parse') };
  }
  if (meta.error) {
    return {
      layerUrl,
      layerId,
      ok: false,
      error: meta.error.message || 'layer error',
      requiresAuth: /token|unauthor|forbidden/i.test(JSON.stringify(meta.error)),
    };
  }
  const fields = (meta.fields || []).map((f) => f.name);
  if (!fields.length) return { layerUrl, layerId, ok: false, error: 'no fields' };

  const { found, aliases } = detectConcepts(fields);

  // Record count.
  const cntJson = await getJson(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const recordCount =
    cntJson && typeof cntJson.count === 'number'
      ? cntJson.count
      : cntJson && cntJson.properties && typeof cntJson.properties.count === 'number'
        ? cntJson.properties.count
        : null;

  // Sample rows to confirm the zoning column is actually populated.
  let zoningNonNullRatio = null;
  let zoningSampleValues = [];
  if (found.zoning_code && recordCount) {
    const f = encodeURIComponent(found.zoning_code);
    const s = await getJson(
      `${layerUrl}/query?where=1%3D1&outFields=${f}&resultRecordCount=25&returnGeometry=false&f=json`
    );
    const feats = (s && s.features) || [];
    if (feats.length) {
      const vals = feats.map((ft) => (ft.attributes ? ft.attributes[found.zoning_code] : null));
      const nonNull = vals.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
      zoningNonNullRatio = Number((nonNull.length / vals.length).toFixed(3));
      zoningSampleValues = [...new Set(nonNull.map((v) => String(v).slice(0, 24)))].slice(0, 8);
    }
  }

  return {
    layerUrl,
    layerId,
    ok: true,
    layerName: meta.name || null,
    geometryType: meta.geometryType || null,
    maxRecordCount: meta.maxRecordCount ?? null,
    standardMaxRecordCount: meta.standardMaxRecordCount ?? null,
    supportsPagination: Boolean(
      meta.advancedQueryCapabilities && meta.advancedQueryCapabilities.supportsPagination
    ),
    capabilities: meta.capabilities || null,
    extent: extentToBbox(meta.extent),
    lastEditDate:
      meta.editingInfo && meta.editingInfo.lastEditDate
        ? new Date(meta.editingInfo.lastEditDate).toISOString()
        : null,
    copyrightText: meta.copyrightText || null,
    fields,
    concepts: found,
    aliases,
    recordCount,
    /** Which field the non-null sample was taken from, so emit can re-derive safely. */
    zoningFieldSampled: found.zoning_code || null,
    zoningNonNullRatio,
    zoningSampleValues,
  };
}

function extentToBbox(ext) {
  if (!ext || typeof ext.xmin !== 'number') return null;
  const wkid =
    (ext.spatialReference && (ext.spatialReference.latestWkid || ext.spatialReference.wkid)) || null;
  if (wkid === 4326) return [ext.xmin, ext.ymin, ext.xmax, ext.ymax];
  if (wkid === 102100 || wkid === 3857) {
    const toLon = (x) => (x / 20037508.34) * 180;
    const toLat = (y) => {
      const l = (y / 20037508.34) * 180;
      return (180 / Math.PI) * (2 * Math.atan(Math.exp((l * Math.PI) / 180)) - Math.PI / 2);
    };
    return [toLon(ext.xmin), toLat(ext.ymin), toLon(ext.xmax), toLat(ext.ymax)];
  }
  return null; // projected state-plane etc: fall back to the AGO item extent
}

// ---------------------------------------------------------------------------
// PHASE 3 — locate via Census TIGERweb (real FIPS, not a guess)
// ---------------------------------------------------------------------------
const TIGER_COUNTY =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/13/query';

let geoCache = {};
function loadGeoCache() {
  if (fs.existsSync(F.geo)) {
    try {
      geoCache = JSON.parse(fs.readFileSync(F.geo, 'utf8'));
    } catch {
      geoCache = {};
    }
  }
}
function saveGeoCache() {
  fs.writeFileSync(F.geo, JSON.stringify(geoCache, null, 0));
}

async function locate(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > -60 || lat < 15 || lat > 72) return null;
  const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  if (key in geoCache) return geoCache[key];
  const geom = encodeURIComponent(JSON.stringify({ x: lon, y: lat }));
  const url =
    `${TIGER_COUNTY}?geometry=${geom}&geometryType=esriGeometryPoint&inSR=4326` +
    '&spatialRel=esriSpatialRelIntersects&outFields=GEOID,STATE,NAME&returnGeometry=false&f=json';
  const j = await getJson(url, { retries: 2 });
  const f = j && j.features && j.features[0];
  const val = f
    ? { countyFips: f.attributes.GEOID, stateFips: f.attributes.STATE, countyName: f.attributes.NAME }
    : null;
  geoCache[key] = val;
  return val;
}

/**
 * Real state bounding boxes from TIGERweb, cached alongside the geo cache.
 * "Is this layer statewide?" cannot be answered by a fixed degree span —
 * Vermont is 1.5 degrees wide and San Bernardino County is 2.5. Compare the
 * layer extent against the state it sits in instead.
 */
const TIGER_STATES =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/12/query';

async function loadStateExtents() {
  if (geoCache.__stateExtents && Object.keys(geoCache.__stateExtents).length >= 50) {
    return geoCache.__stateExtents;
  }
  const out = geoCache.__stateExtents || {};
  await pool(
    STATES.filter(([, , fips]) => !out[fips]),
    async ([, , fips]) => {
      const j = await getJson(
        `${TIGER_STATES}?where=${encodeURIComponent(`STATE='${fips}'`)}&returnExtentOnly=true&outSR=4326&f=json`
      );
      const e = j && (j.extent || (j.featureExtent ?? null));
      if (e && Number.isFinite(e.xmin)) out[fips] = [e.xmin, e.ymin, e.xmax, e.ymax];
    }
  );
  geoCache.__stateExtents = out;
  saveGeoCache();
  log(`[geo] state extents cached: ${Object.keys(out).length}`);
  return out;
}

function bboxArea(b) {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}
function bboxOverlapArea(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Statewide if the layer's footprint covers most of its state's footprint, or
 * the publisher says so in the title. `coverage` is returned for transparency.
 */
function assessStatewide(bbox, stateFips, stateExtents, title) {
  if (/\bstatewide\b|\bstate of\b|\ball\s+\w+\s+parcels\b/i.test(title || '')) {
    return { isStatewide: true, stateCoverage: null };
  }
  if (!bbox || !stateFips || !stateExtents[stateFips]) return { isStatewide: false, stateCoverage: null };
  const sb = stateExtents[stateFips];
  const sa = bboxArea(sb);
  if (!sa) return { isStatewide: false, stateCoverage: null };
  const cov = Number((bboxOverlapArea(bbox, sb) / sa).toFixed(3));
  return { isStatewide: cov >= 0.55, stateCoverage: cov };
}

const TIGER_PLACES =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query';

/**
 * Census incorporated place containing a point. Only meaningful for layers
 * whose footprint is small enough to be a single municipality — a county-wide
 * parcel layer's centroid lands in some arbitrary town inside it.
 */
async function locatePlace(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const cache = geoCache.__places || (geoCache.__places = {});
  const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  if (key in cache) return cache[key];
  const geom = encodeURIComponent(JSON.stringify({ x: lon, y: lat }));
  const j = await getJson(
    `${TIGER_PLACES}?geometry=${geom}&geometryType=esriGeometryPoint&inSR=4326` +
      '&spatialRel=esriSpatialRelIntersects&outFields=GEOID,BASENAME&returnGeometry=false&f=json'
  );
  const f = j && j.features && j.features[0];
  cache[key] = f ? { placeFips: f.attributes.GEOID, placeName: f.attributes.BASENAME } : null;
  return cache[key];
}

/** Roughly one municipality wide: ~0.5 degrees is about 55 km of latitude. */
const SINGLE_PLACE_SPAN_DEG = 0.5;

// ---------------------------------------------------------------------------
// PHASE 4 — classify + score
// ---------------------------------------------------------------------------
function classify(layer) {
  const c = layer.concepts;
  const zoningPopulated =
    Boolean(c.zoning_code) && (layer.zoningNonNullRatio === null || layer.zoningNonNullRatio >= 0.2);
  const hasZoning = zoningPopulated;
  const parcelIdentity = Boolean(
    c.parcel_id || c.owner || c.situs_address || c.assessed_value || c.legal_description
  );
  // A parcel fabric has one row per parcel; a district layer has tens to a few
  // hundred polygons. Use that as a tiebreaker when the fields are ambiguous.
  const parcelScale = (layer.recordCount || 0) >= 1000;

  if (hasZoning && parcelIdentity) return { kind: 'parcel_with_zoning', confidence: 'high' };
  if (hasZoning && parcelScale) {
    // Zoning attribute, no owner/APN/address column, but far too many polygons
    // to be a district map. Almost certainly parcel-level — but say "inferred",
    // do not assert it.
    return { kind: 'parcel_with_zoning', confidence: 'inferred' };
  }
  if (hasZoning) return { kind: 'zoning_districts', confidence: 'high' };
  if (parcelIdentity) return { kind: 'parcels_only', confidence: 'high' };
  if (/parcel|cadastr|tax ?lot/i.test(layer.layerName || '')) {
    return { kind: 'parcels_only', confidence: 'inferred' };
  }
  return { kind: 'other', confidence: 'high' };
}

function scoreLayer(layer, kind) {
  const w = RUBRIC.weights;
  const c = layer.concepts;
  const b = {};

  b.kind =
    kind === 'parcel_with_zoning'
      ? w.kind_parcel_with_zoning
      : kind === 'zoning_districts'
        ? w.kind_zoning_districts
        : kind === 'parcels_only'
          ? w.kind_parcels_only
          : 0;

  b.pud_flag = c.pud_flag ? w.pud_flag : 0;
  b.cup_flag = c.cup_flag ? w.cup_flag : 0;
  b.lot_width = c.lot_width ? w.lot_width : 0;
  b.lot_depth = c.lot_depth ? w.lot_depth : 0;
  b.lot_area = c.lot_area ? w.lot_area : 0;

  const rc = layer.recordCount || 0;
  b.record_count = rc <= 0 ? 0 : Math.min(w.record_count, (Math.log10(rc) / Math.log10(20000)) * w.record_count);
  b.record_count = Number(b.record_count.toFixed(2));

  const structure = ['year_built', 'unit_count', 'building_sqft', 'assessed_value'].filter((k) => c[k]).length;
  b.structure_attrs = Number(((structure / 4) * w.structure_attrs).toFixed(2));

  const identity = ['owner', 'situs_address', 'legal_description'].filter((k) => c[k]).length;
  b.identity_attrs = Number(((identity / 3) * w.identity_attrs).toFixed(2));

  const edited = layer.lastEditDate ? Date.parse(layer.lastEditDate) : null;
  b.freshness = edited && Date.now() - edited < 365 * 24 * 3600 * 1000 ? w.freshness : 0;

  const total = Object.values(b).reduce((a, x) => a + x, 0);
  return { score: Math.round(Math.min(100, total)), breakdown: b };
}

/**
 * Every ArcGIS Online hosted service URL embeds its org id:
 *   https://services5.arcgis.com/HmZrfXtpyBP9VLYQ/arcgis/rest/services/...
 * `/sharing/rest/portals/<id>` turns that into the real publisher name
 * ("City of Balch Springs", "The County of Sonoma"). That is ground truth for
 * "whose data is this", which item titles frequently are not.
 */
function orgIdFromUrl(url) {
  const m = String(url).match(/^https?:\/\/(?:services|tiles|features)\d*\.arcgis\.com\/([A-Za-z0-9]{10,})\//i);
  return m ? m[1] : null;
}

async function loadOrgNames(orgIds) {
  const cache = geoCache.__orgNames || (geoCache.__orgNames = {});
  const todo = [...new Set(orgIds)].filter((id) => id && !(id in cache));
  if (!todo.length) return cache;
  log(`[org] resolving ${todo.length} ArcGIS org names`);
  await pool(todo, async (id) => {
    const j = await getJson(`https://www.arcgis.com/sharing/rest/portals/${id}?f=json`, { retries: 2 });
    cache[id] = j && typeof j.name === 'string' ? j.name.replace(/\s+/g, ' ').trim() || null : null;
  });
  saveGeoCache();
  return cache;
}

/** "The County of Sonoma" -> "Sonoma County"; "City of Fargo, ND" -> "City of Fargo". */
function tidyPublisher(name) {
  if (!name) return null;
  let s = cleanName(name).replace(/,\s*[A-Z]{2}$/, '');
  const county = s.match(/^(?:The\s+)?County of\s+(.+)$/i);
  if (county) return `${county[1].trim()} County`;
  s = s.replace(/^The\s+/i, '');
  return s;
}

/** A run of 1-3 capitalised words — enough for "Sunland Park", not the whole title. */
const PROPER = '[A-Z][A-Za-z.\'\\-]+(?:\\s+(?:de|del|la|las|los|of|upon)\\s+[A-Z][A-Za-z.\'\\-]+|\\s+[A-Z][A-Za-z.\'\\-]+){0,2}';
const NOISE_WORDS =
  /\b(zoning|zone|parcel|parcels|gis|map|maps|data|layer|feature|service|web|public|open|gdb|wfl\d*|boundaries|boundary|gislayers|hosted|liabilit\w*|warrant\w*|accuracy|disclaimer|responsibilit\w*|information|purposes|consultants?|llc|inc|university|department|copyright)\b/i;

function cleanName(s) {
  return String(s)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,\-]+$/, '');
}

function inferJurisdiction(item, layer, geo, orgName, place) {
  const org = tidyPublisher(orgName) || '';
  const title = cleanName(item.itemTitle || '');
  const owner = tidyPublisher(item.accessInformation) || '';
  const layerName = cleanName(layer.layerName || '');

  // The ArcGIS org name is the publisher of record. Use it verbatim when it
  // already names a jurisdiction.
  if (org && /^(City|Town|Village|Borough|Township) of\s+\S/i.test(org)) return { name: org, type: 'city' };
  if (org && /\bCounty\b/i.test(org)) return { name: org, type: 'county' };

  // Attribution ("City of Fargo, ND") is next most reliable, then the title.
  // Cap the length: `accessInformation` is often a paragraph of disclaimer, and
  // "...assumes no liabilities. County of Niagara..." yields "Liabilities County".
  const ordered = [owner, org, title, layerName].filter((t) => t && t.length <= 90);

  for (const text of ordered) {
    const m = text.match(new RegExp(`\\b(City|Town|Village|Borough|Township)\\s+of\\s+(${PROPER})`));
    if (m) {
      const place = m[2].split(/\s+/).filter((w) => !NOISE_WORDS.test(w)).join(' ');
      if (place) return { name: `${m[1]} of ${place}`, type: 'city' };
    }
  }
  for (const text of ordered) {
    const m = text.match(new RegExp(`\\b(${PROPER})\\s+County\\b`));
    if (m) {
      const place = m[1].split(/\s+/).filter((w) => !NOISE_WORDS.test(w)).join(' ');
      if (place) return { name: `${place} County`, type: 'county' };
    }
  }
  if (/\bstatewide\b|\bstate of\b/i.test(`${title} ${owner} ${org}`)) {
    return { name: org || owner || title, type: 'state' };
  }
  // Nothing in the metadata names a jurisdiction. If the footprint is one
  // municipality wide, the Census place containing it is verifiable truth.
  if (place && place.placeName) {
    return { name: `City of ${place.placeName}`, type: 'city', fromCensusPlace: true };
  }
  // Otherwise fall back to the Census county — a real, verifiable geographic
  // label — and keep the publisher (which may be a university or a consultancy
  // hosting the data) in `publisherOrg` rather than pretending it is the
  // jurisdiction.
  if (geo && geo.countyName) {
    return { name: `${geo.countyName} (jurisdiction unresolved)`, type: 'unknown' };
  }
  // A named publisher that is not obviously a city or county — a state agency,
  // a council of governments, a university hosting the data.
  if (org) return { name: org, type: 'regional' };
  const fallback = owner || title || layerName || 'Unknown';
  return { name: fallback.slice(0, 80), type: 'unknown' };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ---------------------------------------------------------------------------
// PHASE 5 — emit registry
// ---------------------------------------------------------------------------
async function phaseEmit() {
  loadGeoCache();
  const stateExtents = await loadStateExtents();
  const probed = readJsonl(F.probed);
  const orgNames = await loadOrgNames(probed.map((r) => orgIdFromUrl(r.serviceUrl)).filter(Boolean));
  const items = new Map(
    [...loadSeeds(), ...readJsonl(F.items)].map((i) => [normaliseServiceUrl(i.url || ''), i])
  );

  /** @type {any[]} */
  const sources = [];
  const aliasTable = new Map(); // concept -> Map(field -> count)
  const stats = {
    servicesProbed: probed.length,
    servicesResponding: 0,
    servicesAuthRequired: 0,
    servicesFailed: 0,
    layersProbed: 0,
    layersOk: 0,
  };
  const seenLayerUrls = new Set();

  for (const rec of probed) {
    if (rec.error) {
      stats.servicesFailed++;
      if (rec.requiresAuth) stats.servicesAuthRequired++;
      continue;
    }
    stats.servicesResponding++;
    for (const layer of rec.layers || []) {
      stats.layersProbed++;
      if (!layer.ok) {
        if (layer.requiresAuth) stats.servicesAuthRequired++;
        continue;
      }
      stats.layersOk++;
      if (seenLayerUrls.has(layer.layerUrl)) continue;
      seenLayerUrls.add(layer.layerUrl);

      // Re-derive concepts from the stored field list rather than trusting the
      // mapping captured at probe time. The detection rules evolve; the crawl
      // is expensive. This keeps them decoupled.
      const redetected = detectConcepts(layer.fields || []);
      layer.concepts = redetected.found;
      layer.aliases = redetected.aliases;
      // The non-null sample was taken against whichever field probe-time rules
      // chose. If that is no longer the chosen field, we do not know the ratio.
      if (layer.zoningFieldSampled && layer.zoningFieldSampled !== layer.concepts.zoning_code) {
        layer.zoningNonNullRatio = null;
        layer.zoningSampleValues = [];
      }

      const { kind, confidence } = classify(layer);
      if (kind === 'other') continue;
      if (!layer.recordCount) continue; // an empty layer is not ingestible

      for (const a of layer.aliases || []) {
        if (!aliasTable.has(a.concept)) aliasTable.set(a.concept, new Map());
        const m = aliasTable.get(a.concept);
        m.set(a.field, (m.get(a.field) || 0) + 1);
      }

      const { score, breakdown } = scoreLayer(layer, kind);
      const item = items.get(rec.serviceUrl) || {};
      const bbox = layer.extent || itemExtentToBbox(item.extent) || null;
      let geo = null;
      if (bbox) geo = await locate((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2);

      const stateFips = geo ? geo.stateFips : null;
      const state = stateFips ? FIPS_TO_USPS[stateFips] || null : rec.hintState || null;
      const { isStatewide, stateCoverage } = assessStatewide(
        bbox,
        stateFips,
        stateExtents,
        `${rec.itemTitle || ''} ${layer.layerName || ''}`
      );
      const orgName = orgNames[orgIdFromUrl(rec.serviceUrl)] || null;

      // For a footprint small enough to be one municipality, the Census place
      // containing the centroid is verifiable ground truth for "which city".
      let place = null;
      if (bbox && !isStatewide) {
        const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
        if (span > 0 && span <= SINGLE_PLACE_SPAN_DEG) {
          place = await locatePlace((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2);
        }
      }

      const jur = inferJurisdiction(rec, layer, geo, orgName, place);
      if (isStatewide && (jur.type === 'unknown' || jur.type === 'county')) {
        // A statewide layer is not "Sheridan County" just because its centroid
        // happens to land there.
        jur.name = state ? `State of ${state}` : jur.name;
        jur.type = 'state';
      }

      sources.push({
        id: `${(state || 'us').toLowerCase()}-${slugify(jur.name)}-${slugify(layer.layerName || 'layer')}-${layer.layerId}`,
        jurisdiction: jur.name,
        jurisdictionType: isStatewide ? 'state' : jur.type,
        state,
        stateFips,
        countyFips: geo && !isStatewide ? geo.countyFips : null,
        countyName: geo && !isStatewide ? geo.countyName : null,
        /** 7-digit Census place FIPS, when the footprint resolves to one municipality. */
        placeFips: place ? place.placeFips : null,
        /**
         * True when the jurisdiction name came from a Census place lookup rather
         * than from publisher metadata — i.e. it is the place the data covers,
         * which may differ from the body that adopted the zoning.
         */
        jurisdictionFromCensusPlace: Boolean(jur.fromCensusPlace),
        serviceUrl: rec.serviceUrl,
        serviceType: /FeatureServer/i.test(rec.serviceUrl) ? 'FeatureServer' : 'MapServer',
        layerId: layer.layerId,
        layerUrl: layer.layerUrl,
        layerName: layer.layerName,
        sourceKind: kind,
        /**
         * 'high'     — the field list proves it (zoning attribute + parcel identity).
         * 'inferred' — deduced from record count or layer name; verify before trusting.
         */
        sourceKindConfidence: confidence,
        recordCount: layer.recordCount,
        maxRecordCount: layer.maxRecordCount,
        supportsPagination: layer.supportsPagination,
        requiresAuth: false,
        geometryType: layer.geometryType,
        fieldCount: layer.fields.length,
        fields: layer.fields,
        concepts: layer.concepts,
        conceptCoverage: Number(
          (CANONICAL_CONCEPTS.filter((c) => layer.concepts[c]).length / CANONICAL_CONCEPTS.length).toFixed(3)
        ),
        zoningFieldNonNullRatio: layer.zoningNonNullRatio,
        zoningSampleValues: layer.zoningSampleValues || [],
        score,
        scoreBreakdown: breakdown,
        lastEditDate: layer.lastEditDate,
        licenseInfo: rec.licenseInfo || layer.copyrightText || null,
        attribution: rec.accessInformation || null,
        itemId: rec.itemId,
        itemTitle: rec.itemTitle,
        owner: rec.owner,
        /** Publisher of record, from the ArcGIS org that hosts the service. */
        publisherOrg: orgName,
        /**
         * Which discovery channel surfaced this. `hub-dcat` entries came from an
         * ArcGIS Hub DCAT-US feed and are disproportionately self-hosted ArcGIS
         * Server instances that the ArcGIS Online item search does not index.
         */
        discoveredVia: item.viaDcat ? 'hub-dcat' : item.isSeed ? 'seed' : 'arcgis-online-search',
        hubDomain: item.viaDcat || null,
        extent: bbox,
        isStatewide,
        /** Share of the state's bounding box this layer's extent covers, 0..1. */
        stateCoverage,
        // Deliberately a literal. A boundary/attribute layer never contains the
        // ordinance's dimensional standards.
        providesDimensionalStandards: false,
        /**
         * Rare: columns that look like setbacks / height / FAR / min lot size.
         * A partial, unverified slice of one ordinance — never a substitute for
         * reading it. Non-empty here means "start with this one", not "done".
         */
        partialStandardsFields: detectStandardsFields(layer.fields || []),
        standardsNote:
          'Geometry and attributes only. Setbacks, height, FAR, lot-coverage, parking and ADU rules are NOT reliably in this source and require a human reading the ordinance (~16-34 h per jurisdiction). A non-empty partialStandardsFields is a head start, not a substitute.',
        verifiedAt: rec.probedAt,
      });
    }
  }
  saveGeoCache();

  sources.sort((a, b) => b.score - a.score || (b.recordCount || 0) - (a.recordCount || 0));

  // The same dataset is routinely republished: a MapServer and a FeatureServer
  // copy, or one county layer mirrored by three orgs. An identical field list
  // AND an identical record count in the same state is the same data. Keep the
  // best-scoring copy and record the rest as duplicates so the count is honest.
  const dedup = new Map();
  let duplicatesDropped = 0;
  for (const s of sources) {
    const key = `${s.state}|${s.recordCount}|${s.fields.join(',')}`;
    const kept = dedup.get(key);
    if (!kept) {
      dedup.set(key, s);
      continue;
    }
    duplicatesDropped++;
    (kept.duplicateEndpoints || (kept.duplicateEndpoints = [])).push(s.layerUrl);
  }
  const deduped = [...dedup.values()];
  for (const s of deduped) if (!s.duplicateEndpoints) s.duplicateEndpoints = [];
  sources.length = 0;
  sources.push(...deduped);
  log(`[emit] dropped ${duplicatesDropped} duplicate republications`);

  const byKind = { parcel_with_zoning: 0, zoning_districts: 0, parcels_only: 0 };
  for (const s of sources) byKind[s.sourceKind] = (byKind[s.sourceKind] || 0) + 1;
  const byState = {};
  for (const s of sources) {
    const k = s.state || 'unknown';
    byState[k] = (byState[k] || 0) + 1;
  }

  const registry = {
    $schema: './types.ts#SourceRegistry',
    generatedAt: new Date().toISOString(),
    generator: 'scripts/discover/discover-arcgis.mjs',
    calibrationReference: {
      jurisdiction: 'City of Fargo, ND',
      layerUrl: 'https://gis.cityoffargo.com/arcgis/rest/services/General/Zoning/MapServer/0',
      note: 'Parcel-level with zoning joined, no key, no licence gate. The rubric is tuned so this class of source scores in the 90s.',
    },
    rubric: RUBRIC,
    universe: {
      source: 'US Census Bureau TIGERweb, queried live during this crawl',
      incorporatedPlaces: 19731,
      counties: 3235,
      note: 'Zoning authority sits with municipalities in most states and with counties in unincorporated areas, so neither figure alone is the denominator.',
    },
    counts: {
      verifiedSources: sources.length,
      distinctJurisdictions: new Set(sources.map((s) => `${s.state}|${s.jurisdiction}`)).size,
      distinctStates: Object.keys(byState).filter((k) => k !== 'unknown').length,
      duplicateEndpointsDropped: duplicatesDropped,
      byKind,
      byState,
      crawl: stats,
    },
    sources,
  };

  fs.writeFileSync(path.join(REGISTRY_DIR, 'sources.json'), JSON.stringify(registry, null, 2));

  // Field-alias table: directly consumable by detectFieldMapping().
  const aliases = {
    generatedAt: registry.generatedAt,
    note: 'Observed field names per canonical concept, ordered by how many verified layers used them. Compare case-insensitively with non-alphanumerics stripped.',
    concepts: Object.fromEntries(
      CANONICAL_CONCEPTS.map((c) => [
        c,
        [...(aliasTable.get(c) || new Map()).entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([field, count]) => ({ field, count })),
      ])
    ),
  };
  fs.writeFileSync(path.join(REGISTRY_DIR, 'field-aliases.json'), JSON.stringify(aliases, null, 2));

  log(`[emit] ${sources.length} sources -> src/lib/ingest/registry/sources.json`);
  log(`[emit] kinds: ${JSON.stringify(byKind)}`);
  log(`[emit] states covered: ${registry.counts.distinctStates}`);

  writeReport(registry, aliases);
  validateRegistry(registry);
  return registry;
}

/**
 * Guard the contract with the ingestion engine: every emitted entry must carry
 * exactly the keys declared in `types.ts`, and the invariants must hold. Fails
 * loudly rather than shipping a registry the consumer cannot type.
 */
function validateRegistry(reg) {
  const typesPath = path.join(REGISTRY_DIR, 'types.ts');
  const problems = [];

  if (fs.existsSync(typesPath)) {
    const src = fs.readFileSync(typesPath, 'utf8');
    const body = src.split('export interface RegistrySource {')[1];
    if (body) {
      const declared = [...body.split('\n}')[0].matchAll(/^ {2}([a-zA-Z]\w*)\??:/gm)].map((m) => m[1]);
      const actual = Object.keys(reg.sources[0] || {});
      const missing = declared.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !declared.includes(k));
      if (missing.length) problems.push(`types.ts declares keys absent from JSON: ${missing.join(', ')}`);
      if (extra.length) problems.push(`JSON has keys absent from types.ts: ${extra.join(', ')}`);
    }
  }

  for (const s of reg.sources) {
    if (s.providesDimensionalStandards !== false) problems.push(`${s.id}: providesDimensionalStandards must be false`);
    if (s.requiresAuth !== false) problems.push(`${s.id}: tokened sources must not be in the registry`);
    if (!(s.recordCount > 0)) problems.push(`${s.id}: recordCount must be positive`);
    if (!/^https?:\/\//.test(s.layerUrl)) problems.push(`${s.id}: bad layerUrl`);
    if (typeof s.score !== 'number' || s.score < 0 || s.score > 100) problems.push(`${s.id}: score out of range`);
  }

  if (problems.length) {
    console.error(`[validate] ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 20)) console.error('  -', p);
    process.exitCode = 1;
    return false;
  }
  log(`[validate] OK — ${reg.sources.length} entries conform to types.ts`);
  return true;
}

// ---------------------------------------------------------------------------
// Human-readable report — regenerated with the registry, never hand-edited.
// ---------------------------------------------------------------------------
function writeReport(reg, aliases) {
  const s = reg.sources;
  const buckets = [
    ['90-100', (x) => x >= 90],
    ['80-89', (x) => x >= 80 && x < 90],
    ['70-79', (x) => x >= 70 && x < 80],
    ['60-69', (x) => x >= 60 && x < 70],
    ['50-59', (x) => x >= 50 && x < 60],
    ['40-49', (x) => x >= 40 && x < 50],
    ['30-39', (x) => x >= 30 && x < 40],
    ['0-29', (x) => x < 30],
  ];
  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
  const L = [];

  L.push('# Nationwide parcel & zoning data sources — what we verified');
  L.push('');
  L.push(`Generated \`${reg.generatedAt}\` by \`${reg.generator}\`. Do not hand-edit — re-run the crawler.`);
  L.push('');
  L.push('## What this file answers');
  L.push('');
  L.push('"Which US cities and counties can we ingest tomorrow, for free, and how good is each one?"');
  L.push('Every row below was probed live: the service responded, we read its field list, we counted its');
  L.push('records, and where a zoning field exists we sampled 25 rows to confirm the column is actually');
  L.push('populated rather than an empty placeholder.');
  L.push('');
  L.push('## The one thing to not misread');
  L.push('');
  L.push('**A high score does not mean we have zoning standards for that jurisdiction.**');
  L.push('');
  L.push('These sources give geometry and attributes — where the parcel is, what district it sits in, how');
  L.push('wide the lot is. They do **not** give the ordinance: setbacks, height limits, FAR, lot coverage,');
  L.push('parking minimums, ADU rules. That text lives in prose in the municipal code and takes a human');
  L.push('roughly **16–34 hours per jurisdiction** to extract reliably. Every registry entry carries');
  L.push('`providesDimensionalStandards: false` as a literal so nothing downstream can quietly assume');
  L.push('otherwise.');
  L.push('');
  L.push('The automatable half is free and wide. The expensive half is per-jurisdiction human labour.');
  L.push('');
  const withStd = s.filter((x) => x.partialStandardsFields.length);
  L.push('### One honest exception, and it is small');
  L.push('');
  L.push(
    `**${withStd.length}** of ${s.length} sources (${pct(withStd.length, s.length)}) carry columns that look like ` +
      'dimensional standards — a few jurisdictions join a slice of their ordinance table onto the zoning layer. ' +
      'Observed field names include:'
  );
  L.push('');
  const stdFields = new Map();
  for (const x of withStd) for (const f of x.partialStandardsFields) stdFields.set(f, (stdFields.get(f) || 0) + 1);
  const topStd = [...stdFields.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  L.push(topStd.map(([f, n]) => `\`${f}\` ×${n}`).join(', ') || '_none_');
  L.push('');
  L.push('These are listed per entry in `partialStandardsFields`. They are a **partial, unverified subset of');
  L.push('one ordinance** — typically front setback and minimum lot size, never the full rule set, and never');
  L.push('the conditional cases. They do not flip `providesDimensionalStandards`, and they do not remove the');
  L.push('human read. What they do is tell you which jurisdictions are cheapest to start with.');
  L.push('');
  L.push('## Headline numbers');
  L.push('');
  L.push('| Measure | Value |');
  L.push('| --- | --- |');
  L.push(`| Services probed live | ${reg.counts.crawl.servicesProbed.toLocaleString()} |`);
  L.push(`| Layers inspected | ${reg.counts.crawl.layersProbed.toLocaleString()} |`);
  L.push(`| **Verified, ingestible sources** | **${reg.counts.verifiedSources.toLocaleString()}** |`);
  L.push(`| Distinct jurisdictions | ${reg.counts.distinctJurisdictions.toLocaleString()} |`);
  L.push(`| States + DC represented | ${reg.counts.distinctStates} / 51 |`);
  L.push(`| Parcel-level **with zoning joined** (the Fargo class) | ${byKindCount(reg, 'parcel_with_zoning')} |`);
  L.push(`| Zoning-district boundaries only | ${byKindCount(reg, 'zoning_districts')} |`);
  L.push(`| Parcels only, no zoning attribute | ${byKindCount(reg, 'parcels_only')} |`);
  L.push(`| Total parcel/district records reachable | ${s.reduce((a, x) => a + (x.recordCount || 0), 0).toLocaleString()} |`);
  L.push(`| Statewide aggregators | ${s.filter((x) => x.isStatewide).length} |`);
  L.push(`| Duplicate endpoints collapsed | ${reg.counts.duplicateEndpointsDropped} |`);
  L.push('');
  const joined = s.filter((x) => x.sourceKind === 'parcel_with_zoning');
  const inferredJoin = joined.filter((x) => x.sourceKindConfidence === 'inferred').length;
  L.push('### How the three kinds split');
  L.push('');
  L.push(
    `Only **${pct(joined.length, s.length)}** of verified sources are parcel-level with zoning joined — ` +
      'the shape that is immediately useful without a spatial join. **Most parcel layers do not carry zoning at all.**'
  );
  L.push('');
  L.push('| Kind | Sources | Share | What it costs you |');
  L.push('| --- | ---: | ---: | --- |');
  L.push(`| \`parcel_with_zoning\` | ${joined.length} | ${pct(joined.length, s.length)} | Nothing. Ingest and use. |`);
  L.push(
    `| \`zoning_districts\` | ${byKindCount(reg, 'zoning_districts')} | ${pct(reg.counts.byKind.zoning_districts || 0, s.length)} | ` +
      'Needs a spatial join against a parcel layer for that jurisdiction. |'
  );
  L.push(
    `| \`parcels_only\` | ${byKindCount(reg, 'parcels_only')} | ${pct(reg.counts.byKind.parcels_only || 0, s.length)} | ` +
      'Needs a separate zoning source, then a spatial join. |'
  );
  L.push('');
  L.push(
    `Of the ${joined.length} joined sources, **${inferredJoin}** are classified \`inferred\` rather than \`high\`: ` +
      'they carry a populated zoning attribute and far too many polygons to be a district map, but no owner, ' +
      'APN or situs-address column to prove parcel granularity. Check those before relying on them.'
  );
  L.push('');
  L.push('## Honest coverage against the national universe');
  L.push('');
  L.push(`Denominators from ${reg.universe.source}:`);
  L.push('');
  L.push(`- **${reg.universe.incorporatedPlaces.toLocaleString()}** incorporated places`);
  L.push(`- **${reg.universe.counties.toLocaleString()}** counties and county equivalents`);
  L.push('');
  L.push(
    `We verified **${reg.counts.distinctJurisdictions.toLocaleString()} distinct jurisdictions**. Against incorporated places alone that is ` +
      `**${pct(reg.counts.distinctJurisdictions, reg.universe.incorporatedPlaces)}**. That is the honest number and it is small.`
  );
  L.push('');
  L.push('Three caveats that cut in both directions:');
  L.push('');
  L.push('1. **Downward.** Jurisdiction names are derived from publisher metadata and Census geography (see');
  L.push('   below), so the distinct-jurisdiction count is approximate. Some rows are the same city under two');
  L.push('   names; some are labelled only to county level.');
  L.push('2. **Upward.** Statewide and county-wide layers cover many municipalities from one endpoint. A');
  L.push('   single statewide parcel service can carry every place in that state.');
  L.push('3. **Upward, and this is the big one.** This crawl is time-boxed. It probed a prioritised slice of');
  L.push('   the candidate pool, not all of it. The ceiling is much higher than what is in this file — the');
  L.push('   crawler is resumable and re-running it extends the registry without redoing finished work.');
  L.push('');
  const fromPlace = s.filter((x) => x.jurisdictionFromCensusPlace).length;
  const unresolved = s.filter((x) => /unresolved/.test(x.jurisdiction)).length;
  L.push('### How jurisdiction names were established');
  L.push('');
  L.push('| Method | Sources |');
  L.push('| --- | ---: |');
  L.push(`| Publisher metadata (ArcGIS org name, attribution, title) | ${s.length - fromPlace - unresolved} |`);
  L.push(`| Census incorporated place containing the layer footprint | ${fromPlace} |`);
  L.push(`| County only — jurisdiction could not be resolved | ${unresolved} |`);
  L.push('');
  L.push('Names resolved from a Census place carry `jurisdictionFromCensusPlace: true`. They describe the');
  L.push('territory the data covers, which is not necessarily the body that adopted the zoning — a county');
  L.push('may zone unincorporated land inside a city\'s bounding box. Treat those names as geographic.');
  L.push('The publisher of record is always in `publisherOrg`, resolved from the ArcGIS organisation that');
  L.push('hosts the service.');
  L.push('');
  L.push('Most US municipalities publish nothing machine-readable at all. Small towns typically have a PDF');
  L.push('zoning map and no GIS server. Coverage is heavily biased toward larger cities and toward states');
  L.push('with a statewide GIS program.');
  L.push('');
  L.push('## How these were discovered');
  L.push('');
  const viaCount = {};
  for (const x of s) viaCount[x.discoveredVia] = (viaCount[x.discoveredVia] || 0) + 1;
  const selfHosted = s.filter((x) => !/arcgis\.com/i.test(x.serviceUrl)).length;
  L.push('| Channel | Sources | What it reaches |');
  L.push('| --- | ---: | --- |');
  L.push(
    `| ArcGIS Online item search | ${viaCount['arcgis-online-search'] || 0} | Everything registered as an AGO item — mostly Esri-hosted \`services*.arcgis.com\` |`
  );
  L.push(
    `| ArcGIS Hub DCAT-US feeds | ${viaCount['hub-dcat'] || 0} | Hub site catalogues, which list **self-hosted** ArcGIS Server endpoints the item search never indexes |`
  );
  L.push(`| Hand-verified seed | ${viaCount['seed'] || 0} | \`scripts/discover/seeds.json\` — jurisdictions with no AGO presence at all, like Fargo |`);
  L.push('');
  L.push(
    `**${selfHosted}** of ${s.length} sources (${pct(selfHosted, s.length)}) live on a jurisdiction's own ArcGIS Server ` +
      'rather than Esri hosting. Those are invisible to item search alone — the DCAT pass is what finds them, and it ' +
      'is the reason the crawler has three channels rather than one.'
  );
  L.push('');
  L.push('## Access and licence — what "free" actually means here');
  L.push('');
  const withLic = s.filter((x) => x.licenseInfo && x.licenseInfo.length > 20);
  const openLic = withLic.filter((x) => /creative commons|public domain|CC0|CC[ -]BY|open data|ODbL|no restriction/i.test(x.licenseInfo));
  const disclaimerOnly = withLic.filter(
    (x) => /no warrant|not for legal|no representation|as[- ]is|informational purposes|not survey/i.test(x.licenseInfo)
  );
  L.push('| | Count | Share |');
  L.push('| --- | ---: | ---: |');
  L.push(`| Sources requiring a token or key | 0 | 0% — tokened services are excluded from the registry |`);
  L.push(`| Services that returned a token error during the crawl | ${reg.counts.crawl.servicesAuthRequired} | ${pct(reg.counts.crawl.servicesAuthRequired, reg.counts.crawl.servicesProbed)} of probed |`);
  L.push(`| Registry entries carrying any licence text | ${withLic.length} | ${pct(withLic.length, s.length)} |`);
  L.push(`| …an explicit open licence (CC / public domain / open data) | ${openLic.length} | ${pct(openLic.length, s.length)} |`);
  L.push(`| …a liability disclaimer rather than a use restriction | ${disclaimerOnly.length} | ${pct(disclaimerOnly.length, s.length)} |`);
  L.push('');
  L.push('The dominant pattern is *no stated licence at all*, and where text exists it is almost always an');
  L.push('accuracy disclaimer ("not for legal or survey use", "no warranty as to completeness") rather than a');
  L.push('restriction on use. That is permissive in practice but it is **not** an explicit grant. Before');
  L.push('commercialising any specific jurisdiction\'s data, read the `licenseInfo` field on that entry.');
  L.push('');
  L.push('Under 4% of probed services demanded a token. Publishing parcel and zoning data openly is the norm,');
  L.push('not the exception — the constraint on national coverage is which jurisdictions publish at all, not');
  L.push('whether the published ones are gated.');
  L.push('');
  L.push('## Score distribution');
  L.push('');
  L.push('| Band | Sources | Share |');
  L.push('| --- | ---: | ---: |');
  for (const [label, test] of buckets) {
    const n = s.filter((x) => test(x.score)).length;
    if (!n) continue;
    L.push(`| ${label} | ${n} | ${pct(n, s.length)} |`);
  }
  L.push('');
  const scores = s.map((x) => x.score).sort((a, b) => a - b);
  if (scores.length) {
    const q = (p) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
    L.push(`Median **${q(0.5)}**, p75 **${q(0.75)}**, p90 **${q(0.9)}**, max **${scores[scores.length - 1]}**.`);
    L.push('');
  }
  L.push('### The rubric');
  L.push('');
  L.push('| Component | Max points | Why |');
  L.push('| --- | ---: | --- |');
  const rw = reg.rubric.weights;
  L.push(`| Parcel-level with zoning joined | ${rw.kind_parcel_with_zoning} | The only shape that is per-parcel useful with no extra work |`);
  L.push(`| …zoning districts only | ${rw.kind_zoning_districts} | Needs a spatial join before it is per-parcel useful |`);
  L.push(`| …parcels only | ${rw.kind_parcels_only} | Geometry and ownership, no district |`);
  L.push(`| PUD flag | ${rw.pud_flag} | Planned developments override base zoning; without this the base code lies |`);
  L.push(`| Conditional-use flag | ${rw.cup_flag} | Same reason |`);
  L.push(`| Lot width | ${rw.lot_width} | Feasibility maths needs the dimension, not just the area |`);
  L.push(`| Lot depth | ${rw.lot_depth} | Same |`);
  L.push(`| Lot area | ${rw.lot_area} | Weaker signal; almost universally present |`);
  L.push(`| Record count | ${rw.record_count} | log-scaled, full marks at ≥20,000 records |`);
  L.push(`| Structure attributes | ${rw.structure_attrs} | year built / units / building sqft / assessed value |`);
  L.push(`| Identity attributes | ${rw.identity_attrs} | owner / situs address / legal description |`);
  L.push(`| Freshness | ${rw.freshness} | Service reports an edit within 12 months |`);
  L.push('');
  L.push(`Calibration: **${reg.calibrationReference.jurisdiction}** — ${reg.calibrationReference.layerUrl}`);
  const fargo = s.find((x) => /cityoffargo/i.test(x.layerUrl));
  if (fargo) {
    L.push('');
    L.push(`Fargo scores **${fargo.score}/100** in this run (${fargo.recordCount.toLocaleString()} records, ` +
      `zoning \`${fargo.concepts.zoning_code}\`, PUD \`${fargo.concepts.pud_flag}\`, CUP \`${fargo.concepts.cup_flag}\`, ` +
      `width \`${fargo.concepts.lot_width}\`, depth \`${fargo.concepts.lot_depth}\`). It is the reference the rubric is tuned against.`);
  }
  L.push('');
  L.push('### Fargo is an outlier, not a template');
  L.push('');
  L.push('Across every verified source, the attributes that make Fargo valuable are rare:');
  L.push('');
  L.push('| Attribute | Sources that have it |');
  L.push('| --- | ---: |');
  for (const c of ['zoning_code', 'lot_area', 'lot_depth', 'lot_width', 'pud_flag', 'cup_flag']) {
    const n = s.filter((x) => x.concepts[c]).length;
    L.push(`| \`${c}\` | ${n} (${pct(n, s.length)}) |`);
  }
  L.push('');
  L.push('Lot **width** and the PUD / conditional-use flags are the scarcest fields in US municipal GIS, and');
  L.push('they are exactly the ones feasibility maths needs — a PUD silently overrides the base zoning code,');
  L.push('so a source without that flag will confidently return the wrong answer on those parcels. Do not');
  L.push('design the ingestion schema assuming the Fargo field set is typical. It is not.');
  L.push('');
  L.push(`## Top ${Math.min(50, s.length)} by score`);
  L.push('');
  L.push('| # | Score | Jurisdiction | ST | Kind | Records | Layer URL |');
  L.push('| ---: | ---: | --- | --- | --- | ---: | --- |');
  s.slice(0, 50).forEach((x, i) => {
    const kind = x.sourceKind === 'parcel_with_zoning' ? 'parcel+zoning' : x.sourceKind === 'zoning_districts' ? 'districts' : 'parcels';
    L.push(
      `| ${i + 1} | ${x.score} | ${mdEsc(x.jurisdiction)} | ${x.state || '—'} | ${kind} | ` +
        `${(x.recordCount || 0).toLocaleString()} | \`${x.layerUrl}\` |`
    );
  });
  L.push('');
  const statewide = s.filter((x) => x.isStatewide).sort((a, b) => b.score - a.score);
  L.push('## Statewide aggregators — the highest-leverage sources');
  L.push('');
  L.push('One endpoint that covers every jurisdiction in a state is worth far more than one city. A layer');
  L.push("qualifies here when its footprint covers ≥55% of the state's bounding box (measured against real");
  L.push('Census TIGERweb state extents) or the publisher labels it statewide.');
  L.push('');
  if (statewide.length) {
    L.push('| Score | ST | Kind | Records | State coverage | Layer URL |');
    L.push('| ---: | --- | --- | ---: | ---: | --- |');
    for (const x of statewide.slice(0, 30)) {
      const kind = x.sourceKind === 'parcel_with_zoning' ? 'parcel+zoning' : x.sourceKind === 'zoning_districts' ? 'districts' : 'parcels';
      L.push(
        `| ${x.score} | ${x.state || '—'} | ${kind} | ${(x.recordCount || 0).toLocaleString()} | ` +
          `${x.stateCoverage === null ? 'title' : `${Math.round(x.stateCoverage * 100)}%`} | \`${x.layerUrl}\` |`
      );
    }
  } else {
    L.push('_None found in this crawl._');
  }
  L.push('');
  L.push('## Coverage by state');
  L.push('');
  L.push('| ST | Sources | parcel+zoning | districts | parcels only | Best score |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  const states = [...new Set(s.map((x) => x.state || 'unknown'))].sort();
  for (const st of states) {
    const rows = s.filter((x) => (x.state || 'unknown') === st);
    L.push(
      `| ${st} | ${rows.length} | ${rows.filter((r) => r.sourceKind === 'parcel_with_zoning').length} | ` +
        `${rows.filter((r) => r.sourceKind === 'zoning_districts').length} | ` +
        `${rows.filter((r) => r.sourceKind === 'parcels_only').length} | ${Math.max(...rows.map((r) => r.score))} |`
    );
  }
  const missing = STATES.map(([a]) => a).filter((a) => !states.includes(a));
  L.push('');
  if (missing.length) L.push(`**No verified source yet:** ${missing.join(', ')}.`);
  else L.push('**Every state + DC has at least one verified source.**');
  L.push('');
  L.push('## Field naming varies wildly — the observed alias table');
  L.push('');
  L.push('Fargo calls its zoning field `Zone1`. Others use `ZONING`, `ZONE_CODE`, `BASEZONING`, `ZONE_DESC`,');
  L.push('`Zoning_Dis` (a 10-character shapefile truncation), and dozens more. There is no standard.');
  L.push('Compare case-insensitively with non-alphanumerics stripped.');
  L.push('');
  L.push('Full machine-readable table: `src/lib/ingest/registry/field-aliases.json`. Top aliases per concept:');
  L.push('');
  L.push('| Canonical concept | Layers with it | Most common observed field names |');
  L.push('| --- | ---: | --- |');
  for (const c of CANONICAL_CONCEPTS) {
    const obs = aliases.concepts[c] || [];
    const n = s.filter((x) => x.concepts[c]).length;
    const top = obs.slice(0, 8).map((o) => `\`${o.field}\` ×${o.count}`).join(', ') || '—';
    L.push(`| \`${c}\` | ${n} (${pct(n, s.length)}) | ${top} |`);
  }
  L.push('');
  L.push('## How to re-run');
  L.push('');
  L.push('```bash');
  L.push('node scripts/discover/discover-arcgis.mjs                    # resume, full pipeline');
  L.push('node scripts/discover/discover-arcgis.mjs --phase=search     # ArcGIS Online item search');
  L.push('node scripts/discover/discover-arcgis.mjs --phase=dcat --dcat  # ArcGIS Hub DCAT-US feeds');
  L.push('node scripts/discover/discover-arcgis.mjs --phase=probe --max-probe=1500');
  L.push('node scripts/discover/discover-arcgis.mjs --phase=emit       # rebuild JSON + this file');
  L.push('node scripts/discover/discover-arcgis.mjs --reset            # start clean');
  L.push('```');
  L.push('');
  L.push('The crawl state lives in `scripts/discover/.cache/` (gitignored). Finished search queries and');
  L.push('probed services are skipped on re-run, so a long crawl can be stopped and restarted freely.');
  L.push('Add hand-verified self-hosted endpoints to `scripts/discover/seeds.json` — that is how Fargo gets');
  L.push('in, since it runs its own ArcGIS Server and has no ArcGIS Online item.');
  L.push('');

  const out = path.join(REPO, 'docs', 'DATA-SOURCES-NATIONWIDE.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, L.join('\n'));
  log(`[emit] report -> docs/DATA-SOURCES-NATIONWIDE.md`);
}

function byKindCount(reg, kind) {
  return (reg.counts.byKind[kind] || 0).toLocaleString();
}
function mdEsc(v) {
  return String(v || '').replace(/\|/g, '\\|');
}

function itemExtentToBbox(ext) {
  if (!Array.isArray(ext) || ext.length !== 2) return null;
  const [[xmin, ymin], [xmax, ymax]] = ext;
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) return null;
  return [xmin, ymin, xmax, ymax];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  ensureDirs();
  if (OPT.reset) {
    for (const f of Object.values(F)) if (fs.existsSync(f)) fs.unlinkSync(f);
    log('[reset] cache cleared');
  }
  loadGeoCache();
  const t0 = Date.now();
  log(`[run] phase=${OPT.phase} budget=${OPT.budgetMin}min concurrency=${OPT.concurrency}`);

  if (OPT.phase === 'all' || OPT.phase === 'search') await phaseSearch();
  if (OPT.dcat && (OPT.phase === 'all' || OPT.phase === 'dcat')) await phaseDcat();
  if (OPT.phase === 'all' || OPT.phase === 'probe') await phaseProbe();
  if (OPT.phase === 'all' || OPT.phase === 'emit') await phaseEmit();

  saveGeoCache();
  log(`[run] finished in ${Math.round((Date.now() - t0) / 1000)}s, ${reqCount} HTTP requests`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
