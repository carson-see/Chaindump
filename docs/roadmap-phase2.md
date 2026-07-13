# Chaindump — Phase 2 program

Set by Carson 2026-07-13, after the data-workflow + NFT-v2 restructure shipped.
Execute in order; each phase is its own set of verified deploys. UAT is the very
last thing.

---
## ▶ RESUME HERE (state as of 2026-07-13, end of session 1)

**Standing practices (every task):** pre-mortem before ANY deploy/prod-change ·
code-review the diff · structured debugging (diagnose before guessing) · TDD
(build the missing test harness as you go) · verify live · content accuracy bar
(cite resolving sources, verify figures against the authoritative source —
DefiLlama for TVL, CoinGecko for token price — before publishing; no fabrication;
human-gate anything naming an individual). All detailed in `CLAUDE.md`.

**Done this session:** activeAddresses fix · NFT catalog · RWA/DePIN · scam/OFAC
screening · policy+power reconcile · deep-links · NFT-v2 folder restructure ·
dead/mid collapsible folders · **10 new dead-chain case studies inserted**
(Canto, Moonriver, DeFiChain, KCC, OKExChain, Milkomeda C1, Velas, Wanchain,
Fuse, Conflux — DefiLlama-verified). Design system committed. Docs in repo + the
Google Drive "Chaindump" folder.

**✅ DONE (session 2, 2026-07-13) — stuck/mid case studies finish Phase A content:**
- 8 chains researched + inserted into `mid_chains`: **Tezos** (pivoting),
  **Flow** (drifting), **Hedera** (stalling), **MultiversX** (pivoting),
  **Kaia** (pivoting), **ICP** (pivoting), **IOTA** (pivoting), **Neo**
  (drifting). Migration `migrations/0007_mid_chains_stuck.sql` (idempotent
  INSERT OR REPLACE); applied `--remote` + `--local`; verified live on /mid
  (all 8 render in verdict folders, profiles/sources/token-drop all correct, no
  console errors; mid_chains now 20 total).
- **Verification:** every TVL from DefiLlama `historicalChainTvl/<slug>`; every
  token price/ATH from CoinGecko. Pre-mortem caught two things, handled: (1)
  **Kaia = Klaytn+Finschia merger** — framed as such, with the KLAY heritage ATH
  ($4.34, Mar 2021) noted in prose so the KAIA-ticker drawdown isn't understated;
  (2) **MultiversX** — the research agent flagged its 2025-26 AI/agentic-commerce
  integrations + 9.47% tail-inflation figure as aggregated-news-only, so those
  specifics were softened to the well-sourced facts (Elrond→MultiversX rebrand,
  sharding+WASM, xPortal, serial pivots).
- **⚠ ONE EDITORIAL CALL FOR CARSON — Neo:** the Neo entry names co-founders Da
  Hongfei & Erik Zhang in a **publicly-reported treasury/transparency dispute**
  (late-2025). It's written as *attributed* reporting (sourced to Crypto Briefing
  + CCN, "not findings of wrongdoing"), and they're public project leaders, not
  private individuals — so it's defensible under the accuracy bar. But per the
  human-gate-on-individuals practice, **Carson should confirm he's comfortable
  publishing it** (it's live now; easy to soften/pull the dispute framing if he
  prefers — the rest of the Neo profile stands without it).

Then continue Phases B → H below.
---


**Cross-cutting principle (Carson):** our value everywhere is **analysis +
aggregation**, not raw data. Sourcing must go beyond web3-native outlets —
especially for regulation/policy, pull **direct government sources, mainstream
press, and NPO/standards-body sources**, not just crypto media.

## Phase A — Expand & reorganize all content sections  *(in progress)*
Apply the NFT-v2 treatment (collapsible grouped folders + search + more depth)
across the library sections, and grow case-study coverage.

- ✅ **Dead & Dying** — collapsible folders by cause of death (done, code).
  Content: more fallen-chain case studies (research pass running).
- ✅ **Stuck / Mid** — collapsible folders by verdict (done, code).
  Content: ✅ **+8 case studies inserted** (Tezos, Flow, Hedera, MultiversX,
  Kaia, ICP, IOTA, Neo — DefiLlama/CoinGecko-verified; mid_chains now 20).
- **NFT case studies** — the angle Carson wants (see `nft-v2-followup.md`):
  cover **projects that persisted** (why — active communities? products?
  pivots?), **dead/dying**, and **successful beyond web3** (brands/IP that broke
  out). Analysis over listing.
- **Regulation / policy (geo, US policy)** — expand with updates sourced from
  **government, mainstream, and NPO sources**, not web3 media. Firm local +
  national regulation tracking.
- **Also apply to**: Stablecoins, RWA/DePIN curated, Storage/Verify (infra),
  Treasuries·Miners·ETFs (markets), Global Adoption (geo) — collapsible grouping
  + search + more entries where thin.
- Content generation is a **verified research pass** (cite resolving sources, no
  fabricated figures; adversarial fact-check before publish).

## Phase B — Cron / freshness audit  *(audit ✅ done session 2; remediation pending)*
Verify **every** scheduled job fires and writes fresh data:
- ✅ **5-min snapshot** (`chain_snapshots` + `snapshot_cache:chains`) + delta —
  firing cleanly. Cadence check over the live window: avg 5.0 min, min 4.7 / max
  5.3, **0 gaps >7 min**. `snapshot_cache:chains` stamped current each tick.
