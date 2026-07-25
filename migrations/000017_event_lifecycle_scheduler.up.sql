ALTER TABLE native_events
  ADD COLUMN lifecycle_due_at TEXT;

CREATE INDEX native_events_lifecycle_due_idx
  ON native_events(lifecycle_due_at, id)
  WHERE lifecycle_due_at IS NOT NULL;
