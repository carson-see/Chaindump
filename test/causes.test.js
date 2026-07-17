import { describe, it, expect } from 'vitest';
import {
  TAG_CANON, TAG_LABELS, FOLDER_LABELS, FRAUDY,
  canonTag, canonTags, tagLabel, isFraudy, causeVocab,
} from '../src/lib/causes.js';

describe('canonTag', () => {
  it('maps every synonym to its canonical tag', () => {
    expect(canonTag('outcompeted')).toBe('competition');
    expect(canonTag('lost_competition')).toBe('competition');
    expect(canonTag('mercenary_liquidity')).toBe('mercenary_tvl');
    expect(canonTag('lost_narrative')).toBe('narrative_death');
    expect(canonTag('founder_exit')).toBe('team_abandonment');
  });
  it('passes through tags that are already canonical or unknown', () => {
    expect(canonTag('competition')).toBe('competition');
    expect(canonTag('no_real_users')).toBe('no_real_users');
    expect(canonTag('brand_new_tag')).toBe('brand_new_tag');
  });
  it('is idempotent — canonicalizing twice equals once', () => {
    for (const t of Object.keys(TAG_CANON)) expect(canonTag(canonTag(t))).toBe(canonTag(t));
  });
  it('does not resolve inherited Object properties as tags', () => {
    expect(canonTag('constructor')).toBe('constructor');
    expect(canonTag('toString')).toBe('toString');
    expect(canonTag('__proto__')).toBe('__proto__');
  });
  it('tolerates non-string input', () => {
    expect(canonTag(null)).toBe(null);
    expect(canonTag(undefined)).toBe(undefined);
  });
});

describe('every canonical target is labeled', () => {
  // The bug this guards: canonicalizing the rollup while a target has no label
  // renders a raw snake_case bar/chip.
  it('has a short label for every TAG_CANON target', () => {
    for (const target of Object.values(TAG_CANON)) expect(TAG_LABELS[target], target).toBeTruthy();
  });
  it('has a folder label for every TAG_CANON target', () => {
    for (const target of Object.values(TAG_CANON)) expect(FOLDER_LABELS[target], target).toBeTruthy();
  });
  it('never lists a synonym as its own label key (synonyms must collapse)', () => {
    for (const syn of Object.keys(TAG_CANON)) {
      expect(TAG_LABELS[syn], `${syn} should not have its own label`).toBeUndefined();
      expect(FOLDER_LABELS[syn], `${syn} should not have its own folder label`).toBeUndefined();
    }
  });
});

describe('tagLabel — canonicalizes before labeling', () => {
  it('labels a synonym with its CANONICAL label, not a raw fallback', () => {
    // The live bug: chip read "mercenary liquidity" inside the
    // "Mercenary / incentivized TVL exit" folder.
    expect(tagLabel('mercenary_liquidity')).toBe('Mercenary TVL');
    expect(tagLabel('mercenary_liquidity', { folder: true })).toBe('Mercenary / incentivized TVL exit');
    expect(tagLabel('outcompeted')).toBe('Out-competed');
    expect(tagLabel('lost_narrative')).toBe('Narrative death');
    expect(tagLabel('founder_exit')).toBe('Team abandonment');
  });
  it('a synonym and its canonical tag always render identically', () => {
    for (const [syn, canon] of Object.entries(TAG_CANON)) {
      expect(tagLabel(syn)).toBe(tagLabel(canon));
      expect(tagLabel(syn, { folder: true })).toBe(tagLabel(canon, { folder: true }));
    }
  });
  it('falls back readably for an unknown tag', () => {
    expect(tagLabel('some_new_cause')).toBe('some new cause');
    expect(tagLabel('some_new_cause', { folder: true })).toBe('Some New Cause');
  });
  it('returns empty for falsy input', () => {
    expect(tagLabel('')).toBe('');
    expect(tagLabel(null)).toBe('');
  });
});

describe('canonTags — canonicalize + dedupe per chain', () => {
  it('collapses a synonym and its target into one count', () => {
    expect(canonTags(['mercenary_tvl', 'mercenary_liquidity'])).toEqual(['mercenary_tvl']);
    expect(canonTags(['competition', 'outcompeted', 'lost_competition'])).toEqual(['competition']);
  });
  it('preserves distinct tags and order of first appearance', () => {
    expect(canonTags(['narrative_death', 'no_real_users'])).toEqual(['narrative_death', 'no_real_users']);
    expect(canonTags(['lost_narrative', 'no_real_users'])).toEqual(['narrative_death', 'no_real_users']);
  });
  it('handles empty / non-array input', () => {
    expect(canonTags([])).toEqual([]);
    expect(canonTags(null)).toEqual([]);
    expect(canonTags(undefined)).toEqual([]);
  });
});

describe('isFraudy — tests the canonical tag', () => {
  it('flags direct fraud tags', () => {
    expect(isFraudy(['soft_rug'])).toBe(true);
    expect(isFraudy(['exploit_hack', 'no_real_users'])).toBe(true);
    expect(isFraudy(['wash_trading'])).toBe(true);
    expect(isFraudy(['token_unlock_dump'])).toBe(true);
  });
  it('does not flag non-fraud tags', () => {
    expect(isFraudy(['mercenary_tvl', 'competition'])).toBe(false);
    expect(isFraudy([])).toBe(false);
    expect(isFraudy(null)).toBe(false);
  });
  it('would still flag fraud if a synonym were added to TAG_CANON (regression guard)', () => {
    // Guards the latent bug: FRAUDY tested on RAW tags would undercount the
    // moment a synonym maps onto a fraud tag. isFraudy canonicalizes first.
    for (const f of FRAUDY) expect(isFraudy([f])).toBe(true);
  });
});

describe('causeVocab — what the SPA receives', () => {
  it('ships canon + both label sets so the client never re-derives them', () => {
    const v = causeVocab();
    expect(v.canon).toEqual(TAG_CANON);
    expect(v.labels).toEqual(TAG_LABELS);
    expect(v.folderLabels).toEqual(FOLDER_LABELS);
  });
});
