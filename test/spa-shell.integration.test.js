// Route-level integration tests for spaShell()'s SSR row injection — the
// pure renderSsrRows() unit tests (test/ssr-rows.test.js) can't reach the
// snapshot-loading, marker-replacement, or fallback wiring since those live
// entirely inside worker.js. Boots the real Hono app (same pattern as
// test/x402.integration.test.js) against the real public/index.html so a
// drift between the marker in index.html and the regex in worker.js would
// fail here, not silently in production.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';

const INDEX_HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });

afterEach(() => vi.unstubAllGlobals());

// A snapshot_cache-shaped D1 stub: exactly the one query loadSnapshot() issues
// (SELECT data, updated_at FROM snapshot_cache WHERE key='chains').
function envWithChains(chains) {
  const row = { data: JSON.stringify({ chains }), updated_at: Date.now() };
  return {
    ASSETS: { fetch: async () => new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }) },
    DB: { prepare: () => ({ first: async () => row }) },
  };
}

describe('spaShell SSR row injection (via GET /)', () => {
  it('replaces the marker with real rows when the snapshot has chains', async () => {
    const worker = await freshWorker();
    const env = envWithChains([
      { rank: 1, name: 'Ethereum', symbol: 'ETH', tvl: 64.2e9, volume24h: 1.2e9, activeAddresses: 400000 },
      { rank: 2, name: 'Solana', symbol: 'SOL', tvl: 8e9, volume24h: 9e8, activeAddresses: 1200000 },
    ]);
    const res = await worker.fetch(new Request('http://localhost/'), env, ctx());
    const html = await res.text();
    expect(html).toContain('data-name="Ethereum"');
    expect(html).toContain('data-name="Solana"');
    expect(html).toContain('data-ssr="1"');
    expect(html).not.toContain('Fetching live chain data');
    // The marker comments themselves are consumed by the replace, not leaked into the response.
    expect(html).not.toContain('ssr-rows-start');
  });

  it('inserts a chain name containing "$&" literally, not as a String.replace() pattern', async () => {
    const worker = await freshWorker();
    // "$&" is special to String.replace(pattern, string) — it re-inserts the
    // whole match. A bare-string replace would corrupt this into the marker's
    // own matched content instead of the literal chain name.
    const env = envWithChains([{ rank: 1, name: 'Dollar$&Chain', tvl: 100 }]);
    const res = await worker.fetch(new Request('http://localhost/'), env, ctx());
    const html = await res.text();
    expect(html).toContain('data-name="Dollar$&amp;Chain"');
  });

  it('leaves the original skeleton untouched when the snapshot has no chains', async () => {
    const worker = await freshWorker();
    const env = envWithChains([]);
    const res = await worker.fetch(new Request('http://localhost/'), env, ctx());
    const html = await res.text();
    expect(html).toContain('Fetching live chain data');
    expect(html).not.toContain('data-ssr="1"');
  });

  it('still serves the shell (SSR best-effort) when D1 is unavailable', async () => {
    // A D1 miss falls all the way through to buildSnapshot()'s live-fetch path
    // (pre-existing loadSnapshot() resilience, not new here) — stub fetch so
    // that fails fast too, instead of hitting the real network in a test.
    vi.stubGlobal('fetch', async () => { throw new Error('network disabled in test'); });
    const worker = await freshWorker();
    const env = {
      ASSETS: { fetch: async () => new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }) },
      DB: { prepare: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) },
    };
    const res = await worker.fetch(new Request('http://localhost/'), env, ctx());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Fetching live chain data');
  });
});
