CREATE TABLE config_transition_previews (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  from_mode TEXT NOT NULL CHECK (from_mode IN ('managed', 'file')),
  to_mode TEXT NOT NULL CHECK (to_mode IN ('managed', 'file')),
  expected_revision INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('managed', 'file')),
  source_ref TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target_content_hash TEXT NOT NULL,
  target_config_json TEXT NOT NULL,
  target_parent_revision INTEGER,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX config_transition_previews_expiry_idx
  ON config_transition_previews(expires_at, consumed_at);

ALTER TABLE config_transitions ADD COLUMN preview_id TEXT
  REFERENCES config_transition_previews(id);
ALTER TABLE config_transitions ADD COLUMN source_kind TEXT;
ALTER TABLE config_transitions ADD COLUMN source_ref TEXT;
ALTER TABLE config_transitions ADD COLUMN target_hash TEXT;
ALTER TABLE config_transitions ADD COLUMN target_revision INTEGER;
ALTER TABLE config_transitions ADD COLUMN backup_artifact_id TEXT;
ALTER TABLE config_transitions ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX config_transitions_preview_idx
  ON config_transitions(preview_id)
  WHERE preview_id IS NOT NULL;
