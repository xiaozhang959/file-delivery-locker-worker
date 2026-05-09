ALTER TABLE file_deliveries
	ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'file';
