BEGIN;

DROP TRIGGER decision_cases_immutable ON decision_cases;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_status_check;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_revision_check;

ALTER TABLE decision_cases
  ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN processing_stage TEXT,
  ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ(6),
  ADD COLUMN error_code TEXT,
  ADD COLUMN error_message TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT decision_cases_status_check CHECK (status IN (
    'CREATED', 'ANALYZING', 'GENERATING', 'VALIDATING', 'EXPLAINING',
    'AWAITING_APPROVAL', 'APPROVED', 'MODIFIED', 'REJECTED', 'COMMITTED',
    'FAILED', 'CANCELLED'
  )),
  ADD CONSTRAINT decision_cases_revision_check CHECK (revision >= 1),
  ADD CONSTRAINT decision_cases_processing_status_check CHECK (processing_status IN ('QUEUED', 'RUNNING', 'BLOCKED', 'IDLE')),
  ADD CONSTRAINT decision_cases_attempt_check CHECK (attempt >= 0),
  ADD CONSTRAINT decision_cases_lease_shape_check CHECK (
    (processing_status = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (processing_status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

CREATE INDEX decision_cases_processing_status_lease_expires_at_idx
  ON decision_cases(processing_status, lease_expires_at);

CREATE FUNCTION decision_case_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Decision case records are immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.factory_id IS DISTINCT FROM OLD.factory_id
    OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
    OR NEW.base_plan_version IS DISTINCT FROM OLD.base_plan_version
    OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.request_json IS DISTINCT FROM OLD.request_json
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Decision case immutable fields cannot be changed';
  END IF;
  IF ROW(NEW.status, NEW.revision, NEW.processing_status, NEW.processing_stage,
      NEW.attempt, NEW.lease_token, NEW.lease_expires_at, NEW.error_code,
      NEW.error_message, NEW.updated_at)
    IS NOT DISTINCT FROM
    ROW(OLD.status, OLD.revision, OLD.processing_status, OLD.processing_stage,
      OLD.attempt, OLD.lease_token, OLD.lease_expires_at, OLD.error_code,
      OLD.error_message, OLD.updated_at) THEN
    RAISE EXCEPTION 'Decision case records are immutable outside lifecycle transitions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER decision_cases_lifecycle_guard
  BEFORE UPDATE OR DELETE ON decision_cases
  FOR EACH ROW EXECUTE FUNCTION decision_case_lifecycle_guard();

CREATE TABLE decision_case_recommendations (
  case_id UUID PRIMARY KEY REFERENCES decision_cases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  recommendation_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL CHECK (schema_version = '3.0'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json JSONB NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER decision_case_recommendations_immutable
  BEFORE UPDATE OR DELETE ON decision_case_recommendations
  FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_case_recommendations_no_truncate
  BEFORE TRUNCATE ON decision_case_recommendations
  FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();

COMMIT;
