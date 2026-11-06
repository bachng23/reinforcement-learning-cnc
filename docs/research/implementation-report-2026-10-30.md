# JCST research migration — implementation and verification

Date: 30/10/2026, Asia/Taipei. Scope: the current working checkout of
`reinforcement-learning-cnc`, preserving the pre-existing tracked and untracked
work. No commit, push, deployment, scientific training or sealed TEST access.

## Delivered behavior

The default workspace is `/overview`, with Application first in navigation. Research is available at `/research`. It reads authenticated campaign/run
evidence, displays S/A/F learning curves and predeclared contrasts, and replays
component states, technician commitments, actions and physical events under
JCST/1.1. Case, arm, root and budget filters persist in the URL; primary inference
remains the original full-panel estimand.

Imports are queued, hash-checked and physically replayed before publication.
PostgreSQL holds additive research indices and immutable metadata; original
UTF-8 artifacts and complete traces are retained in a content-addressed store.
Execution status, local included-trace replay and source statistical reports
remain separate. Seeds stay exact decimal strings, including beyond uint64.

A separate fenced worker executes import, registered checkpoint inference and
simulation branches. Cancellation rejects late writes; retries create linked
attempts; failure preserves input and prior records. Review and cancellation
audit writes are transactional. Source episode, output and review history cannot
be overwritten through the new API, with supporting database constraints/triggers.

What-if produces both a baseline and an override from the selected before-action
state, with the same continuation controller and physical noise. It retains the
source recorded total separately. Both trajectories can be replayed; immutable
ACCEPT/REJECT reviews reference the exact output hash. No simulation is promoted
to a real maintenance completion or operations publication.

The pinned S/A/F adapter loads trusted registered weights with strict config,
source, catalogue, Torch and content-hash checks. It exposes CPU greedy inference
without fallback, action repair, optimization or retraining. The optional runtime
has an independent lock; Linux Torch comes from the official CPU index.

## Plan coverage

| Milestone | Implementation |
| --- | --- |
| M0 | Research direction and actual source capabilities documented; conflicting future RA-QMIX/FIFO plans marked historical |
| M1 | Independent JCST Pydantic/JSON Schema/generated TypeScript family, invariants and Research OpenAPI |
| M2 | Additive migration, artifact store, immutable import jobs, campaign/run/episode indices and owner/admin access |
| M3 | Campaign evidence/results pages, per-root sample/time curves, original intervals/gates and missing-data behavior |
| M4 | Complete before/after replay with independent state/action/noise/event/cost verification and fixed-risk H/tail |
| M5 | Reference controls and registered S/A/F inference; six actual checkpoints used for bounded parity tests |
| M6 | Matched simulation branches, trajectory replay and immutable management review; existing Operations domain preserved |
| M7 | Default research routing, production legacy-write flag, CI workflow, local/Compose packaging and runbooks |

The implementation deliberately uses typed immutable run metadata for
root/checkpoint/result projections rather than a separate SQL table for every
training root, checkpoint and evaluation cell. Original files are retained for
traceability. Collection status and audit claims are not inferred from HTTP
success or the presence of a chart.

## Verification evidence

Machine-readable [verification summary](verification-2026-10-30.json) includes
the source/schema/migration and screenshot hashes. Captured UI evidence:
[SE1 results](screenshots/se1-results-generalist.png) and
[component replay](screenshots/engineering-replay.png).

| Check | Result |
| --- | --- |
| AI service regression, including new contract/replay tests | **112 passed**, one optional Torch test module skipped in the regular environment |
| Isolated Torch inference tests | **7 passed**, including source parity for S/A/F × both cases and actual registered weights |
| Backend regression | **250 passed**, four pre-existing optional DB tests skipped in that command |
| Full dedicated PostgreSQL integration | **122 passed** in 11 suites; includes fresh/upgrade migration coverage and actual JCST import/branch/review/cancellation |
| Frontend regression | **203 passed** in 31 files |
| Frontend typecheck and optimized production build | **PASS** |
| Pinned source / schema / generated TypeScript drift | **PASS** |
| Real-browser Research acceptance | **2 passed**: engineering import/reload/replay/branch/review/legacy navigation; actual SE1 curves/filters and registered inference |
| Linux CPU inference vs local pinned runtime | **24 matching state results across six actual registered checkpoints** |
| Backend, frontend and optional inference Docker builds | **PASS** |
| Both controls-only and CPU-inference production-container stacks | **PASS**: migrations, cookie login via same-origin proxy, packaged bridge, shared artifacts, separate worker, independent replay, matched baseline and immutable review |
| Compose research profile and inference override configuration | **PASS** |

Tests used a separately created PostgreSQL instance and isolated schemas;
container smoke used its own network, volume, database and containers. Normal
test teardown removed the per-run schemas/container resources. Scientific data
were read from retained local SE1 files, never recollected.

The existing SE1 export includes **480 checkpoint rows, six primary contrasts and
six documentary traces** selected by a fixed rule (both cases, S/A/F, root 0,
96k, first physical episode). Original report/table/manifest/auditor artifacts
remain in the bundle. Hash linkage, source protocol and collected source hashes
were checked. The six included traces are replayed locally; the entire source
statistical audit is not claimed to have been rerun.

## Issues found and corrected during verification

- The planning commit reference did not contain the JCST source files. Runtime
  provenance instead uses the verified unchanged source publication
  `c577b6be26f40de5f539cee0bc1b99a3405e0f7e` and individual file hashes.
- Frontend container builds lacked shared contract/example/type fixtures outside
  its directory. The root build context now packages those required files.
- Linux's default Torch distribution pulled CUDA dependencies; the isolated lock
  now selects the same Torch release from the official CPU index on Linux.
- Rapid successive URL filter changes could overwrite earlier selections while
  router navigation was pending. Synchronous history updates preserve the whole
  selection; browser coverage checks reload and rapid changes.
- Branch cost initially used the recorded policy trajectory as its reference.
  The final implementation recomputes a matched continuation baseline, keeping
  recorded source cost separate, and independently audits both paths.

## Practical limits and follow-up boundary

The complete Work Order, Incident Center and Maintenance Analytics modules from
older task documents are not implemented in this checkout. This release's
management integration is the simulation review/audit projection. Production
jobs, routing, travel, spares, sensor ingestion, ERP/MES integration and arbitrary
physical-parameter sweeps remain separate work; they are not silently added to
the JCST physical contract.

SE1 has a concrete exporter; other studies can use the generic bundle contract
but need their own source-format projections before equivalent automated import.
The browser is a bounded evidence tool, not a launcher for full scientific
campaigns or a replacement for the research repository's statistical analysis.
Checkpoint/data files are local ignored artifacts; another installation needs
its own explicit verified bundles and registered releases.

Legacy v2/v3 data and deep links are preserved. Production v2 creation/execution
defaults to read-only; rollback flags restore presentation without dropping
research tables or deleting artifacts. See [runbook](runbook.md) and
[architecture](architecture.md) for setup, capability boundaries and recovery.
