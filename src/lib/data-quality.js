// Pure, testable data-quality rules for chain TVL. Tested by test/data-quality.test.js.
//
// WHY THIS EXISTS
// A TVL-ordered list invites a comparison: two chains sitting next to each other
// look like peers. That comparison is only honest when both figures are
// independently checkable. A DefiLlama TVL adapter reads token balances and
// prices them at the canonical asset's price — but any chain can deploy an
// ERC-20 named "DAI" or "USDT" with any supply, and an adapter reading balances
// will happily price it as the real thing. So a chain whose entire TVL is one
// unaudited contract, with no bridge to corroborate that value ever arrived from
// somewhere, produces a number that cannot be checked against anything.
//
// This module marks such a figure UNVERIFIED. That is a claim about
// VERIFIABILITY ONLY — not about intent, honesty, or wrongdoing. Established
// chains legitimately trip it (a young chain with one first-party DEX looks
// identical to anything else here). That is why the surface shows a caveat badge
// explaining the reasons rather than silently suppressing the row: the user sees
// the evidence and draws their own conclusion.

import { norm } from './chainkit.js';

export const DQ_UNVERIFIED = 'unverified_tvl';

// Share of chain TVL in the single largest protocol, at/above which the chain's
// TVL is "effectively one contract". 99 (not 100) tolerates dust from a second
// adapter without changing the conclusion.
export const CONCENTRATION_MIN = 99;

// The rule reads /protocols; the badge renders beside the TVL from /v2/chains.
// Those are two different numbers, and when they disagree the published sentence
// "N% of this chain's TVL sits in one protocol" is not about the figure the
// reader is looking at. Measured 2026-07-17: XION displays $3,990 while protocols
// report $25.4M (the reason string would have claimed 99.98% of the wrong total);
// Movement displays $127.0M against $5.7M reported. If our view of a chain cannot
// be reconciled with the number we are annotating, we do not have a verdict about
// that number. Fail closed, the same way an unknown chain already does.
export const RECONCILE_TOLERANCE_PCT = 10;

// Above this displayed TVL, the caveat is computed but NOT auto-published.
//
// The rule's premise — "no bridge, so the value cannot be corroborated as having
// arrived from anywhere" — assumes value ARRIVES. It doesn't for native-asset and
// RWA chains, where assets are originated on-chain. Provenance is the live proof:
// $1.5B, operated by Figure (a real US financial institution), 96.93% in one
// protocol reporting audits:"0", no bridge — 2.07 points from being branded
// automatically, on a public indexable surface, by a rule whose premise does not
// apply to it. CLAUDE.md 1.5 keeps the highest-stakes adverse claims behind human
// review; this is the same principle drawn at a defensible line rather than a
// promise to be careful. Anubis ($200.1M) is the largest chain the rule actually
// fires on and sits well under the ceiling, so the case this was built for still
// publishes on its own.
export const AUTO_PUBLISH_TVL_MAX = 5e8;

// BELOW this displayed TVL, the caveat is computed but NOT auto-published either.
//
// The harm the caveat prevents is a reader mistaking unverifiable TVL for a real,
// comparable figure on a ranked board — Anubis's $200M sitting next to Robinhood
// Chain's $211M as if the two meant the same thing. That mistake only exists at
// scale. A $4.2M chain (Gala) is not mistaken for a major chain, so an adverse
// public label does more harm to a real project than good to a reader who was
// never going to be misled — and the three reasons the rule fires on are all
// DefiLlama METADATA gaps ("no audit on DefiLlama" — a field the code itself
// notes is unmaintained; "no bridge identified" — Gala has a bridge DefiLlama
// doesn't index), not facts about the chain.
//
// Measured live 2026-07-17: 55 chains fire the rule; Anubis ($200.1M) is the ONLY
// one above $15.8M. A $25M floor isolates Anubis — the exact documented case this
// was built for — and stops the public label on 54 small chains (Gala, Strato,
// RISE, aelf, Verus...) that were being branded on a coverage gap. Below the
// floor the caveat still exists in the data for an agent that asks, but it is not
// auto-published to a board row, a profile, or a social card.
export const AUTO_PUBLISH_TVL_MIN = 25e6;

// DefiLlama categories that represent value bridged in from another chain. Any
// of these corroborates that the chain's assets came from somewhere checkable.
const BRIDGE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Bridge Aggregator', 'Bridge Aggregators',
]);

