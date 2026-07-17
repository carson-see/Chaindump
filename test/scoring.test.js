import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  WEIGHTS, BOARD_SIZE, INDEX_MIN, INDEX_MAX, MIGRATED,
  DEAD_DRAWDOWN_PCT, DEAD_MIN_SPAN_DAYS, DYING_CHANGE_90D_PCT,
  BASELINE_ABS_FLOOR, BASELINE_PEAK_FRACTION,
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

// The guards that matter. An earlier version of this suite was TAUTOLOGICAL:
// it asserted SCORE_META.formula contained `${WEIGHTS.volume24h*100}%`, i.e.
// expect(x).toContain(x) — both sides read the same constant. A pre-mortem
// mutated WEIGHTS to 70/10/20 and all 24 tests passed while the served formula
// silently became "70% 24h DEX volume". Every assertion below is anchored to a
// HARDCODED literal instead, so the constant, the arithmetic, and the English
// are three independent witnesses. Changing any one alone fails the suite.
describe('the weights are anchored, not self-referential', () => {
  // Derive each weight from scoreRows' OUTPUT. A chain that maxes exactly one
  // axis scores exactly that axis's weight, because the other two normalize to 0.
  const weightOf = (axis) => {
    const maxed = { name: 'MAX', volume24h: 1e9, tvl: 1e9, fees24h: 1e9 };
    const only = { name: 'ONLY', volume24h: 1, tvl: 1, fees24h: 1 };
    only[axis] = 1e9;
    scoreRows([maxed, only]);
    return only.score;
  };

  it('scoreRows ACTUALLY computes 50% volume / 30% TVL / 20% fees', () => {
    expect(weightOf('volume24h')).toBeCloseTo(0.5, 4);
    expect(weightOf('tvl')).toBeCloseTo(0.3, 4);
    expect(weightOf('fees24h')).toBeCloseTo(0.2, 4);
  });

  it('the WEIGHTS constant matches what scoreRows computes', () => {
    expect(WEIGHTS.volume24h).toBeCloseTo(weightOf('volume24h'), 4);
    expect(WEIGHTS.tvl).toBeCloseTo(weightOf('tvl'), 4);
    expect(WEIGHTS.fees24h).toBeCloseTo(weightOf('fees24h'), 4);
    expect(WEIGHTS.volume24h + WEIGHTS.tvl + WEIGHTS.fees24h).toBeCloseTo(1, 6);
  });

  it('the SERVED formula states those same literal weights', () => {
    expect(SCORE_META.formula).toContain('50% 24h DEX volume');
    expect(SCORE_META.formula).toContain('30% TVL');
    expect(SCORE_META.formula).toContain('20% 24h fees');
  });

  it('the board size is 50 in the constant AND in the served prose', () => {
    expect(BOARD_SIZE).toBe(50);
    expect(TIER_CRITERIA.thriving.rule).toContain('top 50');
    expect(SCORE_META.note).toContain('50 chains');
  });
});

describe('prose matches the code it describes', () => {
  it('SCORE_META states the real displayed scale, anchored to literals', () => {
    expect(INDEX_MIN).toBe(1);
    expect(INDEX_MAX).toBe(100);
    expect(SCORE_META.scale).toBe('1-100');
    expect(activityIndex(0, 0, 1)).toBe(1);
    expect(activityIndex(1, 0, 1)).toBe(100);
  });

  it('SCORE_META does not resurrect the "score x 100" claim', () => {
    const prose = `${SCORE_META.formula} ${SCORE_META.note}`;
    expect(prose).toMatch(/NOT score x 100|rescale/i);
    expect(prose).not.toMatch(/(?<!NOT )(is|equals) score x 100/i);
  });

  it('SCORE_META claims the board score is reproducible, and says why the tail is not', () => {
    // Pass 2 rescores board chains on the authoritative per-chain volume, which
    // IS the served volume24h — so this claim must hold. The tail is not
    // enriched, hence the explicit carve-out.
    expect(SCORE_META.inputCaveat).toMatch(/reproducible from this payload/i);
    expect(SCORE_META.inputCaveat).toMatch(/spot DEX categories only/i);
    expect(SCORE_META.inputCaveat).toMatch(/outside the board/i);
  });

  it('SCORE_META refuses to present the index as a health grade', () => {
    expect(SCORE_META.caveat).toMatch(/not a health or quality score/i);
  });

  it('TIER_CRITERIA.thriving admits the ordering — board wins over decline', () => {
    expect(TIER_CRITERIA.thriving.rule).toMatch(/never classed dead or dying/i);
  });

  it('TIER_CRITERIA.dying states AND for the two baseline floors, never OR', () => {
    expect(TIER_CRITERIA.dying.rule).toContain('AND');
    expect(TIER_CRITERIA.dying.rule).not.toMatch(/\$500K,? or /i);
  });

  it('TIER_CRITERIA states the real thresholds, anchored to literals', () => {
    expect(DYING_CHANGE_90D_PCT).toBe(-60);
    expect(DEAD_DRAWDOWN_PCT).toBe(90);
    expect(DEAD_MIN_SPAN_DAYS).toBe(45);
    expect(BASELINE_ABS_FLOOR).toBe(5e5);
    expect(BASELINE_PEAK_FRACTION).toBe(0.02);
    expect(TIER_CRITERIA.dying.rule).toContain('60%');
    expect(TIER_CRITERIA.dying.rule).toContain('$500K');
    expect(TIER_CRITERIA.dying.rule).toContain('2% of peak');
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

// The index the USER sees is actScore() — inline in public/index.html, which
// Vitest cannot import. scoring.js's activityIndex() had zero production
// callers, so extracting it recreated the drift it was meant to kill, one layer
// down. This reads the real client source and holds the two implementations
// together. If they diverge, the served definition stops describing the UI.
describe('the client index matches the served definition', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const src = html.match(/function actScore\(c\)\{[\s\S]*?\n\}/);

  it('actScore still exists in the client (rename = update this test)', () => {
    expect(src).toBeTruthy();
  });

  it('actScore is byte-for-byte the same arithmetic as activityIndex', () => {
    // Rebuild actScore against a fake `state`, then compare over a grid.
    const make = new Function('state', `${src[0]}; return actScore;`);
    for (const board of [[0.2, 0.5, 0.9], [0.5883, 0.7, 0.991], [0.4], [0, 1]]) {
      const client = make({ chains: board.map((score) => ({ score })) });
      const mn = Math.min(...board), mx = Math.max(...board);
      for (const score of board) {
        expect(client({ score })).toBe(activityIndex(score, mn, mx));
      }
    }
  });
});
