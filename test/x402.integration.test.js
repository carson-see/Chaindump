// Route-level integration tests for the x402 gate. These boot the actual Hono
// app from src/worker.js and drive the /api/agent/* endpoints end-to-end,
// exercising the demo-mode quota path and the live-mode facilitator verify+settle
// flow that the pure unit tests in x402.test.js can't reach.
//
// We hit /api/agent/risk/:entity because its handler's only data dependency is a
// dbQuery, which returns [] when env.DB is unset — so a granted request yields a
// clean 200 with no network/D1, isolating the gate as the thing under test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const PAY_TO = '0xReceiVer0000000000000000000000000000AAAA';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FACILITATOR = 'https://facilitator.test';
const RISK_PRICE = '50000'; // atomic USDC for /api/agent/risk, from AGENT_ENDPOINTS

// Fresh module (resets ENV / cache / freeQuota singletons) per test.
async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
function ctx() {
  return { waitUntil() {}, passThroughOnException() {} };
}
function riskRequest({ ip = '203.0.113.7', xPayment } = {}) {
  const headers = { 'cf-connecting-ip': ip };
  if (xPayment !== undefined) headers['x-payment'] = xPayment;
  return new Request('http://localhost/api/agent/risk/acme', { headers });
}
function encodePayment(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function validPaymentHeader({ to = PAY_TO, value = RISK_PRICE } = {}) {
  return encodePayment({
    x402Version: 1, scheme: 'exact', network: 'base',
    payload: { signature: '0xsig', authorization: { from: '0xPayer', to, value, validAfter: '0', validBefore: '99999999999', nonce: '0x01' } },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('x402 gate — demo mode (no X402_PAY_TO)', () => {
  const DEMO_ENV = {}; // no X402_PAY_TO, no facilitator, no DB

  beforeEach(() => {
    // Any facilitator/network call in demo mode is a bug — fail loudly if hit.
    vi.stubGlobal('fetch', vi.fn(async (url) => { throw new Error('unexpected network call in demo mode: ' + url); }));
  });

  it('ignores a forged X-PAYMENT header — first call is free quota (200), not a bypass', async () => {
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: 'x' }), DEMO_ENV, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-free-calls-remaining')).toBe('0');
    const body = await res.json();
    expect(body.flagged).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('second call from the same IP is 402 payment_required (quota exhausted, header still ignored)', async () => {
    const worker = await freshWorker();
    const first = await worker.fetch(riskRequest({ xPayment: 'x' }), DEMO_ENV, ctx());
    expect(first.status).toBe(200);
    const second = await worker.fetch(riskRequest({ xPayment: 'x' }), DEMO_ENV, ctx());
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.error).toBe('payment_required');
    expect(body.accepts[0]).toMatchObject({ scheme: 'exact', network: 'base', maxAmountRequired: RISK_PRICE });
  });

  it('manifest reports demo mode with a null payTo', async () => {
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/agent/manifest'), DEMO_ENV, ctx());
    const body = await res.json();
    expect(body.payment.mode).toBe('demo');
    expect(body.payment.payTo).toBeNull();
  });
});

describe('x402 gate — live mode (X402_PAY_TO + X402_FACILITATOR set)', () => {
  const LIVE_ENV = { X402_PAY_TO: PAY_TO, X402_FACILITATOR: FACILITATOR, X402_ASSET: ASSET, X402_NETWORK: 'base' };

  // Stub the facilitator: /verify and /settle each return a staged JSON body.
  function stubFacilitator({ verify, settle }) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
      const staged = String(url).endsWith('/verify') ? verify : String(url).endsWith('/settle') ? settle : null;
      if (staged == null) throw new Error('unexpected facilitator path: ' + url);
      return new Response(JSON.stringify(staged), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return calls;
  }

  it('missing X-PAYMENT → 402 payment_required, facilitator not called', async () => {
    const calls = stubFacilitator({ verify: { isValid: true }, settle: { success: true } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest(), LIVE_ENV, ctx());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('payment_required');
    expect(calls).toHaveLength(0);
  });

  it('valid payment + facilitator verify(isValid) then settle(success) → 200', async () => {
    const calls = stubFacilitator({ verify: { isValid: true }, settle: { success: true, transaction: '0xtxhash' } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader() }), LIVE_ENV, ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).flagged).toBe(false);
    expect(res.headers.get('x-payment-response')).toBe('0xtxhash');
    // both facilitator legs were exercised, in order
    expect(calls.map((c) => c.url)).toEqual([FACILITATOR + '/verify', FACILITATOR + '/settle']);
  });

  it('structural mismatch (wrong payTo) → 402 payment_invalid, facilitator never called', async () => {
    const calls = stubFacilitator({ verify: { isValid: true }, settle: { success: true } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader({ to: '0xAttacker' }) }), LIVE_ENV, ctx());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('payment_invalid');
    expect(body.reason).toBe('payTo_mismatch');
    expect(calls).toHaveLength(0); // rejected before trusting the facilitator
  });

  it('structural mismatch (underpayment) → 402 payment_invalid', async () => {
    stubFacilitator({ verify: { isValid: true }, settle: { success: true } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader({ value: '1' }) }), LIVE_ENV, ctx());
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe('amount_insufficient');
  });

  it('facilitator verify returns isValid:false → 402, settle never attempted', async () => {
    const calls = stubFacilitator({ verify: { isValid: false, invalidReason: 'insufficient_funds' }, settle: { success: true } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader() }), LIVE_ENV, ctx());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('payment_invalid');
    expect(body.reason).toBe('insufficient_funds');
    expect(calls.map((c) => c.url)).toEqual([FACILITATOR + '/verify']); // stopped after verify
  });

  it('facilitator settle returns success:false → 402 payment_invalid', async () => {
    stubFacilitator({ verify: { isValid: true }, settle: { success: false } });
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader() }), LIVE_ENV, ctx());
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe('settle_failed');
  });

  it('facilitator /verify transport failure → 503 retryable (not a 402 re-pay), settle not attempted', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      throw new Error('network down'); // transient outage on /verify
    }));
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader() }), LIVE_ENV, ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('facilitator_unavailable');
    expect(body.stage).toBe('verify');
    expect(body.retryable).toBe(true);
    expect(calls).toEqual([FACILITATOR + '/verify']); // never reached settle
  });

  it('facilitator /settle transport failure → 503 retryable (payment verified but not settled)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/verify')) return new Response(JSON.stringify({ isValid: true }), { status: 200 });
      throw new Error('network down'); // transient outage on /settle
    }));
    const worker = await freshWorker();
    const res = await worker.fetch(riskRequest({ xPayment: validPaymentHeader() }), LIVE_ENV, ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('facilitator_unavailable');
    expect(body.stage).toBe('settle');
  });

  it('manifest reports live mode with the configured payTo', async () => {
    stubFacilitator({ verify: { isValid: true }, settle: { success: true } });
    const worker = await freshWorker();
    const res = await worker.fetch(new Request('http://localhost/api/agent/manifest'), LIVE_ENV, ctx());
    const body = await res.json();
    expect(body.payment.mode).toBe('live');
    expect(body.payment.payTo).toBe(PAY_TO);
  });
});
