# Running the JCST research platform

## Local startup

Use the existing PostgreSQL/auth setup in the root README. Apply committed
migrations with `npm --prefix backend run prisma:generate` and, from `backend`,
`npx prisma migrate deploy`. Preserve existing records. Do not use `db push`,
`migrate reset` or rewrite historical migrations.

Configure API and worker with the same `DATABASE_URL` and the same **absolute**
`RESEARCH_ARTIFACT_DIR`. The API also needs the existing `JWT_SECRET` and
`CLIENT_URL`. Start the API, frontend and research worker in separate terminals:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
npm --prefix backend run research:worker
```

Without `JCST_PYTHON`, the bridge uses `ai_services/.venv/bin/python` when present,
otherwise `python3`; Docker's controls-only image sets its installed validator
Python explicitly. Run from the repo root or set absolute artifact/runtime paths.

Create a fresh engineering bundle (the output path must not already exist):

```bash
ai_services/.venv/bin/python ai_services/scripts/export_jcst_bundle.py --output /tmp/jcst-engineering.json
```

Sign in as ADMIN/ENGINEER, open `/research/import`, upload the JSON and follow the
job. Imports are asynchronous. If no worker is running, the job stays QUEUED.
View the campaign, original artifacts, audit scope and included episode replay.
What-if requires a reason and a legal matching before the controlled interval.
It produces a separate override and a matched baseline from the same boundary,
using the same continuation control and physical noise. Review records only
acceptance/rejection of that simulation, not execution on equipment.

## Importing existing SE1 evidence

The exporter reads explicitly supplied files; it never launches the old campaign.
Supply an existing source checkout, completed SE1 run, its analysis report and
both auditor reports:

```bash
ai_services/.venv/bin/python ai_services/scripts/export_jcst_bundle.py \
  --source-repo /path/to/maintenance-capacity-coordination \
  --se1-run /path/to/existing/se1-run \
  --analysis /path/to/existing/se1-run/analysis/report.json \
  --physical-audit /path/to/existing/se1-run/audit/report.json \
  --stats-audit /path/to/existing/se1-run/stats-audit/report.json \
  --output /path/to/new/se1.bundle.json
```

It verifies protocol/report linkage, preserves original source artifacts, projects
the 480 greedy checkpoint rows and six primary contrasts, and includes a fixed
six-episode documentary subset (both cases × S/A/F, root 0, 96k, first physical
episode). States reconstructed from recorded actions are checked against source
cost/final state and independently replayed. This is not a new performance run or
local re-audit of all source campaign statistics. No TEST data is read.

An exported SE1 bundle used during this implementation is retained locally at
`artifacts/research-bundles/se1.bundle.json` when those source artifacts are
available. `artifacts/` is ignored by Git; the platform never uploads it on setup.

## Optional learned inference

```bash
uv sync --frozen --project jcst_runtime
```

Register each trusted checkpoint with the expected hash from its original
checkpoint metadata. This copies its exact bytes into the registry directory,
but does not run inference or select a scientifically preferred root/checkpoint:

```bash
ai_services/.venv/bin/python ai_services/scripts/register_jcst_checkpoint.py \
  --checkpoint /path/to/checkpoint-96000.pt \
  --expected-sha256 ORIGINAL_SHA256 \
  --arm A --case base --release-id se1-base-A-root0-96k \
  --registry /absolute/path/to/artifacts/research-releases/registry.json
```

Set `JCST_PYTHON` to the isolated `jcst_runtime/.venv/bin/python` and
`JCST_RELEASE_REGISTRY` to that registry for API and worker, then restart both.
The replay screen lists compatible installed releases. Config, source, Torch,
catalogue ordering and checkpoint hashes are checked again during the job. The
current API exposes greedy inference; other modes require a versioned extension.
Missing or incompatible releases fail explicitly without fallback or retraining.

## Docker profiles

The default Compose services remain available. For the research stack, set the
existing PostgreSQL variables and `JWT_SECRET` in the deployment environment.
First build the images and explicitly apply migrations/seed authentication using
the backend image; do not start workers against an unmigrated database.

```bash
docker compose --profile research build
docker compose up -d postgre_db
docker compose --profile research run --rm research_api npx prisma migrate deploy
docker compose --profile research run --rm research_api npm run prisma:seed
docker compose --profile research up -d
```

The frontend uses a same-origin API proxy; artifacts share a persistent volume.
The default images support import/replay/reference-control branches. The Linux
inference lock uses the official PyTorch CPU index; it does not install CUDA. For registered
learned policies, place the portable registry/checkpoints under
`artifacts/research-releases/` and add
`-f docker-compose.research-inference.yml` to Compose commands; that override
builds the isolated runtime for API/worker and mounts releases read-only. Docker
builds require the pinned packages to be available for the deployment platform.

## Verification

```bash
ai_services/.venv/bin/python scripts/check-jcst-contracts.py
ai_services/.venv/bin/python -m pytest ai_services/tests -q
jcst_runtime/.venv/bin/python -m pytest ai_services/tests/test_jcst_inference.py -q
npm --prefix backend test -- --runInBand
npm --prefix frontend test
npm --prefix frontend run build
```

For backend compatibility tests on machines without `python`, set
`OPERATIONS_PYTHON` to `ai_services/.venv/bin/python` by absolute path.

Set `TEST_DATABASE_URL` explicitly to a dedicated database ending in `_test` or
`_ci`; never use production/development data:

```bash
npm --prefix backend run test:integration
npm --prefix frontend run test:research:e2e
```

The integration runner and browser fixture create their own schemas and remove
them on normal termination. Browser screenshots/traces go to frontend test-results.
Production images can be verified with `node scripts/check-research-containers.js`
after building `cnc-jcst-backend:test` and `cnc-jcst-frontend:test`. The smoke creates
and removes its own Docker network, database, containers and artifact volume.

The optional existing-SE1 browser test requires `JCST_E2E_SE1_BUNDLE`; actual
checkpoint parity additionally accepts `JCST_TEST_RELEASE_REGISTRY`. Their absence
causes explicit skips rather than generating replacement scientific artifacts.

## Backup, failure and rollback

Back up PostgreSQL, the content-addressed artifact directory and any registered
checkpoint volume together. Restore into a separate environment, verify hashes,
then run included-trace replay and API read checks. DB metadata alone cannot
restore missing artifact bytes. No API exposes deletion of imported history.

Workers fence all writes by lease/token/status. Expired jobs become FAILED and
are not automatically replayed. Retry creates a new job linked to the prior
frozen input; failed/cancelled attempts remain visible. Staged/orphaned content
may remain after failure and is not published as a completed run. Cancellation
prevents late output publication and terminates owned child computation.

To roll back presentation, set `NEXT_PUBLIC_RESEARCH_ENABLED=false` and rebuild
the frontend. Set `RESEARCH_API_ENABLED=false` to stop the new API and stop the
research worker gracefully. Production legacy writes require the explicit
`LEGACY_RESEARCH_WRITE_ENABLED=true` flag; reads are preserved. Keep additive
schema/data/artifact files. Do not drop research tables to roll back routing.
