CREATE TABLE IF NOT EXISTS cloud_runtime_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO cloud_runtime_metadata (key, value)
VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS cloud_rate_limit_windows (
    bucket_key TEXT PRIMARY KEY,
    route TEXT NOT NULL CHECK (length(route) BETWEEN 1 AND 160),
    window_started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_cloud_rate_limit_expiry
ON cloud_rate_limit_windows (expires_at);
