ALTER TABLE native_events
  ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE native_events
  ADD COLUMN parent_event_id TEXT REFERENCES native_events(id);

ALTER TABLE native_event_entries
  ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX native_events_parent_idx
  ON native_events(parent_event_id, updated_at DESC);
