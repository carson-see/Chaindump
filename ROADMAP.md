# Chain Monitor → Blockchain Intelligence Platform — Roadmap

Product vision: a real-time blockchain *intelligence* layer that answers "what is changing, why, and what should I do" — not "what is biggest". Serves humans (no-scroll web UI) and autonomous AI agents (versioned, provenance-tagged API + MCP tools). Moves up the ladder: levels → deltas → flows → attribution → causation → recommendation.

Target users & jobs: Builders (where to deploy, organic vs bought growth) · Researchers (sector truth, citable) · Funds (capital rotation before it's priced in, survives diligence) · Risk/Security (blast radius, anomalies) · Journalists (attributed, citable stories) · Ecosystem/BD (incentive efficiency) · Autonomous AI agents (capital routing, risk exits, reports).

## P0 — NOW
1. Kill horizontal scroll — `table-layout:fixed` + drop blanket `td` nowrap + responsive card stack ≤680px + `overflow-x:clip` page guard.
2. Peer-context pills on the 4 fundamentals (median pass over top-25; "cheap/rich vs peers").
3. `chain_snapshots` poller — server cron writing (chain, ts, tvl, dex_24h, fees_24h, rev_24h, stables_usd, daa, native_price). Backbone for all flow/2nd-derivative signals.
4. Signal engine v1 — price-adjusted capital rotation, stablecoin migration, volume/TVL acceleration, wash-trading detectors → Signals Feed panel.
5. Agent API v1 — /api/agent/v1/{summary,signals,chain/{key},graveyard} with envelope, closed enums, provenance, confidence.
6. Trust nits — dedupe optimism/opmainnet description; align refresh copy with TTL.

## P1 — NEXT
7. Capital Rotation view (net TVL + stablecoin flow between chains/sectors, price-stripped).
8. Incentive-Efficiency / Real-Earnings screener (rank by revenue − incentives, revenue-per-active-user).
9. L2 Ecosystem Health Scorecard (growthepie radar + MoM + peer percentile).
10. Agent-refreshed living descriptions (chain_analysis.description; static map = fallback).
11. Comparative + causal momentumText (peer ranks + anomaly flags into prose).
12. MCP server (chain-intel) wrapping the signal engine.
13. SSE + webhook push off the signal engine.
14. Context/attribution layer v1 (dual-denomination TVL, regulatory calendar, BTC-dominance regime banner).

## P2 — LATER
15. Sector/Narrative heatmap · 16. Compare mode · 17. Risk scoring · 18. Contagion/peg monitor · 19. Dev-activity momentum · 20. Entity-attributed flow (paid-data future).

## Dead-chain "why they die" taxonomy (forensics)
Ghost-chain bifurcation: capital was rented, not earned — every rental has an on-chain end date (TGE, bridge-open, unlock cliff, yield-reserve depletion). Causes: mercenary/incentivized TVL exit (dominant) · points-farming collapse · VC/insider unlock dumps · insider-heavy airdrops · whale-not-user TVL (TVL-rank vs fee-rank divergence) · hacks · team abandonment/soft rug (dead-token >72h signature) · unsustainable yield · narrative death · wash-traded volume (vol/fee ratio >5000). Trends: TGE is the peak; bridge-open = true time-of-death; power-law death (top-3 = 83%+ TVL); concentration precedes collapse; front-run unlock drift; contagion via shared collateral.

## Success/failure framework, NFT/Ordinals lifecycle tracker (queued next phase), mid-chains library — see chain_analysis / dead_chains / mid_chains tables.

Files: public/index.html (UI, peer pills, momentum, attribution) · server.js (poller, signal engine, /api/agent/v1, attribution) · package.json (register chain_snapshots + webhook_subscriptions) · new chain-intel-mcp/ (shares signals.js).
