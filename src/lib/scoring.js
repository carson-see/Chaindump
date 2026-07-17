// Single source of truth for the activity index and the tier classifier.
//
// Why this module exists: the score formula and the tier rules used to live as
// executable code in worker.js AND as prose in two other places (a SCORE_META
// blob and a copy inside public/index.html). The prose drifted from the code
// before it ever shipped — the served note claimed "index = score × 100" while
// the UI actually min-max rescaled to 1–100. Rules and the English that
// describes them now live side by side here, and tests assert they agree.
// Same pattern as ./causes.js.

export const WEIGHTS = { volume24h: 0.5, tvl: 0.3, fees24h: 0.2 };

/** Chains ranked onto the live board. */
export const BOARD_SIZE = 50;

/** Displayed index bounds (activityIndex floors at 1, never 0). */
export const INDEX_MIN = 1;
export const INDEX_MAX = 100;

/** Dead: drawdown from peak, in %, with a minimum history window. */
export const DEAD_DRAWDOWN_PCT = 90;
export const DEAD_MIN_SPAN_DAYS = 45;

/** Dying: 90d TVL change, in %, over a minimum history window. */
export const DYING_CHANGE_90D_PCT = -60;
export const CHANGE_90D_MIN_SPAN_DAYS = 90;

/** A 90-days-ago baseline must clear BOTH floors to be trusted (guards new-chain blowups). */
export const BASELINE_ABS_FLOOR = 5e5;
export const BASELINE_PEAK_FRACTION = 0.02;

/** Chains whose TVL moved in a rebrand/chain-swap — not genuine deaths. */
export const MIGRATED = new Set(['fantom', 'terra', 'terraclassic', 'celo']);

const lg = (x) => Math.log10(Math.max(1, x));

/**
 * The raw 0–1 composite. Log-scales each axis and normalizes it to the largest
 * value across `rows`, so the score is relative to the current field.
 * Mutates each row's `score` and returns rows (as buildSnapshot expects).
 */
export function scoreRows(rows) {
  const maxV = Math.max(...rows.map((r) => lg(r.volume24h)), 1);
  const maxT = Math.max(...rows.map((r) => lg(r.tvl)), 1);
  const maxF = Math.max(...rows.map((r) => lg(r.fees24h)), 1);
  for (const r of rows) {
    r.score = +(
      WEIGHTS.volume24h * (lg(r.volume24h) / maxV) +
      WEIGHTS.tvl * (lg(r.tvl) / maxT) +
      WEIGHTS.fees24h * (lg(r.fees24h) / maxF)
    ).toFixed(4);
  }
  return rows;
}

/**
 * The DISPLAYED index: a min-max rescale of the raw composite across the served
 * board, to 1–100. This is not `score × 100` — the top chain is always 100 and
 * the bottom is always 1, whatever their raw scores were. Kept here so the
 * prose in SCORE_META can be tested against the arithmetic.
 */
export function activityIndex(score, min, max) {
  if (!(max > min)) return INDEX_MAX;
  const s = score || 0;
  return Math.round(INDEX_MIN + ((s - min) / (max - min)) * (INDEX_MAX - INDEX_MIN));
}

/** Is a 90-days-ago TVL baseline non-trivial enough to compute a change from? */
export function baselineOk(ago90, peak) {
  return !!ago90 && ago90 >= Math.max(BASELINE_ABS_FLOOR, peak * BASELINE_PEAK_FRACTION);
}

/** Has this chain collapsed from its peak, by the measured rule? */
function collapsedFromPeak(m, normalize) {
  return m.spanDays >= DEAD_MIN_SPAN_DAYS
    && m.drawdown_pct >= DEAD_DRAWDOWN_PCT
    && !MIGRATED.has(normalize(m.chain));
}

/**
 * The classifier, as one pure decision.
 *
 * `thriving` used to be returned for ANY chain on the board, before decline was
 * ever considered — and that was a real, published falsehood. Berachain sits at
 * board rank ~41 on live activity while down 98.5% from its $3.31B peak (BERA is
 * -98.7% from an ATH set on launch day; its market cap now exceeds the TVL it
 * secures). By DEAD_DRAWDOWN_PCT the same chain is dead. We called it thriving.
 *
 * Both facts are true, so the honest answer is neither label: a chain can be
 * genuinely active TODAY and still have lost ~all of the capital it once held.
 * That is `zombie`. It keeps us from libelling a live chain as collapsed AND
 * from flattering a -98% chain as thriving — the two failure directions of the
 * old short-circuit.
 *
 * @param {{spanDays:number, drawdown_pct:number, change_90d:number|null, chain:string}} m
 * @param {(name:string)=>boolean} onBoard
 * @param {(name:string)=>string} normalize
 */
