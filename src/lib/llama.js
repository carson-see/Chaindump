// DefiLlama feed shaping: turning the /overview/* payloads into the inputs the
// activity score is allowed to claim it uses.
//
// Two real defects motivated this module, both found by measuring the live feed
// against DefiLlama's own authoritative per-chain numbers:
//
// 1. OVER-COUNTING. /overview/dexs carries 1245 protocols across 33 categories —
//    Derivatives, Prediction Market, NFT Marketplace, Telegram Bot, Crypto Card
//    Issuer, even Physical TCG. Summing all of them and labelling the result
//    "24h DEX volume" is false. On Injective a single Derivatives protocol
//    (TrueCurrent, $2.93M) was 91% of a $3.2M figure whose authoritative value
//    is $200K — a 16x overstatement.
//
// 2. SILENT ZEROES. The TVL feed and the DEX breakdown disagree on chain names:
//    "Hyperliquid L1" vs "hyperliquid", "OP Mainnet" vs "optimism". 302 of 458
//    chains have no matching key. Those chains scored volume = 0 on a 50%-weight
//    axis — Hyperliquid L1 ($265M of real DEX volume), Avalanche and OP Mainnet
//    were all ranked as if they had no trading at all.
//
// Fix for (1) is the category filter below. Fix for (2) is NOT a hand-maintained
// alias table — it is selectCandidates(): pick the board's candidate pool on
// several independent axes so a chain zeroed on one axis still gets enriched
// from DefiLlama's per-chain endpoint, which resolves names correctly.

/**
 * Categories in /overview/dexs that are actually DEX spot trading.
 * Everything else in that payload is a different product being counted as one.
 * Aggregators are excluded deliberately: they route trades that the underlying
 * DEX already reports, so including them double-counts the same volume.
 */
export const DEX_CATEGORIES = new Set(['Dexs']);

/**
 * Sum a DefiLlama "overview" breakdown24h into { normKey: totalUSD }.
 * @param {object} overview  the /overview/* payload
 * @param {(s:string)=>string} normalize  chain-name normalizer
 * @param {{categories?: Set<string>}} [opts]  when given, protocols whose category
 *   is a KNOWN member of some other category are excluded. Omit for feeds where
 *   every protocol counts (e.g. /overview/fees, which is chain-wide revenue).
 *
 * A protocol with no category at all is COUNTED, not dropped. We can't judge what
 * we can't see, and silently excluding it would zero a chain's 50%-weight axis on
 * an upstream shape change — the same class of failure as the name-mismatch bug
 * above, but self-inflicted. feedIsDegenerate() is the backstop if that goes wrong
 * at scale.
 */
export function aggregateBreakdown(overview, normalize, opts = {}) {
  const { categories } = opts;
  const out = {};
  for (const proto of (overview && overview.protocols) || []) {
    if (categories && proto.category != null && !categories.has(proto.category)) continue;
    const b = proto.breakdown24h;
    if (!b) continue;
    for (const chain in b) {
      if (chain === 'off_chain') continue;
      let sum = 0;
      for (const k in b[chain]) sum += Number(b[chain][k]) || 0;
      const key = normalize(chain);
      out[key] = (out[key] || 0) + sum;
    }
  }
  return out;
}

/**
 * Has a feed degraded into uselessness? An empty aggregate against a populated
 * chain universe is never real: it means the upstream failed or changed shape.
 * Scoring through it silently re-ranks the board (a dead volume axis contributes
 * zero to EVERY chain, so the board quietly becomes TVL+fees only).
 */
export function feedIsDegenerate(agg, universeSize) {
  return universeSize > 0 && Object.keys(agg).length === 0;
}

/**
 * Choose which chains to enrich from DefiLlama's per-chain endpoints.
 *
 * Selecting purely by provisional score would be circular: the provisional score
 * is computed from the very aggregate that zeroes 302 chains, so a chain missing
 * from the breakdown could never earn enrichment and could never be corrected.
 * Taking the top of each axis independently breaks that loop — Hyperliquid L1
 * enters on TVL despite a $0 volume reading, gets its real $265M from the
 * per-chain endpoint, and is scored on the truth.
 *
 * @returns {Array} the candidate rows (a superset of the eventual board)
 */
export function selectCandidates(rows, { boardSize, scoreBuffer = 30, axisTop = 30 } = {}) {
  const pick = (key, n) => [...rows].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, n);
  const chosen = new Set([
    ...pick('score', boardSize + scoreBuffer),
    ...pick('tvl', axisTop),
    ...pick('volume24h', axisTop),
    ...pick('fees24h', axisTop),
  ]);
  return [...chosen];
}

/**
 * DefiLlama's /v2/chains double-lists some chains under one chainId: a real entry
 * and a legacy alias carrying $0 TVL. Measured 2026-07-17 — exactly two:
 *   chainId 56: BSC ($4.87B)        vs Binance ($0.00B)
 *   chainId 10: OP Mainnet ($290M)  vs Optimism ($0.00B)
 *
 * The alias used to be harmless: it scored ~0 on the aggregate and sank. Two-pass
 * scoring made it dangerous — DefiLlama's per-chain endpoint RESOLVES the alias,
 * so "Binance" gets BNB Chain's real DEX volume while reporting $0 TVL, and a
 * ghost outranks the genuine entry. The board then shows the same chain twice.
 *
 * Keep the row with the most TVL: the alias is the empty one by construction.
 * Tie-break on name so a degenerate feed can't reorder the board at random.
 */
export function dedupeChains(rows) {
  const byId = new Map();
  const out = [];
  for (const r of rows) {
    if (r.chainId == null) { out.push(r); continue; }   // no chainId -> nothing to dedupe against
    const k = String(r.chainId);
    const prev = byId.get(k);
    if (!prev) { byId.set(k, r); continue; }
    const better = (Number(r.tvl) || 0) !== (Number(prev.tvl) || 0)
      ? ((Number(r.tvl) || 0) > (Number(prev.tvl) || 0) ? r : prev)
      : (String(r.name) < String(prev.name) ? r : prev);
    byId.set(k, better);
  }
  return [...out, ...byId.values()];
}
