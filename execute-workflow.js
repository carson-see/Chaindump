export const meta = {
  name: 'chaindump-execute-linkage',
  description: 'Resilient: build address-level moat (new + backfilled cases), multi-chain wallet entity-resolution (current->past), seed predictive risk catalog, verify citations',
  phases: [
    { title: 'Execute' },
    { title: 'Linkage' },
    { title: 'Verify' },
  ],
}

const DB = 'For DB: ToolSearch("select:mcp__nanoclaw__db_query,mcp__nanoclaw__db_execute"). For web: ToolSearch("select:WebSearch,WebFetch").'
const RULES = 'ACCURACY IS SACRED. Every material claim needs a resolving authoritative source URL (block-explorer tx, DOJ/SEC/court filing, or reputable post-mortem: rekt.news, Chainalysis, Elliptic, TRM, SlowMist, Halborn, CertiK, mainstream press) — VERIFY each resolves with WebFetch before use. NEVER fabricate an address, tx hash, figure, name, or date; if you cannot verify it, OMIT it and note the gap in a desk_log row. Blame culpable INDIVIDUALS (real names + aliases), NEVER neutral infrastructure (mixers/bridges/exchanges/DEXs are infra, not perpetrators).'
const MULTICHAIN = 'MULTI-CHAIN IS REQUIRED. Capture addresses on EVERY chain the funds touched — Ethereum, BSC, Tron, Solana, Bitcoin, Base, Arbitrum, Polygon, Avalanche, etc. Set scam_addresses.chain per address. When funds cross chains (bridge/CEX), record BOTH endpoints and a wallet_links row of type "bridge-hop" or "cex-deposit".'

const PERSIST = `${DB} ${RULES} ${MULTICHAIN}
Tables (INSERT OR REPLACE for keyed):
- scam_traces(slug PK, name, category, amount_usd, net_usd, recovered_usd, victims, start_date, collapse_date, status, chains[comma list], confidence, profile[JSON string: technical,timeline[{date,event,source}],tradecraft,aftermath,industry_impact,lessons,red_flags_in_hindsight[],legal,parallels], sources[JSON urls], source_checked_at='2026-07-08')
- scam_actors(slug PK, case_slug, real_name, aliases, role, nationality, status, links[JSON {label,url}], summary, sources)
- scam_addresses(address+case_slug PK, chain, role, label, entity, entity_id, cluster_id, balance_note, first_seen, last_seen, sources, confidence) — entity_id groups one actor's wallets across chains/time; cluster_id groups a laundering cluster.
- scam_flows(case_slug, from_addr, to_addr, from_label, to_label, asset, amount, amount_usd, tx_hash, tx_url, ts, hop_index, note, sources) — verified tx only.
- scam_links(a_slug, b_slug, kind, detail, evidence, sources) — cross-CASE connections.
- actor_trail(actor_slug, case_slug, type[tweet/social-post/interview/video/email/court-filing/indictment/sec-complaint/news-article/press-release/blog/podcast/forum-post/leak/deleted-archived], title, url, archived_url[web.archive.org where possible], source, author, dated, excerpt[short quote], note, verified[1 if URL confirmed resolving]) — the COMPLETE AUDIT TRAIL. Build it EXHAUSTIVELY: every documented tweet/social post, interview, news story, court/regulatory filing, and public email tied to each named actor. One row per artifact. Prefer primary + add an archive.org fallback for anything deletable (tweets, sites).
Finish by INSERTing a desk_log row (desk='execute', target, action, outcome, items_touched, notes including any gaps).`

// ---------------- PHASE 1: EXECUTE ----------------
phase('Execute')

const SIMPLE = { type:'object', additionalProperties:true, properties:{ slug:{type:'string'}, cases:{type:'number'}, actors_added:{type:'number'}, addresses_added:{type:'number'}, chains_covered:{type:'string'}, flows_added:{type:'number'}, links_added:{type:'number'}, trail_added:{type:'number'}, notes:{type:'string'} }, required:['notes'] }

