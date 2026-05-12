CREATE TABLE IF NOT EXISTS cap_challenges (
	token TEXT PRIMARY KEY,
	challenge_count INTEGER NOT NULL,
	challenge_size INTEGER NOT NULL,
	challenge_difficulty INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cap_challenges_expires_at
	ON cap_challenges (expires_at);

CREATE TABLE IF NOT EXISTS cap_tokens (
	token_key TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cap_tokens_expires_at
	ON cap_tokens (expires_at);

CREATE TABLE IF NOT EXISTS pickup_pow_failures (
	subject_hash TEXT PRIMARY KEY,
	failure_count INTEGER NOT NULL,
	window_started_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pickup_pow_failures_updated_at
	ON pickup_pow_failures (updated_at);

CREATE TABLE IF NOT EXISTS pickup_access_tokens (
	token_hash TEXT PRIMARY KEY,
	pickup_code_hash TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pickup_access_tokens_pickup_code_hash
	ON pickup_access_tokens (pickup_code_hash);

CREATE INDEX IF NOT EXISTS idx_pickup_access_tokens_expires_at
	ON pickup_access_tokens (expires_at);
