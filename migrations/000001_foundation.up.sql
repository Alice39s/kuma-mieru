CREATE TABLE config_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('managed', 'file', 'compatibility')),
  config_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parent_revision INTEGER REFERENCES config_revisions(revision),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX config_revisions_content_hash_idx
  ON config_revisions(mode, content_hash);

CREATE TABLE runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE config_transitions (
  id TEXT PRIMARY KEY,
  from_mode TEXT NOT NULL,
  to_mode TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  expected_revision INTEGER,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  actor TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
