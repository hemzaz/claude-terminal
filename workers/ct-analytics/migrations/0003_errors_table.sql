CREATE TABLE IF NOT EXISTS errors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL,
  installation_id TEXT    NOT NULL,
  app_version     TEXT    NOT NULL,
  os              TEXT    NOT NULL,
  country         TEXT    NOT NULL,
  source          TEXT    NOT NULL,
  kind            TEXT,
  message         TEXT    NOT NULL,
  stack           TEXT,
  fingerprint     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_ts          ON errors(ts);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_errors_install     ON errors(installation_id);
