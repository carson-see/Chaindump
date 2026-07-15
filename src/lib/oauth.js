// Minimal OAuth 2.0 surface for the Chaindump agent API — pure, testable helpers.
//
// Chaindump's agent API (`/api/agent/*`) is metered by x402 (payment). This layer
// adds a standards-compliant *identity* surface on top so agents can discover how
// to authenticate (RFC 8414 / RFC 9728), register (RFC 7591 dynamic client
// registration), and obtain a bearer token via the `client_credentials` grant
// (RFC 6749 §4.4). Tokens identify a registered agent and unlock the identity-
// scoped endpoint (`/api/agent/whoami`); x402 still governs the metered data.
//
// D1 I/O (storing clients/tokens) lives in the Worker. Everything here is pure so
// it can be unit-tested without a database — see test/oauth.test.js.

export const OAUTH_SCOPES = ['agent:read'];
export const TOKEN_TTL_SECONDS = 3600; // 1h bearer tokens

// RFC 8414 — OAuth 2.0 Authorization Server Metadata. Served at
// /.well-known/oauth-authorization-server. `issuer` MUST equal the origin the
// document is served from. We support only client_credentials, so there is no
// authorization endpoint and response_types_supported is an empty array (the
// field is REQUIRED by RFC 8414 but has no applicable values here).
export function asMetadata(origin) {
  return {
    issuer: origin,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    introspection_endpoint: `${origin}/oauth/introspect`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: [],
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    service_documentation: `${origin}/auth.md`,
    // WorkOS auth.md agent_auth block: how an autonomous agent registers and what
    // identity/credential/revocation primitives it can use. There is no per-claim
    // issuance flow here (client_credentials is machine-to-machine), so no claim_uri.
    agent_auth: {
      register_uri: `${origin}/oauth/register`,
      token_uri: `${origin}/oauth/token`,
      revocation_uri: `${origin}/oauth/revoke`,
      identity_types: ['service_account'],
      credential_types: ['client_secret'],
      grant_types: ['client_credentials'],
      scopes_supported: OAUTH_SCOPES,
      protected_resource: `${origin}/.well-known/oauth-protected-resource`,
      documentation: `${origin}/auth.md`,
    },
  };
}

// RFC 9728 — OAuth 2.0 Protected Resource Metadata. Served at
// /.well-known/oauth-protected-resource. Tells an agent which authorization
// server(s) issue tokens for the agent API and how to present them.
export function protectedResourceMetadata(origin) {
  return {
    resource: `${origin}/api/agent`,
    resource_name: 'Chaindump Agent API',
    authorization_servers: [origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/auth.md`,
  };
}

// Extract a bearer token from an Authorization header. Case-insensitive scheme.
export function parseBearer(authHeader) {
  const m = /^bearer\s+(.+)$/i.exec(String(authHeader || '').trim());
  return m ? m[1].trim() : null;
}

// Resolve client credentials from either client_secret_basic (Authorization:
// Basic base64(id:secret)) or client_secret_post (id/secret in the form body).
// The header wins when both are present. A colon may appear in the secret but not
// the client_id, so we split on the FIRST colon only.
export function clientAuthFromRequest(authHeader, body = {}) {
  const h = String(authHeader || '').trim();
  const basic = /^basic\s+(.+)$/i.exec(h);
  if (basic) {
    let decoded = '';
    try { decoded = atob(basic[1].trim()); } catch { return null; }
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { clientId: decoded.slice(0, i), clientSecret: decoded.slice(i + 1) };
  }
  if (body.client_id && body.client_secret) {
    return { clientId: String(body.client_id), clientSecret: String(body.client_secret) };
  }
  return null;
}

// Validate the token-endpoint request per grant type (only client_credentials).
export function validateTokenRequest(params = {}) {
  const grant = params.grant_type;
  if (!grant) return { ok: false, error: 'invalid_request' };
  if (grant !== 'client_credentials') return { ok: false, error: 'unsupported_grant_type' };
  return { ok: true };
}

// Compute the scope actually granted: default to the client's full scope when the
// request asks for none, otherwise intersect the request with what the client holds.
export function grantedScope(requested, clientScope) {
  const held = new Set(String(clientScope || '').split(/\s+/).filter(Boolean));
  const req = String(requested || '').split(/\s+/).filter(Boolean);
  if (!req.length) return [...held].join(' ');
  return req.filter((s) => held.has(s)).join(' ');
}

// A token is expired once now (seconds) reaches its expiry timestamp.
export function isExpired(expiresAtSec, nowSec) {
  return nowSec >= expiresAtSec;
}
