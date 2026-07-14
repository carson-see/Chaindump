// Route-level integration test for the chain-linking wiring in worker.js.
// Boots the real Hono app and drives /api/chains with a stubbed DefiLlama feed:
// the primary /v2/chains fetch returns a small universe; every other upstream
// call 500s so buildSnapshot falls back to its best-effort defaults (no network).
// Verifies that category + related peers are baked onto rows on the refresh path.
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

function stubFeed() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/v2/chains')) return json(UNIVERSE);
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

  it('a chain with no fee/volume data never claims a metric it lacks', async () => {
    stubFeed(); // all volume/fees fall back to 0 → projected to null in the link view
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
