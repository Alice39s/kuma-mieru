CREATE UNIQUE INDEX "account_provider_accountId_idx"
  ON "account" ("providerId", "accountId");

CREATE TABLE auth_oidc_provider (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  display_name TEXT NOT NULL,
  discovery_url TEXT NOT NULL,
  issuer TEXT NOT NULL,
  authorization_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  user_info_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ref TEXT NOT NULL REFERENCES encrypted_secrets(secret_ref),
  token_endpoint_auth_method TEXT NOT NULL
    CHECK (token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
