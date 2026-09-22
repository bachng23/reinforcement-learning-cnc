-- No historical snapshot/schedule payloads or hashes are changed.
ALTER TABLE factory_snapshots ADD COLUMN source_id TEXT;
ALTER TABLE factory_snapshots ADD CONSTRAINT factory_snapshots_source_id_check
  CHECK (source_id IS NULL OR (length(source_id) BETWEEN 1 AND 128 AND source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'));
