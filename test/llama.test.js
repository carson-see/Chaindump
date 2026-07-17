import { describe, it, expect } from 'vitest';
import { DEX_CATEGORIES, aggregateBreakdown, feedIsDegenerate, selectCandidates, dedupeChains } from '../src/lib/llama.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Shaped from the real /overview/dexs payload measured on 2026-07-17. These are
// the actual protocols and figures that produced Injective's 16x overstatement.
const INJECTIVE_FEED = {
  protocols: [
    { name: 'Helix Spot', category: 'Dexs', breakdown24h: { Injective: { 'Helix Spot': 83134 } } },
    { name: 'Injective Spot', category: 'Dexs', breakdown24h: { Injective: { 'Injective Spot': 199830 } } },
    { name: 'TrueCurrent', category: 'Derivatives', breakdown24h: { Injective: { TrueCurrent: 2931638 } } },
    { name: 'Ninja Blaze', category: 'Prediction Market', breakdown24h: { Injective: { 'Ninja Blaze': 434 } } },
  ],
};

describe('aggregateBreakdown', () => {
  it('sums per-protocol breakdowns by normalized chain name', () => {
    const out = aggregateBreakdown(INJECTIVE_FEED, norm);
    expect(out.injective).toBe(83134 + 199830 + 2931638 + 434);
  });

  it('excludes non-DEX categories when asked — the Injective 16x bug', () => {
    const out = aggregateBreakdown(INJECTIVE_FEED, norm, { categories: DEX_CATEGORIES });
    // Derivatives ($2.93M, 91% of the old total) and Prediction Market are gone.
    expect(out.injective).toBe(83134 + 199830);
    const unfiltered = aggregateBreakdown(INJECTIVE_FEED, norm).injective;
    expect(unfiltered / out.injective).toBeGreaterThan(11);
  });

  it('does not count aggregators, NFT marketplaces, card issuers or TCGs as DEX volume', () => {
    for (const category of ['DEX Aggregator', 'NFT Marketplace', 'Crypto Card Issuer', 'Physical TCG', 'Telegram Bot', 'Derivatives']) {
      expect(DEX_CATEGORIES.has(category)).toBe(false);
    }
    expect(DEX_CATEGORIES.has('Dexs')).toBe(true);
  });

  it('counts an UNCATEGORIZED protocol rather than silently zeroing the chain', () => {
    // If DefiLlama renames or drops `category`, an include-only filter would
    // zero every chain's volume axis at once. Unknown != excluded.
    const feed = { protocols: [{ name: 'Mystery', breakdown24h: { Base: { m: 42 } } }] };
    expect(aggregateBreakdown(feed, norm, { categories: DEX_CATEGORIES }).base).toBe(42);
  });

  it('still excludes a protocol whose category is KNOWN and non-DEX', () => {
    const feed = { protocols: [{ name: 'Perps', category: 'Derivatives', breakdown24h: { Base: { p: 999 } } }] };
    expect(aggregateBreakdown(feed, norm, { categories: DEX_CATEGORIES }).base).toBeUndefined();
  });

  it('skips off_chain and protocols with no breakdown', () => {
    const feed = { protocols: [
      { name: 'A', category: 'Dexs', breakdown24h: { off_chain: { A: 999 }, Base: { A: 10 } } },
      { name: 'B', category: 'Dexs' },
    ] };
    const out = aggregateBreakdown(feed, norm, { categories: DEX_CATEGORIES });
    expect(out.base).toBe(10);
    expect(out.offchain).toBeUndefined();
  });

  it('tolerates junk values and a missing payload', () => {
    const feed = { protocols: [{ name: 'A', category: 'Dexs', breakdown24h: { Base: { x: 'nope', y: null, z: 5 } } }] };
    expect(aggregateBreakdown(feed, norm, { categories: DEX_CATEGORIES }).base).toBe(5);
    expect(aggregateBreakdown(null, norm)).toEqual({});
    expect(aggregateBreakdown({}, norm)).toEqual({});
  });

  it('keeps every category when no filter is given (fees are chain-wide, not one product)', () => {
    const fees = { protocols: [
      { name: 'Chain fees', category: 'Chain', breakdown24h: { Base: { c: 100 } } },
      { name: 'A dex', category: 'Dexs', breakdown24h: { Base: { d: 5 } } },
    ] };
    expect(aggregateBreakdown(fees, norm).base).toBe(105);
  });
});

describe('feedIsDegenerate', () => {
  it('flags an empty aggregate against a real universe — a dead 50% axis', () => {
    expect(feedIsDegenerate({}, 458)).toBe(true);
  });

  it('does not flag a healthy aggregate, or an empty universe', () => {
    expect(feedIsDegenerate({ base: 1 }, 458)).toBe(false);
    expect(feedIsDegenerate({}, 0)).toBe(false);
  });
});

