import { Hono } from 'hono';
import { OFAC_FILES, ofacFileUrl, parseSanctionedFile, buildSanctionedRows } from './lib/ofac.js';
import { NFT_LIST_URL, NFT_PER_PAGE, nftRowsFromPage, dedupeNftRows } from './lib/nft.js';
import { prefersMarkdown } from './lib/negotiate.js';
import { norm, resolveCategory, categoryLabel, coverageTier, relatedBlock, deriveCategory } from './lib/chainkit.js';
import { annotateDataQuality, assessChainDataQuality } from './lib/data-quality.js';
import { USDC_DP, monthKeyFromDate, isLiveMode, decodePaymentHeader, paymentRequirements, structuralCheck, pruneStaleQuota } from './lib/x402.js';
import { TAG_LABELS, canonTags, isFraudy, causeVocab } from './lib/causes.js';
// Aliased deliberately: causes.js above exports TAG_LABELS/canonTags into this
// same scope. An unaliased import would shadow the cause vocabulary silently —
// no error, just wrong labels on the graveyard chips.
import { cohortFor, tagVocab, parseLaunch, canonTags as canonChainTags, isTheme as isChainTheme, isCohort as isChainCohort, themesForCategory } from './lib/tags.js';
import { SCORE_META, TIER_CRITERIA, TIERS, BOARD_SIZE, CHANGE_90D_MIN_SPAN_DAYS, scoreRows, classifyTier, baselineOk, activityIndex } from './lib/scoring.js';
import { DEX_CATEGORIES, aggregateBreakdown, feedIsDegenerate, selectCandidates, dedupeChains } from './lib/llama.js';

const ENV = {};
const app = new Hono();
app.use('*', async (c, next) => {
  if (!ENV.__init) { Object.assign(ENV, c.env || {}); ENV.__init = true; }
  await next();
});

// --- Express(req,res) -> Hono(c) compatibility shim, keeps handler bodies untouched ---
function wrap(handler) {
  return async (c) => {
    const url = new URL(c.req.url);
    const req = {
      query: Object.fromEntries(url.searchParams),
      params: c.req.param(),
      headers: Object.fromEntries(c.req.raw.headers),
      ip: c.req.header('cf-connecting-ip') || '',
      raw: c.req.raw,
      url: c.req.url,
    };
    let body, status = 200, html = null;
    const headers = {};
    const res = {
      json(obj) { body = obj; return res; },
      html(str) { html = str; return res; },
      status(n) { status = n; return res; },
      setHeader(k, v) { headers[k] = v; return res; },
    };
    await handler(req, res);
    const response = html != null
      ? new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
      : c.json(body, status);
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };
}

// ---------------------------------------------------------------------------
// DefiLlama + growthepie + CoinGecko — all free / no-auth endpoints
// ---------------------------------------------------------------------------
const CHAINS_URL = 'https://api.llama.fi/v2/chains';
const DEXS_URL   = 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const FEES_URL   = 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const STABLES_URL = 'https://stablecoins.llama.fi/stablecoinchains';
const GP_FUND_URL = 'https://api.growthepie.xyz/v1/fundamentals.json';
const GP_MASTER_URL = 'https://api.growthepie.xyz/v1/master.json';
// The CloudFront-fronted fundamentals.json 403s Workers' default fetch UA
// (confirmed via prod logs) while the smaller master.json on the same host
// doesn't — a browser-like UA clears it.
const GP_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; chaindump/1.0; +https://chaindump.xyz)' };
const CG_PRICE = 'https://api.coingecko.com/api/v3/simple/price';
// CoinGecko API key (free "Demo" key or Pro) — greatly raises rate limits so prices load reliably.
// Set COINGECKO_API_KEY in the environment. Demo keys use the public host + x_cg_demo_api_key.
function cgUrl(url) { const CG_KEY = ENV.COINGECKO_API_KEY || ''; return CG_KEY ? url + (url.includes('?') ? '&' : '?') + 'x_cg_demo_api_key=' + encodeURIComponent(CG_KEY) : url; }
let priceCache = {}; // gecko_id -> { price, mcap, ch, ts } — sticky so transient CoinGecko failures don't wipe prices

// ---- name normalization so sources line up ----
// norm() + its ALIAS map now live in ./lib/chainkit.js (single source of truth,
// shared with the chain-linking logic so keys can never diverge).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// fetch JSON with timeout; never throws the whole snapshot down
async function fetchJson(url, ms = 15000, extraHeaders = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', ...extraHeaders }, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// run promise-returning tasks with a concurrency cap
async function pool(items, worker, limit = 8) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}


// growthepie master: chainId -> { origin, bucket, stack, da_layer } — origin for
// the DAA lookup, the rest to derive a value-prop category when curated misses.
function parseMaster(master) {
  const byChainId = {};
  const chains = (master && master.chains) || {};
  for (const originKey in chains) {
    const c = chains[originKey];
    const cid = c.evm_chain_id != null ? Number(c.evm_chain_id) : null;
    if (cid != null && !Number.isNaN(cid)) byChainId[cid] = { origin: originKey, bucket: c.bucket, stack: c.stack, da_layer: c.da_layer };
  }
  return byChainId;
}
// Back-compat: the CF-blocked D1 seed may still hold the old chainId->string shape.
function masterRec(v) { return typeof v === 'string' ? { origin: v } : (v || null); }
// growthepie fundamentals: latest value per origin_key for a metric
function latestByOrigin(fundamentals, metricKey) {
  const best = {}; // origin -> {date, value}
  for (const row of Array.isArray(fundamentals) ? fundamentals : []) {
    if (row.metric_key !== metricKey) continue;
    const cur = best[row.origin_key];
    if (!cur || row.date > cur.date) best[row.origin_key] = { date: row.date, value: Number(row.value) || 0 };
  }
  const out = {};
  for (const o in best) out[o] = best[o].value;
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------
let cache = { ts: 0, data: null };
const TTL = 60 * 1000;              // per-isolate re-read interval for the D1 snapshot cache

// ---- D1-backed analyst takes / research data (bound directly, no HTTP hop) ----
// Pass `params` + `?` placeholders for anything derived from a request (route
// params, query strings) — never interpolate request-derived values into `sql`.
async function dbQuery(sql, params = []) {
  if (!ENV.DB) return [];
  const stmt = params.length ? ENV.DB.prepare(sql).bind(...params) : ENV.DB.prepare(sql);
  const { results } = await stmt.all();
  return results || [];
}
let masterCache = { ts: 0, data: null };
const MASTER_TTL = 6 * 60 * 60 * 1000;

// master.json (chainId -> growthepie origin_key map, needed to attach DAA to
// each chain) is CloudFront-fronted on the same host as fundamentals.json and
// is blocked from Cloudflare's edge the same way. Without it, origin_key is
// null for every chain and active-address data can never attach even when the
// DAA map itself is present — that's the silent second half of the bug.
// Same strategy: try live, else fall back to the D1-persisted last-good map.
async function getMaster(env) {
  const now = Date.now();
  if (masterCache.data && Object.keys(masterCache.data).length && now - masterCache.ts <= MASTER_TTL) return masterCache.data;
  try {
    const m = parseMaster(await fetchJson(GP_MASTER_URL, 20000, GP_HEADERS));
    if (Object.keys(m).length) {
      masterCache = { ts: now, data: m };
      if (env && env.DB) { try { await env.DB.prepare(
        `INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('master', ?, ?)
         ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`
      ).bind(JSON.stringify(m), now).run(); } catch (e) {} }
      return m;
    }
  } catch (e) { console.error('[getMaster] live growthepie failed:', e.message); }
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare(`SELECT data FROM snapshot_cache WHERE key='master'`).first();
      if (row && row.data) { masterCache = { ts: now, data: JSON.parse(row.data) }; return masterCache.data; }
    } catch (e) { console.error('[getMaster] D1 fallback failed:', e.message); }
  }
  return masterCache.data || {};
}

// growthepie's fundamentals.json (source of active-address data) 403s from
// Cloudflare's edge — confirmed via prod logs: the identical request succeeds
// from a normal IP but CloudFront blocks Cloudflare's ASN. No smaller daa-only
// endpoint exists and DefiLlama's active-users API is Pro-gated, so there is no
// clean live free source reachable from the Worker. Strategy: keep attempting
// the live fetch (auto-recovers if the block ever clears), but persist the last
// GOOD daa map in D1 (key='daa') so active-address data survives cold starts
// and 403'd ticks instead of nulling every chain. Seeded once from a normal IP.
let daaCache = { ts: 0, data: {} };
const DAA_TTL = 30 * 60 * 1000;
async function getDaaByOrigin(env) {
  const now = Date.now();
  if (Object.keys(daaCache.data).length && now - daaCache.ts < DAA_TTL) return daaCache.data;
  // 1) try live growthepie (works if the CF-edge block ever lifts)
  try {
    const fresh = latestByOrigin(await fetchJson(GP_FUND_URL, 25000, GP_HEADERS), 'daa');
    if (Object.keys(fresh).length) {
      daaCache = { ts: now, data: fresh };
      if (env && env.DB) { try { await env.DB.prepare(
        `INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('daa', ?, ?)
         ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`
      ).bind(JSON.stringify(fresh), now).run(); } catch (e) {} }
      return fresh;
    }
  } catch (e) { console.error('[getDaaByOrigin] live growthepie failed:', e.message); }
  // 2) fall back to last-good persisted map
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare(`SELECT data, updated_at FROM snapshot_cache WHERE key='daa'`).first();
      if (row && row.data) { daaCache = { ts: row.updated_at, data: JSON.parse(row.data) }; return daaCache.data; }
    } catch (e) { console.error('[getDaaByOrigin] D1 fallback failed:', e.message); }
  }
  return daaCache.data; // {} if never seeded
}

// Every buildSnapshot fetch degrades silently on failure (falls back to a
// default and moves on) — that's the right behavior for resilience, but it
// means a failing upstream shows up only as "some field is null" days later
// with zero trace of why. Log the reason so Workers Logs can show it.
function logSettled(name, r) {
  if (r.status === 'rejected') console.error(`[buildSnapshot] ${name} failed:`, r.reason && r.reason.message || r.reason);
  else if (r.value == null) console.error(`[buildSnapshot] ${name} returned null/empty`);
}

