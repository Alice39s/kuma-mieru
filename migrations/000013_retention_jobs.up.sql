ALTER TABLE email_subscriptions
  ADD COLUMN pii_deleted_at TEXT;

ALTER TABLE backup_artifacts
  ADD COLUMN retention_state TEXT NOT NULL DEFAULT 'current'
  CHECK (retention_state IN ('current', 'eligible', 'hold'));

ALTER TABLE backup_artifacts
  ADD COLUMN retention_decided_at TEXT;

CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  run_trigger TEXT NOT NULL CHECK (run_trigger IN ('admin', 'scheduler', 'restore')),
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  cutoffs_json TEXT NOT NULL,
  summary_json TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX retention_runs_one_running_idx
  ON retention_runs(state)
  WHERE state = 'running';

CREATE INDEX retention_runs_started_idx
  ON retention_runs(started_at DESC);

CREATE INDEX email_subscriptions_retention_idx
  ON email_subscriptions(state, updated_at, pii_deleted_at);
