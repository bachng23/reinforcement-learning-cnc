# CNC Research Platform Backend

## Episode worker and fake engine

The worker polls existing `PENDING` episodes, atomically changes one to `RUNNING`, invokes an engine through the `EngineRunner` boundary, validates CNC contract v2 events, and commits all step records plus the episode summary in one transaction. Week 1 uses deterministic data from `FakeEngineRunner`; its `fake-fixture-v2` engine version identifies it as non-scientific output without adding fields to canonical payloads.

Configure `DATABASE_URL`, generate the Prisma client, and run the API and worker in separate terminals:

```sh
npm run prisma:generate
npm start
npm run worker
```

Optional worker settings are `WORKER_POLL_MS` (default `1000`), `ENGINE_TIMEOUT_MS` (default `30000`), and `WORKER_STALE_MS` (default `120000`). On startup, stale `RUNNING` episodes are marked `FAILED` so the Product API can retry them as a new attempt. Prior attempt events remain immutable. Attempt-aware event upserts and database uniqueness constraints make repeated delivery safe. A completed status is written only inside the same transaction as all event records and the `EpisodeSummary`; failures are marked `FAILED` and recorded in `AuditLog`.

Worker logs are newline-delimited JSON and include experiment, episode, engine version, and simulation step where applicable. The in-process health snapshot records polling, completion, and error timestamps. Stop the worker gracefully with `SIGINT` or `SIGTERM`.

Replace the fake engine later by implementing `EngineRunner.execute(request, { signal })` as an async iterable of `{ type, payload }` envelopes. `type` routes the event and `payload` must be an unchanged CNC contract v2 object. Inject the implementation into `EpisodeWorker`; no API, database meaning, or lifecycle change is needed.

Run automated tests with:

```sh
npm test
```
