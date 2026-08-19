-- Optional media metadata columns (safe to run if already applied)
ALTER TABLE media ADD COLUMN IF NOT EXISTS size BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS attach_to_type VARCHAR(50);
ALTER TABLE media ADD COLUMN IF NOT EXISTS attach_to_id UUID;
