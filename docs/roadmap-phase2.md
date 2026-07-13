# Chaindump — Phase 2 program

Set by Carson 2026-07-13, after the data-workflow + NFT-v2 restructure shipped.
Execute in order; each phase is its own set of verified deploys. UAT is the very
last thing.

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
  Content: more entries (research pass running).
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

## Phase B — Cron / freshness audit
Verify **every** scheduled job fires and writes fresh data:
- 5-min snapshot (`chain_snapshots` + `snapshot_cache`) + delta computation.
- 90-day snapshot prune (1-in-48 ticks).
- Hourly RWA/DePIN refresh (1-in-12 ticks).
- growthepie DAA/master live-retry (CF-blocked → D1 last-good).
- NFT catalog re-index (seed-only now — decide cadence + wire it).
Confirm via Cloudflare cron logs + D1 `updated_at` freshness per table.

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

## Phase F — MCP server (chain-intel)  *(the last build, per Carson via mcp-builder skill)*
Scope + build an MCP server exposing Chaindump's intelligence (chains, signals,
graveyard, scam screening, RWA/DePIN, policy) as agent tools, following the
`anthropic-skills:mcp-builder` workflow (research → implement → test → evals).
TypeScript, streamable HTTP, comprehensive API coverage. Wraps the existing
`/api/agent/*` surface + the new data. Do this **after everything else above**.

## Phase G — Full UAT clickthrough (Chrome) — THE VERY LAST STEP
After ALL of the above, the complete manual UAT via the browser as the final
gate: each tab loads, every card/folder/search/deep-link works, no console
errors, responsive at 1280px + 375px, agent-discovery endpoints resolve.
Screenshot proof. Log regressions and fix. Nothing ships after this except
regression fixes it surfaces.
