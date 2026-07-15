# DNS for AI Discovery (DNS-AID) — chaindump.xyz

Prepared record set + apply runbook for DNS-based agent discovery, per
[draft-mozleywilliams-dnsop-dnsaid](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/)
and [RFC 9460 (SVCB/HTTPS records)](https://www.rfc-editor.org/rfc/rfc9460).

> **Status: prepared, not yet applied.** Publishing these records + enabling
> DNSSEC are Cloudflare **zone-edit** operations (outward-facing, hard to
> reverse). They are intentionally left for a human to apply against the
> `chaindump.xyz` zone (`e0db1713017f5da643066c2d2aa54bf4`) — the Worker code
> in this repo cannot and should not mutate DNS. Every endpoint the records
> point at already resolves in production (verified: see the checklist below).

## What DNS-AID does

An agent that knows only the domain `chaindump.xyz` can look up
`_<service>._agents.chaindump.xyz` in DNS and learn where each agent-facing
service lives — no scraping, no guessing `.well-known` paths. We publish one
**ServiceMode SVCB/HTTPS** record per service, each carrying `alpn` (the
transport) and pointing at the host that serves it. A companion `TXT` record
carries the concrete endpoint URL for that service (a pragmatic convention while
the draft's endpoint SvcParam key is finalized).

## Records to publish

All at the `_agents` label under the apex. `1` is the SvcPriority (ServiceMode);
`.` as TargetName means "same as the owner's parent" (i.e. `chaindump.xyz`).

```zone
; --- Agent discovery entrypoints (DNS-AID) ---

; Index: the top-level agent surface. Points at the RFC 9727 API catalog.
_index._agents.chaindump.xyz.  300 IN HTTPS 1 chaindump.xyz. alpn="h2,h3"
_index._agents.chaindump.xyz.  300 IN TXT   "endpoint=https://chaindump.xyz/.well-known/api-catalog" "type=application/linkset+json"

; Agent skills discovery index.
_skills._agents.chaindump.xyz. 300 IN HTTPS 1 chaindump.xyz. alpn="h2,h3"
_skills._agents.chaindump.xyz. 300 IN TXT   "endpoint=https://chaindump.xyz/.well-known/agent-skills/index.json"

; MCP server card -> streamable-http MCP endpoint.
_mcp._agents.chaindump.xyz.    300 IN HTTPS 1 chaindump.xyz. alpn="h2,h3"
_mcp._agents.chaindump.xyz.    300 IN TXT   "endpoint=https://chaindump.xyz/.well-known/mcp/server-card.json"

; OAuth 2.0 authorization server + protected-resource metadata (agent auth).
_oauth._agents.chaindump.xyz.  300 IN HTTPS 1 chaindump.xyz. alpn="h2,h3"
_oauth._agents.chaindump.xyz.  300 IN TXT   "authorization_server=https://chaindump.xyz/.well-known/oauth-authorization-server" "protected_resource=https://chaindump.xyz/.well-known/oauth-protected-resource"

; x402-payable agent API entrypoint.
_api._agents.chaindump.xyz.    300 IN HTTPS 1 chaindump.xyz. alpn="h2,h3"
_api._agents.chaindump.xyz.    300 IN TXT   "endpoint=https://chaindump.xyz/api/agent/manifest"
```

Every `endpoint=` target above returns `200` in production today, so the records
never advertise a dead URL.

## Apply via the Cloudflare API

The `chaindump.xyz` zone lives on Cloudflare. Use the `Chaindump_Cloudflare`
token (GCP Secret Manager, project `arkova1` — it has DNS edit):

```sh
export CF_TOKEN="$(gcloud secrets versions access latest --secret=Chaindump_Cloudflare --project=arkova1)"
export ZONE=e0db1713017f5da643066c2d2aa54bf4

# Example: the _index HTTPS ServiceMode record (repeat per record above).
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H 'content-type: application/json' \
  -d '{
        "type": "HTTPS",
        "name": "_index._agents",
        "data": { "priority": 1, "target": "chaindump.xyz",
                  "value": "alpn=\"h2,h3\"" },
        "ttl": 300
      }'

# And its companion TXT:
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H 'content-type: application/json' \
  -d '{ "type": "TXT", "name": "_index._agents",
        "content": "endpoint=https://chaindump.xyz/.well-known/api-catalog",
        "ttl": 300 }'
```

> Cloudflare's dashboard also has a **DNS → Records → Add record → HTTPS** form if
> you prefer clicking; the SvcParams go in the "Value" field as `alpn="h2,h3"`.

## DNSSEC (required by the fix)

Validating resolvers must be able to authenticate the discovery zone. Enable
DNSSEC on the zone and publish the DS record at the registrar:

1. Cloudflare dashboard → `chaindump.xyz` → **DNS → Settings → DNSSEC → Enable**
   (or `POST /zones/$ZONE/dnssec` with `{"status":"active"}`).
2. Cloudflare returns a **DS record** (key tag, algorithm, digest). Add that DS
   record at the domain **registrar** (where `chaindump.xyz` is registered).
3. Verify the chain of trust once it propagates:
   ```sh
   dig +dnssec _index._agents.chaindump.xyz HTTPS
   dig DS chaindump.xyz
   # or a validating check:
   delv _index._agents.chaindump.xyz HTTPS
   ```
   A validated answer shows the `ad` (authenticated data) flag.

## Verify after applying

```sh
for svc in index skills mcp oauth api; do
  echo "== _$svc._agents =="
  dig +short _$svc._agents.chaindump.xyz HTTPS
  dig +short _$svc._agents.chaindump.xyz TXT
done
```

Each should return the ServiceMode HTTPS record and its endpoint TXT, and
`dig +dnssec` should return `RRSIG` records alongside them.
