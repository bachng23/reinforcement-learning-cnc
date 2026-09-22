# CNC Research Platform Backend

## Operations snapshot ingestion

The internal `ingestFactorySnapshot` service validates v3 observations, serializes ingestion per factory, and updates the current snapshot with a head-revision CAS while preserving the published schedule and plan version. [Migration impact, concurrency protocol, CLI and test evidence](docs/operations-context/snapshot-ingestion.md). No public mutation endpoint is added.

## Operations Context design drafts

Design-only deliverables (no runtime API or migration changes):

- [Prisma mapping, phased persistence and transaction boundaries](docs/operations-context/prisma-design-note.md)
- [Six proposed v1 endpoints and concurrency/idempotency contract](docs/operations-context/api-endpoint-spec.md)
- [Decision Case lifecycle and transition guards](docs/operations-context/state-machine.md)

These drafts target Operations and Multi-Agent Contract v3.0. They still distinguish canonical contract payloads from proposed HTTP DTOs, persistence fields and transaction semantics.

## Maintenance decision queue

`GET /api/v1/maintenance/decisions?experiment=<UUID>` returns one candidate per machine in each persisted observation/recommendation/result triple from the episode's current attempt. The response shape is fixed in [the frontend mock](examples/maintenance-decisions.list.json) and described in [OpenAPI](openapi.yaml). Query filters are `status`, `severity`, `experiment`, and exact `machine`; `page` starts at 1 and `limit` defaults to 20 (maximum 100). `GET /api/v1/maintenance/decisions/:id` uses the candidate id from the list, formed as `<recommendation UUID>~<machine id>`.

Priority is severity first, then estimated cost of waiting one simulator step, then newest recommendation. Severity and rationale are derived from the policy action and persisted observation because the policy contract has no free-text rationale. `predictedCost` is the policy's estimate for the whole joint action. `costOfDelay.amount` is a transparent exposure proxy: probability of failure within one step multiplied by the configured failure cost. It is not a counterfactual forecast. `result` is a simulator outcome, not proof that maintenance happened. `decisionId` is the separate UUID used by the existing human review endpoints; its status applies to the entire joint recommendation.

The initial queue computes severity and filtering from accessible persisted events in the API process, so very large histories will need a database projection before production-scale use.

## Durable episode worker

The worker conditionally claims a PENDING episode with a unique lease token. Every write checks that token, RUNNING status and an unexpired lease. A step is validated in the order FleetObservation, PolicyRecommendation, StepResult, then all three records and stepsCompleted commit in one transaction. The next event is requested only after that transaction finishes. Memory use is limited to one step plus a summary, independent of episode length.

EpisodeSummary is stored in episode_summaries before COMPLETED is written, in the same transaction. Missing/invalid summaries, engine failures and persistence failures leave the episode FAILED with previously committed steps intact. Safe failure codes/messages are stored in errorCode/errorMessage and AuditLog when the worker still owns its lease; failedAt is set and completedAt stays null. Private diagnostics remain in internal worker logs.

Heartbeats renew the lease independently of event delivery. Expired RUNNING episodes are marked FAILED during polling; partial data is retained. They are never automatically replayed: Product API may explicitly retry FAILED episodes as a new attempt. Prior attempts remain immutable; no checkpoint/resume protocol is assumed. A stale owner cannot write after lease expiry or after another token owns the episode. Multiple workers may poll the same database safely. When a process or DB connection fails, stale recovery records WORKER_LEASE_EXPIRED once the database is available.

Configure DATABASE_URL, apply migrations and generate the Prisma client before starting the API and worker separately:

```sh
npx prisma migrate deploy
npm run prisma:generate
npm start
npm run worker
```

Stop all old workers before applying this migration: legacy RUNNING rows have no lease and will be marked FAILED by the new worker. Existing completed episodes are retained; historical summaries are not fabricated.

Fake execution requires both NODE_ENV=development (or test) and ENGINE_RUNNER=fake. Without an explicit runner selection startup fails. FakeEngineRunner produces deterministic fixtures identified by engine version fake-fixture-v2; it is not a scientific simulation. Fixture metadata is not added to canonical payloads. Copy the worker settings from .env.example into the local environment when needed.

| Setting | Default | Meaning |
| --- | --- | --- |
| WORKER_POLL_MS | 1000 | Idle poll interval |
| ENGINE_TIMEOUT_MS | 30000 | Maximum wait for each engine event or stream end; excludes database writes |
| WORKER_LEASE_MS | 120000 | Lease duration; replaces WORKER_STALE_MS |
| WORKER_HEARTBEAT_MS | 40000 | Renewal interval, must be shorter than lease |
| WORKER_SHUTDOWN_MS | 30000 | Grace period to finish the current job |

SIGINT/SIGTERM stops new claims immediately and drains the active job while heartbeats continue. After the grace period, the engine receives abort and the job is marked FAILED with WORKER_SHUTDOWN. In-flight database transactions are allowed to settle before disconnect; database outages can delay shutdown, and lease recovery handles jobs whose failure status cannot be saved. Engines that ignore cancellation cannot block stream consumption indefinitely, but must implement resource cleanup themselves.

## Engine adapter boundary

Implement a versioned adapter with execute(request, { signal }) returning an AsyncIterable, then inject it into main({ adapter }) with ENGINE_RUNNER=adapter, or inject an EngineRunner into EpisodeWorker. AdapterEngineRunner validates the request; the worker validates every event and stream ordering. No research model or algorithm is implemented by this boundary.

The request contains episodeId, attempt, environmentConfig, policyId (the policy key), policyVersion and seed (the exact Episode.seed). Emit contiguous steps starting at zero, with one ordered observation/recommendation/result per step, followed by exactly one EpisodeSummary and stream end. No events are allowed after a terminal StepResult except the summary. Events use { type, payload } envelopes; only the canonical payload is persisted. The current v2 payload contract is in src/engine/contracts.js. Observation identifiers must distinguish attempts. Contract/domain changes for the incoming engine should be agreed separately.

Adapters must honor AbortSignal, clean up on cancellation/iterator return and use child processes or external services for CPU-intensive work so heartbeats can run. Multiple backend hosts need synchronized clocks for lease timestamps. Lease fencing protects database writes; it cannot terminate an isolated external engine process, so adapters must also cancel their external jobs. The worker does not automatically start a replacement engine for an expired job.

Logs are JSON. Run unit tests with npm test. Run PostgreSQL durability tests with WORKER_TEST_DATABASE_URL pointing to a dedicated migrated test database; those tests create and remove only their own fixtures.

Identical step persistence retries are idempotent under (episodeId, attempt, step). Conflicting replays fail without overwriting history. WORKER-PERSISTENCE.md describes the shared Product API contract.
