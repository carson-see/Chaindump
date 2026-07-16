-- Structured "Chain Dossier" dataset layer (see docs/chain-dossier-schema.md).
-- Produced by the specialist research desk: one row per (chain, dimension) block,
-- plus a '_meta' row holding dossier-level quality. The slim render profile stays
-- in dead_chains/mid_chains; the queryable, comparable dataset lives here so the
-- heavy structured blocks never bloat the human-facing /api/dead response.
CREATE TABLE IF NOT EXISTS chain_facts (
  chain      TEXT NOT NULL,
  dimension  TEXT NOT NULL,   -- identity|token|capital|onchain|team|narrative|risk|synthesis|_meta
  data       TEXT,            -- JSON: the dimension block (or {completeness,confidence,unsourced_fields} for _meta)
  sources    TEXT,            -- JSON array of {title,url}; the deduped master list lives on the _meta row
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (chain, dimension)
);
CREATE INDEX IF NOT EXISTS idx_chain_facts_chain ON chain_facts(chain);
