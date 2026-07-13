-- Cron-refreshed snapshot cache (instant reads) + time-series backbone for
-- flow/delta signals (roadmap P0-3). Populated by the Worker's scheduled() handler.

CREATE TABLE IF NOT EXISTS snapshot_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chain_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  chain TEXT NOT NULL,
  tvl REAL,
  volume24h REAL,
  fees24h REAL,
  stables REAL,
  active_addresses INTEGER,
  token_price REAL,
  token_mcap REAL,
  score REAL
);
CREATE INDEX IF NOT EXISTS idx_chain_snapshots_chain_ts ON chain_snapshots(chain, ts);
CREATE INDEX IF NOT EXISTS idx_chain_snapshots_ts ON chain_snapshots(ts);