// Map a previously-persisted snapshot blob to { chainKey -> [priorPeerKeys] } so
// buildSnapshot can apply hysteresis and keep peer lists stable across refreshes.
function priorPeersByKey(priorData) {
  const m = {};
  for (const c of (priorData?.chains || [])) {
    if (c.key && c.related?.peers) m[c.key] = c.related.peers.map((p) => p.key);
  }
  return m;
}
async function buildSnapshot(opts = {}) {
  // --- cheap global fetches (partial failure tolerated) ---
  // growthepie DAA is fetched separately via getDaaByOrigin (D1-persisted,
  // its own try-live-then-last-good path), not in this parallel group.
  const [chainsR, dexsR, feesR, stablesR, cgSeed, gpMaster, daaByOrigin] = await Promise.allSettled([
    fetchJson(CHAINS_URL), fetchJson(DEXS_URL), fetchJson(FEES_URL),
    fetchJson(STABLES_URL), Promise.resolve(null), getMaster(ENV), getDaaByOrigin(ENV),
  ]);
  [['chains', chainsR], ['dexs', dexsR], ['fees', feesR], ['stables', stablesR], ['gpMaster', gpMaster], ['daa', daaByOrigin]]
    .forEach(([name, r]) => logSettled(name, r));
  const val = (r, d) => (r.status === 'fulfilled' && r.value != null ? r.value : d);

  const chains = val(chainsR, []);
  if (!Array.isArray(chains) || !chains.length) throw new Error('chains feed unavailable');

  // Volume is filtered to real DEX categories: /overview/dexs also carries
  // Derivatives, Prediction Markets, NFT marketplaces and Telegram bots, and
  // counting those as "DEX volume" overstated Injective by 16x.
  const volAgg = aggregateBreakdown(val(dexsR, {}), norm, { categories: DEX_CATEGORIES });
  // Fees are chain-wide revenue, not one product — no category filter.
  const feeAgg = aggregateBreakdown(val(feesR, {}), norm);
  // A dead volume feed contributes zero to EVERY chain, which silently re-ranks
  // the board on TVL+fees alone while we keep publishing "50% 24h DEX volume".
  // Refuse to build rather than persist a plausible-looking wrong board; the
  // /api/chains catch then serves the last good snapshot with stale: true.
  if (feedIsDegenerate(volAgg, chains.length)) throw new Error('dex volume feed unavailable (empty breakdown)');
  if (feedIsDegenerate(feeAgg, chains.length)) throw new Error('fees feed unavailable (empty breakdown)');
  const masterMap = gpMaster.status === 'fulfilled' ? gpMaster.value : {};
  const daaMap = val(daaByOrigin, {});

  // stablecoin mcap by normalized chain name
  const stableByChain = {};
  for (const s of val(stablesR, [])) {
    const mc = s.totalCirculatingUSD
      ? Object.values(s.totalCirculatingUSD).reduce((a, v) => a + (Number(v) || 0), 0)
      : 0;
    if (s.name) stableByChain[norm(s.name)] = mc;
  }

  // --- assemble base rows from TVL feed (canonical names + chainId + gecko) ---
  // dedupeChains first: DefiLlama double-lists BSC/Binance and OP Mainnet/Optimism
  // under one chainId, and the per-chain endpoint resolves the $0 alias to the real
  // chain's volume — so the board would carry the same chain twice.
  const rows = dedupeChains(chains.filter((c) => c && c.name))
    .map((c) => {
      const key = norm(c.name);
      const mrec = c.chainId != null ? masterRec(masterMap[Number(c.chainId)]) : null;
      const originKey = mrec?.origin || null;
      return {
        key,
        name: c.name,
        symbol: c.tokenSymbol || null,
        gecko: c.gecko_id || null,
        chainId: c.chainId ?? null,
        // value-prop category: curated taxonomy first, then growthepie-derived.
        category: resolveCategory(c.name, deriveCategory(mrec)),
        tvl: Number(c.tvl) || 0,
        volume24h: volAgg[key] || 0,
        fees24h: feeAgg[key] || 0,
        stables: stableByChain[key] || 0,
        activeAddresses: originKey && daaMap[originKey] != null ? daaMap[originKey] : null,
      };
    });

  // --- PASS 1: provisional score, only to decide who is worth enriching ---
  // These volumes come from the aggregated breakdown, which misses any chain the
  // DEX feed names differently from the TVL feed (302 of 458: "Hyperliquid L1" vs
  // "hyperliquid", "OP Mainnet" vs "optimism"). Those chains read 0 on a
  // 50%-weight axis, so this ranking is NOT trustworthy on its own.
  scoreRows(rows);
  // Hence candidates are picked on several axes, not just the provisional score:
  // a chain zeroed on volume still enters on TVL or fees and gets corrected.
  const candidates = selectCandidates(rows, { boardSize: BOARD_SIZE });

  // --- enrich candidates (bounded concurrency) ---
  await pool(candidates, async (r) => {
    const enc = encodeURIComponent(r.name);
    const [dex, hist, fee] = await Promise.allSettled([
      fetchJson(`https://api.llama.fi/overview/dexs/${enc}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, 12000),
      fetchJson(`https://api.llama.fi/v2/historicalChainTvl/${enc}`, 12000),
      fetchJson(`https://api.llama.fi/overview/fees/${enc}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, 12000),
    ]);
    // Fees carry BOTH defects the volume axis had, and the aggregate is wrong in
    // both directions. Measured 2026-07-17: Hyperliquid L1 read $0 against a real
    // $3.83M/day (the same TVL-feed-vs-fee-feed name mismatch), while Provenance
    // read $13,971 against $96 — 145x over — and Tron 4.4x, because
    // /overview/fees spans 86 categories and the per-protocol breakdowns
    // double-count. This is a 20%-weight axis AND the denominator of the P/F
    // ratio, fee yield and fees-per-user we publish with definitions attached.
    if (fee.status === 'fulfilled' && fee.value && fee.value.total24h != null) {
      r.fees24h = Number(fee.value.total24h) || r.fees24h;
      r.feeSource = 'perChain';   // authoritative: DefiLlama's own per-chain total
    } else {
      // Diagnose rather than guess: a silently-kept aggregate is indistinguishable
      // from an enriched value in the payload, which is how the 145x Provenance
      // figure survived a deploy that "fixed" it.
      r.feeSource = 'aggregate';  // over-counts: 86 categories, double-counted breakdowns
      console.error(`[fees] ${r.name}: per-chain fetch failed -> keeping aggregate. reason=${fee.status === 'rejected' ? String(fee.reason && fee.reason.message).slice(0, 90) : 'total24h null'}`);
    }
    // Provenance per FIELD, not per row: being selected for enrichment is not the
    // same as having been enriched. A candidate whose per-chain call fails keeps
    // the aggregate, and marking the row "enriched" regardless would republish
    // that aggregate as though we had checked it.
    if (dex.status === 'fulfilled' && dex.value && dex.value.total24h != null) {
      r.volumeSource = 'perChain';
      r.volume24h = Number(dex.value.total24h) || r.volume24h;
      r.volChange1d = dex.value.change_1d ?? null;
      r.volChange7d = dex.value.change_7d ?? null;
      r.volChange30d = dex.value.change_1m ?? null;
      r.volume7d = dex.value.total7d ?? null;
      r.volume30d = dex.value.total30d ?? null;
    } else {
      r.volumeSource = 'aggregate';   // over-counts, and reads 0 on a name mismatch
    }
    if (hist.status === 'fulfilled' && Array.isArray(hist.value) && hist.value.length) {
      const series = hist.value.slice(-30).map((p) => Number(p.tvl) || 0);
      r.tvlSpark = series.slice(-14);
      r.tvlSpark30 = series;
      const now = series[series.length - 1];
      const wk = series.length >= 8 ? series[series.length - 8] : series[0];
      const mo = series[0];
      r.tvlChange7d = wk > 0 ? +(((now - wk) / wk) * 100).toFixed(2) : null;
      r.tvlChange30d = mo > 0 ? +(((now - mo) / mo) * 100).toFixed(2) : null;
    }
  }, 8);

  // --- PASS 2: rescore on the authoritative volumes just fetched ---
  // r.volume24h now holds DefiLlama's own per-chain total24h for every candidate
  // (it resolves chain names correctly and applies DefiLlama's parent-protocol
  // dedup). Rescoring here is what makes the published formula actually
  // reproduce the published score — previously volume24h was overwritten AFTER
  // scoring and never rescored, so the board ranked Injective on $3.2M while
  // serving $200K. The board is drawn from candidates only, so every ranked
  // chain is one we enriched.
  scoreRows(rows);
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, BOARD_SIZE);

  // --- CoinGecko native-token price/mcap/24h (single batched call) ---
  const ids = [...new Set(top.map((r) => r.gecko).filter(Boolean))];
  if (ids.length) {
    try {
      const cg = await fetchJson(
        cgUrl(`${CG_PRICE}?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`),
        15000
      );
      // persist into a sticky cache so a later failed fetch can't wipe prices
      for (const g in cg) { if (cg[g] && cg[g].usd != null) priceCache[g] = { price: cg[g].usd, mcap: cg[g].usd_market_cap, ch: cg[g].usd_24h_change, ts: Date.now() }; }
    } catch (e) { /* non-fatal — fall back to last-good prices below */ }
  }
  for (const r of top) {
    const p = r.gecko && priceCache[r.gecko];
    if (p) { r.tokenPrice = p.price; r.tokenMcap = p.mcap ?? null; r.tokenChange24h = p.ch != null ? +Number(p.ch).toFixed(2) : null; }
  }

  // --- derived fundamental ratios + anomaly flags (objective signal) ---
  for (const r of top) {
    const annFees = r.fees24h ? r.fees24h * 365 : 0;
    r.pf = (r.tokenMcap && annFees > 0) ? +(r.tokenMcap / annFees).toFixed(1) : null;   // market cap / annualized fees
    // Keep precision below 0.1%: Provenance earns $96/day on $1.5B of TVL — a
    // yield of ~0.0023% — and toFixed(1) published that as a flat 0. Same
    // false-zero as feePerUser: printing 0 is a different claim from "tiny".
    if (r.tvl > 0 && annFees > 0) {
      const y = (annFees / r.tvl) * 100;
      r.feeYield = +y.toFixed(y < 0.1 ? 4 : 1);
    } else {
      r.feeYield = null;
    }
    r.turnover = (r.tvl > 0) ? +(r.volume24h / r.tvl).toFixed(2) : null;                 // daily volume / TVL
    // Guard fees the same way pf/feeYield do above. Without the annFees check a
    // chain with fees24h = 0 published "fees per user: $0" — a measured-looking
    // claim derived from a number we don't have.
    //
    // And keep precision below a cent: Celo earns $1,671/day across 483,704
    // active addresses = $0.0035 per user, which toFixed(2) published as a flat
    // "$0". Users pay a third of a cent; printing zero is not a rounding nicety,
    // it is a different claim.
    if (r.activeAddresses && annFees > 0) {
      const per = r.fees24h / r.activeAddresses;
      r.feePerUser = +per.toFixed(per < 0.01 ? 4 : 2);
    } else {
      r.feePerUser = null;
    }

    const flags = [];
    const s = r.tvlSpark30;
    if (Array.isArray(s) && s.length > 8) {
      const rets = [];
      for (let i = 1; i < s.length; i++) if (s[i - 1] > 0) rets.push((s[i] - s[i - 1]) / s[i - 1]);
      if (rets.length > 4) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) || 0;
        const last = rets[rets.length - 1];
        if (sd > 0 && Math.abs((last - mean) / sd) >= 2.2 && Math.abs(last) >= 0.05)
          flags.push({ label: `TVL ${last > 0 ? 'jumped' : 'dropped'} ${(last * 100).toFixed(0)}% in a day`, sev: last > 0 ? 'up' : 'down' });
      }
    }
    if (r.volChange1d != null) {
      const avgDaily = r.volChange7d != null ? r.volChange7d / 7 : 0;
      if (r.volChange1d >= 35 && r.volChange1d > avgDaily * 3) flags.push({ label: `Volume +${r.volChange1d.toFixed(0)}% vs 24h ago`, sev: 'up' });
      else if (r.volChange1d <= -35) flags.push({ label: `Volume ${r.volChange1d.toFixed(0)}% vs 24h ago`, sev: 'down' });
    }
    if (r.tvlChange7d != null && r.tvlChange7d <= -15) flags.push({ label: `TVL ${r.tvlChange7d.toFixed(0)}% over 7d`, sev: 'down' });
    else if (r.tvlChange7d != null && r.tvlChange7d >= 20) flags.push({ label: `TVL +${r.tvlChange7d.toFixed(0)}% over 7d`, sev: 'up' });
    r.flags = flags;
  }

  // --- real signal engine: peer medians + rank maps, then typed signals per chain ---
  const _med = (arr) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const medPf = _med(top.map((r) => r.pf));
  const medFeeYield = _med(top.map((r) => r.feeYield));
  const medTurnover = _med(top.map((r) => r.turnover));
  const tvlRankMap = {}; [...top].sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).forEach((r, i) => { tvlRankMap[r.name] = i + 1; });
  const feeRankMap = {}; [...top].sort((a, b) => (b.fees24h || 0) - (a.fees24h || 0)).forEach((r, i) => { feeRankMap[r.name] = i + 1; });
  for (const r of top) {
    r.signals = computeSignals(r, { medPf, medFeeYield, medTurnover, tvlRank: tvlRankMap[r.name], feeRank: feeRankMap[r.name], n: top.length });
  }

  // Stamp the DISPLAYED index here, with the same activityIndex() the published
  // 1-100 scale is defined by. The client used to recompute it by hand across
  // state.chains — a second implementation of a rule that already had an owner,
  // and it had no idea what to do with a row that has no score. A tail chain
  // (rank > 50, served from chains_lite, no score) rescaled 0 against the board's
  // 0.549-0.99 range and rendered "Activity index -122" on a scale we publish as
  // 1-100. A rank-less row now simply has no index, and the UI renders it as "—"
  // by the same nullish path it already uses for pf/feeYield.
  const boardScores = top.map((r) => r.score || 0);
  const mnScore = Math.min(...boardScores), mxScore = Math.max(...boardScores);
  for (const r of top) r.activityIndex = activityIndex(r.score, mnScore, mxScore);

  // --- data-quality caveat: mark TVL figures that cannot be independently
  // verified, so a TVL-ordered view doesn't imply two adjacent rows are peers.
  // Best-effort: if /protocols is unavailable we annotate nothing rather than
  // guess — a missing badge is a smaller error than a wrong one.
  try {
    annotateDataQuality(top, await getProtocols());
  } catch (e) {
    console.error('[buildSnapshot] data-quality annotation skipped:', e.message);
  }

  // A board where EVERY row fell back to the aggregate is not a board — it is the
  // per-chain enrichment having collapsed, and the aggregate is wrong in both
  // directions (Hyperliquid $0 against a real $3.83M; Provenance 145x over).
  // feedIsDegenerate only inspects the global maps, so it cannot see this; TLA
  // found the trace where a fully-degraded build persists over a good snapshot.
  // Per-row provenance already tells us — refuse the build and let /api/chains
  // serve the last good board, marked stale.
  const enrichedRows = top.filter((r) => r.volumeSource === 'perChain' || r.feeSource === 'perChain').length;
  if (top.length && enrichedRows === 0) throw new Error(`per-chain enrichment unavailable for all ${top.length} board chains (every row would carry the over-counted aggregate)`);

  const ranked = top.map((r, i) => ({ rank: i + 1, ...r, links: LINKS[norm(r.name)] || null }));

  // --- chain linking: bake a value-prop category + related peers onto each row ---
  // Peers are drawn from the enriched top-50 (so every peer resolves in this blob)
  // and computed here on the refresh, not per request — stable + reproducible.
  // opts.prior carries the previous blob's peer keys for hysteresis (anti-churn).
  const prior = opts.prior || {};
  for (const r of ranked) { r.coverage = coverageTier(r); r.categoryLabel = categoryLabel(r.category); }
  // Linking view: a chain absent from the volume/fee breakdown carries 0, which
  // means "unknown", not "measured zero" — pass null so similarity never claims a
  // metric it doesn't have (chainkit treats null as absent). Candidates are the
  // enriched top-50, so every peer resolves in this blob (no tail 404s).
  const linkRows = ranked.map((r) => ({
    key: r.key, name: r.name, category: r.category, coverage: r.coverage,
    tvl: r.tvl || null, volume24h: r.volume24h || null, fees24h: r.fees24h || null,
    stables: r.stables || null, feeYield: r.feeYield || null, turnover: r.turnover || null,
  }));
  for (const r of ranked) {
    const rel = relatedBlock(r.name, linkRows, { k: 6, prior: prior[r.key] || [] });
    r.related = rel;
  }
  // Lite index of the WHOLE universe (not just the top-50) so a direct visit to a
  // tail chain resolves to a real profile instead of a 404. Kept in a separate
  // cache key so it never bloats the /api/chains leaderboard payload.
  // Only chains we ENRICHED have trustworthy volume/fees. Everything else holds
  // the aggregate, which is wrong in both directions — it reads 0 for any chain
  // the DEX/fee feeds name differently from the TVL feed (302 of 458), and
  // over-counts elsewhere (Provenance 145x). Shipping those as numbers made 42 of
  // 78 tail profiles publish "$0 volume" for chains that trade millions: XRPL
  // showed $0 against a real $2.64M. This file's own linkRows comment already
  // says it — "0 means unknown, not measured zero" — so null them and let the UI
  // render "—", the way the Stablecoin tile already does.
  const chainsLite = rows.map((r) => ({
    key: r.key, name: r.name, symbol: r.symbol, gecko: r.gecko, chainId: r.chainId,
    category: r.category, categoryLabel: categoryLabel(r.category), coverage: coverageTier(r),
    tvl: r.tvl,
    volume24h: r.volumeSource === 'perChain' ? r.volume24h : null,
    fees24h: r.feeSource === 'perChain' ? r.fees24h : null,
    stables: r.stables,
    activeAddresses: r.activeAddresses,
  }));
  const totals = ranked.reduce((a, r) => {
    a.tvl += r.tvl; a.volume24h += r.volume24h; a.fees24h += r.fees24h; a.stables += r.stables || 0;
    a.activeAddresses += r.activeAddresses || 0;
    return a;
  }, { tvl: 0, volume24h: 0, fees24h: 0, stables: 0, activeAddresses: 0 });

  const usersCoverage = ranked.filter((r) => r.activeAddresses != null).length;

  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    count: ranked.length,
    usersCoverage,
    totals,
    chains: ranked,
    chainsLite, // persisted separately (key 'chains_lite'); stripped from the 'chains' blob
  };
}
// Persist the snapshot: the top-50 leaderboard under 'chains' and the whole-
// universe lite index under 'chains_lite'. Keeping them separate stops the lite
// index from bloating every /api/chains response. Returns the trimmed blob.
async function persistSnapshot(db, data, ts) {
  const lite = data.chainsLite;
  const blob = { ...data }; delete blob.chainsLite;
  try {
    await db.prepare(`INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('chains', ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .bind(JSON.stringify(blob), ts).run();
    if (lite) await db.prepare(`INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('chains_lite', ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .bind(JSON.stringify(lite), ts).run();
  } catch (e) { /* best-effort persistence */ }
  return blob;
}
// Resolve a chain beyond the top-50 from the lite index, and compute its peers at
// request time against the top-50 (every peer resolves in the main blob, so no
// dead links). Returns a basic profile row or null. Not the hot path.
// The lite index is ~107KB / 456 rows, rewritten only by the cron that writes the
// snapshot, so re-reading and re-parsing it per call is pure waste. One visit to a
// tail chain now costs two calls — the server-rendered OG card and the SPA's
// /api/chain/:name fetch — and a crawler hitting /chain/<garbage> pays one to
// learn nothing. Same TTL as the snapshot it is written beside.
let liteCache = { ts: 0, data: null };
async function loadLiteIndex() {
  const now = Date.now();
  if (liteCache.data && now - liteCache.ts < TTL) return liteCache.data;
  try {
    const rows = await dbQuery(`SELECT data FROM snapshot_cache WHERE key='chains_lite' LIMIT 1`);
    if (rows[0]?.data) liteCache = { ts: now, data: JSON.parse(rows[0].data) };
  } catch (e) { /* table may not exist yet — fall through to whatever we hold */ }
  return liteCache.data;
}

// A chain the desk researched that DefiLlama does not carry. We know its name and
// we hold a profile for it; we have no market metrics, and we say so by omitting
// them rather than by 404ing a page we have real analysis for.
async function deskOnlyChain(target) {
  const key = norm(target);
  try {
    const rows = await dbQuery(
      `SELECT chain FROM (
         SELECT chain FROM chain_facts
         UNION SELECT chain FROM dead_chains
         UNION SELECT chain FROM mid_chains
       ) WHERE lower(chain) = lower(?1)`,
      [target]
    );
    let name = rows[0] && rows[0].chain;
    if (!name) {
      // norm() differences (spaces, punctuation) — scan the researched set once.
      const all = await dbQuery(`SELECT DISTINCT chain FROM chain_facts UNION SELECT chain FROM dead_chains UNION SELECT chain FROM mid_chains`);
      const hit = all.find((r) => r.chain && norm(r.chain) === key);
      name = hit && hit.chain;
    }
    if (!name) return null;
    return {
      key,
      name,
      symbol: null, gecko: null, chainId: null,
      category: resolveCategory(name, null),
      // No market feed covers this chain. null, never 0 — 0 is a measurement.
      tvl: null, volume24h: null, fees24h: null, stables: null, activeAddresses: null,
      coverage: 'research-only',
      marketData: false,
    };
  } catch (e) { return null; }
}

// Resolve a chain we hold research on but that is not on the board.
//
// Two ways this used to 404 on a chain the desk had actually researched:
//   1. Raw lowercase matching, while the rest of the pipeline keys on norm().
//      "Cosmos Hub" never matched DefiLlama's "CosmosHub".
//   2. The chain isn't in DefiLlama's feed AT ALL (Polkadot, Karak, OKExChain),
//      or is listed under a name only a human could map (Fuel -> "Fuel Ignition",
//      Merlin Chain -> "Merlin", Manta Pacific -> "Manta" OR "Manta Atlantic"?).
//      Those are ambiguous, and guessing an alias would put the WRONG chain's
//      metrics on a researched profile — a worse error than the 404.
// So: match on norm(), and if the market feed simply doesn't cover the chain,
// still serve the research with no market figures rather than pretend it doesn't
// exist. The UI already renders a missing figure as "—".
async function resolveTailChain(target) {
  const lite = await loadLiteIndex();
  const key = norm(target);
  let row = Array.isArray(lite) ? lite.find((c) => norm(c.name) === key) : null;
  if (!row) row = await deskOnlyChain(target);
  if (!row) return null;
  const top = (cache.data && cache.data.chains) || [];
  const linkRows = [row, ...top].map((r) => ({
    key: r.key || norm(r.name), name: r.name, category: r.category, coverage: r.coverage || 'basic',
    tvl: r.tvl || null, volume24h: r.volume24h || null, fees24h: r.fees24h || null,
    stables: r.stables || null, feeYield: r.feeYield || null, turnover: r.turnover || null,
  }));
  row.related = relatedBlock(row.name, linkRows, { k: 6 });
  row.categoryLabel = row.categoryLabel || categoryLabel(row.category);
  return row;
}

// Read the cron-refreshed snapshot from D1 (instant, no live upstream calls on
// the hot path). Falls back to a live build only on a cold/empty cache — and
// best-effort primes the cache so subsequent requests don't repeat the miss.
// A snapshot older than this is stale no matter why. The cron runs every 5
// minutes, so 30 minutes is six missed ticks — well past a blip.
const MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000;

async function loadSnapshot() {
  if (ENV.DB) {
    // Retry once before falling through to a live build: a single D1 hiccup was
    // enough to send a cold isolate into buildSnapshot, which can throw and 502
    // while a perfectly good row sits in the table.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const row = await ENV.DB.prepare(`SELECT data, updated_at FROM snapshot_cache WHERE key='chains'`).first();
        if (row && row.data) return { data: JSON.parse(row.data), ts: row.updated_at };
        break;   // no row at all — a build is the right answer
      } catch (e) {
        if (attempt) console.error('[loadSnapshot] D1 read failed twice:', e.message);
      }
    }
  }
  const data = await buildSnapshot();
  const ts = Date.now();
  let blob;
  if (ENV.DB) blob = await persistSnapshot(ENV.DB, data, ts);
  else { blob = { ...data }; delete blob.chainsLite; }
  return { data: blob, ts };
}

function fmtShort(n) {
  n = Number(n) || 0; const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}
function _clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
// Typed, confidence-scored, evidence-bearing signals — the paid agent product.
function computeSignals(r, peers) {
  const sig = [];
  const push = (o) => sig.push({ chain: r.name, id: `${r.name.toLowerCase().replace(/\W/g, '')}_${o.type}`, ...o });
  const n = peers.n || 50;
  // 1 — capital flow (USD-denominated TVL delta)
  if (r.tvlChange7d != null && Math.abs(r.tvlChange7d) >= 12) {
    const m = r.tvlChange7d;
    push({ type: 'capital_flow_7d', label: `Capital ${m > 0 ? 'inflow' : 'outflow'} ${m > 0 ? '+' : ''}${m.toFixed(0)}% (7d TVL)`, direction: m > 0 ? 'bullish' : 'bearish', severity: Math.abs(m) >= 30 ? 'critical' : Math.abs(m) >= 20 ? 'notable' : 'info', confidence: +_clamp(0.55 + Math.abs(m) / 120, 0, 0.92).toFixed(2), summary: `Net ${m > 0 ? 'capital entering' : 'capital leaving'} — TVL ${m > 0 ? '+' : ''}${m.toFixed(1)}% over 7d to $${fmtShort(r.tvl)}.`, evidence: { tvlChange7d: m, tvlChange30d: r.tvlChange30d, tvl_usd: r.tvl }, method: 'USD TVL delta (DefiLlama historicalChainTvl), 7d. Partly price-sensitive — corroborate with fee/volume signals.' });
  }
  // 2 — inorganic / wash-traded volume
  if (r.fees24h > 0 && r.volume24h > 0) {
    const vf = r.volume24h / r.fees24h;
    if (vf > 5000) push({ type: 'inorganic_volume', label: `Volume/fee ratio ${Math.round(vf).toLocaleString()}:1 — abnormally low fees for volume`, direction: 'warning', severity: vf > 15000 ? 'critical' : 'notable', confidence: +_clamp(0.5 + (vf - 5000) / 40000, 0, 0.9).toFixed(2), summary: `$${fmtShort(r.volume24h)} of 24h volume produced only $${fmtShort(r.fees24h)} in fees (${Math.round(vf).toLocaleString()}:1). Organic DEX volume runs ~300–2,000:1; elevated ratios flag wash-traded or heavily-incentivized volume.`, evidence: { volFeeRatio: +vf.toFixed(0), volume24h_usd: r.volume24h, fees24h_usd: r.fees24h, turnover: r.turnover }, method: 'volume24h / fees24h. >5000:1 flagged.' });
  }
  // 3 — volume acceleration (2nd derivative)
  if (r.volChange1d != null && r.volChange7d != null) {
    const daily = r.volChange7d / 7, accel = r.volChange1d - daily;
    if (Math.abs(r.volChange1d) >= 40 && Math.abs(accel) >= 30) push({ type: 'volume_accel', label: `Volume ${r.volChange1d > 0 ? 'surge' : 'collapse'} ${r.volChange1d > 0 ? '+' : ''}${r.volChange1d.toFixed(0)}% (24h)`, direction: r.volChange1d > 0 ? 'bullish' : 'bearish', severity: Math.abs(r.volChange1d) >= 80 ? 'notable' : 'info', confidence: +_clamp(0.5 + Math.abs(accel) / 300, 0, 0.85).toFixed(2), summary: `24h volume moved ${r.volChange1d > 0 ? '+' : ''}${r.volChange1d.toFixed(0)}% vs a 7d run-rate of ${daily.toFixed(0)}%/day — ${accel > 0 ? 'positive' : 'negative'} acceleration.`, evidence: { volChange1d: r.volChange1d, volChange7d: r.volChange7d }, method: '1d vs (7d/7) run-rate; 2nd-derivative of DEX volume.' });
  }
  // 4 — mercenary / incentive-parked TVL
  if (r.feeYield != null && r.turnover != null && r.tvl > 5e7 && r.feeYield < 0.8 && r.turnover < 0.15) push({ type: 'mercenary_tvl', label: `Capital parked, barely used — ${r.feeYield}% fee yield, ${r.turnover}× turnover`, direction: 'warning', severity: 'notable', confidence: 0.6, summary: `$${fmtShort(r.tvl)} locked but generating only ${r.feeYield}% annualized fee yield at ${r.turnover}× daily turnover — a signature of incentive-parked ("mercenary") TVL rather than organic usage.`, evidence: { feeYield_pct: r.feeYield, turnover: r.turnover, tvl_usd: r.tvl }, method: 'feeYield=(fees×365/TVL); turnover=(vol/TVL). Low-yield + low-turnover on large TVL ⇒ incentive-dependent capital.' });
  // 5 — real yield (organic activity)
  if (r.feeYield != null && peers.medFeeYield && r.feeYield > peers.medFeeYield * 1.8 && r.turnover > (peers.medTurnover || 0)) push({ type: 'real_yield', label: `Strong real activity — ${r.feeYield}% fee yield (${(r.feeYield / peers.medFeeYield).toFixed(1)}× peer median)`, direction: 'bullish', severity: 'info', confidence: 0.6, summary: `Fee yield of ${r.feeYield}% is ${(r.feeYield / peers.medFeeYield).toFixed(1)}× the peer median (${peers.medFeeYield}%) with above-median turnover — capital here is used, not just parked.`, evidence: { feeYield_pct: r.feeYield, peer_median_pct: peers.medFeeYield, turnover: r.turnover }, method: 'feeYield vs top-50 median.' });
  // 6 — valuation vs peers (P/F)
  if (r.pf != null && peers.medPf) {
    const ratio = r.pf / peers.medPf;
    if (ratio <= 0.5 || ratio >= 2.2) push({ type: 'valuation', label: `${ratio < 1 ? 'Cheap' : 'Rich'} vs peers — P/F ${r.pf} (median ${peers.medPf})`, direction: ratio < 1 ? 'bullish' : 'bearish', severity: 'info', confidence: 0.5, summary: `Market cap is ${r.pf}× annualized fees, ${ratio < 1 ? 'below' : 'above'} the peer median of ${peers.medPf}× — ${ratio < 1 ? 'relatively cheap on fee multiples' : 'a premium vs fees generated'}.`, evidence: { pf: r.pf, peer_median_pf: peers.medPf }, method: 'P/F = tokenMcap / (fees24h×365), vs top-50 median.' });
  }
  // 7 — TVL-vs-fee rank divergence (ghost-chain / whale-not-user)
  if (peers.tvlRank && peers.feeRank) {
    const gap = peers.feeRank - peers.tvlRank;
    if (gap >= Math.max(10, n * 0.25) && peers.tvlRank <= n * 0.4) push({ type: 'tvl_fee_divergence', label: `Big TVL, little usage — #${peers.tvlRank} by TVL but #${peers.feeRank} by fees`, direction: 'warning', severity: 'notable', confidence: 0.6, summary: `Ranks #${peers.tvlRank} in capital locked but only #${peers.feeRank} in fees generated (${gap}-place gap) — capital-heavy, usage-light, a classic ghost-chain / whale-concentration pattern.`, evidence: { tvl_rank: peers.tvlRank, fee_rank: peers.feeRank, gap }, method: 'Rank divergence between TVL and 24h fees across top-50.' });
  }
  // 8 — price vs usage divergence
  if (r.tokenChange24h != null && r.volChange1d != null && r.tokenChange24h >= 8 && r.volChange1d <= 0) push({ type: 'price_usage_divergence', label: `Token +${r.tokenChange24h.toFixed(0)}% but volume flat/down`, direction: 'warning', severity: 'info', confidence: 0.5, summary: `Native token is up ${r.tokenChange24h.toFixed(0)}% on the day while on-chain volume is ${r.volChange1d.toFixed(0)}% — price is running ahead of usage (speculative).`, evidence: { tokenChange24h: r.tokenChange24h, volChange1d: r.volChange1d }, method: '24h token price change vs 24h volume change.' });
  return sig;
}


app.get('/api/chains', wrap(async (req, res) => {
  try {
    const now = Date.now();
    if (!cache.data || now - cache.ts > TTL) {
      cache = await loadSnapshot();
    }
    // Staleness is a property of AGE, not of whether an exception fired. This
    // used to be set only in the catch below — but loadSnapshot returns whatever
    // D1 holds without checking how old it is, and buildSnapshot only runs when
    // there is no row at all. So when a feed died, the degenerate-feed guard
    // correctly refused to persist and /api/chains then served the aging board
    // forever with no marker, because nothing threw. The guard worked; the
    // `stale: true` it promised never appeared.
    const ageMs = Date.now() - cache.ts;
    const stale = ageMs > MAX_SNAPSHOT_AGE_MS;
    res.json({ ...cache.data, scoreMeta: SCORE_META, cachedAgeMs: ageMs, ...(stale ? { stale: true, staleReason: `snapshot is ${Math.round(ageMs / 60000)} minutes old; the refresh has not produced a usable board` } : {}) });
  } catch (e) {
    console.error('snapshot error:', e.message);
    if (cache.data) return res.json({ ...cache.data, scoreMeta: SCORE_META, stale: true, error: e.message });
    res.status(502).json({ error: 'Failed to fetch chain data: ' + e.message });
  }
}));

// ---------------------------------------------------------------------------
// Per-chain drill-down: curated overview + live top projects by TVL
// ---------------------------------------------------------------------------
const DESCRIPTIONS = {
  ethereum: 'The original smart-contract chain and the largest by TVL. Home to the deepest DeFi, stablecoin and NFT markets; secures most L2s that settle back to it.',
  solana: 'High-throughput monolithic L1 known for low fees and fast finality. A hub for DeFi, memecoins and consumer apps, consistently leading in DEX volume and active traders.',
  base: 'Coinbase\'s Ethereum L2 (OP Stack). Fast-growing retail on-ramp with strong consumer, social and memecoin activity and deep Coinbase integration.',
  bsc: 'BNB Chain — Binance\'s EVM L1. High retail volume, low fees, and one of the largest DEX ecosystems (PancakeSwap) plus heavy stablecoin usage.',
  tron: 'L1 optimized for stablecoin transfers; carries one of the largest USDT floats in crypto. Dominant for payments and remittances rather than DeFi.',
  arbitrum: 'Leading Ethereum L2 (optimistic rollup). Mature DeFi ecosystem with deep liquidity, perps and a large protocol base.',
  polygon: 'EVM scaling ecosystem (PoS chain + zk tech). Broad payments, gaming and enterprise adoption with very high daily active addresses.',
  hyperliquid: 'Purpose-built L1 for a high-performance on-chain perps DEX. Rapidly grew into a top venue for derivatives volume with its own order-book design.',
  avalanche: 'L1 with a subnet architecture for app-specific chains. Used for DeFi, institutional/RWA experiments and gaming.',
  sui: 'Move-based L1 focused on parallel execution and low-latency consumer apps, gaming and DeFi.',
  aptos: 'Move-based L1 (Diem lineage) emphasizing safety and throughput; growing DeFi and payments ecosystem.',
  ton: 'The Open Network, tied to Telegram\'s ~1B users. Focused on mini-apps, payments and consumer-scale distribution.',
  optimism: 'Ethereum L2 and the origin of the OP Stack Superchain. Established DeFi and governance ecosystem.',
  opmainnet: 'Ethereum L2 and the origin of the OP Stack Superchain. Established DeFi and governance ecosystem.',
  near: 'Sharded L1 with an account model aimed at usability; expanding into chain-abstraction and AI-related infrastructure.',
  bitcoin: 'The original blockchain and largest asset by market cap. Increasingly a DeFi settlement layer via L2s, staking and BTCfi protocols.',
  cardano: 'Research-driven PoS L1 (eUTXO model) with a focus on formal methods and a distinct DeFi ecosystem.',
  sei: 'High-performance EVM-compatible L1 optimized for trading and low latency.',
  monad: 'High-performance parallel-EVM L1 focused on massively higher throughput while staying EVM-compatible.',
  celo: 'Mobile-first, EVM-compatible chain (now an Ethereum L2) focused on payments, stablecoins and real-world usage.',
  starknet: 'ZK rollup using the Cairo VM for scalable, low-cost Ethereum execution.',
  zksync: 'ZK rollup (zkEVM) scaling Ethereum with low fees and a growing DeFi ecosystem.',
  gnosis: 'Stable-payments-focused EVM chain (xDai) with strong community and prediction-market roots.',
  osmosis: 'Cosmos SDK app-chain and the ecosystem’s primary DEX/liquidity hub, connecting IBC-linked chains.',
  stacks: 'Bitcoin L2 (Proof of Transfer) bringing smart contracts and DeFi to Bitcoin without modifying its base layer.',
  injective: 'Cosmos SDK L1 built for finance — an on-chain order book, derivatives and cross-chain trading infrastructure.',
  cronos: 'EVM-compatible chain in the Crypto.com ecosystem, focused on DeFi and consumer payments integration.',
  mantle: 'Ethereum L2 (modular rollup) backed by the BitDAO/Mantle treasury, focused on DeFi and lower fees.',
  flow: 'L1 built for consumer apps, NFTs and gaming, known for the NBA Top Shot collectibles ecosystem.',
  linea: 'zkEVM Ethereum L2 built by Consensys, aiming for full EVM equivalence with ZK-proof scaling.',
  unichain: 'Uniswap Labs’ own Ethereum L2 (OP Stack), built to optimize DEX trading and cross-chain liquidity.',
  ronin: 'EVM sidechain purpose-built for gaming, originally created for Axie Infinity and its NFT marketplace.',
  berachain: 'EVM L1 using a novel Proof-of-Liquidity consensus that ties validator rewards to on-chain liquidity provision.',
  sonic: 'High-throughput EVM L1 (formerly Fantom) focused on low-latency execution and developer incentives.',
};

// Curated "most reliable" DEX + NFT marketplace per chain (keyed by norm()).
// Only well-established venues are listed; unknowns fall back to "—" in the UI.
const LINKS = {
  ethereum:   { dex: { name: 'Uniswap',     url: 'https://app.uniswap.org' },     nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  solana:     { dex: { name: 'Jupiter',     url: 'https://jup.ag' },              nft: { name: 'Magic Eden',   url: 'https://magiceden.io' } },
  base:       { dex: { name: 'Aerodrome',   url: 'https://aerodrome.finance' },   nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  bsc:        { dex: { name: 'PancakeSwap', url: 'https://pancakeswap.finance' }, nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  tron:       { dex: { name: 'SunSwap',     url: 'https://sun.io' },              nft: { name: 'APENFT',       url: 'https://apenft.io' } },
  arbitrum:   { dex: { name: 'Uniswap',     url: 'https://app.uniswap.org' },     nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  polygon:    { dex: { name: 'QuickSwap',   url: 'https://quickswap.exchange' },  nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  hyperliquid:{ dex: { name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz' }, nft: { name: 'Drip.Trade',   url: 'https://drip.trade' } },
  avalanche:  { dex: { name: 'Trader Joe',  url: 'https://lfj.gg' },              nft: { name: 'Joepegs',      url: 'https://joepegs.com' } },
  sui:        { dex: { name: 'Cetus',       url: 'https://www.cetus.zone' },      nft: { name: 'Tradeport',    url: 'https://www.tradeport.xyz/sui' } },
  aptos:      { dex: { name: 'Thala',       url: 'https://app.thala.fi' },        nft: { name: 'Wapal',        url: 'https://wapal.io' } },
  ton:        { dex: { name: 'STON.fi',     url: 'https://ston.fi' },             nft: { name: 'Getgems',      url: 'https://getgems.io' } },
  opmainnet:  { dex: { name: 'Velodrome',   url: 'https://velodrome.finance' },   nft: { name: 'OpenSea',      url: 'https://opensea.io' } },
  near:       { dex: { name: 'Ref Finance', url: 'https://app.ref.finance' },     nft: { name: 'Mintbase',     url: 'https://www.mintbase.xyz' } },
  bitcoin:    { dex: null,                                                        nft: { name: 'Magic Eden',   url: 'https://magiceden.io/ordinals' } },
  cardano:    { dex: { name: 'Minswap',     url: 'https://minswap.org' },         nft: { name: 'jpg.store',    url: 'https://www.jpg.store' } },
  sei:        { dex: { name: 'Astroport',   url: 'https://sei.astroport.fi' },    nft: { name: 'Pallet',       url: 'https://pallet.exchange' } },
  celo:       { dex: { name: 'Uniswap',     url: 'https://app.uniswap.org' },     nft: null },
  starknet:   { dex: { name: 'Ekubo',       url: 'https://app.ekubo.org' },       nft: { name: 'Unframed',     url: 'https://unframed.co' } },
  zksync:     { dex: { name: 'SyncSwap',    url: 'https://syncswap.xyz' },        nft: { name: 'Element',      url: 'https://element.market' } },
  gnosis:     { dex: { name: 'Balancer',    url: 'https://balancer.fi' },         nft: null },
  osmosis:    { dex: { name: 'Osmosis',     url: 'https://app.osmosis.zone' },    nft: { name: 'Stargaze',     url: 'https://www.stargaze.zone' } },
  stacks:     { dex: { name: 'ALEX',        url: 'https://app.alexlab.co' },      nft: { name: 'Gamma',        url: 'https://gamma.io' } },
  injective:  { dex: { name: 'Helix',       url: 'https://helixapp.com' },        nft: null },
  cronos:     { dex: { name: 'VVS Finance', url: 'https://vvs.finance' },         nft: null },
  mantle:     { dex: { name: 'Merchant Moe',url: 'https://merchantmoe.com' },     nft: null },
  flow:       { dex: { name: 'Increment',   url: 'https://app.increment.fi' },    nft: { name: 'NBA Top Shot', url: 'https://nbatopshot.com' } },
  linea:      { dex: { name: 'Lynex',       url: 'https://www.lynex.fi' },        nft: { name: 'Element',      url: 'https://element.market' } },
  unichain:   { dex: { name: 'Uniswap',     url: 'https://app.uniswap.org' },     nft: null },
  ronin:      { dex: { name: 'Katana',      url: 'https://katana.roninchain.com' }, nft: { name: 'Mavis Market', url: 'https://marketplace.roninchain.com' } },
  berachain:  { dex: { name: 'BEX',         url: 'https://bex.berachain.com' },   nft: null },
  sonic:      { dex: { name: 'Shadow',      url: 'https://www.shadow.so' },       nft: null },
};

// LINKS and DESCRIPTIONS drifted out of sync before (11 chains had a LINKS
// entry but no DESCRIPTIONS entry) — warn once at cold start instead of
// silently shipping a blank description card next time a chain is added.
{
  const missing = Object.keys(LINKS).filter((k) => !(k in DESCRIPTIONS));
  if (missing.length) console.error('[parity] LINKS chains missing a DESCRIPTIONS entry:', missing.join(', '));
}

// Top NFT / Ordinals collections per chain (curated, verified marketplace links)
const CHAIN_NFTS = {
  ethereum: [
    { name: 'CryptoPunks', url: 'https://opensea.io/collection/cryptopunks' },
    { name: 'Bored Ape Yacht Club', url: 'https://opensea.io/collection/boredapeyachtclub' },
    { name: 'Pudgy Penguins', url: 'https://opensea.io/collection/pudgypenguins' },
  ],
  solana: [
    { name: 'Mad Lads', url: 'https://magiceden.io/marketplace/mad_lads' },
    { name: 'Okay Bears', url: 'https://magiceden.io/marketplace/okay_bears' },
    { name: 'Claynosaurz', url: 'https://magiceden.io/marketplace/claynosaurz' },
  ],
  bitcoin: [
    { name: 'NodeMonkes', url: 'https://magiceden.io/ordinals/marketplace/nodemonkes' },
    { name: 'Bitcoin Puppets', url: 'https://magiceden.io/ordinals/marketplace/bitcoin-puppets' },
    { name: 'Runestone', url: 'https://magiceden.io/ordinals/marketplace/runestone' },
  ],
  polygon: [
    { name: 'Courtyard', url: 'https://opensea.io/collection/courtyard-nft' },
    { name: 'DraftKings Reignmakers', url: 'https://opensea.io/collection/reignmakers-football' },
    { name: 'Lens Protocol', url: 'https://opensea.io/collection/lens-protocol-profiles' },
  ],
  base: [
    { name: 'BasePaint', url: 'https://opensea.io/collection/basepaint' },
    { name: 'tiny dinos', url: 'https://opensea.io/collection/tiny-dinos-eth' },
    { name: 'The Bald Eagle', url: 'https://opensea.io/collection/onchain-gaias' },
  ],
  ronin: [
    { name: 'Axie Infinity', url: 'https://marketplace.roninchain.com/collections/axie' },
    { name: 'Pixels (Pixel Farm)', url: 'https://marketplace.roninchain.com/collections/pixel' },
    { name: 'Wild Forest', url: 'https://marketplace.roninchain.com/' },
  ],
  avalanche: [
    { name: 'Dokyo', url: 'https://joepegs.com/collections/avalanche/0x892d81221484f690c0d97d3c2057101377b96f0e' },
    { name: 'Chikn', url: 'https://joepegs.com/' },
    { name: 'The Kingdom', url: 'https://joepegs.com/' },
  ],
  aptos: [
    { name: 'Aptos Monkeys', url: 'https://wapal.io/collection/Aptos-Monkeys' },
    { name: 'Bruh Bears', url: 'https://wapal.io/' },
    { name: 'Aptomingos', url: 'https://wapal.io/' },
  ],
  sui: [
    { name: 'Prime Machin', url: 'https://www.tradeport.xyz/sui/collection/prime-machin' },
    { name: 'Fuddies', url: 'https://www.tradeport.xyz/sui' },
    { name: 'SuiFrens', url: 'https://www.tradeport.xyz/sui' },
  ],
};

// CoinGecko ecosystem category per chain → for live top alt/meme tokens
const CHAIN_CG_CATEGORY = {
  ethereum: 'ethereum-ecosystem', solana: 'solana-ecosystem', base: 'base-ecosystem',
  bsc: 'binance-smart-chain', arbitrum: 'arbitrum-ecosystem', polygon: 'polygon-ecosystem',
  avalanche: 'avalanche-ecosystem', tron: 'tron-ecosystem', sui: 'sui-ecosystem',
  aptos: 'aptos-ecosystem', near: 'near-protocol-ecosystem', opmainnet: 'optimism-ecosystem',
  berachain: 'berachain-ecosystem', sei: 'sei-ecosystem', starknet: 'starknet-ecosystem',
  hyperliquid: 'hyperliquid-ecosystem', cardano: 'cardano-ecosystem', ton: 'open-network-ton-ecosystem',
};
// CoinGecko meme-coin category per chain (preferred for "top meme/alt coins")
const CHAIN_CG_MEME = {
  solana: 'solana-meme-coins', ethereum: 'ethereum-meme-coins', base: 'base-meme-coins',
  bsc: 'bnb-chain-meme-coins', tron: 'tron-meme-coins', ton: 'ton-meme-coins',
  sui: 'sui-meme', avalanche: 'avalanche-meme-coins', arbitrum: 'arbitrum-meme-coins',
  polygon: 'polygon-ecosystem-meme-coins', hyperliquid: 'hyperliquid-ecosystem',
};
let tokensCache = {}; // per-category cache
const TOK_EXCLUDE = /tether|usd-coin|dai|stable|first-digital|ethena|pyusd|frax|wrapped|weth|wbtc|cbbtc|coinbase-wrapped|binance-peg|bridged|staked|steth|reth|jito-staked|marinade|msol|jitosol|bnsol|lido|liquid-staking|savings-dai|rocket-pool|global-dollar|world-liberty/i;
function isStableish(t) {
  if (!t) return true;
  if (TOK_EXCLUDE.test(t.id)) return true;
  if (/usd|dai/i.test(t.symbol || '')) return true;
  if (t.current_price > 0.9 && t.current_price < 1.1 && /usd|dollar|stable|peg/i.test((t.id || '') + (t.symbol || ''))) return true;
  return false;
}
async function fetchCgCategory(cat) {
  if (!cat) return [];
  const cached = tokensCache[cat];
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return cached.data;
  try {
    const mk = await fetchJson(cgUrl(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${cat}&order=market_cap_desc&per_page=40&page=1`), 12000);
    const arr = Array.isArray(mk) ? mk : [];
    tokensCache[cat] = { ts: Date.now(), data: arr };
    return arr;
  } catch (e) { return []; }
}
async function chainTopTokens(row) {
  const nkey = norm(row.name);
  let list = (await fetchCgCategory(CHAIN_CG_MEME[nkey])).filter((t) => t && t.id !== row.gecko && !isStableish(t));
  if (list.length < 3) {
    const eco = (await fetchCgCategory(CHAIN_CG_CATEGORY[nkey])).filter((t) => t && t.id !== row.gecko && !isStableish(t));
    const seen = new Set(list.map((t) => t.id));
    for (const t of eco) if (!seen.has(t.id)) { list.push(t); seen.add(t.id); }
  }
  if (!list.length) return null;
  return list.slice(0, 3).map((t) => ({ name: t.name, symbol: (t.symbol || '').toUpperCase(), price: t.current_price, change24h: t.price_change_percentage_24h, mcap: t.market_cap, url: `https://www.coingecko.com/en/coins/${t.id}` }));
}

let protoCache = { ts: 0, data: null };
const PROTO_TTL = 15 * 60 * 1000;
async function getProtocols() {
  const now = Date.now();
  if (!protoCache.data || now - protoCache.ts > PROTO_TTL) {
    try { protoCache = { ts: now, data: await fetchJson('https://api.llama.fi/protocols', 25000) }; }
    catch (e) { if (!protoCache.data) throw e; }
  }
  return protoCache.data;
}

// Refresh live RWA (DefiLlama RWA category, TVL-ranked) + DePIN (CoinGecko DePIN
// category, market-cap ranked) breadth into D1. Called on a slow cron gate.
const normSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function refreshRwaDepin(env) {
  if (!env || !env.DB) return;
  try {
    const protos = await getProtocols();
    const rwa = (Array.isArray(protos) ? protos : [])
      .filter((p) => p.category === 'RWA' && (Number(p.tvl) || 0) > 0)
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 150);
    if (rwa.length) {
      const stmt = env.DB.prepare(
        `INSERT INTO rwa_live (slug, name, tvl, chains, url, logo, change_1d, change_7d, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET name=excluded.name, tvl=excluded.tvl, chains=excluded.chains,
           url=excluded.url, logo=excluded.logo, change_1d=excluded.change_1d, change_7d=excluded.change_7d, updated_at=excluded.updated_at`
      );
      const now = Date.now();
      await env.DB.batch(rwa.map((p) => stmt.bind(
        normSlug(p.name), p.name, Number(p.tvl) || 0, JSON.stringify((p.chains || []).slice(0, 10)),
        p.url || null, p.logo || null, p.change_1d ?? null, p.change_7d ?? null, now
      )));
    }
  } catch (e) { console.error('[refreshRwaDepin] RWA failed:', e.message); }
  try {
    const mk = await fetchJson(cgUrl('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=depin&order=market_cap_desc&per_page=50&page=1'), 15000);
    const depin = (Array.isArray(mk) ? mk : []).filter((t) => t && t.id);
    if (depin.length) {
      const stmt = env.DB.prepare(
        `INSERT INTO depin_live (id, name, symbol, mcap, price, change_24h, volume_24h, image, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, symbol=excluded.symbol, mcap=excluded.mcap,
           price=excluded.price, change_24h=excluded.change_24h, volume_24h=excluded.volume_24h, image=excluded.image, updated_at=excluded.updated_at`
      );
      const now = Date.now();
      await env.DB.batch(depin.map((t) => stmt.bind(
        t.id, t.name, (t.symbol || '').toUpperCase(), t.market_cap ?? null, t.current_price ?? null,
        t.price_change_percentage_24h != null ? +t.price_change_percentage_24h.toFixed(2) : null,
        t.total_volume ?? null, t.image || null, now
      )));
    }
  } catch (e) { console.error('[refreshRwaDepin] DePIN failed:', e.message); }
}

// Refresh the OFAC-sanctioned address list from the 0xB10C SDN mirror.
// Per chain: fetch the plain-text file, parse, and atomically replace that
// chain's rows (delete-then-insert) so removed addresses drop off too. A failed
// fetch for a chain leaves that chain's existing rows untouched (fail-safe: we
// never wipe a chain's screening set on a transient network error).
async function refreshSanctioned(env) {
  if (!env || !env.DB) return;
  const now = Date.now();
  let chains = 0, total = 0;
  for (const { file, chain } of OFAC_FILES) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      let text;
      try {
        const r = await fetch(ofacFileUrl(file), { headers: GP_HEADERS, signal: ctl.signal });
        if (!r.ok) throw new Error(`${r.status}`);
        text = await r.text();
      } finally { clearTimeout(t); }
      const addrs = parseSanctionedFile(text);
      if (!addrs.length) continue; // never blank out a chain we can't parse
      const rows = buildSanctionedRows(chain, addrs, now);
      const ins = env.DB.prepare(
        `INSERT INTO sanctioned_addresses (address_lc, address, chain, source, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address_lc, chain) DO UPDATE SET address=excluded.address,
           source=excluded.source, updated_at=excluded.updated_at`
      );
      // upsert fresh in chunks (D1 batch statement cap), then drop this chain's
      // rows not re-stamped this run (addresses removed from the SDN list)
      for (let i = 0; i < rows.length; i += 100) {
        await env.DB.batch(rows.slice(i, i + 100).map((x) =>
          ins.bind(x.address_lc, x.address, x.chain, x.source, x.updated_at)));
      }
      await env.DB.prepare(`DELETE FROM sanctioned_addresses WHERE chain = ? AND updated_at < ?`).bind(chain, now).run();
      chains += 1; total += rows.length;
    } catch (e) { console.error(`[refreshSanctioned] ${chain} failed:`, e.message); }
  }
  if (chains) console.error(`[refreshSanctioned] refreshed ${total} addresses across ${chains} chains`);
}

// Re-index the NFT catalog from CoinGecko /nfts/list (the full collection
// universe, paged). Upserts fresh rows; prunes collections no longer listed.
async function refreshNftCatalog(env) {
  if (!env || !env.DB) return;
  const now = Date.now();
  try {
    const all = [];
    for (let page = 1; page <= 20; page++) { // hard cap ~5000 collections
      // no `order` param: /nfts/list's default enumeration is stable + complete;
      // adding an order causes unstable paging (repeats/gaps → collections skipped)
      const url = cgUrl(`${NFT_LIST_URL}?per_page=${NFT_PER_PAGE}&page=${page}`);
      let batch;
      try { batch = await fetchJson(url, 15000, GP_HEADERS); } catch (e) {
        console.error(`[refreshNftCatalog] page ${page} failed:`, e.message); break;
      }
      const rows = nftRowsFromPage(batch, now);
      if (!rows.length) break; // reached the end
      all.push(...rows);
      if (rows.length < NFT_PER_PAGE) break;
    }
    const rows = dedupeNftRows(all);
    if (rows.length < 100) { // sanity guard: never nuke the catalog on a partial pull
      console.error(`[refreshNftCatalog] only ${rows.length} rows fetched — skipping upsert`); return;
    }
    const ins = env.DB.prepare(
      `INSERT INTO nft_catalog (id, name, chain, contract_address, symbol, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, chain=excluded.chain,
         contract_address=excluded.contract_address, symbol=excluded.symbol, indexed_at=excluded.indexed_at`
    );
    // D1 batches are capped; chunk the upsert, then prune stale in a final statement
    for (let i = 0; i < rows.length; i += 100) {
      await env.DB.batch(rows.slice(i, i + 100).map((x) =>
        ins.bind(x.id, x.name, x.chain, x.contract_address, x.symbol, x.indexed_at)));
    }
    await env.DB.prepare(`DELETE FROM nft_catalog WHERE indexed_at < ?`).bind(now).run();
    console.error(`[refreshNftCatalog] re-indexed ${rows.length} collections`);
  } catch (e) { console.error('[refreshNftCatalog] failed:', e.message); }
}

// Token-guarded ops trigger for the slow refresh jobs (manual re-seed / verify).
// Disabled (404) unless the ADMIN_TOKEN secret is set; requires a matching bearer.
app.post('/api/admin/refresh', wrap(async (req, res) => {
  const token = ENV.ADMIN_TOKEN || '';
  if (!token) return res.status(404).json({ error: 'not found' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${token}`) return res.status(401).json({ error: 'unauthorized' });
  const job = (req.query.job || 'all').toLowerCase();
  const ran = [];
  try {
    if (job === 'sanctioned' || job === 'all') { await refreshSanctioned(ENV); ran.push('sanctioned'); }
    if (job === 'nft' || job === 'all') { await refreshNftCatalog(ENV); ran.push('nft'); }
    res.json({ ok: true, ran });
  } catch (e) { res.status(500).json({ error: e.message, ran }); }
}));

// ---------------------------------------------------------------------------
// Research desk (Phase G) write path — DESK_TOKEN-guarded. The autonomous desk
// POSTs verified, sourced findings to /api/desk/propose; they land as 'pending'
// in desk_proposals (a durable, human-reviewed queue). Nothing reaches the live
// tables without a human promoting it (CLAUDE.md §1.5). Disabled (404) unless
// DESK_TOKEN is set.
// ---------------------------------------------------------------------------
function deskAuth(req, res) {
  const token = ENV.DESK_TOKEN || '';
  if (!token) { res.status(404).json({ error: 'not found' }); return false; }
  if ((req.headers['authorization'] || '') !== `Bearer ${token}`) { res.status(401).json({ error: 'unauthorized' }); return false; }
  return true;
}

app.post('/api/desk/propose', wrap(async (req, res) => {
  if (!deskAuth(req, res)) return;
  if (!ENV.DB) return res.status(503).json({ error: 'no DB' });
  let b;
  try { b = await req.raw.json(); } catch (e) { return res.status(400).json({ error: 'invalid JSON body: ' + (e && e.message || e) }); }
  const dataset = String(b.dataset || '').trim();
  const slug = String(b.slug || '').trim();
  if (!dataset || !slug) return res.status(400).json({ error: 'dataset and slug are required' });
  const namesIndividuals = b.names_individuals ? 1 : 0;
  const confidence = Number(b.confidence);
  // Force human review for individual-naming/fraud claims or low/invalid confidence
  // (NaN counts as low — force review, the safe default).
  const highConfidence = Number.isFinite(confidence) && confidence >= 0.75;
  const needsReview = (namesIndividuals || !highConfidence) ? 1 : 0;
  try {
    await ENV.DB.prepare(
      `INSERT INTO desk_proposals (dataset, slug, title, summary, payload, sources, names_individuals, confidence, needs_human_review, status, queued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
       ON CONFLICT(dataset, slug) DO UPDATE SET title=excluded.title, summary=excluded.summary, payload=excluded.payload,
         sources=excluded.sources, names_individuals=excluded.names_individuals, confidence=excluded.confidence,
         needs_human_review=excluded.needs_human_review, status='pending', queued_at=datetime('now')`
    ).bind(dataset, slug, b.title || null, b.summary || null, JSON.stringify(b.payload || {}), JSON.stringify(b.sources || []),
      namesIndividuals, Number.isFinite(confidence) ? confidence : null, needsReview).run();
    res.json({ ok: true, dataset, slug, needs_human_review: !!needsReview });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.get('/api/desk/pending', wrap(async (req, res) => {
  if (!deskAuth(req, res)) return;
  if (!ENV.DB) return res.status(503).json({ error: 'no DB' });
  try {
    const status = String(req.query.status || 'pending');
    const rows = await dbQuery(
      `SELECT id, dataset, slug, title, summary, names_individuals, confidence, needs_human_review, status, queued_at
       FROM desk_proposals WHERE status = ? ORDER BY queued_at DESC LIMIT 100`, [status]);
    res.json({ status, count: rows.length, proposals: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// Read the research desk's per-dimension rows for one chain (identity, capital,
// team, narrative, risk, token, onchain, synthesis, links...).
//
// This table held 248 rows of researched, cited analysis and NOTHING in src/ read
// it — every dossier the desk wrote was invisible to users. That is the whole of
// "berachain is thriving but we can't justify it, no citations or analysis".
//
// Match on the desk's name OR a case-insensitive match: chain_facts is keyed by
// the researcher's spelling, which does not always match the TVL feed's ("NEAR"
// in the desk, "Near" on the board).
async function chainFacts(chainName) {
  const out = {};
  try {
    const rows = await dbQuery(
      `SELECT dimension, data, sources, updated_at FROM chain_facts WHERE chain = ?1 OR lower(chain) = lower(?1)`,
      [chainName]
    );
    for (const r of rows) {
      if (!r.dimension || r.dimension === '_meta') continue;
      let data = null, sources = null;
      try { data = r.data ? JSON.parse(r.data) : null; } catch (e) { continue; }   // skip malformed, never serve half-parsed research
      try { sources = r.sources ? JSON.parse(r.sources) : null; } catch (e) { sources = null; }
      out[r.dimension] = { data, sources, updatedAt: r.updated_at || null };
    }
  } catch (e) { /* facts are best-effort — the table may not exist yet */ }
  return Object.keys(out).length ? out : null;
}

// Resolve a chain's tags: themes are curated (stored), the cohort is COMPUTED.
//
// Field names here are taken FROM THE REAL ROWS, not from what a schema ought to
// look like. The first version of this function read `identity.tier` and
// `identity.permissioned` — neither exists in a single one of the 130 rows. It
// then filtered the real cohorts out of `tags[]` with isTheme and read them back
// from those non-existent fields, so 69 researched chains (every graveyard and
// stuck one) computed a null cohort and rendered no chip. The tests passed
// because their fixtures used the invented names too: the code agreed with
// itself about a schema that did not exist.
//
// What the rows ACTUALLY carry:
//   tags[]       cohort AND theme tags together   (Scroll: ['graveyard','l2','zk'])
//   permissioned a THEME tag, not a field          (Canton: [...,'permissioned'])
//   the launch date under one of three keys        (launched | mainnet_live | founded)
const LAUNCH_KEYS = ['launched', 'mainnet_live', 'founded'];
const PRELAUNCH_STATUS = new Set(['pre-launch', 'anticipated']);
function launchDateOf(identity) {
  for (const k of LAUNCH_KEYS) {
    const v = identity[k];
    // Strings only: `founded: 2021` appears as a NUMBER, and parseLaunch treats a
    // number as epoch millis, so 2021 would resolve to 1st Jan 1970. Beyond that
    // guard, tags.js owns which date FORMATS are valid — this regex used to
    // enumerate them a second time, so a format added there would be filtered out
    // here before cohortFor ever saw it and the cohort would silently go null.
    // That is the exact failure this function exists to fix.
    if (typeof v === 'string' && parseLaunch(v) != null) return v.trim();
  }
  return null;
}

function resolveTags(row, facts, onBoard) {
  const identity = (facts && facts.identity && facts.identity.data) || {};
  const stored = canonChainTags(Array.isArray(identity.tags) ? identity.tags : []);
  const themes = stored.filter(isChainTheme);
  const storedCohort = stored.find(isChainCohort) || null;
  // Fall back to the chain's own category when the desk has not tagged it, so an
  // unresearched chain still carries what we can honestly derive.
  const derived = themes.length ? themes : themesForCategory(row.category);
  const cohort = cohortFor({
    launched: launchDateOf(identity),
    onBoard: !!onBoard,
    // The desk's own classification, which lives in tags[] — this is what makes
    // graveyard and stuck reachable at all.
    tier: storedCohort,
    isPreLaunch: PRELAUNCH_STATUS.has(identity.status),   // cohortFor owns the 'anticipated' TIER itself
    // Canton is permissioned AND on the board; cohortFor checks this last so a
    // private chain can never hide a real board position.
    isPrivate: themes.includes('permissioned'),
  }, Date.now());
  return { cohort, themes: derived };
}

app.get('/api/chain/:name', wrap(async (req, res) => {
  try {
    if (!cache.data) cache = await loadSnapshot();
    const target = String(req.params.name || '').toLowerCase();
    let row = cache.data.chains.find((c) => c.name.toLowerCase() === target);
    if (!row) { row = await resolveTailChain(target); } // beyond the top-50 → lite index
    if (!row) return res.status(404).json({ error: 'unknown chain' });

    // Board membership decides several things below; compute it once.
    const onBoard = (cache.data.chains || []).some((c) => c.name === row.name);

    let topProjects = [];
    let dataQuality = row.dataQuality || null;
    try {
      const protos = await getProtocols();
      const name = row.name;
      // Only assess here for chains OUTSIDE the ranked top-50 — the snapshot has
      // already assessed every board row, and a clean board row legitimately
      // carries no dataQuality. Guarding on `!dataQuality` instead made 49 of 50
      // board chains re-scan all 7,867 protocols on every detail request just to
      // re-derive null.
      if (!onBoard) {
        const dq = assessChainDataQuality(name, protos, { displayedTvl: row.tvl });
        // A caveat above the auto-publish ceiling is held for review, not served.
        if (dq && dq.autoPublish !== false) dataQuality = dq;
      }
      const SKIP = new Set(['CEX', 'Chain', 'Bridge']);
      topProjects = (Array.isArray(protos) ? protos : [])
        .filter((p) => Array.isArray(p.chains) && p.chains.includes(name) && !SKIP.has(p.category))
        .map((p) => ({
          name: p.name, category: p.category || '', tvl: (p.chainTvls && p.chainTvls[name]) || p.tvl || 0,
          description: p.description || null, url: p.url || null, twitter: p.twitter || null, logo: p.logo || null,
        }))
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, 10);
    } catch (e) { /* projects are best-effort */ }

    let analysis = null;
    try {
      const rows = await dbQuery(`SELECT take, sentiment, trend, sources, profile, updated_at FROM chain_analysis WHERE chain = ? LIMIT 1`, [row.name]);
      if (rows[0]) { analysis = rows[0]; try { analysis.profile = rows[0].profile ? JSON.parse(rows[0].profile) : null; } catch (e) { analysis.profile = null; } }
    } catch (e) { /* analysis is best-effort */ }

    const nkey = norm(row.name);
    const topNfts = CHAIN_NFTS[nkey] || null;

    // live top meme/alt tokens on this chain (prefers CoinGecko meme category), cached 10m
    let topTokens = null;
    try { topTokens = await chainTopTokens(row); } catch (e) { /* non-fatal */ }

    let risk = null;
    try { const rr = await dbQuery(`SELECT level, summary, evidence, sources FROM risk_flags WHERE entity_type='chain' AND entity_name = ? LIMIT 1`, [row.name]); if (rr[0]) risk = rr[0]; } catch (e) {}

    const facts = await chainFacts(row.name);

    const tags = resolveTags(row, facts, onBoard);

    res.json({ chain: row, scoreMeta: SCORE_META, description: DESCRIPTIONS[nkey] || null, dataQuality, topProjects, topNfts, topTokens, analysis, risk, facts, tags, tagVocab: tagVocab() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// Graveyard: chains that launched recently and then collapsed (populated by the research agent).
// The cause-of-death vocabulary (canon map + labels + fraud set) lives in
// src/lib/causes.js — the single source of truth, imported above and served to
// the SPA via trends.causeVocab so nothing hand-mirrors a copy.

app.get('/api/dead', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT chain, launched, peak_tvl, current_tvl, drawdown_pct, peak_date, why, outlook, verdict, sources, profile, updated_at FROM dead_chains ORDER BY peak_tvl DESC`);
    const chains = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });

    // aggregate trends across the graveyard
    const tagCounts = {}; let ddSum = 0, ddN = 0, fraud = 0; const verdictCounts = {};
    for (const c of chains) {
      const tags = (c.profile && c.profile.cause_tags) || [];
      // canonicalize synonyms + dedupe per-chain so a merge can't double-count
      canonTags(tags).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      if (isFraudy(tags)) fraud++; // canonical: a future synonym can't silently undercount
      if (c.drawdown_pct != null) { ddSum += c.drawdown_pct; ddN++; }
      const v = (c.verdict || 'unknown').toLowerCase();
      verdictCounts[v] = (verdictCounts[v] || 0) + 1;
    }
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ tag: k, label: TAG_LABELS[k] || k, count: n }));

    let narrative = null, successFactors = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k = 'trends' LIMIT 1`); if (m[0]) narrative = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    try { const s = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k = 'success_factors' LIMIT 1`); if (s[0]) successFactors = { text: s[0].v, updated_at: s[0].updated_at }; } catch (e) {}

    const totalPeak = chains.reduce((a, c) => a + (c.peak_tvl || 0), 0);
    const totalNow = chains.reduce((a, c) => a + (c.current_tvl || 0), 0);

    res.json({
      chains, count: chains.length,
      trends: {
        topTags, verdictCounts, causeVocab: causeVocab(),
        avgDrawdown: ddN ? +(ddSum / ddN).toFixed(1) : null,
        fraudCount: fraud, totalPeakTvl: totalPeak, totalCurrentTvl: totalNow,
        wipedOut: totalPeak > 0 ? +(((totalPeak - totalNow) / totalPeak) * 100).toFixed(1) : null,
        narrative, successFactors,
      },
    });
  } catch (e) {
    res.json({ chains: [], count: 0, error: e.message });
  }
}));

// Mid tier: alive-but-directionless chains
app.get('/api/mid', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT chain, launched, tvl, verdict, why_stuck, outlook, profile, sources, updated_at FROM mid_chains ORDER BY tvl DESC`);
    const chains = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    const verdictCounts = {};
    const tagCounts = {};
    for (const c of chains) {
      const v = (c.verdict || 'unknown').toLowerCase(); verdictCounts[v] = (verdictCounts[v] || 0) + 1;
      // same vocabulary as the graveyard: canonicalize + dedupe, or one concept
      // fragments into two bars (e.g. outcompeted vs competition).
      const tags = (c.profile && c.profile.success_factors_missing) || [];
      canonTags(tags).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    }
    const topGaps = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ tag: k, label: TAG_LABELS[k] || k.replace(/_/g, ' '), count: n }));
    let framework = null;
    try { const s = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k = 'success_factors' LIMIT 1`); if (s[0]) framework = { text: s[0].v, updated_at: s[0].updated_at }; } catch (e) {}
    res.json({ chains, count: chains.length, verdictCounts, topGaps, causeVocab: causeVocab(), framework });
  } catch (e) {
    res.json({ chains: [], count: 0, error: e.message });
  }
}));

// ---------------------------------------------------------------------------
// Dynamic tier classifier — buckets chains into thriving / mid / dying / dead
// from LIVE data, so the leaderboards reflect current conditions.
//   dead  = >=90% drawdown from all-time peak TVL (terminal)
//   dying = down >=60% over the last 90 days (steep recent decline, not yet dead)
//   thriving = currently on the live board (top-50 by composite activity)
//   mid   = everything else meaningful (>= $1M TVL)
// ---------------------------------------------------------------------------
let tiersCache = { ts: 0, data: null };
let tiersBuilding = false;
const TIERS_TTL = 45 * 60 * 1000;
const toISO = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

async function classifyChains() {
  const all = await fetchJson(CHAINS_URL);
  if (!Array.isArray(all)) throw new Error('chains feed unavailable');
  if (!cache.data) cache = await loadSnapshot();
  const thrivingNames = new Set((cache.data.chains || []).map((c) => c.name));

  const universe = all.filter((c) => c && c.name && (Number(c.tvl) || 0) >= 1e6)
    .sort((a, b) => (Number(b.tvl) || 0) - (Number(a.tvl) || 0)).slice(0, 100);

  const metrics = await pool(universe, async (c) => {
    let hist = null;
    try { hist = await fetchJson(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(c.name)}`, 12000); } catch (e) {}
    const series = Array.isArray(hist) ? hist.filter((p) => p && p.date).map((p) => ({ d: Number(p.date), v: Number(p.tvl) || 0 })) : [];
    const cur = Number(c.tvl) || 0;
    let peak = cur, peakDate = null, launched = null, ago90 = null, spanDays = 0;
    if (series.length) {
      launched = series[0].d;
      spanDays = (series[series.length - 1].d - series[0].d) / 86400;
      for (const p of series) if (p.v > peak) { peak = p.v; peakDate = p.d; }
      const last = series[series.length - 1].d, target = last - 90 * 86400;
      let closest = series[0];
      for (const p of series) { if (p.d <= target) closest = p; else break; }
      ago90 = closest.v;
    }
    const drawdown = peak > 0 ? ((peak - cur) / peak) * 100 : 0;
    // 90d change only when there's ≥90d of history AND a non-trivial baseline (guards new-chain blowups)
    let change90 = null;
    if (spanDays >= CHANGE_90D_MIN_SPAN_DAYS && baselineOk(ago90, peak)) change90 = ((cur - ago90) / ago90) * 100;
    return {
      chain: c.name, symbol: c.tokenSymbol || null, tvl: cur, spanDays: Math.round(spanDays),
      peak_tvl: peak, peak_date: peakDate ? toISO(peakDate) : null, current_tvl: cur,
      drawdown_pct: +drawdown.toFixed(1), change_90d: change90 != null ? +change90.toFixed(1) : null,
      launched: launched ? toISO(launched).slice(0, 7) : null,
    };
  }, 6);

  const b = Object.fromEntries(TIERS.map((t) => [t, []]));
  const onBoard = (name) => thrivingNames.has(name);
  for (const m of metrics) b[classifyTier(m, onBoard, norm)].push(m);
  b.mid.sort((x, y) => y.tvl - x.tvl);
  b.dying.sort((x, y) => (x.change_90d ?? 0) - (y.change_90d ?? 0));
  b.dead.sort((x, y) => y.peak_tvl - x.peak_tvl);
  return b;
}

// Complete { chainName: tier } map across all buckets — for the live board to
// badge each row with our own classification (progressive-enhancement fetch).
function tierMapFrom(b) {
  const map = {};
  for (const tier of TIERS) for (const m of (b[tier] || [])) map[m.chain] = tier;
  return map;
}

// Our curated editorial verdicts (the Dead & Dying / Stuck-Mid case studies) take
// precedence over the live activity classifier, so the board badge matches the
// forensic sections (e.g. Cardano reads "mid" on the board, not "thriving").
async function curatedTierMap() {
  const map = {};
  try { (await dbQuery(`SELECT chain FROM dead_chains`)).forEach((r) => { map[r.chain] = 'dead'; }); } catch (e) {}
  try { (await dbQuery(`SELECT chain FROM mid_chains`)).forEach((r) => { if (!map[r.chain]) map[r.chain] = 'mid'; }); } catch (e) {}
  return map;
}

async function getTiers() {
  const now = Date.now();
  if (!tiersCache.data) tiersCache = { ts: now, data: await classifyChains() };
  else if (now - tiersCache.ts > TIERS_TTL && !tiersBuilding) {
    tiersBuilding = true;
    classifyChains().then((d) => { tiersCache = { ts: Date.now(), data: d }; })
      .catch((e) => console.error('tiers refresh:', e.message)).finally(() => { tiersBuilding = false; });
  }
  return tiersCache.data;
}

// updated_at is a COLUMN (not a key inside the profile JSON) — carry it through so
// the dying-watch detail can render the same "Data verified …" stamp as a grave card.
function parseProfileRow(r) {
  let p = null;
  // a malformed profile degrades to null (card renders without the expansion)
  try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) { console.error('[profile] bad JSON for', r.chain, e.message); }
  return { verdict: r.verdict, why: r.why, outlook: r.outlook, sources: r.sources, updated_at: r.updated_at, profile: p };
}
async function profileMap() {
  const out = {};
  try {
    (await dbQuery(`SELECT chain, verdict, why, outlook, profile, sources, updated_at FROM dead_chains`)).forEach((r) => { out[r.chain] = parseProfileRow(r); });
  } catch (e) { console.error('[profileMap] dead_chains:', e.message); }
  try {
    (await dbQuery(`SELECT chain, verdict, why_stuck AS why, outlook, profile, sources, updated_at FROM mid_chains`)).forEach((r) => { if (!out[r.chain]) out[r.chain] = parseProfileRow(r); });
  } catch (e) { console.error('[profileMap] mid_chains:', e.message); }
  return out;
}


app.get('/api/tiers', wrap(async (req, res) => {
  try {
    const b = await getTiers();
    const pm = await profileMap();
    const attach = (arr, limit) => arr.slice(0, limit).map((m) => ({ ...m, research: pm[m.chain] || null }));
    // "Dying watch" — steepest 90-day decliners among still-alive chains (auto-updating)
    const declining = [...b.mid, ...b.dying]
      .filter((m) => m.change_90d != null && m.change_90d <= -15)
      .sort((x, y) => x.change_90d - y.change_90d)
      .slice(0, 20)
      .map((m) => ({ ...m, research: pm[m.chain] || null }));
    let narrative = null, successFactors = null;
    try { const m = await dbQuery(`SELECT v FROM graveyard_meta WHERE k='trends' LIMIT 1`); if (m[0]) narrative = m[0].v; } catch (e) {}
    try { const s = await dbQuery(`SELECT v FROM graveyard_meta WHERE k='success_factors' LIMIT 1`); if (s[0]) successFactors = s[0].v; } catch (e) {}
    // curated = chains whose tier is a researched verdict (dead_chains/mid_chains),
    // exposed so the UI can label those badges as research, not classifier output.
    const curated = await curatedTierMap();
    res.json({
      updatedAt: new Date(tiersCache.ts).toISOString(),
      criteria: TIER_CRITERIA,
      computedNote: TIER_CRITERIA.computedNote,
      counts: Object.fromEntries(TIERS.map((t) => [t, (b[t] || []).length])),
      tierMap: { ...tierMapFrom(b), ...curated },
      curated: Object.keys(curated),
      mid: attach(b.mid, 25), dying: attach(b.dying, 25), dead: attach(b.dead, 25), declining,
      narrative, successFactors,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// NFT & Ordinals lifecycle library
// ---------------------------------------------------------------------------
// Live NFT/Ordinals catalog — the full CoinGecko collection universe (~2000
// across ~17 chains), searchable + filterable + paginated from D1.
// ---------------------------------------------------------------------------
app.get('/api/nft-catalog', wrap(async (req, res) => {
  try {
    if (!ENV.DB) return res.json({ collections: [], total: 0, chains: [], page: 1, perPage: 30 });
    const q = String(req.query.q || '').trim().toLowerCase();
    const chain = String(req.query.chain || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(60, Math.max(10, parseInt(req.query.per) || 30));
    const where = [], binds = [];
    if (q) { where.push('lower(name) LIKE ?'); binds.push('%' + q + '%'); }
    if (chain) { where.push('chain = ?'); binds.push(chain); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const totalRow = await ENV.DB.prepare(`SELECT COUNT(*) n FROM nft_catalog ${whereSql}`).bind(...binds).first();
    const total = (totalRow && totalRow.n) || 0;
    const rows = (await ENV.DB.prepare(
      `SELECT id, name, chain, contract_address, symbol FROM nft_catalog ${whereSql} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`
    ).bind(...binds, perPage, (page - 1) * perPage).all()).results || [];
    // chain facets (with counts) for the filter dropdown — unfiltered by chain
    const facets = (await ENV.DB.prepare(
      `SELECT chain, COUNT(*) n FROM nft_catalog GROUP BY chain ORDER BY n DESC`
    ).all()).results || [];
    res.json({ collections: rows, total, page, perPage, pages: Math.ceil(total / perPage), chains: facets });
  } catch (e) {
    res.json({ collections: [], total: 0, chains: [], error: e.message });
  }
}));

// On-demand enriched detail for one catalog collection (floor / mcap / 24h vol /
// holders / thumbnail), cached in D1 to stay within the CoinGecko Demo rate limit.
const NFT_DETAIL_TTL = 30 * 60 * 1000;
app.get('/api/nft-collection/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    if (ENV.DB) {
      const cached = await ENV.DB.prepare(`SELECT data, updated_at FROM nft_detail WHERE id = ?`).bind(id).first();
      if (cached && cached.data && Date.now() - cached.updated_at < NFT_DETAIL_TTL) {
        return res.json({ ...JSON.parse(cached.data), cached: true });
      }
    }
    const d = await fetchJson(cgUrl(`https://api.coingecko.com/api/v3/nfts/${encodeURIComponent(id)}`), 12000);
    const detail = {
      id: d.id, name: d.name, chain: d.asset_platform_id || null,
      floorUsd: d.floor_price && d.floor_price.usd != null ? d.floor_price.usd : null,
      floorNative: d.floor_price && d.floor_price.native_currency != null ? d.floor_price.native_currency : null,
      nativeSymbol: d.native_currency_symbol || null,
      mcapUsd: d.market_cap && d.market_cap.usd != null ? d.market_cap.usd : null,
      vol24hUsd: d.volume_24h && d.volume_24h.usd != null ? d.volume_24h.usd : null,
      floorChange24h: d.floor_price_24h_percentage_change && d.floor_price_24h_percentage_change.usd != null ? +d.floor_price_24h_percentage_change.usd.toFixed(1) : null,
      holders: d.number_of_unique_addresses != null ? d.number_of_unique_addresses : null,
      supply: d.total_supply != null ? d.total_supply : null,
      thumb: (d.image && (d.image.small_2x || d.image.small)) || null,
      desc: d.description ? String(d.description).slice(0, 600) : null,
      homepage: (() => { const h = d.links && d.links.homepage; return Array.isArray(h) ? (h[0] || null) : (h || null); })(),
      twitter: d.twitter_account_id ? `https://twitter.com/${d.twitter_account_id}` : null,
      coingecko: `https://www.coingecko.com/en/nft/${d.id}`,
    };
    if (ENV.DB) { try { await ENV.DB.prepare(
      `INSERT INTO nft_detail (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`
    ).bind(id, JSON.stringify(detail), Date.now()).run(); } catch (e) {} }
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: 'detail unavailable: ' + e.message });
  }
}));

app.get('/api/nft', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, chain, category, status, profile, sources, updated_at FROM nft_collections ORDER BY name`);
    const collections = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='nft_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    // aggregate lifecycle stats from profiles
    const nums = (f) => collections.map((c) => c.profile && c.profile[f]).filter((x) => typeof x === 'number' && isFinite(x));
    const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
    const statusCounts = {};
    collections.forEach((c) => { const s = (c.status || 'unknown').toLowerCase(); statusCounts[s] = (statusCounts[s] || 0) + 1; });
    const riskMap = {};
    try { (await dbQuery(`SELECT entity_name, level, summary, evidence, sources FROM risk_flags WHERE entity_type='nft'`)).forEach((r) => { riskMap[r.entity_name] = r; }); } catch (e) {}
    collections.forEach((c) => { c.risk = riskMap[c.name] || null; });
    // broad live-market aggregate from nft_market (hundreds of collections, real CoinGecko data)
    let market = null;
    try {
      const mk = await dbQuery(`SELECT floor_usd, mcap_usd, vol24h_usd FROM nft_market WHERE mcap_usd > 0`);
      if (mk.length > 20) {
        const median = (arr) => { const s = arr.filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
        market = {
          count: mk.length,
          medianFloorUsd: median(mk.map((r) => r.floor_usd || 0)),
          medianMcapUsd: median(mk.map((r) => r.mcap_usd || 0)),
          total24hUsd: mk.reduce((a, r) => a + (r.vol24h_usd || 0), 0),
        };
      }
    } catch (e) {}

    res.json({
      collections, count: collections.length, analysis, statusCounts, market,
      agg: {
        avgLifespanDays: avg(nums('lifespan_days')),
        avgHolderRetentionPct: avg(nums('holder_retention_pct')),
        avgMintRaiseUsd: avg(nums('mint_raise_usd')),
        avgSecondaryUsd: avg(nums('secondary_volume_usd')),
      },
    });
  } catch (e) {
    res.json({ collections: [], count: 0, error: e.message });
  }
}));

// Decentralized storage / document-verification infrastructure
app.get('/api/infra', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, category, status, profile, sources, updated_at FROM infra_chains ORDER BY name`);
    const chains = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='infra_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    const catCounts = {};
    chains.forEach((c) => { const k = (c.category || 'other').toLowerCase(); catCounts[k] = (catCounts[k] || 0) + 1; });
    res.json({ chains, count: chains.length, analysis, catCounts });
  } catch (e) {
    res.json({ chains: [], count: 0, error: e.message });
  }
}));

