// Test plan for the Phase-1 linking foundation (src/lib/chainkit.js).
// Each block maps to a ratified acceptance criterion / premortem guardrail:
//   G-norm  : one shared normalizer (worker ↔ chainkit parity)
//   G5      : category coverage — fails if a top chain is uncategorized; fixes applied
//   G-derive: growthepie-derived category fallback, curated wins
//   G3/M3   : coverage tier by DATA PRESENT, not rank
//   G6      : active-addresses dropped from the similarity vector
//   G3-tier : category is a HARD filter (same-category before metric), deterministic
//   G4/H3   : honest reasons — never claim un-measured similarity; low-data → category-only
//   G2/H2   : hysteresis — cold start verbatim; incumbents held unless beaten by margin
//   G1      : reproducibility — same input → identical peers
import { describe, it, expect } from 'vitest';
import {
  norm, CHAIN_CATEGORY, chainCategory, categoryLabel, deriveCategory, resolveCategory,
  coverageTier, FEATURES, MIN_BASIS, CLOSE_Z, rawFeatures, standardize, rankCandidates, applyHysteresis,
  similarChains, relatedBlock,
} from '../src/lib/chainkit.js';

// ---- G-norm : normalizer -------------------------------------------------
describe('norm / ALIAS (shared normalizer)', () => {
  it('lowercases and strips punctuation/space', () => {
    expect(norm('OP Mainnet')).toBe('opmainnet');
    expect(norm('Arbitrum One')).toBe('arbitrum'); // arbitrumone → arbitrum via ALIAS
  });
  it('applies aliases', () => {
    expect(norm('BNB')).toBe('bsc');
    expect(norm('Optimism')).toBe('opmainnet');
    expect(norm('xDai')).toBe('gnosis');
    expect(norm('zkSync Era')).toBe('zksync');
    expect(norm('AVAX')).toBe('avalanche');
  });
  it('strips a trailing l1/l2 (but not on short names)', () => {
    expect(norm('SomethingL2')).toBe('something');
    expect(norm('FooL1')).toBe('foo');
    expect(norm('L2')).toBe('l2'); // too short to strip
  });
});

// ---- G5 : category coverage ---------------------------------------------
describe('category coverage (fails if a top chain is uncategorized)', () => {
  // The chains a user is most likely to open. If any resolve to null the suite
  // fails — that's the guardrail against the taxonomy silently rotting.
  const TOP = [
    'Ethereum', 'Arbitrum', 'OP Mainnet', 'Base', 'Solana', 'BSC', 'Polygon', 'Avalanche',
    'Tron', 'Sui', 'Aptos', 'zkSync Era', 'Starknet', 'Linea', 'Scroll', 'Mantle', 'Blast',
    'Celestia', 'Ronin', 'Stacks', 'Hyperliquid', 'Monad', 'Berachain', 'Sonic', 'Unichain',
  ];
  it('every listed top chain has a category', () => {
    const uncategorized = TOP.filter((c) => chainCategory(c) == null);
    expect(uncategorized).toEqual([]);
  });
  it('premortem fixes applied: celo is an L2, polygon a sidechain, big new chains covered', () => {
    expect(chainCategory('Celo')).toBe('l2-optimistic');
    expect(chainCategory('Polygon')).toBe('evm-sidechain');
    expect(chainCategory('Hyperliquid')).toBe('l1-smart-contract');
    expect(chainCategory('Unichain')).toBe('l2-optimistic');
  });
  it('every category used has a label', () => {
    for (const cat of new Set(Object.values(CHAIN_CATEGORY))) {
      expect(categoryLabel(cat)).toBeTruthy();
    }
  });
});

// ---- G-derive : growthepie fallback -------------------------------------
describe('deriveCategory / resolveCategory', () => {
  it('maps growthepie stack/bucket to a category', () => {
    expect(deriveCategory({ stack: 'OP Stack' })).toBe('l2-optimistic');
    expect(deriveCategory({ stack: { label: 'ZK Stack' } })).toBe('l2-zk');
    expect(deriveCategory({ bucket: 'DA' })).toBe('modular-da');
    expect(deriveCategory({ bucket: 'L1' })).toBe('l1-smart-contract');
    expect(deriveCategory({ bucket: 'L2' })).toBe('l2-optimistic');
    expect(deriveCategory({})).toBeNull();
    expect(deriveCategory(null)).toBeNull();
  });
  it('curated category always wins over derived', () => {
    expect(resolveCategory('Base', 'l1-smart-contract')).toBe('l2-optimistic'); // curated base
    expect(resolveCategory('Some New Chain', 'l2-zk')).toBe('l2-zk');            // derived fills gap
    expect(resolveCategory('Some New Chain', null)).toBeNull();
  });
});

