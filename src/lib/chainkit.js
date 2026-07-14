// Pure, testable helpers for linking chains into a connected graph of profiles.
// Phase 1 (linking foundation). Two jobs:
//   1. Give every chain a value-prop CATEGORY (curated, with a growthepie-derived
//      fallback) so profiles group by "what a chain is for", not just size.
//   2. Compute RELATED peers — same-category first (a hard filter, not a nudge),
//      backfilled by data-driven metric nearest-neighbours, with reasons that only
//      claim what was actually measured, and hysteresis so peers don't churn.
// The DB/route/cron wiring lives in worker.js; this module is pure so the linking
// logic is unit-testable without a Worker runtime or live data.
//
// IMPORTANT (see premortem): the caller must pass a chain's absent metrics as
// `null`, NOT `0`. A tail chain missing from the fee/volume breakdown is unknown,
// not zero — passing 0 would let it claim measured similarity it doesn't have.

// ---- canonical name normalization (single source of truth) --------------
// Moved here from worker.js so the worker and chainkit can never disagree on a
// chain key. worker.js imports { ALIAS, norm } from this module.
export const ALIAS = {
  bnb: 'bsc', binance: 'bsc', binancesmartchain: 'bsc',
  op: 'opmainnet', optimism: 'opmainnet', opmainnet: 'opmainnet',
  avax: 'avalanche',
  xdai: 'gnosis',
  zksyncera: 'zksync', zksync2: 'zksync',
  arbitrumone: 'arbitrum',
};
export function norm(name) {
  let n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ALIAS[n]) return ALIAS[n];
  if (n.length > 2 && (n.endsWith('l1') || n.endsWith('l2'))) n = n.slice(0, -2);
  return ALIAS[n] || n;
}

// ---- curated value-prop taxonomy ----------------------------------------
// One salient archetype per chain. Public, descriptive classification (not a
// numeric/market claim). Keys are norm() outputs. Chains absent here fall back to
// deriveCategory() (growthepie), else null → data-driven-only peers.
export const CATEGORY_LABELS = {
  'l1-settlement': 'Base settlement layer',
  'l2-optimistic': 'Optimistic rollup (Ethereum L2)',
  'l2-zk': 'ZK rollup (Ethereum L2)',
  'l1-smart-contract': 'Alternative L1 smart-contract platform',
  'evm-sidechain': 'EVM sidechain',
  'cosmos-appchain': 'Cosmos app-chain',
  'modular-da': 'Modular data-availability layer',
  'bitcoin-l2': 'Bitcoin L2 / metaprotocol',
  'gaming-appchain': 'Gaming-focused chain',
  'payments': 'Payments & stablecoin settlement',
};

export const CHAIN_CATEGORY = {
  ethereum: 'l1-settlement',
  // optimistic rollups
  arbitrum: 'l2-optimistic', opmainnet: 'l2-optimistic', base: 'l2-optimistic',
  blast: 'l2-optimistic', mode: 'l2-optimistic', zora: 'l2-optimistic',
  mantle: 'l2-optimistic', fraxtal: 'l2-optimistic', worldchain: 'l2-optimistic',
  arbitrumnova: 'l2-optimistic', unichain: 'l2-optimistic', // premortem fix
  // zk rollups
  zksync: 'l2-zk', starknet: 'l2-zk', linea: 'l2-zk', scroll: 'l2-zk',
  polygonzkevm: 'l2-zk', taiko: 'l2-zk', manta: 'l2-zk',
  // alt L1 smart-contract platforms
  solana: 'l1-smart-contract', avalanche: 'l1-smart-contract', aptos: 'l1-smart-contract',
  sui: 'l1-smart-contract', near: 'l1-smart-contract', cardano: 'l1-smart-contract',
  ton: 'l1-smart-contract', algorand: 'l1-smart-contract', tezos: 'l1-smart-contract',
  hedera: 'l1-smart-contract', flow: 'l1-smart-contract',
  // premortem fix: big chains that were missing → generic peers
  hyperliquid: 'l1-smart-contract', monad: 'l1-smart-contract', berachain: 'l1-smart-contract',
  sonic: 'l1-smart-contract',
  // evm sidechains
  polygon: 'evm-sidechain', bsc: 'evm-sidechain', gnosis: 'evm-sidechain',
  cronos: 'evm-sidechain',
  celo: 'l2-optimistic', // premortem fix: migrated to an OP-Stack L2
  // cosmos app-chains
  osmosis: 'cosmos-appchain', injective: 'cosmos-appchain', sei: 'cosmos-appchain',
  kava: 'cosmos-appchain', dydx: 'cosmos-appchain', neutron: 'cosmos-appchain',
  // modular DA
  celestia: 'modular-da',
  // bitcoin L2s
  stacks: 'bitcoin-l2', merlin: 'bitcoin-l2', bitlayer: 'bitcoin-l2',
  rootstock: 'bitcoin-l2', rsk: 'bitcoin-l2', bob: 'bitcoin-l2',
  // gaming
  ronin: 'gaming-appchain', immutablex: 'gaming-appchain', immutable: 'gaming-appchain',
  beam: 'gaming-appchain', xai: 'gaming-appchain', oasys: 'gaming-appchain',
  // payments / stablecoin settlement
  tron: 'payments', stellar: 'payments',
};

