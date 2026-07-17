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

export const DQ_UNVERIFIED = 'unverified_tvl';

// Share of chain TVL in the single largest protocol, at/above which the chain's
// TVL is "effectively one contract". 99 (not 100) tolerates dust from a second
// adapter without changing the conclusion.
export const CONCENTRATION_MIN = 99;

// DefiLlama categories that represent value bridged in from another chain. Any
// of these corroborates that the chain's assets came from somewhere checkable.
const BRIDGE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Bridge Aggregator', 'Bridge Aggregators',
]);

const list = (v) => (Array.isArray(v) ? v : []);

// TVL a protocol reports on exactly this chain. chainTvls also carries derived
// keys ("Ethereum-staking", "-borrowed"); an exact chain-name match skips those.
function tvlOnChain(p, chainName) {
  const v = p && p.chainTvls && p.chainTvls[chainName];
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}

// DefiLlama serves `audits` as a STRING ("0", "2") — a `=== 0` check silently
// never matches. Audit links count as evidence of an audit even when the
// count is 0, since the count is frequently unmaintained.
export function protocolIsUnaudited(p) {
  if (!p) return true;
  if (list(p.audit_links).length) return false;
  return (Number(p.audits) || 0) === 0;
}

// A chain "has a bridge" if any bridge-category protocol actually operates on
// it — either reporting TVL there or listing it as a supported chain.
export function chainHasBridge(protocols, chainName) {
  return list(protocols).some(
    (p) => p && BRIDGE_CATEGORIES.has(p.category) &&
      (tvlOnChain(p, chainName) > 0 || list(p.chains).includes(chainName)),
  );
}

// Concentration of a chain's TVL across the protocols reporting on it.
// Returns null when no protocol reports TVL — absence of data is not evidence,
// so an unknown chain must never be flagged.
export function chainConcentration(protocols, chainName) {
  const on = list(protocols)
    .map((p) => ({ p, tvl: tvlOnChain(p, chainName) }))
    .filter((x) => x.tvl > 0)
    .sort((a, b) => b.tvl - a.tvl);
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

  const conc = chainConcentration(protocols, chainName);
  if (!conc) return null;
  if (conc.topShare < minShare) return null;                 // 1 — not concentrated
  if (!protocolIsUnaudited(conc.topProtocol)) return null;   // 2 — sole protocol is audited
  if (chainHasBridge(protocols, chainName)) return null;     // 3 — a bridge corroborates the value

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
    method: `Single-protocol share >= ${minShare}% of chain TVL, sole protocol reporting audits: 0, and no bridge-category protocol on the chain.`,
    source: 'DefiLlama /protocols',
  };
}

// Attach `dataQuality` to any row that trips the rule. Rows that don't trip it
// (and every row, when protocol data is unavailable) are left untouched.
export function annotateDataQuality(rows, protocols, opts = {}) {
  if (!list(rows).length || !list(protocols).length) return rows;
  for (const r of rows) {
    if (!r || !r.name) continue;
    const dq = assessChainDataQuality(r.name, protocols, opts);
    if (dq) r.dataQuality = dq;
  }
  return rows;
}
