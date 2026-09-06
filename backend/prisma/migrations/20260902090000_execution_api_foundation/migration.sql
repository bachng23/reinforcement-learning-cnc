BEGIN;

-- Extend policies with API-facing metadata.
ALTER TABLE "policies"
ADD COLUMN "description" TEXT,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Add experiment execution configuration. Required values are introduced as
-- nullable first so installations with existing research data can be backfilled.
ALTER TABLE "experiments"
ADD COLUMN "description" TEXT,
ADD COLUMN "policy_id" UUID,
ADD COLUMN "episode_count" INTEGER,
ADD COLUMN "run_idempotency_key" TEXT,
ADD COLUMN "run_requested_at" TIMESTAMPTZ(6);

-- A legacy experiment without episodes has no selected policy to infer. Create
-- one inactive compatibility policy only when that backfill is needed.
INSERT INTO "policies" (
    "id",
    "policy_key",
    "version",
    "name",
    "description",
    "active",
    "config_json",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    'legacy-migration-default',
    '1.0',
    'Legacy migration policy',
    'Inactive compatibility policy assigned only to experiments created before policy selection was required.',
    false,
    '{"source":"execution-api-foundation-migration"}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (
    SELECT 1
    FROM "experiments" AS experiment
    WHERE NOT EXISTS (
        SELECT 1
        FROM "episodes" AS episode
        WHERE episode."experiment_id" = experiment."id"
    )
)
  AND NOT EXISTS (
      SELECT 1
      FROM "policies"
      WHERE "policy_key" = 'legacy-migration-default'
        AND "version" = '1.0'
  );