// ---- G3/M3 : coverage tier by data present ------------------------------
describe('coverageTier (by data present, not rank)', () => {
  it('full only when enriched fields/signals are actually present', () => {
    expect(coverageTier({ feeYield: 3, turnover: 0.5, pf: 20 })).toBe('full');
    expect(coverageTier({ signals: [] })).toBe('full');
    expect(coverageTier({ tvl: 1e9, feeYield: null, turnover: null, pf: null })).toBe('basic'); // enrichment failed
    expect(coverageTier({ tvl: 1e6 })).toBe('basic');
  });
});

// ---- G6 : active-addresses excluded -------------------------------------
describe('FEATURES excludes stale active-addresses', () => {
  it('lactive is not a feature', () => {
    expect(FEATURES).not.toContain('lactive');
    expect(FEATURES).toEqual(['ltvl', 'lvol', 'lfee', 'feeYield', 'turnover', 'stablesShare']);
  });
  it('two chains differing only in activeAddresses get identical vectors', () => {
    const a = { name: 'A', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 5e8, activeAddresses: 10 };
    const b = { name: 'B', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 5e8, activeAddresses: 999999 };
    const { vec } = standardize([a, b]);
    expect(vec.get('a')).toEqual(vec.get('b'));
  });
});

// ---- rawFeatures : null discipline --------------------------------------
describe('rawFeatures (absent = null, never 0)', () => {
  it('returns null for absent inputs and derives ratios when possible', () => {
    const f = rawFeatures({ tvl: 1e9, fees24h: 1e5, volume24h: 2e9, stables: 5e8 });
    expect(f.feeYield).toBeCloseTo((1e5 * 365) / 1e9 * 100, 6);
    expect(f.turnover).toBeCloseTo(2e9 / 1e9, 6);
    const bare = rawFeatures({ tvl: 1e6, fees24h: null, volume24h: null, stables: null });
    expect(bare.lfee).toBeNull();
    expect(bare.lvol).toBeNull();
    expect(bare.feeYield).toBeNull();
    expect(bare.stablesShare).toBeNull();
  });
});