const NEW_CASES = [
  { slug:'terra-luna-2022', hint:'Terra/LUNA + UST depeg, ~$40-60B destroyed. Do Kwon (Terraform Labs) — SEC fraud verdict, DOJ charges, Montenegro arrest/extradition fight. Chains: Terra Classic, Ethereum, BSC. Capture Luna Foundation Guard BTC reserve deployment/spend addresses (documented on-chain).' },
  { slug:'celsius-2022', hint:'Celsius Network collapse, ~$4.7B. Alex Mashinsky fraud guilty plea + sentence, CEL token manipulation, commingling. Chains: Ethereum. Capture documented Celsius wallets from bankruptcy filings.' },
  { slug:'quadrigacx-2019', hint:'QuadrigaCX, Gerald Cotten, ~$190M CAD. OSC report = exit scam; cold wallets empty. Chains: Bitcoin, Ethereum. Capture the QuadrigaCX BTC cold-wallet addresses identified by independent researchers (cited).' },
  { slug:'mango-markets-2022', hint:'Mango Markets oracle manipulation, ~$117M. Avraham Eisenberg. Chain: Solana. Capture Eisenberg exploiter wallet(s) documented in DOJ/press.' },
  { slug:'plustoken-2019', hint:'PlusToken ponzi, ~$2-4B, China. Ringleaders arrested/sentenced. Chains: Bitcoin, Ethereum, EOS. Capture the documented PlusToken consolidation wallets that later moved markets (Chainalysis-cited).' },
  { slug:'wintermute-2022', hint:'Wintermute $160M hack via Profanity vanity-address vulnerability. Chain: Ethereum. This is an EXPLOIT of a flawed key-gen tool — attribution to attacker address; do not blame Wintermute.' },
]

const BACKFILL = [
  { slug:'ronin-2022', hint:'Ronin/Axie bridge $625M. FBI attribution to Lazarus/DPRK. Validator-key compromise via fake-job spear-phish. Capture exploiter address + documented laundering endpoints (ETH). Add scam_links to harmony-2022 & bybit-2025 (shared Lazarus tradecraft/infra). entity_id="lazarus" on shared actor wallets.' },
  { slug:'harmony-2022', hint:'Harmony Horizon bridge $100M, Lazarus attribution. Capture exploiter + laundering endpoints. scam_links to ronin-2022, bybit-2025 with entity_id="lazarus".' },
  { slug:'bybit-2025', hint:'Bybit $1.5B, Lazarus attribution (largest ever). Capture documented exploiter/laundering addresses across ETH + bridges. scam_links to ronin/harmony; entity_id="lazarus".' },
  { slug:'ftx-2022', hint:'FTX/Alameda. Actors: Sam Bankman-Fried (25y), Caroline Ellison, Gary Wang, Nishad Singh, Ryan Salame — real names, roles, legal status, DOJ/court links. Fill structured columns.' },
  { slug:'bitconnect', hint:'BitConnect ponzi $2.4B. Actors: Satish Kumbhani (indicted, fugitive), Glenn Arcaro (guilty plea). SEC/DOJ links. red_flags_in_hindsight.' },
]

const RISK = () => agent(`Seed Chaindump's PREDICTIVE risk-signal catalog. ${PERSIST}
Insert 10-14 rows into risk_signals (slug PK, target='methodology', signal_type, severity, description, evidence[how computed], sources). Cover: unverified contract source; mint/blacklist/pause/owner-drain functions; proxy upgradeability; honeypot; ownership not renounced; LP unlocked/short-lock; LP held by deployer; thin liquidity vs mcap; top-10 holder concentration; deployer % supply; fresh-wallet/sniper clusters; DEPLOYER-HISTORY CROSS-REFERENCE (deployer or funder address matches a known-bad wallet in scam_addresses/wallet_links — the predictive moat); anonymous team + plagiarized site/paper; incentive-only TVL / TGE-peak signature; unlock cliffs; dead-token >72h. Return count.`, { phase:'Execute', label:'seed:risk-catalog', schema:SIMPLE })

