# Technician availability — runtime M0

Base main: `72af5ecda40833e3c9aaa68f6977f08937fa5814` (2026-11-19).
Runtime branch: `backend/jcst-technician-availability`.
Backend inspected: `145edb0ce73eddee3bfa881ac26730781c1d5d1f`.
Frontend inspected: `42521ad0c923f6b97555f390451bccaef2cbd73b`.
Status: approved by the user on 2026-11-19: Backend protocol plus action mask.

## Protocol and ownership

Adopt Backend's `jcst-technicians/1` protocol: `demo_technician_change`,
`demo_technician_command`, `demo_technician_restore`, `demo_technician_incident`.
Add a read-only summary callable for tools; Backend owns the HTTP envelope,
revision, permissions, receipts, IDs and persistent metadata transaction.
Use its exact `technicianAvailability` schema version
`jcst-technician-availability/1`: version, absences, events, origin.
Start/early-return events have USER actor; preallocated automatic end IDs have
SYSTEM actor and reason `Absence interval elapsed`. No independently generated
runtime IDs. Early return preserves planned returnTick and records endedTick.

Backend routes are GET `/sessions/:id/technicians`, POST
`/sessions/:id/technicians/:index/absence` and `/return`, under research/demo.
Duration 1..100000; absolute tick <=2147483647; indexes derive from config/jobs.
Public dynamic responses carry sessionId/revision/tick/stepSeconds.

## Catalogue and inference

Engineering catalogue filters existing complete physical legal actions, retaining
only matchings whose technicians are not absent. WAIT remains legal. Both lanes
use the same absolute calendar, while occupancy stays lane-specific. BUSY takes
precedence over ABSENT in summaries; no dummy jobs or duration/config mutation.
Canonical physical validation and calendar validation both run before dispatch.
Pending alternatives, proposal and override share the same catalogue.

Approved learned-policy adaptation: preserve encoder arrays, flat features,
checkpoint shapes, action universe ordering, source hashes and all weights.
Intersect the original physics mask with the availability mask before greedy
argmax. Both technician and flat job-idle bits remain unchanged: they describe
physical occupancy, not a new learned absence signal. The model cannot reason
about remaining absence duration; this is a constrained engineering adapter,
not evidence for paper training/evaluation or a newly trained policy.

Heuristics receive the existing observation with filtered actions. Prove empty
calendar parity for every heuristic and S/A/F; use real registered checkpoints
when supplied, and label any synthetic shape/mask test separately.

## Boundary ordering and invalidation

1. At a boundary, finish preceding physics interval before returning its state.
2. Close all due absences exactly once using preallocated event IDs, in stable
   tick/order sequence; automatic expiry does not increment workforce version.
3. Apply due injected failures under the existing incident contract.
4. Observe/filter/choose using the resulting calendar and physical state.

User start/early return is zero-time, clears pending and all known workforce
deferral fields, sets RUNNING and playbackPaused=true. Metadata version advances
once per user event; Backend increments revision once. Primary busy starts
conflict. Baseline busy jobs finish normally, but no new absent-worker assignment
is allowed. At exact returnTick a worker can dispatch immediately.

Snapshot keeps the full calendar, events, IDs, origin and absolute ticks. Legacy
missing metadata means an empty calendar and must preserve existing outputs.
Audit validates engineering catalogue separately from independent physical
transition replay. Busy counters remain actual occupancy only.

## Replay, comparison and cache

Every policy comparison must start from the same complete frozen physical state
and calendar, not two already-diverged lane states. Backend comparisonContext
hashes calendar/version plus session/revision/tick/source/releases/policies/branch.
Frontend must honor requiresCommonSnapshot after workforce changes. The base
contains no backend/src/research/live-comparison.js; inspect existing frontend
comparison adapter before enabling cross-policy replay. Never silently discard
availability for a finite scientific replay: either consume it explicitly or
return DEMO_INTERVENTION_REPLAY_UNSUPPORTED, documenting remaining support.

## Acceptance plan

Real base/990000001 heuristic fixtures: healthy start, T1 absent [0,3), both absent,
failure with only T2 eligible, busy primary rejection, baseline job completion
inside interval, early return at REVIEW, expiry/completion same tick, duration 1,
duplicate/invalid metadata and exact snapshot replay. Compare step/autoplay and
event IDs after reload. Explain blocked repairs from absent/busy/skill state.

M1 supplies callable bridge, unit/inference parity tests and deterministic fixtures.
M2 integrates the exact partner commits with isolated PostgreSQL, authenticated
real API, real runtime and Chromium. Record SHA, policies, seed/ticks, logs and
cleanup. Doubles, checkpoint skips and spec-only artifacts are not acceptance.
