import { describe, it, expect } from 'vitest';
import { monthKey, pruneStaleQuota } from '../src/lib/x402.js';

describe('monthKey', () => {
  it('derives a stable UTC year-month key', () => {
    expect(monthKey(new Date('2026-07-14T00:00:00Z'))).toBe('2026-6'); // getUTCMonth is 0-based
  });

  it('changes on month rollover but not within a month', () => {
    const jul1 = monthKey(new Date('2026-07-01T00:00:00Z'));
    const jul31 = monthKey(new Date('2026-07-31T23:59:59Z'));
    const aug1 = monthKey(new Date('2026-08-01T00:00:00Z'));
    expect(jul1).toBe(jul31);
    expect(aug1).not.toBe(jul31);
  });
});

describe('pruneStaleQuota', () => {
  it('drops entries whose monthKey does not match the current month', () => {
    const quota = {
      '1.1.1.1': { count: 3, monthKey: '2026-5' }, // last month
      '2.2.2.2': { count: 1, monthKey: '2026-6' }, // current
      '3.3.3.3': { count: 9, monthKey: '2026-4' }, // older
    };
    const removed = pruneStaleQuota(quota, '2026-6');
    expect(removed).toBe(2);
    expect(Object.keys(quota)).toEqual(['2.2.2.2']);
  });

  it('leaves the current month untouched (identical behavior)', () => {
    const quota = {
      'a': { count: 1, monthKey: '2026-6' },
      'b': { count: 2, monthKey: '2026-6' },
    };
    const before = JSON.parse(JSON.stringify(quota));
    const removed = pruneStaleQuota(quota, '2026-6');
    expect(removed).toBe(0);
    expect(quota).toEqual(before);
  });

  it('removes malformed / null entries', () => {
    const quota = { 'a': null, 'b': { count: 1, monthKey: '2026-6' } };
    const removed = pruneStaleQuota(quota, '2026-6');
    expect(removed).toBe(1);
    expect(Object.keys(quota)).toEqual(['b']);
  });

  it('is a no-op on an empty or missing map', () => {
    expect(pruneStaleQuota({}, '2026-6')).toBe(0);
    expect(pruneStaleQuota(null, '2026-6')).toBe(0);
  });
});