// ---- G3-tier : category is a HARD filter --------------------------------
describe('rankCandidates (category is a hard tier, deterministic)', () => {
  const universe = [
    { name: 'Target', category: 'l2-optimistic', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
    { name: 'PeerA', category: 'l2-optimistic', tvl: 9e8, volume24h: 9e7, fees24h: 9e4, stables: 2.8e8 },
    { name: 'FarSameCat', category: 'l2-optimistic', tvl: 1e6, volume24h: 1e3, fees24h: 10, stables: 1e5 },
    { name: 'CloseOtherCat', category: 'l1-smart-contract', tvl: 1.01e9, volume24h: 1.01e8, fees24h: 1.01e5, stables: 3.01e8 },
  ];
  it('same-category candidates rank before metric-only ones, even when metrically farther', () => {
    const ranked = rankCandidates('Target', universe);
    const sameCatIdx = ranked.findIndex((c) => c.name === 'FarSameCat');
    const otherCatIdx = ranked.findIndex((c) => c.name === 'CloseOtherCat');
    expect(sameCatIdx).toBeLessThan(otherCatIdx); // category dominates
    expect(ranked[0].name).toBe('PeerA'); // nearest same-category first
  });
  it('unknown-category target → all peers are metric matches', () => {
    const u = universe.map((c) => ({ ...c, category: null }));
    const ranked = rankCandidates('Target', u);
    expect(ranked.every((c) => c.matchType === 'metric')).toBe(true);
  });
  it('is deterministic regardless of input order', () => {
    const a = rankCandidates('Target', universe).map((c) => c.key);
    const b = rankCandidates('Target', [...universe].reverse()).map((c) => c.key);
    expect(a).toEqual(b);
  });
});

// ---- G4/H3 : honest reasons ---------------------------------------------
describe('honest reasons (never claim un-measured similarity)', () => {
  it('a low-data same-category peer says "limited data", never "similar metrics"', () => {
    const chains = [
      { name: 'Target', category: 'bitcoin-l2', tvl: 1e8, volume24h: 1e6, fees24h: 1e3, stables: 1e6 },
      { name: 'BareBtc', category: 'bitcoin-l2', tvl: 5e7, volume24h: null, fees24h: null, stables: null },
    ];
    const [peer] = similarChains('Target', chains, { k: 3 });
    expect(peer.name).toBe('BareBtc');
    expect(peer.lowConfidence).toBe(true);
    expect(peer.reason).toMatch(/limited data/i);
    expect(peer.reason).not.toMatch(/fee yield|turnover|volume/i);
    expect(peer.basis).not.toContain('feeYield'); // imputed feature never in basis
  });
  it('a well-measured metric peer names only co-measured features', () => {
    const chains = [
      { name: 'T', category: null, tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'U', category: null, tvl: 8e8, volume24h: 9e7, fees24h: 9e4, stables: 2.5e8 },
    ];
    const [peer] = similarChains('T', chains, { k: 3 });
    expect(peer.matchType).toBe('metric');
    expect(peer.reason).toMatch(/^Similar /);
    expect(peer.lowConfidence).toBe(false);
  });
  it('drops a low-data candidate of a DIFFERENT category (can\'t honestly relate)', () => {
    const chains = [
      { name: 'T', category: 'l2-zk', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'MysteryBare', category: 'payments', tvl: 5e7, volume24h: null, fees24h: null, stables: null },
    ];
    const peers = similarChains('T', chains, { k: 5 });
    expect(peers.find((p) => p.name === 'MysteryBare')).toBeUndefined();
  });
});

// ---- G2/H2 : hysteresis --------------------------------------------------
describe('applyHysteresis (peer stability across refreshes)', () => {
  const ranked = [
    { key: 'a', sameCategory: true, distance: 0.10 },
    { key: 'b', sameCategory: true, distance: 0.20 },
    { key: 'c', sameCategory: true, distance: 0.30 },
    { key: 'd', sameCategory: true, distance: 0.32 }, // just behind c
  ];
  it('cold start (no prior) returns fresh top-k verbatim', () => {
    expect(applyHysteresis(ranked, [], 3, 0.05).map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(applyHysteresis(ranked, null, 3, 0.05).map((c) => c.key)).toEqual(['a', 'b', 'c']);
  });
  it('holds an incumbent that a challenger only narrowly beats', () => {
    // prior list had d; fresh top-3 is a,b,c. d (0.32) vs weakest non-incumbent c (0.30):
    // similarity gap is tiny (< margin) → keep incumbent d.
    const out = applyHysteresis(ranked, ['a', 'b', 'd'], 3, 0.2).map((c) => c.key);
    expect(out).toContain('d');
  });
  it('lets a clearly-better challenger displace an incumbent', () => {
    const ranked2 = [
      { key: 'a', sameCategory: true, distance: 0.05 },
      { key: 'b', sameCategory: true, distance: 0.10 },
      { key: 'x', sameCategory: true, distance: 0.15 }, // strong new challenger
      { key: 'old', sameCategory: true, distance: 0.95 }, // incumbent now far
    ];
    const out = applyHysteresis(ranked2, ['a', 'b', 'old'], 3, 0.05).map((c) => c.key);
    expect(out).toEqual(['a', 'b', 'x']); // old displaced by a clear win
  });
});

// ---- review findings : adversarial regression tests ---------------------
describe('review fixes (adversarial)', () => {
  it('H1: a FAR same-category peer says "same category", never "close on"', () => {
    const universe = [
      { name: 'Target', category: 'l2-optimistic', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'PeerNear', category: 'l2-optimistic', tvl: 9e8, volume24h: 9e7, fees24h: 9e4, stables: 2.9e8 },
      { name: 'FarSameCat', category: 'l2-optimistic', tvl: 1e6, volume24h: 1e3, fees24h: 10, stables: 1e5 },
    ];
    const peers = similarChains('Target', universe, { k: 5 });
    const far = peers.find((p) => p.name === 'FarSameCat');
    expect(far).toBeTruthy();
    expect(far.reason).not.toMatch(/close on/i); // was the honesty bug
    expect(far.reason).toMatch(/same category/i);
  });
  it('H2: a NaN/Infinity metric is treated as absent (null), never a measured 0', () => {
    const f = rawFeatures({ tvl: 1e9, fees24h: 1e5, volume24h: NaN, stables: Infinity });
    expect(f.lvol).toBeNull();
    expect(f.stablesShare).toBeNull();
    // and it must not enter the basis / claim similarity
    const chains = [
      { name: 'A', category: null, tvl: 1e9, volume24h: NaN, fees24h: 1e5, stables: 3e8 },
      { name: 'B', category: null, tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
    ];
    const [peer] = similarChains('A', chains, { k: 2 });
    expect(peer.basis).not.toContain('lvol');
  });
  it('M4: names that normalize to the same key do not produce duplicate peers', () => {
    const universe = [
      { name: 'Target', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'Optimism', tvl: 2e9, volume24h: 8e8, fees24h: 2e5, stables: 2e9 },
      { name: 'OP Mainnet', tvl: 2e9, volume24h: 8e8, fees24h: 2e5, stables: 2e9 }, // → same key
    ];
    const peers = similarChains('Target', universe, { k: 6 });
    const keys = peers.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length); // no dupes
  });
  it('M5: k:0 returns zero peers (not the default 6)', () => {
    const universe = [
      { name: 'Target', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'X', tvl: 9e8, volume24h: 9e7, fees24h: 9e4, stables: 2.9e8 },
    ];
    expect(similarChains('Target', universe, { k: 0 })).toEqual([]);
  });
  it('M3: match and label use the same (curated) category when the row disagrees', () => {
    // row claims payments, but curated says Base is an L2 → curated must win for both
    const universe = [
      { name: 'Base', category: 'payments', tvl: 4e9, volume24h: 1.2e9, fees24h: 4e5, stables: 4e9 },
      { name: 'Arbitrum', category: 'l2-optimistic', tvl: 3e9, volume24h: 1e9, fees24h: 3e5, stables: 3e9 },
    ];
    const block = relatedBlock('Base', universe, { k: 3 });
    expect(block.category).toBe('l2-optimistic'); // curated wins
    const arb = block.peers.find((p) => p.name === 'Arbitrum');
    expect(arb.sameCategory).toBe(true); // matched on the same curated category
  });
  it('edge: a target absent from the set returns no peers (even with a prior)', () => {
    const universe = [{ name: 'A', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 }];
    expect(similarChains('NotHere', universe, { k: 6, prior: ['a'] })).toEqual([]);
  });
  it('edge: returns fewer than k when fewer valid candidates exist', () => {
    const universe = [
      { name: 'Target', tvl: 1e9, volume24h: 1e8, fees24h: 1e5, stables: 3e8 },
      { name: 'Only', tvl: 9e8, volume24h: 9e7, fees24h: 9e4, stables: 2.9e8 },
    ];
    expect(similarChains('Target', universe, { k: 6 }).length).toBe(1);
  });
  it('hysteresis is idempotent — feeding its own output back as prior yields the same list', () => {
    const universe = [
      { name: 'Ethereum', tvl: 6e10, volume24h: 2e9, fees24h: 5e6, stables: 8e10 },
      { name: 'Arbitrum', tvl: 3e9, volume24h: 1e9, fees24h: 3e5, stables: 3e9 },
      { name: 'Base', tvl: 4e9, volume24h: 1.2e9, fees24h: 4e5, stables: 4e9 },
      { name: 'Optimism', tvl: 2e9, volume24h: 8e8, fees24h: 2e5, stables: 2e9 },
    ];
    const first = similarChains('Arbitrum', universe, { k: 3 });
    const second = similarChains('Arbitrum', universe, { k: 3, prior: first.map((p) => p.key) });
    expect(second.map((p) => p.key)).toEqual(first.map((p) => p.key)); // no oscillation
  });
  it('CLOSE_Z is the axis-closeness threshold', () => {
    expect(CLOSE_Z).toBeGreaterThan(0);
  });
});

// ---- G1 : reproducibility -----------------------------------------------
describe('relatedBlock / reproducibility', () => {
  const universe = [
    { name: 'Ethereum', tvl: 6e10, volume24h: 2e9, fees24h: 5e6, stables: 8e10 },
    { name: 'Arbitrum', tvl: 3e9, volume24h: 1e9, fees24h: 3e5, stables: 3e9 },
    { name: 'Base', tvl: 4e9, volume24h: 1.2e9, fees24h: 4e5, stables: 4e9 },
    { name: 'Optimism', tvl: 2e9, volume24h: 8e8, fees24h: 2e5, stables: 2e9 },
    { name: 'Solana', tvl: 8e9, volume24h: 3e9, fees24h: 1e6, stables: 5e9 },
  ];
  it('returns a stable shape and identical peers on repeat calls', () => {
    const a = relatedBlock('Arbitrum', universe, { k: 3 });
    const b = relatedBlock('Arbitrum', universe, { k: 3 });
    expect(a.category).toBe('l2-optimistic');
    expect(a.categoryLabel).toBeTruthy();
    expect(a.peers.length).toBeGreaterThan(0);
    expect(a.peers.length).toBeLessThanOrEqual(3);
    expect(a).toEqual(b); // deterministic
    for (const p of a.peers) expect(p.reason).toBeTruthy();
  });
  it('MIN_BASIS is the metric-similarity threshold', () => {
    expect(MIN_BASIS).toBe(2);
  });
});
