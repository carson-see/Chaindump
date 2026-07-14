// Pure, testable helpers for the x402 free-preview quota.
// The stateful map + request gating lives in x402Gate() in worker.js; this
// module holds only the month-key derivation and the leak-preventing prune so
// they can be unit-tested without a Worker runtime.
//
// DESIGN LIMITATION (intentional, documented): the free quota is held in an
// in-process object keyed by client IP. It is therefore PER-ISOLATE and
// PER-IP — a soft limit, not a hard one. Cloudflare may run many isolates and
// recycle them, so the effective free allowance is "FREE_LIMIT per IP per
// isolate per month", not a global guarantee. If a durable, cross-isolate hard
// quota is ever required, move this state to Cloudflare KV (or a Durable
// Object) keyed by `${monthKey}:${ip}`. Until then this only limits casual
// free use, which is the intent.

// Stable month key for the given date (UTC). Defaults to now; take an explicit
// date in tests so the result is deterministic.
export function monthKey(d = new Date()) {
  return d.getUTCFullYear() + '-' + d.getUTCMonth();
}

// Drop every quota entry whose monthKey no longer matches the current month —
// once the month rolls over those entries can never be relevant again (a new
// month resets each IP's count), so keeping them is a pure memory leak. This
// bounds the map to at most one entry per IP seen *in the current month*.
// Mutates `quota` in place; returns the number of entries removed.
export function pruneStaleQuota(quota, currentKey) {
  if (!quota) return 0;
  let removed = 0;
  for (const ip of Object.keys(quota)) {
    const q = quota[ip];
    if (!q || q.monthKey !== currentKey) {
      delete quota[ip];
      removed++;
    }
  }
  return removed;
}

// Record one free-preview hit for `ip` in the given month and decide whether it
// is still within the free allowance. Encapsulates the full bookkeeping so the
// Worker's gate stays a thin wrapper and the logic is unit-testable:
//   1. On month rollover (tracked via the mutable `state.lastPruneKey`) sweep
//      last month's entries exactly once — the leak fix.
//   2. Get-or-create this IP's counter for the current month, then increment.
//   3. Allow while count <= limit; report remaining free calls.
// Mutates `quota` and `state` in place. Returns { allowed, remaining, count }.
export function hitQuota(quota, ip, currentKey, limit, state) {
  if (state.lastPruneKey !== currentKey) {
    pruneStaleQuota(quota, currentKey);
    state.lastPruneKey = currentKey;
  }
  let q = quota[ip];
  if (!q || q.monthKey !== currentKey) { q = quota[ip] = { count: 0, monthKey: currentKey }; }
  q.count++;
  return { allowed: q.count <= limit, remaining: Math.max(0, limit - q.count), count: q.count };
}
