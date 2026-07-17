import { describe, it, expect } from 'vitest';
import {
  DQ_UNVERIFIED,
  protocolIsUnaudited,
  chainHasBridge,
  chainConcentration,
  assessChainDataQuality,
  annotateDataQuality,
  buildChainIndex,
} from '../src/lib/data-quality.js';

// A chain's headline TVL is only comparable to its neighbours if the figure is
// independently checkable. This rule marks a chain UNVERIFIED when all three
// hold: (1) ~100% of its TVL sits in a single protocol, (2) that protocol
// reports no audit, and (3) no bridge is identified for the chain. It is a
// data-quality caveat, NOT an accusation — no wrongdoing is implied.

// Shapes mirror the real DefiLlama /protocols payload: `audits` is a STRING.
const rocketswap = { name: 'RocketSwap Anubis', category: 'Dexs', audits: '0', audit_links: null, chains: ['Anubis'], chainTvls: { Anubis: 200176732 } };
const morpho = { name: 'Morpho Blue', category: 'Lending', audits: '2', audit_links: ['https://docs.morpho.org/audits'], chains: ['Robinhood Chain'], chainTvls: { 'Robinhood Chain': 135979146 } };
const uniV3 = { name: 'Uniswap V3', category: 'Dexs', audits: '2', audit_links: ['https://github.com/Uniswap/audits'], chains: ['Robinhood Chain'], chainTvls: { 'Robinhood Chain': 23355478 } };
const lighter = { name: 'Lighter Bridge', category: 'Bridge', audits: '0', audit_links: null, chains: ['Robinhood Chain'], chainTvls: { 'Robinhood Chain': 90000000 } };

describe('protocolIsUnaudited', () => {
  it('treats the string "0" (DefiLlama\'s real shape) as unaudited', () => {
    expect(protocolIsUnaudited(rocketswap)).toBe(true);
  });

  it('treats a positive audit count as audited', () => {
    expect(protocolIsUnaudited(morpho)).toBe(false);
    expect(protocolIsUnaudited({ audits: 2 })).toBe(false); // numeric shape too
  });

  it('treats audit_links as evidence of an audit even when the count is 0', () => {
    expect(protocolIsUnaudited({ audits: '0', audit_links: ['https://example.com/audit'] })).toBe(false);
  });

  it('treats a missing/null audits field as unaudited', () => {
    expect(protocolIsUnaudited({ name: 'x' })).toBe(true);
    expect(protocolIsUnaudited({ audits: null })).toBe(true);
  });
});

describe('chainHasBridge', () => {
  it('is true when a bridge-category protocol operates on the chain', () => {
    expect(chainHasBridge([morpho, lighter], 'Robinhood Chain')).toBe(true);
  });

  it('is false when no bridge-category protocol references the chain', () => {
    expect(chainHasBridge([rocketswap], 'Anubis')).toBe(false);
  });

  it('does not count a bridge that merely lists the chain with zero TVL and no membership', () => {
    const ghost = { name: 'Ghost Bridge', category: 'Bridge', chains: ['Other'], chainTvls: { Other: 5 } };
    expect(chainHasBridge([ghost], 'Anubis')).toBe(false);
  });
});

describe('chainConcentration', () => {
  it('reports 100% and the sole protocol for a single-protocol chain', () => {
    const c = chainConcentration([rocketswap], 'Anubis');
    expect(c.protocolCount).toBe(1);
    expect(c.topShare).toBe(100);
    expect(c.topProtocol.name).toBe('RocketSwap Anubis');
  });

  it('reports the dominant share for a diversified chain', () => {
    const c = chainConcentration([morpho, uniV3, lighter], 'Robinhood Chain');
    expect(c.protocolCount).toBe(3);
    expect(c.topShare).toBeLessThan(99);
  });

  it('returns null when the chain has no protocols (absence of data is not evidence)', () => {
    expect(chainConcentration([], 'Nowhere')).toBeNull();
  });
});

describe('assessChainDataQuality', () => {
  it('flags a chain meeting ALL THREE conditions', () => {
    const dq = assessChainDataQuality('Anubis', [rocketswap]);
    expect(dq).not.toBeNull();
    expect(dq.flag).toBe(DQ_UNVERIFIED);
    expect(dq.topProtocol).toBe('RocketSwap Anubis');
    expect(dq.topShare).toBe(100);
    expect(dq.reasons).toHaveLength(3);
    expect(dq.label).toMatch(/unverified/i);
  });

  it('does NOT flag a diversified chain with audited protocols and a bridge', () => {
    expect(assessChainDataQuality('Robinhood Chain', [morpho, uniV3, lighter])).toBeNull();
  });

  it('does NOT flag a concentrated chain whose sole protocol IS audited (condition 2 fails)', () => {
    const audited = { ...rocketswap, name: 'Audited Swap', audits: '2', audit_links: ['https://a/audit'] };
    expect(assessChainDataQuality('Anubis', [audited])).toBeNull();
  });

  it('does NOT flag a concentrated unaudited chain that HAS a bridge (condition 3 fails)', () => {
    const bridged = { name: 'B', category: 'Canonical Bridge', audits: '0', chains: ['Anubis'], chainTvls: { Anubis: 1 } };
    // Concentration stays >=99% (bridge TVL is negligible) but a bridge exists.
    const dq = assessChainDataQuality('Anubis', [rocketswap, bridged]);
    expect(dq).toBeNull();
  });

  it('does NOT flag when protocol data is unavailable', () => {
    expect(assessChainDataQuality('Anubis', [])).toBeNull();
    expect(assessChainDataQuality('Anubis', null)).toBeNull();
  });

  it('never asserts wrongdoing — the caveat is strictly about verifiability', () => {
    const dq = assessChainDataQuality('Anubis', [rocketswap]);
    const text = (dq.label + ' ' + dq.summary + ' ' + dq.reasons.join(' ')).toLowerCase();
    for (const word of ['fraud', 'scam', 'fake', 'criminal', 'launder', 'steal', 'rug']) {
      expect(text).not.toContain(word);
    }
  });
});