export function classifyTier(m, onBoard, normalize) {
  if (onBoard(m.chain)) return collapsedFromPeak(m, normalize) ? 'zombie' : 'thriving';
  if (collapsedFromPeak(m, normalize)) return 'dead';
  if (m.change_90d != null && m.change_90d <= DYING_CHANGE_90D_PCT) return 'dying';
  return 'mid';
}

/** Every tier classifyTier can return. */
export const TIERS = ['thriving', 'zombie', 'mid', 'dying', 'dead'];

// --- Prose. Served to the UI and to agents; must describe the code above. ---

export const SCORE_META = {
  name: 'Activity index',
  scale: `${INDEX_MIN}-${INDEX_MAX}`,
  kind: 'relative composite',
  formula: `${WEIGHTS.volume24h * 100}% 24h DEX volume + ${WEIGHTS.tvl * 100}% TVL + ${WEIGHTS.fees24h * 100}% 24h fees. Each input is log-scaled and divided by the largest value in the field, producing a raw 0-1 composite; the displayed index then rescales that composite across the chains on the board so the most active is ${INDEX_MAX} and the least active is ${INDEX_MIN}.`,
  caveat: `Measures relative activity among live tracked chains. NOT a health or quality score — a low index on a smaller chain is expected, and the index moves when other chains move.`,
  note: `The score field in this payload is the raw 0-1 composite. The displayed index is NOT score x 100: it is a min-max rescale of score across the ${BOARD_SIZE} chains on the board, to ${INDEX_MIN}-${INDEX_MAX}. Rank the score field directly rather than reconstructing the index.`,
  inputCaveat: `For chains on the board, the volume input IS the volume24h field in this payload: DefiLlama's authoritative per-chain 24h DEX volume, spot DEX categories only (derivatives, prediction markets, NFT marketplaces and aggregators are excluded). Score is therefore reproducible from this payload. Chains outside the board are ranked on a provisional score built from the summed per-protocol DEX breakdown, which under-reports any chain the DEX feed names differently from the TVL feed.`,
};

export const TIER_CRITERIA = {
  thriving: {
    label: 'Thriving',
    rule: `Currently on the live board — one of the top ${BOARD_SIZE} chains ranked by the composite activity index (${WEIGHTS.volume24h * 100}% 24h DEX volume, ${WEIGHTS.tvl * 100}% TVL, ${WEIGHTS.fees24h * 100}% 24h fees, log-scaled) — AND not collapsed from its all-time peak. Measures current activity, not health or quality.`,
  },
  zombie: {
    label: 'Active but collapsed',
    rule: `On the live top-${BOARD_SIZE} board by current activity, yet down ${DEAD_DRAWDOWN_PCT}% or more from its all-time TVL peak (with at least ${DEAD_MIN_SPAN_DAYS} days of history). Both readings are real: the chain is genuinely being used today and has still lost almost all of the capital it once held. It is neither "thriving" nor "dead", and we will not round it to either.`,
  },
  mid: {
    label: 'Mid',
    rule: `Everything else in the classified universe (the top 100 chains by TVL with at least $1M TVL) that is neither on the live top-${BOARD_SIZE} board, dead, nor dying.`,
  },
  dying: {
    label: 'Dying',
    rule: `TVL down ${Math.abs(DYING_CHANGE_90D_PCT)}% or more over the last 90 days — requires at least ${CHANGE_90D_MIN_SPAN_DAYS} days of TVL history and a 90-days-ago baseline that clears both floors: at least $500K AND at least ${BASELINE_PEAK_FRACTION * 100}% of peak TVL.`,
  },
  dead: {
    label: 'Dead',
    rule: `TVL drawdown of ${DEAD_DRAWDOWN_PCT}% or more from its all-time peak with at least ${DEAD_MIN_SPAN_DAYS} days of TVL history; chains whose TVL migrated in a rebrand or chain swap (Fantom, Terra, Terra Classic, Celo) are excluded.`,
  },
  curatedNote: "Chains covered by the research desk (Dead & Dying / Stuck) carry curated verdicts from their case studies, which override the computed classification — open the section to read the case study.",
  computedNote: 'These are activity classifications computed from market data (DefiLlama TVL history and the live activity board), not health verdicts.',
};
