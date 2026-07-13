-- Live RWA + DePIN breadth to supplement the curated rwa_depin case studies.
-- RWA is a TVL story (DefiLlama RWA category, ~150 protocols); DePIN is a
-- token/market-cap story (CoinGecko DePIN category), not TVL — hence two shapes.
CREATE TABLE IF NOT EXISTS rwa_live (
  slug TEXT PRIMARY KEY,        -- normalized protocol name
  name TEXT,
  tvl REAL,
  chains TEXT,                  -- JSON array of chain names
  url TEXT,
  logo TEXT,
  change_1d REAL,
  change_7d REAL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rwa_live_tvl ON rwa_live(tvl DESC);

CREATE TABLE IF NOT EXISTS depin_live (
  id TEXT PRIMARY KEY,          -- coingecko coin id
  name TEXT,
  symbol TEXT,
  mcap REAL,
  price REAL,
  change_24h REAL,
  volume_24h REAL,
  image TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_depin_live_mcap ON depin_live(mcap DESC);