// Regression: /v2/chains says "BSC"/"OP Mainnet" while chainTvls says
// "Binance"/"Optimism". Matching the raw name found nothing for 19 of the 149
// chains over $1M TVL (BSC at $4.9B among them), so the rule silently could not
// assess them — a false negative that looked exactly like "chain is fine".
describe('chain-name normalization (feeds disagree on names)', () => {
  const onBinance = { name: 'PancakeSwap', category: 'Dexs', audits: '2', chains: ['Binance'], chainTvls: { Binance: 100 } };

  it('resolves an aliased chainTvls key to the /v2/chains name', () => {
    const c = chainConcentration([onBinance], 'BSC');
    expect(c).not.toBeNull();
    expect(c.topProtocol.name).toBe('PancakeSwap');
  });

  it('resolves OP Mainnet <- Optimism', () => {
    const p = { name: 'Velodrome', category: 'Dexs', audits: '2', chains: ['Optimism'], chainTvls: { Optimism: 50 } };
    expect(chainConcentration([p], 'OP Mainnet')).not.toBeNull();
  });

  it('counts a bridge listed under an alias', () => {
    const br = { name: 'B', category: 'Canonical Bridge', chains: ['Optimism'], chainTvls: { Optimism: 5 } };
    expect(chainHasBridge([br], 'OP Mainnet')).toBe(true);
  });

  it('does NOT merge derived chainTvls keys into the real chain', () => {
    const p = { name: 'X', category: 'Lending', audits: '0', chains: ['Ethereum'], chainTvls: { Ethereum: 100, 'Ethereum-borrowed': 900, staking: 500 } };
    const c = chainConcentration([p], 'Ethereum');
    expect(c.total).toBe(100); // borrowed/staking must not inflate the chain total
  });

  it('sums keys that normalize to the same chain rather than dropping one', () => {
    const p = { name: 'X', category: 'Dexs', audits: '0', chains: ['BSC'], chainTvls: { BSC: 60, Binance: 40 } };
    expect(chainConcentration([p], 'BSC').total).toBe(100);
  });
});

describe('buildChainIndex', () => {
  it('indexes by normalized chain and marks bridged chains', () => {
    const { byChain, bridged } = buildChainIndex([rocketswap, lighter]);
    expect(byChain.get('anubis')).toHaveLength(1);
    expect(bridged.has('robinhoodchain')).toBe(true);
    expect(bridged.has('anubis')).toBe(false);
  });

  // The index is memoized on the protocols array identity. getProtocols() swaps
  // in a NEW array every 15 min, so a refresh must never be served a stale index.
  it('a different protocols array is never served a stale memoized index', () => {
    expect(assessChainDataQuality('Anubis', [rocketswap])).not.toBeNull();
    const audited = [{ ...rocketswap, audits: '3', audit_links: ['https://a/audit'] }];
    expect(assessChainDataQuality('Anubis', audited)).toBeNull(); // fresh array -> re-evaluated
  });

  it('a prebuilt index produces the same verdict as passing raw protocols', () => {
    const index = buildChainIndex([rocketswap]);
    const viaIndex = assessChainDataQuality('Anubis', [rocketswap], { index });
    const viaRaw = assessChainDataQuality('Anubis', [rocketswap]);
    expect(viaIndex).toEqual(viaRaw);
  });
});

describe('annotateDataQuality', () => {
  it('attaches dataQuality to matching rows and leaves clean rows untouched', () => {
    const rows = [
      { name: 'Anubis', tvl: 200176732 },
      { name: 'Robinhood Chain', tvl: 211643726 },
    ];
    annotateDataQuality(rows, [rocketswap, morpho, uniV3, lighter]);
    expect(rows[0].dataQuality.flag).toBe(DQ_UNVERIFIED);
    expect(rows[1].dataQuality).toBeUndefined();
  });

  it('is a no-op when protocols are unavailable (never invents a flag)', () => {
    const rows = [{ name: 'Anubis', tvl: 1 }];
    annotateDataQuality(rows, null);
    expect(rows[0].dataQuality).toBeUndefined();
  });
});
