-- CreateTable
CREATE TABLE "research_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "campaign_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "study_key" TEXT NOT NULL,
    "run_key" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "bundle_hash" CHAR(64) NOT NULL,
    "metadata_json" JSONB NOT NULL,
    "physical_replay_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "artifact_key" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_length" INTEGER NOT NULL,

    CONSTRAINT "research_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_episodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "episode_key" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "controller" TEXT NOT NULL,
    "physical_seed" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL,
    "tail" INTEGER NOT NULL,
    "controlled_cost" DOUBLE PRECISION NOT NULL,
    "tail_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "content_hash" CHAR(64) NOT NULL,

    CONSTRAINT "research_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" TEXT NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "input_json" JSONB NOT NULL,
    "output_json" JSONB,
    "error_code" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_campaigns_owner_id_created_at_idx" ON "research_campaigns"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "research_campaigns_owner_id_campaign_key_key" ON "research_campaigns"("owner_id", "campaign_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_runs_campaign_id_study_key_run_key_key" ON "research_runs"("campaign_id", "study_key", "run_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_artifacts_run_id_artifact_key_key" ON "research_artifacts"("run_id", "artifact_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_episodes_run_id_episode_key_key" ON "research_episodes"("run_id", "episode_key");

-- CreateIndex
CREATE INDEX "research_jobs_status_created_at_idx" ON "research_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "research_jobs_owner_id_idempotency_key_key" ON "research_jobs"("owner_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_reviews_job_id_key" ON "research_reviews"("job_id");

-- AddForeignKey
ALTER TABLE "research_campaigns" ADD CONSTRAINT "research_campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "research_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_episodes" ADD CONSTRAINT "research_episodes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_reviews" ADD CONSTRAINT "research_reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "research_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_reviews" ADD CONSTRAINT "research_reviews_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain guards supplement API validation and preserve imported history.
ALTER TABLE research_episodes ADD CONSTRAINT research_seed_decimal CHECK (physical_seed ~ '^(0|[1-9][0-9]{0,77})$');
ALTER TABLE research_episodes ADD CONSTRAINT research_episode_costs CHECK (controlled_cost >= 0 AND tail_cost >= 0 AND total_cost = controlled_cost + tail_cost AND horizon BETWEEN 1 AND 96 AND tail BETWEEN 0 AND 32);
ALTER TABLE research_runs ADD CONSTRAINT research_run_origin CHECK (origin IN ('engineering','research'));
ALTER TABLE research_jobs ADD CONSTRAINT research_job_status CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED'));
ALTER TABLE research_jobs ADD CONSTRAINT research_job_kind CHECK (kind IN ('IMPORT','BRANCH','INFER'));
ALTER TABLE research_jobs ADD CONSTRAINT research_job_lease CHECK ((status = 'RUNNING') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
ALTER TABLE research_reviews ADD CONSTRAINT research_review_decision CHECK (decision IN ('ACCEPT','REJECT'));
CREATE FUNCTION research_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Research evidence is immutable'; END; $$;
CREATE TRIGGER research_runs_immutable BEFORE UPDATE OR DELETE ON research_runs FOR EACH ROW EXECUTE FUNCTION research_immutable_record();
CREATE TRIGGER research_artifacts_immutable BEFORE UPDATE OR DELETE ON research_artifacts FOR EACH ROW EXECUTE FUNCTION research_immutable_record();
CREATE TRIGGER research_episodes_immutable BEFORE UPDATE OR DELETE ON research_episodes FOR EACH ROW EXECUTE FUNCTION research_immutable_record();
CREATE TRIGGER research_reviews_immutable BEFORE UPDATE OR DELETE ON research_reviews FOR EACH ROW EXECUTE FUNCTION research_immutable_record();
CREATE FUNCTION research_job_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.input_json IS DISTINCT FROM OLD.input_json OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN RAISE EXCEPTION 'Frozen research input cannot change'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING','CANCELLED')) OR (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED','CANCELLED'))) THEN RAISE EXCEPTION 'Invalid research job transition'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal research job is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER research_job_transition_guard BEFORE UPDATE ON research_jobs FOR EACH ROW EXECUTE FUNCTION research_job_transition();
