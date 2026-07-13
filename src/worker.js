import { Hono } from 'hono';
import { OFAC_FILES, ofacFileUrl, parseSanctionedFile, buildSanctionedRows } from './lib/ofac.js';
import { NFT_LIST_URL, NFT_PER_PAGE, nftRowsFromPage, dedupeNftRows } from './lib/nft.js';

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
const ALIAS = {
  bnb: 'bsc', binance: 'bsc', binancesmartchain: 'bsc',
  op: 'opmainnet', optimism: 'opmainnet', opmainnet: 'opmainnet',
  avax: 'avalanche',
  xdai: 'gnosis',
  zksyncera: 'zksync', zksync2: 'zksync',
  arbitrumone: 'arbitrum',
};
function norm(name) {
  let n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ALIAS[n]) return ALIAS[n];
  if (n.length > 2 && (n.endsWith('l1') || n.endsWith('l2'))) n = n.slice(0, -2);
  return ALIAS[n] || n;
}
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

// Sum a DefiLlama "overview" breakdown24h into { normKey: totalUSD }
function aggregateBreakdown(overview) {
  const out = {};
  for (const proto of (overview && overview.protocols) || []) {
    const b = proto.breakdown24h;
    if (!b) continue;
    for (const chain in b) {
      if (chain === 'off_chain') continue;
      let sum = 0;
      for (const k in b[chain]) sum += Number(b[chain][k]) || 0;
      const key = norm(chain);
      out[key] = (out[key] || 0) + sum;
    }
  }
  return out;
}

// growthepie master: origin_key -> { name, chainId }
function parseMaster(master) {
  const byChainId = {};
  const chains = (master && master.chains) || {};
  for (const originKey in chains) {
    const c = chains[originKey];
    const cid = c.evm_chain_id != null ? Number(c.evm_chain_id) : null;
    if (cid != null && !Number.isNaN(cid)) byChainId[cid] = originKey;
  }
  return byChainId;
}
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

