# CNC Research Platform Backend

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
