CREATE TABLE encrypted_secrets (
  secret_ref TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce BLOB NOT NULL CHECK (length(nonce) = 12),
  ciphertext BLOB NOT NULL,
  auth_tag BLOB NOT NULL CHECK (length(auth_tag) = 16),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, field_name)
);

CREATE INDEX encrypted_secrets_key_id_idx ON encrypted_secrets(key_id);
CREATE INDEX encrypted_secrets_purpose_idx ON encrypted_secrets(purpose);
