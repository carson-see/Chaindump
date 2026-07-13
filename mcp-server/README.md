# chaindump-mcp — chain-intel MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes **Chaindump's
differentiated blockchain intelligence** — the analysis + aggregation agents
can't get free elsewhere — as agent tools. Every response carries its **sources**;
provenance is the product. Commodity data (raw TVL, spot prices) is deliberately
not wrapped. (Roadmap Phase F; see the Drive spec "Chaindump — MCP Server (chain-intel)".)

## Tools

| Tool | What it answers |
|---|---|
| `screen_address` | Is a wallet on the OFAC SDN sanctioned list? (+ scam-case matches, risk) |
| `chain_intel` | Composite profile + analyst take + risk flags for one chain |
| `chain_forensics` | Our tier verdict (thriving/mid/dying/dead) + why it's stuck + outlook + sources |
| `power_ranking` | Country crypto power ranking (or one country's profile) |
| `rwa_depin` | RWA protocols by TVL + DePIN networks by market cap |
| `scam_cases` | Traced scam/exploit cases (fund-flow, attribution, sources) |

All tools are read-only. They wrap the public Chaindump API
(`CHAINDUMP_BASE_URL`, default `https://chaindump.xyz`).

## Run

```bash
npm install
npm run build
npm start            # listens on :8790 (PORT), stateless streamable HTTP at POST /mcp
```

Env: `CHAINDUMP_BASE_URL` (default `https://chaindump.xyz`), `PORT` (default 8790),
`CHAINDUMP_TIMEOUT_MS` (default 15000).

## Transport

Stateless **streamable HTTP** (JSON responses, no session state) — simple to scale
behind a load balancer. `POST /mcp` for JSON-RPC; `GET /health` for liveness.

## Test with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# then connect to http://localhost:8790/mcp (Streamable HTTP)
```

## Monetization

The differentiated tools are the natural front for Chaindump's existing x402
per-call agent API (USDC on Base). Payment gating is layered at the API, not here.

## Status

Builds clean (`npm run build`). Verified end-to-end over the MCP protocol
(`initialize`, `tools/list`, real `tools/call`) against the true API response
shapes. Evaluations in [`evals/evals.xml`](evals/evals.xml).