// TradFi bridge: treasury companies, miners, crypto ETFs
app.get('/api/markets', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, ticker, type, status, profile, sources, updated_at FROM market_entities ORDER BY type, name`);
    const entities = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='markets_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    const byType = { treasury: [], miner: [], etf: [] };
    entities.forEach((e) => { const t = (e.type || '').toLowerCase(); if (byType[t]) byType[t].push(e); });
    res.json({ entities, count: entities.length, byType, analysis });
  } catch (e) {
    res.json({ entities: [], count: 0, error: e.message });
  }
}));

// Stablecoin rankings — live circulating from DefiLlama + enrichment (issuer/type/backing/audits)
let stablesRankCache = { ts: 0, data: null };
const PEG_MECH = { fiatbacked: 'Fiat-backed', 'fiat-backed': 'Fiat-backed', crypto: 'Crypto-backed', 'crypto-backed': 'Crypto-backed', algorithmic: 'Algorithmic' };
app.get('/api/stablecoins', wrap(async (req, res) => {
  try {
    const now = Date.now();
    if (!stablesRankCache.data || now - stablesRankCache.ts > 10 * 60 * 1000) {
      const j = await fetchJson('https://stablecoins.llama.fi/stablecoins?includePrices=true', 20000);
      const assets = (j && j.peggedAssets) || [];
      const list = assets.map((a) => ({
        name: a.name, symbol: a.symbol, gecko: a.gecko_id || null,
        pegType: a.pegType || null, pegMechanism: PEG_MECH[(a.pegMechanism || '').toLowerCase()] || a.pegMechanism || null,
        circulating: (a.circulating && (a.circulating.peggedUSD || Object.values(a.circulating)[0])) || 0,
        price: a.price || null, chains: (a.chains || []).slice(0, 6),
        change7d: a.circulatingPrevWeek ? null : null,
      })).filter((s) => s.circulating > 1e6).sort((x, y) => y.circulating - x.circulating).slice(0, 50);
      stablesRankCache = { ts: now, data: list };
    }
    let metaMap = {};
    try { (await dbQuery(`SELECT slug, symbol, profile, sources FROM stablecoin_meta`)).forEach((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} metaMap[(r.symbol || '').toUpperCase()] = { profile: p, sources: r.sources }; }); } catch (e) {}
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='stablecoin_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    const stablecoins = stablesRankCache.data.map((s, i) => ({ rank: i + 1, ...s, meta: metaMap[(s.symbol || '').toUpperCase()] || null }));
    const totalMcap = stablecoins.reduce((a, s) => a + (s.circulating || 0), 0);
    res.json({ stablecoins, count: stablecoins.length, totalMcap, analysis });
  } catch (e) {
    res.json({ stablecoins: [], count: 0, error: e.message });
  }
}));

// Geographic adoption / regulation library
app.get('/api/geo', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, region, kind, profile, sources, updated_at FROM geo_regions ORDER BY region, name`);
    const regions = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='geo_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    // Reconcile with Power Rankings: surface each country's rank + composite
    // score so Global Adoption and Power Rankings agree and cross-reference.
    try {
      const pm = await dbQuery(`SELECT v FROM graveyard_meta WHERE k='power_rankings' LIMIT 1`);
      if (pm[0]) {
        let obj = {}; try { obj = JSON.parse(pm[0].v); } catch (e) {}
        const rankByName = {};
        (obj.countries || []).forEach((c) => { rankByName[c.name] = { rank: c.rank, total: c.total }; });
        regions.forEach((r) => { if (rankByName[r.name]) { r.powerRank = rankByName[r.name].rank; r.powerScore = rankByName[r.name].total; } });
      }
    } catch (e) { /* best-effort */ }
    res.json({ regions, count: regions.length, analysis });
  } catch (e) {
    res.json({ regions: [], count: 0, error: e.message });
  }
}));

