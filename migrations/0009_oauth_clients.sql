-- OAuth 2.0 identity layer for the agent API (RFC 7591 dynamic client
-- registration + RFC 6749 §4.4 client_credentials). Secrets and tokens are
-- stored HASHED (SHA-256), never in plaintext — the raw values are returned to
-- the caller once at registration / issuance and never persisted.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id           TEXT PRIMARY KEY,
  client_secret_hash  TEXT NOT NULL,
  client_name         TEXT,
  scope               TEXT,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  scope       TEXT,
  expires_at  INTEGER NOT NULL,   -- unix seconds
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client  ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires_at);
