CREATE TABLE backup_deletions (
  backup_id TEXT PRIMARY KEY REFERENCES backup_artifacts(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('staging', 'staged', 'completed')),
  manifest_sha256 TEXT NOT NULL CHECK (
    length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_sha256 TEXT NOT NULL CHECK (
    length(artifact_sha256) = 64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  deleted_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX backup_deletions_state_requested_idx
  ON backup_deletions(state, requested_at);
