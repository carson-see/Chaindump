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
  // Spelled as DefiLlama spells it. The desk says "Cosmos Hub"; only norm() joins
  // them. 60 fillers below push it OFF the board so the LITE path is exercised.
  { name: 'CosmosHub', tvl: 1.2e5, tokenSymbol: 'ATOM', gecko_id: 'cosmos', chainId: null },
  // Sized to sit BELOW the three real chains and ABOVE CosmosHub, so the board
  // fills up and only CosmosHub falls off — the other suites still need Berachain
  // and Near on the board.
  ...Array.from({ length: 50 }, (_, i) => ({ name: `Filler${i}`, tvl: 1e8 - i * 1e5, tokenSymbol: null, gecko_id: null, chainId: 900000 + i })),
];
const fill = (m) => ({ ...m, ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Filler${i}`, 1e6 - i * 1e3])) });
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
    if (u.includes('/overview/dexs?')) return json(overviewFor(fill({ Ethereum: 1.1e9, Berachain: 2e7, Near: 5e6, CosmosHub: 10 })));
    if (u.includes('/overview/fees?')) return json(overviewFor(fill({ Ethereum: 5e6, Berachain: 1e4, Near: 2e3, CosmosHub: 5 })));
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
    expect(body.chain.fees24h).toBeNull();
    expect(body.facts.synthesis).toBeTruthy();  // ...but the research is there
  });

  it('still 404s a chain we have never researched', async () => {
    stubFeed();
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/chain/NotARealChainXYZ'), { DB: makeDB([]) }, ctx());
    expect(res.status).toBe(404);
  });
});

// F1, a live false claim this PR introduced. The tail lookup matched with norm()
// while BOTH routes still matched the board with raw .toLowerCase(), so an alias
// skipped the board row, resolved to its rank-less lite row, and published
// "Outside the top-50 activity board" for a chain sitting ON it. /chain/Binance
// denied BSC's rank #4 while /chain/BSC affirmed it — two indexed URLs, opposite
// claims, same chain. The norm() test that should have caught this never touched
// the board match at all (its own fixture had no such board chain), so the mutant
// survived.
describe('an alias resolves to the board row, not the tail path', () => {
  it('keeps the rank when the URL uses an alias', async () => {
    stubFeed();
    const worker = await freshWorker();
    // 'Ethereum L1' -> norm() strips the L1 suffix -> the board's 'Ethereum'.
    const res = await worker.fetch(new Request('http://localhost/api/chain/Ethereum%20L1'), { DB: makeDB([]) }, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain.name).toBe('Ethereum');
    expect(body.chain.rank).toBe(1);              // NOT a rank-less tail row
    expect(body.chain.volume24h).not.toBeNull();  // the board row's real figures
  });

  it('serves the same chain identically whichever spelling is used', async () => {
    stubFeed();
    const worker = await freshWorker();
    const direct = await (await worker.fetch(new Request('http://localhost/api/chain/Ethereum'), { DB: makeDB([]) }, ctx())).json();
    const alias = await (await worker.fetch(new Request('http://localhost/api/chain/Ethereum%20L1'), { DB: makeDB([]) }, ctx())).json();
    expect(alias.chain.rank).toBe(direct.chain.rank);
    expect(alias.chain.name).toBe(direct.chain.name);
  });
});

// These two mutants SURVIVED the suite: the OG route's board lookup, and
// resolveTailChain's norm() match. The test that claimed to cover norm() routed
// through deskOnlyChain's D1 scan instead and never touched the lite match — its
// own comment admitted the board fixture had no such chain. A test that cannot
// fail for the reason it names is not coverage.
describe('norm() joins the desk\'s spelling to DefiLlama\'s — on every path', () => {
  it('resolves an off-board chain through the LITE index, not the desk fallback', async () => {
    stubFeed();
    const worker = await freshWorker();
    const env = { DB: makeDB([]) };   // NO desk rows: only the lite match can resolve it
    await worker.fetch(new Request('http://localhost/api/chains'), env, ctx());
    const res = await worker.fetch(new Request('http://localhost/api/chain/Cosmos%20Hub'), env, ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain.name).toBe('CosmosHub');
    expect(body.chain.tvl).toBe(1.2e5);   // the real lite row, not a desk-only shell
  });

  it('the OG card keeps the rank when the URL uses an alias', async () => {
    stubFeed();
    const worker = await freshWorker();
    const env = {
      DB: makeDB([]),
      // ogHtml() rewrites <title> in the SPA shell; without an ASSETS binding
      // spaShell throws and the route emits no meta tags at all.
      ASSETS: { fetch: async () => new Response('<html><head><title>Chaindump</title></head><body></body></html>', { headers: { 'content-type': 'text/html' } }) },
    };
    await worker.fetch(new Request('http://localhost/api/chains'), env, ctx());
    const html = await (await worker.fetch(new Request('http://localhost/chain/Ethereum%20L1'), env, ctx())).text();
    const desc = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '';
    expect(desc).toMatch(/Rank #1/);                        // the truth
    expect(desc).not.toMatch(/Outside the top-50/);         // the live false claim
    expect(html).toMatch(/<title>Ethereum — Chaindump/);
  });
});
