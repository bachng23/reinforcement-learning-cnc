CREATE TABLE factory_snapshots (
  factory_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = '3.0'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json JSONB NOT NULL,
  captured_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT factory_snapshots_pkey PRIMARY KEY (factory_id, snapshot_id),
  CONSTRAINT factory_snapshot_projection CHECK (
    jsonb_typeof(payload_json) = 'object' AND
    (payload_json->>'schema_version' = schema_version) IS TRUE AND
    (payload_json->>'snapshot_id' = snapshot_id) IS TRUE AND
    (payload_json->>'factory_id' = factory_id) IS TRUE)
);
CREATE TABLE operation_schedules (
  factory_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = '3.0'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operation_schedules_pkey PRIMARY KEY (factory_id, schedule_id, revision),
  CONSTRAINT operation_schedules_factory_id_snapshot_id_fkey FOREIGN KEY (factory_id, snapshot_id)
    REFERENCES factory_snapshots(factory_id, snapshot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT operation_schedule_projection CHECK (
    jsonb_typeof(payload_json) = 'object' AND
    (payload_json->>'factory_id' = factory_id) IS TRUE AND
    (payload_json->>'schedule_id' = schedule_id) IS TRUE AND
    (payload_json->>'revision' = revision::text) IS TRUE)
);
CREATE UNIQUE INDEX operation_schedules_snapshot_schedule_key
  ON operation_schedules(factory_id, snapshot_id, schedule_id, revision);
CREATE TABLE operations_heads (
  factory_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  schedule_id TEXT,
  schedule_revision INTEGER,
  plan_version INTEGER NOT NULL DEFAULT 0 CHECK (plan_version >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((schedule_id IS NULL) = (schedule_revision IS NULL)),
  CONSTRAINT operations_heads_factory_id_snapshot_id_fkey FOREIGN KEY (factory_id, snapshot_id)
    REFERENCES factory_snapshots(factory_id, snapshot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT operations_heads_schedule_fkey FOREIGN KEY (factory_id, schedule_id, schedule_revision)
    REFERENCES operation_schedules(factory_id, schedule_id, revision) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION operations_context_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operations snapshots and schedule revisions are immutable';
END;
$$;
CREATE TRIGGER factory_snapshots_immutable BEFORE UPDATE OR DELETE ON factory_snapshots
  FOR EACH ROW EXECUTE FUNCTION operations_context_immutable();
CREATE TRIGGER operation_schedules_immutable BEFORE UPDATE OR DELETE ON operation_schedules
  FOR EACH ROW EXECUTE FUNCTION operations_context_immutable();
CREATE TRIGGER factory_snapshots_no_truncate BEFORE TRUNCATE ON factory_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION operations_context_immutable();
CREATE TRIGGER operation_schedules_no_truncate BEFORE TRUNCATE ON operation_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION operations_context_immutable();