describe('selectCandidates', () => {
  // The regression that matters: the TVL feed says "Hyperliquid L1", the DEX
  // breakdown says "hyperliquid", so volume reads 0 and the provisional score
  // buries it. It must still be enriched, or it can never be corrected.
  const rows = [
    { name: 'Ethereum', score: 0.99, tvl: 60e9, volume24h: 1.1e9, fees24h: 5e6 },
    { name: 'Solana', score: 0.95, tvl: 9e9, volume24h: 1.5e9, fees24h: 3e6 },
    ...Array.from({ length: 60 }, (_, i) => ({
      name: `Filler${i}`, score: 0.9 - i * 0.01, tvl: 1e9 - i * 1e6, volume24h: 1e8, fees24h: 1e5,
    })),
    // Zeroed on volume by the name mismatch → provisional score is last.
    { name: 'Hyperliquid L1', score: 0.30, tvl: 1.27e9, volume24h: 0, fees24h: 9e5 },
  ];

  it('rescues a chain zeroed on volume by selecting on TVL too', () => {
    const picked = selectCandidates(rows, { boardSize: 5, scoreBuffer: 2, axisTop: 10 });
    const names = picked.map((r) => r.name);
    expect(names).toContain('Hyperliquid L1');   // enters on TVL, not score
    expect(names).not.toContain('Filler59');     // genuinely small on every axis
  });

  it('would MISS that chain if candidates were chosen by score alone', () => {
    const byScoreOnly = [...rows].sort((a, b) => b.score - a.score).slice(0, 7);
    expect(byScoreOnly.map((r) => r.name)).not.toContain('Hyperliquid L1');
  });

  it('returns a superset of the board and never duplicates a chain', () => {
    const picked = selectCandidates(rows, { boardSize: 10, scoreBuffer: 5, axisTop: 10 });
    expect(picked.length).toBeGreaterThan(10);
    expect(new Set(picked.map((r) => r.name)).size).toBe(picked.length);
  });

  it('handles a universe smaller than the board without inventing rows', () => {
    const tiny = [{ name: 'A', score: 1, tvl: 1, volume24h: 1, fees24h: 1 }];
    expect(selectCandidates(tiny, { boardSize: 50 })).toHaveLength(1);
  });
});

// Real duplicates measured in DefiLlama's /v2/chains on 2026-07-17. Both aliases
// carry $0 TVL, and two-pass enrichment hands them the real chain's DEX volume —
// so without this the board lists the same chain twice, the ghost ranking higher.
describe('dedupeChains', () => {
  const BSC = { name: 'BSC', chainId: 56, tvl: 4.867e9 };
  const BINANCE = { name: 'Binance', chainId: 56, tvl: 0 };
  const OP = { name: 'OP Mainnet', chainId: 10, tvl: 2.903e8 };
  const OPTIMISM = { name: 'Optimism', chainId: 10, tvl: 0 };

  it('keeps the real chain and drops the $0 alias', () => {
    const out = dedupeChains([BINANCE, BSC, OPTIMISM, OP]);
    const names = out.map((r) => r.name).sort();
    expect(names).toEqual(['BSC', 'OP Mainnet']);
  });

  it('leaves one entry per duplicated chainId — no chain appears twice', () => {
    const out = dedupeChains([BSC, BINANCE, OP, OPTIMISM]);
    const ids = out.map((r) => r.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never drops chains that have no chainId (Solana, Bitcoin, Tron...)', () => {
    const rows = [{ name: 'Solana', chainId: null, tvl: 9e9 }, { name: 'Bitcoin', chainId: null, tvl: 1e9 }, BSC];
    expect(dedupeChains(rows)).toHaveLength(3);
  });

  it('never merges two DIFFERENT chains that share a name shape but not a chainId', () => {
    const rows = [{ name: 'Base', chainId: 8453, tvl: 4e9 }, { name: 'Base', chainId: 1, tvl: 1e9 }];
    expect(dedupeChains(rows)).toHaveLength(2);
  });

  it('is deterministic when both duplicates are empty — never reorders at random', () => {
    const a = { name: 'Binance', chainId: 56, tvl: 0 };
    const b = { name: 'BSC', chainId: 56, tvl: 0 };
    expect(dedupeChains([a, b])[0].name).toBe('BSC');
    expect(dedupeChains([b, a])[0].name).toBe('BSC');   // input order must not matter
  });

  it('passes a clean universe through untouched', () => {
    const rows = [BSC, OP, { name: 'Solana', chainId: null, tvl: 9e9 }];
    expect(dedupeChains(rows)).toHaveLength(3);
  });
});
