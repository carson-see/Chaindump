// Route-level test for the chain-tag wiring on /api/chain/:name.
//
// tags.js sat in the repo as DEAD CODE — 224 lines with 298 lines of green tests
// and not one importer outside its own test file. Passing tests on an unreachable
// module are worse than no tests: they read as coverage. This is the test that
// makes the module actually reachable.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { TAG_LABELS as CAUSE_LABELS } from '../src/lib/causes.js';
import { TAG_LABELS as CHAIN_TAG_LABELS } from '../src/lib/tags.js';

async function freshWorker() { vi.resetModules(); return (await import('../src/worker.js')).default; }
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
  { name: 'Berachain', tvl: 1e9, tokenSymbol: 'BERA', gecko_id: 'berachain', chainId: 80094 },
];
const ov = (m) => ({ protocols: Object.entries(m).map(([c, v], i) => ({ name: `P${i}`, category: 'Dexs', breakdown24h: { [c]: { [`P${i}`]: v } } })) });
afterEach(() => vi.unstubAllGlobals());
const stub = () => vi.stubGlobal('fetch', vi.fn(async (u) => {
  u = String(u);
  if (u.includes('/v2/chains')) return json(UNIVERSE);
  if (u.includes('/overview/dexs')) return json(ov({ Ethereum: 1.1e9, Berachain: 2e7 }));
  if (u.includes('/overview/fees')) return json(ov({ Ethereum: 5e6, Berachain: 1e4 }));
  return new Response('', { status: 500 });
}));
function makeDB(rows = []) {
  const mk = (sql) => ({ sql, binds: [], bind(...a) { this.binds = a; return this; }, async run() { return {}; }, async first() { return null; },
    async all() {
      if (this.sql.includes('FROM chain_facts')) {
        const w = String(this.binds[0] || '');
        return { results: rows.filter((r) => r.chain === w || r.chain.toLowerCase() === w.toLowerCase()) };
      }
      return { results: [] };
    } });
  return { prepare: (sql) => mk(sql), async batch() { return []; } };
}
const identity = (chain, data) => ({ chain, dimension: 'identity', data: JSON.stringify(data), sources: '[]', updated_at: '2026-07-17' });
const get = async (name, dbRows) => {
  stub(); const w = await freshWorker();
  return (await w.fetch(new Request(`http://localhost/api/chain/${encodeURIComponent(name)}`), { DB: makeDB(dbRows) }, ctx())).json();
};

describe('chain tags on /api/chain/:name', () => {
  // The collision the tags agent flagged: worker.js imports TAG_LABELS + canonTags
  // from causes.js, and tags.js exports THOSE SAME NAMES. An unaliased import
  // shadows the cause vocabulary with no error — every graveyard chip would
  // silently render a chain-tag label. This asserts they are genuinely different
  // vocabularies, so the day someone "tidies" the alias away, this fails.
  it('the two vocabularies are distinct — the import alias is load-bearing', () => {
    expect(CAUSE_LABELS).not.toBe(CHAIN_TAG_LABELS);
    expect(CHAIN_TAG_LABELS['up-and-coming']).toBeTruthy();
    expect(CAUSE_LABELS['up-and-coming']).toBeUndefined();
  });

  it('computes top-50 for a board chain rather than trusting a stored cohort', async () => {
    // Storage says graveyard; the chain is demonstrably on the live board.
    const body = await get('Ethereum', [identity('Ethereum', { tags: ['l1', 'graveyard'], tier: 'graveyard' })]);
    expect(body.tags.cohort).toBe('top-50');
    expect(body.tags.themes).toContain('l1');
  });

  it('never publishes that a chain with no launch date is unlaunched', async () => {
    // Ethereum carries no `launched` on the live board. The naive rule
    // ("no date => anticipated") would have published that Ethereum hasn't launched.
    const body = await get('Ethereum', [identity('Ethereum', { tags: ['l1'] })]);
    expect(body.tags.cohort).not.toBe('anticipated');
  });

  it('serves the vocabulary so the SPA never re-derives a label', async () => {
    const body = await get('Berachain', [identity('Berachain', { tags: ['l1'] })]);
    expect(body.tagVocab.labels['up-and-coming']).toBeTruthy();
    expect(body.tagVocab.upAndComingDays).toBe(30);
  });

  it('canonicalizes the legacy "emerging" tag into the published vocabulary', async () => {
    const body = await get('Berachain', [identity('Berachain', { tags: ['emerging', 'l1'] })]);
    expect(body.tags.themes).not.toContain('emerging');
  });

  it('falls back to derived themes when the desk has not tagged a chain', async () => {
    const body = await get('Ethereum', []);
    expect(Array.isArray(body.tags.themes)).toBe(true);
    expect(body.tags.cohort).toBe('top-50');   // still computable from the board
  });
});
