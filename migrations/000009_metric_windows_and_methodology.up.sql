DROP INDEX source_metric_extensions_stale_after_idx;

ALTER TABLE source_metric_extensions
  RENAME TO source_metric_extensions_v8;

CREATE TABLE source_metric_extensions (
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('5m', '1h', '1d', '7d', '30d')),
  extension_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  stale_after TEXT NOT NULL,
  PRIMARY KEY (source_id, page_id, window)
);

INSERT INTO source_metric_extensions
  (source_id, page_id, window, extension_json, content_hash, fetched_at, stale_after)
SELECT source_id, page_id, '5m', extension_json, content_hash, fetched_at, stale_after
FROM source_metric_extensions_v8;

DROP TABLE source_metric_extensions_v8;

CREATE INDEX source_metric_extensions_stale_after_idx
  ON source_metric_extensions(stale_after);

CREATE TABLE source_methodologies (
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  stale_after TEXT NOT NULL,
  PRIMARY KEY (source_id, page_id)
);

CREATE INDEX source_methodologies_stale_after_idx
  ON source_methodologies(stale_after);
