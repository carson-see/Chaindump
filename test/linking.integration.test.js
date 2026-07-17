// Route-level integration test for the chain-linking wiring in worker.js.
// Boots the real Hono app and drives /api/chains with a stubbed DefiLlama feed:
// /v2/chains returns a small universe, and the volume/fee overviews return small
// healthy payloads. Everything else 500s so buildSnapshot falls back to its
// best-effort defaults (no network).
//
// NOTE: this test used to 500 the dexs/fees overviews too, and asserted the board
// built anyway. That was asserting a bug: an empty volume aggregate contributes
// zero to EVERY chain, so the board silently re-ranks on TVL+fees alone while the
// API keeps publishing "50% 24h DEX volume" as the formula. buildSnapshot now
// refuses to build on a dead feed (see the degraded-feed test at the bottom), so
// the stub must supply a healthy one to exercise the linking it actually tests.
import { describe, it, expect, afterEach, vi } from 'vitest';

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
  { name: 'Arbitrum', tvl: 3e9, tokenSymbol: 'ARB', gecko_id: 'arbitrum', chainId: 42161 },
  { name: 'Base', tvl: 4e9, tokenSymbol: null, gecko_id: null, chainId: 8453 },
  { name: 'Optimism', tvl: 2e9, tokenSymbol: 'OP', gecko_id: 'optimism', chainId: 10 },
  { name: 'Solana', tvl: 8e9, tokenSymbol: 'SOL', gecko_id: 'solana', chainId: null },
];

afterEach(() => vi.unstubAllGlobals());

// Minimal healthy overview payloads, shaped like DefiLlama's real response.
const overviewFor = (perChain) => ({
  protocols: Object.entries(perChain).map(([chain, v], i) => ({
    name: `P${i}`, category: 'Dexs', breakdown24h: { [chain]: { [`P${i}`]: v } },
  })),
});
const VOLUME = { Ethereum: 1.1e9, Arbitrum: 1.5e8, Base: 8.3e8, Optimism: 2e7, Solana: 1.6e9 };
const FEES = { Ethereum: 5e6, Arbitrum: 2e5, Base: 4e5, Optimism: 8e4, Solana: 3e6 };

function stubFeed({ dexs = true, fees = true, universe = UNIVERSE, volume = VOLUME, feeMap = FEES, extra } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/v2/chains')) return json(universe);
    if (u.includes('/overview/dexs')) return dexs ? json(overviewFor(volume)) : new Response('', { status: 500 });
    if (u.includes('/overview/fees')) return fees ? json(overviewFor(feeMap)) : new Response('', { status: 500 });
    if (extra) { const r = extra(u); if (r) return r; }
    return new Response('', { status: 500 }); // everything else → best-effort default
  }));
}

