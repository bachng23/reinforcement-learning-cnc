-- Incident-owned additive tables. No Work Order FK or canonical v3 enum changes.
CREATE TABLE factory_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL REFERENCES factories(factory_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  category text NOT NULL CHECK (category IN ('EQUIPMENT','PROCESS','SAFETY','OTHER')),
  machine_id text, basis_snapshot_id text,
  source text NOT NULL CHECK (source IN ('manual','case_health_alert')),
  severity text CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  proposed_severity text CHECK (proposed_severity IN ('INFO','WARNING','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','CLOSED')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  last_occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  acknowledged_at timestamptz(6),
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz(6), resolution jsonb,
  closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at timestamptz(6), verification jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (factory_id,id),
  FOREIGN KEY (factory_id,basis_snapshot_id) REFERENCES factory_snapshots(factory_id,snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((machine_id IS NULL) = (basis_snapshot_id IS NULL)),
  CHECK (last_occurred_at >= first_occurred_at),
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK (status <> 'CLOSED' OR (closed_by IS NOT NULL AND resolved_by IS NOT NULL AND closed_by <> resolved_by))
);
CREATE INDEX factory_incidents_list_idx ON factory_incidents(factory_id,created_at DESC,id DESC);
CREATE INDEX factory_incidents_machine_idx ON factory_incidents(factory_id,machine_id,status);

CREATE TABLE incident_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL,
  incident_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  source_type text NOT NULL CHECK (source_type IN ('manual','case_health_alert')),
  source_id uuid NOT NULL,
  source_hash char(64) NOT NULL,
  machine_id text, basis_snapshot_id text,
  evidence jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(factory_id,source_type,source_id),
  UNIQUE(incident_id,sequence),
  FOREIGN KEY(factory_id,incident_id) REFERENCES factory_incidents(factory_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY(factory_id,basis_snapshot_id) REFERENCES factory_snapshots(factory_id,snapshot_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((machine_id IS NULL) = (basis_snapshot_id IS NULL))
);
CREATE TABLE incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES factory_incidents(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK(sequence > 0),
  command text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE(incident_id,sequence)
);
CREATE TABLE incident_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL REFERENCES factories(factory_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL CHECK(idempotency_key ~ '^[!-~]{1,128}$'),
  request_hash char(64) NOT NULL,
  incident_id uuid NOT NULL,
  response_status integer NOT NULL CHECK(response_status IN (200,201)),
  response_body jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE(factory_id,actor_id,idempotency_key),
  FOREIGN KEY(factory_id,incident_id) REFERENCES factory_incidents(factory_id,id) ON DELETE RESTRICT
);
CREATE TABLE incident_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES factory_incidents(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES decision_cases(id) ON DELETE RESTRICT,
  association_scope text NOT NULL CHECK(association_scope IN ('case','machine')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz(6), removal_reason text,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (removed_at IS NULL OR (removal_reason IS NOT NULL AND length(btrim(removal_reason)) > 0))
);
CREATE UNIQUE INDEX incident_case_links_active_idx ON incident_case_links(incident_id,target_id) WHERE removed_at IS NULL;
CREATE TABLE incident_work_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES factory_incidents(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL,
  association_scope text NOT NULL CHECK(association_scope IN ('case','machine')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz(6), removal_reason text,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (removed_at IS NULL OR (removal_reason IS NOT NULL AND length(btrim(removal_reason)) > 0))
);
CREATE UNIQUE INDEX incident_work_order_links_active_idx ON incident_work_order_links(incident_id,target_id) WHERE removed_at IS NULL;

CREATE FUNCTION incident_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Incident history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER incident_occurrences_immutable BEFORE UPDATE OR DELETE ON incident_occurrences FOR EACH ROW EXECUTE FUNCTION incident_immutable_history();
CREATE TRIGGER incident_events_immutable BEFORE UPDATE OR DELETE ON incident_events FOR EACH ROW EXECUTE FUNCTION incident_immutable_history();
CREATE TRIGGER incident_receipts_immutable BEFORE UPDATE OR DELETE ON incident_command_receipts FOR EACH ROW EXECUTE FUNCTION incident_immutable_history();

CREATE FUNCTION incident_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Incident deletion is not supported' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.factory_id,NEW.category,NEW.machine_id,NEW.basis_snapshot_id,NEW.source,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.factory_id,OLD.category,OLD.machine_id,OLD.basis_snapshot_id,OLD.source,OLD.created_at)
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Incident identity is immutable; revision must advance once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER factory_incidents_guard BEFORE UPDATE OR DELETE ON factory_incidents FOR EACH ROW EXECUTE FUNCTION incident_identity_guard();

CREATE FUNCTION incident_link_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Incident link history is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR
    ROW(NEW.id,NEW.incident_id,NEW.target_id,NEW.association_scope,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.incident_id,OLD.target_id,OLD.association_scope,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'Only first unlink is permitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incident_case_links_guard BEFORE UPDATE OR DELETE ON incident_case_links FOR EACH ROW EXECUTE FUNCTION incident_link_history_guard();
CREATE TRIGGER incident_work_order_links_guard BEFORE UPDATE OR DELETE ON incident_work_order_links FOR EACH ROW EXECUTE FUNCTION incident_link_history_guard();
