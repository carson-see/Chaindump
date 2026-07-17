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
// Every chain a test resolves must exist in the universe, or /api/chain/:name
// 404s and `tags` is simply absent — which reads as a code failure, not a fixture
// one. Canton and Robinhood Chain are ON the board here; Scroll/Osmosis/Miden are
// deliberately absent from it so the off-board paths are actually exercised.
const UNIVERSE = [
  { name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', gecko_id: 'ethereum', chainId: 1 },
  { name: 'Berachain', tvl: 1e9, tokenSymbol: 'BERA', gecko_id: 'berachain', chainId: 80094 },
  { name: 'Canton', tvl: 9e9, tokenSymbol: 'CC', gecko_id: null, chainId: null },   // big enough to actually make the board
  { name: 'Robinhood Chain', tvl: 2.1e8, tokenSymbol: null, gecko_id: null, chainId: 4663 },
  { name: 'Scroll', tvl: 4e7, tokenSymbol: 'SCR', gecko_id: 'scroll', chainId: 534352 },
  { name: 'Osmosis', tvl: 3e7, tokenSymbol: 'OSMO', gecko_id: 'osmosis', chainId: null },
  { name: 'Miden', tvl: 0, tokenSymbol: null, gecko_id: null, chainId: null },
  // The board holds 50. Without enough filler every fixture chain lands on it and
  // the off-board branches — graveyard, stuck, watchlist — are never exercised:
  // the earlier suite "passed" precisely because Scroll was silently top-50.
  ...Array.from({ length: 60 }, (_, i) => ({
    name: `Filler${i}`, tvl: 5e9 - i * 1e6, tokenSymbol: null, gecko_id: null, chainId: 900000 + i,
  })),
];
const ov = (m) => ({ protocols: Object.entries(m).map(([c, v], i) => ({ name: `P${i}`, category: 'Dexs', breakdown24h: { [c]: { [`P${i}`]: v } } })) });
// Filler must be plausible on EVERY axis. An earlier version reused one map for
// volume AND fees, handing 60 filler chains $800M/day in fees against Ethereum's
// $5M — so the filler out-scored Ethereum and pushed it off its own board. The
// fixture was wrong, not the classifier.
const fillerVol = (m) => ({ ...m, ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Filler${i}`, 8e8 - i * 1e6])) });
const fillerFees = (m) => ({ ...m, ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Filler${i}`, 2e4 - i * 100])) });
afterEach(() => vi.unstubAllGlobals());
const stub = () => vi.stubGlobal('fetch', vi.fn(async (u) => {
  u = String(u);
  if (u.includes('/v2/chains')) return json(UNIVERSE);
  if (u.includes('/overview/dexs?')) return json(ov(fillerVol({ Ethereum: 1.1e9, Berachain: 2e7, Canton: 9e8, 'Robinhood Chain': 5e6, Scroll: 1e5, Osmosis: 9e4 })));
  if (u.includes('/overview/fees?')) return json(ov(fillerFees({ Ethereum: 5e6, Berachain: 1e4, Canton: 1e4, 'Robinhood Chain': 8e2, Scroll: 40, Osmosis: 30 })));
  // The PER-CHAIN endpoints must answer, or buildSnapshot refuses a board on
  // which every row fell back to the aggregate. This suite tests tags, not
  // enrichment — it only has to get past it.
  if (u.includes('/overview/dexs/') || u.includes('/overview/fees/')) return json({ total24h: 1 });
  return new Response('', { status: 500 });
}));
// An off-board chain resolves through the `chains_lite` index, so the stub must
// actually PERSIST what the worker writes — a stub whose run() drops everything
// makes every tail chain 404 and reads as a code bug rather than a fixture one.
function makeDB(rows = []) {
  const store = {};
  const mk = (sql) => ({
    sql, binds: [],
    bind(...a) { this.binds = a; return this; },
    async run() { const m = this.sql.match(/VALUES \('([a-z_]+)'/); if (m) store[m[1]] = this.binds[0]; return {}; },
    async first() { const m = this.sql.match(/key='([a-z_]+)'/); return m && store[m[1]] ? { data: store[m[1]], updated_at: 1 } : null; },
    async all() {
      if (this.sql.includes('FROM chain_facts')) {
        const w = String(this.binds[0] || '');
        return { results: rows.filter((r) => r.chain === w || r.chain.toLowerCase() === w.toLowerCase()) };
      }
      const m = this.sql.match(/key='([a-z_]+)'/);
      return { results: m && store[m[1]] ? [{ data: store[m[1]] }] : [] };
    },
  });
  return { prepare: (sql) => mk(sql), async batch() { return []; } };
}
const identity = (chain, data) => ({ chain, dimension: 'identity', data: JSON.stringify(data), sources: '[]', updated_at: '2026-07-17' });
const get = async (name, dbRows) => {
  stub();
  const w = await freshWorker();
  const env = { DB: makeDB(dbRows) };
  // Prime the snapshot first: a tail chain resolves out of the persisted
  // chains_lite index, which only exists once /api/chains has been built.
  await w.fetch(new Request('http://localhost/api/chains'), env, ctx());
  return (await w.fetch(new Request(`http://localhost/api/chain/${encodeURIComponent(name)}`), env, ctx())).json();
};

// ---------------------------------------------------------------------------
// THESE FIXTURES ARE COPIED VERBATIM FROM PROD chain_facts ROWS (2026-07-17).
//
// The first version of this suite invented its own shape — `{tags:[...], tier:
// 'graveyard'}` — and passed, while the code read `identity.tier`, a field that
// exists in ZERO of the 130 real rows. The tests asserted the code agreed with
// itself about a schema that did not exist, and 69 researched chains shipped
// with no cohort chip. Fixtures must mirror reality or they prove nothing.
//
// Note what the real rows actually do: cohorts live INSIDE tags[] next to the
// themes; `permissioned` is a theme tag, not a field; and the launch date hides
// under three different keys.
// ---------------------------------------------------------------------------
const REAL = {
  // cohort lives in tags[]; launch date under `mainnet_live`; `founded` is a NUMBER
  Scroll:  { category:'l2-zk', chain_type:'l2', founded:2021, mainnet_live:'2023-10', name:'Scroll',
             status:'declining', tags:['graveyard','l2','zk'], token_symbol:'SCR', vm:'evm' },
  // launch date under `founded`; no status at all
  Osmosis: { category:'appchain', founded:'2021-06-19', name:'Osmosis', tags:['graveyard','appchain'],
             token_symbol:'OSMO', vm:'evm' },
  // `permissioned` is a THEME, and this chain is ALSO on the board
  Canton:  { chain:'Canton', tags:['top-50','l1','permissioned','institutional','privacy'] },
  // 16 days old; note status is the legacy word 'emerging'
  Robinhood: { chain:'Robinhood Chain', category:'l2-optimistic', launched:'2026-07', operator:'Robinhood Markets',
               status:'emerging', tags:['up-and-coming','l2','evm','corporate-parent','rwa'], vm:'evm' },
  // pre-launch: asserted by status, launched explicitly null
  Miden:   { chain:'Miden', expected_launch:'early September 2026', launched:null, status:'anticipated',
             tags:['anticipated','privacy','zk'], vm:'miden-vm' },
};

describe('chain tags on /api/chain/:name', () => {
  // The collision the tags agent flagged: worker.js imports TAG_LABELS + canonTags
  // from causes.js, and tags.js exports THOSE SAME NAMES. An unaliased import
  // shadows the cause vocabulary with no error — every graveyard cause chip would
  // silently render a chain-tag label.
  it('the two vocabularies are distinct — the import alias is load-bearing', () => {
    expect(CAUSE_LABELS).not.toBe(CHAIN_TAG_LABELS);
    expect(CHAIN_TAG_LABELS['up-and-coming']).toBeTruthy();
    expect(CAUSE_LABELS['up-and-coming']).toBeUndefined();
  });

  // The regression: 53 graveyard + 16 stuck chains rendered NO cohort chip,
  // because the cohort was filtered out of tags[] and read back from a field
  // that was never written.
  it('reads the desk cohort out of tags[] — a real graveyard row', async () => {
    const body = await get('Scroll', [identity('Scroll', REAL.Scroll)]);
    expect(body.tags.cohort).toBe('graveyard');
    expect(body.tags.themes).toEqual(expect.arrayContaining(['l2', 'zk']));
    expect(body.tags.themes).not.toContain('graveyard');   // cohort is not a theme
  });

  it('handles a launch date under `founded` rather than `launched`', async () => {
    const body = await get('Osmosis', [identity('Osmosis', REAL.Osmosis)]);
    expect(body.tags.cohort).toBe('graveyard');
  });

  it('never reads `founded: 2021` as an epoch timestamp (1970)', async () => {
    // Two earlier versions of this test were VACUOUS and a mutant that deleted
    // the guard survived both.
    //   v1 used Scroll — which carries mainnet_live:'2023-10', and mainnet_live
    //      precedes founded in LAUNCH_KEYS, so the guard never fired.
    //   v2 used an on-board chain — 2021-as-millis lands in 1970, which is old,
    //      and an on-board chain returns top-50 whatever the date says.
    // The mis-parse only CHANGES the answer for an OFF-BOARD chain with no other
    // date: guarded, we know no launch date and say nothing (null); unguarded,
    // 1970 is a known past date and the chain becomes 'watchlist' — a cohort
    // invented out of a number that was never a date.
    const numericOnly = { tags: ['l1'], founded: 2021 };
    const body = await get('Scroll', [identity('Scroll', numericOnly)]);   // Scroll is off the board here
    expect(body.tags.cohort).toBeNull();

    // The same value as a STRING is a real date, and the rule uses it.
    const stringy = await get('Scroll', [identity('Scroll', { tags: ['l1'], founded: '2021' })]);
    expect(stringy.tags.cohort).toBe('watchlist');
  });

  it('computes up-and-coming from a real 16-day-old row', async () => {
    const body = await get('Robinhood Chain', [identity('Robinhood Chain', REAL.Robinhood)]);
    expect(body.tags.cohort).toBe('up-and-coming');
    expect(body.tags.themes).toEqual(expect.arrayContaining(['l2', 'corporate-parent', 'rwa']));
  });

  it('treats `permissioned` as a theme and still lets the board win', async () => {
    // Canton is permissioned AND top-50. Private must never hide a board position.
    const body = await get('Canton', [identity('Canton', REAL.Canton)]);
    expect(body.tags.themes).toContain('permissioned');
    expect(body.tags.cohort).toBe('top-50');
  });

  it('keeps a genuinely pre-launch chain anticipated', async () => {
    const body = await get('Miden', [identity('Miden', REAL.Miden)]);
    expect(body.tags.cohort).toBe('anticipated');
  });

  it('expires a stale `anticipated` status once a past launch date exists', async () => {
    // If Miden ships in September and nobody hand-edits status, we must not keep
    // publishing "Anticipated" for a live chain. Evidence beats assertion.
    const shipped = { ...REAL.Miden, launched: '2026-01-15' };
    const body = await get('Miden', [identity('Miden', shipped)]);
    expect(body.tags.cohort).not.toBe('anticipated');
  });

  it('computes top-50 for a board chain rather than trusting a stored cohort', async () => {
    // Storage says graveyard; the chain is demonstrably on the live board.
    const stale = { ...REAL.Scroll, tags: ['graveyard', 'l1'] };
    const body = await get('Ethereum', [identity('Ethereum', stale)]);
    expect(body.tags.cohort).toBe('top-50');
  });

  it('never publishes that a chain with no launch date is unlaunched', async () => {
    // Ethereum carries no `launched` on the live board. "no date => anticipated"
    // would have published that Ethereum has not launched.
    const body = await get('Ethereum', [identity('Ethereum', { tags: ['l1'] })]);
    expect(body.tags.cohort).not.toBe('anticipated');
  });

  it('serves the vocabulary so the SPA never re-derives a label', async () => {
    const body = await get('Berachain', [identity('Berachain', { tags: ['l1'] })]);
    expect(body.tagVocab.labels['up-and-coming']).toBeTruthy();
    expect(body.tagVocab.upAndComingDays).toBe(30);
  });

  it('canonicalizes the legacy "emerging" tag out of the published themes', async () => {
    const body = await get('Berachain', [identity('Berachain', { tags: ['emerging', 'l1'] })]);
    expect(body.tags.themes).not.toContain('emerging');
  });

  it('falls back to derived themes when the desk has not tagged a chain', async () => {
    const body = await get('Ethereum', []);
    expect(Array.isArray(body.tags.themes)).toBe(true);
    expect(body.tags.cohort).toBe('top-50');
  });
});
