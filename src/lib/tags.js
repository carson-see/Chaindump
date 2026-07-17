// Single source of truth for the chain TAG vocabulary.
//
// Same reason as ./causes.js: a vocabulary that lives in more than one place
// drifts. This one already started to — `chain_facts.identity` carries a free
// -text `status` field whose values ('emerging', 'anticipated', 'declining')
// overlap the cohort concept but are NOT the same rule, and the tier
// classifier in ./scoring.js has a third vocabulary again ('thriving', 'mid',
// 'dying', 'dead'). Everything that counts, groups, filters or labels a chain
// tag MUST canonicalize through here first.
//
// Two axes, deliberately disjoint:
//   COHORT — where a chain sits in its lifecycle. Exactly one per chain,
//            computed by cohortFor() from dates + board position.
//   THEME  — what a chain IS. Zero or more per chain, curated, never computed.
//
// The split matters because they answer different questions: "is this new?"
// vs "is this a payments chain?". A chain can be top-50 AND a payments chain;
// it cannot be top-50 AND graveyard.

// --- The vocabulary -------------------------------------------------------

/** Lifecycle position. Exactly one per chain (or none, if unknown). */
export const COHORT_TAGS = [
  'anticipated',        // announced, not yet launched
  'up-and-coming',      // launched inside the UP_AND_COMING_DAYS window
  'top-50',             // on the live activity board
  'stuck',              // classified mid — live but going sideways
  'graveyard',          // dead or dying
  'private-enterprise', // permissioned / consortium, not publicly ranked
  'watchlist',          // launched and covered, but no board or tier ranks it
];

/** What the chain is. Zero or more per chain. Curated — never computed. */
export const THEME_TAGS = [
  'l1', 'l2', 'sidechain', 'appchain', 'bitcoin-l2',
  'rwa', 'payments', 'gaming', 'ai', 'btcfi', 'defi', 'nft',
  'stablecoin-native', 'privacy', 'zk', 'evm', 'non-evm', 'data-availability',
  'corporate-parent', 'permissioned', 'institutional',
];

export const ALL_TAGS = [...COHORT_TAGS, ...THEME_TAGS];

/** The up-and-coming window, in days. Strictly less than this counts. */
export const UP_AND_COMING_DAYS = 30;

// Synonym → canonical tag. The left side is every spelling the codebase, the
// research desk, or the tier classifier has actually produced.
export const TAG_CANON = {
  // the `status` values already sitting in chain_facts.identity
  emerging: 'up-and-coming',
  'pre-launch': 'anticipated',
  prelaunch: 'anticipated',
  upcoming: 'anticipated',
  // spelling drift
  up_and_coming: 'up-and-coming',
  upandcoming: 'up-and-coming',
  top50: 'top-50',
  // the ./scoring.js tier vocabulary, so a tier can be fed in directly
  thriving: 'top-50',
  mid: 'stuck',
  dying: 'graveyard',
  dead: 'graveyard',
  // theme drift
  layer1: 'l1',
  layer2: 'l2',
  rollup: 'l2',
  enterprise: 'permissioned',
  consortium: 'permissioned',
  stablecoin: 'stablecoin-native',
};

export const canonTag = (t) => (typeof t === 'string' && Object.hasOwn(TAG_CANON, t) ? TAG_CANON[t] : t);

export const TAG_LABELS = {
  // cohorts — the founder's words, verbatim, for the two that matter
  'up-and-coming': 'Up and coming',
  anticipated: 'Anticipated',
  'top-50': 'Top 50',
  stuck: 'Stuck',
  graveyard: 'Graveyard',
  'private-enterprise': 'Private / enterprise',
  watchlist: 'Watchlist',
  // themes
  l1: 'L1', l2: 'L2', sidechain: 'Sidechain', appchain: 'Appchain', 'bitcoin-l2': 'Bitcoin L2',
  rwa: 'RWA', payments: 'Payments', gaming: 'Gaming', ai: 'AI', btcfi: 'BTCfi',
  defi: 'DeFi', nft: 'NFT', 'stablecoin-native': 'Stablecoin-native', privacy: 'Privacy',
  zk: 'ZK', evm: 'EVM', 'non-evm': 'Non-EVM', 'corporate-parent': 'Corporate-backed',
  permissioned: 'Permissioned', institutional: 'Institutional',
  'data-availability': 'Data availability',
};

// The chainkit.js value-prop taxonomy (CHAIN_CATEGORY / deriveCategory) is the
// desk's curated answer to "what is this chain". It predates this vocabulary,
// so rather than re-curate ~130 chains, themes are bridged from it. Categories
// chainkit cannot resolve map to nothing — the chain gets no theme rather than
// a guessed one.
export const CATEGORY_THEMES = {
  'l1-settlement': ['l1'],
  'l1-smart-contract': ['l1'],
  'l2-optimistic': ['l2'],
  'l2-zk': ['l2', 'zk'],
  'evm-sidechain': ['sidechain', 'evm'],
  'cosmos-appchain': ['appchain'],
  'bitcoin-l2': ['bitcoin-l2'],
  'gaming-appchain': ['appchain', 'gaming'],
  payments: ['payments'],
  'modular-da': ['data-availability'],
};

/** Theme tags implied by a chainkit category. Unknown category → []. */
export function themesForCategory(cat) {
  return typeof cat === 'string' && Object.hasOwn(CATEGORY_THEMES, cat) ? [...CATEGORY_THEMES[cat]] : [];
}

