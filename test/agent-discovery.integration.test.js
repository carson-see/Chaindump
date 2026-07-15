// Route-level integration tests for the agent-discovery / auth surface. These
// boot the actual Hono app from src/worker.js and drive it end-to-end with a
// tiny in-memory D1 stub, covering the OAuth 2.0 flow (register -> token ->
// whoami -> revoke), the discovery metadata documents, and markdown-for-agents
// content negotiation.
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshWorker() {
  vi.resetModules();
  return (await import('../src/worker.js')).default;
}
function ctx() { return { waitUntil() {}, passThroughOnException() {} }; }

// Minimal D1 stub supporting exactly the oauth_clients / oauth_tokens queries the
// Worker issues. Branches on the SQL text; keeps rows in two Maps.
function makeDB() {
  const clients = new Map();
  const tokens = new Map();
  function prepare(sql) {
    return {
      async all() { return { results: [] }; },
      async first() { return null; },
      bind(...args) {
        return {
          async run() {
            if (/INSERT INTO oauth_clients/.test(sql)) {
              const [client_id, client_secret_hash, client_name, scope, created_at] = args;
              clients.set(client_id, { client_id, client_secret_hash, client_name, scope, created_at });
            } else if (/INSERT INTO oauth_tokens/.test(sql)) {
              const [token_hash, client_id, scope, expires_at, created_at] = args;
              tokens.set(token_hash, { token_hash, client_id, scope, expires_at, created_at });
            } else if (/DELETE FROM oauth_tokens/.test(sql)) {
              const [token_hash, client_id] = args;
              const t = tokens.get(token_hash);
              if (t && t.client_id === client_id) tokens.delete(token_hash);
            }
            return { success: true };
          },
          async first() {
            if (/FROM oauth_clients WHERE client_id/.test(sql)) return clients.get(args[0]) || null;
            if (/FROM oauth_tokens WHERE token_hash/.test(sql)) return tokens.get(args[0]) || null;
            return null;
          },
          async all() { return { results: [] }; },
        };
      },
    };
  }
  return { prepare, _clients: clients, _tokens: tokens };
}
const basic = (id, secret) => 'Basic ' + btoa(`${id}:${secret}`);

describe('OAuth 2.0 flow (register -> token -> whoami -> revoke)', () => {
  let worker, env;
  beforeEach(async () => { worker = await freshWorker(); env = { DB: makeDB() }; });

  async function register() {
    const res = await worker.fetch(new Request('http://localhost/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'test-agent' }),
    }), env, ctx());
    return { res, body: await res.json() };
  }
  async function token(id, secret) {
    const res = await worker.fetch(new Request('http://localhost/oauth/token', {
      method: 'POST', headers: { authorization: basic(id, secret), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    }), env, ctx());
    return { res, body: await res.json() };
  }

  it('registers a client and returns a one-time secret (201)', async () => {
    const { res, body } = await register();
    expect(res.status).toBe(201);
    expect(body.client_id).toMatch(/^cd_/);
    expect(body.client_secret).toBeTruthy();
    expect(body.grant_types).toEqual(['client_credentials']);
    // Secret is stored hashed, never in the clear.
    const stored = env.DB._clients.get(body.client_id);
    expect(stored.client_secret_hash).not.toBe(body.client_secret);
    expect(stored.client_secret_hash).toHaveLength(64);
  });

  it('issues a bearer token for valid client_credentials', async () => {
    const { body: client } = await register();
    const { res, body } = await token(client.client_id, client.client_secret);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token).toBeTruthy();
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.scope).toBe('agent:read');
  });

  it('rejects a bad client secret with invalid_client (401)', async () => {
    const { body: client } = await register();
    const { res, body } = await token(client.client_id, 'wrong-secret');
    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
  });

  it('rejects an unsupported grant_type', async () => {
    const { body: client } = await register();
    const res = await worker.fetch(new Request('http://localhost/oauth/token', {
      method: 'POST', headers: { authorization: basic(client.client_id, client.client_secret), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }).toString(),
    }), env, ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_grant_type');
  });

  it('whoami confirms identity with a valid token, 401s without', async () => {
    const { body: client } = await register();
    const { body: tok } = await token(client.client_id, client.client_secret);

    const ok = await worker.fetch(new Request('http://localhost/api/agent/whoami', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    }), env, ctx());
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.authenticated).toBe(true);
    expect(okBody.client_id).toBe(client.client_id);

    const no = await worker.fetch(new Request('http://localhost/api/agent/whoami'), env, ctx());
    expect(no.status).toBe(401);
    expect(no.headers.get('www-authenticate')).toContain('oauth-protected-resource');
  });

  it('revokes a token so whoami then 401s', async () => {
    const { body: client } = await register();
    const { body: tok } = await token(client.client_id, client.client_secret);
    const rev = await worker.fetch(new Request('http://localhost/oauth/revoke', {
      method: 'POST', headers: { authorization: basic(client.client_id, client.client_secret), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tok.access_token }).toString(),
    }), env, ctx());
    expect(rev.status).toBe(200);
    const after = await worker.fetch(new Request('http://localhost/api/agent/whoami', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    }), env, ctx());
    expect(after.status).toBe(401);
    expect((await after.json()).error).toBe('invalid_token');
  });
});

describe('discovery metadata documents', () => {
  let worker;
  beforeEach(async () => { worker = await freshWorker(); });

  it('serves RFC 8414 authorization-server metadata with an agent_auth block', async () => {
    const res = await worker.fetch(new Request('http://localhost/.well-known/oauth-authorization-server'), {}, ctx());
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.issuer).toBe('https://chaindump.xyz');
    expect(m.token_endpoint).toBe('https://chaindump.xyz/oauth/token');
    expect(m.grant_types_supported).toEqual(['client_credentials']);
    expect(m.agent_auth.register_uri).toBe('https://chaindump.xyz/oauth/register');
  });

  it('serves RFC 9728 protected-resource metadata', async () => {
    const res = await worker.fetch(new Request('http://localhost/.well-known/oauth-protected-resource'), {}, ctx());
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.resource).toBe('https://chaindump.xyz/api/agent');
    expect(m.authorization_servers).toEqual(['https://chaindump.xyz']);
  });

  it('serves /auth.md as markdown', async () => {
    const res = await worker.fetch(new Request('http://localhost/auth.md'), {}, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toContain('client_credentials');
  });
});

describe('markdown-for-agents content negotiation', () => {
  let worker;
  beforeEach(async () => { worker = await freshWorker(); });

  it('serves markdown on / when the client asks for text/markdown only', async () => {
    const res = await worker.fetch(new Request('http://localhost/', { headers: { accept: 'text/markdown' } }), {}, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('vary')).toBe('Accept');
    expect(Number(res.headers.get('x-markdown-tokens'))).toBeGreaterThan(0);
  });

  it('serves markdown on a deep-link (scam case) for a markdown-only client', async () => {
    // Uses a D1 stub so the handler resolves without network; the case is unknown
    // so it renders the fallback markdown — enough to prove negotiation on a
    // non-homepage route.
    const res = await worker.fetch(new Request('http://localhost/scam/some-case', { headers: { accept: 'text/markdown' } }), { DB: makeDB() }, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('x-markdown-tokens')).toBeTruthy();
    expect(await res.text()).toMatch(/^# /);
  });
});
