CREATE TABLE signal_observations (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_page_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  normalized_status TEXT NOT NULL,
  raw_status_json TEXT NOT NULL,
  latency_ms REAL,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (page_id, source_id, source_page_id, service_id, observed_at)
);

CREATE INDEX signal_observations_target_time_idx
  ON signal_observations(page_id, source_id, source_page_id, service_id, observed_at DESC);

CREATE TABLE automation_suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('degradation', 'recovery')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'ignored', 'superseded')),
  version INTEGER NOT NULL CHECK (version > 0),
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_page_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  native_event_id TEXT REFERENCES native_events(id) ON DELETE SET NULL,
  native_event_version INTEGER CHECK (native_event_version IS NULL OR native_event_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_actor TEXT
);

CREATE UNIQUE INDEX automation_suggestions_one_pending_target_idx
  ON automation_suggestions(page_id, source_id, source_page_id, service_id)
  WHERE state = 'pending';

CREATE INDEX automation_suggestions_state_updated_idx
  ON automation_suggestions(state, updated_at DESC);

CREATE TABLE automation_suggestion_entries (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL REFERENCES automation_suggestions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (
    kind IN ('created', 'evidence_updated', 'accepted', 'ignored', 'superseded')
  ),
  evidence_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  UNIQUE (suggestion_id, sequence)
);

CREATE INDEX automation_suggestion_entries_suggestion_idx
  ON automation_suggestion_entries(suggestion_id, sequence DESC);

CREATE TABLE signal_automation_tracks (
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_page_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (
    classification IN ('healthy', 'degraded', 'maintenance', 'unknown')
  ),
  consecutive_count INTEGER NOT NULL CHECK (consecutive_count > 0),
  last_observation_id TEXT NOT NULL REFERENCES signal_observations(id) ON DELETE CASCADE,
  last_observed_at TEXT NOT NULL,
  active_native_event_id TEXT REFERENCES native_events(id) ON DELETE SET NULL,
  cooldown_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (page_id, source_id, source_page_id, service_id)
);

CREATE TABLE automation_decisions (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES signal_observations(id) ON DELETE CASCADE,
  rule_version TEXT NOT NULL,
  outcome TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  suggestion_id TEXT REFERENCES automation_suggestions(id) ON DELETE SET NULL,
  decided_at TEXT NOT NULL,
  UNIQUE (observation_id)
);

CREATE INDEX automation_decisions_outcome_time_idx
  ON automation_decisions(outcome, decided_at DESC);
