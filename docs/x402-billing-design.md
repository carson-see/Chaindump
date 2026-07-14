# x402 real-billing gate — design note

> Status: **not built.** The agent API runs in **demo mode** —
> [`x402Gate()`](../src/worker.js) trusts any non-empty `X-PAYMENT` header
> (`if (pay) return true;`). There is no facilitator call, no on-chain
> verification, no settlement, and no `verifyPayment()` function. This note
> captures the correct design so real billing is built right the first time.

## Go-live prerequisites (blockers)

- `X402_PAY_TO` — real Base receiving wallet (never the hardcoded fallback; make
  it **fail-closed** — demo mode when unset, never a default payout address).
- Coinbase CDP facilitator creds: `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`.
- A durable nonce store (see below).

## Ordering: verify → serve → settle (NOT verify → settle → serve)

The obvious implementation settles the payment at the gate, before the route
runs. That is replay-safe (settling consumes the EIP-3009 nonce on-chain) but
has a UX flaw: **if the route handler throws after settlement (e.g.
`loadSnapshot` fails), the agent was charged but gets a 500 with no data.**

Preferred flow, per metered request:

1. **Verify** the `X-PAYMENT` authorization with the facilitator `/verify`.
   Reject (`402`, fail-closed) on any error.
2. **Replay check** — look up the authorization nonce in the durable store.
   If already recorded, reject as replay (`402`/`409`, fail-closed).
3. **Serve** the route data. If the handler throws, return `500` and **do not
   settle** — the agent is not charged. It can retry with the same authorization.
4. **Settle** via facilitator `/settle`, then **record the nonce** in the
   durable store. If settle fails, fail-closed (the client keeps its funds; log
   for reconciliation).
5. Return the x402 **`X-PAYMENT-RESPONSE`** header on success per the spec.

Fail-closed on every **pre-serve** error path — verify failure, replay hit.
This ordering deliberately prioritizes **never charge without delivering** over
**never deliver without charging**: the pre-serve `/verify` confirms the
authorization is valid and funded, so a post-serve `/settle` failure should be
rare — but when it happens the agent got the data unbilled. Treat that as the
accepted tradeoff (log it for reconciliation), not a guarantee you can also
close. If unbilled-delivery is unacceptable for a given endpoint, keep
`verify → settle → serve` there and accept the stranded-charge window instead.

## Durable nonce store

The repo already uses D1 (`env.DB`). Either:

- **D1 table** (new migration `migrations/NNNN_x402_nonces.sql`):
  ```sql
  CREATE TABLE x402_nonces (
    nonce      TEXT PRIMARY KEY,   -- EIP-3009 authorization nonce
    payer      TEXT,
    resource   TEXT,
    settled_at INTEGER             -- unix seconds
  );
  ```
  Insert with a bound `?` param after settle; a duplicate-key insert (or a prior
  `SELECT`) signals replay. Prune old rows in the existing `handleScheduled`
  prune tick.
- **or Cloudflare KV** — add a KV namespace binding in `wrangler.jsonc`, key on
  the nonce, TTL past the authorization validity window. Lower write latency,
  eventual consistency (fine here — settle already consumes the nonce on-chain,
  so the store is defense-in-depth against double-serve, not the sole guard).

D1 is the lighter lift (no new binding) and keeps replay records queryable.

## Tests to add (when built)

- `test/x402.test.js`: verify success → serve → settle → nonce recorded.
- **Replay rejection**: a request whose nonce is already recorded is rejected
  fail-closed and the route data is not served.
- Handler-throws-after-verify: not settled, nonce not recorded, agent retriable.
- Settle-failure and store-write-failure: both fail closed.

Keep `npm test` (`vitest run`) green.
