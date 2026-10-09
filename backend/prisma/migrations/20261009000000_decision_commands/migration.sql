BEGIN;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_status_check;
ALTER TABLE decision_cases DROP CONSTRAINT decision_cases_processing_check;
ALTER TABLE decision_cases ADD CONSTRAINT decision_cases_status_check CHECK
  (status IN ('CREATED','ANALYZING','GENERATING','VALIDATING','EXPLAINING','AWAITING_APPROVAL','APPROVED','REJECTED','COMMITTED','FAILED')),
  ADD CONSTRAINT decision_cases_processing_check CHECK (
    (status='CREATED' AND processing_status='PENDING') OR
    (status IN ('ANALYZING','GENERATING','VALIDATING','EXPLAINING') AND processing_status='RUNNING') OR
    (status IN ('AWAITING_APPROVAL','APPROVED','REJECTED','COMMITTED') AND processing_status='SUCCEEDED') OR
    (status='FAILED' AND processing_status='FAILED' AND processing_error_code IS NOT NULL)),
  ADD CHECK (status <> 'COMMITTED' OR mode='LIVE');
CREATE TABLE decision_human_records (
  case_id UUID PRIMARY KEY REFERENCES decision_cases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  recommendation_id TEXT NOT NULL REFERENCES decision_recommendation_artifacts(recommendation_id),
  candidate_id TEXT,
  candidate_version INTEGER,
  candidate_hash CHAR(64),
  schedule_hash CHAR(64),
  note TEXT,
  actor_id UUID NOT NULL,
  decided_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((decision='APPROVE' AND candidate_id IS NOT NULL AND candidate_version IS NOT NULL AND candidate_version > 0
    AND candidate_hash IS NOT NULL AND candidate_hash ~ '^[a-f0-9]{64}$'
    AND schedule_hash IS NOT NULL AND schedule_hash ~ '^[a-f0-9]{64}$') OR
    (decision='REJECT' AND candidate_id IS NULL AND candidate_version IS NULL
    AND candidate_hash IS NULL AND schedule_hash IS NULL AND note IS NOT NULL AND length(btrim(note)) > 0))
);
CREATE TABLE decision_commits (
  case_id UUID PRIMARY KEY REFERENCES decision_cases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  factory_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  schedule_revision INTEGER NOT NULL,
  schedule_hash CHAR(64) NOT NULL CHECK (schedule_hash ~ '^[a-f0-9]{64}$'),
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  actor_id UUID NOT NULL,
  committed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(factory_id, schedule_id, schedule_revision),
  UNIQUE(factory_id, snapshot_id, schedule_id, schedule_revision),
  UNIQUE(factory_id, plan_version),
  FOREIGN KEY(factory_id, snapshot_id, schedule_id, schedule_revision)
    REFERENCES operation_schedules(factory_id, snapshot_id, schedule_id, revision) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TRIGGER decision_human_records_immutable BEFORE UPDATE OR DELETE ON decision_human_records FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_human_records_no_truncate BEFORE TRUNCATE ON decision_human_records FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_commits_immutable BEFORE UPDATE OR DELETE ON decision_commits FOR EACH ROW EXECUTE FUNCTION decision_case_immutable();
CREATE TRIGGER decision_commits_no_truncate BEFORE TRUNCATE ON decision_commits FOR EACH STATEMENT EXECUTE FUNCTION decision_case_immutable();
-- Guard direct database writes as well as service commands.
CREATE FUNCTION decision_human_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c decision_cases; a decision_recommendation_artifacts; candidate JSONB;
BEGIN
  SELECT * INTO c FROM decision_cases WHERE id=NEW.case_id FOR UPDATE;
  SELECT * INTO a FROM decision_recommendation_artifacts WHERE case_id=c.id;
  IF c.status <> 'AWAITING_APPROVAL' OR a.recommendation_id IS DISTINCT FROM NEW.recommendation_id THEN
    RAISE EXCEPTION 'Human decision requires awaiting case and its recommendation';
  END IF;
  IF NEW.decision='APPROVE' THEN
    SELECT p INTO candidate FROM jsonb_array_elements(a.payload_json->'candidate_plans') p
      WHERE p->>'candidate_plan_id'=NEW.candidate_id AND (p->>'plan_version')::integer=NEW.candidate_version;
    IF candidate IS NULL OR candidate->'validation'->>'verdict' IS DISTINCT FROM 'VALID' THEN
      RAISE EXCEPTION 'Valid candidate required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER decision_human_insert BEFORE INSERT ON decision_human_records FOR EACH ROW EXECUTE FUNCTION decision_human_insert_guard();
CREATE FUNCTION decision_commit_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c decision_cases; d decision_human_records; h operations_heads; s operation_schedules; candidate JSONB;
BEGIN
  SELECT * INTO c FROM decision_cases WHERE id=NEW.case_id FOR UPDATE;
  SELECT * INTO d FROM decision_human_records WHERE case_id=c.id;
  SELECT * INTO h FROM operations_heads WHERE factory_id=c.factory_id FOR UPDATE;
  SELECT * INTO s FROM operation_schedules WHERE factory_id=NEW.factory_id AND schedule_id=NEW.schedule_id AND revision=NEW.schedule_revision;
  SELECT p INTO candidate FROM decision_recommendation_artifacts a,
    LATERAL jsonb_array_elements(a.payload_json->'candidate_plans') p
    WHERE a.case_id=c.id AND p->>'candidate_plan_id'=d.candidate_id AND (p->>'plan_version')::integer=d.candidate_version;
  IF c.status <> 'APPROVED' OR c.mode <> 'LIVE' OR d.decision IS DISTINCT FROM 'APPROVE'
    OR NEW.factory_id IS DISTINCT FROM c.factory_id OR NEW.snapshot_id IS DISTINCT FROM c.snapshot_id
    OR h.snapshot_id IS DISTINCT FROM c.snapshot_id OR h.plan_version IS DISTINCT FROM c.base_plan_version
    OR NEW.plan_version IS DISTINCT FROM h.plan_version+1
    OR NEW.schedule_hash IS DISTINCT FROM d.schedule_hash OR s.content_hash IS DISTINCT FROM d.schedule_hash
    OR s.payload_json IS DISTINCT FROM candidate->'schedule' THEN
    RAISE EXCEPTION 'Commit requires current live basis and exact approved schedule';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER decision_commit_insert BEFORE INSERT ON decision_commits FOR EACH ROW EXECUTE FUNCTION decision_commit_insert_guard();
CREATE OR REPLACE FUNCTION decision_case_processing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF (OLD.status = 'AWAITING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED')) OR
     (OLD.status = 'APPROVED' AND NEW.status = 'COMMITTED') THEN
    IF ROW(NEW.processing_status,NEW.processing_attempt,NEW.processing_error_code,NEW.lease_token,NEW.lease_owner_id,NEW.lease_expires_at)
      IS DISTINCT FROM ROW(OLD.processing_status,OLD.processing_attempt,OLD.processing_error_code,OLD.lease_token,OLD.lease_owner_id,OLD.lease_expires_at) THEN
      RAISE EXCEPTION 'Human command cannot change processing state';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM decision_human_records d WHERE d.case_id=NEW.id
      AND d.decision = CASE WHEN NEW.status='REJECTED' THEN 'REJECT' ELSE 'APPROVE' END) THEN
      RAISE EXCEPTION 'Immutable human decision required';
    END IF;
    IF NEW.status='COMMITTED' AND (NEW.mode <> 'LIVE' OR NOT EXISTS (
      SELECT 1 FROM decision_commits c JOIN operations_heads h ON h.factory_id=c.factory_id
      WHERE c.case_id=NEW.id AND h.schedule_id=c.schedule_id AND h.schedule_revision=c.schedule_revision
        AND h.plan_version=c.plan_version AND h.snapshot_id=NEW.snapshot_id)) THEN
      RAISE EXCEPTION 'Live publication and matching head required';
    END IF;
    RETURN NEW;
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
COMMIT;
