// Route-level test for the research-desk wiring on /api/chain/:name.
//
// Why this exists: chain_facts accumulated 248 rows of researched, cited analysis
// (99 links, 23 capital, 22 risk, 22 narrative, 9 synthesis) and NOTHING in src/
// read the table. Every dossier the desk produced was invisible in the product —
// which is precisely the complaint "berachain is thriving but we can't justify
// it, no citations or analysis". A test that the facts actually reach the API is
// the thing that stops that regressing to dark data again.
import { describe, it, expect, afterEach, vi } from 'vitest';

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
  { name: 'Berachain', tvl: 1e9, tokenSymbol: 'BERA', gecko_id: 'berachain', chainId: 80094 },
  { name: 'Near', tvl: 5e8, tokenSymbol: 'NEAR', gecko_id: 'near', chainId: null },
];
const overviewFor = (perChain) => ({
  protocols: Object.entries(perChain).map(([chain, v], i) => ({
    name: `P${i}`, category: 'Dexs', breakdown24h: { [chain]: { [`P${i}`]: v } },
  })),
});

afterEach(() => vi.unstubAllGlobals());

function stubFeed() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/v2/chains')) return json(UNIVERSE);
    if (u.includes('/overview/dexs?')) return json(overviewFor({ Ethereum: 1.1e9, Berachain: 2e7, Near: 5e6 }));
    if (u.includes('/overview/fees?')) return json(overviewFor({ Ethereum: 5e6, Berachain: 1e4, Near: 2e3 }));
    // PER_CHAIN_OK: the per-chain endpoints must answer, or buildSnapshot refuses
    // a board on which every row fell back to the aggregate. These suites test
    // facts/tags, not enrichment — they only need to get past it.
    if (u.includes('/overview/dexs/') || u.includes('/overview/fees/')) return json({ total24h: 1 });
    return new Response('', { status: 500 });
  }));
}

// Minimal D1 stub: serves chain_facts rows for a bound chain name, honouring the
// `chain = ?1 OR lower(chain) = lower(?1)` match the real query uses.
function makeDB(factRows = []) {
  const store = {};
  const mk = (sql) => ({
    sql,
    binds: [],
    bind(...a) { this.binds = a; return this; },
    async run() { const m = this.sql.match(/VALUES \('([a-z_]+)'/); if (m) store[m[1]] = this.binds[0]; return {}; },
    async first() { const m = this.sql.match(/key='([a-z_]+)'/); return m && store[m[1]] ? { data: store[m[1]], updated_at: 1 } : null; },
    async all() {
      if (this.sql.includes('FROM chain_facts')) {
        // The unbound UNION scan (deskOnlyChain's norm() fallback) selects every
        // researched chain name; the bound query selects one chain's rows.
        if (!this.binds.length) return { results: factRows.map((r) => ({ chain: r.chain })) };
        const want = String(this.binds[0] || '');
        return { results: factRows.filter((r) => r.chain === want || r.chain.toLowerCase() === want.toLowerCase()) };
      }
      const m = this.sql.match(/key='([a-z_]+)'/);
      return { results: m && store[m[1]] ? [{ data: store[m[1]] }] : [] };
    },
  });
  return { prepare: (sql) => mk(sql), async batch() { return []; } };
}

const SYNTH = {
  chain: 'Berachain', dimension: 'synthesis', updated_at: '2026-07-17',
  data: JSON.stringify({ thesis: 'Incentive-driven TVL, thin organic demand.', bear: 'Emissions cliff.', bull: 'PoL is novel.' }),
  sources: JSON.stringify([{ title: 'DefiLlama — Berachain', url: 'https://defillama.com/chain/Berachain' }]),
};
const LINKS = {
  chain: 'Berachain', dimension: 'links', updated_at: '2026-07-17',
  data: JSON.stringify({ website: 'https://berachain.com', twitter: 'https://x.com/berachain' }),
  sources: JSON.stringify([{ title: 'CoinGecko', url: 'https://www.coingecko.com/en/coins/berachain' }]),
};

describe('research desk facts on /api/chain/:name', () => {
  it('serves the desk analysis with its citations — the justification the board owes', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/Berachain'), { DB: makeDB([SYNTH, LINKS]) }, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts).toBeTruthy();
    expect(body.facts.synthesis.data.thesis).toMatch(/incentive-driven/i);
    // A claim without a resolving source is the whole problem — sources must ship.
    expect(body.facts.synthesis.sources[0].url).toBe('https://defillama.com/chain/Berachain');
    expect(body.facts.links.data.website).toBe('https://berachain.com');
    expect(body.facts.synthesis.updatedAt).toBe('2026-07-17');
  });

  it('matches the desk spelling case-insensitively (desk "NEAR" vs board "Near")', async () => {
    stubFeed();
    const worker = await freshWorker();
    const row = { ...LINKS, chain: 'NEAR', data: JSON.stringify({ website: 'https://near.org' }) };
    const res = await worker.fetch(new Request('http://localhost/api/chain/Near'), { DB: makeDB([row]) }, ctx());
    const body = await res.json();
    expect(body.facts.links.data.website).toBe('https://near.org');
  });

  it('returns null facts for a chain the desk has not covered — never a fake block', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/Ethereum'), { DB: makeDB([SYNTH]) }, ctx());
    expect((await res.json()).facts).toBeNull();
  });

  it('skips a malformed row instead of serving half-parsed research', async () => {
    stubFeed();
    const worker = await freshWorker();
    const bad = { chain: 'Berachain', dimension: 'capital', data: '{not json', sources: null, updated_at: '2026-07-17' };
    const res = await worker.fetch(new Request('http://localhost/api/chain/Berachain'), { DB: makeDB([bad, SYNTH]) }, ctx());
    const body = await res.json();
    expect(body.facts.capital).toBeUndefined();
    expect(body.facts.synthesis).toBeTruthy();   // one bad row must not sink the rest
  });

  it('hides the internal _meta dimension from the public payload', async () => {
    stubFeed();
    const worker = await freshWorker();
    const meta = { chain: 'Berachain', dimension: '_meta', data: '{"agent":"desk-run-3"}', sources: null, updated_at: '2026-07-17' };
    const res = await worker.fetch(new Request('http://localhost/api/chain/Berachain'), { DB: makeDB([meta, SYNTH]) }, ctx());
    expect((await res.json()).facts._meta).toBeUndefined();
  });

  it('degrades to null facts when D1 is absent rather than 500ing the profile', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/Berachain'), {}, ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).facts).toBeNull();
  });
});