const list = (v) => (Array.isArray(v) ? v : []);

// DefiLlama serves `audits` as a STRING ("0", "2") — a `=== 0` check silently
// never matches. Audit links count as evidence of an audit even when the
// count is 0, since the count is frequently unmaintained.
export function protocolIsUnaudited(p) {
  if (!p) return true;
  if (list(p.audit_links).length) return false;
  return (Number(p.audits) || 0) === 0;
}

// Index every protocol's TVL by NORMALIZED chain name, once.
//
// Normalizing is load-bearing, not cosmetic: /v2/chains says "BSC" and "OP
// Mainnet" while chainTvls says "Binance" and "Optimism". Matching on the raw
// name found nothing for 19 of the 149 chains over $1M TVL — including BSC at
// $4.9B — so the rule silently could not assess them at all. norm()/ALIAS is the
// same reconciliation the Worker already applies to the DEX and fees feeds.
//
// chainTvls also carries derived keys ("Ethereum-staking", "borrowed"); those
// normalize to distinct keys of their own and so never merge into a real chain.
// Building this once also turns annotate from O(rows x protocols) into
// O(protocols + rows) — it was ~80ms and ~400k temp objects per cron tick.
export function buildChainIndex(protocols, normalize = norm) {
  const byChain = new Map();   // normKey -> [{ p, tvl }]
  const bridged = new Set();   // normKey of chains with a bridge-category protocol
  for (const p of list(protocols)) {
    if (!p) continue;
    const isBridge = BRIDGE_CATEGORIES.has(p.category);
    // Sum per normalized chain: one protocol could in principle list both an
    // alias and the canonical name, and they are the same chain.
    const per = new Map();
    const ct = p.chainTvls || {};
    for (const key in ct) {
      const v = ct[key];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue;
      const k = normalize(key);
      per.set(k, (per.get(k) || 0) + v);
    }
    for (const [k, tvl] of per) {
      let entries = byChain.get(k);
      if (!entries) { entries = []; byChain.set(k, entries); }
      entries.push({ p, tvl });
      if (isBridge) bridged.add(k);
    }
    // A bridge that lists the chain as supported corroborates it even if the
    // adapter reports no TVL there right now.
    if (isBridge) for (const c of list(p.chains)) bridged.add(normalize(c));
  }
  return { byChain, bridged };
}

// getProtocols() hands back the SAME array for 15 minutes, so rebuilding the
// index per request is pure waste (~14ms on a route that otherwise spends ~7ms).
// Keyed by array identity, so a fresh fetch is a fresh key and the index can
// never go stale. WeakMap, not a plain memo: holding the previous 8MB payload
// alive alongside the new one would roughly double peak heap against the
// Worker's 128MB ceiling. Only memoize the default normalizer — a caller-
// supplied one would make array identity the wrong key.
const _indexCache = new WeakMap();

function indexFor(protocols, opts) {
  if (opts.index) return opts.index;
  const normalize = opts.normalize || norm;
  if (normalize !== norm) return buildChainIndex(protocols, normalize);
  let index = _indexCache.get(protocols);
  if (!index) {
    index = buildChainIndex(protocols, norm);
    _indexCache.set(protocols, index);
  }
  return index;
}

// A chain "has a bridge" if any bridge-category protocol operates on it.
export function chainHasBridge(protocols, chainName, opts = {}) {
  const { bridged } = indexFor(protocols, opts);
  return bridged.has((opts.normalize || norm)(chainName));
}

// Concentration of a chain's TVL across the protocols reporting on it.
// Returns null when no protocol reports TVL — absence of data is not evidence,
// so an unknown chain must never be flagged.
export function chainConcentration(protocols, chainName, opts = {}) {
  const { byChain } = indexFor(protocols, opts);
  const on = (byChain.get((opts.normalize || norm)(chainName)) || []).slice().sort((a, b) => b.tvl - a.tvl);
  if (!on.length) return null;
  const total = on.reduce((a, x) => a + x.tvl, 0);
  if (!(total > 0)) return null;
  return {
    protocolCount: on.length,
    total,
    topProtocol: on[0].p,
    topTvl: on[0].tvl,
    topShare: +((on[0].tvl / total) * 100).toFixed(2),
  };
}

