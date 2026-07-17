import { describe, it, expect } from 'vitest';
import {
  WEIGHTS, BOARD_SIZE, INDEX_MIN, INDEX_MAX, MIGRATED,
  scoreRows, activityIndex, baselineOk, classifyTier,
  SCORE_META, TIER_CRITERIA,
} from '../src/lib/scoring.js';

const onBoard = (names) => (n) => new Set(names).has(n);
const nrm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

describe('scoreRows', () => {
  it('weights the three axes 50/30/20 and normalizes to the field maximum', () => {
    const rows = [
      { name: 'A', volume24h: 1e9, tvl: 1e9, fees24h: 1e6 },
      { name: 'B', volume24h: 1e3, tvl: 1e3, fees24h: 1e1 },
    ];
    scoreRows(rows);
    // Top of every axis normalizes to 1 → weights sum to 1.
    expect(rows[0].score).toBeCloseTo(1, 4);
    expect(rows[1].score).toBeLessThan(rows[0].score);
    expect(rows[1].score).toBeGreaterThan(0);
  });

  it('log-scales, so a 1000x volume gap is not a 1000x score gap', () => {
    const rows = [
      { name: 'A', volume24h: 1e9, tvl: 1e6, fees24h: 1e4 },
      { name: 'B', volume24h: 1e6, tvl: 1e6, fees24h: 1e4 },
    ];
    scoreRows(rows);
    expect(rows[0].score / rows[1].score).toBeLessThan(1.5);
  });

  it('treats zero/absent inputs as 1 rather than producing -Infinity', () => {
    const rows = [
      { name: 'A', volume24h: 1e9, tvl: 1e9, fees24h: 1e6 },
      { name: 'Z', volume24h: 0, tvl: 0, fees24h: 0 },
    ];
    scoreRows(rows);
    expect(rows[1].score).toBe(0);
    expect(Number.isFinite(rows[1].score)).toBe(true);
  });
});

describe('activityIndex', () => {
  it('rescales to 1-100 across the board: best is 100, worst is 1', () => {
    expect(activityIndex(0.9, 0.5, 0.9)).toBe(INDEX_MAX);
    expect(activityIndex(0.5, 0.5, 0.9)).toBe(INDEX_MIN);
    // Midpoint lands mid-scale (50/51 depending on float rounding), not at 70.
    expect(activityIndex(0.7, 0.5, 0.9)).toBeGreaterThanOrEqual(50);
    expect(activityIndex(0.7, 0.5, 0.9)).toBeLessThanOrEqual(51);
  });

  it('is NOT score x 100 — the regression the served note used to claim', () => {
    // Raw 0.55 with a board spanning 0.55-0.85. "score x 100" would say 55.
    expect(activityIndex(0.55, 0.55, 0.85)).toBe(1);
    expect(activityIndex(0.85, 0.55, 0.85)).toBe(100);
    expect(activityIndex(0.85, 0.55, 0.85)).not.toBe(85);
  });

  it('returns the max when the field is degenerate (single chain / no spread)', () => {
    expect(activityIndex(0.4, 0.4, 0.4)).toBe(INDEX_MAX);
    expect(activityIndex(0, 0, 0)).toBe(INDEX_MAX);
  });

  it('never emits 0 or a value outside 1-100', () => {
    for (const s of [0, 0.001, 0.25, 0.5, 0.999, 1]) {
      const v = activityIndex(s, 0, 1);
      expect(v).toBeGreaterThanOrEqual(INDEX_MIN);
      expect(v).toBeLessThanOrEqual(INDEX_MAX);
    }
  });
});

describe('baselineOk', () => {
  it('requires BOTH floors — $500K AND 2% of peak (the "or" the prose used to claim)', () => {
    // $600K clears the absolute floor but not 2% of a $100M peak ($2M).
    expect(baselineOk(6e5, 1e8)).toBe(false);
    expect(baselineOk(3e6, 1e8)).toBe(true);
  });

  it('rejects a baseline under the absolute floor even on a tiny peak', () => {
    expect(baselineOk(1e5, 1e6)).toBe(false);
    expect(baselineOk(6e5, 1e6)).toBe(true);
  });

  it('rejects null/zero baselines', () => {
    expect(baselineOk(null, 1e8)).toBe(false);
    expect(baselineOk(0, 1e8)).toBe(false);
  });
});

