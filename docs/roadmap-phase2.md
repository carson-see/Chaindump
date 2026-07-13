# Chaindump — Phase 2 program

Set by Carson 2026-07-13, after the data-workflow + NFT-v2 restructure shipped.
Execute roughly in order; each phase is its own set of verified deploys.

## Phase A — Expand & reorganize all content sections
Apply the NFT-v2 treatment (collapsible grouped folders + search + more depth)
across the other library sections, and grow their case-study coverage.

- **Dead & Dying** (`dead_chains`, 26 entries) — group into collapsible folders
  (by death cause / cause_tags, or era), add more fallen-chain case studies.
  Keep the trends panel + "why they died" cause breakdown.
- **Stuck / Mid** (`mid_chains`, 12) — collapsible folders (by verdict:
  stalling / drifting / pivoting / quietly-building), more entries.
- **Also apply to**: Stablecoins, RWA/DePIN curated, Storage/Verify (infra),
  Treasuries·Miners·ETFs (markets), Global Adoption (geo), NFT case studies —
  collapsible grouping + search + more entries where thin.
- Content generation (new case studies) is research/sourcing work — accuracy
  matters (cite sources, no fabricated figures). Best done as a verified pass.

## Phase B — Cron / freshness audit
Verify **every** scheduled job actually fires and writes fresh data:
- 5-min snapshot (`chain_snapshots` + `snapshot_cache`), delta computation.
- 90-day snapshot prune (1-in-48 ticks).
- Hourly RWA/DePIN refresh (`refreshRwaDepin`, 1-in-12 ticks).
- growthepie DAA/master live-retry (currently CF-blocked → D1 last-good).
- NFT catalog re-index (currently seed-only, no auto-refresh wired — decide
  cadence + wire it).
- Any others added in Phase A.
Confirm via Cloudflare cron logs + D1 `updated_at` freshness per table.

## Phase C — Build & deploy the redesign
Migrate the live app into the committed design system (`design/`): adopt the
tokens (deep-dark + Signal Amber, 4-tier text), then the shell (grouped rail,
⌘K), then per-view components. Wired to the real APIs (the mockup is mock data).

## Phase D — Research & enhancement
Research ways to improve content, usability, and the product overall; propose +
implement enhancements. (Signals feed, capital-rotation view, richer agent API,
etc. — see ROADMAP.md P1/P2 for prior ideas.)

## Phase E — Full UAT clickthrough (Chrome) — THE VERY LAST STEP
After everything above (content, crons, redesign, enhancements) is in, do the
complete manual UAT via the browser as the final gate: each tab loads, every
card/folder/search/deep-link works, no console errors, responsive at 1280px +
375px. Screenshot proof. Log any regressions and fix. Nothing ships after this
except regression fixes it surfaces.
