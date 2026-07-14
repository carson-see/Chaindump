// Pure, testable helpers for the x402 agent-payment gate. No I/O here — the
// route wiring (facilitator verify+settle over the network, the free-quota
// store, and the HTTP 402 responses) lives in x402Gate() in worker.js and
// consumes these functions. Keeping the decode + structural validation pure is
// what lets the gate be unit- and integration-tested without a live wallet.

export const USDC_DP = 1e6; // USDC has 6 decimals; atomic units → USDC = /1e6

// month bucket for the free-quota window, e.g. "2026-6" (0-indexed month, UTC).
// Pure over an injected Date so it can be tested deterministically.
export function monthKeyFromDate(d) {
  return d.getUTCFullYear() + '-' + d.getUTCMonth();
}

// Live mode requires a real receiving wallet AND a facilitator URL we can POST
// to for on-chain verification. With either missing we run in demo mode, which
// hands out a small free quota and NEVER trusts an X-PAYMENT header. There is
// deliberately no hardcoded payTo fallback: no wallet configured ⇒ fail closed
// to demo, so a misconfigured deploy can never bill to a stale address.
export function isLiveMode(cfg) {
  return !!(cfg && cfg.payTo && cfg.facilitator && /^https?:\/\//i.test(cfg.facilitator));
}

// Decode the base64(JSON) X-PAYMENT header into an object. Returns null for any
// malformed input rather than throwing — the caller treats null as invalid.
export function decodePaymentHeader(header) {
  if (!header || typeof header !== 'string') return null;
  try {
    const bin = atob(header.trim());
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) {
    return null;
  }
}

// Build the x402 `accepts` requirement object advertised on a 402 and handed to
// the facilitator. Pure function of the endpoint price + payment config.
export function paymentRequirements(resource, priceAtomic, desc, cfg) {
  return {
    scheme: 'exact',
    network: cfg.network,
    maxAmountRequired: String(priceAtomic),
    resource,
    description: desc,
    mimeType: 'application/json',
    payTo: cfg.payTo,
    asset: cfg.asset,
    maxTimeoutSeconds: 60,
  };
}

// Structural validation of a decoded payment against the requirements, done
// BEFORE trusting the facilitator: even if the facilitator says isValid, a
// payment whose recipient or amount doesn't match what we asked for is invalid.
// Returns { ok:true } or { ok:false, reason }.
export function structuralCheck(payment, requirements) {
  if (!payment || typeof payment !== 'object') return { ok: false, reason: 'malformed' };
  if (payment.scheme !== requirements.scheme) return { ok: false, reason: 'scheme_unsupported' };
  if (payment.network !== requirements.network) return { ok: false, reason: 'network_mismatch' };
  const auth = payment.payload && payment.payload.authorization;
  if (!auth || typeof auth !== 'object') return { ok: false, reason: 'malformed' };
  if (!auth.to || String(auth.to).toLowerCase() !== String(requirements.payTo).toLowerCase()) {
    return { ok: false, reason: 'payTo_mismatch' };
  }
  let paid, required;
  try {
    paid = BigInt(auth.value);
    required = BigInt(requirements.maxAmountRequired);
  } catch (e) {
    return { ok: false, reason: 'amount_malformed' };
  }
  if (paid < required) return { ok: false, reason: 'amount_insufficient' };
  return { ok: true };
}
