CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw 20 ms readings. PK doubles as the (mill, signal, time) index and makes ingestion idempotent.
CREATE TABLE IF NOT EXISTS readings (
  mill_id TEXT NOT NULL,
  signal  TEXT NOT NULL,
  ts      TIMESTAMPTZ NOT NULL,
  value   DOUBLE PRECISION NOT NULL,
  unit    TEXT,
  quality SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (mill_id, signal, ts)
);
CREATE INDEX IF NOT EXISTS readings_ts_brin ON readings USING BRIN (ts);

-- 1 s rollups kept long after raw data is pruned; used for wide historical ranges.
CREATE TABLE IF NOT EXISTS rollup_1s (
  mill_id TEXT NOT NULL, signal TEXT NOT NULL, bucket TIMESTAMPTZ NOT NULL,
  avg DOUBLE PRECISION NOT NULL, min DOUBLE PRECISION NOT NULL, max DOUBLE PRECISION NOT NULL,
  std DOUBLE PRECISION NOT NULL, n INT NOT NULL,
  PRIMARY KEY (mill_id, signal, bucket)
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  mill_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  signals TEXT[] NOT NULL,
  reason TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_mill_start ON alerts (mill_id, start_ts DESC);

-- Simulator state (cursor of the embedded virtual PLC) and operator-triggered scenarios.
CREATE TABLE IF NOT EXISTS sim_state (mill_id TEXT PRIMARY KEY, cursor_ts TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS scenario_events (
  id SERIAL PRIMARY KEY, mill_id TEXT NOT NULL, kind TEXT NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL, created_by TEXT
);
