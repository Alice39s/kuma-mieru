CREATE TABLE backup_artifacts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('creating', 'ready', 'failed')),
  file_name TEXT NOT NULL,
  manifest_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);

CREATE UNIQUE INDEX backup_artifacts_file_name_idx ON backup_artifacts(file_name);
CREATE INDEX backup_artifacts_state_created_idx
  ON backup_artifacts(state, created_at DESC);
