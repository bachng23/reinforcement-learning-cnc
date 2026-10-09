BEGIN;
CREATE OR REPLACE FUNCTION decision_case_processing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Decision case records are immutable'; END IF;
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at);
  IF ROW(NEW.id,NEW.factory_id,NEW.snapshot_id,NEW.base_plan_version,NEW.mode,NEW.request_json,NEW.request_hash,NEW.actor_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.factory_id,OLD.snapshot_id,OLD.base_plan_version,OLD.mode,OLD.request_json,OLD.request_hash,OLD.actor_id,OLD.created_at)
    OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Decision case immutable basis or revision violation';
  END IF;
  IF OLD.status IN ('CREATED','FAILED') AND NEW.status = 'ANALYZING' THEN
    IF NEW.processing_attempt <> OLD.processing_attempt + 1 OR NEW.lease_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Invalid decision claim'; END IF;
  ELSIF OLD.status = 'ANALYZING' AND NEW.status = 'ANALYZING' AND NEW.processing_status = 'RUNNING'
    AND NEW.processing_attempt = OLD.processing_attempt AND NEW.lease_token = OLD.lease_token
    AND NEW.lease_owner_id = OLD.lease_owner_id AND NEW.lease_expires_at > OLD.lease_expires_at THEN
    IF OLD.lease_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Lease expired'; END IF;
  ELSE
    IF OLD.processing_status <> 'RUNNING' OR NEW.processing_attempt <> OLD.processing_attempt THEN RAISE EXCEPTION 'Invalid decision processing transition'; END IF;
    IF NEW.status = 'CREATED' THEN
      IF OLD.lease_expires_at > clock_timestamp() THEN RAISE EXCEPTION 'Lease has not expired'; END IF;
    ELSE
      IF OLD.lease_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Lease expired'; END IF;
      IF NOT (NEW.status = 'FAILED' OR (OLD.status = 'ANALYZING' AND NEW.status = 'GENERATING') OR (OLD.status = 'GENERATING' AND NEW.status = 'VALIDATING') OR (OLD.status = 'VALIDATING' AND NEW.status = 'EXPLAINING') OR (OLD.status = 'EXPLAINING' AND NEW.status = 'AWAITING_APPROVAL')) THEN RAISE EXCEPTION 'Invalid decision processing transition'; END IF;
    END IF;
    IF NEW.processing_status = 'RUNNING' AND ROW(NEW.lease_token,NEW.lease_owner_id,NEW.lease_expires_at) IS DISTINCT FROM ROW(OLD.lease_token,OLD.lease_owner_id,OLD.lease_expires_at) THEN RAISE EXCEPTION 'Decision lease cannot be replaced'; END IF;
  END IF;
  IF NEW.status = 'AWAITING_APPROVAL' AND NOT EXISTS (SELECT 1 FROM decision_recommendation_artifacts WHERE case_id=NEW.id) THEN RAISE EXCEPTION 'Recommendation required before approval'; END IF;
  RETURN NEW;
END;
$$;
COMMIT;