// RWA & DePIN library
app.get('/api/rwa', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, category, status, profile, sources, updated_at FROM rwa_depin ORDER BY category, name`);
    const items = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='rwa_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    const byCat = {};
    items.forEach((i) => { const k = (i.category || 'other'); (byCat[k] = byCat[k] || []).push(i); });
    // live breadth: RWA protocols by TVL + DePIN tokens by market cap
    let rwaLive = [], depinLive = [], rwaTvlTotal = 0;
    try {
      rwaLive = (await dbQuery(`SELECT slug, name, tvl, chains, url, logo, change_1d, change_7d FROM rwa_live ORDER BY tvl DESC`))
        .map((r) => { let c = []; try { c = JSON.parse(r.chains || '[]'); } catch (e) {} return { ...r, chains: c }; });
      rwaTvlTotal = rwaLive.reduce((a, r) => a + (r.tvl || 0), 0);
    } catch (e) {}
    try { depinLive = await dbQuery(`SELECT id, name, symbol, mcap, price, change_24h, volume_24h, image FROM depin_live ORDER BY mcap DESC`); } catch (e) {}
    const depinMcapTotal = depinLive.reduce((a, r) => a + (r.mcap || 0), 0);
    res.json({ items, count: items.length, byCat, analysis, rwaLive, depinLive, rwaTvlTotal, depinMcapTotal });
  } catch (e) {
    res.json({ items: [], count: 0, error: e.message });
  }
}));

// US crypto-policy map — per-state stance + federal legislation
app.get('/api/uspolicy', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT abbr, name, stance, profile, sources, updated_at FROM us_states`);
    const states = {};
    rows.forEach((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} states[r.abbr] = { ...r, profile: p }; });
    let federal = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='us_federal' LIMIT 1`); if (m[0]) { try { federal = JSON.parse(m[0].v); } catch (e) { federal = { text: m[0].v }; } federal.updated_at = m[0].updated_at; } } catch (e) {}
    res.json({ states, count: rows.length, federal });
  } catch (e) {
    res.json({ states: {}, count: 0, error: e.message });
  }
}));

// News aggregator — merges crypto RSS feeds, cached 10m
const NEWS_FEEDS = [
  { src: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { src: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { src: 'Decrypt', url: 'https://decrypt.co/feed' },
  { src: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { src: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' },
  { src: 'DL News', url: 'https://www.dlnews.com/arc/outboundfeeds/rss/' },
];
let newsCache = { ts: 0, data: null };
function decodeXml(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim(); }
function parseRss(xml, src) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks.slice(0, 20)) {
    const t = b.match(/<title>([\s\S]*?)<\/title>/i);
    const l = b.match(/<link>([\s\S]*?)<\/link>/i) || b.match(/<link[^>]*href="([^"]+)"/i);
    const d = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || b.match(/<dc:date>([\s\S]*?)<\/dc:date>/i);
    const title = t ? decodeXml(t[1]) : null;
    let link = l ? decodeXml(l[1]) : null;
    if (title && link) items.push({ title, link, src, ts: d ? Date.parse(decodeXml(d[1])) || 0 : 0 });
  }
  return items;
}
app.get('/api/news', wrap(async (req, res) => {
  try {
    const now = Date.now();
    if (!newsCache.data || now - newsCache.ts > 10 * 60 * 1000) {
      const results = await Promise.allSettled(NEWS_FEEDS.map(async (f) => {
        const r = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 chain-monitor' }, signal: AbortSignal.timeout(12000) });
        // previously any non-2xx (block/rate-limit) still fell through to
        // parseRss() on error-page HTML and silently produced 0 items —
        // no signal that the source ever failed. Fail loud instead.
        if (!r.ok) throw new Error(`${f.src} ${r.status}`);
        const items = parseRss(await r.text(), f.src);
        if (!items.length) throw new Error(`${f.src} parsed 0 items`);
        return items;
      }));
      let all = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') all = all.concat(r.value);
        else console.error(`[news] ${NEWS_FEEDS[i].src} failed:`, r.reason && r.reason.message || r.reason);
      });
      all.sort((a, b) => b.ts - a.ts);
      newsCache = { ts: now, data: all.slice(0, 60) };
    }
    res.json({ items: newsCache.data, count: newsCache.data.length, updatedAt: new Date(newsCache.ts).toISOString() });
  } catch (e) {
    res.json({ items: [], count: 0, error: e.message });
  }
}));

// Scammer fund-flow tracker
app.get('/api/traces', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT slug, name, category, amount_usd, profile, sources, updated_at FROM scam_traces ORDER BY amount_usd DESC`);
    const cases = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });
    let analysis = null;
    try { const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='traces_analysis' LIMIT 1`); if (m[0]) analysis = { text: m[0].v, updated_at: m[0].updated_at }; } catch (e) {}
    let sanctionsStats = null;
    try {
      const s = await dbQuery(`SELECT COUNT(*) n, COUNT(DISTINCT chain) chains FROM sanctioned_addresses`);
      if (s[0]) sanctionsStats = { addresses: s[0].n, chains: s[0].chains };
    } catch (e) {}
    res.json({ cases, count: cases.length, analysis, sanctionsStats });
  } catch (e) {
    res.json({ cases: [], count: 0, error: e.message });
  }
}));

// Country crypto power rankings
app.get('/api/power', wrap(async (req, res) => {
  try {
    const m = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k='power_rankings' LIMIT 1`);
    if (!m[0]) return res.json({ countries: [], count: 0 });
    let obj = {}; try { obj = JSON.parse(m[0].v); } catch (e) {}
    let countries = obj.countries || [];
    // Reconcile with Global Adoption (geo): the two datasets cover the same
    // countries — merge each country's geo regulatory/adoption profile in so
    // Power Rankings is the unified per-country view (score + regulation),
    // not a second disconnected country list.
    try {
      const geoRows = await dbQuery(`SELECT name, region, profile FROM geo_regions WHERE kind='country'`);
      const geoByName = {};
      for (const g of geoRows) { let p = null; try { p = g.profile ? JSON.parse(g.profile) : null; } catch (e) {} geoByName[g.name] = { region: g.region, profile: p }; }
      countries = countries.map((c) => {
        const g = geoByName[c.name];
        if (!g || !g.profile) return c;
        const p = g.profile;
        return { ...c, region: g.region, geo: {
          adoption: p.adoption, regulation: p.regulation, upcoming_regulation: p.upcoming_regulation,
          gov_holdings: p.gov_holdings, sentiment: p.sentiment, notable: p.notable, use_cases: p.use_cases,
        } };
      });
    } catch (e) { /* geo merge best-effort */ }
    res.json({ countries, count: countries.length, updatedAt: m[0].updated_at });
  } catch (e) {
    res.json({ countries: [], count: 0, error: e.message });
  }
}));

