# JCST live observation, machine context and incident API

Implementation branch: integration/jcst-live-context. Parent commit:
3359d97a0b2bbef35b9d7ae02fe4200acaa7fb64 (origin/frontend-redesign).
The new commit adds the missing **read-side observation contract** described here.
It does not claim to recover an unavailable, uncommitted Python/UI implementation.
Use the resulting integration commit as the backend handoff; joint DTO review and
Frontend wiring remain separate acceptance work. Original main checkout is preserved.

## Consistent reads

Authenticated prefix: `/api/v1/research/demo/sessions/{id}`.

| GET | Result |
| --- | --- |
| `/observation` | Atomic read bundle: context, current machines, incidents, maintenance history |
| `/factory` | Versioned illustrative factory/line/layout/machine context |
| `/machines/M1` | Profile, assigned batch, current component/job state, session history, incident IDs |
| `/incidents?status=OPEN&machineId=M3` | Complete filtered primary-lane incidents |
| `/incidents/{incidentId}` | Physical timeline, corroborated decision and current machine state |

All reads contain `sessionId`, `revision`, `tick`, `lane=primary`. One authorized
session row supplies each result, with no Python inference or writes. Prefer the
observation bundle when multiple UI sections must share exactly one revision.
For separate endpoints, read a revision then pass `?expectedRevision=R` to each.
409 `DEMO_STALE` means discard the response group and reload; historical revision
retrieval is not supported. Unknown/repeated query parameters return 400. Tick is
a simulator time unit, not a minute or wall-clock timestamp.

ADMIN can read existing session scopes; other roles read only their own sessions.
VIEWER reads do not authorize commands. Missing/inaccessible sessions return
`DEMO_NOT_FOUND`; authorized unknown resources return `DEMO_MACHINE_NOT_FOUND` or
`DEMO_INCIDENT_NOT_FOUND`. Authentication and database errors retain existing
Research conventions. Demo reads/errors use `Cache-Control: no-store`.

```sh
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/research/demo/sessions/$SESSION_ID/observation"
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/research/demo/sessions/$SESSION_ID/machines/M3?expectedRevision=$REVISION"
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/research/demo/sessions/$SESSION_ID/incidents?status=OPEN&expectedRevision=$REVISION"
```

## Context and physical data

New sessions receive context version `jcst-factory-demo.v1`, origin
`ILLUSTRATIVE_DEMO`, in `DemoSession.contextJson`. The field is excluded from the
Python bridge input, policy observations, physical config and create request hash.
The database prevents changes, including silently backfilling legacy null rows.
Duplicate create keys replay the original session/context. Existing payload,
command and audit semantics are retained.

Context contains Line P1, M1 rough turning, M2 precision milling and M3 finishing /
inspection, the Pump housing product and DEMO-PH-001 batch. Quantity and dueAt
are null. Locations use `SCHEMATIC_GRID` integer x/y positions, not physical metres.
`M1/M2/M3` correspond to zero-based simulator indices `0/1/2`. Components are
`C1/C2`; `T1..T3` label simulator technicians, never user accounts. The generalist
configuration has a third technician without changing the three machine profiles.

Legacy sessions return `MISSING_LEGACY`, null contextVersion/origin/context and
null machine profile/batch. Their physical state and incidents remain readable.
GET does not update context, revision, audit, physical trace or command receipt.

## Projection and provenance

Incidents are derived from ordered `primary.records`, not Operations legacy tables.
Failure opens an incident. Its matching CM start makes it IN_SERVICE; matching CM
completion makes it RESOLVED. PM history is retained but never resolves CM.
`incident.status` and `machine.machineState` are independent: another component
may remain failed. Pending proposals never count as executed assignments.

An incident ID is `ji1_` plus base64url JSON containing `[sessionId,"primary",
failureRecordIndex,failureEventIndex]`. Detail lookup matches the entire ID against
the authorized session projection. Recurrence produces a new ID; reload and trace
append retain existing IDs. Incidents sort by failure record/event positions
descending, including events with the same tick; each timeline is chronological.
Physical event references carry record/event position, tick, machine/component and
technician/kind where present. A decision is linked only when its complete action
and tick match an actual start record. One decision can link to several machines.
No human review is fabricated when a trace has no matching decision record.

Machine maintenance history is **this session only**, including PM and CM. It is
not lifetime production history. The read projection rejects inconsistent event,
service, state or trace continuity as `DEMO_TRACE_INVALID` rather than inventing
events. At most 64 records, three machines and two components give a bound of 384
failures; lists are complete, never silently truncated and require no pagination.

## OpenAPI, examples and tests

`backend/research-openapi.yaml` contains all five routes and explicit DTO schemas.
Regenerate with `node scripts/export-jcst-observation-contract.js`; `--check` checks
drift. `docs/jcst-context-examples.json` is generated from pinned physics with seed
990000001 and an explicit legal PM/CM matching at t5: M3/C2 failure t5, CM active
at t6, CM completion t7, new M2/C2 failure t7. The example session UUID is clearly
illustrative. The matching is a test input, not learned-policy inference evidence.
Regenerate using explicit `JCST_PYTHON` and `node scripts/capture-jcst-context-examples.js`.
No confidence, root-cause, damage cost or deadline impact is inferred.

```sh
cd backend
npm ci
JCST_PYTHON=/path/to/python npm test -- --runInBand --testTimeout=30000
TEST_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:PORT/jcst_context_test \
JCST_PYTHON=/path/to/python \
OPERATIONS_SCHEMA_JOURNAL=/tmp/jcst-context-schemas.jsonl \
node tests/integration/run-integration-tests.js --jcst-context
```

Use a dedicated test database, not dev/production. The runner creates and drops
owned schemas. After interruption use `--cleanup` with the exact same explicit
test URL and journal. The upgrade test deploys migrations from exact parent SHA,
seeds a legacy session and audit, applies current migrations and compares their
original contents, hashes, command keys and revision. It drops its owned schema.
The additive migration does not rewrite canonical payloads or historical rows.
Rollback application code only after coordinating the Prisma client; keep the
nullable column and immutable context history. No down migration drops data.

Windows checkout must preserve the pinned vendor bytes; `.gitattributes` disables
line-ending conversion there. Source manifest hashes remain unchanged. Missing
registered checkpoints still fail explicitly in the existing learned-policy demo.
The command transaction regression uses a labelled fixture bridge which emits
real physical transitions; it tests create/retry/race/audit rollback, not learned
inference. Existing checkpoint-gated tests must not be counted when skipped.

UI click/reload acceptance with registered policy and final shared SHA remains
pending Frontend/Flex integration. This commit makes the backend reads and source
contract concrete; it does not label the complete joint feature VERIFIED_DONE.

## Local verification for the integration commit

- Broad backend unit run: 255 passed, four existing conditional skips (not counted).
- Final projection/OpenAPI unit run: five passed; AJV independently validates the
  generated response examples and rejects a string-valued revision.
- Final authenticated PostgreSQL run: six passed across two suites, including
  exact-parent populated upgrade, physical trace projection, create/command replay,
  concurrent commands and forced audit rollback; fresh migration passed.
- Historical migration check against parent, OpenAPI drift check and diff check passed.
- Owned schema journal is empty after successful cleanup. No dev DB was reset.
- No registered policy checkpoint or integrated UI acceptance is claimed by these tests.
