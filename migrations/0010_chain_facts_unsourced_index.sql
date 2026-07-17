-- 0010_chain_facts_unsourced_index.sql — standing audit hook for CLAUDE.md §1.5.
-- Lists exactly the chain_facts rows that publish research with no citations
-- (sources IS NULL). This partial index makes that check cheap; the query
-- itself (SELECT chain, dimension FROM chain_facts WHERE sources IS NULL)
-- is expected to always return zero rows.
CREATE INDEX IF NOT EXISTS idx_chain_facts_unsourced
  ON chain_facts (chain, dimension)
  WHERE sources IS NULL;