async function buildSnapshot() {
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

  const volAgg = aggregateBreakdown(val(dexsR, {}));
  const feeAgg = aggregateBreakdown(val(feesR, {}));
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
  const rows = chains
    .filter((c) => c && c.name)
    .map((c) => {
      const key = norm(c.name);
      const originKey = c.chainId != null ? masterMap[Number(c.chainId)] : null;
      return {
        key,
        name: c.name,
        symbol: c.tokenSymbol || null,
        gecko: c.gecko_id || null,
        chainId: c.chainId ?? null,
        tvl: Number(c.tvl) || 0,
        volume24h: volAgg[key] || 0,
        fees24h: feeAgg[key] || 0,
        stables: stableByChain[key] || 0,
        activeAddresses: originKey && daaMap[originKey] != null ? daaMap[originKey] : null,
      };
    });

  // --- log-value composite score over the FULL universe, volume-weighted ---
  const lg = (x) => Math.log10(Math.max(1, x));
  const maxV = Math.max(...rows.map((r) => lg(r.volume24h)), 1);
  const maxT = Math.max(...rows.map((r) => lg(r.tvl)), 1);
  const maxF = Math.max(...rows.map((r) => lg(r.fees24h)), 1);
  for (const r of rows) {
    r.score = +(0.5 * (lg(r.volume24h) / maxV) + 0.3 * (lg(r.tvl) / maxT) + 0.2 * (lg(r.fees24h) / maxF)).toFixed(4);
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 50);

  // --- enrich ONLY the top 50 (bounded concurrency) ---
  await pool(top, async (r) => {
    const enc = encodeURIComponent(r.name);
    const [dex, hist] = await Promise.allSettled([
      fetchJson(`https://api.llama.fi/overview/dexs/${enc}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, 12000),
      fetchJson(`https://api.llama.fi/v2/historicalChainTvl/${enc}`, 12000),
    ]);
    if (dex.status === 'fulfilled' && dex.value && dex.value.total24h != null) {
      r.volume24h = Number(dex.value.total24h) || r.volume24h;
      r.volChange1d = dex.value.change_1d ?? null;
      r.volChange7d = dex.value.change_7d ?? null;
      r.volChange30d = dex.value.change_1m ?? null;
      r.volume7d = dex.value.total7d ?? null;
      r.volume30d = dex.value.total30d ?? null;
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
    r.feeYield = (r.tvl > 0 && annFees > 0) ? +((annFees / r.tvl) * 100).toFixed(1) : null; // % annual fee yield on TVL
    r.turnover = (r.tvl > 0) ? +(r.volume24h / r.tvl).toFixed(2) : null;                 // daily volume / TVL
    r.feePerUser = (r.activeAddresses) ? +(r.fees24h / r.activeAddresses).toFixed(2) : null; // 24h fees per active address

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

  const ranked = top.map((r, i) => ({ rank: i + 1, ...r, links: LINKS[norm(r.name)] || null }));
  const totals = ranked.reduce((a, r) => {
    a.tvl += r.tvl; a.volume24h += r.volume24h; a.fees24h += r.fees24h; a.stables += r.stables || 0;
    a.activeAddresses += r.activeAddresses || 0;
    return a;
  }, { tvl: 0, volume24h: 0, fees24h: 0, stables: 0, activeAddresses: 0 });

  const usersCoverage = ranked.filter((r) => r.activeAddresses != null).length;

  return {
    updatedAt: new Date().toISOString(),
    count: ranked.length,
    usersCoverage,
    totals,
    chains: ranked,
  };
}

// Read the cron-refreshed snapshot from D1 (instant, no live upstream calls on
// the hot path). Falls back to a live build only on a cold/empty cache — and
// best-effort primes the cache so subsequent requests don't repeat the miss.
async function loadSnapshot() {
  if (ENV.DB) {
    try {
      const row = await ENV.DB.prepare(`SELECT data, updated_at FROM snapshot_cache WHERE key='chains'`).first();
      if (row && row.data) return { data: JSON.parse(row.data), ts: row.updated_at };
    } catch (e) { /* table may not exist yet or a D1 hiccup — fall through to a live build */ }
  }
  const data = await buildSnapshot();
  const ts = Date.now();
  if (ENV.DB) {
    try {
      await ENV.DB.prepare(
        `INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('chains', ?, ?)
         ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      ).bind(JSON.stringify(data), ts).run();
    } catch (e) { /* best-effort priming, not fatal */ }
  }
  return { data, ts };
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
    res.json({ ...cache.data, cachedAgeMs: Date.now() - cache.ts });
  } catch (e) {
    console.error('snapshot error:', e.message);
    if (cache.data) return res.json({ ...cache.data, stale: true, error: e.message });
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

app.get('/api/chain/:name', wrap(async (req, res) => {
  try {
    if (!cache.data) cache = await loadSnapshot();
    const target = String(req.params.name || '').toLowerCase();
    const row = cache.data.chains.find((c) => c.name.toLowerCase() === target);
    if (!row) return res.status(404).json({ error: 'unknown chain' });

    let topProjects = [];
    try {
      const protos = await getProtocols();
      const name = row.name;
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

    res.json({ chain: row, description: DESCRIPTIONS[nkey] || null, topProjects, topNfts, topTokens, analysis, risk });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// Graveyard: chains that launched recently and then collapsed (populated by the research agent)
const TAG_LABELS = {
  mercenary_tvl: 'Mercenary TVL', airdrop_farming: 'Airdrop farming', points_collapse: 'Points collapse',
  token_unlock_dump: 'Token unlock dump', exploit_hack: 'Exploit / hack', team_abandonment: 'Team abandonment',
  soft_rug: 'Soft rug', unsustainable_yield: 'Unsustainable yield', narrative_death: 'Narrative death',
  no_real_users: 'No real users', wash_trading: 'Wash trading', vc_dump: 'VC dump',
  competition: 'Out-competed', regulatory: 'Regulatory',
};
const FRAUDY = new Set(['soft_rug', 'exploit_hack', 'wash_trading', 'token_unlock_dump']);

app.get('/api/dead', wrap(async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT chain, launched, peak_tvl, current_tvl, drawdown_pct, peak_date, why, outlook, verdict, sources, profile, updated_at FROM dead_chains ORDER BY peak_tvl DESC`);
    const chains = rows.map((r) => { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { ...r, profile: p }; });

    // aggregate trends across the graveyard
    const tagCounts = {}; let ddSum = 0, ddN = 0, fraud = 0; const verdictCounts = {};
    for (const c of chains) {
      const tags = (c.profile && c.profile.cause_tags) || [];
      tags.forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      if (tags.some((t) => FRAUDY.has(t))) fraud++;
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
        topTags, verdictCounts,
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
      const tags = (c.profile && c.profile.success_factors_missing) || [];
      tags.forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    }
    const topGaps = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ tag: k, label: k.replace(/_/g, ' '), count: n }));
    let framework = null;
    try { const s = await dbQuery(`SELECT v, updated_at FROM graveyard_meta WHERE k = 'success_factors' LIMIT 1`); if (s[0]) framework = { text: s[0].v, updated_at: s[0].updated_at }; } catch (e) {}
    res.json({ chains, count: chains.length, verdictCounts, topGaps, framework });
  } catch (e) {
    res.json({ chains: [], count: 0, error: e.message });
  }
}));

