-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('VIEWER', 'OPERATOR', 'ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('AUTH', 'EXPERIMENT', 'POLICY', 'EPISODE', 'SYSTEM');

-- CreateTable
CREATE TABLE "experiments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "experiment_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT '2.0',
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "environment_config" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experiments_key_not_empty" CHECK (length("experiment_key") > 0),
    CONSTRAINT "experiments_config_is_object" CHECK (jsonb_typeof("environment_config") = 'object')
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "policy_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config_json" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "policies_key_not_empty" CHECK (length("policy_key") > 0),
    CONSTRAINT "policies_version_not_empty" CHECK (length("version") > 0)
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "episode_key" TEXT NOT NULL,
    "experiment_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'PENDING',
    "steps_completed" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION,
    "failure_count" INTEGER,
    "replacement_count" INTEGER,
    "waiting_steps" INTEGER,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "episodes_seed_nonnegative" CHECK ("seed" >= 0),
    CONSTRAINT "episodes_steps_nonnegative" CHECK ("steps_completed" >= 0),
    CONSTRAINT "episodes_cost_nonnegative" CHECK ("total_cost" IS NULL OR "total_cost" >= 0),
    CONSTRAINT "episodes_failures_nonnegative" CHECK ("failure_count" IS NULL OR "failure_count" >= 0),
    CONSTRAINT "episodes_replacements_nonnegative" CHECK ("replacement_count" IS NULL OR "replacement_count" >= 0),
    CONSTRAINT "episodes_waiting_nonnegative" CHECK ("waiting_steps" IS NULL OR "waiting_steps" >= 0),
    CONSTRAINT "episodes_time_order" CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at")
);

-- CreateTable
CREATE TABLE "fleet_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observation_key" TEXT NOT NULL,
    "episode_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT '2.0',
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fleet_observations_step_nonnegative" CHECK ("step" >= 0),
    CONSTRAINT "fleet_observations_payload_is_object" CHECK (jsonb_typeof("payload_json") = 'object')
);

-- CreateTable
CREATE TABLE "policy_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observation_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT '2.0',
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_recommendations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "policy_recommendations_payload_is_object" CHECK (jsonb_typeof("payload_json") = 'object')
);

-- CreateTable
CREATE TABLE "step_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observation_id" UUID NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT '2.0',
    "payload_json" JSONB NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "episode_terminated" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "step_results_cost_nonnegative" CHECK ("total_cost" >= 0),
    CONSTRAINT "step_results_payload_is_object" CHECK (jsonb_typeof("payload_json") = 'object')
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_username_not_empty" CHECK (length("username") > 0)
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" UUID,
    "payload_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiments_experiment_key_key" ON "experiments"("experiment_key");

-- CreateIndex
CREATE INDEX "experiments_status_created_at_idx" ON "experiments"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "policies_policy_key_version_key" ON "policies"("policy_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_episode_key_key" ON "episodes"("episode_key");

-- CreateIndex
CREATE INDEX "episodes_experiment_id_status_idx" ON "episodes"("experiment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_experiment_id_policy_id_seed_key" ON "episodes"("experiment_id", "policy_id", "seed");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_observations_observation_key_key" ON "fleet_observations"("observation_key");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_observations_episode_id_step_key" ON "fleet_observations"("episode_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "policy_recommendations_observation_id_key" ON "policy_recommendations"("observation_id");

-- CreateIndex
CREATE INDEX "policy_recommendations_policy_id_created_at_idx" ON "policy_recommendations"("policy_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "step_results_observation_id_key" ON "step_results"("observation_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_observations" ADD CONSTRAINT "fleet_observations_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_recommendations" ADD CONSTRAINT "policy_recommendations_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "fleet_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_recommendations" ADD CONSTRAINT "policy_recommendations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "fleet_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
