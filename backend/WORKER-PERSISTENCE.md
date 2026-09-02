# Worker persistence contract

The worker consumes queued episodes independently of Product API requests. It must not be invoked from an HTTP controller.

## Claiming and lifecycle

Use `claimNextPendingEpisode` from `src/services/episode-lifecycle.service.js`, or an equivalent atomic conditional update. A worker owns an episode only after changing `PENDING` to `RUNNING`; selecting a row without the conditional update is not a claim.

Use `transitionEpisode` for lifecycle writes:

- `PENDING -> RUNNING`
- `RUNNING -> COMPLETED`
- `RUNNING -> FAILED`
- `RUNNING -> CANCELLED` only after cooperative cancellation is implemented

Product API owns `FAILED -> PENDING` retry and `PENDING -> CANCELLED`. The helper writes the corresponding lifecycle timestamps. Failure codes must be stable public identifiers, and failure messages must be safe for an end user; never persist stack traces, secrets, raw SQL, or private engine diagnostics in `errorMessage`.

The database migration also installs a transition trigger, so invalid edges are rejected for non-Node workers. Episode status changes synchronize the parent experiment to `RUNNING`, `COMPLETED`, `FAILED`, or `CANCELLED` from persisted episode states.

## Deterministic execution

`Experiment.environmentConfig.seed` is the submitted base seed. Each queued `Episode.seed` is the exact seed for that episode (`base seed + episodeIndex`). The worker must use `Episode.seed` when constructing the episode's environment and must otherwise preserve the stored CNC v2 environment configuration.

Retry increments `Episode.attempt`. Existing research events are immutable history and must not be deleted. New observations use the current attempt and are idempotent under `(episodeId, attempt, step)`; their `observationKey` is globally unique. Because the canonical payload has no `attempt` field, retry writers must generate a new canonical `observation_id` and database `observationKey` that include or otherwise distinguish the attempt. Recommendations and step results are one-to-one with their observation. A final `EpisodeSummary` is unique under `(episodeId, attempt)`.

Persist canonical `payloadJson` values without changing CNC contract meaning:

- `FleetObservation.payloadJson` is a CNC v2 `FleetObservation`.
- `PolicyRecommendation.payloadJson` is a CNC v2 `PolicyRecommendation`.
- `StepResult.payloadJson` is a CNC v2 `StepResult`.
- `EpisodeSummary.payloadJson` is a CNC v2 `EpisodeSummary`.

The worker may update the scalar progress and aggregate columns on `Episode`, but Product API returns the persisted summary payload and never calculates research results itself.
