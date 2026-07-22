CREATE TABLE source_http_cache (
  source_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_id, resource_key)
);

CREATE TABLE source_snapshots (
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_updated_at TEXT,
  stale_after TEXT NOT NULL,
  PRIMARY KEY (source_id, page_id)
);

CREATE TABLE source_health (
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'stale', 'unavailable')),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  error_code TEXT,
  retry_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, page_id)
);

CREATE INDEX source_snapshots_stale_after_idx ON source_snapshots(stale_after);
CREATE INDEX source_health_state_idx ON source_health(state, retry_at);
