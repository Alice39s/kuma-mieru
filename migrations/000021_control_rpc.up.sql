CREATE TABLE "apikey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "configId" TEXT NOT NULL DEFAULT 'control-rpc',
  "name" TEXT,
  "start" TEXT,
  "referenceId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "prefix" TEXT,
  "key" TEXT NOT NULL,
  "refillInterval" INTEGER,
  "refillAmount" INTEGER,
  "lastRefillAt" DATE,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "rateLimitEnabled" INTEGER NOT NULL DEFAULT 1,
  "rateLimitTimeWindow" INTEGER NOT NULL DEFAULT 60000,
  "rateLimitMax" INTEGER NOT NULL DEFAULT 60,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "remaining" INTEGER,
  "lastRequest" DATE,
  "expiresAt" DATE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "permissions" TEXT,
  "metadata" TEXT
);

CREATE INDEX "apikey_configId_idx" ON "apikey" ("configId");
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("referenceId");
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");

CREATE TABLE control_operations (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  action TEXT NOT NULL,
  external_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'pending',
      'succeeded',
      'failed',
      'outcome_unknown',
      'resolved_applied',
      'resolved_not_applied'
    )
  ),
  error_code TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX control_operations_provider_created_idx
  ON control_operations(provider_id, created_at DESC);

CREATE TABLE control_resource_bindings (
  local_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind = 'http_monitor'),
  created_by_request_id TEXT NOT NULL REFERENCES control_operations(request_id),
  created_at TEXT NOT NULL,
  UNIQUE(provider_id, external_id)
);
