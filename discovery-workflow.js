export const meta = {
  name: 'chaindump-scam-discovery',
  description: 'Scrape forums/trackers for crypto & NFT scams, adversarially debate each, find links to known cases, analyze importance/mechanism/loss/aftermath, persist verified intel',
  phases: [
    { title: 'Discover' },
    { title: 'Debate' },
    { title: 'Link' },
    { title: 'Analyze' },
    { title: 'Verify' },
  ],
}

const DB = 'For DB: ToolSearch("select:mcp__nanoclaw__db_query,mcp__nanoclaw__db_execute"). For web: ToolSearch("select:WebSearch,WebFetch").'
const RULES = 'ACCURACY IS SACRED. Every claim needs a resolving, authoritative source URL — VERIFY it resolves with WebFetch before using. NEVER fabricate a name, address, tx, figure, or date; if unverifiable, omit and flag the gap. Blame culpable INDIVIDUALS (real names + aliases + social/court/press links), NEVER neutral infrastructure (mixers, bridges, exchanges, DEXs). Deduplicate against what already exists.'

// ---------------- PHASE 1: DISCOVER (scrape many sources) ----------------
phase('Discover')

const CAND_SCHEMA = { type:'object', additionalProperties:true, properties:{ candidates:{ type:'array', items:{ type:'object', additionalProperties:true, properties:{ name:{type:'string'}, slug:{type:'string'}, category:{type:'string'}, chain:{type:'string'}, approx_loss_usd:{type:'number'}, incident_date:{type:'string'}, culpable:{type:'string'}, summary:{type:'string'}, sources:{type:'array',items:{type:'string'}} }, required:['name','slug','category','summary','sources'] } } }, required:['candidates'] }

const SOURCES = [
  { key:'rekt-defillama', prompt:'rekt.news leaderboard + recent posts, and DefiLlama Hacks dashboard. Pull the largest and most recent DeFi exploits/hacks/rug pulls with loss size, date, chain, and post URLs.' },
  { key:'onchain-investigators', prompt:'ZachXBT investigations/threads, SlowMist Hacked, PeckShield & CertiK Alert reports, Elliptic/Chainalysis blog. Pull named on-chain fraud/theft/rug cases with attribution and report URLs.' },
  { key:'web3isgoinggreat', prompt:'Web3 Is Going Great (web3isgoinggreat.com) and mainstream press (CoinDesk, The Block, Protos, DL News). Pull documented scams, frauds, exit scams, and collapses with entry/article URLs.' },
  { key:'reddit-forums', prompt:'Reddit (r/CryptoScams, r/CryptoScamReport, r/CryptoCurrency scam megathreads, r/NFT scam warnings) and Bitcointalk scam-accusations board. Pull recurring, corroborated scam reports (rug pulls, drainers, fake projects) with thread URLs. Only include ones with multiple corroborating reports or press pickup.' },
  { key:'nft-drainers', prompt:'NFT-specific fraud: Chainabuse, ScamSniffer reports, OpenSea/Blur theft & wallet-drainer campaigns, notable NFT rug pulls (e.g. Frosties, Evolved Apes, Big Daddy Ape Club, Mutant Ape Planet). Pull cases with loss, perpetrator (if charged), and source URLs.' },
]

const discovered = await parallel(SOURCES.map(s => () =>
  agent(`You are a crypto-crime OSINT scout for Chaindump. ${RULES} ${DB}
Scour this source class and return a list of candidate scam/fraud/exploit incidents: ${s.prompt}
Return 8-20 candidates. For each: a stable kebab-case slug, name, category (rug-pull/defi-exploit/ponzi/exit-scam/founder-fraud/exchange-collapse/phishing-drainer/nft-fraud/bridge-hack/pig-butchering), chain, approx_loss_usd, incident_date, culpable individual(s) if known, one-line summary, and 1-3 resolving source URLs (verify they load). Favor incidents NOT already famous where corroborated, plus any major ones. Skip anything you cannot source.`,
    { phase:'Discover', label:`scout:${s.key}`, schema:CAND_SCHEMA })
))

