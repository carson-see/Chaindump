import { describe, it, expect } from 'vitest';
import {
  USDC_DP,
  monthKeyFromDate,
  isLiveMode,
  decodePaymentHeader,
  paymentRequirements,
  structuralCheck,
} from '../src/lib/x402.js';

const CFG = {
  payTo: '0xReceiVer0000000000000000000000000000AAAA',
  network: 'base',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  facilitator: 'https://facilitator.test',
};

// base64(JSON) helper mirroring how an agent encodes the X-PAYMENT header.
function encode(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function payment({ to = CFG.payTo, value = '50000', network = 'base', scheme = 'exact' } = {}) {
  return { x402Version: 1, scheme, network, payload: { signature: '0xsig', authorization: { from: '0xPayer', to, value, validAfter: '0', validBefore: '99999999999', nonce: '0x01' } } };
}

describe('monthKeyFromDate', () => {
  it('formats YYYY-M with a 0-indexed UTC month', () => {
    expect(monthKeyFromDate(new Date('2026-07-14T00:00:00Z'))).toBe('2026-6');
    expect(monthKeyFromDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-0');
  });
});

describe('isLiveMode', () => {
  it('is live only when payTo AND an http(s) facilitator are set', () => {
    expect(isLiveMode(CFG)).toBe(true);
    expect(isLiveMode({ ...CFG, facilitator: 'https://x/' })).toBe(true);
  });
  it('is demo when the wallet is missing (no hardcoded fallback)', () => {
    expect(isLiveMode({ ...CFG, payTo: null })).toBe(false);
    expect(isLiveMode({ ...CFG, payTo: '' })).toBe(false);
  });
  it('is demo when the facilitator is the sentinel or not a URL', () => {
    expect(isLiveMode({ ...CFG, facilitator: 'coinbase-cdp' })).toBe(false);
    expect(isLiveMode({ ...CFG, facilitator: '' })).toBe(false);
  });
  it('is demo for null/undefined config', () => {
    expect(isLiveMode(null)).toBe(false);
    expect(isLiveMode(undefined)).toBe(false);
  });
});

describe('decodePaymentHeader', () => {
  it('round-trips a base64(JSON) payment payload', () => {
    const p = payment();
    expect(decodePaymentHeader(encode(p))).toEqual(p);
  });
  it('returns null for non-base64 / non-JSON / empty input', () => {
    expect(decodePaymentHeader('x')).toBeNull();          // 'x' decodes but isn't JSON
    expect(decodePaymentHeader('!!!not base64!!!')).toBeNull();
    expect(decodePaymentHeader('')).toBeNull();
    expect(decodePaymentHeader(null)).toBeNull();
    expect(decodePaymentHeader(undefined)).toBeNull();
  });
  it('returns null when the decoded JSON is not an object', () => {
    expect(decodePaymentHeader(btoa('42'))).toBeNull();
    expect(decodePaymentHeader(btoa('"str"'))).toBeNull();
  });
});

describe('paymentRequirements', () => {
  it('builds an exact-scheme accepts object from the price + config', () => {
    expect(paymentRequirements('/api/agent/risk', 50000, 'Risk', CFG)).toEqual({
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '50000',
      resource: '/api/agent/risk',
      description: 'Risk',
      mimeType: 'application/json',
      payTo: CFG.payTo,
      asset: CFG.asset,
      maxTimeoutSeconds: 60,
    });
  });
});

describe('structuralCheck', () => {
  const reqs = paymentRequirements('/api/agent/risk', 50000, 'Risk', CFG);

  it('accepts a matching payment (exact amount)', () => {
    expect(structuralCheck(payment({ value: '50000' }), reqs)).toEqual({ ok: true });
  });
  it('accepts an overpayment', () => {
    expect(structuralCheck(payment({ value: '60000' }), reqs)).toEqual({ ok: true });
  });
  it('rejects the wrong recipient (case-insensitively compared)', () => {
    expect(structuralCheck(payment({ to: '0xWrongRecipient' }), reqs)).toEqual({ ok: false, reason: 'payTo_mismatch' });
  });
  it('treats the payTo match as case-insensitive', () => {
    expect(structuralCheck(payment({ to: CFG.payTo.toUpperCase() }), reqs)).toEqual({ ok: true });
  });
  it('rejects an underpayment', () => {
    expect(structuralCheck(payment({ value: '49999' }), reqs)).toEqual({ ok: false, reason: 'amount_insufficient' });
  });
  it('rejects the wrong network and unsupported scheme', () => {
    expect(structuralCheck(payment({ network: 'ethereum' }), reqs)).toEqual({ ok: false, reason: 'network_mismatch' });
    expect(structuralCheck(payment({ scheme: 'upto' }), reqs)).toEqual({ ok: false, reason: 'scheme_unsupported' });
  });
  it('rejects malformed / missing payloads', () => {
    expect(structuralCheck(null, reqs)).toEqual({ ok: false, reason: 'malformed' });
    expect(structuralCheck({ scheme: 'exact', network: 'base' }, reqs)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('rejects a non-numeric amount', () => {
    expect(structuralCheck(payment({ value: 'abc' }), reqs)).toEqual({ ok: false, reason: 'amount_malformed' });
  });
});

describe('USDC_DP', () => {
  it('is 1e6 (USDC has 6 decimals)', () => {
    expect(USDC_DP).toBe(1e6);
  });
});
