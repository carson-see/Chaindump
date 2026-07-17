// Single source of truth for the cause-of-death vocabulary.
//
// Research agents write free-text `cause_tags` (dead_chains) and
// `success_factors_missing` (mid_chains) into the D1 profile JSON. Several tags
// are synonyms for one concept, so everything that counts, groups, or labels a
// tag MUST canonicalize first — otherwise one concept fragments into two bars,
// two folders, or a chip whose wording disagrees with the folder above it.
//
// This module is the only place the vocabulary is defined. The worker imports it;
// the SPA receives it over the wire (`trends.causeVocab` on /api/dead) rather
// than hand-mirroring a copy — four hand-synced copies is how the labels drifted.

// Synonym → canonical tag.
export const TAG_CANON = {
  outcompeted: 'competition',
  lost_competition: 'competition',
  mercenary_liquidity: 'mercenary_tvl',
  lost_narrative: 'narrative_death',
  founder_exit: 'team_abandonment',
};

export const canonTag = (t) => (typeof t === 'string' && Object.hasOwn(TAG_CANON, t) ? TAG_CANON[t] : t);

// Short labels — trends bars and per-chain cause chips.
export const TAG_LABELS = {
  mercenary_tvl: 'Mercenary TVL', airdrop_farming: 'Airdrop farming', points_collapse: 'Points collapse',
  token_unlock_dump: 'Token unlock dump', exploit_hack: 'Exploit / hack', team_abandonment: 'Team abandonment',
  soft_rug: 'Soft rug', unsustainable_yield: 'Unsustainable yield', narrative_death: 'Narrative death',
  no_real_users: 'No real users', wash_trading: 'Wash trading', vc_dump: 'VC dump',
  competition: 'Out-competed', regulatory: 'Regulatory',
  token_overhang: 'Token overhang', declining_volume: 'Declining volume', wrong_ecosystem_bet: 'Wrong-ecosystem bet',
  tech_no_adoption: 'Tech, no adoption', no_killer_app: 'No killer app', no_product_market_fit: 'No product-market fit',
  weak_dev_ecosystem: 'Weak dev ecosystem', governance_failure: 'Governance failure', bridge_hack: 'Bridge hack',
  security_failure: 'Security failure', ftx_contagion: 'FTX contagion', centralization: 'Centralization',
  token_inflation: 'Token inflation', insider_concentration: 'Insider concentration',
  misallocated_treasury: 'Misallocated treasury', gamed_metrics: 'Gamed metrics', double_counted_tvl: 'Double-counted TVL',
  // mid_chains `success_factors_missing` vocabulary (the "what's missing" gaps).
  // NOTE: this vocabulary is fragmented (~45 tags for ~10 concepts) and mixes
  // polarity — some tags name the deficit (no_killer_app), others the factor
  // (product_market_fit). Labels only here; consolidating it needs an editorial
  // pass, tracked for the unified chain-scoring work.
  unclear_positioning: 'Unclear positioning', no_liquidity_moat: 'No liquidity moat',
  fading_community: 'Fading community', faded_hype: 'Faded hype',
  developer_ecosystem: 'Developer ecosystem', developer_mindshare: 'Developer mindshare',
  global_developer_mindshare: 'Developer mindshare', defi_liquidity_depth: 'DeFi liquidity depth',
  defi_liquidity: 'DeFi liquidity', deep_liquidity: 'Deep liquidity', defi_ecosystem_depth: 'DeFi ecosystem depth',
  value_capturing_token: 'Value-capturing token', token_value_accrual: 'Token value accrual',
  no_value_capture: 'No value capture', product_market_fit: 'Product-market fit',
  sustainable_revenue: 'Sustainable revenue', retained_active_users: 'Retained active users',
  retail_killer_app: 'Retail killer app', durable_killer_app: 'Durable killer app',
  narrative_momentum: 'Narrative momentum', narrative_consistency: 'Narrative consistency',
  market_narrative: 'Market narrative', market_trust: 'Market trust',
  regulatory_clarity: 'Regulatory clarity', governance_stability: 'Governance stability',
  leadership_alignment: 'Leadership alignment', treasury_transparency: 'Treasury transparency',
  decentralization_credibility: 'Decentralization credibility', clear_identity: 'Clear identity',
  poor_distribution: 'Poor distribution', demand_matching_tech: 'Demand matching tech',
  value_beyond_incentives: 'Value beyond incentives',
};

// Verbose labels — the collapsible cause folders in the graveyard.
export const FOLDER_LABELS = {
  mercenary_tvl: 'Mercenary / incentivized TVL exit', points_collapse: 'Points-farming collapse',
  airdrop_farming: 'Airdrop-farming exodus', token_unlock_dump: 'Token unlock dump', vc_dump: 'VC / insider dump',
  exploit_hack: 'Hack / exploit', bridge_hack: 'Bridge hack', team_abandonment: 'Team abandonment',
  soft_rug: 'Soft rug', unsustainable_yield: 'Unsustainable yield', narrative_death: 'Narrative death',
  no_real_users: 'No real users', no_product_market_fit: 'No product-market fit', no_killer_app: 'No killer app',
  wash_trading: 'Wash-traded volume', competition: 'Out-competed', misallocated_treasury: 'Misallocated treasury',
  regulatory: 'Regulatory', token_overhang: 'Token overhang', declining_volume: 'Declining volume',
  wrong_ecosystem_bet: 'Wrong-ecosystem bet', tech_no_adoption: 'Tech, no adoption',
  weak_dev_ecosystem: 'Weak dev ecosystem', governance_failure: 'Governance failure',
  security_failure: 'Security failure', ftx_contagion: 'FTX contagion', centralization: 'Centralization',
  token_inflation: 'Token inflation', insider_concentration: 'Insider concentration',
  gamed_metrics: 'Gamed metrics', double_counted_tvl: 'Double-counted TVL', other: 'Other / mixed causes',
};

// Tags that mark suspected fraud/extraction. Membership is tested on the
// CANONICAL tag so adding a synonym to TAG_CANON can never silently undercount.
export const FRAUDY = new Set(['soft_rug', 'exploit_hack', 'wash_trading', 'token_unlock_dump']);

const titleize = (t) => String(t).replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// Human label for a tag (canonicalizes first). `folder` picks the verbose set.
export function tagLabel(tag, { folder = false } = {}) {
  if (!tag) return '';
  const k = canonTag(tag);
  const map = folder ? FOLDER_LABELS : TAG_LABELS;
  if (Object.hasOwn(map, k)) return map[k];
  // unknown tag: folders read as headings, chips read inline
  return folder ? titleize(k) : String(k).replaceAll('_', ' ');
}

// Canonicalize + de-duplicate one chain's tag list, so a chain carrying both a
// synonym and its canonical target counts once.
export function canonTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(canonTag))];
}

export const isFraudy = (tags) => canonTags(tags).some((t) => FRAUDY.has(t));

// The vocabulary handed to the SPA so it never re-derives a copy.
export function causeVocab() {
  return { canon: TAG_CANON, labels: TAG_LABELS, folderLabels: FOLDER_LABELS };
}
