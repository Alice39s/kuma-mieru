CREATE TABLE native_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('incident', 'maintenance', 'notice', 'postmortem')),
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

CREATE INDEX native_events_page_updated_idx
  ON native_events(page_id, updated_at DESC);

CREATE TABLE native_event_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES native_events(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (kind IN ('created', 'update')),
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  affected_components_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  UNIQUE (event_id, sequence)
);

CREATE INDEX native_event_entries_event_idx
  ON native_event_entries(event_id, sequence DESC);

CREATE TABLE email_subscriptions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  incident_id TEXT,
  scope_key TEXT NOT NULL,
  component_ids_json TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  email_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending_confirmation', 'active', 'unsubscribed', 'suppressed', 'expired')
  ),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (page_id, scope_key, email_hash)
);

CREATE INDEX email_subscriptions_delivery_scope_idx
  ON email_subscriptions(page_id, state, incident_id);

CREATE TABLE subscription_tokens (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES email_subscriptions(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'manage', 'unsubscribe')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE event_publications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES native_events(id) ON DELETE CASCADE,
  event_sequence INTEGER NOT NULL,
  page_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  notify_subscribers INTEGER NOT NULL CHECK (notify_subscribers IN (0, 1)),
  subscriber_scope_json TEXT NOT NULL,
  estimated_recipients INTEGER NOT NULL CHECK (estimated_recipients >= 0),
  actor_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (event_id, event_sequence),
  FOREIGN KEY (event_id, event_sequence)
    REFERENCES native_event_entries(event_id, sequence)
);

CREATE INDEX event_publications_page_published_idx
  ON event_publications(page_id, published_at DESC);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  publication_id TEXT REFERENCES event_publications(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES email_subscriptions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'sent', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  payload_ciphertext TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX notification_outbox_worker_idx
  ON notification_outbox(state, next_attempt_at);

CREATE TABLE public_rate_limits (
  key_hash TEXT NOT NULL,
  bucket_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (key_hash, bucket_started_at)
);

CREATE INDEX public_rate_limits_expiry_idx
  ON public_rate_limits(bucket_started_at);
