# Chain Dossier Schema v1

> **Status (2026-07-16): partially implemented.** The `chain_facts` table exists
> (migration `0009`) and is **seeded for 10 chains** (74 rows) by the research
> desk, out of band. **No worker route reads it yet** — the SPA still renders from
> the slim `dead_chains`/`mid_chains` profile. Treat the sections below as the
> contract the desk writes to, not as behaviour the API exposes today.

> The consistent set of data points every chain in Chaindump's intelligence
> library must carry. Produced by the **research desk** (specialist team), not a
> single generalist. Turns prose profiles into a typed, sourced, comparable
> dataset — so "intelligence" means reasoned, cited conclusions, not aggregation.

## Principles (non-negotiable)

1. **Every material figure carries a source** — a `source_url` and an `as_of`
   date. No number is published without a resolving, authoritative source (§1.5).
2. **Unsourced → `null`**, and the field is listed in `unsourced_fields`. Never
   fabricate, estimate, or silently interpolate.
3. **Authoritative sources are fixed per dimension** — token = CoinGecko (record
   the `token_cg_id` for reproducibility); TVL/fees = DefiLlama; sanctions = OFAC
   SDN; policy/criminal = government/court/mainstream, never web3 media alone.
4. **Controlled vocabularies** for every enum (below). No free-text where an enum
   exists — that is what makes the dataset queryable.
5. **A private individual named as a wrongdoer is human-review-gated**, never
   auto-published.
6. **The editor validates against this schema before write** — a schema-invalid
   or unparseable dossier is rejected, not written (the gate that would have
   caught the malformed `Morph` row).
7. **Confidence is explicit** — every dossier exposes `confidence` and
   `data_completeness_pct` so a consumer knows how solid it is.

## The desk → schema ownership

| Specialist | Owns |
|---|---|
| Markets & Tokenomics | `token` block |
| Capital & Cap-table | `capital` block |
| On-chain Fundamentals | `onchain` block |
| Team & Governance | `team` block |
| Narrative & Competition | `narrative` block |
| Risk & Forensics | `risk` block |
| **Lead Analyst** | `synthesis` block (reasons across all six) |
| **Editor / Verifier** | `provenance` block; validates + gates the write |

---

## Schema

### A. `identity` — classification (our classifier + editor)
| field | type | notes |
|---|---|---|
| `chain` | string (PK) | canonical DefiLlama name |
| `aliases` | string[] | former names, tickers, DefiLlama variants |
| `category` | enum | `L1` \| `L2_rollup` \| `L2_validium` \| `sidechain` \| `appchain` \| `other` |
| `vm` | enum | `EVM` \| `SVM` \| `MoveVM` \| `CosmWasm` \| `Cairo` \| `WASM` \| `other` |
| `launched` | `YYYY-MM` | mainnet genesis (note if DefiLlama first-tracked differs) |
| `status` | enum | `dead` \| `zombie` \| `declining` \| `stagnating` \| `pivoting` \| `recovering` \| `quietly_building` |

### B. `token` — markets & tokenomics (CoinGecko)
| field | type | notes |
|---|---|---|
| `token_symbol` | string \| null | null if no native token (record what gas is paid in) |
| `token_cg_id` | string \| null | CoinGecko id — for reproducible re-pulls |
| `token_ath_usd` / `token_ath_date` | number / date | |
| `token_current_usd` / `as_of` | number / date | |
| `price_drawdown_pct` | number (derived) | |
| `market_cap_usd`, `fdv_usd` | number \| null | |
| `circulating_supply`, `total_supply`, `max_supply` | number \| null | |
| `unlock_overhang_pct` | number \| null | % of supply still to unlock |

### C. `capital` — funding (disclosures, The Block, Crunchbase/CryptoRank)
| field | type | notes |
|---|---|---|
| `total_raised_usd` | number \| null | |
| `rounds` | array | `{stage, date, amount_usd, lead, investors[], valuation_usd, source_url}` |
| `treasury_usd` | number \| null | |
| `backers_tier` | enum | `tier1` \| `tier2` \| `mixed` \| `none_unknown` (derived signal) |

### D. `onchain` — fundamentals (DefiLlama, Token Terminal)
| field | type | notes |
|---|---|---|
| `tvl_peak_usd` / `tvl_peak_date` | number / date | |
| `tvl_current_usd` / `as_of` | number / date | |
| `tvl_drawdown_pct` | number (derived) | |
| `stablecoin_tvl_usd` | number \| null | |
| `active_addresses_daily` | number \| null | |
| `tx_or_volume_daily` | number \| null | |
| `fees_30d_usd`, `revenue_30d_usd` | number \| null | |
| `dev_activity_monthly` | number \| null | monthly active devs |
| `tvl_concentration` | `{top_protocol, pct, note}` | is TVL one or two protocols? |

