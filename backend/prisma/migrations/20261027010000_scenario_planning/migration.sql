BEGIN;
-- Additive Scenario namespace. No historical Operations payload is rewritten.
CREATE TABLE scenario_workspaces (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), factory_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 snapshot_id TEXT NOT NULL, snapshot_hash CHAR(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 plan_version INTEGER NOT NULL CHECK(plan_version>=0),
 schedule_id TEXT, schedule_revision INTEGER, schedule_hash CHAR(64),
 baseline_json JSONB NOT NULL CHECK(jsonb_typeof(baseline_json)='object'),
 config_json JSONB NOT NULL CHECK(jsonb_typeof(config_json)='object'),
 sampling_json JSONB NOT NULL CHECK(jsonb_typeof(sampling_json)='object'),
 engine_version TEXT NOT NULL CHECK(length(engine_version)>0), contract_version TEXT NOT NULL CHECK(length(contract_version)>0),
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(factory_id,snapshot_id) REFERENCES factory_snapshots(factory_id,snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(factory_id,schedule_id,schedule_revision) REFERENCES operation_schedules(factory_id,schedule_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(factory_id,id),
 CHECK(num_nonnulls(schedule_id,schedule_revision,schedule_hash) IN (0,3)),
 CHECK((schedule_id IS NULL AND schedule_revision IS NULL AND schedule_hash IS NULL AND plan_version=0)
   OR (schedule_id IS NOT NULL AND schedule_revision>0 AND schedule_hash ~ '^[a-f0-9]{64}$' AND plan_version>0))
);
CREATE INDEX scenario_workspaces_page_idx ON scenario_workspaces(factory_id,created_at DESC,id DESC);
CREATE FUNCTION scenario_workspace_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM factory_snapshots s WHERE s.factory_id=NEW.factory_id AND s.snapshot_id=NEW.snapshot_id
   AND s.content_hash=NEW.snapshot_hash AND s.payload_json=NEW.baseline_json) THEN
 RAISE EXCEPTION 'Scenario baseline differs from immutable snapshot' USING ERRCODE='23514'; END IF;
 IF NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_schedules s WHERE s.factory_id=NEW.factory_id
   AND s.schedule_id=NEW.schedule_id AND s.revision=NEW.schedule_revision AND s.content_hash=NEW.schedule_hash) THEN
 RAISE EXCEPTION 'Scenario reference publication hash mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_workspace_source_guard BEFORE INSERT ON scenario_workspaces FOR EACH ROW EXECUTE FUNCTION scenario_workspace_source_guard();