// ---------------------------------------------------------------------------
// Dynamic tier classifier — buckets chains into thriving / mid / dying / dead
// from LIVE data, so the leaderboards reflect current conditions.
//   dead  = >=90% drawdown from all-time peak TVL (terminal)
//   dying = down >=60% over the last 90 days (steep recent decline, not yet dead)
//   thriving = currently in the live top-25 by activity
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
    if (spanDays >= 90 && ago90 && ago90 >= Math.max(5e5, peak * 0.02)) change90 = ((cur - ago90) / ago90) * 100;
    return {
      chain: c.name, symbol: c.tokenSymbol || null, tvl: cur, spanDays: Math.round(spanDays),
      peak_tvl: peak, peak_date: peakDate ? toISO(peakDate) : null, current_tvl: cur,
      drawdown_pct: +drawdown.toFixed(1), change_90d: change90 != null ? +change90.toFixed(1) : null,
      launched: launched ? toISO(launched).slice(0, 7) : null,
    };
  }, 6);

  // chains that migrated/rebranded (TVL moved elsewhere) — not genuine deaths
  const MIGRATED = new Set(['fantom', 'terra', 'terraclassic', 'celo']);
  const b = { thriving: [], mid: [], dying: [], dead: [] };
  for (const m of metrics) {
    const key = norm(m.chain);
    if (thrivingNames.has(m.chain)) b.thriving.push(m);
    else if (m.spanDays >= 45 && m.drawdown_pct >= 90 && !MIGRATED.has(key)) b.dead.push(m);
    else if (m.change_90d != null && m.change_90d <= -60) b.dying.push(m);
    else b.mid.push(m);
  }
  b.mid.sort((x, y) => y.tvl - x.tvl);
  b.dying.sort((x, y) => (x.change_90d ?? 0) - (y.change_90d ?? 0));
  b.dead.sort((x, y) => y.peak_tvl - x.peak_tvl);
  return b;
}

