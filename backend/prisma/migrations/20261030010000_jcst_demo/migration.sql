CREATE TABLE "demo_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "request_key" TEXT NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload_json" JSONB NOT NULL,
  "last_command_key" TEXT,
  "last_command_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "demo_sessions_owner_id_request_key_key" ON "demo_sessions"("owner_id", "request_key");
CREATE INDEX "demo_sessions_owner_id_created_at_idx" ON "demo_sessions"("owner_id", "created_at" DESC);
