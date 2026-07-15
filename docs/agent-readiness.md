# Agent-readiness / AI-discovery checklist (Phase D)

Runs **after the redesign, before UAT**. Source: isitagentready.com audit of
chaindump.xyz (via Carson 2026-07-13). Each item = a file/header the Worker
serves. Most are static routes we add to `src/worker.js` (served with the right
content-type) or `public/` assets. Verify each returns 200 with correct
content-type before UAT.

## Must-do (high value, low effort)

1. **`/robots.txt`** — currently invalid (no `User-agent`). Serve plain-text,
   200, with explicit `User-agent` + allow/disallow, AI-crawler rules, and
   Content-Signal directives (items 6–7 below folded in).
   - Skill: https://isitagentready.com/.well-known/agent-skills/robots-txt/SKILL.md
   - RFC 9309: https://www.rfc-editor.org/rfc/rfc9309

2. **`/sitemap.xml`** — canonical URLs (each view + key entity deep-links:
   `/chain/*`, `/scam/*`, `/collection/*`), referenced from robots.txt. Keep
   updated on publish.
   - Skill: https://isitagentready.com/.well-known/agent-skills/sitemap/SKILL.md
   - https://www.sitemaps.org/protocol.html

3. **`Link:` response headers** on homepage (RFC 8288) — e.g.
   `Link: </.well-known/api-catalog>; rel="api-catalog"`,
   `Link: </docs/api>; rel="service-doc"`.
   - Skill: https://isitagentready.com/.well-known/agent-skills/link-headers/SKILL.md
   - RFC 8288: https://www.rfc-editor.org/rfc/rfc8288 · RFC 9727 §3

4. **AI-crawler `User-agent` rules** in robots.txt — GPTBot, OAI-SearchBot,
   Claude-Web, Google-Extended, + wildcard, with our allow/disallow policy.
   - Skill: https://isitagentready.com/.well-known/agent-skills/ai-rules/SKILL.md
   - https://developers.cloudflare.com/ai-crawl-control/

5. **Content-Signal directives** in robots.txt — declare AI usage prefs, e.g.
   `Content-Signal: ai-train=no, search=yes, ai-input=no` (Carson to confirm the
   actual policy).
   - Skill: https://isitagentready.com/.well-known/agent-skills/content-signals/SKILL.md
   - https://contentsignals.org/

6. **`/.well-known/api-catalog`** (RFC 9727) — `application/linkset+json` with a
   `linkset` array; each entry: `anchor` (API URL) + relations `service-desc`
   (OpenAPI), `service-doc`, `status` (health). We already have `/api/agent/*`
   and `/api/health` to point at.
   - Skill: https://isitagentready.com/.well-known/agent-skills/api-catalog/SKILL.md
   - RFC 9727: https://www.rfc-editor.org/rfc/rfc9727

7. ✅ **Markdown-for-agents** — DONE. Requests with `Accept: text/markdown` (and
   not `text/html`) return a markdown rendition with `Content-Type:
   text/markdown`, `Vary: Accept`, and an `x-markdown-tokens` size hint; browsers
   (which always send `text/html`) get HTML. Wired on `/` (full-site context) and
   the deep-link/view routes (`/live`, `/chain/:name`, `/scam/:slug`,
   `/collection/:id`, every `VIEW_OG` view) via the `servePage` helper. Pure
   negotiation in `src/lib/negotiate.js`; routes covered by
   `test/agent-discovery.integration.test.js`.
   - Skill: https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md
   - https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/

8. ✅ **`/.well-known/mcp/server-card.json`** (SEP-1649) — DONE. The Phase F
   `chaindump-mcp` server is now HOSTED on **Cloud Run in `arkova1`** (Carson:
   "use existing for now") at
   `https://chaindump-mcp-270018525501.us-central1.run.app/mcp`. The card
   advertises serverInfo, the streamable-http endpoint, and the 6 tools. Verified
   live: card 200 + the endpoint it points at returns 200 (no dead URL) + real
   `tools/call`s work against production data (screen_address → ⛔ SANCTIONED,
   chain_forensics → sourced verdict).
   - Skill: https://isitagentready.com/.well-known/agent-skills/mcp-server-card/SKILL.md