export function chainCategory(name) {
  return CHAIN_CATEGORY[norm(name)] || null;
}
export function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || null;
}

// Best-effort category from a growthepie master.json chain record. Known ceiling
// (documented, not a bug): growthepie is EVM/tracked-chains only, so non-EVM and
// long-tail chains return null here and must be covered by CHAIN_CATEGORY.
export function deriveCategory(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const stack = String((rec.stack && (rec.stack.label || rec.stack)) || '').toLowerCase();
  const bucket = String(rec.bucket || rec.chain_type || '').toLowerCase();
  // Stack (the rollup framework) is the strongest signal and is checked before
  // the DA bucket, so a rollup that merely USES an external DA layer is classed
  // by its stack, not mislabelled modular-da.
  if (/op[- ]?stack|optimistic|orbit|arbitrum/.test(stack)) return 'l2-optimistic';
  if (/zk|validity|starknet|zksync|polygon[- ]?zk/.test(stack)) return 'l2-zk';
  if (/(^|\W)da(\W|$)|data[- ]?availability/.test(bucket)) return 'modular-da';
  if (/l2|layer[- ]?2|rollup/.test(bucket)) return 'l2-optimistic';
  if (/l1|layer[- ]?1/.test(bucket)) return 'l1-smart-contract';
  return null;
}
// Curated always wins, then growthepie-derived, then null.
export function resolveCategory(name, derived) {
  return chainCategory(name) || derived || null;
}

// ---- coverage tier (by DATA PRESENT, not by rank) -----------------------
// A chain is "full" only if it actually carries the enriched signals/ratios;
// otherwise "basic". Premortem M3: a top-50 chain whose enrichment fetch failed
// must not be labelled full.
export function coverageTier(row) {
  const enriched = ['feeYield', 'turnover', 'pf'].filter((k) => row && row[k] != null).length;
  return (Array.isArray(row && row.signals) || enriched >= 2) ? 'full' : 'basic';
}

// ---- data-driven similarity ---------------------------------------------
// active-addresses (lactive) is deliberately EXCLUDED: growthepie DAA is
// CF-blocked and served from a static D1 seed, so it's stale signal (premortem 6).
export const FEATURES = ['ltvl', 'lvol', 'lfee', 'feeYield', 'turnover', 'stablesShare'];
export const MIN_BASIS = 2; // co-measured features required to claim METRIC similarity
export const CLOSE_Z = 0.75; // max z-distance on an axis to call a peer "close on" it

