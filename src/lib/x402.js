// Pure, testable helpers for the x402 agent-payment gate. The DB/network side
// (facilitator verify+settle over fetch) lives in verifyPayment() in worker.js;
// everything here is side-effect-free and import-tested by test/x402.test.js.
//
// Security model (see the 2026-07-14 go-live pass):
//   - No hardcoded receiving wallet. If X402_PAY_TO is unset we fall back to the
//     zero-address SENTINEL, which is a burn address and forces demo mode — a
//     missing env var can NEVER silently route real funds to some baked-in wallet.
//   - A payment is only ever accepted in 'live' mode (real payTo + a real
//     facilitator URL). Presence of an X-PAYMENT header is never trusted on its
//     own; it must pass a structural match here and then facilitator verify+settle.

// Zero address. Safe display/sentinel value when no wallet is configured: it is
// unspendable, and paymentMode() treats it as demo so nothing is ever accepted.
export const DEMO_PAYTO = '0x0000000000000000000000000000000000000000';

// Resolve the operator's configured receiving wallet from env. No hardcoded
// fallback by design — unset/blank returns null so the caller fails closed.
export function resolvePayTo(env) {
  const v = ((env && env.X402_PAY_TO) || '').trim();
  return v || null;
}

// The payTo to advertise in the manifest / 402 challenge: the real wallet if set,
// else the zero-address sentinel (never a real, baked-in address).
export function displayPayTo(env) {
  return resolvePayTo(env) || DEMO_PAYTO;
}

// 'live' only when a real, non-zero wallet is configured. Unset or all-zero
// (the demo sentinel) => 'demo'. Live mode is the only mode that accepts payment.
export function paymentMode(payTo) {
  if (!payTo || typeof payTo !== 'string') return 'demo';
  if (/^0x0+$/i.test(payTo.trim())) return 'demo';
  return 'live';
}

// Mode reported by /api/agent/manifest for a given env. Demo unless BOTH a real
// wallet AND a real facilitator URL are wired — either missing means no payment
// can actually be verified, so advertising 'live' would be dishonest.
export function manifestMode(env) {
  return paymentMode(resolvePayTo(env)) === 'live' && facilitatorUrl(env)
    ? 'live'
    : 'demo';
}

// Facilitator base URL — only if it is an http(s) URL. The legacy sentinel
// 'coinbase-cdp' (or anything non-URL) returns null: no verifier is wired, so
// the gate fails closed. Trailing slashes are trimmed.
export function facilitatorUrl(env) {
  const v = ((env && env.X402_FACILITATOR) || '').trim();
  return /^https?:\/\//i.test(v) ? v.replace(/\/+$/, '') : null;
}

// Decode the base64 X-PAYMENT header into a payment-payload object. Returns null
// on anything malformed (bad base64, bad JSON, non-object).
export function decodePaymentHeader(header) {
  if (!header || typeof header !== 'string') return null;
  try {
    const json =
      typeof atob === 'function'
        ? atob(header.trim())
        : Buffer.from(header.trim(), 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function eqAddr(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}

function toBig(x) {
  try {
    if (x === null || x === undefined || x === '') return null;
    return BigInt(String(x));
  } catch {
    return null;
  }
}

// Structural pre-check run BEFORE spending a network round-trip on the
// facilitator. The signed EIP-3009 authorization must target our payTo, be on
// our network, use the 'exact' scheme, and authorize at least the required
// amount. The asset contract is not present in the payload — it is enforced by
// the facilitator, which we hand the full paymentRequirements (asset included).
export function paymentMatchesRequirement(payload, req) {
  if (!payload || !req) return false;
  if (payload.scheme && payload.scheme !== req.scheme) return false;
  if (
    payload.network &&
    String(payload.network).toLowerCase() !== String(req.network).toLowerCase()
  ) {
    return false;
  }
  const auth = payload.payload && payload.payload.authorization;
  if (!auth) return false;
  if (!eqAddr(auth.to, req.payTo)) return false;
  const value = toBig(auth.value);
  const need = toBig(req.maxAmountRequired);
  if (value === null || need === null || value < need) return false;
  return true;
}
