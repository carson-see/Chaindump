-- 0009_chain_facts.sql — retroactive migration for the per-chain research profile table.
-- chain_facts predates this file: it was created directly against prod D1 and had no
-- migration backing it, so the schema was unreproducible from source. This is that
-- schema, transcribed from prod (sqlite_master) verbatim. IF NOT EXISTS makes it a
-- no-op against prod and a parity build for --local / fresh databases.
--
-- One row per (chain, dimension). `data` is a JSON profile whose shape varies by
-- dimension (capital, identity, token, onchain, team, narrative, risk, synthesis,
-- links, _meta). `sources` is a JSON array of {title, url} citations.
--
-- CLAUDE.md §1.5: every material figure in `data` must be traceable to a resolving,
-- authoritative source listed in `sources`. A published row with sources NULL or []
-- is a policy violation — see the partial index below, which exists to make such
-- rows cheap to find.
CREATE TABLE IF NOT EXISTS chain_facts (
  chain      TEXT NOT NULL,
  dimension  TEXT NOT NULL,   -- capital | identity | token | onchain | team | narrative | risk | synthesis | links | _meta
  data       TEXT,            -- JSON profile; shape varies by dimension
  sources    TEXT,            -- JSON array of {title, url}; must support every material figure in `data`
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (chain, dimension)
);

-- Standing audit hook: lists exactly the rows that publish claims with no citations.
-- Expected to return zero rows.
CREATE INDEX IF NOT EXISTS idx_chain_facts_unsourced
  ON chain_facts (chain, dimension)
  WHERE sources IS NULL;
