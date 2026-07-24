// Route-level test: /chain/:name, /live, /scam/:slug and /collection/:id all
// serve markdown-for-agents (instead of the SPA shell) when a client
// negotiates text/markdown, and keep serving HTML by default (see
// src/lib/entity-markdown.js, src/lib/negotiate.js).
import { describe, it, expect, afterEach, vi } from 'vitest';

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const ASSETS = { fetch: async () => new Response('<html><head><title>Chaindump</title></head><body><div id="app"></div></body></html>', { headers: { 'content-type': 'text/html' } }) };

const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
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
    if (u.includes('/overview/dexs?')) return json(overviewFor(fill({ Ethereum: 1.1e9 })));
    if (u.includes('/overview/fees?')) return json(overviewFor(fill({ Ethereum: 5e6 })));
    if (u.includes('/overview/dexs/') || u.includes('/overview/fees/')) return json({ total24h: 1 });
    return new Response('', { status: 500 });
  }));
}

// Minimal D1 stub covering the two single-row lookups these routes issue:
// scam_traces (via dbQuery -> .prepare().bind().all()) and nft_catalog
// (via .prepare().bind().first()).
function makeDB({ scamRow = null, nftRow = null } = {}) {
  return {
    prepare(sql) {
      return {
        binds: [],
        bind(...a) { this.binds = a; return this; },
        async all() {
          if (/FROM scam_traces/.test(sql)) return { results: scamRow ? [scamRow] : [] };
          return { results: [] };
        },
        async first() {
          if (/FROM nft_catalog/.test(sql)) return nftRow;
          return null;
        },
      };
    },
  };
}

describe('markdown-for-agents on entity/view deep-links', () => {
  it('/chain/:name serves markdown with Metrics + Structured JSON link when negotiated', async () => {
    stubFeed();
    const worker = await freshWorker();
    const env = { DB: makeDB(), ASSETS };
    await worker.fetch(new Request('http://localhost/api/chains'), env, ctx());
    const res = await worker.fetch(new Request('http://localhost/chain/Ethereum', { headers: { accept: 'text/markdown' } }), env, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(res.headers.get('vary')).toBe('Accept');
    const body = await res.text();
    expect(body).toContain('# Ethereum — Chaindump');
    expect(body).toContain('## Metrics');
    expect(body).toContain('Structured JSON: https://chaindump.xyz/api/chain/Ethereum');
  });

  it('/chain/:name still serves HTML by default (no Accept override)', async () => {
    stubFeed();
    const worker = await freshWorker();
    const env = { DB: makeDB(), ASSETS };
    await worker.fetch(new Request('http://localhost/api/chains'), env, ctx());
    const res = await worker.fetch(new Request('http://localhost/chain/Ethereum'), env, ctx());
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('<title>Ethereum — Chaindump');
  });

  it('/live serves markdown with the top-chains ItemList when negotiated', async () => {
    stubFeed();
    const worker = await freshWorker();
    const env = { DB: makeDB(), ASSETS };
    await worker.fetch(new Request('http://localhost/api/chains'), env, ctx());
    const res = await worker.fetch(new Request('http://localhost/live', { headers: { accept: 'text/markdown' } }), env, ctx());
    const body = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(body).toContain('## Top chains by on-chain activity');
    expect(body).toMatch(/1\. \[Ethereum\]\(https:\/\/chaindump\.xyz\/chain\/Ethereum\)/);
  });

  it('/scam/:slug serves markdown for a known case when negotiated', async () => {
    const worker = await freshWorker();
    const env = { DB: makeDB({ scamRow: { name: 'Example Rug', category: 'rug', amount_usd: 5e6 } }) };
    const res = await worker.fetch(new Request('http://localhost/scam/example-rug', { headers: { accept: 'text/markdown' } }), env, ctx());
    const body = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(body).toContain('# Example Rug — Chaindump Scam Tracker');
    expect(body).toContain('traced fund-flow');
  });

  it('/collection/:id serves markdown with a Structured JSON link when negotiated', async () => {
    const worker = await freshWorker();
    const env = { DB: makeDB({ nftRow: { name: 'Cool Cats', chain: 'Ethereum' } }) };
    const res = await worker.fetch(new Request('http://localhost/collection/cool-cats', { headers: { accept: 'text/markdown' } }), env, ctx());
    const body = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(body).toContain('# Cool Cats — Chaindump');
    expect(body).toContain('Structured JSON: https://chaindump.xyz/api/nft-collection/cool-cats');
  });
});
