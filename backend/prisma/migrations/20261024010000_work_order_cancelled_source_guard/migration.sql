-- Additive fix: reject new execution orders for cancelled published assignments.
-- Preserve historical orders and immutable publication payloads.
BEGIN;
CREATE OR REPLACE FUNCTION work_order_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s JSONB; b JSONB; a JSONB; r JSONB; h TEXT; c decision_cases;
BEGIN
 SELECT payload_json INTO s FROM operation_schedules WHERE factory_id=NEW.factory_id AND schedule_id=NEW.schedule_id AND revision=NEW.schedule_revision;
 SELECT payload_json,content_hash INTO b,h FROM factory_snapshots WHERE factory_id=NEW.factory_id AND snapshot_id=NEW.basis_snapshot_id;
 SELECT * INTO c FROM decision_cases WHERE id=NEW.source_case_id;
 SELECT value INTO a FROM jsonb_array_elements(s->'assignments') WHERE value->>'assignment_id'=NEW.assignment_id;
 SELECT value INTO r FROM jsonb_array_elements(b->'maintenance_requests') WHERE value->>'maintenance_request_id'=NEW.maintenance_request_id;
 IF c.mode IS DISTINCT FROM 'LIVE' OR c.status IS DISTINCT FROM 'COMMITTED' OR a IS NULL OR r IS NULL
 OR a->>'assignment_type' IS DISTINCT FROM 'MAINTENANCE'
 OR a->>'status' = 'CANCELLED'
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
COMMIT;