// 12 chains the desk had RESEARCHED 404'd on their own profile: their names come
// from the desk, not DefiLlama, and resolveTailChain matched raw lowercase while
// the rest of the pipeline keys on norm(). Some (Polkadot, Karak, OKExChain) are
// not in DefiLlama's feed at all. Guessing an alias would put the wrong chain's
// metrics on a researched page — a worse error than the 404 — so we resolve on
// norm(), and fall back to the research with no market figures.
describe('a chain we researched always resolves', () => {
  const factRow = (chain) => ({
    chain, dimension: 'synthesis', updated_at: '2026-07-17',
    data: JSON.stringify({ thesis: `${chain} thesis`, bear: 'b', bull: 'B' }),
    sources: JSON.stringify([{ title: 'DefiLlama', url: 'https://defillama.com' }]),
  });

  it('matches on norm(), so the desk\'s "Cosmos Hub" finds DefiLlama\'s "CosmosHub"', async () => {
    stubFeed();
    const worker = await freshWorker();
    // The board fixture has no such chain; the desk row is the only trace.
    const res = await worker.fetch(new Request('http://localhost/api/chain/Cosmos%20Hub'), { DB: makeDB([factRow('CosmosHub')]) }, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain.name).toBe('CosmosHub');
    expect(body.facts.synthesis.data.thesis).toContain('CosmosHub');
  });

  it('serves the research for a chain DefiLlama does not carry, with no invented metrics', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/Karak'), { DB: makeDB([factRow('Karak')]) }, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain.name).toBe('Karak');
    expect(body.chain.tvl).toBeNull();          // never 0 — we have no market feed for it
    expect(body.chain.volume24h).toBeNull();
    expect(body.chain.marketData).toBe(false);
    expect(body.facts.synthesis).toBeTruthy();  // ...but the research is there
  });

  it('still 404s a chain we have never researched', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/NotARealChainXYZ'), { DB: makeDB([]) }, ctx());
    expect(res.status).toBe(404);
  });
});
