# CNC Research Platform Backend

## Episode worker and fake engine

The worker polls existing `PENDING` episodes, atomically changes one to `RUNNING`, invokes an engine through the `EngineRunner` boundary, validates CNC contract v2 events, and commits all step records plus the episode summary in one transaction. Week 1 uses deterministic fixture data from `FakeEngineRunner`; it is explicitly marked with `fixture: true` and is not a scientific simulation.

Configure `DATABASE_URL`, generate the Prisma client, and run the API and worker in separate terminals:

```sh
npm run prisma:generate
npm start
npm run worker
```

Optional worker settings are `WORKER_POLL_MS` (default `1000`), `ENGINE_TIMEOUT_MS` (default `30000`), and `WORKER_STALE_MS` (default `120000`). On startup, stale `RUNNING` episodes are returned to `PENDING`. Before a claimed retry starts, prior observations and their cascading child records are removed, preventing mixed executions. Event upserts and database uniqueness constraints make repeated delivery safe. A completed status is written only inside the same transaction as all event records; failures are marked `FAILED` and an internal code/message is stored in `AuditLog`.

Worker logs are newline-delimited JSON and include experiment, episode, engine version, and simulation step where applicable. The in-process health snapshot records polling, completion, and error timestamps. Stop the worker gracefully with `SIGINT` or `SIGTERM`.

Replace the fake engine later by implementing `EngineRunner.execute(request, { signal })` as an async iterable of CNC contract v2 events and injecting it into `EpisodeWorker`; no API, database meaning, or lifecycle change is needed.

Run automated tests with:

```sh
npm test
```
