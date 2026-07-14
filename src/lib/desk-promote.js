// Promote a reviewed desk proposal into a live table. INJECTION-SAFE by design:
// the target table + column names come ONLY from the fixed whitelist below
// (never from the proposal), and every value is bound as a `?` param by the
// caller. JSON-typed columns are stringified. Tested by test/desk-promote.test.js.

export const PROMOTABLE = {
  scam_intel: {
    table: 'scam_intel',
    pk: 'slug',
    columns: ['slug', 'name', 'category', 'chain', 'approx_loss_usd', 'incident_date', 'severity',
      'credibility', 'status', 'culpable', 'connections', 'summary', 'how_it_happened', 'what_stolen',
      'aftermath', 'links', 'sources', 'debate_notes'],
    json: ['connections', 'links', 'sources'],
  },
  dead_chains: {
    table: 'dead_chains',
    pk: 'chain',
    columns: ['chain', 'launched', 'peak_tvl', 'current_tvl', 'drawdown_pct', 'peak_date', 'why',
      'outlook', 'verdict', 'sources', 'profile'],
    json: ['sources', 'profile'],
  },
  mid_chains: {
    table: 'mid_chains',
    pk: 'chain',
    columns: ['chain', 'launched', 'tvl', 'verdict', 'why_stuck', 'outlook', 'profile', 'sources'],
    json: ['profile', 'sources'],
  },
  risk_signals: {
    table: 'risk_signals',
    pk: 'slug',
    columns: ['slug', 'target', 'target_name', 'chain', 'signal_type', 'severity', 'description',
      'evidence', 'matched_addresses', 'matched_cases', 'status', 'confidence', 'sources'],
    json: ['evidence', 'matched_addresses', 'matched_cases', 'sources'],
  },
};

/**
 * Build a safe INSERT plan for promoting a proposal.
 * @returns {{ table: string, pk: string, columns: string[], values: unknown[] }}
 * @throws if the dataset isn't promotable, the PK is missing, or there's nothing usable.
 */
export function promotionPlan(dataset, proposalSlug, payload, proposalSources) {
  const spec = PROMOTABLE[dataset];
  if (!spec) throw new Error(`dataset "${dataset}" is not promotable`);
  const p = { ...(payload || {}) };
  // slug-keyed tables default their PK from the proposal slug if the payload omits it
  if (spec.pk === 'slug' && (p.slug == null || String(p.slug).trim() === '')) p.slug = proposalSlug;
  // fall back to the proposal's verified sources if the payload didn't carry them
  if (proposalSources != null && p.sources == null) p.sources = proposalSources;
  if (p[spec.pk] == null || String(p[spec.pk]).trim() === '') {
    throw new Error(`missing primary key "${spec.pk}" for ${dataset}`);
  }
  const columns = [];
  const values = [];
  for (const col of spec.columns) {
    if (!(col in p) || p[col] == null) continue;
    let v = p[col];
    if (spec.json.includes(col) && typeof v !== 'string') v = JSON.stringify(v);
    columns.push(col);
    values.push(v);
  }
  if (columns.length < 2) throw new Error(`payload has no usable columns for ${dataset}`);
  return { table: spec.table, pk: spec.pk, columns, values };
}
