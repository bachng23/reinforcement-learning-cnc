-- No historical snapshot/schedule payloads or hashes are changed.
ALTER TABLE factory_snapshots ADD COLUMN source_id TEXT;
ALTER TABLE factory_snapshots ADD CONSTRAINT factory_snapshots_source_id_check
  CHECK (source_id IS NULL OR (length(source_id) BETWEEN 1 AND 128 AND source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'));

-- Previously the only publisher was the canonical seed; its schedule revision is
-- the best existing publication version. Observation updates never change it.
ALTER TABLE operations_heads ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 0;
UPDATE operations_heads SET plan_version = COALESCE(schedule_revision, 0);
ALTER TABLE operations_heads ADD CONSTRAINT operations_heads_plan_version_check CHECK (plan_version >= 0);

-- Current observations and current schedule have independent snapshot bases.
-- Retain the factory fence and the schedule's own immutable basis-snapshot FK.
ALTER TABLE operations_heads DROP CONSTRAINT operations_heads_schedule_fkey;
ALTER TABLE operations_heads ADD CONSTRAINT operations_heads_schedule_fkey
  FOREIGN KEY (factory_id, schedule_id, schedule_revision)
  REFERENCES operation_schedules(factory_id, schedule_id, revision)
  ON DELETE RESTRICT ON UPDATE CASCADE;
