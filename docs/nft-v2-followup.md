# NFT / Ordinals v2 — follow-up spec

Queued to pick up **after** the current data workflow (scam forensics →
policy/power reconcile → deep-links) is done. Requested by Carson 2026-07-13.

## What to change

1. **Make everything searchable** — not just the live catalog. The curated
   case-study deep-dives need to be searchable too (single search across both
   curated case studies and the full catalog, or clearly-scoped search on each).

2. **More case studies** — expand the ~16 hand-curated lifecycle deep-dives
   (currently in the `nft_collections` table). Keep the depth/detail of the
   existing cards (mint economics, holder/founder engagement, royalties,
   lifespan, community history) — that detail is explicitly liked. Add more
   collections across more chains, successful and failed.

3. **Group by chain instead of one flat list** — the catalog is currently a
   flat paginated list of ~2000 collections. Restructure so **chain is a
   collapsible folder**, and the collections live inside their chain's group:
   - Ethereum (802) ▸ … collections
   - Solana (356) ▸ … collections
   - Ordinals (171) ▸ …
   - Avalanche (160) ▸ …
   - etc.
   Expand a chain to see its collections; the per-collection live detail
   (floor/mcap/volume/holders/thumbnail) stays on card expand as it is now.

## Implementation notes (from the current build)

- Live catalog data: `nft_catalog` table (id/name/chain/contract/symbol),
  ~1,972 rows across 17 chains, seeded from CoinGecko `/nfts/list`.
- Per-collection detail: `nft_detail` cache + `/api/nft-collection/:id`
  (CoinGecko `/nfts/{id}`, Demo key, 30-min cache).
- Catalog list API: `/api/nft-catalog?q=&chain=&page=` already supports
  chain-filtering and returns per-chain facet counts — the chain-folder UI can
  reuse the facets for the folder list and lazy-load each chain's collections.
- Curated case studies: `nft_collections` table, rendered via `genLibrary`.
- Frontend: `renderNft` / `renderCatalog` in `public/index.html`.
