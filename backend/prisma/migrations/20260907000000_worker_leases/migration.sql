-- Episode summaries and public failure fields are defined by execution_api_foundation.
ALTER TABLE "episodes"
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6);
CREATE INDEX "episodes_status_lease_expires_at_idx" ON "episodes"("status", "lease_expires_at");
