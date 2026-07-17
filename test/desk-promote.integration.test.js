// Route-level test for /api/desk/promote and /api/desk/reject.
//
// Why this exists: promotionPlan() only builds column/value lists for the
// columns present in the reviewer's curated record — it was never required to
// cover every column. The route wrote that partial list with `INSERT OR
// REPLACE`, which on a primary-key conflict deletes the whole existing row
// before re-inserting it. A reviewer correcting just `verdict` on an
// already-published chain would silently null out its sources/TVL/profile —
// exactly the "unsourced published claim" CLAUDE.md 1.5 exists to prevent.
import { describe, it, expect, afterEach, vi } from 'vitest';

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });

afterEach(() => vi.unstubAllGlobals());

// Minimal D1 stub covering exactly the statements /api/desk/promote and
// /api/desk/reject issue: a keyed desk_proposals store and a keyed dead_chains
// store, with INSERT OR REPLACE vs. INSERT ... ON CONFLICT DO UPDATE given
// genuinely different merge semantics (full replace vs. column-level merge).
function makeDeskDB({ proposal, chainRow } = {}) {
  const proposals = new Map();
  const chains = new Map();
  if (proposal) proposals.set(`${proposal.dataset}:${proposal.slug}`, { ...proposal });
  if (chainRow) chains.set(chainRow.chain, { ...chainRow });

  function mk(sql) {
    return {
      sql,
      binds: [],
      bind(...a) { this.binds = a; return this; },
      async first() {
        if (this.sql.includes('FROM desk_proposals')) {
          const [dataset, slug] = this.binds;
          return proposals.get(`${dataset}:${slug}`) || null;
        }
        return null;
      },
      async run() {
        if (/INTO dead_chains/.test(this.sql)) {
          const cols = this.sql.match(/\(([^)]+)\)\s+VALUES/)[1].split(',').map((s) => s.trim());
          const rec = {};
          cols.forEach((c, i) => { rec[c] = this.binds[i]; });
          if (/INSERT OR REPLACE/.test(this.sql)) {
            chains.set(rec.chain, rec); // full replace: wipes any column not in `rec`
          } else {
            chains.set(rec.chain, { ...(chains.get(rec.chain) || {}), ...rec }); // upsert merge
          }
        } else if (/UPDATE desk_proposals/.test(this.sql)) {
          const [reviewerNote, dataset, slug] = this.binds;
          const key = `${dataset}:${slug}`;
          proposals.set(key, { ...(proposals.get(key) || {}), status: this.sql.includes("status='promoted'") ? 'promoted' : 'rejected', reviewer_note: reviewerNote });
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare: (sql) => mk(sql), chains, proposals };
}

function promoteRequest(body) {
  return new Request('http://localhost/api/desk/promote', {
    method: 'POST',
    headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/desk/promote', () => {
  it('promoting a partial correction to an existing chain preserves untouched columns', async () => {
    const worker = await freshWorker();
    const db = makeDeskDB({
      proposal: { payload: JSON.stringify({}), sources: null, status: 'pending' },
      chainRow: {
        chain: 'Blast', peak_tvl: 2259400000, current_tvl: 29240000,
        sources: '[{"title":"BLAST TVL","url":"https://defillama.com/chain/Blast"}]',
        verdict: 'declining', profile: '{"tier":"zombie"}',
      },
    });
    db.proposals.set('dead_chains:blast-fix', { payload: JSON.stringify({}), sources: null, status: 'pending' });
    const env = { DB: db, DESK_TOKEN: 'secret' };

    const res = await worker.fetch(
      promoteRequest({ dataset: 'dead_chains', slug: 'blast-fix', record: { chain: 'Blast', verdict: 'zombie' } }),
      env, ctx(),
    );
    expect(res.status).toBe(200);

    const row = db.chains.get('Blast');
    expect(row.verdict).toBe('zombie'); // the field the reviewer actually changed
    expect(row.sources).toBeTruthy(); // NOT wiped by the promote
    expect(Number(row.peak_tvl)).toBe(2259400000); // NOT wiped by the promote
    expect(row.profile).toBeTruthy(); // NOT wiped by the promote
  });

  it('promoting a brand-new chain still inserts every provided column', async () => {
    const worker = await freshWorker();
    const db = makeDeskDB({ proposal: { payload: JSON.stringify({}), sources: null, status: 'pending' } });
    db.proposals.set('dead_chains:newchain', { payload: JSON.stringify({}), sources: null, status: 'pending' });
    const env = { DB: db, DESK_TOKEN: 'secret' };

    const res = await worker.fetch(
      promoteRequest({ dataset: 'dead_chains', slug: 'newchain', record: { chain: 'NewChain', verdict: 'dead', sources: [{ title: 't', url: 'https://u' }] } }),
      env, ctx(),
    );
    expect(res.status).toBe(200);
    const row = db.chains.get('NewChain');
    expect(row.verdict).toBe('dead');
    expect(row.sources).toBeTruthy();
  });
});
