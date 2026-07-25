CREATE TABLE event_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('incident', 'maintenance', 'notice', 'postmortem')
  ),
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

CREATE INDEX event_templates_state_updated_idx
  ON event_templates(state, updated_at DESC, id);

CREATE TABLE event_template_entries (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  affected_components_json TEXT NOT NULL,
  default_notify_subscribers INTEGER NOT NULL CHECK (default_notify_subscribers IN (0, 1)),
  notice_kind TEXT CHECK (notice_kind IS NULL OR notice_kind IN ('information', 'warning')),
  recorded_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  UNIQUE (template_id, sequence)
);

CREATE INDEX event_template_entries_template_idx
  ON event_template_entries(template_id, sequence DESC);

ALTER TABLE native_events
  ADD COLUMN source_template_id TEXT REFERENCES event_templates(id);

ALTER TABLE native_events
  ADD COLUMN source_template_version INTEGER CHECK (
    source_template_version IS NULL OR source_template_version > 0
  );

ALTER TABLE native_events
  ADD COLUMN source_template_notify_suggestion INTEGER CHECK (
    source_template_notify_suggestion IS NULL
    OR source_template_notify_suggestion IN (0, 1)
  );

CREATE INDEX native_events_source_template_idx
  ON native_events(source_template_id, source_template_version)
  WHERE source_template_id IS NOT NULL;
