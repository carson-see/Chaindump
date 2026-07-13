# chaindump-agent-desk — the research desk

An autonomous, scheduled **Claude Agent SDK** app that keeps Chaindump's
forensic / graveyard / policy / trend-analysis data **fresh and sourced** — the
same verified loop we run by hand, automated. (Roadmap Phase G; Drive spec
"Chaindump — Agent SDK App (Research Desk)".)

**It never publishes.** Every finding is written to a review queue; a human
promotes proposals to the live D1. Anything that names a private individual or
asserts fraud/crime is force-flagged for review (CLAUDE.md §1.5).

## How it works

1. Runs the loop **discover → research → adversarially fact-check → cite → queue**.
2. Tools: the live **chain-intel MCP server** (our own dogfooded tools — dedupe
   against what Chaindump already knows), **WebSearch/WebFetch**, and one custom
   **`queue_proposal`** tool (the only write path).
3. `queue_proposal` writes a JSON proposal to `proposals/` with
   `needs_human_review` set for sensitive or low-confidence findings.

## Run

```bash
npm install && npm run build
export ANTHROPIC_API_KEY=...          # prod: GCP Secret Manager `Anthropic`
node dist/index.js                     # one pass; writes to ./proposals
```

Env: `ANTHROPIC_API_KEY` (required), `CHAINDUMP_MCP_URL` (default the live Cloud
Run MCP), `DESK_TASK` (the pass to run), `DESK_MODEL` (default `claude-sonnet-5`),
`DESK_MAX_TURNS`, `DESK_QUEUE_DIR`.

## Deploy (scheduled)

Runs as a **Cloud Run Job** or scheduled **GitHub Action** (NOT the Worker — the
SDK needs a Node runtime). Point `ANTHROPIC_API_KEY` at the secret and schedule
the pass(es) you want (scam discovery, dying-chain sweep, policy/trend refresh).

## Status / next increments

- ✅ SDK app scaffold: research loop, chain-intel MCP wiring, human-gated
  `queue_proposal`, accuracy/gating system prompt. `npm run build` clean.
- ⏭ **Next:** wire the promotion step (review queue → D1 via the Worker's
  authenticated write path); add the scheduler (Cloud Run Job); a first live run
  (has API cost) validated with the `agent-sdk-verifier-ts` agent; per-desk task
  variants (scam / dying-chain / policy / trend).
