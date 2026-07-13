-- Live NFT/Ordinals catalog: the full CoinGecko collection universe (~2000
-- collections across ~17 chains) for a searchable/filterable browse experience,
-- separate from the hand-curated nft_collections lifecycle case studies.
CREATE TABLE IF NOT EXISTS nft_catalog (
  id TEXT PRIMARY KEY,          -- coingecko collection id
  name TEXT,
  chain TEXT,                   -- coingecko asset_platform_id
  contract_address TEXT,
  symbol TEXT,
  indexed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nft_catalog_chain ON nft_catalog(chain);
CREATE INDEX IF NOT EXISTS idx_nft_catalog_name ON nft_catalog(name COLLATE NOCASE);

-- On-demand enriched detail (floor / mcap / 24h volume / holders / thumbnail),
-- fetched from CoinGecko per-collection only when a user opens a card, cached
-- so we stay within the Demo key's rate limit.
CREATE TABLE IF NOT EXISTS nft_detail (
  id TEXT PRIMARY KEY,
  data TEXT,                    -- JSON: floorUsd, mcapUsd, vol24hUsd, holders, supply, thumb, desc, links
  updated_at INTEGER
);
