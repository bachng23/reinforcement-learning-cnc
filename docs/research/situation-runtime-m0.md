# Situation runtime — M0 proposal

Base main: `30a27f820e511567f7fad8199f123f75646cd9f3`.
Runtime branch: `backend/jcst-snapshot-runtime`.
Consumer inspected: Backend `feat/jcst-snapshots-incidents` at be8b299 and
Frontend `frontend/simulation-situations-incidents` (remote snapshot 2026-11-16).
Status: approved by the user on 2026-11-16; implementation follows this agreement.

## Adopt the existing Backend protocol

Use `protocol: jcst-situations/1` with `demo_snapshot_restore`, `demo_incident`,
and `demo_situation_command`. Add `demo_snapshot` as the export callable for
runtime fixtures/tools; persistence remains Backend-owned. Avoid introducing
alternative names that require changing the existing Node adapter.

Snapshot wrapper: `{schemaVersion: "jcst-demo-snapshot/1", runtime, context,
workOrders, provenance}`. Runtime is the complete JSON session, including both
lanes, state/jobs, records, cumulative counters, seed, policy/releases/source,
simulation_start/step_seconds, activation/mode/continuous, pending proposal,
workflow/decisions, any review deferral, incident queue and branch provenance.
Restore deep-copies and validates without choosing a policy or advancing time.
It returns runtime unchanged. Backend verifies snapshotHash, creates a new ID,
rebases work-order identity and sets playbackPaused=true. No hidden reset.

## Boundary ordering

1. Apply eligible scheduled events at the current boundary before prepare/choose.
2. Resolve assignments only against that post-intervention state.
3. Execute the existing physics transition for both lanes unchanged.
4. Apply incidents at the arrived boundary after service completion and before
   returning a response or beginning the next autoplay interval.

Process same-boundary events in persisted insertion order. For the same target
and tick, reject a second schedule; two different components on one machine are
evaluated in order, so the second skips after the first failure. Apply at most
once. Immediate incident at REVIEW conflicts. A malformed/legacy queued incident
due at an already prepared REVIEW also conflicts before mutation; do not silently
postpone or execute an approved matching from an obsolete observation.

Skip precedence matches Backend: MACHINE_IN_SERVICE, then
COMPONENT_ALREADY_FAILED (any failed component on that machine). APPLIED and
SKIPPED both record appliedTick=scheduledTick; only APPLIED flips the target
failed flag. Ages, jobs, baseline, seed, natural uniforms and records do not change.
Applied incidents activate the primary policy and invalidate stale deferral state.

## Evidence and counters

Use Backend's exact incident DTO; it does not permit an extra source field.
Expose source=INJECTED in a separate engineering evidence adapter, using the
incident UUID, never a fabricated natural transition or uniform. Existing Backend
health uses provenance=CONTROLLED_INCIDENT; these refer to the same event.
Keep primary.failures as the natural PHYSICS count to satisfy the Node adapter
and preserve scientific cost semantics. Derive `{physics,injected,total}` from
that counter plus APPLIED incident entries; expose this breakdown as additional
bridge result metadata, not a mutated physical lane counter. Skipped/scheduled
incidents do not increase total. No synthetic failure cost is charged at injection.

## Replay and Compare boundary

Full snapshot continuation supports engineering interventions. Validate physical
transitions independently per interval, accounting for interventions between
intervals rather than falsifying the scientific Episode format.
Finite scientific replay/branch export of an intervention session returns
DEMO_INTERVENTION_REPLAY_UNSUPPORTED. No live-comparison.js exists on this base.
Cross-policy Compare through interventions stays disabled until Backend agrees
on same post-intervention initial state and queue coupling for both branches.
Do not present the unchanged baseline lane as a fair post-intervention comparison.

## Errors and delivery

Structured protocol errors use existing Backend-supported codes:
DEMO_RELEASE_UNAVAILABLE, DEMO_SNAPSHOT_INCOMPATIBLE,
DEMO_INTERVENTION_REPLAY_UNSUPPORTED and DEMO_REVIEW_REQUIRED.
Backend owns HTTP authorization, revision, receipt and input-validation codes.
Runtime validates independently and returns bounded errors, not filesystem paths.

M1: real-runtime unit tests, exact replay and boundary fixtures/harness. No vendor
physics changes or new planner. M2: integrate Backend + Frontend in an isolated
checkout and run authenticated PostgreSQL/API/browser evidence. Mocks are not
integration evidence. Record actual SHAs and remaining cross-team defects.
