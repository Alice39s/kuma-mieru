DROP INDEX config_revisions_content_hash_idx;

CREATE INDEX config_revisions_content_hash_idx ON config_revisions(mode, content_hash);
CREATE INDEX config_revisions_created_at_idx ON config_revisions(created_at DESC);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  before_json TEXT,
  after_json TEXT,
  error_code TEXT
);

CREATE INDEX admin_audit_occurred_at_idx ON admin_audit(occurred_at DESC);
CREATE INDEX admin_audit_actor_idx ON admin_audit(actor_id, occurred_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit(target_type, target_id, occurred_at DESC);
