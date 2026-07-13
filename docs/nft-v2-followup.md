# NFT / Ordinals v2 — follow-up spec

Requested by Carson 2026-07-13. Restructure shipped same day; "more case
studies" (content) deferred by Carson to a separate effort.

## What to change

1. ✅ **DONE — Make everything searchable** — the curated case-study deep-dives
   are now searchable (by name / chain / status), alongside the existing
   cross-chain catalog search.

2. ⏳ **TODO — More case studies** (content, not code) — expand the ~16
   hand-curated lifecycle deep-dives (in the `nft_collections` table). Keep the
   depth/detail of the existing cards (mint economics, holder/founder
   engagement, royalties, lifespan, community history) — that detail is
   explicitly liked. Research/content generation (verified multi-agent pass).

   **Angle Carson wants (2026-07-13):** cover the full lifecycle spectrum, with
   the *why* as the payload (our value is analysis + aggregation, not a list):
   - **Persisted** — projects still alive/relevant. WHY? active community?
     shipped products? successful pivots?
   - **Dead / dying** — the collapses and what killed them.
   - **Successful beyond web3** — collections/IP that broke out into mainstream
     brands, products, media (e.g. the Pudgy Penguins toys-at-Walmart arc) —
     what made them transcend the NFT floor.
   Group/tag case studies along this spectrum so the section reads as an
   analysis of NFT outcomes, not a directory.

3. ✅ **DONE — Group by chain instead of one flat list** — the catalog is now
   collapsible chain folders (Ethereum 802 ▸, Solana 356 ▸, Ordinals 171 ▸,
   Avalanche 160 ▸, … 17 chains). Open a chain to lazy-load its collections
   (30 at a time, "load more" within the folder); per-collection live detail
   stays on card expand.

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
