ALTER TABLE file_deliveries
	ADD COLUMN guest_access_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_deliveries_guest_access_token_hash
	ON file_deliveries (guest_access_token_hash);
