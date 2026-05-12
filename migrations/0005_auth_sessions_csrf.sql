CREATE TABLE IF NOT EXISTS auth_sessions (
	token_hash TEXT PRIMARY KEY,
	auth_kind TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	csrf_token TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	ip TEXT,
	user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_auth_kind
	ON auth_sessions (auth_kind, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
	ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_login_failures (
	subject_hash TEXT PRIMARY KEY,
	auth_kind TEXT NOT NULL,
	failure_count INTEGER NOT NULL,
	window_started_at INTEGER NOT NULL,
	locked_until INTEGER,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_auth_kind
	ON auth_login_failures (auth_kind, updated_at);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_updated_at
	ON auth_login_failures (updated_at);
