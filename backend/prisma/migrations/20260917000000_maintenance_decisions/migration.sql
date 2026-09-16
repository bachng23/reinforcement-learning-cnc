-- Owned by the enterprise maintenance module. Backend 1 must not edit this migration.
CREATE TYPE "MaintenanceDecisionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'OVERRIDDEN', 'REJECTED');
ALTER TYPE "EntityType" ADD VALUE 'MAINTENANCE_DECISION';
CREATE TABLE maintenance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL UNIQUE REFERENCES policy_recommendations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status "MaintenanceDecisionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE maintenance_decision_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL UNIQUE REFERENCES maintenance_decisions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  from_status "MaintenanceDecisionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  to_status "MaintenanceDecisionStatus" NOT NULL,
  reason TEXT,
  selected_action JSONB,
  recommendation_snapshot JSONB NOT NULL,
  risk_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT maintenance_transition CHECK (from_status = 'PENDING_REVIEW' AND to_status <> 'PENDING_REVIEW'),
  CONSTRAINT maintenance_override_reason CHECK (to_status <> 'OVERRIDDEN' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  CONSTRAINT maintenance_selected_action CHECK ((to_status = 'REJECTED' AND selected_action IS NULL) OR (to_status <> 'REJECTED' AND selected_action IS NOT NULL AND jsonb_typeof(selected_action) = 'object'))
);
CREATE FUNCTION maintenance_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Maintenance decision history is immutable';
END;
$$;
CREATE TRIGGER maintenance_actions_immutable BEFORE UPDATE OR DELETE ON maintenance_decision_actions
FOR EACH ROW EXECUTE FUNCTION maintenance_history_immutable();
CREATE TRIGGER maintenance_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW WHEN (OLD.entity_type::text = 'MAINTENANCE_DECISION')
EXECUTE FUNCTION maintenance_history_immutable();

CREATE FUNCTION maintenance_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_REVIEW' THEN RAISE EXCEPTION 'Decision must start pending review'; END IF;
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.status <> 'PENDING_REVIEW'
    OR NEW.status = 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'Invalid maintenance decision transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER maintenance_decision_guard BEFORE INSERT OR UPDATE ON maintenance_decisions
FOR EACH ROW EXECUTE FUNCTION maintenance_decision_guard();

-- Deferred checks enforce atomic status + human attribution even for direct SQL writers.
CREATE FUNCTION maintenance_decision_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; current_status "MaintenanceDecisionStatus";
BEGIN
  IF TG_TABLE_NAME = 'maintenance_decisions' THEN target_id := NEW.id; ELSE target_id := NEW.decision_id; END IF;
  SELECT status INTO current_status FROM maintenance_decisions WHERE id = target_id;
  IF current_status = 'PENDING_REVIEW' THEN
    IF EXISTS (SELECT 1 FROM maintenance_decision_actions WHERE decision_id = target_id) THEN
      RAISE EXCEPTION 'Pending decision cannot have a human action';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM maintenance_decision_actions WHERE decision_id = target_id AND to_status = current_status) THEN
    RAISE EXCEPTION 'Decision requires matching human action';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER maintenance_decision_consistent AFTER INSERT OR UPDATE ON maintenance_decisions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance_decision_consistent();
CREATE CONSTRAINT TRIGGER maintenance_action_consistent AFTER INSERT ON maintenance_decision_actions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION maintenance_decision_consistent();
