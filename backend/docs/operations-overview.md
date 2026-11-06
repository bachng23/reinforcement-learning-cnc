# Operations overview

Contract-first additive HTTP extension on main 64dc391. Domain schema remains 3.0.
Source: `backend/openapi.yaml`; examples: `backend/examples/operations-overview.json`.
Examples are contract illustrations, not claims that those UUIDs exist in your database.

```sh
curl -i -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/operations/overview?factory_id=$FACTORY_ID"
```

Only one factory_id is accepted; extra/repeated parameters return 400. Active
ADMIN users or explicitly factory-granted users (including VIEWER) may read.
Missing/inaccessible factory or no current snapshot head returns the same 404.
Errors use canonical Operations ErrorResponse, never empty success. All responses
are no-store. 401 authentication; 403 permission; 500 integrity/internal;
503 database/validator/access-configuration unavailable. No private diagnostics.

## Count definitions

| Field | Population and meaning |
| --- | --- |
| machines.total | Number of machines in validated current snapshot |
| machines.by_status | All six canonical statuses, including zero buckets; sum equals total |
| cases.LIVE.total | All persisted LIVE cases for the factory, including stale and terminal |
| cases.SIMULATION_ONLY.total | Same scope for SIMULATION_ONLY |
| each mode.by_status | All twelve canonical lifecycle buckets, sum equals mode total |
| each mode.by_processing | PENDING/RUNNING/SUCCEEDED/FAILED, sum equals mode total |
| LIVE.by_status.AWAITING_APPROVAL | Needs review, including stale; not permission to APPROVE |
| LIVE.by_status.APPROVED | Approved but unpublished |
| each mode.by_processing.FAILED | Processing errors; independent of lifecycle FAILED and HTTP failures |
| each mode PENDING + RUNNING | In-progress cases for that mode, not agents; persisted states, even if lifecycle terminal |

Lifecycle and processing overlap; never add the two dimensions. No stale-active
metric is returned. Terminal stale cases count in their terminal buckets, not
in awaiting-approval or approved buckets. Preview contains LIVE/AWAITING_APPROVAL,
including stale, sorted created_at DESC / UUID DESC, at most six. has_more means
additional matches at this read snapshot. Use returned filters with the case-list
endpoint for pagination; that later request observes a new snapshot. Items use the
existing sanitized list DTO, with real case UUIDs, recommendation identity,
basis/head tokens and immutable human/publication summaries; no notes/artifacts.

## Provenance and consistency

One RepeatableRead transaction selects head, immutable snapshot/publication,
SQL aggregate buckets and preview. Validation happens after the transaction using
those immutable rows. read_at records acquisition of the database read snapshot,
not telemetry freshness or a concurrency token. Head revision does not fence
worker/case changes. Snapshot captured_at/observed_at is observation time.
Machine coverage is covered/population machines from that snapshot, not coverage
of every physical machine in the factory or health measurements. The canonical snapshot requires at least one machine. Cases cover all stored factory cases.

No health aggregate, risk, utilization, agent count or history is supplied.
Missing health is unknown and causes no invented zero/healthy value. The
unpublished_missing_health example intentionally has no health metric.
publication=null means no published schedule. plan_version describes published
head independently of current observation: S2 can coexist with P1 based on S1.
No GET rebases or writes cases, heads, schedules, audit events or receipts.

## Verification

[Executed verification at implementation SHA 9e172fe](evidence/operations-overview-9e172fe.md)
includes real authenticated curl, PostgreSQL concurrency and regression evidence.
Existing factory/created_at/id index supports preview;
no migration is proposed. Aggregation is scoped in PostgreSQL and loads only
bounded status/processing groups, not case artifacts.