CREATE TABLE scenario_drafts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), factory_id TEXT NOT NULL, workspace_id UUID NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(factory_id,workspace_id) REFERENCES scenario_workspaces(factory_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(factory_id,workspace_id,id), CHECK(updated_at>=created_at)
);
CREATE INDEX scenario_drafts_page_idx ON scenario_drafts(factory_id,workspace_id,created_at DESC,id DESC);
CREATE TABLE scenario_draft_revisions (
 factory_id TEXT NOT NULL, workspace_id UUID NOT NULL, scenario_id UUID NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 payload_json JSONB NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
 content_hash CHAR(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(factory_id,workspace_id,scenario_id,revision),
 FOREIGN KEY(factory_id,workspace_id,scenario_id) REFERENCES scenario_drafts(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE scenario_drafts ADD CONSTRAINT scenario_drafts_current_revision_fkey
 FOREIGN KEY(factory_id,workspace_id,id,revision) REFERENCES scenario_draft_revisions(factory_id,workspace_id,scenario_id,revision)
 ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE scenario_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), factory_id TEXT NOT NULL, workspace_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('RUN','SENSITIVITY')),
 source_scenario_id UUID, source_revision INTEGER, source_run_id UUID,
 input_json JSONB NOT NULL CHECK(jsonb_typeof(input_json)='object'),
 input_hash CHAR(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 engine_version TEXT NOT NULL, contract_version TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
 lease_token UUID, lease_expires_at TIMESTAMPTZ(6), worker_id TEXT,
 deadline_at TIMESTAMPTZ(6) NOT NULL, started_at TIMESTAMPTZ(6), completed_at TIMESTAMPTZ(6), error_code TEXT,
 result_json JSONB, result_hash CHAR(64),
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(factory_id,workspace_id,id),
 FOREIGN KEY(factory_id,workspace_id) REFERENCES scenario_workspaces(factory_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(factory_id,workspace_id,source_scenario_id,source_revision) REFERENCES scenario_draft_revisions(factory_id,workspace_id,scenario_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(factory_id,workspace_id,source_run_id) REFERENCES scenario_jobs(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK((source_scenario_id IS NULL)=(source_revision IS NULL)),
 CHECK((kind='SENSITIVITY')=(source_run_id IS NOT NULL)),
 CHECK((status='RUNNING')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL)),
 CHECK(status='RUNNING' OR (lease_token IS NULL AND lease_expires_at IS NULL AND worker_id IS NULL)),
 CHECK((status IN ('SUCCEEDED','FAILED'))=(completed_at IS NOT NULL)),
 CHECK((status='SUCCEEDED')=(result_json IS NOT NULL AND result_hash IS NOT NULL)),
 CHECK(result_json IS NULL OR jsonb_typeof(result_json)='object'),
 CHECK(result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
 CHECK(status='SUCCEEDED' OR (result_json IS NULL AND result_hash IS NULL)),
 CHECK((status='FAILED')=(error_code IS NOT NULL)),
 CHECK(deadline_at>created_at AND deadline_at<=created_at+interval '300 seconds'),
 CHECK(updated_at>=created_at AND (started_at IS NULL OR started_at>=created_at)),
 CHECK(completed_at IS NULL OR completed_at>=created_at)
);
CREATE INDEX scenario_jobs_page_idx ON scenario_jobs(factory_id,workspace_id,kind,created_at DESC,id DESC);
CREATE INDEX scenario_jobs_claim_idx ON scenario_jobs(status,created_at,id) WHERE status IN ('QUEUED','RUNNING');
-- Claim uses the same factory advisory lock as revoke/ingest/writes; this index is a DB backstop.
CREATE UNIQUE INDEX scenario_jobs_factory_running_key ON scenario_jobs(factory_id) WHERE status='RUNNING';

CREATE TABLE scenario_attempts (
 factory_id TEXT NOT NULL, workspace_id UUID NOT NULL, job_id UUID NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3), lease_token UUID NOT NULL UNIQUE, worker_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','EXPIRED')),
 started_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), completed_at TIMESTAMPTZ(6), error_code TEXT,
 PRIMARY KEY(factory_id,workspace_id,job_id,attempt),
 FOREIGN KEY(factory_id,workspace_id,job_id) REFERENCES scenario_jobs(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK((status='RUNNING')=(completed_at IS NULL)), CHECK(completed_at IS NULL OR completed_at>=started_at)
);
CREATE TABLE scenario_points (
 factory_id TEXT NOT NULL, workspace_id UUID NOT NULL, job_id UUID NOT NULL,
 point_index INTEGER NOT NULL CHECK(point_index BETWEEN 0 AND 7), value DOUBLE PRECISION,
 role TEXT NOT NULL CHECK(role IN ('BASELINE','SCENARIO','SAMPLE')),
 input_json JSONB NOT NULL CHECK(jsonb_typeof(input_json)='object'), input_hash CHAR(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','FEASIBLE','NO_FEASIBLE_PLAN','FAILED','TIMEOUT')),
 result_json JSONB, result_hash CHAR(64), error_code TEXT, completed_at TIMESTAMPTZ(6),
 PRIMARY KEY(factory_id,workspace_id,job_id,point_index),
 FOREIGN KEY(factory_id,workspace_id,job_id) REFERENCES scenario_jobs(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(value IS NULL OR (value<='1e6'::float8 AND value>=0)),
 CHECK((status IN ('FEASIBLE','NO_FEASIBLE_PLAN'))=(result_json IS NOT NULL AND result_hash IS NOT NULL)),
 CHECK(status IN ('FEASIBLE','NO_FEASIBLE_PLAN') OR (result_json IS NULL AND result_hash IS NULL)),
 CHECK(result_json IS NULL OR jsonb_typeof(result_json)='object'),
 CHECK(result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
 CHECK((status IN ('FAILED','TIMEOUT'))=(error_code IS NOT NULL)),
 CHECK((status NOT IN ('QUEUED','RUNNING'))=(completed_at IS NOT NULL))
);

CREATE TABLE scenario_command_receipts (
 factory_id TEXT NOT NULL REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 128), workspace_id UUID NOT NULL,
 request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response_json JSONB NOT NULL CHECK(jsonb_typeof(response_json)='object'), response_status INTEGER NOT NULL CHECK(response_status IN (200,201,202)),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(factory_id,actor_id,key),
 FOREIGN KEY(factory_id,workspace_id) REFERENCES scenario_workspaces(factory_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE scenario_events (
 sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 factory_id TEXT NOT NULL, workspace_id UUID NOT NULL, job_id UUID,
 type TEXT NOT NULL, actor_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 source TEXT NOT NULL CHECK(source IN ('HTTP','WORKER')),
 payload_json JSONB NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(factory_id,workspace_id) REFERENCES scenario_workspaces(factory_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(factory_id,workspace_id,job_id) REFERENCES scenario_jobs(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK((source='HTTP')=(actor_id IS NOT NULL))
);
CREATE INDEX scenario_events_workspace_sequence_idx ON scenario_events(factory_id,workspace_id,sequence);

CREATE FUNCTION scenario_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scenario history is immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE relation_name TEXT; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['scenario_workspaces','scenario_draft_revisions','scenario_command_receipts','scenario_events'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION scenario_immutable_row()',relation_name||'_immutable',relation_name);
 END LOOP;
 FOREACH relation_name IN ARRAY ARRAY['scenario_drafts','scenario_jobs','scenario_attempts','scenario_points'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION scenario_immutable_row()',relation_name||'_no_delete',relation_name);
 END LOOP;
END $$;

CREATE FUNCTION scenario_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at'])
 OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at THEN
 RAISE EXCEPTION 'Invalid scenario draft revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_drafts_guard BEFORE UPDATE ON scenario_drafts FOR EACH ROW EXECUTE FUNCTION scenario_draft_guard();

CREATE FUNCTION scenario_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('SUCCEEDED','FAILED') OR
 (to_jsonb(NEW)-ARRAY['status','attempt','lease_token','lease_expires_at','worker_id','started_at','completed_at','error_code','result_json','result_hash','updated_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt','lease_token','lease_expires_at','worker_id','started_at','completed_at','error_code','result_json','result_hash','updated_at'])
 THEN RAISE EXCEPTION 'Scenario job input/result is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.updated_at<OLD.updated_at OR NEW.attempt<OLD.attempt OR NEW.attempt>OLD.attempt+1
 OR (NEW.attempt<>OLD.attempt AND NOT(OLD.status='QUEUED' AND NEW.status='RUNNING'))
 OR (OLD.status='QUEUED' AND NEW.status NOT IN ('RUNNING','FAILED'))
 OR (OLD.status='QUEUED' AND NEW.status='RUNNING' AND NEW.attempt<>OLD.attempt+1)
 OR (OLD.status='RUNNING' AND NEW.status='RUNNING' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token)
 THEN RAISE EXCEPTION 'Invalid scenario job transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_jobs_guard BEFORE UPDATE ON scenario_jobs FOR EACH ROW EXECUTE FUNCTION scenario_job_guard();

CREATE FUNCTION scenario_point_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status NOT IN ('QUEUED','RUNNING') OR
 (to_jsonb(NEW)-ARRAY['status','result_json','result_hash','error_code','completed_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','result_json','result_hash','error_code','completed_at'])
 THEN RAISE EXCEPTION 'Scenario point input/result is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_points_guard BEFORE UPDATE ON scenario_points FOR EACH ROW EXECUTE FUNCTION scenario_point_guard();
CREATE FUNCTION scenario_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'RUNNING' OR NEW.status='RUNNING' OR
 (to_jsonb(NEW)-ARRAY['status','completed_at','error_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','completed_at','error_code'])
 THEN RAISE EXCEPTION 'Scenario attempt history is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_attempts_guard BEFORE UPDATE ON scenario_attempts FOR EACH ROW EXECUTE FUNCTION scenario_attempt_guard();
COMMIT;
