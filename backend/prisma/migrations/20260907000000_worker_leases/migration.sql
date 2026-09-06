ALTER TABLE "episodes"
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "failure_code" TEXT,
  ADD COLUMN "failure_message" TEXT;
CREATE INDEX "episodes_status_lease_expires_at_idx" ON "episodes"("status", "lease_expires_at");
CREATE TABLE "episode_summaries" (
  "episode_id" UUID PRIMARY KEY REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "schema_version" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
