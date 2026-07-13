# Chaindump — Engineering Directive (CLAUDE.md)

> Rules Claude follows when working on Chaindump. This is a **standalone project** —
> it is NOT Arkova. None of Arkova's rules (Jira, Confluence, staging soaks,
> Mergify, lane manifests) apply here.

---

## 0. What this project is

**Chaindump** is a real-time blockchain intelligence platform. It answers
*"what is changing, why, and what should I do about it"* — not "what is biggest."
Its value everywhere is **analysis + aggregation with provenance**, not raw data.

- **Live:** https://chaindump.xyz
- **Repo:** https://github.com/carson-see/Chaindump (branch `main`)
- **Roadmap:** [`docs/roadmap-phase2.md`](docs/roadmap-phase2.md) — the current program of work.
- **Companion docs:** `docs/` (agent-readiness, nft-v2-followup) + the Google
  Drive "Chaindump" folder (Platform Overview, MCP, SDK, Sections, ICP).

---

## 1. Engineering standards (mandatory)

### 1.1 TDD — Test-Driven Development
Red → Green → Refactor. Write a failing test before production code; watch it
fail; make it pass; refactor. No `test.skip`, no "add tests later."

> **Current gap (be honest):** the repo has **no test harness yet** (no test
> script in `package.json`, no CI). Adopting this standard starts with
> establishing one — Vitest for the Worker logic (pure functions like
> `norm`, `aggregateBreakdown`, `computeSignals`, `latestByOrigin`, the OG
> injection, the delta computation), plus lightweight integration tests hitting
> the routes via `wrangler dev`. Until that exists, every new pure function
> ships with its test, and the harness is built out incrementally.

### 1.2 Code review before every change lands
Manually review each changed file before deploy for: correctness, injection
(SQL — use bound `?` params in D1, never string-interpolate request input),
XSS (escape all user/remote text with `escapeHtml`/`esc` before it hits HTML),
secrets in code, and accuracy of any published claim. When unsure, run
`/code-review` on the diff. Nothing ships that hasn't been read end-to-end.

### 1.3 Structured debugging
Reproduce → isolate → diagnose → fix → verify. **Diagnose before guessing** —
add logging and read it before changing code (this is how the growthepie 403
and the deep-link 404 were found, rather than guessed). Prefer `wrangler tail`
+ `console.error` to see real failure reasons. Never ship a "probably fixes it"
change without confirming the root cause first.

### 1.4 Verify against the live behavior, not just compilation
After any change observable in the browser, verify it on chaindump.xyz (or a
`wrangler dev` preview): drive the actual flow, check the DOM / network / console,
not just that it deploys. Screenshots when useful; DOM inspection when the
browser pane can't screenshot at deep scroll. Never claim something works
without exercising it.

### 1.5 Accuracy bar for published content (non-negotiable)
Chaindump publishes claims about real projects and wallets. Every material
figure (TVL, price, dates, amounts) must come from a **resolving, authoritative
source, verified before use** — DefiLlama for TVL, CoinGecko for prices, OFAC
SDN for sanctions, government/mainstream/NPO sources for policy (not web3 media
alone). **Never fabricate a number, name, or date.** Adversarially fact-check
before publishing. **Never auto-publish a claim that names a private individual
as a criminal** — that stays human-reviewed. Blockchain addresses are never
typed from memory — always sourced and verified.

---

## 2. Tech stack (locked)

| Layer | Technology |
|---|---|
| Runtime | Single **Cloudflare Worker** (`chaindump`), **Hono** framework, serving both the JSON API and the static SPA. |
| Entry | `src/worker.js` (`export default { fetch: app.fetch, scheduled: handleScheduled }`). Express-style handlers via a `wrap()` shim → Hono. |
| Data | **Cloudflare D1** (SQLite), database `chaindump-db` (uuid `b3fde1ea-e693-40b1-b582-3129da27c146`), binding `env.DB`. Migrations in `migrations/NNNN_*.sql`. |
| Frontend | Single vanilla-JS SPA: `public/index.html` (~1,900 lines). No framework. Served via the Worker Static Assets binding (`env.ASSETS`). cytoscape (CDN) for the scam graph. |
| Freshness | **Cron Trigger** `*/5 * * * *` (`handleScheduled`) refreshes the D1 snapshot cache + time-series off the request path; slower jobs gated by tick count (RWA/DePIN hourly, prune ~4-hourly). |
| Sources | DefiLlama, CoinGecko (Demo key), growthepie, OFAC SDN (via 0xB10C mirror), crypto RSS. All free / public. |
| Payments | x402 (agent API), USDC on Base — demo mode until a facilitator is wired. |

**Hard constraints:** the SPA uses relative fetch URLs, so `<base href="/">`
is REQUIRED in `index.html` for deep-link paths to work. Data carries sources +
(for signals) confidence. Copy avoids nothing in particular — this is a
public-data product, no banned-terminology list.

---

## 3. Deploy & operations

### 3.1 Cloudflare auth
Deploys and D1 need a token with **D1 edit**. Use the GCP Secret Manager secret
**`Chaindump_Cloudflare`** (project `arkova1`) — it has Workers + D1 edit. The
older `cloudflare-api-token` secret does **not** have D1 and will fail.

