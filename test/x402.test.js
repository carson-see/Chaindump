import { describe, it, expect } from 'vitest';
import {
  DEMO_PAYTO,
  resolvePayTo,
  displayPayTo,
  paymentMode,
  manifestMode,
  facilitatorUrl,
  decodePaymentHeader,
  paymentMatchesRequirement,
} from '../src/lib/x402.js';

const REAL_WALLET = '0x1111111111111111111111111111111111111111';

// base64 helper that works in node + worker
const b64 = (obj) =>
  typeof btoa === 'function'
    ? btoa(JSON.stringify(obj))
    : Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

describe('resolvePayTo — no hardcoded fallback', () => {
  it('returns null when X402_PAY_TO is unset (fail closed, never a baked-in wallet)', () => {
    expect(resolvePayTo({})).toBeNull();
    expect(resolvePayTo({ X402_PAY_TO: '' })).toBeNull();
    expect(resolvePayTo({ X402_PAY_TO: '   ' })).toBeNull();
    expect(resolvePayTo(undefined)).toBeNull();
  });
  it('returns the configured wallet, trimmed', () => {
    expect(resolvePayTo({ X402_PAY_TO: REAL_WALLET })).toBe(REAL_WALLET);
    expect(resolvePayTo({ X402_PAY_TO: `  ${REAL_WALLET}  ` })).toBe(REAL_WALLET);
  });
});

describe('displayPayTo — safe advertised address', () => {
  it('falls back to the zero-address sentinel, never a real wallet', () => {
    expect(displayPayTo({})).toBe(DEMO_PAYTO);
    expect(DEMO_PAYTO).toBe('0x0000000000000000000000000000000000000000');
  });
  it('uses the configured wallet when set', () => {
    expect(displayPayTo({ X402_PAY_TO: REAL_WALLET })).toBe(REAL_WALLET);
  });
});

describe('paymentMode', () => {
  it('is demo for unset / zero / non-string', () => {
    expect(paymentMode(null)).toBe('demo');
    expect(paymentMode('')).toBe('demo');
    expect(paymentMode(DEMO_PAYTO)).toBe('demo');
    expect(paymentMode('0x0000000000000000000000000000000000000000')).toBe('demo');
    expect(paymentMode(12345)).toBe('demo');
  });
  it('is live for a real wallet', () => {
    expect(paymentMode(REAL_WALLET)).toBe('live');
  });
});

describe('manifestMode — the manifest must report demo unless fully wired', () => {
  it("reports 'demo' when X402_PAY_TO is unset", () => {
    expect(manifestMode({})).toBe('demo');
    expect(manifestMode({ X402_FACILITATOR: 'https://x402.org/facilitator' })).toBe('demo');
  });
  it("reports 'demo' when a wallet is set but no facilitator URL is wired", () => {
    expect(manifestMode({ X402_PAY_TO: REAL_WALLET })).toBe('demo');
    expect(manifestMode({ X402_PAY_TO: REAL_WALLET, X402_FACILITATOR: 'coinbase-cdp' })).toBe('demo');
  });
  it("reports 'live' only when both a real wallet and a facilitator URL are set", () => {
    expect(
      manifestMode({ X402_PAY_TO: REAL_WALLET, X402_FACILITATOR: 'https://x402.org/facilitator' })
    ).toBe('live');
  });
});

describe('facilitatorUrl', () => {
  it('returns null for the legacy non-URL sentinel and blanks', () => {
    expect(facilitatorUrl({})).toBeNull();
    expect(facilitatorUrl({ X402_FACILITATOR: 'coinbase-cdp' })).toBeNull();
    expect(facilitatorUrl({ X402_FACILITATOR: '' })).toBeNull();
  });
  it('returns the http(s) URL with trailing slashes trimmed', () => {
    expect(facilitatorUrl({ X402_FACILITATOR: 'https://x402.org/facilitator/' })).toBe(
      'https://x402.org/facilitator'
    );
    expect(facilitatorUrl({ X402_FACILITATOR: 'http://localhost:8787' })).toBe('http://localhost:8787');
  });
});

describe('decodePaymentHeader', () => {
  it('decodes valid base64 JSON into an object', () => {
    const payload = { scheme: 'exact', network: 'base' };
    expect(decodePaymentHeader(b64(payload))).toEqual(payload);
  });
  it('returns null for malformed / non-object / empty input', () => {
    expect(decodePaymentHeader('')).toBeNull();
    expect(decodePaymentHeader(null)).toBeNull();
    expect(decodePaymentHeader('not-base64-!!!')).toBeNull();
    expect(decodePaymentHeader(b64([1, 2, 3]))).toBeNull(); // array, not object
    expect(decodePaymentHeader(b64('x'))).toBeNull(); // JSON string, not object
  });
});

describe('paymentMatchesRequirement — structural gate before the facilitator call', () => {
  const req = {
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: '5000',
    payTo: REAL_WALLET,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  };
  const good = {
    scheme: 'exact',
    network: 'base',
    payload: { authorization: { to: REAL_WALLET, value: '5000' } },
  };

  it('accepts a payload that targets our wallet, network, scheme and covers the price', () => {
    expect(paymentMatchesRequirement(good, req)).toBe(true);
    // over-payment is fine
    expect(
      paymentMatchesRequirement({ ...good, payload: { authorization: { to: REAL_WALLET, value: '9999' } } }, req)
    ).toBe(true);
    // address case-insensitive
    expect(
      paymentMatchesRequirement(
        { ...good, payload: { authorization: { to: REAL_WALLET.toUpperCase(), value: '5000' } } },
        req
      )
    ).toBe(true);
  });

  it('rejects wrong payTo (funds would go elsewhere)', () => {
    const evil = { ...good, payload: { authorization: { to: '0x2222222222222222222222222222222222222222', value: '5000' } } };
    expect(paymentMatchesRequirement(evil, req)).toBe(false);
  });
  it('rejects underpayment', () => {
    expect(
      paymentMatchesRequirement({ ...good, payload: { authorization: { to: REAL_WALLET, value: '4999' } } }, req)
    ).toBe(false);
  });
  it('rejects wrong network and wrong scheme', () => {
    expect(paymentMatchesRequirement({ ...good, network: 'ethereum' }, req)).toBe(false);
    expect(paymentMatchesRequirement({ ...good, scheme: 'upto' }, req)).toBe(false);
  });
  it('rejects missing authorization or garbage amounts', () => {
    expect(paymentMatchesRequirement({ scheme: 'exact', network: 'base', payload: {} }, req)).toBe(false);
    expect(
      paymentMatchesRequirement({ ...good, payload: { authorization: { to: REAL_WALLET, value: 'abc' } } }, req)
    ).toBe(false);
  });
  it('rejects null / undefined inputs', () => {
    expect(paymentMatchesRequirement(null, req)).toBe(false);
    expect(paymentMatchesRequirement(good, null)).toBe(false);
  });
});