const FRIENDLY = { ltvl: 'TVL', lvol: 'volume', lfee: 'fees', feeYield: 'fee yield', turnover: 'turnover', stablesShare: 'stablecoin share' };
const lg = (x) => Math.log10(Math.max(0, Number(x) || 0) + 1);
// Coerce to a finite number or null. NaN/Infinity/undefined → null (unknown),
// never a measured 0 — otherwise a bad upstream value would fabricate similarity
// and skew the standardization stats (review H2).
const num = (x) => { if (x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Raw (pre-standardization) feature values. null = unknown (caller passes null,
// never 0, for absent metrics). feeYield/turnover derive from tvl+fees+vol so
// they're available on tail rows too when those inputs are present.
export function rawFeatures(c) {
  const tvl = num(c.tvl), fees = num(c.fees24h), vol = num(c.volume24h);
  const stables = num(c.stables), fY = num(c.feeYield), tO = num(c.turnover);
  return {
    ltvl: tvl != null && tvl > 0 ? lg(tvl) : null,
    lvol: vol != null ? lg(vol) : null,
    lfee: fees != null ? lg(fees) : null,
    feeYield: fY != null ? fY : (tvl != null && tvl > 0 && fees != null ? (fees * 365) / tvl * 100 : null),
    turnover: tO != null ? tO : (tvl != null && tvl > 0 && vol != null ? vol / tvl : null),
    stablesShare: tvl != null && tvl > 0 && stables != null ? stables / tvl : null,
  };
}

// z-score each feature over chains that have it; missing → 0 (the column mean).
// Returns { vec: Map<key, number[]>, raw: Map<key, rawFeatures> }.
export function standardize(chains) {
  const raw = chains.map((c) => ({ key: c.key || norm(c.name), f: rawFeatures(c) }));
  const stats = {};
  for (const key of FEATURES) {
    const vals = raw.map((r) => r.f[key]).filter((v) => v != null && Number.isFinite(v));
    const mean = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0;
    const variance = vals.length ? vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length : 0;
    stats[key] = { mean, std: Math.sqrt(variance) || 1 };
  }
  const vec = new Map(), rawByKey = new Map();
  for (const r of raw) {
    rawByKey.set(r.key, r.f);
    vec.set(r.key, FEATURES.map((key) => {
      const v = r.f[key];
      return v == null || !Number.isFinite(v) ? 0 : (v - stats[key].mean) / stats[key].std;
    }));
  }
  return { vec, raw: rawByKey };
}

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// Rank ALL candidates for a target (pre-hysteresis, pre-slice). Category is a
// HARD tier: same-category candidates come before metric-only ones. Within a
// tier, sort by distance asc with deterministic tie-breaks. Honest `basis` =
// features co-measured on both sides; a candidate with < MIN_BASIS co-measured
// features AND a different category is dropped (can't claim similarity, isn't a
// category peer). Returns ordered candidate descriptors.
export function rankCandidates(targetName, chains) {
  const tKey = norm(targetName);
  const { vec, raw } = standardize(chains);
  const tVec = vec.get(tKey);
  if (!tVec) return [];
  // resolveCategory (curated wins) for BOTH target and candidates so matching and
  // labelling never disagree (review M3).
  const tCat = resolveCategory(targetName, chains.find((c) => (c.key || norm(c.name)) === tKey)?.category);
  const tRaw = raw.get(tKey);
  const out = [];
  const seen = new Set([tKey]);
  for (const c of chains) {
    const key = c.key || norm(c.name);
    if (seen.has(key)) continue; // dedup by normalized key (review M4)
    seen.add(key);
    const cRaw = raw.get(key), cVec = vec.get(key);
    const basis = FEATURES.filter((f) => tRaw[f] != null && cRaw[f] != null);
    // "close" = co-measured AND within CLOSE_Z std of the target on that axis, so
    // "close on X" is only ever said when it's true (review H1).
    const closeBasis = basis.filter((f) => Math.abs(tVec[FEATURES.indexOf(f)] - cVec[FEATURES.indexOf(f)]) <= CLOSE_Z);
    const cCat = resolveCategory(c.name, c.category);
    const sameCategory = !!(tCat && cCat === tCat);
    if (basis.length < MIN_BASIS && !sameCategory) continue; // can't honestly relate
    out.push({
      name: c.name, key, category: cCat, coverage: c.coverage || coverageTier(c),
      distance: euclidean(tVec, cVec), basis, closeBasis, sameCategory,
      matchType: sameCategory ? 'category' : 'metric',
    });
  }
  // hard tier: category peers first, then metric; deterministic within tier
  out.sort((a, b) => {
    if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}

// Hysteresis: keep peer lists stable across 5-min refreshes. An incumbent peer
// (in priorKeys) that fell out of the fresh top-k is restored — displacing the
// weakest NON-incumbent fresh peer — unless a challenger beats it by > margin in
// normalized similarity. Cold start (no priorKeys) returns fresh top-k verbatim.
export function applyHysteresis(ranked, priorKeys, k, margin) {
  const fresh = ranked.slice(0, k);
  if (!priorKeys || priorKeys.length === 0) return fresh;
  const maxD = ranked.reduce((m, c) => Math.max(m, c.distance), 0) || 1;
  const sim = (c) => 1 - c.distance / maxD;
  const prior = new Set(priorKeys);
  const freshKeys = new Set(fresh.map((c) => c.key));
  // incumbents still valid candidates but dropped from fresh
  const droppedIncumbents = ranked.filter((c) => prior.has(c.key) && !freshKeys.has(c.key));
  const result = [...fresh];
  for (const inc of droppedIncumbents) {
    // weakest fresh peer that is NOT itself an incumbent, in the same tier
    let weakestIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const p = result[i];
      if (prior.has(p.key)) continue;
      if (p.sameCategory !== inc.sameCategory) continue;
      weakestIdx = i; break;
    }
    if (weakestIdx === -1) continue;
    const challenger = result[weakestIdx];
    if (sim(challenger) - sim(inc) <= margin) result[weakestIdx] = inc; // not a clear win → keep incumbent
  }
  // re-sort to preserve tier + distance ordering after any swaps
  result.sort((a, b) => {
    if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return result.slice(0, k);
}

// Honest reason string. Only names features the peer is actually CLOSE on
// (closeBasis), never merely co-measured — a same-category peer that is far on
// every axis says "same category", not "close on ..." (review H1). A category
// peer with too little data says "limited data" and never claims metric
// similarity (premortem H3 / accuracy bar).
export function buildReason(cand, targetCatLabel) {
  const close = cand.closeBasis.map((f) => FRIENDLY[f]);
  if (cand.matchType === 'category') {
    if (cand.basis.length < MIN_BASIS) return `${targetCatLabel} · limited data`;
    if (close.length === 0) return `${targetCatLabel} · same category`;
    return `${targetCatLabel} · close on ${close.join(', ')}`;
  }
  // metric peers are the nearest overall; name what they're genuinely close on.
  return close.length ? `Similar ${close.join(', ')}` : 'Similar overall profile';
}

// Peers for a target within `chains`. opts: { k=6, prior=[] (ordered prior peer
// keys), margin=0.05 }. Pure over the passed-in set.
export function similarChains(targetName, chains, opts = {}) {
  const k = Number.isInteger(opts.k) && opts.k >= 0 ? opts.k : 6; // k:0 must mean 0 (review M5)
  const margin = opts.margin != null ? opts.margin : 0.05;
  const tCatLabel = categoryLabel(resolveCategory(targetName,
    chains.find((c) => (c.key || norm(c.name)) === norm(targetName))?.category));
  const ranked = rankCandidates(targetName, chains);
  const chosen = applyHysteresis(ranked, opts.prior, k, margin);
  return chosen.map((c) => ({
    name: c.name,
    key: c.key,
    category: c.category,
    coverage: c.coverage,
    sameCategory: c.sameCategory,
    matchType: c.matchType,
    lowConfidence: c.basis.length < MIN_BASIS,
    // absolute closeness in (0,1]; nearest→1, never a misleading set-relative 0
    // (review M1). Monotonic in distance.
    similarity: +(1 / (1 + c.distance)).toFixed(3),
    basis: c.basis,
    reason: buildReason(c, tCatLabel),
  }));
}

// Full "related" block for a chain profile.
export function relatedBlock(targetName, chains, opts = {}) {
  const cat = resolveCategory(targetName, chains.find((c) => (c.key || norm(c.name)) === norm(targetName))?.category);
  return {
    category: cat,
    categoryLabel: categoryLabel(cat),
    peers: similarChains(targetName, chains, opts),
  };
}
