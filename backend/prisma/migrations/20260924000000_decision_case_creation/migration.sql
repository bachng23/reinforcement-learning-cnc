BEGIN;
CREATE TABLE decision_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  base_plan_version INTEGER NOT NULL CHECK (base_plan_version >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('LIVE', 'SIMULATION_ONLY')),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status = 'CREATED'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision = 1),
  request_json JSONB NOT NULL CHECK (jsonb_typeof(request_json) = 'object'),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (factory_id, snapshot_id) REFERENCES factory_snapshots(factory_id, snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX decision_cases_factory_id_created_at_idx ON decision_cases(factory_id, created_at);
CREATE TABLE decision_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES decision_cases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL,
  actor_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload_json JSONB NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  CONSTRAINT decision_case_events_case_id_sequence_key UNIQUE (case_id, sequence)
);
CREATE TABLE decision_case_idempotency_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id TEXT NOT NULL,
  actor_id UUID NOT NULL,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  case_id UUID NOT NULL REFERENCES decision_cases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT decision_case_idempotency_receipts_factory_id_actor_id_key_key UNIQUE (factory_id, actor_id, key)
);
CREATE FUNCTION decision_case_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Decision case records are immutable';
END;
$$;
CREATE TRIGGER decision_cases_immutable BEFORE UPDATE OR DELETE ON decision_cases FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_cases_no_truncate BEFORE TRUNCATE ON decision_cases FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_case_events_immutable BEFORE UPDATE OR DELETE ON decision_case_events FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_case_events_no_truncate BEFORE TRUNCATE ON decision_case_events FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_case_receipts_immutable BEFORE UPDATE OR DELETE ON decision_case_idempotency_receipts FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_case_receipts_no_truncate BEFORE TRUNCATE ON decision_case_idempotency_receipts FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
COMMIT;
