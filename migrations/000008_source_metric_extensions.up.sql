CREATE TABLE source_metric_extensions (
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  extension_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  stale_after TEXT NOT NULL,
  PRIMARY KEY (source_id, page_id)
);

CREATE INDEX source_metric_extensions_stale_after_idx
  ON source_metric_extensions(stale_after);
