CREATE TABLE mirrored_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_page_id TEXT NOT NULL,
  upstream_event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('incident', 'maintenance')),
  source_url TEXT NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('present', 'absent')),
  version INTEGER NOT NULL CHECK (version > 0),
  latest_content_hash TEXT NOT NULL,
  latest_snapshot_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  absent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, source_page_id, type, upstream_event_id)
);

CREATE INDEX mirrored_events_source_presence_idx
  ON mirrored_events(source_id, source_page_id, presence, updated_at DESC);

CREATE INDEX mirrored_events_updated_idx
  ON mirrored_events(updated_at DESC);

CREATE TABLE mirrored_event_entries (
  id TEXT PRIMARY KEY,
  mirrored_event_id TEXT NOT NULL REFERENCES mirrored_events(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  observation_kind TEXT NOT NULL CHECK (
    observation_kind IN ('initial', 'updated', 'absent', 'reappeared')
  ),
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_updated_at TEXT,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (mirrored_event_id, sequence)
);

CREATE INDEX mirrored_event_entries_event_idx
  ON mirrored_event_entries(mirrored_event_id, sequence DESC);