describe('classifyTier', () => {
  const board = onBoard(['Ethereum']);

  it('puts a live-board chain in thriving before decline is considered', () => {
    const m = { chain: 'Ethereum', spanDays: 400, drawdown_pct: 95, change_90d: -80 };
    expect(classifyTier(m, board, nrm)).toBe('thriving');
  });

  it('classes a 90%+ drawdown with enough history as dead', () => {
    expect(classifyTier({ chain: 'Blast', spanDays: 200, drawdown_pct: 93, change_90d: -70 }, board, nrm)).toBe('dead');
  });

  it('will not call a chain dead on under 45 days of history', () => {
    expect(classifyTier({ chain: 'New', spanDays: 44, drawdown_pct: 99, change_90d: null }, board, nrm)).toBe('mid');
  });

  it('excludes migrated/rebranded chains from dead', () => {
    const m = { chain: 'Fantom', spanDays: 400, drawdown_pct: 99, change_90d: null };
    expect(classifyTier(m, board, nrm)).toBe('mid');
    for (const name of MIGRATED) expect(MIGRATED.has(nrm(name))).toBe(true);
  });

  it('classes -60% or worse over 90d as dying, but -59% as mid', () => {
    expect(classifyTier({ chain: 'X', spanDays: 120, drawdown_pct: 50, change_90d: -60 }, board, nrm)).toBe('dying');
    expect(classifyTier({ chain: 'X', spanDays: 120, drawdown_pct: 50, change_90d: -59.9 }, board, nrm)).toBe('mid');
  });

  it('falls back to mid when 90d change is unknown', () => {
    expect(classifyTier({ chain: 'X', spanDays: 120, drawdown_pct: 50, change_90d: null }, board, nrm)).toBe('mid');
  });
});

// These are the guards that matter: the published prose IS a claim about the
// code (CLAUDE.md 1.5). Every one of these caught a real live defect.
describe('prose matches the code it describes', () => {
  it('SCORE_META states the real weights', () => {
    expect(SCORE_META.formula).toContain(`${WEIGHTS.volume24h * 100}% 24h DEX volume`);
    expect(SCORE_META.formula).toContain(`${WEIGHTS.tvl * 100}% TVL`);
    expect(SCORE_META.formula).toContain(`${WEIGHTS.fees24h * 100}% 24h fees`);
  });

  it('SCORE_META states the real displayed scale', () => {
    expect(SCORE_META.scale).toBe(`${INDEX_MIN}-${INDEX_MAX}`);
  });

  it('SCORE_META does not resurrect the "score x 100" claim', () => {
    const prose = `${SCORE_META.formula} ${SCORE_META.note}`;
    expect(prose).toMatch(/NOT score x 100|rescale/i);
    expect(prose).not.toMatch(/(?<!NOT )(is|equals) score x 100/i);
  });

  it('SCORE_META refuses to present the index as a health grade', () => {
    expect(SCORE_META.caveat).toMatch(/not a health or quality score/i);
  });

  it('TIER_CRITERIA.thriving admits the ordering — board wins over decline', () => {
    expect(TIER_CRITERIA.thriving.rule).toContain(`top ${BOARD_SIZE}`);
    expect(TIER_CRITERIA.thriving.rule).toMatch(/never classed dead or dying/i);
  });

  it('TIER_CRITERIA.dying states AND for the two baseline floors, never OR', () => {
    expect(TIER_CRITERIA.dying.rule).toContain('AND');
    expect(TIER_CRITERIA.dying.rule).not.toMatch(/\$500K,? or /i);
  });

  it('TIER_CRITERIA states the real thresholds', () => {
    expect(TIER_CRITERIA.dying.rule).toContain('60%');
    expect(TIER_CRITERIA.dead.rule).toContain('90%');
    expect(TIER_CRITERIA.dead.rule).toContain('45 days');
  });

  it('every tier the classifier can return has published criteria', () => {
    for (const t of ['thriving', 'mid', 'dying', 'dead']) {
      expect(TIER_CRITERIA[t]).toBeTruthy();
      expect(TIER_CRITERIA[t].rule.length).toBeGreaterThan(20);
    }
  });
});