- ✅ **90-day prune** (1-in-48 ticks) — logic verified correct: `DELETE ... WHERE
  ts < now_ms − 90d_ms` (units right, ts is ms). NOT over-deleting. (The table
  only spans ~4.7h because snapshots were reseeded ~15:31 on 2026-07-13, not data
  loss; the tier classifier uses DefiLlama's own history, so young snapshots don't
  break `change_90d`.)
- ✅ **Hourly RWA/DePIN** (1-in-12 ticks) — fresh (124 RWA + 50 DePIN, stamped
  within the hour).
- ✅ **growthepie DAA/master** live-retry → D1 last-good — both keys present and
  recent; fallback path working.
- ⚠️ **NFT catalog re-index** — **seed-only, NOT wired into cron** (`nft_catalog`,
  1,972 rows, `indexed_at` frozen at seed time). Source is CoinGecko `/nfts/list`.
  **Remediation:** add `refreshNftCatalog(env)` gated ~weekly (e.g. 1-in-2016
  ticks) and upsert; keep `indexed_at`.
- 🔴 **OFAC `sanctioned_addresses`** — **seed-only, NOT wired (newly-found gap).**
  925 addrs frozen at seed time. This backs live wallet screening in the Scam
  Tracker, so a stale SDN snapshot = **missed sanctioned wallets = compliance
  risk**. Source: 0xB10C OFAC mirror (per-chain text files). **Remediation:** add
  `refreshSanctioned(env)` gated daily (1-in-288 ticks), fetch + upsert, stamp
  `updated_at`. Highest-priority Phase B fix.
- **TDD note:** these two refreshers are the natural moment to stand up the Vitest
  harness (CLAUDE.md §1.1 gap) — the parse/upsert-shape functions are pure and
  testable; write the failing test first.
Confirmed via D1 `updated_at`/`indexed_at`/`ts` freshness per table (2026-07-13).

## Phase C — Build & deploy the redesign
Migrate the live app into the committed design system (`design/`): adopt the
tokens, then the shell (grouped rail, ⌘K), then per-view components, wired to the
real APIs.
- **Idea to fold in:** label the "Top 50" live chains by **our own tier** —
  thriving / stuck-mid / dead-dying — from our rankings, so the live board and
  the forensic sections share one classification.

## Phase D — Agent-readiness / AI-discovery infrastructure  *(after redesign, before UAT)*
Make Chaindump discoverable + usable by AI agents. Full checklist with specs,
skill URLs, and RFC docs in **`agent-readiness.md`**. Summary:
- `/robots.txt` — valid, explicit User-agent rules incl. AI crawlers (GPTBot,
  OAI-SearchBot, Claude-Web, Google-Extended) + Content-Signal directives.
- `/sitemap.xml` — canonical URLs, referenced from robots.txt.
- `Link:` response headers (RFC 8288) on the homepage (api-catalog, service-doc).
- Markdown-for-agents (`Accept: text/markdown` → markdown of the page).
- `/.well-known/api-catalog` (RFC 9727, `application/linkset+json`).
- `/.well-known/mcp/server-card.json` (SEP-1649).
- `/.well-known/agent-skills/index.json` (Agent Skills Discovery RFC).
- OAuth/OIDC discovery + protected-resource metadata + `/auth.md` (only if/when
  we have protected APIs — the x402 agent API may qualify).
- DNS-AID records + WebMCP (`navigator.modelContext.provideContext`) — stretch.

## Phase E — Research & enhancement
Research ways to improve content, usability, and the product; propose + implement
enhancements. (Signals feed, capital-rotation view, richer agent API — see
ROADMAP.md P1/P2.)

## Phase F — MCP server (chain-intel)  *(per Carson via mcp-builder skill)*
Scope + build an MCP server exposing Chaindump's intelligence (chains, signals,
graveyard, scam screening, RWA/DePIN, policy) as agent tools, following the
`anthropic-skills:mcp-builder` workflow (research → implement → test → evals).
TypeScript, streamable HTTP, comprehensive API coverage. Wraps the existing
`/api/agent/*` surface + the new data.

## Phase G — Claude Agent SDK app  *(after MCP, per Carson via new-sdk-app skill)*
Carson delegated the technical decisions ("I'm not technical"). **Scoped calls
(RTE/team, revisit at build time):**
- **Purpose:** an autonomous **Chaindump research desk** — keeps the forensic /
  graveyard / policy / RWA data fresh and sourced, running the same verified
  research loop we do by hand (discover → research → adversarial fact-check →
  cite → persist; no fabrication). Formalizes the existing
  `discovery-workflow.js` / `execute-workflow.js` prototypes into a real,
  scheduled agent.
- **Why it pairs with Phase F:** the Agent SDK app is the *brain that uses
  tools*; the MCP server (F) is the *tools*. The desk agent consumes the
  chain-intel MCP server + web research, so build F first, then G on top of it.
- **Tech:** TypeScript (`@anthropic-ai/claude-agent-sdk`, latest), npm, its own
  subdir (e.g. `agent-desk/`). Runs as a scheduled Node process (Cloud Run job
  or scheduled GitHub Action) — NOT in the Worker (SDK needs a Node runtime).
  Writes to the same D1 via the Worker's authenticated write path, with human
  review gating on anything naming individuals (same accuracy bar as the manual
  passes).
- Latest SDK version + verifier agent (`agent-sdk-verifier-ts`) at build time.

## Phase H — Full UAT clickthrough (Chrome) — THE VERY LAST STEP
After ALL of the above, the complete manual UAT via the browser as the final
gate: each tab loads, every card/folder/search/deep-link works, no console
errors, responsive at 1280px + 375px, agent-discovery endpoints resolve.
Screenshot proof. Log regressions and fix. Nothing ships after this except
regression fixes it surfaces.