// Complete { chainName: tier } map across all buckets — for the live board to
// badge each row with our own classification (progressive-enhancement fetch).
function tierMapFrom(b) {
  const map = {};
  for (const tier of ['thriving', 'mid', 'dying', 'dead']) for (const m of (b[tier] || [])) map[m.chain] = tier;
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

function parseProfileRow(r) { let p = null; try { p = r.profile ? JSON.parse(r.profile) : null; } catch (e) {} return { verdict: r.verdict, why: r.why, outlook: r.outlook, sources: r.sources, profile: p }; }
async function profileMap() {
  const out = {};
  try { (await dbQuery(`SELECT chain, verdict, why, outlook, profile, sources FROM dead_chains`)).forEach((r) => { out[r.chain] = parseProfileRow(r); }); } catch (e) {}
  try { (await dbQuery(`SELECT chain, verdict, why_stuck AS why, outlook, profile, sources FROM mid_chains`)).forEach((r) => { if (!out[r.chain]) out[r.chain] = parseProfileRow(r); }); } catch (e) {}
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
    res.json({
      updatedAt: new Date(tiersCache.ts).toISOString(),
      counts: { thriving: b.thriving.length, mid: b.mid.length, dying: b.dying.length, dead: b.dead.length },
      tierMap: { ...tierMapFrom(b), ...(await curatedTierMap()) },
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
//   verification. Until then it runs in demo mode (accepts any X-PAYMENT header).
// ---------------------------------------------------------------------------
// Facilitator decision: Coinbase CDP facilitator on Base mainnet, USDC.
// Gasless (EIP-3009), built-in KYT/OFAC screening, free 1k tx/mo. Go-live needs:
//   X402_PAY_TO = your Base receiving wallet
//   CDP_API_KEY_ID + CDP_API_KEY_SECRET (from portal.cdp.coinbase.com) for the facilitator SDK
const X402 = {
  get payTo() { return ENV.X402_PAY_TO || '0xee321Ac2315e6b60c2dEE4E989767C79b73e6f0d'; },
  get network() { return ENV.X402_NETWORK || 'base'; },
  get asset() { return ENV.X402_ASSET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; }, // USDC on Base
  get facilitator() { return ENV.X402_FACILITATOR || 'coinbase-cdp'; },
};
const AGENT_ENDPOINTS = {
  '/api/agent/summary': { price: 5000, desc: 'Market posture + top signals across all chains' },      // 0.005 USDC
  '/api/agent/chain': { price: 10000, desc: 'Full sourced profile + metrics + signals for one chain' }, // 0.01
  '/api/agent/signals': { price: 20000, desc: 'Live signal feed (momentum, flows, anomalies)' },       // 0.02
  '/api/agent/risk': { price: 50000, desc: 'Scam / bad-actor risk assessment with cited evidence' },   // 0.05 (compliance)
};
const USDC_DP = 1e6;
function require402(res, resource, priceAtomic, desc) {
  res.status(402).json({
    x402Version: 1,
    error: 'payment_required',
    accepts: [{
      scheme: 'exact', network: X402.network, maxAmountRequired: String(priceAtomic),
      resource, description: desc, mimeType: 'application/json',
      payTo: X402.payTo, asset: X402.asset, maxTimeoutSeconds: 60,
    }],
  });
}
// Free preview quota: each client gets FREE_LIMIT calls/month, then x402 payment required.
const FREE_LIMIT = 1;
const freeQuota = {}; // ip -> { count, monthKey }
function monthKey() { const d = new Date(); return d.getUTCFullYear() + '-' + d.getUTCMonth(); }
function x402Gate(req, res, baseResource, priceAtomic, desc) {
  const pay = req.headers['x-payment'];
  if (pay) return true; // paid — TODO(go-live): verify via CDP facilitator before serving
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'anon';
  const mk = monthKey();
  let q = freeQuota[ip];
  if (!q || q.monthKey !== mk) { q = freeQuota[ip] = { count: 0, monthKey: mk }; }
  q.count++;
  if (q.count <= FREE_LIMIT) { res.setHeader('X-Free-Calls-Remaining', String(FREE_LIMIT - q.count)); return true; }
  require402(res, baseResource, priceAtomic, desc);
  return false;
}

// Free discovery manifest — how agents learn what's payable and for how much
app.get('/api/agent/manifest', wrap((req, res) => {
  res.json({
    name: 'Chaindump', description: 'Onchain intelligence — chains, assets, markets, policy & forensics.',
    x402Version: 1, freeCallsPerMonth: FREE_LIMIT,
    payment: { network: X402.network, asset: X402.asset, payTo: X402.payTo, currency: 'USDC', mode: X402.payTo.startsWith('0x000') ? 'demo' : 'live' },
    entrypoints: Object.entries(AGENT_ENDPOINTS).map(([path, v]) => ({ path, priceUsd: v.price / USDC_DP, description: v.desc })),
  });
}));

app.get('/api/agent/summary', wrap(async (req, res) => {
  if (!x402Gate(req, res, '/api/agent/summary', AGENT_ENDPOINTS['/api/agent/summary'].price, AGENT_ENDPOINTS['/api/agent/summary'].desc)) return;
  if (!cache.data) cache = await loadSnapshot();
  const c = cache.data.chains || [];
  const all = c.flatMap((x) => x.signals || []);
  const rk = { critical: 3, notable: 2, info: 1 };
  all.sort((a, b) => (rk[b.severity] - rk[a.severity]) || (b.confidence - a.confidence));
  const t = cache.data.totals || {};
  res.json({
    schema_version: '2.0.0', data_as_of: cache.data.updatedAt,
    market: { total_tvl_usd: t.tvl, total_volume_24h_usd: t.volume24h, total_fees_24h_usd: t.fees24h, chains_tracked: c.length },
    leaders: c.slice(0, 5).map((x) => ({ chain: x.name, rank: x.rank, tvl_usd: x.tvl, activity_score: x.score })),
    top_signals: all.slice(0, 12),
    signal_counts: { critical: all.filter((s) => s.severity === 'critical').length, notable: all.filter((s) => s.severity === 'notable').length, total: all.length },
    provenance: { sources: ['defillama', 'coingecko', 'growthepie'], note: 'Every signal carries its own evidence + method + confidence (0–1). Full feed at /api/agent/signals.' },
  });
}));
app.get('/api/agent/chain/:key', wrap(async (req, res) => {
  if (!x402Gate(req, res, '/api/agent/chain', AGENT_ENDPOINTS['/api/agent/chain'].price, AGENT_ENDPOINTS['/api/agent/chain'].desc)) return;
  if (!cache.data) cache = await loadSnapshot();
  const row = (cache.data.chains || []).find((c) => c.name.toLowerCase() === String(req.params.key).toLowerCase());
  if (!row) return res.status(404).json({ error: 'unknown_chain' });
  let analysis = null;
  try { const r = await dbQuery(`SELECT take, sentiment, sources, profile FROM chain_analysis WHERE chain=? LIMIT 1`, [row.name]); if (r[0]) analysis = r[0]; } catch (e) {}
  res.json({ schema_version: '1.0.0', data_as_of: cache.data.updatedAt, chain: row, analysis, provenance: { sources: ['defillama', 'growthepie', 'coingecko'] } });
}));
app.get('/api/agent/signals', wrap(async (req, res) => {
  if (!x402Gate(req, res, '/api/agent/signals', AGENT_ENDPOINTS['/api/agent/signals'].price, AGENT_ENDPOINTS['/api/agent/signals'].desc)) return;
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
  if (!x402Gate(req, res, '/api/agent/risk', AGENT_ENDPOINTS['/api/agent/risk'].price, AGENT_ENDPOINTS['/api/agent/risk'].desc)) return;
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
function ogHtml(html, { title, desc, url }) {
  const t = escapeHtml(title || 'Chaindump — Onchain Intelligence');
  const d = escapeHtml(desc || OG_DESC_FALLBACK);
  const u = escapeHtml(url || 'https://chaindump.xyz/');
  const tags = `<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:url" content="${u}">
<meta property="og:site_name" content="Chaindump">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">`;
  return html.replace(/<title>[\s\S]*?<\/title>/, tags);
}
async function spaShell(env, req) {
  try {
    if (!env || !env.ASSETS) throw new Error('no ASSETS binding');
    const r = await env.ASSETS.fetch(new Request(new URL('/index.html', req.url)));
    return await r.text();
  } catch (e) { console.error('[spaShell] failed:', e && e.message); throw e; }
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
Object.keys(VIEW_OG).forEach((v) => {
  app.get('/' + v, wrap(async (req, res) => {
    const [title, desc] = VIEW_OG[v];
    sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url: `https://chaindump.xyz/${v}` }));
  }));
});
app.get('/chain/:name', wrap(async (req, res) => {
  const key = String(req.params.name || '');
  if (!cache.data) cache = await loadSnapshot();
  const row = (cache.data.chains || []).find((c) => c.name.toLowerCase() === key.toLowerCase());
  const title = row ? `${row.name} — Chaindump` : 'Chain — Chaindump';
  const desc = row
    ? `${row.name}: $${fmtShort(row.tvl)} TVL, $${fmtShort(row.volume24h)} 24h volume, rank #${row.rank} by activity. Live metrics, fundamentals and analyst take on Chaindump.`
    : OG_DESC_FALLBACK;
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url: `https://chaindump.xyz/chain/${encodeURIComponent(key)}` }));
}));
app.get('/scam/:slug', wrap(async (req, res) => {
  const slug = String(req.params.slug || '');
  let row = null;
  try { row = (await dbQuery(`SELECT name, category, amount_usd FROM scam_traces WHERE slug = ?`, [slug]))[0]; } catch (e) {}
  const title = row ? `${row.name} — Chaindump Scam Tracker` : 'Scam Tracker — Chaindump';
  const desc = row ? `${row.name}${row.amount_usd ? ` — ~$${fmtShort(row.amount_usd)} ${row.category || ''}` : ''}. Traced wallets, fund-flow and sources on Chaindump.` : OG_DESC_FALLBACK;
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url: `https://chaindump.xyz/scam/${encodeURIComponent(slug)}` }));
}));
app.get('/collection/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  let row = null;
  try { if (ENV.DB) row = await ENV.DB.prepare(`SELECT name, chain FROM nft_catalog WHERE id = ?`).bind(id).first(); } catch (e) {}
  const title = row ? `${row.name} — Chaindump` : 'NFT Collection — Chaindump';
  const desc = row ? `${row.name} (${row.chain}) — live floor, market cap, 24h volume and holders on Chaindump.` : OG_DESC_FALLBACK;
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title, desc, url: `https://chaindump.xyz/collection/${encodeURIComponent(id)}` }));
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

