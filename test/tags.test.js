import { describe, it, expect } from 'vitest';
import {
  COHORT_TAGS, THEME_TAGS, ALL_TAGS, TAG_CANON, TAG_LABELS,
  UP_AND_COMING_DAYS, canonTag, canonTags, tagLabel, isCohort, isTheme,
  parseLaunch, cohortFor, tagVocab, themesForCategory,
} from '../src/lib/tags.js';

// Fixed clock. Nothing in this file may depend on the wall clock — cohortFor
// takes `now` precisely so a "up and coming" claim is reproducible in review.
const NOW = Date.parse('2026-07-17T00:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const daysAhead = (n) => new Date(NOW + n * DAY).toISOString().slice(0, 10);

describe('vocabulary shape', () => {
  it('splits cohort and theme tags into two disjoint sets', () => {
    for (const t of COHORT_TAGS) expect(THEME_TAGS, t).not.toContain(t);
    for (const t of THEME_TAGS) expect(COHORT_TAGS, t).not.toContain(t);
  });
  it('exposes the cohort vocabulary the founder directive names', () => {
    for (const t of ['up-and-coming', 'anticipated', 'private-enterprise', 'top-50', 'graveyard', 'stuck']) {
      expect(COHORT_TAGS, t).toContain(t);
    }
  });
  it('carries a watchlist cohort for live chains no board or tier ranks', () => {
    // Bittensor, Tempo, Mezo, Stable and Anubis are covered and live, but sit
    // on no board and in no tier. Without this they would carry no cohort at
    // all; forcing them into up-and-coming would claim a 5-year-old chain is
    // new. Watchlist claims only "we cover it and it has launched".
    expect(COHORT_TAGS).toContain('watchlist');
  });
  it('ALL_TAGS is the union with no duplicates', () => {
    expect(ALL_TAGS).toEqual([...COHORT_TAGS, ...THEME_TAGS]);
    expect(new Set(ALL_TAGS).size).toBe(ALL_TAGS.length);
  });
  it('labels every tag in the vocabulary', () => {
    for (const t of ALL_TAGS) expect(TAG_LABELS[t], t).toBeTruthy();
  });
  it('classifies membership', () => {
    expect(isCohort('up-and-coming')).toBe(true);
    expect(isCohort('l2')).toBe(false);
    expect(isTheme('l2')).toBe(true);
    expect(isTheme('top-50')).toBe(false);
  });
});

describe('canonTag — synonyms collapse', () => {
  it('maps the legacy "emerging" status onto up-and-coming', () => {
    // chain_facts.identity currently carries status:'emerging'. The tag
    // vocabulary has exactly one word for that concept.
    expect(canonTag('emerging')).toBe('up-and-coming');
  });
  it('maps the other known synonyms', () => {
    expect(canonTag('up_and_coming')).toBe('up-and-coming');
    expect(canonTag('upcoming')).toBe('anticipated');
    expect(canonTag('pre-launch')).toBe('anticipated');
    expect(canonTag('dead')).toBe('graveyard');
    expect(canonTag('dying')).toBe('graveyard');
    expect(canonTag('mid')).toBe('stuck');
    expect(canonTag('thriving')).toBe('top-50');
  });
  it('passes through canonical or unknown tags', () => {
    expect(canonTag('up-and-coming')).toBe('up-and-coming');
    expect(canonTag('l2')).toBe('l2');
    expect(canonTag('brand_new')).toBe('brand_new');
  });
  it('is idempotent', () => {
    for (const t of Object.keys(TAG_CANON)) expect(canonTag(canonTag(t))).toBe(canonTag(t));
  });
  it('does not resolve inherited Object properties as tags', () => {
    expect(canonTag('constructor')).toBe('constructor');
    expect(canonTag('__proto__')).toBe('__proto__');
  });
  it('tolerates non-string input', () => {
    expect(canonTag(null)).toBeNull();
    expect(canonTag(undefined)).toBeUndefined();
  });
  it('never lists a synonym as its own label key', () => {
    for (const syn of Object.keys(TAG_CANON)) expect(TAG_LABELS[syn], syn).toBeUndefined();
  });
  it('canonicalizes every synonym onto a real vocabulary tag', () => {
    for (const target of Object.values(TAG_CANON)) expect(ALL_TAGS, target).toContain(target);
  });
});

describe('tagLabel', () => {
  it('labels the cohort tags in the founder\'s words', () => {
    expect(tagLabel('up-and-coming')).toBe('Up and coming');
    expect(tagLabel('anticipated')).toBe('Anticipated');
  });
  it('labels a synonym with its canonical label', () => {
    expect(tagLabel('emerging')).toBe('Up and coming');
    expect(tagLabel('pre-launch')).toBe('Anticipated');
  });
  it('a synonym and its canonical tag always render identically', () => {
    for (const [syn, canon] of Object.entries(TAG_CANON)) expect(tagLabel(syn)).toBe(tagLabel(canon));
  });
  it('falls back readably for an unknown tag', () => {
    expect(tagLabel('some_new_theme')).toBe('Some new theme');
  });
  it('returns empty for falsy input', () => {
    expect(tagLabel('')).toBe('');
    expect(tagLabel(null)).toBe('');
  });
});

describe('canonTags — canonicalize + dedupe', () => {
  it('collapses a synonym and its target into one tag', () => {
    expect(canonTags(['up-and-coming', 'emerging'])).toEqual(['up-and-coming']);
  });
  it('preserves distinct tags in order of first appearance', () => {
    expect(canonTags(['emerging', 'l1'])).toEqual(['up-and-coming', 'l1']);
  });
  it('handles empty / non-array input', () => {
    expect(canonTags([])).toEqual([]);
    expect(canonTags(null)).toEqual([]);
  });
});

describe('parseLaunch — D1 carries mixed granularity', () => {
  it('parses a full date', () => {
    expect(parseLaunch('2026-07-01')).toBe(Date.parse('2026-07-01T00:00:00Z'));
  });
  it('parses month granularity as the FIRST of the month', () => {
    // Deliberate conservative floor: it makes a chain look as OLD as possible,
    // so a "2026-06" chain is never over-claimed as up-and-coming.
    expect(parseLaunch('2026-04')).toBe(Date.parse('2026-04-01T00:00:00Z'));
  });
  it('parses year granularity as Jan 1', () => {
    expect(parseLaunch('2021')).toBe(Date.parse('2021-01-01T00:00:00Z'));
  });
  it('returns null for unknown / missing / junk — never a guess', () => {
    for (const v of [null, undefined, '', '   ', 'unknown', 'TBD', 'soon', 'Summer 2026', {}, NaN]) {
      expect(parseLaunch(v), String(v)).toBeNull();
    }
  });
});

describe('cohortFor — pre-launch', () => {
  it('returns anticipated when isPreLaunch is set, even with no launch date', () => {
    expect(cohortFor({ launched: null, isPreLaunch: true }, NOW)).toBe('anticipated');
  });
  it('returns anticipated for a launch date in the future', () => {
    expect(cohortFor({ launched: daysAhead(1) }, NOW)).toBe('anticipated');
    expect(cohortFor({ launched: daysAhead(400) }, NOW)).toBe('anticipated');
  });
  it('beats every other signal — a pre-launch chain is never ranked', () => {
    expect(cohortFor({ launched: null, isPreLaunch: true, onBoard: true, tier: 'thriving' }, NOW)).toBe('anticipated');
  });
});

describe('cohortFor — the 30-day boundary', () => {
  it('tags 29 days old as up-and-coming', () => {
    expect(cohortFor({ launched: daysAgo(29), onBoard: true }, NOW)).toBe('up-and-coming');
  });
  it('does NOT tag exactly 30 days old — the window is strictly under 30 days', () => {
    expect(cohortFor({ launched: daysAgo(30), onBoard: true }, NOW)).toBe('top-50');
  });
  it('does NOT tag 31 days old', () => {
    expect(cohortFor({ launched: daysAgo(31), onBoard: true }, NOW)).toBe('top-50');
  });
  it('tags a launch today as up-and-coming', () => {
    expect(cohortFor({ launched: daysAgo(0), onBoard: true }, NOW)).toBe('up-and-coming');
  });
  it('up-and-coming outranks the board — the newer fact is the interesting one', () => {
    expect(cohortFor({ launched: daysAgo(5), onBoard: true, tier: 'thriving' }, NOW)).toBe('up-and-coming');
    expect(cohortFor({ launched: daysAgo(5), tier: 'mid' }, NOW)).toBe('up-and-coming');
  });
  it('uses the window constant, not a hardcoded 30', () => {
    expect(UP_AND_COMING_DAYS).toBe(30);
    expect(cohortFor({ launched: daysAgo(UP_AND_COMING_DAYS - 1), onBoard: true }, NOW)).toBe('up-and-coming');
    expect(cohortFor({ launched: daysAgo(UP_AND_COMING_DAYS), onBoard: true }, NOW)).toBe('top-50');
  });
});

describe('cohortFor — unknown launch date never invents a cohort', () => {
  it('an absent launch date does NOT mean pre-launch', () => {
    // The libel guard: Ethereum has no `launched` on the live board. Reading
    // "no launch date" as "anticipated" would publish that Ethereum has not
    // launched. An absent date falls through to the ranked facts instead.
    expect(cohortFor({ launched: null, onBoard: true }, NOW)).toBe('top-50');
    expect(cohortFor({ launched: 'unknown', onBoard: true }, NOW)).toBe('top-50');
  });
  it('never returns up-and-coming without a parseable launch date', () => {
    for (const v of [null, undefined, '', 'unknown', 'Summer 2026']) {
      expect(cohortFor({ launched: v, onBoard: true }, NOW)).not.toBe('up-and-coming');
      expect(cohortFor({ launched: v, tier: 'mid' }, NOW)).not.toBe('up-and-coming');
    }
  });
  it('returns null when nothing is known — the cohort is left off, not guessed', () => {
    expect(cohortFor({}, NOW)).toBeNull();
    expect(cohortFor({ launched: null, tier: null, onBoard: false }, NOW)).toBeNull();
    expect(cohortFor({ launched: 'unknown' }, NOW)).toBeNull();
  });
});

describe('cohortFor — derived from tier / board', () => {
  it('maps the board to top-50', () => {
    expect(cohortFor({ launched: '2015-07', onBoard: true }, NOW)).toBe('top-50');
  });
  it('maps thriving to top-50 even without the board flag', () => {
    expect(cohortFor({ launched: '2015-07', tier: 'thriving' }, NOW)).toBe('top-50');
  });
  it('maps dead and dying to graveyard', () => {
    expect(cohortFor({ launched: '2021-06', tier: 'dead' }, NOW)).toBe('graveyard');
    expect(cohortFor({ launched: '2021-06', tier: 'dying' }, NOW)).toBe('graveyard');
  });
  it('maps mid to stuck', () => {
    expect(cohortFor({ launched: '2019-06', tier: 'mid' }, NOW)).toBe('stuck');
  });
  it('accepts a synonym tier', () => {
    expect(cohortFor({ launched: '2021-06', tier: 'graveyard' }, NOW)).toBe('graveyard');
    expect(cohortFor({ launched: '2019-06', tier: 'stuck' }, NOW)).toBe('stuck');
  });
  it('falls back to private-enterprise for an unranked permissioned chain', () => {
    expect(cohortFor({ launched: '2023-01', isPrivate: true }, NOW)).toBe('private-enterprise');
  });
  it('falls back to watchlist for a live chain nothing else ranks', () => {
    // Bittensor: launched 2021-01, on no board, in no tier.
    expect(cohortFor({ launched: '2021-01' }, NOW)).toBe('watchlist');
    // Tempo: launched 2026-03 — 4 months old, so NOT up-and-coming.
    expect(cohortFor({ launched: '2026-03' }, NOW)).toBe('watchlist');
  });
  it('prefers private-enterprise over watchlist', () => {
    expect(cohortFor({ launched: '2021-01', isPrivate: true }, NOW)).toBe('private-enterprise');
  });
  it('never reaches watchlist without a known past launch date', () => {
    // Watchlist asserts the chain HAS launched. Without a date we cannot say so.
    expect(cohortFor({ launched: 'unknown' }, NOW)).toBeNull();
    expect(cohortFor({}, NOW)).toBeNull();
  });
  it('does not let private-enterprise hide a real board position', () => {
    // Canton is permissioned AND on the board; the board is the harder fact.
    expect(cohortFor({ launched: '2023-01', isPrivate: true, onBoard: true }, NOW)).toBe('top-50');
  });
  it('always returns a tag from the cohort vocabulary, or null', () => {
    const cases = [
      { launched: daysAgo(1) }, { launched: daysAhead(1) }, { isPreLaunch: true },
      { onBoard: true }, { tier: 'dead' }, { tier: 'mid' }, { isPrivate: true }, {},
    ];
    for (const c of cases) {
      const got = cohortFor(c, NOW);
      if (got !== null) expect(COHORT_TAGS, JSON.stringify(c)).toContain(got);
    }
  });
});

describe('cohortFor — determinism', () => {
  it('is pure: the same input and clock always give the same answer', () => {
    const input = { launched: daysAgo(29), onBoard: true };
    expect(cohortFor(input, NOW)).toBe(cohortFor(input, NOW));
  });
  it('accepts a Date as well as epoch millis', () => {
    expect(cohortFor({ launched: daysAgo(29), onBoard: true }, new Date(NOW))).toBe('up-and-coming');
  });
  it('a chain ages out of up-and-coming purely by moving the clock', () => {
    const input = { launched: '2026-07-01', onBoard: true };
    expect(cohortFor(input, Date.parse('2026-07-17T00:00:00Z'))).toBe('up-and-coming');
    expect(cohortFor(input, Date.parse('2026-08-17T00:00:00Z'))).toBe('top-50');
  });
});

describe('themesForCategory — bridges the chainkit taxonomy to themes', () => {
  it('maps every category chainkit can produce', () => {
    expect(themesForCategory('l1-settlement')).toEqual(['l1']);
    expect(themesForCategory('l1-smart-contract')).toEqual(['l1']);
    expect(themesForCategory('l2-optimistic')).toEqual(['l2']);
    expect(themesForCategory('l2-zk')).toEqual(['l2', 'zk']);
    expect(themesForCategory('evm-sidechain')).toEqual(['sidechain', 'evm']);
    expect(themesForCategory('cosmos-appchain')).toEqual(['appchain']);
    expect(themesForCategory('bitcoin-l2')).toEqual(['bitcoin-l2']);
    expect(themesForCategory('gaming-appchain')).toEqual(['appchain', 'gaming']);
    expect(themesForCategory('payments')).toEqual(['payments']);
    expect(themesForCategory('modular-da')).toEqual(['data-availability']);
  });
  it('only ever emits real theme tags', () => {
    for (const cat of ['l1-settlement', 'l1-smart-contract', 'l2-optimistic', 'l2-zk',
      'evm-sidechain', 'cosmos-appchain', 'bitcoin-l2', 'gaming-appchain', 'payments', 'modular-da']) {
      for (const t of themesForCategory(cat)) expect(THEME_TAGS, `${cat} -> ${t}`).toContain(t);
    }
  });
  it('returns empty for an unknown or absent category — never guesses a theme', () => {
    expect(themesForCategory(null)).toEqual([]);
    expect(themesForCategory('something-new')).toEqual([]);
    expect(themesForCategory(undefined)).toEqual([]);
  });
});

describe('tagVocab — what the SPA receives', () => {
  it('ships the split vocabulary + canon + labels so the client never re-derives them', () => {
    const v = tagVocab();
    expect(v.cohorts).toEqual(COHORT_TAGS);
    expect(v.themes).toEqual(THEME_TAGS);
    expect(v.canon).toEqual(TAG_CANON);
    expect(v.labels).toEqual(TAG_LABELS);
    expect(v.upAndComingDays).toBe(UP_AND_COMING_DAYS);
  });
});