// dedup across scouts + against existing DB (barrier is correct: need the full set to dedup)
const existing = await (async () => {
  const q = 'ToolSearch then query'; return q
})()
const allCands = discovered.filter(Boolean).flatMap(r => r.candidates || [])
const seen = new Set()
const unique = []
for (const c of allCands) {
  const k = (c.slug || c.name || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  if (!k || seen.has(k)) continue
  seen.add(k); c.slug = k; unique.push(c)
}
// cap to protect budget — keep highest apparent loss / clearest attribution first
unique.sort((a,b) => (b.approx_loss_usd||0) - (a.approx_loss_usd||0))
const shortlist = unique.slice(0, 24)
log(`Discovered ${allCands.length} raw → ${unique.length} unique → processing ${shortlist.length}`)

// ---------------- PHASES 2-5: DEBATE → LINK → ANALYZE → PERSIST (pipeline) ----------------
phase('Debate')

const PERSIST = `${DB} ${RULES}
Persist into scam_intel via INSERT OR REPLACE. Columns: slug PK, name, category, chain, approx_loss_usd, incident_date, severity(low/medium/high/critical), credibility(unverified/reported/corroborated/confirmed), status(dismissed/candidate/verified), culpable, connections(JSON array of {slug,kind,detail} links to other cases), summary, how_it_happened, what_stolen, aftermath(what changed after — regulation, protocol changes, arrests, industry response), links(JSON array of {label,url} for people/social/court/press), sources(JSON array of URLs), debate_notes, updated_at=datetime('now'). Also, when a real connection to a flagship case exists, INSERT a scam_links row (a_slug, b_slug, kind, detail, evidence, sources). Flagship cases in scam_traces: onecoin, multichain-2023, harmony-2022, bitconnect, ronin-2022, bybit-2025, mtgox, pig-butchering-usdt-2025, euler-2023, ftx-2022, terra-luna-2022, celsius-2022, quadrigacx-2019, mango-markets-2022.`

const processed = await pipeline(
  shortlist,
  // STAGE 1 — DEBATE (internal adversarial adjudication)
  (c) => agent(`Adversarially adjudicate this candidate crypto-crime incident before Chaindump commits to it. Candidate: ${JSON.stringify(c)}
${DB} ${RULES}
Run an INTERNAL DEBATE and report it:
- PROSECUTION: the case that this is a real, significant scam/fraud with culpable individuals — strongest evidence + sources.
- DEFENSE/SKEPTIC: the case that it's noise, unverified rumor, a duplicate of a known case, a mislabel, or wrongly blames neutral infrastructure.
- ADJUDICATION: verdict (keep / dismiss), severity, credibility, corrected facts, and the culpable individual(s) with real names if documented.
Verify sources resolve. Return the debate + verdict.`,
    { phase:'Debate', label:`debate:${c.slug}`, schema:{ type:'object', additionalProperties:true, properties:{ slug:{type:'string'}, verdict:{type:'string', enum:['keep','dismiss']}, severity:{type:'string'}, credibility:{type:'string'}, culpable:{type:'string'}, corrected:{type:'string'}, debate_notes:{type:'string'}, sources:{type:'array',items:{type:'string'}} }, required:['slug','verdict','debate_notes'] } }),

  // STAGE 2 — LINK (find connections to known + other candidates)
  (verdict, c) => (verdict && verdict.verdict === 'keep')
    ? agent(`Find CONNECTIONS for the confirmed incident "${c.slug}" (${c.name}). ${DB} ${RULES}
Query scam_traces, scam_actors, scam_addresses, scam_intel for overlaps. Look for shared perpetrators, shared laundering endpoints/addresses, shared tradecraft/method, copycat patterns, or shared funding. Return an array of connections {slug, kind(shared-actor/shared-infra/shared-funds/shared-method/copycat), detail, evidence, sources}. Empty array if genuinely none — do NOT invent links.`,
        { phase:'Link', label:`link:${c.slug}`, schema:{ type:'object', additionalProperties:true, properties:{ slug:{type:'string'}, connections:{type:'array',items:{type:'object',additionalProperties:true}} }, required:['slug','connections'] } })
    : null,

  // STAGE 3 — ANALYZE + PERSIST (importance / how / stolen / aftermath)
  (linkRes, c, i) => {
    if (!linkRes) return null
    return agent(`Write Chaindump's expert intel entry for "${c.slug}" (${c.name}) and PERSIST it. Candidate context: ${JSON.stringify(c).slice(0,1200)}. Connections found: ${JSON.stringify(linkRes.connections||[]).slice(0,1500)}.
${DB} ${RULES}
Analyze and populate: IMPORTANCE (why this scam matters / its place in crypto-crime history), HOW_IT_HAPPENED (the mechanism/tradecraft), WHAT_STOLEN (assets, amount, victims), AFTERMATH (what changed after — arrests, sentences, regulation, protocol/industry changes), culpable individuals with links. Set severity + credibility from the debate; status='verified' if credibility is corroborated/confirmed else 'candidate'.
${PERSIST}
Return what you persisted.`,
      { phase:'Analyze', label:`analyze:${c.slug}`, schema:{ type:'object', additionalProperties:true, properties:{ slug:{type:'string'}, status:{type:'string'}, connections_written:{type:'number'}, sources_verified:{type:'number'}, notes:{type:'string'} }, required:['slug','notes'] } })
  }
)

// ---------------- PHASE 5: VERIFY ----------------
phase('Verify')

const kept = processed.filter(Boolean)
const [verify] = await parallel([() => agent(`Adversarial fact-check of Chaindump's newly discovered scam intel. ${DB}
Query scam_intel rows updated today (status in ('verified','candidate')) and scam_links added today. For a sample weighted toward the highest-severity entries, use WebFetch to confirm source URLs resolve and support the loss figures, attribution, and aftermath claims. DELETE or downgrade to credibility='unverified' any entry whose core claim cannot be sourced. Confirm no entry blames neutral infrastructure instead of individuals. Insert a desk_log row (desk='discovery', action, outcome, items_touched, notes).
Return: counts kept/downgraded/deleted and confidence notes.`,
  { phase:'Verify', label:'verify:discovery', schema:{ type:'object', additionalProperties:true, properties:{ kept:{type:'number'}, downgraded:{type:'number'}, deleted:{type:'number'}, notes:{type:'string'} }, required:['notes'] } })

return { discovered_raw: allCands.length, unique: unique.length, processed: kept.length, kept, verify }