// The rule: flag a chain only when ALL THREE conditions hold. Returns null
// (no caveat) otherwise, including whenever the inputs can't support a verdict.
export function assessChainDataQuality(chainName, protocols, opts = {}) {
  const minShare = opts.concentrationMin != null ? opts.concentrationMin : CONCENTRATION_MIN;
  if (!chainName || !list(protocols).length) return null;
  const shared = { ...opts, index: indexFor(protocols, opts) };

  const conc = chainConcentration(protocols, chainName, shared);
  if (!conc) return null;
  if (conc.topShare < minShare) return null;                        // 1 — not concentrated
  if (!protocolIsUnaudited(conc.topProtocol)) return null;          // 2 — sole protocol is audited
  if (chainHasBridge(protocols, chainName, shared)) return null;    // 3 — a bridge corroborates the value

  // 4 — can we even reconcile our view with the number being annotated? If the
  // caller tells us what it displays and the totals disagree, the percentage we
  // would publish is not about that figure. No verdict.
  const displayed = Number(opts.displayedTvl);
  if (isFinite(displayed) && displayed > 0) {
    const drift = Math.abs(conc.total - displayed) / displayed * 100;
    if (drift > RECONCILE_TOLERANCE_PCT) return null;
  }

  const top = conc.topProtocol.name || 'a single protocol';
  const share = conc.topShare >= 99.95 ? '100%' : `${conc.topShare.toFixed(1)}%`;
  return {
    flag: DQ_UNVERIFIED,
    label: 'Unverified TVL',
    topProtocol: top,
    topShare: conc.topShare,
    protocolCount: conc.protocolCount,
    // Each reason is a checkable statement of fact about the source data.
    reasons: [
      `${share} of this chain's TVL sits in one protocol (${top}).`,
      `${top} reports no audit on DefiLlama.`,
      'No bridge is identified for this chain, so the value cannot be corroborated against another chain.',
    ],
    summary:
      `This chain's TVL comes almost entirely from ${top}, which reports no audit, ` +
      'and no bridge is identified for the chain. The figure therefore cannot be independently ' +
      'verified and is not comparable to bridge-verified chains. This is a note about the data, ' +
      'not an allegation about the project.',
    method: `Single-protocol share >= ${minShare}% of chain TVL, sole protocol reporting audits: 0, and no bridge-category protocol on the chain. Only published when our protocol-level total reconciles with the displayed TVL to within ${RECONCILE_TOLERANCE_PCT}%, and only automatically between $${(AUTO_PUBLISH_TVL_MIN / 1e6).toFixed(0)}M and $${(AUTO_PUBLISH_TVL_MAX / 1e6).toFixed(0)}M displayed TVL (below the floor a chain is too small to be mistaken for a real peer; above the ceiling the no-bridge premise likely fails).`,
    source: 'DefiLlama /protocols',
    // The rule's premise does not hold for native-asset/RWA chains, so a large
    // chain's caveat is computed but held for a human rather than published.
    // Auto-publish the public label only when the unverifiable TVL is large enough to be mistaken for a real peer, and not so large the premise likely fails (native-asset/RWA giants). Outside [MIN, MAX] the caveat is held.
    autoPublish: isFinite(displayed) && displayed >= AUTO_PUBLISH_TVL_MIN && displayed <= AUTO_PUBLISH_TVL_MAX,
  };
}

// Attach `dataQuality` to any row that trips the rule. Rows that don't trip it
// (and every row, when protocol data is unavailable) are left untouched.
export function annotateDataQuality(rows, protocols, opts = {}) {
  if (!list(rows).length || !list(protocols).length) return rows;
  const shared = { ...opts, index: indexFor(protocols, opts) };  // built once for the whole board
  for (const r of rows) {
    if (!r || !r.name) continue;
    // Hand the rule the figure the badge will sit beside, so it can refuse a
    // verdict it cannot reconcile with that number.
    const dq = assessChainDataQuality(r.name, protocols, { ...shared, displayedTvl: r.tvl });
    if (!dq) continue;
    if (dq.autoPublish === false) {
      // Computed, deliberately not published: above the ceiling the rule's
      // premise may not apply (native-asset/RWA), and this is a public adverse
      // claim about a named project. Log it so a human can look, rather than
      // dropping it silently or shipping it silently.
      console.error(`[data-quality] ${r.name}: tripped the unverified-TVL rule at $${Math.round(r.tvl).toLocaleString()} displayed TVL — held for review, not published. reasons=${JSON.stringify(dq.reasons)}`);
      continue;
    }
    r.dataQuality = dq;
  }
  return rows;
}
