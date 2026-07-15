import { describe, it, expect } from 'vitest';
import {
  OAUTH_SCOPES,
  TOKEN_TTL_SECONDS,
  asMetadata,
  protectedResourceMetadata,
  parseBearer,
  clientAuthFromRequest,
  validateTokenRequest,
  grantedScope,
  isExpired,
} from '../src/lib/oauth.js';

const ORIGIN = 'https://chaindump.xyz';

describe('asMetadata (RFC 8414 authorization server metadata)', () => {
  const m = asMetadata(ORIGIN);
  it('sets the issuer to the origin exactly (issuer must equal the metadata host)', () => {
    expect(m.issuer).toBe(ORIGIN);
  });
  it('advertises token + registration + revocation endpoints under the origin', () => {
    expect(m.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(m.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(m.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
    expect(m.introspection_endpoint).toBe(`${ORIGIN}/oauth/introspect`);
  });
  it('supports only the client_credentials grant (no authorization-code/implicit)', () => {
    expect(m.grant_types_supported).toEqual(['client_credentials']);
  });
  it('includes response_types_supported as an array (RFC 8414 REQUIRED) — empty since no authz endpoint', () => {
    expect(Array.isArray(m.response_types_supported)).toBe(true);
    expect(m.response_types_supported).toEqual([]);
  });
  it('carries a WorkOS auth.md agent_auth block with registration + credential metadata', () => {
    expect(m.agent_auth.register_uri).toBe(`${ORIGIN}/oauth/register`);
    expect(m.agent_auth.credential_types).toContain('client_secret');
    expect(m.agent_auth.identity_types.length).toBeGreaterThan(0);
    expect(m.agent_auth.revocation_uri).toBe(`${ORIGIN}/oauth/revoke`);
  });
});

describe('protectedResourceMetadata (RFC 9728)', () => {
  const m = protectedResourceMetadata(ORIGIN);
  it('identifies the agent API as the resource', () => {
    expect(m.resource).toBe(`${ORIGIN}/api/agent`);
  });
  it('lists this origin as an authorization server that can issue tokens', () => {
    expect(m.authorization_servers).toEqual([ORIGIN]);
  });
  it('declares the supported scopes and bearer method', () => {
    expect(m.scopes_supported).toEqual(OAUTH_SCOPES);
    expect(m.bearer_methods_supported).toContain('header');
  });
});

describe('parseBearer', () => {
  it('extracts the token from a Bearer Authorization header', () => {
    expect(parseBearer('Bearer abc.123')).toBe('abc.123');
    expect(parseBearer('bearer abc.123')).toBe('abc.123');
  });
  it('returns null for missing/non-bearer headers', () => {
    expect(parseBearer('')).toBe(null);
    expect(parseBearer(undefined)).toBe(null);
    expect(parseBearer('Basic Zm9vOmJhcg==')).toBe(null);
  });
});

describe('clientAuthFromRequest', () => {
  it('reads client_secret_basic (base64 clientId:secret in Authorization)', () => {
    const basic = 'Basic ' + btoa('cid:secret');
    expect(clientAuthFromRequest(basic, {})).toEqual({ clientId: 'cid', clientSecret: 'secret' });
  });
  it('reads client_secret_post (credentials in the form body)', () => {
    expect(clientAuthFromRequest('', { client_id: 'cid', client_secret: 'sec' }))
      .toEqual({ clientId: 'cid', clientSecret: 'sec' });
  });
  it('prefers the Authorization header when both are present', () => {
    const basic = 'Basic ' + btoa('hdr:hsec');
    expect(clientAuthFromRequest(basic, { client_id: 'body', client_secret: 'bsec' }))
      .toEqual({ clientId: 'hdr', clientSecret: 'hsec' });
  });
  it('handles a secret that itself contains a colon', () => {
    const basic = 'Basic ' + btoa('cid:a:b:c');
    expect(clientAuthFromRequest(basic, {})).toEqual({ clientId: 'cid', clientSecret: 'a:b:c' });
  });
  it('returns null when no credentials are present', () => {
    expect(clientAuthFromRequest('', {})).toBe(null);
  });
});

describe('validateTokenRequest', () => {
  it('accepts a client_credentials grant', () => {
    expect(validateTokenRequest({ grant_type: 'client_credentials' })).toEqual({ ok: true });
  });
  it('rejects a missing grant_type (invalid_request)', () => {
    expect(validateTokenRequest({})).toEqual({ ok: false, error: 'invalid_request' });
  });
  it('rejects an unsupported grant_type (unsupported_grant_type)', () => {
    expect(validateTokenRequest({ grant_type: 'authorization_code' }))
      .toEqual({ ok: false, error: 'unsupported_grant_type' });
  });
});

describe('grantedScope', () => {
  it('defaults to the full client scope when none requested', () => {
    expect(grantedScope('', 'agent:read')).toBe('agent:read');
  });
  it('intersects the requested scope with what the client holds', () => {
    expect(grantedScope('agent:read', 'agent:read')).toBe('agent:read');
  });
  it('drops requested scopes the client does not hold', () => {
    expect(grantedScope('agent:read agent:admin', 'agent:read')).toBe('agent:read');
    expect(grantedScope('agent:admin', 'agent:read')).toBe('');
  });
});

describe('isExpired', () => {
  it('is false before expiry, true at/after', () => {
    expect(isExpired(1000, 999)).toBe(false);
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1000, 1001)).toBe(true);
  });
});

describe('constants', () => {
  it('token TTL is a positive number of seconds', () => {
    expect(TOKEN_TTL_SECONDS).toBeGreaterThan(0);
  });
  it('agent:read is an advertised scope', () => {
    expect(OAUTH_SCOPES).toContain('agent:read');
  });
});
