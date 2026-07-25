ALTER TABLE native_events
  ADD COLUMN lifecycle_due_at TEXT;

UPDATE native_events
SET lifecycle_due_at = CASE
  WHEN type = 'maintenance' AND state = 'scheduled'
    THEN strftime(
      '%Y-%m-%dT%H:%M:%fZ',
      json_extract(details_json, '$.scheduledStartAt')
    )
  WHEN type = 'maintenance' AND state = 'in_progress'
    THEN strftime(
      '%Y-%m-%dT%H:%M:%fZ',
      json_extract(details_json, '$.scheduledEndAt')
    )
  WHEN type = 'notice' AND state = 'published'
    THEN strftime(
      '%Y-%m-%dT%H:%M:%fZ',
      json_extract(details_json, '$.endsAt')
    )
  ELSE NULL
END;

CREATE INDEX native_events_lifecycle_due_idx
  ON native_events(lifecycle_due_at, id)
  WHERE lifecycle_due_at IS NOT NULL;