// ---------------------------------------------------------------------------
// x402 monetization — agent-payable API. Gated endpoints return HTTP 402 with
// payment requirements; a valid X-PAYMENT header unlocks the data.
//   Go-live needs: X402_PAY_TO (receiving wallet) + a facilitator for on-chain
//   verification. Until then it runs in demo mode (X-PAYMENT ignored, free quota).
//   Current gate: verify -> settle -> serve. The verify -> serve -> settle +
//   nonce replay-store target for go-live is in docs/x402-billing-design.md.
// ---------------------------------------------------------------------------
// Facilitator decision: Coinbase CDP facilitator on Base mainnet, USDC.
// Gasless (EIP-3009), built-in KYT/OFAC screening, free 1k tx/mo. Go-live needs:
//   X402_PAY_TO = your Base receiving wallet
//   CDP_API_KEY_ID + CDP_API_KEY_SECRET (from portal.cdp.coinbase.com) for the facilitator SDK
// Payment config, resolved from env at call time. No hardcoded payTo fallback:
// with X402_PAY_TO unset, payTo is null → isLiveMode() is false → we run in demo
// mode and never bill. X402_FACILITATOR must be an http(s) URL to go live (the
// default 'coinbase-cdp' sentinel keeps us in demo until a facilitator is wired).
function x402Config() {
  return {
    payTo: ENV.X402_PAY_TO || null,
    network: ENV.X402_NETWORK || 'base',
    asset: ENV.X402_ASSET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    facilitator: ENV.X402_FACILITATOR || 'coinbase-cdp',
  };
}
const AGENT_ENDPOINTS = {
  '/api/agent/summary': { price: 5000, desc: 'Market posture + top signals across all chains' },      // 0.005 USDC
  '/api/agent/chain': { price: 10000, desc: 'Full sourced profile + metrics + signals for one chain' }, // 0.01
  '/api/agent/signals': { price: 20000, desc: 'Live signal feed (momentum, flows, anomalies)' },       // 0.02
  '/api/agent/risk': { price: 50000, desc: 'Scam / bad-actor risk assessment with cited evidence' },   // 0.05 (compliance)
};
// 402 body advertising what a caller must pay. `error` is 'payment_required' when
// no/again-needed payment (discovery), 'payment_invalid' when a payment was
// supplied but failed structural or facilitator verification.
function require402(res, resource, priceAtomic, desc, opts = {}) {
  const cfg = x402Config();
  res.status(402).json({
    x402Version: 1,
    error: opts.error || 'payment_required',
    ...(opts.reason ? { reason: opts.reason } : {}),
    accepts: [paymentRequirements(resource, priceAtomic, desc, cfg)],
  });
}
// POST to the facilitator (verify/settle). Throws on a non-2xx so the gate can
// fail closed. Isolated here so it's the single network seam the gate depends on.
async function facilitatorPost(base, path, body) {
  let root = base;
  while (root.endsWith('/')) root = root.slice(0, -1); // trim trailing slashes (no regex backtracking)
  const url = root + path;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('facilitator ' + path + ' -> ' + r.status);
  return await r.json();
}
// Free preview quota: each client gets FREE_LIMIT calls/month, then x402 payment required.
const FREE_LIMIT = 1;
// ip -> { count, monthKey }. In-process, per-isolate, IP-keyed — a soft limit,
// not a durable hard quota. `lastPruneKey` tracks the month we last pruned for,
// so a rollover drops last month's stale IP entries exactly once instead of
// leaking them for the isolate's whole lifetime.
const freeQuota = {};
let lastPruneKey = null;
function monthKey() { return monthKeyFromDate(new Date()); }
// Gate an agent endpoint. Returns true to let the handler run, false after it
// has written a 402. Async because live mode calls the facilitator.
//   demo mode (no wallet/facilitator): X-PAYMENT is IGNORED — never a bypass —
//     and access is granted only within the free monthly quota.
//   live mode: require a structurally-valid X-PAYMENT for the exact payTo/amount,
//     then verify + settle it via the facilitator before serving.
// Live-mode path: require a structurally-valid X-PAYMENT for the exact
// payTo/amount, then verify + settle via the facilitator before serving.
// Returns true to allow the handler; false after writing a 402. Split out of
// x402Gate to keep each function's complexity low.
async function verifyLivePayment(req, res, baseResource, priceAtomic, desc, cfg) {
  const deny = (reason) => { require402(res, baseResource, priceAtomic, desc, { error: 'payment_invalid', reason }); return false; };
  const header = req.headers['x-payment'];
  if (!header) { require402(res, baseResource, priceAtomic, desc); return false; }
  const requirements = paymentRequirements(baseResource, priceAtomic, desc, cfg);
  const payment = decodePaymentHeader(header);
  const chk = structuralCheck(payment, requirements);
  if (!chk.ok) return deny(chk.reason);
  const body = { x402Version: 1, paymentPayload: payment, paymentRequirements: requirements };
  let verify;
  try { verify = await facilitatorPost(cfg.facilitator, '/verify', body); }
  catch { return deny('verify_unavailable'); }
  if (verify?.isValid !== true) return deny(verify?.invalidReason || 'verify_rejected');
  let settle;
  try { settle = await facilitatorPost(cfg.facilitator, '/settle', body); }
  catch { return deny('settle_unavailable'); }
  if (settle?.success !== true) return deny('settle_failed');
  if (settle.transaction) res.setHeader('X-PAYMENT-RESPONSE', String(settle.transaction));
  return true;
}
async function x402Gate(req, res, baseResource, priceAtomic, desc) {
  const cfg = x402Config();
  if (isLiveMode(cfg)) return verifyLivePayment(req, res, baseResource, priceAtomic, desc, cfg);
  // Demo mode: never trust X-PAYMENT. Key the free quota on Cloudflare's trusted
  // client IP. X-Forwarded-For is client-supplied (leftmost value spoofable), so
  // it must NOT be trusted — an attacker could rotate it for unlimited free calls.
  const ip = req.headers['cf-connecting-ip'] || req.ip || 'anon';
  const mk = monthKey();
  // On month rollover, drop last month's entries (see pruneStaleQuota) so the
  // in-process map can't grow unbounded over the isolate's lifetime.
  if (mk !== lastPruneKey) { pruneStaleQuota(freeQuota, mk); lastPruneKey = mk; }
  let q = freeQuota[ip];
  if (!q || q.monthKey !== mk) { q = freeQuota[ip] = { count: 0, monthKey: mk }; }
  q.count++;
  if (q.count <= FREE_LIMIT) { res.setHeader('X-Free-Calls-Remaining', String(FREE_LIMIT - q.count)); return true; }
  require402(res, baseResource, priceAtomic, desc);
  return false;
}

