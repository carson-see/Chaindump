-- OFAC-sanctioned digital-currency addresses (US Treasury SDN list), multi-chain.
-- Authoritative government public record — used for wallet screening in the Scam
-- Tracker. Source: OFAC SDN list, mirrored by github.com/0xB10C/ofac-sanctioned-
-- digital-currency-addresses. address stored lowercased for case-insensitive match.
CREATE TABLE IF NOT EXISTS sanctioned_addresses (
  address_lc TEXT NOT NULL,      -- lowercased address for matching
  address TEXT NOT NULL,          -- original-case address for display
  chain TEXT NOT NULL,            -- ETH, XBT(BTC), TRX, XMR, ...
  source TEXT DEFAULT 'OFAC SDN',
  updated_at INTEGER,
  PRIMARY KEY (address_lc, chain)
);
CREATE INDEX IF NOT EXISTS idx_sanctioned_addr ON sanctioned_addresses(address_lc);
