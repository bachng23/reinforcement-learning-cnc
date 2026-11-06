BEGIN;
-- Backend-owned additive execution module. Existing canonical rows are not rewritten.
ALTER TABLE decision_commits ADD CONSTRAINT decision_commits_work_order_source_key
 UNIQUE(case_id,factory_id,snapshot_id,schedule_id,schedule_revision,schedule_hash,plan_version);
CREATE TABLE work_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 factory_id TEXT NOT NULL REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 source_case_id UUID NOT NULL, basis_snapshot_id TEXT NOT NULL,
 schedule_id TEXT NOT NULL, schedule_revision INTEGER NOT NULL, schedule_hash CHAR(64) NOT NULL,
 published_plan_version INTEGER NOT NULL, basis_snapshot_hash CHAR(64) NOT NULL CHECK(basis_snapshot_hash ~ '^[a-f0-9]{64}$'),
 assignment_id TEXT NOT NULL, machine_id TEXT NOT NULL, maintenance_request_id TEXT NOT NULL,
 planned_start_at TIMESTAMPTZ(6) NOT NULL, planned_end_at TIMESTAMPTZ(6) NOT NULL,
 source_technician_ids TEXT[] NOT NULL, requirements_json JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'UNASSIGNED' CHECK(status IN ('UNASSIGNED','ASSIGNED','ACCEPTED','IN_PROGRESS','BLOCKED','COMPLETED','CLOSED','CANCELLED')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt>0),
 assignee_user_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 blocker TEXT, actual_started_at TIMESTAMPTZ(6), actual_completed_at TIMESTAMPTZ(6),
 verification_json JSONB, cancel_reason TEXT, cancelled_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(source_case_id,factory_id,basis_snapshot_id,schedule_id,schedule_revision,schedule_hash,published_plan_version)
 REFERENCES decision_commits(case_id,factory_id,snapshot_id,schedule_id,schedule_revision,schedule_hash,plan_version) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,factory_id), UNIQUE(factory_id,schedule_id,schedule_revision,assignment_id),
 CHECK(planned_end_at>planned_start_at AND updated_at>=created_at),
 CHECK(status NOT IN ('ASSIGNED','ACCEPTED','IN_PROGRESS','BLOCKED','COMPLETED','CLOSED') OR assignee_user_id IS NOT NULL),
 CHECK(status NOT IN ('IN_PROGRESS','BLOCKED','COMPLETED','CLOSED') OR actual_started_at IS NOT NULL),
 CHECK((status IN ('COMPLETED','CLOSED')) = (actual_completed_at IS NOT NULL)),
 CHECK(actual_completed_at IS NULL OR actual_completed_at>=actual_started_at),
 CHECK(actual_started_at IS NULL OR actual_started_at>=created_at),
 CHECK((status='BLOCKED') = (blocker IS NOT NULL)),
 CHECK(blocker IS NULL OR length(btrim(blocker))>0),
 CHECK((status='CLOSED') = (verification_json IS NOT NULL)),
 CHECK((status='CANCELLED') = (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)),
 CHECK(status<>'CANCELLED' OR (actual_started_at IS NULL AND length(btrim(cancel_reason))>0))
);
CREATE UNIQUE INDEX work_orders_active_request_key ON work_orders(factory_id,basis_snapshot_id,maintenance_request_id)
 WHERE status NOT IN ('CLOSED','CANCELLED');
CREATE INDEX work_orders_factory_created_id_idx ON work_orders(factory_id,created_at DESC,id DESC);
CREATE INDEX work_orders_factory_assignee_idx ON work_orders(factory_id,assignee_user_id,created_at DESC,id DESC);
CREATE INDEX work_orders_factory_machine_window_idx ON work_orders(factory_id,machine_id,planned_start_at,planned_end_at)
 WHERE status NOT IN ('CLOSED','CANCELLED');
CREATE INDEX work_orders_factory_status_idx ON work_orders(factory_id,status,created_at DESC,id DESC);

