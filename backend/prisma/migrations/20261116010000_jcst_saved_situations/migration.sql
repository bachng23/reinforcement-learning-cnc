BEGIN;
CREATE TABLE "demo_snapshots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "source_session_id" UUID NOT NULL REFERENCES "demo_sessions"("id") ON DELETE RESTRICT,
  "source_revision" INTEGER NOT NULL CHECK ("source_revision" >= 0),
  "source_tick" INTEGER NOT NULL CHECK ("source_tick" >= 0),
  "source_commit" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL CHECK ("schema_version" = 'jcst-demo-snapshot/1'),
  "snapshot_hash" CHAR(64) NOT NULL CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
  "name" VARCHAR(120) NOT NULL CHECK (length(btrim("name")) > 0),
  "description" VARCHAR(2000) NOT NULL DEFAULT '',
  "layout_id" VARCHAR(128) NOT NULL,
  "payload_json" JSONB NOT NULL CHECK (jsonb_typeof("payload_json") = 'object'),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "demo_snapshots_owner_page_idx" ON "demo_snapshots" ("owner_id", "created_at" DESC, "id" DESC);
CREATE INDEX "demo_snapshots_page_idx" ON "demo_snapshots" ("created_at" DESC, "id" DESC);
ALTER TABLE "demo_sessions" ADD COLUMN "source_snapshot_id" UUID REFERENCES "demo_snapshots"("id") ON DELETE RESTRICT;
CREATE TABLE "demo_write_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "demo_write_receipts_actor_id_idempotency_key_key" ON "demo_write_receipts" ("actor_id", "idempotency_key");
CREATE FUNCTION "demo_situation_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saved simulation snapshots and command receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "demo_snapshots_immutable" BEFORE UPDATE OR DELETE ON "demo_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "demo_situation_immutable"();
CREATE TRIGGER "demo_write_receipts_immutable" BEFORE UPDATE OR DELETE ON "demo_write_receipts"
  FOR EACH ROW EXECUTE FUNCTION "demo_situation_immutable"();
COMMIT;
