// Route-level test for classifyChains()'s failure handling.
//
// Why this exists: on a fetch failure, the per-chain historicalChainTvl series
// came back empty, which set `peak = cur` and therefore `drawdown_pct = 0` —
// "currently at its all-time peak." A chain we had PREVIOUSLY measured as
// ~98% down from peak (onBoard + collapsedFromPeak => 'zombie', per
// scoring.js's classifyTier) would flip back to 'thriving' for one cycle on a
// transient DefiLlama hiccup, with the error silently swallowed. That's a
// live, reputational false-positive risk (the Berachain case this file's
// fixture is modeled on) driven purely by network flakiness, not by the
// chain's actual TVL.
import { describe, it, expect, afterEach, vi } from 'vitest';

async function freshTiersModule() {
  vi.resetModules();
  return import('../src/worker.js');
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// A small universe: Berachain (the chain under test) plus enough fillers to
// give buildSnapshot a board to compute, so Berachain lands in the top 50 and
// counts as "onBoard".
const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
  { name: 'Berachain', tvl: 1e9, tokenSymbol: 'BERA', gecko_id: 'berachain', chainId: 80094 },
  ...Array.from({ length: 50 }, (_, i) => ({ name: `Filler${i}`, tvl: 1e7 - i * 1e4, tokenSymbol: null, gecko_id: null, chainId: 900000 + i })),
];
const fill = (m) => ({ ...m, ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Filler${i}`, 1e5 - i * 1e2])) });
const overviewFor = (perChain) => ({
  protocols: Object.entries(perChain).map(([chain, v], i) => ({
    name: `P${i}`, category: 'Dexs', breakdown24h: { [chain]: { [`P${i}`]: v } },
  })),
});

const DAY = 86400;
// 49-day series (>= DEAD_MIN_SPAN_DAYS=45): peaks at 5e10, ends near today's
// live TVL (1e9) — a genuine ~98% collapse, same magnitude as the real
// Berachain TVL-vs-ATH gap this classifier exists to catch.
function beraCollapseSeries() {
  const start = 1_700_000_000;
  return Array.from({ length: 50 }, (_, i) => ({ date: start + i * DAY, tvl: i === 0 ? 5e10 : 1e9 }));
}

function stubFeed({ beraHistoryFails = false } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/v2/historicalChainTvl/Berachain')) {
      return beraHistoryFails ? new Response('', { status: 500 }) : json(beraCollapseSeries());
    }
    if (u.includes('/v2/historicalChainTvl/')) return json([]); // no history for fillers/Ethereum — fine, not under test
    if (u.includes('/v2/chains')) return json(UNIVERSE);
    if (u.includes('/overview/dexs?')) return json(overviewFor(fill({ Ethereum: 1.1e9, Berachain: 2e7 })));
    if (u.includes('/overview/fees?')) return json(overviewFor(fill({ Ethereum: 5e6, Berachain: 1e4 })));
    if (u.includes('/overview/dexs/') || u.includes('/overview/fees/')) return json({ total24h: 1 });
    return new Response('', { status: 500 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('classifyChains — fetch-failure handling', () => {
  it('a transient historicalChainTvl failure does not erase a chain\'s known collapse', async () => {
    stubFeed({ beraHistoryFails: false });
    const { classifyChains, priorMetricsByChain } = await freshTiersModule();

    const first = await classifyChains({});
    const beforeBera = [...first.zombie, ...first.dead, ...first.thriving].find((m) => m.chain === 'Berachain');
    expect(beforeBera).toBeTruthy();
    expect(beforeBera.drawdown_pct).toBeGreaterThanOrEqual(90); // genuinely collapsed
    expect(first.thriving.some((m) => m.chain === 'Berachain')).toBe(false); // NOT mislabeled thriving

    // Next cycle: the deep-history fetch for Berachain fails (network hiccup).
    // Everything else about the chain (today's live TVL) is unaffected.
    stubFeed({ beraHistoryFails: true });
    const prior = priorMetricsByChain(first);
    const second = await classifyChains(prior);

    const afterBera = [...second.zombie, ...second.dead].find((m) => m.chain === 'Berachain');
    expect(afterBera).toBeTruthy(); // still classified as collapsed, not silently dropped
    expect(afterBera.drawdown_pct).toBeGreaterThanOrEqual(90); // NOT reset to 0
    expect(second.thriving.some((m) => m.chain === 'Berachain')).toBe(false); // did NOT flip to thriving
  });

  it('a brand-new chain with no history yet (never a failure) is unaffected', async () => {
    stubFeed({ beraHistoryFails: false });
    const { classifyChains } = await freshTiersModule();
    const first = await classifyChains({}); // no prior data for anything
    const bera = [...first.zombie, ...first.dead, ...first.thriving].find((m) => m.chain === 'Berachain');
    expect(bera).toBeTruthy();
    expect(bera.drawdown_pct).toBeGreaterThanOrEqual(90);
  });
});