CREATE TABLE work_order_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id UUID NOT NULL, factory_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0), actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 command TEXT NOT NULL CHECK(command IN ('CREATE','ASSIGN','REASSIGN','ACCEPT','START','BLOCK','RESUME','COMPLETE','CLOSE','REQUEST_REWORK','CANCEL','MANAGER_HOLD','REASSIGN_FOR_REWORK')),
 occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), payload_json JSONB NOT NULL,
 FOREIGN KEY(work_order_id,factory_id) REFERENCES work_orders(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(work_order_id,sequence)
);
CREATE TABLE work_order_completions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id UUID NOT NULL, factory_id TEXT NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt>0), actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 completed_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), report_json JSONB NOT NULL,
 FOREIGN KEY(work_order_id,factory_id) REFERENCES work_orders(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(work_order_id,attempt),
 CHECK(report_json ?& ARRAY['outcome','work_performed','result']),
 CHECK(jsonb_typeof(report_json->'work_performed')='string' AND jsonb_typeof(report_json->'result')='string'),
 CHECK(report_json->>'outcome' IN ('SUCCESS','PARTIAL','STOPPED')),
 CHECK(length(btrim(report_json->>'work_performed'))>0 AND length(btrim(report_json->>'result'))>0),
 CHECK(report_json->>'outcome'<>'STOPPED' OR (report_json ? 'stop_reason' AND jsonb_typeof(report_json->'stop_reason')='string' AND length(btrim(report_json->>'stop_reason'))>0))
);
CREATE TABLE work_order_command_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), factory_id TEXT NOT NULL,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 128), request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 work_order_id UUID NOT NULL, status_code INTEGER NOT NULL CHECK(status_code IN (200,201)), response_json JSONB NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(work_order_id,factory_id) REFERENCES work_orders(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(factory_id,actor_id,key)
);

CREATE FUNCTION work_order_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s JSONB; b JSONB; a JSONB; r JSONB; h TEXT; c decision_cases;
BEGIN
 SELECT payload_json INTO s FROM operation_schedules WHERE factory_id=NEW.factory_id AND schedule_id=NEW.schedule_id AND revision=NEW.schedule_revision;
 SELECT payload_json,content_hash INTO b,h FROM factory_snapshots WHERE factory_id=NEW.factory_id AND snapshot_id=NEW.basis_snapshot_id;
 SELECT * INTO c FROM decision_cases WHERE id=NEW.source_case_id;
 SELECT value INTO a FROM jsonb_array_elements(s->'assignments') WHERE value->>'assignment_id'=NEW.assignment_id;
 SELECT value INTO r FROM jsonb_array_elements(b->'maintenance_requests') WHERE value->>'maintenance_request_id'=NEW.maintenance_request_id;
 IF c.mode IS DISTINCT FROM 'LIVE' OR c.status IS DISTINCT FROM 'COMMITTED' OR a IS NULL OR r IS NULL
 OR a->>'assignment_type' IS DISTINCT FROM 'MAINTENANCE'
 OR a->>'machine_id' IS DISTINCT FROM NEW.machine_id OR r->>'machine_id' IS DISTINCT FROM NEW.machine_id
 OR a->>'maintenance_request_id' IS DISTINCT FROM NEW.maintenance_request_id
 OR (a->>'start_at')::timestamptz IS DISTINCT FROM NEW.planned_start_at OR (a->>'end_at')::timestamptz IS DISTINCT FROM NEW.planned_end_at
 OR a->'technician_ids' IS DISTINCT FROM to_jsonb(NEW.source_technician_ids) OR h IS DISTINCT FROM NEW.basis_snapshot_hash
 OR NEW.requirements_json IS DISTINCT FROM jsonb_build_object('maintenance_type',r->'maintenance_type','action_type',r->'action_type','priority',r->'priority','required_skill_ids',r->'required_skill_ids','minimum_skill_level',r->'minimum_skill_level','mandatory',r->'mandatory','expected_duration_minutes',r->'expected_duration_minutes')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'machines') m WHERE m->>'machine_id'=NEW.machine_id)
 THEN RAISE EXCEPTION 'Work order source projection is inconsistent'; END IF;
 IF NEW.status<>'UNASSIGNED' OR NEW.revision<>1 OR NEW.attempt<>1 OR NEW.assignee_user_id IS NOT NULL OR NEW.actual_started_at IS NOT NULL
 THEN RAISE EXCEPTION 'Work order must begin unassigned'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_orders_source_guard BEFORE INSERT ON work_orders FOR EACH ROW EXECUTE FUNCTION work_order_source_guard();