### E. `team` — team & governance (primaries, court/SEC filings)
| field | type | notes |
|---|---|---|
| `founders` | array | `{name, role, prior, source_url}` |
| `entity` | string | legal org / foundation |
| `key_events` | array | `{date, type, description, source_url}` — type ∈ `launch` \| `fork` \| `rebrand` \| `layoff` \| `scandal` \| `exploit` \| `regulatory` \| `wind_down` |
| `regulatory_status` | string \| null | |

### F. `narrative` — narrative & competition
| field | type | notes |
|---|---|---|
| `purpose` | string | one sentence |
| `positioning` | string | how it framed itself |
| `competitors` | array | `{name, relationship}` — who took the market |
| `narrative_arc` | string | launch → now story |
| `media_sentiment` | enum | `bullish` \| `mixed` \| `bearish` \| `toxic` (+ note) |

### G. `risk` — risk & forensics (OFAC, incident reports, audits)
| field | type | notes |
|---|---|---|
| `exploits` | array | `{date, amount_usd, type, source_url}` |
| `sanctions` | `{flagged: bool, detail}` | OFAC SDN |
| `extraction_flags` | string[] | `soft_rug` \| `wash_trading` \| `insider_concentration` \| … |
| `audit_status` | string \| null | |

### H. `synthesis` — the reasoning (Lead Analyst; cites A–G)
| field | type | notes |
|---|---|---|
| `situation` | prose | what is happening now, anchored to the data above |
| `postmortem` | prose | root cause |
| `lessons_learned` | string[3] | |
| `could_differ` | prose | counterfactual |
| `outlook` | `{bull, base, bear, most_likely}` | |
| `cause_tags` | string[3-5] | controlled vocab (see `graveyard_meta` tag set) |
| `confidence` | enum | `high` \| `medium` \| `low` — from source quality + coverage |

### I. `provenance` — meta (Editor)
| field | type | notes |
|---|---|---|
| `sources` | array | `{title, url, dimension}` — deduped master list |
| `data_completeness_pct` | number (derived) | % of applicable fields sourced |
| `unsourced_fields` | string[] | explicit gaps |
| `last_reviewed` | date | |

---

## Storage (split, v1)

The desk produces a ~21KB structured dossier per chain. A single agent cannot be
trusted to re-emit that verbatim on write (it summarizes and drops blocks — proven
in the Scroll/Osmosis pilot), so storage is **split** into a slim render layer and
a structured dataset layer:

- **`dead_chains` / `mid_chains`.`profile`** — the **slim render profile** (~4KB):
  the render-facing keys the SPA reads (`founded`, `founders`, `raised`,
  `token_symbol`, `token_ath`, `token_ath_date`, `token_current`, `purpose`,
  `situation`, `postmortem`, `non_economic`, `lessons_learned`, `could_differ`,
  `outlook`, `cause_tags`, `sources`). Small enough to write reliably; keeps the
  human-facing `/api/dead` response lean.
- **`chain_facts(chain, dimension, data, sources, updated_at)`** (migration
  `0009`) — the **structured dataset**: one row per (chain, dimension) block
  (`identity`|`token`|`capital`|`onchain`|`team`|`narrative`|`risk`|`synthesis`)
  plus a `_meta` row holding `{completeness, confidence, unsourced_fields}` and the
  deduped master source list. Each block is small enough for its specialist to
  write reliably. Queryable via `json_extract` for cohort aggregates, cause-tag
  rollups, cross-chain comparisons, and to drive the aggregate analysis
  programmatically instead of by hand.

Backward-compatible: the SPA is unchanged; the structured layer lives beside it.
**Later:** promote hot numeric fields (`tvl_current_usd`, `token_ath_usd`,
`total_raised_usd`, …) to real `chain_facts` columns, or expose a dataset/agent
endpoint, if consumers query facts directly.

## Quality gates (editor)

1. JSON parses and validates against this schema, or the write is rejected.
2. Every non-null material figure has a resolving `source_url`.
3. Enums conform to their controlled vocab.
4. `data_completeness_pct` and `confidence` computed and stored.
5. Any private-individual wrongdoing claim → `human_review` flag, not published.
