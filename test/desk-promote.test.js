import { describe, it, expect } from 'vitest';
import { PROMOTABLE, promotionPlan } from '../src/lib/desk-promote.js';

// Promoting a reviewed proposal into a live table must be injection-safe:
// table + column names come ONLY from a fixed per-dataset whitelist; every
// value is bound. JSON columns are stringified; the primary key is required.
describe('promotionPlan', () => {
  it('builds a scam_intel plan, defaults slug from the proposal, stringifies JSON cols', () => {
    const plan = promotionPlan(
      'scam_intel',
      'ronin-2022',
      { name: 'Ronin', category: 'bridge hack', approx_loss_usd: 625e6, sources: [{ title: 'x', url: 'https://x' }] },
      null,
    );
    expect(plan.table).toBe('scam_intel');
    expect(plan.pk).toBe('slug');
    // slug defaulted from the proposal slug
    const i = plan.columns.indexOf('slug');
    expect(plan.values[i]).toBe('ronin-2022');
    // sources (a JSON column) stringified
    const s = plan.columns.indexOf('sources');
    expect(typeof plan.values[s]).toBe('string');
    expect(JSON.parse(plan.values[s])[0].url).toBe('https://x');
  });

  it('drops keys that are not whitelisted columns', () => {
    const plan = promotionPlan('scam_intel', 'x', { name: 'ok', evil: "'; DROP TABLE scam_intel;--", nope: 1 }, null);
    expect(plan.columns).not.toContain('evil');
    expect(plan.columns).not.toContain('nope');
    expect(plan.columns).toContain('name');
  });

  it('uses proposal sources when the payload omits them', () => {
    const plan = promotionPlan('scam_intel', 'x', { name: 'ok' }, [{ title: 't', url: 'https://u' }]);
    const s = plan.columns.indexOf('sources');
    expect(s).toBeGreaterThan(-1);
    expect(JSON.parse(plan.values[s])[0].url).toBe('https://u');
  });

  it('dead_chains keys on chain (not slug) and requires it', () => {
    const ok = promotionPlan('dead_chains', 'ignored', { chain: 'Foo', peak_tvl: 100, verdict: 'dead' }, null);
    expect(ok.pk).toBe('chain');
    expect(ok.columns).toContain('chain');
    expect(() => promotionPlan('dead_chains', 'ignored', { peak_tvl: 100 }, null)).toThrow(/primary key|chain/i);
  });

  it('throws on an unknown / non-promotable dataset', () => {
    expect(() => promotionPlan('desk_log', 'x', { a: 1 }, null)).toThrow(/promotable/i);
    expect(() => promotionPlan('bogus', 'x', { a: 1 }, null)).toThrow(/promotable/i);
  });

  it('throws when there is nothing usable beyond the PK', () => {
    expect(() => promotionPlan('scam_intel', 'x', {}, null)).toThrow(/no usable/i);
  });

  it('every whitelisted column is a real column (guards typos)', () => {
    // sanity: known datasets present
    expect(Object.keys(PROMOTABLE).sort()).toEqual(['dead_chains', 'mid_chains', 'risk_signals', 'scam_intel']);
  });
});
