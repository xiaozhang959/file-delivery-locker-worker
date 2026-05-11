ALTER TABLE file_deliveries
	ADD COLUMN upload_ip TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_user_agent TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_browser TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_os TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_device TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_country TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_region TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN upload_city TEXT;

CREATE TABLE IF NOT EXISTS delivery_events (
	id TEXT PRIMARY KEY,
	delivery_id TEXT NOT NULL,
	action TEXT NOT NULL,
	actor TEXT NOT NULL,
	ip TEXT,
	user_agent TEXT,
	browser TEXT,
	os TEXT,
	device TEXT,
	country TEXT,
	region TEXT,
	city TEXT,
	note TEXT,
	previous_max_downloads INTEGER,
	previous_download_count INTEGER,
	next_max_downloads INTEGER,
	next_download_count INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (delivery_id) REFERENCES file_deliveries (id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id
	ON delivery_events (delivery_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_events_created_at
	ON delivery_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_events_action
	ON delivery_events (action);