// Free discovery manifest — how agents learn what's payable and for how much
app.get('/api/agent/manifest', wrap((req, res) => {
  const cfg = x402Config();
  const live = isLiveMode(cfg);
  res.json({
    name: 'Chaindump', description: 'Onchain intelligence — chains, assets, markets, policy & forensics.',
    x402Version: 1, freeCallsPerMonth: FREE_LIMIT,
    payment: { network: cfg.network, asset: cfg.asset, payTo: live ? cfg.payTo : null, currency: 'USDC', mode: live ? 'live' : 'demo' },
    entrypoints: Object.entries(AGENT_ENDPOINTS).map(([path, v]) => ({ path, priceUsd: v.price / USDC_DP, description: v.desc })),
  });
}));

app.get('/api/agent/summary', wrap(async (req, res) => {
  if (!(await x402Gate(req, res, '/api/agent/summary', AGENT_ENDPOINTS['/api/agent/summary'].price, AGENT_ENDPOINTS['/api/agent/summary'].desc))) return;
  if (!cache.data) cache = await loadSnapshot();
  const c = cache.data.chains || [];
  const all = c.flatMap((x) => x.signals || []);
  const rk = { critical: 3, notable: 2, info: 1 };
  all.sort((a, b) => (rk[b.severity] - rk[a.severity]) || (b.confidence - a.confidence));
  const t = cache.data.totals || {};
  res.json({
    schema_version: '2.0.0', data_as_of: cache.data.updatedAt,
    market: { total_tvl_usd: t.tvl, total_volume_24h_usd: t.volume24h, total_fees_24h_usd: t.fees24h, chains_tracked: c.length },
    leaders: c.slice(0, 5).map((x) => ({
      chain: x.name, rank: x.rank, tvl_usd: x.tvl, activity_score: x.score,
      // Present only when the TVL figure can't be independently verified, so an
      // agent consuming this list doesn't treat it as equivalent to its peers.
      ...(x.dataQuality ? { data_quality: x.dataQuality.flag, data_quality_note: x.dataQuality.summary } : {}),
    })),
    top_signals: all.slice(0, 12),
    signal_counts: { critical: all.filter((s) => s.severity === 'critical').length, notable: all.filter((s) => s.severity === 'notable').length, total: all.length },
    provenance: { sources: ['defillama', 'coingecko', 'growthepie'], note: 'Every signal carries its own evidence + method + confidence (0–1). Full feed at /api/agent/signals.' },
  });
}));
app.get('/api/agent/chain/:key', wrap(async (req, res) => {
  if (!(await x402Gate(req, res, '/api/agent/chain', AGENT_ENDPOINTS['/api/agent/chain'].price, AGENT_ENDPOINTS['/api/agent/chain'].desc))) return;
  if (!cache.data) cache = await loadSnapshot();
  const row = (cache.data.chains || []).find((c) => c.name.toLowerCase() === String(req.params.key).toLowerCase());
  if (!row) return res.status(404).json({ error: 'unknown_chain' });
  let analysis = null;
  try { const r = await dbQuery(`SELECT take, sentiment, sources, profile FROM chain_analysis WHERE chain=? LIMIT 1`, [row.name]); if (r[0]) analysis = r[0]; } catch (e) {}
  res.json({ schema_version: '1.0.0', data_as_of: cache.data.updatedAt, chain: row, analysis, provenance: { sources: ['defillama', 'growthepie', 'coingecko'] } });
}));
app.get('/api/agent/signals', wrap(async (req, res) => {
  if (!(await x402Gate(req, res, '/api/agent/signals', AGENT_ENDPOINTS['/api/agent/signals'].price, AGENT_ENDPOINTS['/api/agent/signals'].desc))) return;
  if (!cache.data) cache = await loadSnapshot();
  const all = (cache.data.chains || []).flatMap((c) => c.signals || []);
  const rk = { critical: 3, notable: 2, info: 1 };
  const dir = String(req.query.direction || '').toLowerCase();
  const minConf = Number(req.query.min_confidence) || 0;
  let out = all.filter((s) => (!dir || s.direction === dir) && s.confidence >= minConf);
  out.sort((a, b) => (rk[b.severity] - rk[a.severity]) || (b.confidence - a.confidence));
  res.json({
    schema_version: '2.0.0', data_as_of: cache.data.updatedAt,
    universe: 'top 50 chains by composite activity',
    signal_types: ['capital_flow_7d', 'inorganic_volume', 'volume_accel', 'mercenary_tvl', 'real_yield', 'valuation', 'tvl_fee_divergence', 'price_usage_divergence'],
    count: out.length, signals: out,
    provenance: { sources: ['defillama', 'coingecko', 'growthepie'], methodology: 'Each signal includes evidence + method + confidence(0–1) + severity(critical|notable|info). Filter with ?direction=bullish|bearish|warning and ?min_confidence=0.6.' },
  });
}));
app.get('/api/agent/risk/:entity', wrap(async (req, res) => {
  if (!(await x402Gate(req, res, '/api/agent/risk', AGENT_ENDPOINTS['/api/agent/risk'].price, AGENT_ENDPOINTS['/api/agent/risk'].desc))) return;
  const name = String(req.params.entity);
  let rows = [];
  try { rows = await dbQuery(`SELECT entity_type, entity_name, level, summary, evidence, sources FROM risk_flags WHERE lower(entity_name)=lower(?)`, [name]); } catch (e) {}
  res.json({ schema_version: '1.0.0', entity: name, flagged: rows.length > 0, risk: rows[0] || { level: 'clean', summary: 'No credible scam/bad-actor concerns found in our dataset.' }, all_matches: rows });
}));

// Trace lookup — paste an address / tx / entity / case name; find where it appears across traced cases
app.get('/api/trace-lookup', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 3) return res.json({ query: q, matches: [], risk: [] });
  try {
    const rows = await dbQuery(`SELECT slug, name, category, amount_usd, profile FROM scam_traces`);
    const matches = [];
    for (const r of rows) {
      let p = {}; try { p = JSON.parse(r.profile || '{}'); } catch (e) {}
      const hits = [];
      (p.hops || []).forEach((h) => {
        const blob = `${h.from||''} ${h.to||''} ${h.txhash||''} ${h.note||''}`.toLowerCase();
        if (blob.includes(q)) hits.push({ type: 'hop', detail: `${h.from||''} → ${h.to||''} · ${h.amount||''} ${h.asset||''}`, txurl: h.txurl || null });
      });
      (p.entities || []).forEach((e) => {
        const blob = `${e.name||e.label||''} ${e.address||''} ${e.role||''}`.toLowerCase();
        if (blob.includes(q)) hits.push({ type: 'entity', detail: `${e.name||e.label||''}${e.role?` (${e.role})`:''}${e.address?` — ${e.address}`:''}` });
      });
      const nameHit = r.name.toLowerCase().includes(q) || (p.summary || '').toLowerCase().includes(q);
      if (hits.length || nameHit) matches.push({ slug: r.slug, name: r.name, category: r.category, amount_usd: r.amount_usd, nameHit, hits: hits.slice(0, 8) });
    }
    let risk = [];
    try { risk = await dbQuery(`SELECT entity_type, entity_name, level, summary FROM risk_flags WHERE lower(entity_name) LIKE ? LIMIT 8`, ['%' + q + '%']); } catch (e) {}
    // OFAC sanctions screening: does the pasted address appear on the SDN list?
    let sanctioned = null;
    if (q.length >= 8) {
      try {
        const hit = await dbQuery(`SELECT address, chain, source FROM sanctioned_addresses WHERE address_lc = ?`, [q]);
        if (hit.length) sanctioned = { address: hit[0].address, chains: hit.map((h) => h.chain), source: hit[0].source, sanctioned: true };
      } catch (e) {}
    }
    res.json({ query: q, matches, risk, sanctioned });
  } catch (e) {
    res.json({ query: q, matches: [], risk: [], error: e.message });
  }
}));

