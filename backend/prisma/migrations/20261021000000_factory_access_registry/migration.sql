BEGIN;
CREATE TABLE factories (
 factory_id TEXT PRIMARY KEY CHECK(length(factory_id) BETWEEN 1 AND 128 AND factory_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200 AND name=btrim(name) AND length(btrim(name))>0),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CHECK(updated_at >= created_at)
);
INSERT INTO factories(factory_id,name)
 SELECT factory_id,factory_id FROM (
 SELECT factory_id FROM factory_snapshots UNION SELECT factory_id FROM operations_heads
 UNION SELECT factory_id FROM operation_schedules UNION SELECT factory_id FROM decision_cases
 UNION SELECT factory_id FROM decision_case_idempotency_receipts UNION SELECT factory_id FROM decision_commits
 ) all_factories;
DO $$ DECLARE bad BIGINT; BEGIN
 SELECT count(*) INTO bad FROM decision_case_idempotency_receipts r LEFT JOIN decision_cases c ON c.id=r.case_id
 WHERE c.id IS NULL OR c.factory_id<>r.factory_id;
 IF bad>0 THEN RAISE EXCEPTION 'Factory registry migration: % receipt case scopes are inconsistent',bad; END IF;
 SELECT count(*) INTO bad FROM decision_commits r LEFT JOIN decision_cases c ON c.id=r.case_id
 WHERE c.id IS NULL OR c.factory_id<>r.factory_id;
 IF bad>0 THEN RAISE EXCEPTION 'Factory registry migration: % publication case scopes are inconsistent',bad; END IF;
END $$;
CREATE TABLE factory_memberships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), factory_id TEXT NOT NULL REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 active BOOLEAN NOT NULL DEFAULT true,
 granted_by UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 granted_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), grant_source TEXT NOT NULL,
 revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT, revoked_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 UNIQUE(factory_id,user_id),
 CHECK((grant_source='http' AND granted_by IS NOT NULL) OR (grant_source ~ '^import:[a-f0-9-]{36}$' AND granted_by IS NULL)),
 CHECK((active AND revoked_by IS NULL AND revoked_at IS NULL) OR (NOT active AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)),
 CHECK(granted_at>=created_at AND updated_at>=granted_at AND (revoked_at IS NULL OR (revoked_at>=granted_at AND updated_at>=revoked_at)))
);
CREATE INDEX factory_memberships_user_active_factory_idx ON factory_memberships(user_id,active,factory_id);
CREATE INDEX factory_memberships_factory_active_user_idx ON factory_memberships(factory_id,active,user_id);
ALTER TABLE factory_snapshots ADD CONSTRAINT factory_snapshots_factory_fkey FOREIGN KEY(factory_id) REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
ALTER TABLE factory_snapshots VALIDATE CONSTRAINT factory_snapshots_factory_fkey;
ALTER TABLE decision_cases ADD CONSTRAINT decision_cases_id_factory_key UNIQUE(id,factory_id);
ALTER TABLE decision_case_idempotency_receipts DROP CONSTRAINT decision_case_idempotency_receipts_case_id_fkey;
ALTER TABLE decision_case_idempotency_receipts ADD CONSTRAINT decision_receipts_case_factory_fkey FOREIGN KEY(case_id,factory_id) REFERENCES decision_cases(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
ALTER TABLE decision_case_idempotency_receipts VALIDATE CONSTRAINT decision_receipts_case_factory_fkey;
ALTER TABLE decision_commits ADD CONSTRAINT decision_commits_case_factory_key UNIQUE(case_id,factory_id);
ALTER TABLE decision_commits DROP CONSTRAINT decision_commits_case_id_fkey;
ALTER TABLE decision_commits ADD CONSTRAINT decision_commits_case_factory_fkey FOREIGN KEY(case_id,factory_id) REFERENCES decision_cases(id,factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
ALTER TABLE decision_commits VALIDATE CONSTRAINT decision_commits_case_factory_fkey;
ALTER TABLE audit_logs ADD COLUMN factory_id TEXT REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE audit_logs ADD CHECK(action NOT IN ('FACTORY_CREATED','FACTORY_UPDATED','FACTORY_ACCESS_GRANTED','FACTORY_ACCESS_REVOKED') OR (factory_id IS NOT NULL AND entity_id=factory_id));
CREATE INDEX audit_logs_factory_created_idx ON audit_logs(factory_id,created_at);
CREATE FUNCTION protect_factory_access_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.action IN ('FACTORY_CREATED','FACTORY_UPDATED','FACTORY_ACCESS_GRANTED','FACTORY_ACCESS_REVOKED','FACTORY_ACCESS_IMPORTED') THEN
  RAISE EXCEPTION 'Factory access audit is immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER factory_access_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION protect_factory_access_audit();
COMMIT;