-- The Week 1 contract selects exactly one policy per experiment. Refuse to
-- guess if legacy data used multiple policies; the transaction remains fully
-- recoverable and the owner can split or normalize those experiments first.
DO $$
BEGIN
    IF EXISTS (
        SELECT episode."experiment_id"
        FROM "episodes" AS episode
        GROUP BY episode."experiment_id"
        HAVING COUNT(DISTINCT episode."policy_id") > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot migrate experiments containing episodes from multiple policies';
    END IF;
END
$$;

-- Prefer the single policy already used by each experiment. If an old
-- experiment has no episodes, use the inactive compatibility policy.
UPDATE "experiments" AS experiment
SET "policy_id" = COALESCE(
    (
        SELECT episode."policy_id"
        FROM "episodes" AS episode
        WHERE episode."experiment_id" = experiment."id"
        ORDER BY episode."created_at" ASC, episode."id" ASC
        LIMIT 1
    ),
    (
        SELECT policy."id"
        FROM "policies" AS policy
        WHERE policy."policy_key" = 'legacy-migration-default'
          AND policy."version" = '1.0'
        LIMIT 1
    )
)
WHERE experiment."policy_id" IS NULL;

-- Preserve the number of existing episodes; an empty legacy experiment gets
-- the smallest valid declared episode count.
UPDATE "experiments" AS experiment
SET "episode_count" = GREATEST(
    1,
    (
        SELECT COUNT(*)::INTEGER
        FROM "episodes" AS episode
        WHERE episode."experiment_id" = experiment."id"
    )
)
WHERE experiment."episode_count" IS NULL;

ALTER TABLE "experiments"
ALTER COLUMN "policy_id" SET NOT NULL,
ALTER COLUMN "episode_count" SET NOT NULL;

ALTER TABLE "experiments"
ADD CONSTRAINT "experiments_episode_count_positive"
CHECK ("episode_count" > 0);

-- Existing episodes mean the experiment has already been executed. Mark it
-- with a deterministic synthetic key so Product API can never enqueue the
-- same seed/index set again after an upgrade.
UPDATE "experiments" AS experiment
SET
    "run_idempotency_key" = 'legacy:' || experiment."id"::TEXT,
    "run_requested_at" = (
        SELECT MIN(episode."created_at")
        FROM "episodes" AS episode
        WHERE episode."experiment_id" = experiment."id"
    ),
    "status" = CASE
        WHEN EXISTS (
            SELECT 1 FROM "episodes" AS episode
            WHERE episode."experiment_id" = experiment."id"
              AND episode."status" IN ('PENDING', 'RUNNING')
        ) THEN 'RUNNING'::"ExperimentStatus"
        WHEN EXISTS (
            SELECT 1 FROM "episodes" AS episode
            WHERE episode."experiment_id" = experiment."id"
              AND episode."status" = 'FAILED'
        ) THEN 'FAILED'::"ExperimentStatus"
        WHEN EXISTS (
            SELECT 1 FROM "episodes" AS episode
            WHERE episode."experiment_id" = experiment."id"
              AND episode."status" = 'CANCELLED'
        ) THEN 'CANCELLED'::"ExperimentStatus"
        ELSE 'COMPLETED'::"ExperimentStatus"
    END
WHERE EXISTS (
    SELECT 1
    FROM "episodes" AS episode
    WHERE episode."experiment_id" = experiment."id"
);

-- Add retry-aware episode execution state. Indexes are backfilled by stable
-- creation order so existing episodes receive deterministic zero-based indexes.
ALTER TABLE "episodes"
ADD COLUMN "episode_index" INTEGER,
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "queued_at" TIMESTAMPTZ(6),
ADD COLUMN "failed_at" TIMESTAMPTZ(6),
ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN "error_code" TEXT,
ADD COLUMN "error_message" TEXT;

WITH ranked_episodes AS (
    SELECT
        "id",
        (ROW_NUMBER() OVER (
            PARTITION BY "experiment_id"
            ORDER BY "created_at" ASC, "id" ASC
        ) - 1)::INTEGER AS "episode_index"
    FROM "episodes"
)
UPDATE "episodes" AS episode
SET "episode_index" = ranked."episode_index"
FROM ranked_episodes AS ranked
WHERE episode."id" = ranked."id";

UPDATE "episodes"
SET "queued_at" = COALESCE("started_at", "created_at", CURRENT_TIMESTAMP)
WHERE "queued_at" IS NULL;

ALTER TABLE "episodes"
ALTER COLUMN "episode_index" SET NOT NULL,
ALTER COLUMN "queued_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "queued_at" SET NOT NULL;

ALTER TABLE "episodes"
ADD CONSTRAINT "episodes_episode_index_nonnegative"
CHECK ("episode_index" >= 0),
ADD CONSTRAINT "episodes_attempt_positive"
CHECK ("attempt" > 0);

-- Existing observation rows belong to attempt one. Replace the old uniqueness
-- rule so retries can retain observations from every attempt.
ALTER TABLE "fleet_observations"
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "fleet_observations"
ADD CONSTRAINT "fleet_observations_attempt_positive"
CHECK ("attempt" > 0);

DROP INDEX "fleet_observations_episode_id_step_key";

-- Store one immutable aggregate summary for each episode attempt.
CREATE TABLE "episode_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "episode_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "schema_version" TEXT NOT NULL DEFAULT '2.0',
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_summaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "episode_summaries_attempt_positive" CHECK ("attempt" > 0),
    CONSTRAINT "episode_summaries_payload_is_object" CHECK (jsonb_typeof("payload_json") = 'object')
);