app.get('/sitemap.xml', async (c) => {
  const urls = [`${ORIGIN}/`, ...Object.keys(VIEW_OG).map((v) => `${ORIGIN}/${v}`)];
  try { // include the live top chains as entity deep-links when the snapshot is warm
    if (!cache.data) cache = await loadSnapshot();
    for (const ch of (cache.data.chains || []).slice(0, 50)) urls.push(`${ORIGIN}/chain/${encodeURIComponent(ch.name)}`);
  } catch (e) { console.error('[sitemap] entity deep-links skipped:', e instanceof Error ? e.message : e); }
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u.replaceAll('&', '&amp;')}</loc></url>`).join('\n')
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

// RFC 8288 Link header advertising the API catalog + service docs. Applied to
// the homepage (run_worker_first: ["/"]) and every Worker-served HTML view.
const DISCOVERY_LINK = `<${ORIGIN}/.well-known/api-catalog>; rel="api-catalog", <${ORIGIN}/api>; rel="service-doc", <${ORIGIN}/api/agent/manifest>; rel="service-desc"`;

// Homepage: Worker-served (run_worker_first: ["/"]) so we can attach the Link
// header (sendHtml sets it) and proper homepage OG tags.
app.get('/', wrap(async (req, res) => {
  sendHtml(res, ogHtml(await spaShell(ENV, req.raw), { title: 'Chaindump — Onchain Intelligence', desc: OG_DESC_FALLBACK, url: `${ORIGIN}/` }));
}));

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
  const data = await buildSnapshot();
  const ts = Date.now();

  if (env.DB) {
    const rows = data.chains || [];
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

  cache = { ts, data };
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO snapshot_cache (key, data, updated_at) VALUES ('chains', ?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(data), ts).run();
}

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
