BEGIN;
CREATE TABLE scenario_live_evaluations (
 case_id UUID PRIMARY KEY,
 factory_id TEXT NOT NULL, workspace_id UUID NOT NULL, run_id UUID NOT NULL,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 input_hash CHAR(64) NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 result_hash CHAR(64) NOT NULL CHECK(result_hash ~ '^[a-f0-9]{64}$'),
 head_revision INTEGER NOT NULL CHECK(head_revision>0),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(case_id,factory_id) REFERENCES decision_cases(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(factory_id,workspace_id,run_id) REFERENCES scenario_jobs(factory_id,workspace_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX scenario_live_evaluations_run_idx ON scenario_live_evaluations(factory_id,workspace_id,run_id,created_at,case_id);
CREATE FUNCTION scenario_live_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM scenario_jobs j JOIN scenario_workspaces w ON (w.factory_id,w.id)=(j.factory_id,j.workspace_id)
   JOIN decision_cases c ON c.id=NEW.case_id AND c.factory_id=j.factory_id
   WHERE j.id=NEW.run_id AND j.factory_id=NEW.factory_id AND j.workspace_id=NEW.workspace_id
     AND j.kind='RUN' AND j.status='SUCCEEDED' AND j.input_hash=NEW.input_hash AND j.result_hash=NEW.result_hash
     AND c.mode='LIVE' AND c.status='CREATED' AND c.actor_id=NEW.actor_id
     AND c.snapshot_id=w.snapshot_id AND c.base_plan_version=w.plan_version) THEN
 RAISE EXCEPTION 'Invalid Scenario LIVE provenance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenario_live_source_guard BEFORE INSERT ON scenario_live_evaluations FOR EACH ROW EXECUTE FUNCTION scenario_live_source_guard();
CREATE TRIGGER scenario_live_evaluations_immutable BEFORE UPDATE OR DELETE ON scenario_live_evaluations FOR EACH ROW EXECUTE FUNCTION scenario_immutable_row();
COMMIT;
