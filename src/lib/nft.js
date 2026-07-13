// Pure, testable helpers for re-indexing the NFT catalog from CoinGecko's
// /nfts/list endpoint (the full collection universe, paginated).
// The DB side (paged fetch + upsert) lives in refreshNftCatalog() in worker.js.

export const NFT_LIST_URL = 'https://api.coingecko.com/api/v3/nfts/list';
export const NFT_PER_PAGE = 250; // CoinGecko max page size

// Map one /nfts/list page (array of collection objects) into nft_catalog rows.
// Keeps only entries with a stable id. chain = CoinGecko asset_platform_id.
export function nftRowsFromPage(page, now) {
  if (!Array.isArray(page)) return [];
  const rows = [];
  for (const c of page) {
    if (!c || !c.id) continue;
    rows.push({
      id: String(c.id),
      name: c.name || null,
      chain: c.asset_platform_id || null,
      contract_address: c.contract_address || null,
      symbol: c.symbol || null,
      indexed_at: now,
    });
  }
  return rows;
}

// De-duplicate accumulated rows by id (later pages win). Returns an array.
export function dedupeNftRows(rows) {
  const byId = new Map();
  for (const r of rows) if (r && r.id) byId.set(r.id, r);
  return [...byId.values()];
}