9. ✅ **`/.well-known/agent-skills/index.json`** (Agent Skills Discovery RFC
   v0.2.0) — DONE. `$schema` + one `chaindump-chain-intel` skill pointing at the
   served skill doc (`/.well-known/agent-skills/chaindump-chain-intel.md`), with a
   **request-time SHA-256** so the digest always matches the doc (verified live:
   both 200, `digestMatches: true`). The skill advertises the LIVE x402 agent API
   (`/api/agent/*`, verified 200/402 before publishing).
   - Skill: https://isitagentready.com/.well-known/agent-skills/agent-skills/SKILL.md
   - https://github.com/cloudflare/agent-skills-discovery-rfc

## Conditional (only if we expose protected APIs)

Implemented as a real, minimal OAuth 2.0 **identity** layer over the agent API.
The API data is still metered by x402 (payment); OAuth adds standards-compliant
registration + bearer-token identity so agents can discover *how to
authenticate*. Every published endpoint resolves and functions — no fabricated
metadata. Pure logic in `src/lib/oauth.js`; D1 tables in
`migrations/0009_oauth_clients.sql`; flow covered end-to-end in
`test/agent-discovery.integration.test.js`. Secrets + tokens are stored
SHA-256-hashed.

10. ✅ **OAuth discovery** — DONE. `/.well-known/oauth-authorization-server`
    (RFC 8414): `client_credentials` grant, token/registration/revocation/
    introspection endpoints, plus a WorkOS `agent_auth` block. (Pure OAuth 2.0,
    so `oauth-authorization-server`, not `openid-configuration`.)
    - https://www.rfc-editor.org/rfc/rfc8414
11. ✅ **OAuth Protected Resource Metadata** — DONE.
    `/.well-known/oauth-protected-resource` (RFC 9728): `resource` =
    `/api/agent`, `authorization_servers`, `scopes_supported`,
    `bearer_methods_supported`. A 401 from `/api/agent/whoami` returns a
    `WWW-Authenticate` pointing back at this document.
    - RFC 9728: https://www.rfc-editor.org/rfc/rfc9728
12. ✅ **`/auth.md`** — DONE. Served at the site root with the full register →
    token → call walkthrough. Registration (RFC 7591) at `POST /oauth/register`;
    tokens (RFC 6749 §4.4) at `POST /oauth/token`; revoke/introspect (RFC 7009 /
    7662).
    - https://workos.com/auth-md

## Stretch

13. 🟡 **DNS-AID records** — PREPARED (pending zone apply). Record set + apply
    runbook + DNSSEC steps in [`docs/dns-aid.md`](dns-aid.md):
    `_index/_skills/_mcp/_oauth/_api._agents.chaindump.xyz` ServiceMode SVCB/HTTPS
    records pointing at endpoints that already resolve. Applying them + enabling
    DNSSEC is a Cloudflare zone-edit op left for a human (outward-facing).
    - draft-mozleywilliams-dnsop-dnsaid · RFC 9460
14. ✅ **WebMCP** — DONE. `public/index.html` calls
    `navigator.modelContext.provideContext()` with three read-only tools
    (`chaindump_screen_address`, `chaindump_chain_intel`, `chaindump_top_chains`)
    backed by the site's own public JSON API. No-ops where the API is absent.
    - https://webmachinelearning.github.io/webmcp/

## Notes
- **Carson granted permission (2026-07-13) to use Claude in Chrome for anything
  needed during this phase** — e.g. running the isitagentready.com audit against
  chaindump.xyz to confirm each item flips to pass, testing crawler/agent
  behavior, or verifying `Accept: text/markdown` negotiation from a real browser.
- Most `.well-known/*` and robots/sitemap are cheap Worker routes — batch them.
- The api-catalog + mcp-server-card + agent-skills-index should reference the
  real `/api/agent/*` surface and the Phase F MCP server, so sequence them so
  the pointers are accurate.
- Confirm the Content-Signal + AI-crawler policy with Carson before publishing
  (it's a business decision: do we allow AI training on our analysis?).