CREATE FUNCTION work_order_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Work orders cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','revision','attempt','assignee_user_id','blocker','actual_started_at','actual_completed_at','verification_json','cancel_reason','cancelled_at','updated_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','attempt','assignee_user_id','blocker','actual_started_at','actual_completed_at','verification_json','cancel_reason','cancelled_at','updated_at'])
 OR NEW.revision<>OLD.revision+1 OR OLD.status IN ('CLOSED','CANCELLED')
 OR (OLD.actual_started_at IS NOT NULL AND NEW.actual_started_at IS DISTINCT FROM OLD.actual_started_at)
 OR NEW.attempt<>OLD.attempt+(CASE WHEN OLD.status='COMPLETED' AND NEW.status IN ('IN_PROGRESS','ASSIGNED') THEN 1 ELSE 0 END)
 OR NOT ((OLD.status='UNASSIGNED' AND NEW.status IN ('ASSIGNED','CANCELLED'))
 OR (OLD.status='ASSIGNED' AND NEW.status IN ('ASSIGNED','ACCEPTED','CANCELLED'))
 OR (OLD.status='ACCEPTED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS','CANCELLED'))
 OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('BLOCKED','COMPLETED'))
 OR (OLD.status='BLOCKED' AND NEW.status IN ('ASSIGNED','IN_PROGRESS'))
 OR (OLD.status='COMPLETED' AND NEW.status IN ('IN_PROGRESS','ASSIGNED','CLOSED')))
 THEN RAISE EXCEPTION 'Work order immutable source, revision or transition violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_orders_update_guard BEFORE UPDATE OR DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION work_order_update_guard();
CREATE FUNCTION work_order_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Work order history is immutable'; END $$;
CREATE TRIGGER work_order_events_immutable BEFORE UPDATE OR DELETE ON work_order_events FOR EACH ROW EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_order_completions_immutable BEFORE UPDATE OR DELETE ON work_order_completions FOR EACH ROW EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_order_receipts_immutable BEFORE UPDATE OR DELETE ON work_order_command_receipts FOR EACH ROW EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_orders_no_truncate BEFORE TRUNCATE ON work_orders FOR EACH STATEMENT EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_order_events_no_truncate BEFORE TRUNCATE ON work_order_events FOR EACH STATEMENT EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_order_completions_no_truncate BEFORE TRUNCATE ON work_order_completions FOR EACH STATEMENT EXECUTE FUNCTION work_order_history_immutable();
CREATE TRIGGER work_order_receipts_no_truncate BEFORE TRUNCATE ON work_order_command_receipts FOR EACH STATEMENT EXECUTE FUNCTION work_order_history_immutable();
CREATE FUNCTION work_order_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w work_orders; last_sequence INTEGER;
BEGIN
 SELECT * INTO w FROM work_orders WHERE id=NEW.work_order_id FOR UPDATE;
 SELECT coalesce(max(sequence),0) INTO last_sequence FROM work_order_events WHERE work_order_id=NEW.work_order_id;
 IF NEW.sequence<>last_sequence+1 OR NEW.sequence<>w.revision OR (NEW.payload_json->>'revision')::integer IS DISTINCT FROM w.revision
 OR NEW.payload_json->>'to_status' IS DISTINCT FROM w.status THEN RAISE EXCEPTION 'Work order event sequence/state violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_order_event_guard BEFORE INSERT ON work_order_events FOR EACH ROW EXECUTE FUNCTION work_order_event_guard();
CREATE FUNCTION work_order_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.action LIKE 'WORK_ORDER_%' THEN RAISE EXCEPTION 'Work order audit is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER work_order_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION work_order_audit_guard();
COMMIT;
