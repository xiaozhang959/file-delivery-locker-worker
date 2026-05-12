ALTER TABLE file_deliveries
	ADD COLUMN storage_key TEXT;

ALTER TABLE file_deliveries
	ADD COLUMN content_hash TEXT;

UPDATE file_deliveries
	SET storage_key = object_key
	WHERE storage_key IS NULL OR storage_key = '';

CREATE INDEX IF NOT EXISTS idx_file_deliveries_content_hash
	ON file_deliveries (content_hash, size);

CREATE INDEX IF NOT EXISTS idx_file_deliveries_storage_key
	ON file_deliveries (storage_key);