// Scam connection graph — merged fund-flow web across all cases; flags shared/suspect hubs
app.get('/api/scam-graph', wrap(async (req, res) => {
  try {
    const [traceRows, addrRows, flowRows, wlRows] = await Promise.all([
      dbQuery(`SELECT slug, name, profile FROM scam_traces`),
      dbQuery(`SELECT address, chain, case_slug, role, label, entity, entity_id FROM scam_addresses`).catch(() => []),
      dbQuery(`SELECT case_slug, from_addr, to_addr, from_label, to_label, asset, amount_usd, tx_url, note, sources FROM scam_flows`).catch(() => []),
      dbQuery(`SELECT address_a, chain_a, address_b, chain_b, link_type, entity, case_slug, tx_url, evidence FROM wallet_links`).catch(() => []),
    ]);
    const nameBySlug = {}; traceRows.forEach((r) => { nameBySlug[r.slug] = r.name; });
    // culpable ACTORS vs neutral INFRASTRUCTURE (tools, not blamed)
    const ACTOR = /exploiter|hacker|attacker|drainer|scammer|thief|fraud|lazarus|dprk|north korea|insider|rug|perp|deployer|launderer/i;
    const INFRA = /tornado|mixer|bridge|thorchain|railgun|sinbad|chipmixer|renbridge|tumbler|\bdex\b|swap|exchange|\bcex\b|binance|huobi|okx|deposit/i;
    const key = (a) => String(a || '').trim().toLowerCase();
    const short = (a) => { const s = String(a || ''); return /^0x[a-f0-9]{8,}/i.test(s) ? s.slice(0, 6) + '…' + s.slice(-4) : s.slice(0, 24); };
    const nodes = {}, nodeCases = {}, edges = [], deg = {};
    function ensure(addr, label, chain, role, entity_id, slug) {
      const id = key(addr); if (!id) return null;
      if (!nodes[id]) nodes[id] = { id, address: addr, label: label || short(addr), chain: chain || '', role: role || '', entity_id: entity_id || '' };
      else { if (label && (!nodes[id].label || /^0x/i.test(nodes[id].label))) nodes[id].label = label; if (chain && !nodes[id].chain) nodes[id].chain = chain; if (role && !nodes[id].role) nodes[id].role = role; if (entity_id && !nodes[id].entity_id) nodes[id].entity_id = entity_id; }
      if (slug) (nodeCases[id] = nodeCases[id] || new Set()).add(nameBySlug[slug] || slug);
      return id;
    }
    addrRows.forEach((a) => ensure(a.address, a.label, a.chain, a.role, a.entity_id, a.case_slug));
    // fund-flow edges (transactions)
    flowRows.forEach((f, i) => {
      const s = ensure(f.from_addr, f.from_label, '', '', '', f.case_slug);
      const t = ensure(f.to_addr, f.to_label, '', '', '', f.case_slug);
      if (s && t) { edges.push({ id: 'f' + i, source: s, target: t, kind: 'flow', caseName: nameBySlug[f.case_slug] || f.case_slug, amount: f.amount_usd ? '$' + Math.round(f.amount_usd).toLocaleString() : '', asset: f.asset || '', txurl: f.tx_url || null, note: f.note || '', sources: f.sources || '' }); deg[s] = (deg[s] || 0) + 1; deg[t] = (deg[t] || 0) + 1; }
    });
    // wallet-linkage edges (entity resolution: current <-> past)
    wlRows.forEach((w, i) => {
      const s = ensure(w.address_a, null, w.chain_a, '', w.entity, w.case_slug);
      const t = ensure(w.address_b, null, w.chain_b, '', w.entity, w.case_slug);
      if (s && t) { edges.push({ id: 'l' + i, source: s, target: t, kind: 'link', linkType: w.link_type || 'linked', caseName: w.entity || nameBySlug[w.case_slug] || '', note: w.evidence || '', txurl: w.tx_url || null }); deg[s] = (deg[s] || 0) + 1; deg[t] = (deg[t] || 0) + 1; }
    });
    // entity clusters: same entity_id across >1 address = same actor over time/chains
    const entityCount = {};
    Object.values(nodes).forEach((n) => { if (n.entity_id) entityCount[n.entity_id] = (entityCount[n.entity_id] || 0) + 1; });
    // A connection web must show CONNECTIONS: only emit wallets that
    // participate in at least one real edge (a traced transaction or link).
    // Otherwise bulk-loaded addresses with no edges render as a meaningless
    // scattered cloud. If there are no edges at all, fall back to all nodes.
    const connected = new Set();
    edges.forEach((e) => { connected.add(e.source); connected.add(e.target); });
    const hasEdges = edges.length > 0;
    const casesWithFlow = new Set([...flowRows, ...wlRows].map((r) => r.case_slug).filter(Boolean));
    const out = Object.values(nodes)
      .filter((n) => !hasEdges || connected.has(n.id))
      .map((n) => {
        const cs = [...(nodeCases[n.id] || [])];
        const roleActor = ACTOR.test(n.role) || ACTOR.test(n.label);
        const roleInfra = !roleActor && (INFRA.test(n.role) || INFRA.test(n.label));
        const clustered = n.entity_id && entityCount[n.entity_id] > 1;
        return { id: n.id, label: n.label, address: n.address, chain: n.chain, role: n.role, entity: n.entity_id, cluster: clustered, cases: cs, shared: cs.length > 1 || clustered, actor: roleActor, infra: roleInfra, degree: deg[n.id] || 0 };
      });
    res.json({ nodes: out, edges, caseCount: traceRows.length, addressCount: addrRows.length, flowCount: flowRows.length, linkCount: wlRows.length, casesMapped: casesWithFlow.size, hiddenIsolated: Object.keys(nodes).length - out.length });
  } catch (e) {
    res.json({ nodes: [], edges: [], error: e.message });
  }
}));

app.get('/api/health', wrap((req, res) => res.json({ ok: true })));

// ---------------------------------------------------------------------------
// Deep-links + shareable pages. The SPA is served for entity/view paths with
// per-entity Open Graph tags injected so pasted links unfurl (title/desc) in
// Twitter/Discord/Slack. The client reads the path and opens the right view.
// ---------------------------------------------------------------------------
const OG_DESC_FALLBACK = 'Onchain intelligence — chains, assets, markets, policy & forensics. What is changing, why, and what to do about it.';
// Serialize JSON-LD safely for inlining in a <script> (neutralize "</script>").
function jsonLd(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }
function ogHtml(html, { title, desc, url, ld }) {
  const t = escapeHtml(title || 'Chaindump — Onchain Intelligence');
  const d = escapeHtml(desc || OG_DESC_FALLBACK);
  const u = escapeHtml(url || 'https://chaindump.xyz/');
  // Base structured-data graph: Organization + WebSite, present on every page so
  // AI engines and search can attribute claims to Chaindump. Per-page nodes (a
  // chain Dataset, a scam Report, etc.) are appended via the optional `ld` arg.
  const graph = [
    { '@type': 'Organization', '@id': ORIGIN + '/#org', name: 'Chaindump', url: ORIGIN + '/', description: OG_DESC_FALLBACK, logo: ORIGIN + '/favicon.svg' },
    { '@type': 'WebSite', '@id': ORIGIN + '/#site', name: 'Chaindump', url: ORIGIN + '/', description: OG_DESC_FALLBACK, inLanguage: 'en', publisher: { '@id': ORIGIN + '/#org' } },
  ];
  if (ld) graph.push(...(Array.isArray(ld) ? ld : [ld]));
  const structured = jsonLd({ '@context': 'https://schema.org', '@graph': graph });
  const tags = `<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${u}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:url" content="${u}">
<meta property="og:site_name" content="Chaindump">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<script type="application/ld+json">${structured}</script>`;
  return html.replace(/<title>[\s\S]*?<\/title>/, tags);
}
async function spaShell(env, req) {
  try {
    if (!env || !env.ASSETS) throw new Error('no ASSETS binding');
    const r = await env.ASSETS.fetch(new Request(new URL('/index.html', req.url)));
    return await r.text();
  } catch (e) { console.error('[spaShell] failed:', e && e.message); throw e; }
}
// BreadcrumbList for entity deep-links: Home › {section} › {entity}.
function breadcrumb(section, sectionUrl, entity, entityUrl) {
  const el = [{ '@type': 'ListItem', position: 1, name: 'Chaindump', item: ORIGIN + '/' }];
  if (section) el.push({ '@type': 'ListItem', position: 2, name: section, item: sectionUrl });
  if (entity) el.push({ '@type': 'ListItem', position: el.length + 1, name: entity, item: entityUrl });
  return { '@type': 'BreadcrumbList', itemListElement: el };
}
function sendHtml(res, html) { res.setHeader('Link', DISCOVERY_LINK); res.status(200).html(html); }

// Views that are valid single-segment deep-links → their share copy.
const VIEW_OG = {
  live: ['Live · Top 50 chains — Chaindump', 'The top 50 chains ranked by composite on-chain activity (volume, TVL, fees), with live capital-flow and anomaly signals.'],
  mid: ['Stuck / Mid chains — Chaindump', 'Alive-but-directionless chains: real product, weak token value capture, or a stalled thesis.'],
  grave: ['Chain Graveyard — Chaindump', 'Why chains die: the forensic taxonomy of dead chains — mercenary TVL, points collapse, unlock dumps, rugs, and hacks.'],
  nft: ['NFTs & Ordinals — Chaindump', 'The full NFT & Ordinals collection universe across chains, plus deep-dive lifecycle case studies.'],
  stables: ['Stablecoins — Chaindump', 'Live stablecoin rankings by circulating supply, peg mechanism, issuer and chain footprint.'],
  rwa: ['RWA · DePIN — Chaindump', 'Real-world assets on-chain ($25B+ tokenized) and decentralized physical infrastructure networks.'],
  infra: ['Storage / Verify — Chaindump', 'Decentralized storage and document-verification infrastructure.'],
  markets: ['Treasuries · Miners · ETFs — Chaindump', 'The TradFi bridge: crypto treasury companies, miners and ETFs.'],
  geo: ['Global Adoption — Chaindump', 'How countries adopt, regulate and hold crypto — with each country\'s crypto power ranking.'],
  uspolicy: ['US Policy Map — Chaindump', 'US crypto policy state-by-state, plus federal legislation tracking.'],
  power: ['Crypto Power Rankings — Chaindump', 'Countries ranked by a composite of usage, policy, institutional adoption, innovation and government stance.'],
  news: ['Crypto News — Chaindump', 'Aggregated crypto news across the major outlets.'],
  traces: ['Scam Tracker — Chaindump', 'Traced scam fund-flows plus live OFAC wallet screening against 900+ sanctioned addresses across 14 chains.'],
  api: ['Agent API · x402 — Chaindump', 'A versioned, provenance-tagged JSON API for AI agents, payable per-call via x402.'],
};
// Views whose primary content is a ranking → emit an ItemList so AI engines can
// answer "top X" questions directly. Only `live` has its items in the snapshot
// cache at request time; the rest stay description-only until wired to their data.
Object.keys(VIEW_OG).forEach((v) => {
  app.get('/' + v, wrap(async (req, res) => {
    const [title, desc] = VIEW_OG[v];
    const url = `${ORIGIN}/${v}`;
    let ld;
    if (v === 'live') {
      try {
        if (!cache.data) cache = await loadSnapshot();
        const items = (cache.data.chains || []).slice(0, 20).map((c, i) => ({
          '@type': 'ListItem', position: i + 1, name: c.name, url: `${ORIGIN}/chain/${encodeURIComponent(c.name)}`,
        }));
        if (items.length) ld = { '@type': 'ItemList', '@id': url + '#list', name: 'Top chains by on-chain activity', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: items.length, itemListElement: items };
      } catch (e) { console.error('[live itemlist] skipped:', e && e.message); }
    }
    sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url, ld }));
  }));
});
app.get('/chain/:name', wrap(async (req, res) => {
  const key = String(req.params.name || '');
  if (!cache.data) cache = await loadSnapshot();
  let row = (cache.data.chains || []).find((c) => c.name.toLowerCase() === key.toLowerCase());
  // Board-only lookup made every chain beyond the top-50 unfurl identically to a
  // nonsense string — /chain/Anubis and /chain/NotARealChain shared a title and
  // description, even though we hold a researched profile for one of them.
  if (!row) { try { row = await resolveTailChain(key.toLowerCase()); } catch (e) { /* fall back to the generic card */ } }
  // A caveat that only exists inside the page cannot ride on a social card or into
  // a crawler's structured data. Anubis's own desk row says the headline number
  // "should not be presented to users without a caveat" — and this route was
  // publishing exactly that number, uncaveated, to every unfurl and every
  // crawler. Recompute the rule here rather than trust the row: a tail chain is
  // never annotated by the snapshot.
  let dq = row && row.dataQuality ? row.dataQuality : null;
  if (row && !dq && row.tvl != null) {
    try {
      const d = assessChainDataQuality(row.name, await getProtocols(), { displayedTvl: row.tvl });
      if (d && d.autoPublish !== false) dq = d;
    } catch (e) { /* best-effort: a missing caveat is bad, a 500 on the card is worse */ }
  }
  const caveat = dq ? ' Chaindump cannot independently verify this TVL figure.' : '';
  // Quote only the figures we actually have. fmtShort coerces null to 0, so
  // building this string unconditionally published "$0 24h volume" for every
  // chain we simply have no volume for — the same false zero the board and the
  // tiles were fixed for, leaking out through the social card instead.
  const parts = [];
  if (row && row.tvl != null) parts.push(`$${fmtShort(row.tvl)} TVL`);
  if (row && row.volume24h != null) parts.push(`$${fmtShort(row.volume24h)} 24h volume`);
  const figures = !row ? ''
    : parts.length ? `${parts.join(', ')}.`
    : 'No market data is available for this chain; Chaindump carries researched analysis only.';

  const title = row ? `${row.name} — Chaindump` : 'Chain — Chaindump';
  const desc = row
    ? (row.rank != null
        ? `${row.name}: ${figures} Rank #${row.rank} by activity.${caveat} Live metrics, fundamentals and analyst take on Chaindump.`
        // A tail chain has no board rank — do not imply one it does not have.
        : `${row.name}: ${figures} Outside the top-50 activity board.${caveat} Metrics and research on Chaindump.`)
    : OG_DESC_FALLBACK;
  const url = `${ORIGIN}/chain/${encodeURIComponent(key)}`;
  let ld;
  if (row) {
    const dm = (cache.data && cache.data.updatedAt) ? new Date(cache.data.updatedAt).toISOString() : undefined;
    const measured = [];
    // Omit a figure we don't have; never publish 0 as a stand-in for unknown.
    if (row.tvl != null) {
      measured.push({
        '@type': 'PropertyValue',
        name: dq ? 'Total value locked (USD) — unverified' : 'Total value locked (USD)',
        value: row.tvl,
        ...(dq ? { description: dq.summary } : {}),
      });
    }
    if (row.volume24h != null) measured.push({ '@type': 'PropertyValue', name: '24h DEX volume (USD)', value: row.volume24h });
    // Only claim a rank when the chain actually has one.
    if (row.rank != null) measured.push({ '@type': 'PropertyValue', name: 'Composite activity rank', value: row.rank });
    if (row.tokenPrice != null) measured.push({ '@type': 'PropertyValue', name: 'Token price (USD)', value: row.tokenPrice });
    ld = [
      { '@type': 'Dataset', '@id': url + '#dataset', name: `${row.name} on-chain metrics`, description: desc, url, isPartOf: { '@id': ORIGIN + '/#site' }, creator: { '@id': ORIGIN + '/#org' }, publisher: { '@id': ORIGIN + '/#org' }, dateModified: dm, variableMeasured: measured, citation: ['https://defillama.com/', 'https://www.coingecko.com/'] },
      breadcrumb('Live · Top 50', `${ORIGIN}/live`, row.name, url),
    ];
  }
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url, ld }));
}));
app.get('/scam/:slug', wrap(async (req, res) => {
  const slug = String(req.params.slug || '');
  let row = null;
  try { row = (await dbQuery(`SELECT name, category, amount_usd FROM scam_traces WHERE slug = ?`, [slug]))[0]; } catch (e) {}
  const title = row ? `${row.name} — Chaindump Scam Tracker` : 'Scam Tracker — Chaindump';
  const desc = row ? `${row.name}${row.amount_usd ? ` — ~$${fmtShort(row.amount_usd)} ${row.category || ''}` : ''}. Traced wallets, fund-flow and sources on Chaindump.` : OG_DESC_FALLBACK;
  const url = `${ORIGIN}/scam/${encodeURIComponent(slug)}`;
  // Article node describes the CASE (an event/report). Named-individual allegations
  // stay out of structured data per the human-review policy (CLAUDE.md §1.5).
  const ld = row ? [
    { '@type': 'Article', '@id': url + '#article', headline: `${row.name} — traced fund-flow`, description: desc, url, mainEntityOfPage: url, isPartOf: { '@id': ORIGIN + '/#site' }, author: { '@id': ORIGIN + '/#org' }, publisher: { '@id': ORIGIN + '/#org' } },
    breadcrumb('Scam Tracker', `${ORIGIN}/traces`, row.name, url),
  ] : undefined;
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url, ld }));
}));
app.get('/collection/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  let row = null;
  try { if (ENV.DB) row = await ENV.DB.prepare(`SELECT name, chain FROM nft_catalog WHERE id = ?`).bind(id).first(); } catch (e) {}
  const title = row ? `${row.name} — Chaindump` : 'NFT Collection — Chaindump';
  const desc = row ? `${row.name} (${row.chain}) — live floor, market cap, 24h volume and holders on Chaindump.` : OG_DESC_FALLBACK;
  const url = `${ORIGIN}/collection/${encodeURIComponent(id)}`;
  const ld = row ? [
    { '@type': 'Dataset', '@id': url + '#dataset', name: `${row.name} NFT market metrics`, description: desc, url, isPartOf: { '@id': ORIGIN + '/#site' }, publisher: { '@id': ORIGIN + '/#org' }, citation: ['https://www.coingecko.com/'] },
    breadcrumb('NFTs & Ordinals', `${ORIGIN}/nft`, row.name, url),
  ] : undefined;
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url, ld }));
}));

// ---------------------------------------------------------------------------
// Phase D — agent-readiness / AI-discovery surface (robots, sitemap, Link
// headers, api-catalog). Content policy (Carson 2026-07-13): AI may read for
// search + answers, but NOT train — Content-Signal ai-train=no, search=yes,
// ai-input=yes. See docs/agent-readiness.md.
// ---------------------------------------------------------------------------
const ORIGIN = 'https://chaindump.xyz';
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'Google-Extended', 'PerplexityBot', 'CCBot', 'Applebot-Extended', 'meta-externalagent'];
const ROBOTS_TXT = [
  '# Chaindump — real-time blockchain intelligence',
  '# Content usage (contentsignals.org): index for search and let AI assistants',
  '# cite/answer with our analysis, but do NOT train models on it.',
  '',
  'User-agent: *',
  'Content-Signal: ai-train=no, search=yes, ai-input=yes',
  'Allow: /',
  'Disallow: /api/agent/',
  '',
  ...AI_CRAWLERS.flatMap((ua) => [`User-agent: ${ua}`, 'Content-Signal: ai-train=no, search=yes, ai-input=yes', 'Allow: /', 'Disallow: /api/agent/', '']),
  `Sitemap: ${ORIGIN}/sitemap.xml`,
  '',
].join('\n');

app.get('/robots.txt', (c) => c.text(ROBOTS_TXT, 200, { 'cache-control': 'public, max-age=3600' }));

