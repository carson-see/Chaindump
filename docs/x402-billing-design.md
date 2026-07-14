# x402 real-billing gate — design note

> Status: **initial gate shipped** (PR #9). `x402Gate()` now runs a real
> demo/live split: demo mode **ignores** `X-PAYMENT` and enforces a free quota;
> live mode requires a structurally-valid `X-PAYMENT` for the exact
> payTo/amount, then calls the facilitator `/verify` + `/settle` before serving
> (`verify → settle → serve`). The hardcoded payTo fallback is removed
> (fail-closed to demo when `X402_PAY_TO` is unset). Pure logic lives in
> `src/lib/x402.js`; route-level coverage is in `test/x402.integration.test.js`.
>
> This note captures the **go-live target** that is *not yet built*: the
> `verify → serve → settle` reordering and a durable **nonce replay store**.

## Go-live prerequisites (blockers)

- `X402_PAY_TO` — real Base receiving wallet (never a hardcoded fallback; the
  gate is **fail-closed** — demo mode when unset, never a default payout).
- `X402_FACILITATOR` — an **http(s) URL** for the facilitator (the default
  `coinbase-cdp` sentinel keeps the gate in demo). Confirm the facilitator's
  real contract + auth before flipping to live — the current code POSTs
  unauthenticated JSON to `/verify` and `/settle`; the Coinbase CDP facilitator
  is SDK/API-key based (`CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`) and will need
  auth wiring if it's the chosen facilitator.
- A durable nonce store (see below) for the `verify → serve → settle` target.

## Target ordering: verify → serve → settle (NOT the current verify → settle → serve)

The shipped gate settles the payment at the gate, before the route runs. That is
replay-safe (settling consumes the EIP-3009 nonce on-chain) but has a UX flaw:
**if the route handler throws OR 404s after settlement, the agent was charged but
gets no data.** Two concrete cases in the current code:
- `GET /api/agent/chain/:key` for an unknown chain: the gate verifies + settles,
  then the handler returns `404 unknown_chain` — **charged, nothing delivered.**
- Any handler that throws after the gate (e.g. `loadSnapshot` fails) → `500`,
  **charged, nothing delivered.**

This is a **go-live blocker** (harmless today: live mode is disabled until the
facilitator + secrets are wired, so the gate is fail-closed to demo and never
settles). The fix is the reordering below.

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
5. Return the x402 **`X-PAYMENT-RESPONSE`** header on success per the spec
   (base64(settlement JSON) — the current gate emits the raw tx hash as a
   placeholder until the real settle-response shape is wired).

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

## Tests to add (when the target ordering is built)

- Verify success → serve → settle → nonce recorded.
- **Replay rejection**: a request whose nonce is already recorded is rejected
  fail-closed and the route data is not served.
- Handler-throws-after-verify: not settled, nonce not recorded, agent retriable.
- Settle-failure and store-write-failure: both fail closed.

Keep `npm test` (`vitest run`) green.