describe('chain-linking wiring (/api/chains)', () => {
  it('bakes category, coverage, and related peers onto each chain', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), {}, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(2);
    const eth = body.chains.find((c) => c.name === 'Ethereum');
    expect(eth).toBeTruthy();
    expect(eth.category).toBe('l1-settlement');
    expect(eth.categoryLabel).toBeTruthy();
    expect(eth.coverage).toBeTruthy();
    expect(Array.isArray(eth.related.peers)).toBe(true);

    // Arbitrum's peers should include same-category L2s first, each with a reason,
    // and every peer must resolve to a chain that's actually in the blob.
    const arb = body.chains.find((c) => c.name === 'Arbitrum');
    expect(arb.category).toBe('l2-optimistic');
    expect(arb.related.peers.length).toBeGreaterThan(0);
    const names = new Set(body.chains.map((c) => c.name));
    for (const p of arb.related.peers) {
      expect(p.reason).toBeTruthy();
      expect(names.has(p.name)).toBe(true); // no dangling peer (no tail-404)
    }
    const l2names = arb.related.peers.filter((p) => p.sameCategory).map((p) => p.name);
    expect(l2names).toEqual(expect.arrayContaining(['Base'])); // same-category peer surfaced
  });

  // Minimal in-memory D1 stub: enough for snapshot_cache round-trips.
  function makeDB() {
    const store = {};
    const mk = (sql) => ({ sql, binds: [],
      bind(...a) { this.binds = a; return this; },
      async run() { const m = this.sql.match(/VALUES \('([a-z_]+)'/); if (m) store[m[1]] = this.binds[0]; return {}; },
      async first() { const m = this.sql.match(/key='([a-z_]+)'/); return m && store[m[1]] ? { data: store[m[1]], updated_at: 1 } : null; },
      async all() { const m = this.sql.match(/key='([a-z_]+)'/); return { results: m && store[m[1]] ? [{ data: store[m[1]] }] : [] }; },
    });
    return { prepare: (sql) => mk(sql), async batch() { return []; }, _store: store };
  }

  it('derives a category from growthepie for a chain missing from the curated map', async () => {
    // 'Frontier' is not in CHAIN_CATEGORY; the growthepie master says OP Stack → l2-optimistic.
    stubFeed({
      universe: [
        { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
        { name: 'Frontier', tvl: 5e9, tokenSymbol: 'FRO', gecko_id: null, chainId: 555 },
      ],
      volume: { Ethereum: 1.1e9, Frontier: 2e7 },
      feeMap: { Ethereum: 5e6, Frontier: 1e4 },
      extra: (u) => (u.includes('master.json') ? json({ chains: { frontier: { evm_chain_id: 555, stack: 'OP Stack' } } }) : null),
    });
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), { DB: makeDB() }, ctx());
    const body = await res.json();
    const fro = body.chains.find((c) => c.name === 'Frontier');
    expect(fro.category).toBe('l2-optimistic'); // via deriveCategory, not the curated map
    expect(fro.categoryLabel).toBeTruthy();
  });

  it('resolves a tail chain (rank > 50) instead of 404, with peers that all resolve', async () => {
    const universe = [
      { name: 'Ethereum', tvl: 6e10, volume24h: 2e9, fees24h: 5e6, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
      { name: 'Arbitrum', tvl: 3e9, volume24h: 1e9, fees24h: 3e5, tokenSymbol: 'ARB', gecko_id: 'arbitrum', chainId: 42161 },
      { name: 'Base', tvl: 4e9, volume24h: 1.2e9, fees24h: 4e5, tokenSymbol: null, gecko_id: null, chainId: 8453 },
      { name: 'Optimism', tvl: 2e9, volume24h: 8e8, fees24h: 2e5, tokenSymbol: 'OP', gecko_id: 'optimism', chainId: 10 },
    ];
    for (let i = 0; i < 55; i++) universe.push({ name: `Filler${i}`, tvl: 1e8 - i * 1e6, volume24h: 0, fees24h: 0, tokenSymbol: null, gecko_id: null, chainId: 1000 + i });
    stubFeed({
      universe,
      volume: Object.fromEntries(universe.filter((c) => c.volume24h).map((c) => [c.name, c.volume24h])),
      feeMap: Object.fromEntries(universe.filter((c) => c.fees24h).map((c) => [c.name, c.fees24h])),
    });
    const db = makeDB();
    const env = { DB: db };
    const worker = await freshWorker();
    // prime the snapshot (persists 'chains' + 'chains_lite')
    const list = await (await worker.fetch(new Request('http://localhost/api/chains'), env, ctx())).json();
    expect(list.chains.length).toBe(50); // top-50 only in the leaderboard
    expect(db._store['chains_lite']).toBeTruthy(); // lite index persisted separately
    // Filler54 (lowest TVL) is rank 59 → beyond the top-50 → must resolve, not 404
    const res = await worker.fetch(new Request('http://localhost/api/chain/Filler54'), env, ctx());
    expect(res.status).toBe(200);
    const prof = await res.json();
    expect(prof.chain.name).toBe('Filler54');
    expect(prof.chain.coverage).toBe('basic');
    expect(Array.isArray(prof.chain.related.peers)).toBe(true);
    // every peer is a top-50 chain (resolves — no dead link)
    const topNames = new Set(list.chains.map((c) => c.name));
    for (const p of prof.chain.related.peers) expect(topNames.has(p.name)).toBe(true);
  });

  it('a chain with no fee/volume data never claims a metric it lacks', async () => {
    // Healthy upstream that happens to cover none of our chains: volume/fees fall
    // back to 0 → projected to null in the link view. (Simulating this by killing
    // the feed would now be a hard error — and rightly so; see the degraded tests.)
    stubFeed({ volume: { SomeOtherChain: 5e8 }, feeMap: { SomeOtherChain: 1e5 } });
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), {}, ctx());
    const body = await res.json();
    for (const c of body.chains) {
      for (const p of c.related.peers) {
        // basis may only contain measured features; with no fee/vol data present,
        // reasons must not assert volume/fee-yield/turnover similarity.
        expect(p.basis).not.toContain('lvol');
        expect(p.basis).not.toContain('lfee');
      }
    }
  });
});

// The failure this guard exists for: DefiLlama's /overview/dexs 500s, volAgg is
// empty, and the 50%-weight volume axis contributes zero to every chain — so the
// board quietly re-ranks on TVL+fees alone. Measured against the live feed, that
// silently changes 17 of 50 board chains, with no stale flag, and the degraded
// snapshot persists over the last-good one. A board we cannot justify is worse
// than a board that is an hour old.
describe('degraded upstream feeds', () => {
  it('refuses to build a board when the volume feed is dead, rather than re-ranking silently', async () => {
    stubFeed({ dexs: false });
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), {}, ctx());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/dex volume feed unavailable/i);
    expect(body.chains).toBeUndefined();
  });

  it('refuses to build a board when the fees feed is dead', async () => {
    stubFeed({ fees: false });
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), {}, ctx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/fees feed unavailable/i);
  });

  it('builds normally when both feeds are healthy', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chains'), {}, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chains.length).toBe(UNIVERSE.length);
    // Volume actually reached the rows, so the 50% axis is real.
    expect(body.chains.find((c) => c.name === 'Solana').volume24h).toBe(1.6e9);
  });
});