// llms.txt (llmstxt.org) — a compact, link-first map of the site for LLMs and
// AI-search crawlers. Built from VIEW_OG so it never drifts from the real views.
app.get('/llms.txt', (c) => {
  const label = (v) => (VIEW_OG[v][0] || '').replace(/ — Chaindump$/, '');
  const line = (v) => `- [${label(v)}](${ORIGIN}/${v}): ${VIEW_OG[v][1]}`;
  const contentViews = ['live', 'mid', 'grave', 'traces', 'stables', 'nft', 'rwa', 'infra', 'markets', 'geo', 'uspolicy', 'power', 'news'].filter((v) => VIEW_OG[v]);
  const body = [
    '# Chaindump',
    '',
    '> Real-time blockchain intelligence — analysis and aggregation with provenance across chains, assets, markets, policy and on-chain forensics. Chaindump answers "what is changing, why, and what to do about it", not "what is biggest". Every material figure cites a resolving, authoritative source.',
    '',
    'Chaindump is a public-data product. Its differentiation is sourced analysis, not raw numbers: each view pairs live metrics with a written analyst take and an explicit provenance trail.',
    '',
    '## Views',
    ...contentViews.map(line),
    '',
    '## Entity deep-links',
    '- Chain profile: ' + ORIGIN + '/chain/{name} (e.g. ' + ORIGIN + '/chain/ethereum) — live TVL, volume, fundamentals and analyst take.',
    '- Scam case: ' + ORIGIN + '/scam/{slug} — traced wallets, fund-flow and sources.',
    '- NFT collection: ' + ORIGIN + '/collection/{id} — live floor, market cap, volume, holders.',
    '',
    '## Full context',
    '- [llms-full.txt](' + ORIGIN + '/llms-full.txt): current top-chains table (real data) plus every view\'s analysis, inlined as text.',
    '',
    '## For agents',
    '- [Agent API (x402)](' + ORIGIN + '/api): versioned, provenance-tagged JSON API, payable per-call via x402 (USDC on Base).',
    '- [API catalog](' + ORIGIN + '/.well-known/api-catalog)',
    '- [Agent skills index](' + ORIGIN + '/.well-known/agent-skills/index.json)',
    '- [MCP server card](' + ORIGIN + '/.well-known/mcp/server-card.json) — Chaindump intelligence as MCP tools.',
    '',
    '## Sources & method',
    'DefiLlama (TVL), CoinGecko (prices), OFAC SDN via the 0xB10C mirror (sanctions screening, 900+ addresses across 18 chains), growthepie (active addresses), and government / mainstream / NPO sources for policy. Claims that name a private individual as a wrongdoer are human-reviewed before publication, never auto-generated.',
    '',
    '## Usage policy',
    'AI assistants may read Chaindump to answer and cite (Content-Signal: search=yes, ai-input=yes) but not to train models (ai-train=no). See ' + ORIGIN + '/robots.txt.',
    '',
  ].join('\n');
  return c.text(body, 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

// llms-full.txt — the SPA renders bodies from /api client-side, so non-JS AI
// crawlers can't read the actual numbers. This inlines the current top-chains
// table (real snapshot data, sourced) + every view's analyst framing as citable
// markdown text, closing the client-side-rendering gap for AI engines.
async function llmsFullBody() {
  let chainsMd = '_Live snapshot temporarily unavailable._';
  let asOf = '';
  try {
    if (!cache.data) cache = await loadSnapshot();
    if (cache.data && cache.data.updatedAt) asOf = ` (as of ${cache.data.updatedAt})`;
    const top = (cache.data.chains || []).slice(0, 25);
    if (top.length) {
      chainsMd = ['| # | Chain | TVL | 24h volume | Token price | Activity rank |', '|---|---|---|---|---|---|']
        .concat(top.map((ch) => `| ${ch.rank ?? ''} | ${ch.name}${ch.dataQuality ? ' ⚠️' : ''} | $${fmtShort(ch.tvl)}${ch.dataQuality ? ' (unverified)' : ''} | $${fmtShort(ch.volume24h)} | ${ch.tokenPrice != null ? '$' + ch.tokenPrice : '—'} | ${ch.rank ?? ''} |`)).join('\n');
      // Spell the caveat out in prose — a citing model reads the footnote, not just the glyph.
      const caveats = top.filter((ch) => ch.dataQuality);
      if (caveats.length) {
        chainsMd += '\n\n' + caveats.map((ch) => `> ⚠️ **${ch.name} — unverified TVL.** ${ch.dataQuality.summary}`).join('\n>\n');
      }
    }
  } catch (e) { console.error('[llms-full] snapshot skipped:', e && e.message); }
  const label = (v) => (VIEW_OG[v][0] || '').replace(/ — Chaindump$/, '');
  const contentViews = ['live', 'mid', 'grave', 'traces', 'stables', 'nft', 'rwa', 'infra', 'markets', 'geo', 'uspolicy', 'power', 'news'].filter((v) => VIEW_OG[v]);
  const body = [
    '# Chaindump — full context for LLMs',
    '',
    '> Real-time blockchain intelligence — sourced analysis and aggregation across chains, assets, markets, policy and on-chain forensics. This file inlines Chaindump\'s current headline data and per-view analysis as plain text, because the site UI renders from a JSON API client-side.',
    '',
    `## Top chains by composite on-chain activity${asOf}`,
    'Ranked by composite activity (50% volume, 30% TVL, 20% fees). Source: DefiLlama (TVL/volume), CoinGecko (price).',
    '',
    chainsMd,
    '',
    '## What each view covers',
    ...contentViews.map((v) => `### ${label(v)} (${ORIGIN}/${v})\n${VIEW_OG[v][1]}`),
    '',
    '## Provenance',
    'Every material figure cites a resolving, authoritative source: DefiLlama (TVL), CoinGecko (prices), OFAC SDN via the 0xB10C mirror (sanctions, 900+ addresses / 18 chains), growthepie (active addresses), government / mainstream / NPO sources (policy). Claims naming a private individual as a wrongdoer are human-reviewed before publication.',
    '',
    '## Programmatic access',
    `Agent API (x402, USDC on Base): ${ORIGIN}/api · API catalog: ${ORIGIN}/.well-known/api-catalog · MCP server card: ${ORIGIN}/.well-known/mcp/server-card.json`,
    '',
    `Usage: AI assistants may read and cite (search=yes, ai-input=yes); training is disallowed (ai-train=no). See ${ORIGIN}/robots.txt.`,
    '',
  ].join('\n');
  return body;
}
app.get('/llms-full.txt', async (c) =>
  c.text(await llmsFullBody(), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=600' }));

app.get('/sitemap.xml', async (c) => {
  const urls = [`${ORIGIN}/`, ...Object.keys(VIEW_OG).map((v) => `${ORIGIN}/${v}`)];
  let lastmod;
  try { // include the live top chains as entity deep-links when the snapshot is warm
    if (!cache.data) cache = await loadSnapshot();
    if (cache.data && cache.data.updatedAt) lastmod = new Date(cache.data.updatedAt).toISOString().slice(0, 10);
    for (const ch of (cache.data.chains || []).slice(0, 50)) urls.push(`${ORIGIN}/chain/${encodeURIComponent(ch.name)}`);
  } catch (e) { console.error('[sitemap] chain deep-links skipped:', e instanceof Error ? e.message : e); }
  try { // scam cases + NFT collections — real-time product, so worth crawling
    const scams = await dbQuery(`SELECT slug FROM scam_traces`).catch(() => []);
    for (const s of scams) if (s.slug) urls.push(`${ORIGIN}/scam/${encodeURIComponent(s.slug)}`);
    if (ENV.DB) { const { results } = await ENV.DB.prepare(`SELECT id FROM nft_catalog LIMIT 200`).all(); for (const r of (results || [])) if (r.id != null) urls.push(`${ORIGIN}/collection/${encodeURIComponent(r.id)}`); }
  } catch (e) { console.error('[sitemap] case/collection deep-links skipped:', e instanceof Error ? e.message : e); }
  const lm = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u.replaceAll('&', '&amp;')}</loc>${lm}</url>`).join('\n')
    + '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
});

// RFC 9727 API catalog — points agents at the x402 agent API, its manifest and health.
app.get('/.well-known/api-catalog', (c) => {
  const linkset = { linkset: [{
    anchor: `${ORIGIN}/api/agent`,
    'service-desc': [{ href: `${ORIGIN}/api/agent/manifest`, type: 'application/json' }],
    'service-doc': [{ href: `${ORIGIN}/api`, type: 'text/html' }],
    status: [{ href: `${ORIGIN}/api/health`, type: 'application/json' }],
  }] };
  return new Response(JSON.stringify(linkset), { headers: { 'content-type': 'application/linkset+json', 'cache-control': 'public, max-age=3600' } });
});

// Agent Skills Discovery (RFC v0.2.0) — advertises Chaindump's differentiated
// agent capability, pointing at the LIVE x402 agent API (verified 200/402). The
// skill resource is served below; the index digests it so agents can integrity-
// check. (The MCP server-card is intentionally deferred until the chaindump-mcp
// server is hosted at a resolving URL — see docs/agent-readiness.md.)
const AGENT_SKILL_DOC = `# Chaindump — chain-intel (agent skill)

Differentiated blockchain intelligence for AI agents: OFAC sanctions screening,
chain forensics (why chains die/stall), live capital-flow & anomaly signals, and
country crypto power rankings. **Every response carries its sources; signals carry
a confidence score.** This is analysis + provenance — not raw TVL or spot prices
(get those free from DefiLlama/CoinGecko).

## Access
Query via the x402-payable agent API (USDC on Base): a free monthly quota, then
per-call payment. Discover prices, schemas and payment terms at
\`/api/agent/manifest\` and \`/.well-known/api-catalog\`.

## Entrypoints
- \`GET /api/agent/summary\` — market posture + top signals across all chains
- \`GET /api/agent/chain/{key}\` — full sourced profile + metrics + signals for one chain
- \`GET /api/agent/signals\` — live signal feed (momentum, capital rotation, anomalies)
- \`GET /api/agent/risk/{entity}\` — scam / bad-actor risk assessment with cited evidence

## Auth
x402 (HTTP 402 Payment Required on metered calls). Provenance is the product:
sources on every response, confidence (0–1) on every signal.
`;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

app.get('/.well-known/agent-skills/chaindump-chain-intel.md', () =>
  new Response(AGENT_SKILL_DOC, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' } }));

app.get('/.well-known/agent-skills/index.json', async () => {
  const index = {
    $schema: 'https://agentskills.io/schema/v0.2.0/index.json',
    skills: [{
      name: 'chaindump-chain-intel',
      type: 'api',
      description: 'Differentiated blockchain intelligence — OFAC screening, chain forensics, live signals, country power rankings — via the x402 agent API. Sourced.',
      url: `${ORIGIN}/.well-known/agent-skills/chaindump-chain-intel.md`,
      sha256: await sha256Hex(AGENT_SKILL_DOC),
    }],
  };
  return new Response(JSON.stringify(index, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
});

// MCP Server Card (SEP-1649) — now that the chaindump-mcp server is hosted at a
// resolving URL (Cloud Run), advertise it so MCP clients can discover it.
const MCP_ENDPOINT = 'https://chaindump-mcp-270018525501.us-central1.run.app/mcp';
app.get('/.well-known/mcp/server-card.json', () => {
  const card = {
    serverInfo: { name: 'chaindump-chain-intel', version: '0.1.0' },
    description: "Chaindump's differentiated blockchain intelligence — OFAC screening, chain forensics, live signals, power rankings — as MCP tools. Every response sourced.",
    transport: { type: 'streamable-http', endpoint: MCP_ENDPOINT },
    capabilities: { tools: {} },
    tools: [
      { name: 'screen_address', description: 'OFAC SDN sanctions screening for a crypto address (+ scam matches, risk).' },
      { name: 'chain_intel', description: 'Composite profile + analyst take + risk for one chain.' },
      { name: 'chain_forensics', description: 'Tier verdict (thriving/mid/dying/dead) + why it is stuck + outlook + sources.' },
      { name: 'power_ranking', description: 'Country crypto power ranking.' },
      { name: 'rwa_depin', description: 'RWA protocols by TVL + DePIN networks by market cap.' },
      { name: 'scam_cases', description: 'Traced scam/exploit cases with fund-flow and sources.' },
    ],
    documentation: `${ORIGIN}/api`,
  };
  return new Response(JSON.stringify(card, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
});

// RFC 8288 Link header advertising the API catalog + service docs. Applied to
// the homepage (run_worker_first: ["/"]) and every Worker-served HTML view.
const DISCOVERY_LINK = `<${ORIGIN}/.well-known/api-catalog>; rel="api-catalog", <${ORIGIN}/api>; rel="service-doc", <${ORIGIN}/api/agent/manifest>; rel="service-desc"`;

// Homepage: Worker-served (run_worker_first: ["/"]) so we can attach the Link
// header (sendHtml sets it) and proper homepage OG tags.
app.get('/', wrap(async (req, res) => {
  // Markdown-for-agents (RFC content negotiation): an agent that explicitly asks
  // for text/markdown gets the inlined markdown; browsers send text/html and are
  // untouched, so HTML stays the default.
  if (prefersMarkdown(req.headers.accept)) {
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.setHeader('vary', 'Accept');
    res.setHeader('link', DISCOVERY_LINK);
    return res.status(200).html(await llmsFullBody());
  }
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title: 'Chaindump — Onchain Intelligence', desc: OG_DESC_FALLBACK, url: `${ORIGIN}/` }));
}));

// Graceful fallback for any unmatched path. A page navigation (GET, wants HTML,
// not /api or a file) renders the SPA shell — the client router lands the user
// on the live board instead of a bare "404 Not Found". API/asset paths keep a
// real 404 so agents and tooling see the correct status.
app.notFound(async (c) => {
  const url = new URL(c.req.url);
  const p = url.pathname;
  // Any extensionless GET that isn't an API/well-known path is a page route —
  // serve the SPA shell regardless of Accept so browsers AND crawlers/agents
  // (which often send Accept: */*) get the app, never a bare 404.
  const isPage = c.req.method === 'GET'
    && !p.startsWith('/api/') && !p.startsWith('/.well-known/')
    && !/\.[a-z0-9]+$/i.test(p); // has a file extension → treat as a missing asset
  if (isPage) {
    try {
      const html = ogHtml(await spaShell(ENV, c.req.raw), { title: 'Chaindump — Onchain Intelligence', desc: OG_DESC_FALLBACK, url: ORIGIN + p });
      return c.html(html, 200, { Link: DISCOVERY_LINK });
    } catch (e) { console.error('[notFound spa] failed:', e && e.message); }
  }
  if (p.startsWith('/api/')) return c.json({ error: 'not_found', path: p }, 404);
  return c.text('404 Not Found', 404);
});

// ---------------------------------------------------------------------------
// Cron Trigger — refreshes the D1 snapshot cache off the request path (real
// freshness bounded by the cron interval, not per-request cache luck) and
// appends a time-series row per chain, the backbone for flow/delta signals.
// ---------------------------------------------------------------------------
// Chaindump-owned 7d deltas for metrics no upstream API pre-computes (stablecoin
// share-of-TVL migration, active-address trend) — computed once here, off the
// request hot path, and baked into the cached snapshot blob every request reads.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DELTA_SPAN_MS = 6 * 60 * 60 * 1000; // don't compute noisy deltas from <6h of history
async function computeSnapshotDeltas(env, now) {
  const out = {};
  try {
    const { results } = await env.DB.prepare(
      `SELECT chain, ts, tvl, stables, active_addresses FROM chain_snapshots WHERE ts >= ? ORDER BY chain, ts ASC`
    ).bind(now - SEVEN_DAYS_MS).all();
    const byChain = {};
    for (const r of results || []) (byChain[r.chain] = byChain[r.chain] || []).push(r);
    for (const chain in byChain) {
      const rows = byChain[chain];
      const oldest = rows[0], newest = rows[rows.length - 1];
      if (newest.ts - oldest.ts < MIN_DELTA_SPAN_MS) continue;
      const d = {};
      if (oldest.tvl > 0 && newest.tvl > 0 && oldest.stables != null && newest.stables != null) {
        d.stableShareDelta7d = +(((newest.stables / newest.tvl) - (oldest.stables / oldest.tvl)) * 100).toFixed(2);
      }
      if (oldest.active_addresses > 0 && newest.active_addresses != null) {
        d.activeAddressesDelta7d = +(((newest.active_addresses - oldest.active_addresses) / oldest.active_addresses) * 100).toFixed(1);
      }
      if (Object.keys(d).length) out[chain] = d;
    }
  } catch (e) { console.error('[computeSnapshotDeltas] failed:', e.message); }
  return out;
}

// Unbounded growth guard — bounded delete (D1 has no LIMIT on DELETE, so page
// by rowid) run only occasionally, not worth its own cron tick's CPU every time.
async function pruneOldSnapshots(env, now) {
  try {
    const { meta } = await env.DB.prepare(
      `DELETE FROM chain_snapshots WHERE id IN (SELECT id FROM chain_snapshots WHERE ts < ? LIMIT 2000)`
    ).bind(now - 90 * 24 * 60 * 60 * 1000).run();
    if (meta && meta.changes) console.error(`[pruneOldSnapshots] deleted ${meta.changes} rows older than 90d`);
  } catch (e) { console.error('[pruneOldSnapshots] failed:', e.message); }
}

async function handleScheduled(event, env, ctx) {
  if (!ENV.__init) { Object.assign(ENV, env || {}); ENV.__init = true; }
  // Read the prior blob BEFORE overwriting it, so peer hysteresis has last tick's
  // peers to compare against (otherwise the anti-churn rule is a no-op).
  let priorData = null;
  if (env.DB) {
    try { const row = await env.DB.prepare(`SELECT data FROM snapshot_cache WHERE key='chains'`).first(); if (row?.data) priorData = JSON.parse(row.data); }
    catch (e) { /* first run / cold cache — no prior, peers computed verbatim */ }
  }
  // buildSnapshot REFUSES to return a board it cannot stand behind — a dead
  // volume/fee feed, or every row falling back to the over-counted aggregate.
  // That refusal must not take the rest of the cron with it: this call had no
  // try/catch, so one transient DefiLlama rate-limit would silently skip the
  // RWA/DePIN refresh, the OFAC sanctions update and the snapshot prune too.
  // A refused board is the intended outcome — the last good snapshot stays, and
  // /api/chains now reports it as stale by age.
  let data = null;
  try {
    data = await buildSnapshot({ prior: priorPeersByKey(priorData) });
  } catch (e) {
    console.error('[cron] snapshot build refused, keeping last good:', e.message);
  }
  const ts = Date.now();

  if (env.DB) {
    const rows = (data && data.chains) || [];
    const stmt = env.DB.prepare(
      `INSERT INTO chain_snapshots (ts, chain, tvl, volume24h, fees24h, stables, active_addresses, token_price, token_mcap, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const batch = rows.map((c) => stmt.bind(
      ts, c.name, c.tvl ?? null, c.volume24h ?? null, c.fees24h ?? null, c.stables ?? null,
      c.activeAddresses ?? null, c.tokenPrice ?? null, c.tokenMcap ?? null, c.score ?? null
    ));
    if (batch.length) await env.DB.batch(batch);

    const deltas = await computeSnapshotDeltas(env, ts);
    for (const c of rows) Object.assign(c, deltas[c.name] || {});

    const tick = Math.floor(ts / (5 * 60 * 1000));
    // roughly every 4 hours (1-in-48 five-minute ticks) is plenty for a 90-day prune
    if (tick % 48 === 0) await pruneOldSnapshots(env, ts);
    // RWA/DePIN breadth changes slowly — refresh ~hourly (1-in-12 ticks)
    if (tick % 12 === 0) await refreshRwaDepin(env);
    // OFAC SDN list updates often; keep the wallet-screening set current daily (1-in-288)
    if (tick % 288 === 0) await refreshSanctioned(env);
    // NFT collection universe changes slowly — re-index ~weekly (1-in-2016)
    if (tick % 2016 === 0) await refreshNftCatalog(env);
  }

  // No board this tick: leave the cache and D1 holding the last good one.
  if (!data) return;
  if (!env.DB) { const blob = { ...data }; delete blob.chainsLite; cache = { ts, data: blob }; return; }
  cache = { ts, data: await persistSnapshot(env.DB, data, ts) };
}

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