-- Experiment ownership, run idempotency, worker claiming, and deterministic
-- episode/event listing indexes.
CREATE INDEX "experiments_created_by_id_created_at_id_idx"
ON "experiments"("created_by_id", "created_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "experiments_id_policy_id_key"
ON "experiments"("id", "policy_id");

CREATE UNIQUE INDEX "experiments_created_by_id_run_idempotency_key_key"
ON "experiments"("created_by_id", "run_idempotency_key");

CREATE UNIQUE INDEX "episodes_experiment_id_episode_index_key"
ON "episodes"("experiment_id", "episode_index");

CREATE INDEX "episodes_status_queued_at_idx"
ON "episodes"("status", "queued_at");

CREATE INDEX "episodes_experiment_id_episode_index_id_idx"
ON "episodes"("experiment_id", "episode_index", "id");

CREATE UNIQUE INDEX "fleet_observations_episode_id_attempt_step_key"
ON "fleet_observations"("episode_id", "attempt", "step");

CREATE INDEX "fleet_observations_episode_id_attempt_step_id_idx"
ON "fleet_observations"("episode_id", "attempt", "step", "id");

CREATE UNIQUE INDEX "episode_summaries_episode_id_attempt_key"
ON "episode_summaries"("episode_id", "attempt");

ALTER TABLE "experiments"
ADD CONSTRAINT "experiments_policy_id_fkey"
FOREIGN KEY ("policy_id") REFERENCES "policies"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "episode_summaries"
ADD CONSTRAINT "episode_summaries_episode_id_fkey"
FOREIGN KEY ("episode_id") REFERENCES "episodes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Defend the worker boundary: an episode policy must match the experiment's
-- selected policy, even for writers that do not use Prisma.
ALTER TABLE "episodes"
DROP CONSTRAINT "episodes_experiment_id_fkey";

ALTER TABLE "episodes"
ADD CONSTRAINT "episodes_experiment_policy_consistent_fkey"
FOREIGN KEY ("experiment_id", "policy_id")
REFERENCES "experiments"("id", "policy_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce lifecycle edges for every writer, including an external/Python
-- worker that does not import the Node lifecycle helper.
CREATE FUNCTION "enforce_episode_status_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = OLD."status" THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD."status" = 'PENDING' AND NEW."status" IN ('RUNNING', 'CANCELLED'))
        OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('COMPLETED', 'FAILED', 'CANCELLED'))
        OR (OLD."status" = 'FAILED' AND NEW."status" = 'PENDING')
    ) THEN
        RAISE EXCEPTION 'Invalid episode status transition: % -> %', OLD."status", NEW."status"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER "episodes_status_transition_guard"
BEFORE UPDATE OF "status" ON "episodes"
FOR EACH ROW
EXECUTE FUNCTION "enforce_episode_status_transition"();

-- Keep experiment list/detail status useful without asking the Product API to
-- calculate research outputs. This aggregates only persisted episode states.
CREATE FUNCTION "sync_experiment_status_from_episodes"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_experiment_id UUID;
    next_status "ExperimentStatus";
BEGIN
    target_experiment_id := NEW."experiment_id";

    IF NOT EXISTS (
        SELECT 1 FROM "episodes"
        WHERE "experiment_id" = target_experiment_id
    ) THEN
        RETURN NULL;
    END IF;

    next_status := CASE
        WHEN EXISTS (
            SELECT 1 FROM "episodes"
            WHERE "experiment_id" = target_experiment_id
              AND "status" IN ('PENDING', 'RUNNING')
        ) THEN 'RUNNING'::"ExperimentStatus"
        WHEN EXISTS (
            SELECT 1 FROM "episodes"
            WHERE "experiment_id" = target_experiment_id
              AND "status" = 'FAILED'
        ) THEN 'FAILED'::"ExperimentStatus"
        WHEN EXISTS (
            SELECT 1 FROM "episodes"
            WHERE "experiment_id" = target_experiment_id
              AND "status" = 'CANCELLED'
        ) THEN 'CANCELLED'::"ExperimentStatus"
        ELSE 'COMPLETED'::"ExperimentStatus"
    END;

    UPDATE "experiments"
    SET "status" = next_status,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = target_experiment_id
      AND "run_idempotency_key" IS NOT NULL
      AND "status" IS DISTINCT FROM next_status;

    RETURN NULL;
END
$$;

CREATE TRIGGER "episodes_sync_experiment_status"
AFTER INSERT OR UPDATE OF "status" ON "episodes"
FOR EACH ROW
EXECUTE FUNCTION "sync_experiment_status_from_episodes"();

COMMIT;