```bash
export CLOUDFLARE_API_TOKEN="$(gcloud secrets versions access latest --secret=Chaindump_Cloudflare --project=arkova1)"
```
- Account: `Carson@arkova.io's Account` (`1823ad5cbd8a0dc10aeac93cda743bb5`).
- Custom domain: `chaindump.xyz` (zone `e0db1713017f5da643066c2d2aa54bf4`),
  wired via `routes` + `custom_domain` in `wrangler.jsonc`, `workers_dev: true`.

### 3.2 Deploy
```bash
node --input-type=module --check < src/worker.js   # syntax-check first
npx wrangler deploy
```
Solo project — **direct deploys to prod are fine.** Commit + push to `main`
around each deploy. Branch only if you want isolation; there is no CI gating.

> **Edge propagation lag:** after a deploy, the new asset/worker takes ~5–15s to
> propagate. A 404/500/stale response right after deploy is almost always
> propagation, not a bug — retry before diagnosing. This has bitten repeatedly.

### 3.3 Secrets on the Worker
Set via `wrangler secret put NAME` (values from GCP Secret Manager):
- `COINGECKO_API_KEY` — from `coingecko_api` (raises CoinGecko rate limits;
  required for token prices / P-F ratios / NFT detail).
- Optional: `DASHBOARD_BASE`/`DASHBOARD_TOKEN` (legacy, unused now that data is
  in D1), `X402_*`.

### 3.4 D1 migrations & seeding
```bash
npx wrangler d1 migrations apply chaindump-db --remote   # prod
npx wrangler d1 migrations apply chaindump-db --local    # dev parity
```
- Migrations: `migrations/NNNN_name.sql`, sequential. Never edit an applied
  migration — write a compensating one.
- **Bulk seed** large datasets with `wrangler d1 execute chaindump-db --remote
  --file=seed.sql` — but the file must have **no `BEGIN TRANSACTION`/`COMMIT`**
  (D1 wraps it; explicit transactions error).
- Ad-hoc queries: the Supabase-style D1 MCP `d1_database_query` tool
  (database_id `b3fde1ea-...`) with bound `params`.

### 3.5 The growthepie CF-block (known, worked around)
`api.growthepie.xyz/v1/fundamentals.json` **and** `master.json` return 403 from
Cloudflare's edge (CloudFront blocks CF's ASN; a browser UA does not fix it).
The Worker keeps trying live, else falls back to a **D1-persisted last-good map**
(`snapshot_cache` keys `daa` / `master`), seeded once from a normal IP. Active
addresses are real but static until the block clears or the seed is refreshed.
To re-seed: fetch the two files from a normal IP, rebuild the maps, `UPDATE
snapshot_cache`.

---

## 4. Data model (D1 tables)

Curated/research: `chain_analysis`, `dead_chains`, `mid_chains`, `graveyard_meta`,
`nft_collections`, `infra_chains`, `market_entities`, `stablecoin_meta`,
`risk_flags`, `geo_regions`, `rwa_depin`, `us_states`, `scam_*` (traces,
addresses, flows, links, actors, actor_trail), `risk_signals`, `desk_log`.
Live-refreshed: `snapshot_cache` (keys `chains`/`daa`/`master`), `chain_snapshots`
(time-series), `nft_catalog` + `nft_detail`, `rwa_live` + `depin_live`,
`sanctioned_addresses` (OFAC SDN). Profiles are JSON in a `profile`/`data` column.

New live data follows the pattern: a `refreshX(env)` function gated in
`handleScheduled` by tick count, seeded once from a non-blocked IP, read via a
`/api/*` route that JSON-parses profile columns.

---

## 5. Frontend conventions (`public/index.html`)

- One `state` object; `render*()` functions set `innerHTML`; event delegation on
  each view container.
- Reusable component classes: `.gcard`/`.gexp` (expandable cards),
  `.chainfolder`/`.folderhead` (collapsible folders), `.catcard` (catalog),
  `.gstat`/`.catstat` (stat tiles), `.rlrow` (ranked rows). Reuse these.
- **Always `esc()` remote/user text** before interpolating into HTML.
- Deep-links: `/chain/:name`, `/scam/:slug`, `/collection/:id`, `/<view>` —
  the Worker injects per-entity OG tags server-side; the client History-API
  router (`applyRoute`) opens the right view/entity. `<base href="/">` is load-bearing.

---

## 6. Task completion checklist

Before calling a change done:
1. **Tested** — new pure functions have tests; behavior verified live on
   chaindump.xyz (drive the flow, check console/network/DOM).
2. **Reviewed** — diff read end-to-end for correctness, injection, XSS, secrets.
3. **Sources** — any published claim is cited + verified; no fabrication.
4. **Deployed + verified** — `wrangler deploy`, then confirm live (allowing for
   propagation lag).
5. **Committed + pushed** to `main` with a clear message.
6. **Docs** — update the roadmap / relevant `docs/*.md` if state changed.

Announce status honestly at the end: if something failed, say so with the output.
