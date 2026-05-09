CREATE TABLE IF NOT EXISTS file_deliveries (
	id TEXT PRIMARY KEY,
	object_key TEXT NOT NULL UNIQUE,
	file_name TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size INTEGER NOT NULL,
	pickup_code_hash TEXT NOT NULL UNIQUE,
	manage_code_hash TEXT NOT NULL UNIQUE,
	max_downloads INTEGER NOT NULL,
	download_count INTEGER NOT NULL DEFAULT 0,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	deleted_at INTEGER,
	deleted_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_deliveries_pickup_code_hash
	ON file_deliveries (pickup_code_hash);

CREATE INDEX IF NOT EXISTS idx_file_deliveries_manage_code_hash
	ON file_deliveries (manage_code_hash);

CREATE INDEX IF NOT EXISTS idx_file_deliveries_expires_at
	ON file_deliveries (expires_at);