const COHORT_SET = new Set(COHORT_TAGS);
const THEME_SET = new Set(THEME_TAGS);

export const isCohort = (t) => COHORT_SET.has(canonTag(t));
export const isTheme = (t) => THEME_SET.has(canonTag(t));

/** Human label for a tag (canonicalizes first). */
export function tagLabel(tag) {
  if (!tag) return '';
  const k = canonTag(tag);
  if (Object.hasOwn(TAG_LABELS, k)) return TAG_LABELS[k];
  const s = String(k).replaceAll('_', ' ').replaceAll('-', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Canonicalize + de-duplicate one chain's tag list. */
export function canonTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(canonTag))];
}

// --- Launch dates ---------------------------------------------------------

/**
 * Parse a launch date out of what D1 actually holds — mixed granularity
 * ('2026-07-01', '2026-04', '2021') and a lot of honest unknowns (null,
 * 'unknown', prose like 'Summer 2026').
 *
 * Returns epoch millis (UTC) or null. NEVER guesses: prose and empty values
 * return null so the caller leaves the cohort off rather than inventing one.
 *
 * Month/year granularity floors to the first of the period. That is a
 * deliberate conservative bias: flooring makes a chain look as OLD as
 * possible, so a coarse '2026-06' can never be over-claimed as "up and
 * coming". It under-claims instead, which is the safe direction for a
 * published claim.
 *
 * @returns {number|null}
 */
export function parseLaunch(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return Date.parse(`${m[1]}-${m[2]}-01T00:00:00Z`);
  if ((m = /^(\d{4})$/.exec(s))) return Date.parse(`${m[1]}-01-01T00:00:00Z`);
  return null; // 'unknown', 'TBD', 'Summer 2026', '' — all honestly unknown
}

// --- The cohort rule ------------------------------------------------------

/**
 * The cohort classifier, as one pure decision.
 *
 * `now` is a REQUIRED parameter, not Date.now(), so that a published
 * "up and coming" claim is reproducible in review and testable at the
 * boundary. Order is load-bearing — see the comments per branch.
 *
 * @param {{launched?:string|Date|number|null, onBoard?:boolean, tier?:string|null,
 *          isPreLaunch?:boolean, isPrivate?:boolean}} m
 * @param {number|Date} now
 * @returns {string|null} a COHORT_TAGS member, or null when nothing is known
 */
export function cohortFor(m, now) {
  const o = m || {};
  const nowMs = now instanceof Date ? now.getTime() : now;
  const launched = parseLaunch(o.launched);
  const tier = canonTag(o.tier);
  // An 'anticipated' TIER asserts the same thing as the isPreLaunch flag. Owning
  // that here stops every caller from having to OR it in to cover a gap.
  const preLaunch = o.isPreLaunch === true || tier === 'anticipated';

  // 1. Pre-launch. A known date decides; absent a date, the assertion decides.
  //
  //    Note what is NOT here: "no date means unlaunched". Absence of a date is
  //    not evidence of non-launch — Ethereum carries no `launched` on the live
  //    board, and that rule would have published that Ethereum hasn't launched.
  //
  //    And the assertion must not outlive reality. isPreLaunch has no expiry:
  //    Miden's row says status='anticipated', expected 'early September 2026'.
  //    Ship it, nobody hand-edits the row, and we would call a live chain
  //    Anticipated forever. A known PAST launch date is evidence the assertion
  //    is stale, and evidence beats assertion.
  if (launched != null ? launched > nowMs : preLaunch) return 'anticipated';

  // 2. Under 30 days old. Strictly under — at exactly 30 days the chain ages
  //    out. Requires a parseable date; an unknown date can never land here.
  if (launched != null && (nowMs - launched) < UP_AND_COMING_DAYS * 86400000) return 'up-and-coming';

  // 3. Otherwise derive from the hard ranked facts.
  //
  //    top-50 comes from the LIVE board and nowhere else. A stored 'top-50' tag
  //    is a claim that expires: the board's tail churns every 5 minutes (Ronin
  //    fell off it mid-backfill), and 48 of our 130 rows carry one. Honouring a
  //    stored tag would republish a rank the chain no longer holds — Somnia sits
  //    at 49 today, and at 51 tomorrow it would still read "Top 50". graveyard
  //    and stuck are different in kind: researched desk verdicts, not a rank, and
  //    they do not go stale on a 5-minute clock.
  if (o.onBoard === true) return 'top-50';
  if (tier === 'graveyard') return 'graveyard';
  if (tier === 'stuck') return 'stuck';

  // 4. A permissioned chain we monitor that no board or tier ranks. Checked
  //    last so it can never hide a real board position (Canton is both).
  if (o.isPrivate === true) return 'private-enterprise';

  // 5. Launched, covered, but unranked (Bittensor, Tempo, Mezo, Stable,
  //    Anubis). Requires a known PAST launch date — watchlist asserts the
  //    chain has actually launched, so an unknown date can never reach here.
  if (launched != null) return 'watchlist';

  // 6. Nothing known. Leave the cohort off rather than invent one.
  return null;
}

/** The vocabulary handed to the SPA so it never re-derives a copy. */
export function tagVocab() {
  return {
    cohorts: COHORT_TAGS,
    themes: THEME_TAGS,
    canon: TAG_CANON,
    labels: TAG_LABELS,
    upAndComingDays: UP_AND_COMING_DAYS,
  };
}
