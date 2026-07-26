CREATE TABLE recurring_maintenance_plans (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'archived')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  next_occurrence_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

CREATE INDEX recurring_maintenance_plans_due_idx
  ON recurring_maintenance_plans(next_occurrence_at, id)
  WHERE state = 'active' AND next_occurrence_at IS NOT NULL;

CREATE INDEX recurring_maintenance_plans_state_updated_idx
  ON recurring_maintenance_plans(state, updated_at DESC, id);

CREATE TABLE recurring_maintenance_plan_entries (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES recurring_maintenance_plans(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'archived')),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  affected_components_json TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  interval_count INTEGER NOT NULL CHECK (interval_count BETWEEN 1 AND 52),
  weekdays_json TEXT NOT NULL,
  anchor_start_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10080),
  recurrence_end_at TEXT,
  recorded_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  UNIQUE (plan_id, sequence)
);

CREATE INDEX recurring_maintenance_plan_entries_plan_idx
  ON recurring_maintenance_plan_entries(plan_id, sequence DESC);

CREATE TABLE recurring_maintenance_occurrences (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES recurring_maintenance_plans(id) ON DELETE RESTRICT,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  event_id TEXT NOT NULL UNIQUE REFERENCES native_events(id) ON DELETE RESTRICT,
  scheduled_start_at TEXT NOT NULL,
  scheduled_end_at TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  UNIQUE (plan_id, scheduled_start_at)
);

CREATE INDEX recurring_maintenance_occurrences_plan_idx
  ON recurring_maintenance_occurrences(plan_id, scheduled_start_at DESC);
