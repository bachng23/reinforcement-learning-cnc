BEGIN;
ALTER TABLE decision_cases ADD COLUMN updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN processing_attempt INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempt >= 0),
  ADD COLUMN processing_error_code TEXT,
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_owner_id UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ(6);
DROP TRIGGER decision_cases_immutable ON decision_cases;
UPDATE decision_cases SET updated_at = created_at;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_status_check;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_revision_check;
ALTER TABLE decision_cases ADD CHECK (revision >= 1),
  ADD CHECK (status IN ('CREATED','ANALYZING','GENERATING','VALIDATING','EXPLAINING','AWAITING_APPROVAL','FAILED')),
  ADD CHECK (updated_at >= created_at),
  ADD CONSTRAINT decision_cases_processing_check CHECK (
    (status = 'CREATED' AND processing_status = 'PENDING') OR
    (status IN ('ANALYZING','GENERATING','VALIDATING','EXPLAINING') AND processing_status = 'RUNNING') OR
    (status = 'AWAITING_APPROVAL' AND processing_status = 'SUCCEEDED') OR
    (status = 'FAILED' AND processing_status = 'FAILED' AND processing_error_code IS NOT NULL)),
  ADD CONSTRAINT decision_cases_lease_check CHECK (
    (processing_status = 'RUNNING' AND lease_token IS NOT NULL AND lease_owner_id IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (processing_status <> 'RUNNING' AND lease_token IS NULL AND lease_owner_id IS NULL AND lease_expires_at IS NULL));
CREATE UNIQUE INDEX decision_cases_id_snapshot_id_key ON decision_cases(id, snapshot_id);
ALTER TABLE decision_case_events ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK (actor_kind IN ('HUMAN','SYSTEM'));
CREATE TABLE decision_recommendation_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL,
  recommendation_id TEXT NOT NULL CHECK (length(recommendation_id) BETWEEN 1 AND 128 AND recommendation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  snapshot_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (schema_version = '3.0'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT decision_recommendation_artifacts_case_id_key UNIQUE(case_id),
  CONSTRAINT decision_recommendation_artifacts_case_id_snapshot_id_key UNIQUE(case_id, snapshot_id),
  CONSTRAINT decision_recommendation_artifacts_recommendation_id_key UNIQUE(recommendation_id),
  FOREIGN KEY(case_id, snapshot_id) REFERENCES decision_cases(id, snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (jsonb_typeof(payload_json) = 'object' AND
    (payload_json->>'schema_version' = schema_version) IS TRUE AND
    (payload_json->>'decision_case_id' = case_id::text) IS TRUE AND
    (payload_json->>'snapshot_id' = snapshot_id) IS TRUE AND
    (payload_json->>'recommendation_id' = recommendation_id) IS TRUE)
);
CREATE TRIGGER decision_recommendation_immutable BEFORE UPDATE OR DELETE ON decision_recommendation_artifacts FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_recommendation_no_truncate BEFORE TRUNCATE ON decision_recommendation_artifacts FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
CREATE FUNCTION decision_case_processing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Decision case records are immutable'; END IF;
  -- PostgreSQL retains microseconds while JS Date truncates to milliseconds.
  -- Own the update timestamp in the database, including rapid consecutive claims.
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at);
  IF ROW(NEW.id,NEW.factory_id,NEW.snapshot_id,NEW.base_plan_version,NEW.mode,NEW.request_json,NEW.request_hash,NEW.actor_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.factory_id,OLD.snapshot_id,OLD.base_plan_version,OLD.mode,OLD.request_json,OLD.request_hash,OLD.actor_id,OLD.created_at)
    OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Decision case immutable basis or revision violation';
  END IF;
  IF OLD.status IN ('CREATED','FAILED') AND NEW.status = 'ANALYZING' THEN
    IF NEW.processing_attempt <> OLD.processing_attempt + 1 OR NEW.lease_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Invalid decision claim';
    END IF;
  ELSE
    IF OLD.processing_status <> 'RUNNING' OR NEW.processing_attempt <> OLD.processing_attempt THEN
      RAISE EXCEPTION 'Invalid decision processing transition';
    END IF;
    IF NEW.status = 'CREATED' THEN
      IF OLD.lease_expires_at > clock_timestamp() THEN RAISE EXCEPTION 'Lease has not expired'; END IF;
    ELSE
      IF OLD.lease_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Lease expired'; END IF;
      IF NOT (NEW.status = 'FAILED' OR
        (OLD.status = 'ANALYZING' AND NEW.status = 'GENERATING') OR
        (OLD.status = 'GENERATING' AND NEW.status = 'VALIDATING') OR
        (OLD.status = 'VALIDATING' AND NEW.status = 'EXPLAINING') OR
        (OLD.status = 'EXPLAINING' AND NEW.status = 'AWAITING_APPROVAL')) THEN
        RAISE EXCEPTION 'Invalid decision processing transition';
      END IF;
    END IF;
    IF NEW.processing_status = 'RUNNING' AND
      ROW(NEW.lease_token,NEW.lease_owner_id,NEW.lease_expires_at) IS DISTINCT FROM ROW(OLD.lease_token,OLD.lease_owner_id,OLD.lease_expires_at) THEN
      RAISE EXCEPTION 'Decision lease cannot be replaced';
    END IF;
  END IF;
  IF NEW.status = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM decision_recommendation_artifacts WHERE case_id=NEW.id) THEN
    RAISE EXCEPTION 'Recommendation required before approval';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER decision_cases_immutable BEFORE UPDATE OR DELETE ON decision_cases FOR EACH ROW EXECUTE FUNCTION decision_case_processing_guard();
COMMIT;