const exec = await parallel([
  ...NEW_CASES.map(c => () => agent(`Add crypto-crime case "${c.slug}" to Chaindump as a fully-cited EXPERT entry. Context: ${c.hint}
${PERSIST}
Deep web research. Populate scam_traces (all structured cols), scam_actors (every named culpable individual + legal status), an EXHAUSTIVE actor_trail (every documented tweet/social post/interview/news story/court filing/email per actor, archived), and — where PUBLICLY DOCUMENTED in cited sources — scam_addresses (MULTI-CHAIN, with entity_id) + scam_flows (verified tx only). Add scam_links to related existing cases. Return counts.`, { phase:'Execute', label:`add:${c.slug}`, schema:SIMPLE })),
  ...BACKFILL.map(c => () => agent(`Backfill address-level + actor + cross-link depth for existing case "${c.slug}". Context: ${c.hint}
${PERSIST}
Do not degrade the existing profile. Focus: fill scam_traces structured cols, scam_actors, an EXHAUSTIVE actor_trail (tweets/social/interviews/news/court filings/emails per actor, archived), scam_addresses (MULTI-CHAIN + entity_id), scam_flows (verified tx only), scam_links. Return counts.`, { phase:'Execute', label:`backfill:${c.slug}`, schema:SIMPLE })),
  RISK,
])

// ---------------- PHASE 2: LINKAGE (entity resolution: current -> past wallets, multi-chain) ----------------
phase('Linkage')

const ENTITIES = [
  { entity:'lazarus', hint:'DPRK/Lazarus Group across Ronin, Harmony, Bybit and earlier hacks. Link exploiter/laundering wallets ACROSS chains and ACROSS cases via documented shared funding sources, shared laundering endpoints, and bridge hops (from FBI/Elliptic/Chainalysis/TRM attributions).' },
  { entity:'eisenberg', hint:'Avraham Eisenberg — link his Mango Markets Solana wallet(s) to any documented prior/other-chain wallets tied to him in DOJ filings/press.' },
  { entity:'cross-case', hint:'Any documented case where a perpetrator or laundering cluster reappears across multiple incidents — record the current->past wallet linkage.' },
]

const linkage = await parallel(ENTITIES.map(e => () => agent(`Entity-resolution pass for "${e.entity}". ${e.hint}
${DB} ${RULES} ${MULTICHAIN}
Goal: connect CURRENT wallets to POSSIBLE PAST wallets of the same actor/cluster, across chains and time. Use ONLY documented heuristics from cited sources: common funding source, common CEX-deposit address, cross-chain bridge continuity, self-transfer/consolidation, reused deployer/CREATE2 salt, or investigator-published clustering.
For each established link, INSERT a wallet_links row (address_a, chain_a, address_b, chain_b, link_type[common-funder/common-cex-deposit/bridge-hop/self-transfer/reused-deployer/investigator-clustered], direction, confidence[reported/corroborated/confirmed], evidence, tx_hash, tx_url, case_slug, entity, sources). NEVER fabricate a link or address — if none are publicly documented, insert a desk_log row saying so and stop. Also set scam_addresses.entity_id/cluster_id on the involved wallets. Return count of links written.`, { phase:'Linkage', label:`linkage:${e.entity}`, schema:{ type:'object', additionalProperties:true, properties:{ entity:{type:'string'}, links_written:{type:'number'}, notes:{type:'string'} }, required:['notes'] } })))

// ---------------- PHASE 3: VERIFY ----------------
phase('Verify')

const verify = await parallel([
  () => agent(`Adversarial fact-check of today's writes. ${DB}
Query scam_addresses, scam_flows, wallet_links rows updated today. For EVERY address/tx/link, confirm it traces to a cited source (WebFetch a sample of the highest-impact ones). DELETE any address/tx/link that cannot be sourced — fabrication is unacceptable. Confirm chains are set (multi-chain). Insert a desk_log row with counts. Return kept/deleted counts + notes.`, { phase:'Verify', label:'verify:onchain', schema:{ type:'object', additionalProperties:true, properties:{ kept:{type:'number'}, deleted:{type:'number'}, notes:{type:'string'} }, required:['notes'] } }),
  () => agent(`Adversarial fact-check of case claims. ${DB}
Query scam_traces (new: terra-luna-2022, celsius-2022, quadrigacx-2019, mango-markets-2022, plustoken-2019, wintermute-2022; backfilled: ronin-2022, harmony-2022, bybit-2025, ftx-2022, bitconnect) and scam_actors added today. Verify loss figures + actor legal status against cited sources (WebFetch a sample). Downgrade confidence or fix any unsupported claim. Confirm no entry blames neutral infrastructure. Return notes.`, { phase:'Verify', label:'verify:cases', schema:{ type:'object', additionalProperties:true, properties:{ notes:{type:'string'} }, required:['notes'] } }),
])

return { execute: exec.filter(Boolean), linkage: linkage.filter(Boolean), verify: verify.filter(Boolean) }
