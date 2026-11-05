# Scenario engine — joint M0 proposal

Status: APPROVED FOR IMPLEMENTATION by the user on 2026-10-28. Implementation and
joint integration acceptance remain pending. Prepared against main
`c926d5d24566834850cf4a16af0792af9c7d50fd` and Backend PR #56 head
`397246f` (updated after the initial `9214371` proposal). This is a review artifact, not
evidence that Scenario evaluation or the joint product is complete.

Implementation update (2026-10-28): the user subsequently expanded ownership to
include the missing Backend worker/job and joint Frontend integration. Backend
#56 and Frontend #57 are merged into this working branch. The engine DTO/schema,
worker, result persistence, compare/sensitivity routes and typed LIVE defer
extension are implemented. See `scenario-engine-runbook.md` for the executable
flow and acceptance procedure. The sections below preserve the approved design
and original dependency findings; current validation evidence is recorded by the
runbook's scripts, not inferred from this proposal.

Flex owns the Python transform/evaluation/ranking/sensitivity boundary. Backend
owns persisted workspaces/jobs/attempts, authorization, fencing and HTTP product
APIs. Frontend owns the workspace UI. No outgoing coordination messages have been
sent. The user approved this proposal with “chốt proposal”; Backend/Frontend
consumer updates must still be integrated and tested against the generated schema.

## Approved decisions

1. Freeze the versioned engine boundary and bounds below. Retain Backend's three
   override shapes and status enums; require **integer maintenance minutes** and
   use the canonical lower-case **strategy IDs**, with upper-case strategy enums
   only in results. Reject unknown names rather than silently selecting fewer.
2. Use Scenario-only common random draws and versioned ranking explanations.
   Preserve existing LIVE sampling and `/v1/operations/plan` behavior.
3. Coordinate the additive typed LIVE defer extension below, or explicitly defer
   its delivery with `LIVE_MAPPING_UNSUPPORTED`. No generic WHAT_IF assumptions
   or snapshot writes may substitute for an approved LIVE representation.
4. Add the versioned `scenario-strict:1` constraint profile to the existing
   scheduler/validator, without a competing validator or silently changing legacy
   LIVE semantics. The base validator does not currently enforce all required
   invariants; see the reproducible readiness findings below. The approved typed
   LIVE extension must explicitly opt into the reviewed relevant constraints too.

## Internal transport and ownership

Proposed internal routes (configured server-side, not a caller-provided URL):

| Route | Result | Consumer |
| --- | --- | --- |
| POST `/v1/scenarios/evaluate` | baseline + scenario + comparison | Backend RUN worker |
| POST `/v1/scenarios/sensitivity` | ordered point outcomes + sampled intervals | Backend SENSITIVITY worker |
| POST `/v1/scenarios/compare` | bounded raw-KPI comparisons | Backend authorized compare service |

Callable methods expose the same DTOs. This does not create a Node worker or an
application database in the engine. Backend calls outside DB transactions and
persists the frozen request, full result and accepted attempt under its lease.
Forward X-Request-Id and X-Correlation-Id, but exclude them from semantic hashes,
randomness and deterministic results. Lease tokens never become engine inputs.

The contract namespace is `scenario-engine:1.0`, independent of canonical v3.
Reuse canonical `FactorySnapshot`, `CandidatePlan`, `PlanningConfig` and
`ConstraintViolation` definitions by reference. Generate JSON Schema and example
artifacts from Python after approval; Backend must consume those exact artifacts
and validate responses before persistence. Do not maintain hand-written divergent
result schemas. `additionalProperties: false` on all engine-owned objects.

### Evaluation request

```
contract_version: "scenario-engine:1.0"
operation: "EVALUATE"
identity: {factory_id, workspace_id, run_id, frozen_input_hash}
baseline: {snapshot: FactorySnapshot, snapshot_hash, publication: null | PublicationIdentity}
planning_config: ScenarioPlanningConfig
overrides: Override[0..5]
sampling: {version: "scenario-crn:1", base_seed, sample_count, coupling: "COMMON_RANDOM_NUMBERS"}
budget: {remaining_ms: integer[1..300000]}
```

Publication identity is schedule_id/revision/hash/plan_version, supplied and
verified by Backend; it is reference context only. Engine validates matching
factory/snapshot scope and never treats a reference publication as a feasible
scenario plan. A baseline is actually planned with no overrides, using exactly
the scenario's objectives/config/model/sampling. With no overrides, baseline and
scenario outputs are equal; reuse that evaluated result instead of randomizing.

`ScenarioPlanningConfig` narrows existing canonical constraints: horizon 1..43200
integer minutes; candidate_limit 1..3; solver_timeout_seconds 1..30; draws 1..1000;
seed 0..2147483647. Sampling base_seed/sample_count must equal config base_seed/simulation_runs.
All five weights must be finite numbers in [0,1000000], sum > 1e-12.
Strategy IDs: `production-priority`, `balanced`, `reliability-priority`; 1..3 unique
explicit IDs. Deterministic traversal uses the engine's canonical strategy order.
For v1, horizon must equal the pinned snapshot planning-window length; reject a
mismatch instead of accepting the current planner's effectively ignored horizon.
Changing the analysis window requires a separately reviewed transform.

### Overrides and effective input

Keep Backend PR #56 discriminated names/fields:

- TECHNICIAN_UNAVAILABLE: technician_id, start_at, end_at. Subtract a nonempty
  half-open interval contained in the planning window from that Technician's
  availability; split windows if necessary. Preserve user access, skills and
  technician status. An empty resulting availability is meaningful, not fallback.
- MAINTENANCE_DURATION: maintenance_request_id, expected_duration_minutes.
  **Integer [1,43200]**; no rounding, string coercion, Infinity or NaN. A value
  longer than a feasible resource slot is a valid physical assumption which can
  produce NO_FEASIBLE_PLAN, not invented baseline KPIs.
- DEFER_MAINTENANCE: maintenance_request_id, earliest_start_at. Must be inside the
  planning window and not earlier than the original lower bound. Preserve the
  original latest-start bound, priority, mandatory flag and skills.

Reject unknown/terminal targets and repeated type+target. Canonically sort
overrides by type+target. Report contradictory earliest/latest bounds explicitly;
never widen latest_start_at to make a deferred request feasible. Keep locked,
running and completed assignments unchanged. Conflicting immutable reservations
produce a constraint diagnostic; never silently remove them.

Deep clone the snapshot. Validate the transformed canonical snapshot and validate
each output candidate against it, using the existing authoritative validator.
Input structure/reference errors are 422. A valid physical assumption with no
feasible constrained schedule is a completed NO_FEASIBLE_PLAN outcome. Diagnostic
objects carry code, target references, field/window and computed evidence. For a
cross-field contradiction that cannot instantiate canonical MaintenanceRequest,
return the specific INPUT_CONSTRAINT_CONFLICT domain diagnostic with null effective
snapshot, while retaining the attempted diff; do not bypass Pydantic validation.

Output includes source snapshot hash, canonical overrides, effective snapshot or
null with reason, effective diff (target, field, before, after), effective hash,
and transform version. No registration as an Operations snapshot or head.

Hash domains are distinct: Backend frozen_input_hash is echoed for fencing;
existing Operations snapshot_hash retains its existing convention; Scenario
semantic/effective/reference hashes use **RFC8785 + SHA256**, versioned
`scenario-jcs-sha256:1`. Add shared Node/Python vectors before freeze. Exclude
run/workspace/case/candidate/schedule/request IDs and budget/attempt timestamps from
semantic identity; include baseline content, normalized overrides, config and
all engine/validator/model/sampling versions. Domain source IDs remain meaningful.
Normalize timestamps to UTC milliseconds before scenario hashing, matching Node
producer precision. Reject finer precision at the new boundary rather than
silently changing the pinned source. Preserve source bytes/hash separately.

### Evaluation result

```
contract_version, identity (exact echo), versions, semantic_input_hash
sampling (complete specification and coupling key)
effective: {source_hash, snapshot?, diff[], hash?, transform_version, diagnostic?}
baseline: Evaluation
scenario: Evaluation
comparison: Comparison
live_mapping: {supported, mapped_weights?, mapped_defer_bounds[], reasons[]}
```

Evaluation contains outcome FEASIBLE or NO_FEASIBLE_PLAN, 0..3 validated canonical
candidates, selected_candidate_id or null, ranking or null, and diagnostics.
No INVALID candidate is returned as usable. Preserve explicit reasons for a
strategy which cannot generate a valid plan. `partial`/deadline metadata must say
when a result contains only candidates completed before the budget expired.
If no candidate completed before deadline, report TIMEOUT instead of infeasible.

## Ranking and comparison

Reuse ObjectiveScorer's formula, normalization and tie-break; refactor it to expose
calculation evidence rather than implement another scoring formula in Node/UI.
Reference version `objective-minmax:1` binds candidate semantic signatures, metric
min/max, constant-range rule, group aggregations and tie-break order. Constant
metrics have benefit 1, as today. Score is rounded to 12 decimals, then ties use
PRODUCTION_PRIORITY, BALANCED, RELIABILITY_PRIORITY, then stable candidate identity.

Each ranked candidate exposes raw KPIs; normalized metric benefits; the group
averages; supplied and normalized weights; weighted contributions; total score;
tie-break evidence; and normalization_reference_id. Scores are relative only to
that reference. Comparison returns no cross-reference score delta. Common-reference
reranking is not implicit: a future explicitly requested operation must return
the union reference and newly computed scores separately from original scores.

Metric registry `scenario-metrics:1`:

| KPI | Unit | Preferred direction | Score group |
| --- | --- | --- | --- |
| makespan_minutes | minute | lower | production |
| total_tardiness_minutes | minute | lower | production |
| maximum_tardiness_minutes | minute | lower | comparison only |
| on_time_completion_rate | ratio | higher | production |
| expected_failure_count | expected count | lower | reliability |
| failure_probability | probability | lower | comparison only |
| expected_emergency_downtime_minutes | minute | lower | reliability |
| maintenance_cost | model cost unit, not currency | lower | maintenance |
| technician_utilization | ratio | lower under current objective | workforce |
| schedule_changes | count | lower | schedule_stability |
| decision_latency_ms | millisecond | lower | operational telemetry, excluded |

Comparison supports baseline plus up to three scenarios in one workspace and
same pinned source. Echo differing config/weights/overrides/model versions. Return
absolute delta `scenario-baseline`; percent delta `100*delta/abs(baseline)` only
when baseline is nonzero. Missing/null/unsupported metrics produce null + explicit
reason, never zero fill. Infeasible candidates have no synthetic KPI object.
Explanations cite computed deltas/constraint diagnostics and the model registry,
not a template claiming that a plan improves reliability or cost.

## Sampling and sensitivity

Sampling version `scenario-crn:1`: fixed seed + observation identity + draw index
determine a uniform draw using SHA256's first 53 bits divided by 2^53. Domain
separation and tuple serialization are fixed in golden vectors. Observation key
uses the pinned health_snapshot_id, machine_id and observed_at; it excludes case,
schedule, candidate, run, workspace and attempt IDs, parameter values and makespan.
Baseline, all strategies and physical sweep points share draws. Changing duration
may change the downtime cap but cannot change the underlying random samples.
Do not reorder observations into different RNG positions. Expose seed, algorithm,
draw count, observation-set hash and coupling key. The existing simulator consumes
this optional draw provider only for Scenario; LIVE keeps its current sampler.

Retain the current simplified simulator: per-observation failure probability,
70% risk reduction on maintained machines and horizon-capped downtime. Label these
as model assumptions, not calibrated physics or sensor facts. No confidence interval
or rank-confidence probability is invented from these draws.

Sensitivity request reuses the frozen evaluation input and adds axis, source-run
identity and optional engine-produced source evaluation for weight-only reranking.
Backend verifies the saved source; engine validates its identity/hash/candidates.
Axis matches PR #56: MAINTENANCE_DURATION(target, 1..7 unique integer values), or
OBJECTIVE_WEIGHT(one of five names, 1..7 unique bounded finite values). V1 does not
sweep timestamps. Return values in numeric order and preserve original request
order metadata. Include baseline_value and a separate baseline_point even when
it is not a requested value; the no-overrides evaluation is shared, not replanned
at every point. Maximum seven requested points, at most one shared baseline.

Physical points re-transform, plan and validate each value. Weight-only points
must reuse the exact saved candidate schedules/KPIs/reference and change only the
named raw weight, then normalize all weights for that point. Reject an all-zero
point before enqueue; do not call planner or simulator for weight-only points.

Each point: value, input_hash, status FEASIBLE/NO_FEASIBLE_PLAN/FAILED/TIMEOUT,
candidate_availability, selected strategy, KPIs/ranking or null, diagnostics.
Aggregate COMPLETE means all points evaluated (including infeasible); failures
with any completed point yield PARTIAL_FAILED, otherwise FAILED. Cancellation is
a retryable transport outcome for the owning job attempt, not a completed point.
Unstarted points at deadline are explicit TIMEOUT/NOT_STARTED_BEFORE_DEADLINE.
Rank-change intervals use adjacent feasible sampled values only; never bridge
failed/infeasible points, claim exact thresholds or claim global optimality.

Engine checks a monotonic deadline and cancellation before strategies, during
scheduler loops and simulation batches, and between points. It cannot extend the
remaining job budget. A bounded subprocess per HTTP evaluation allows terminating
disconnected/cancelled work without leaving FastAPI's event loop blocked. Backend
retains total attempt/job deadlines; transport allowance never extends computation.

## Errors and LIVE mapping

Versioned 422: INVALID_SCENARIO_INPUT, UNSUPPORTED_OVERRIDE, UNKNOWN_TARGET,
INVALID_WINDOW, UNSUPPORTED_STRATEGY, INPUT_HASH_MISMATCH, VERSION_MISMATCH.
504: ENGINE_TIMEOUT. 503: ENGINE_UNAVAILABLE. 500: ENGINE_FAILURE with safe details.
NO_FEASIBLE_PLAN is a typed successful evaluation, not a retryable transport error.
Echo correlation/request IDs in headers; never expose raw tracebacks or credentials.

At the base, objective weights map safely to a fresh LIVE MANUAL_REPLAN request.
Technician and duration overrides remain unsupported for promotion; ingestion of
real authorized facts is separate. DEFER currently has no safe LIVE representation.

Proposed additive extension for joint Backend/Flex review:
`ManualReplanTrigger.maintenance_start_constraints` is an optional bounded list
of `{maintenance_request_id, earliest_start_at}` (default empty). Extend both the
public RunDecisionCaseRequest trigger and Backend's product case-request schema,
preserve the field when constructing worker requests, and enforce it through the
same clone/validate transform. Stored canonical snapshot stays unchanged. Empty
extension preserves legacy output/seed behavior. Source/current-head checks remain
Backend-owned. Do not ship this extension until canonical export, Node producer,
Python consumer, HTTP artifacts and LIVE regression tests are updated together.

Until approved/integrated, echo `LIVE_MAPPING_UNSUPPORTED` for defer; never report
the required joint handoff acceptance as passed. Scenario evaluation itself remains
independent of this handoff gate.

## Mapping the actual Backend frozen input at 397246f

The Backend implementation now persists frozen input before engine execution.
It has no engine client/worker or result validator yet. This does not constitute
joint contract approval. A transport adapter can wrap the frozen input without
rewriting it, refreezing a draft, or recalculating the stored receipt hash:

| Stored field / lease context | Engine field | Validation |
| --- | --- | --- |
| input.contract_version | contract_version | exact supported version |
| input.engine_version | expected engine version | exact advertised capability |
| input.factory_id/workspace_id | identity.factory_id/workspace_id | exact echo |
| job.id / job.input_hash | identity.run_id/frozen_input_hash | exact echo, no rehash of wrapped DTO |
| input.factory_snapshot | baseline.snapshot | canonical validation and factory/snapshot match |
| input.baseline.snapshot_hash | baseline.snapshot_hash | Backend verifies existing Operations hash |
| input.baseline schedule identity | baseline.publication identity | all present or all absent |
| input.reference_publication | separate optional reference Schedule | matches frozen identity; never computed baseline |
| input.planning_config | planning_config | no silent horizon/strategy coercion |
| input.overrides | overrides | strict typed validation and canonical sorting |
| input.sampling.version/base_seed/sample_count | sampling same fields | add fixed coupling from reviewed version, not UUID |
| job.deadline_at minus server current time | budget.remaining_ms | capped at 300000 and never reset per retry |

Use colon-separated versions: Backend's existing engineIdentity() rejects `/`.
Suggested pins: `SCENARIO_ENGINE_VERSION=scenario-evaluator:1.0.0`,
`SCENARIO_CONTRACT_VERSION=scenario-engine:1.0`,
`SCENARIO_SAMPLING_VERSION=scenario-crn:1`. These pins are proposals, not claims
that a deployed engine currently supports them. A capability check must precede
real enqueue/worker acceptance.

Backend already stores a baseline and scenario point under one RUN. The aggregate
engine response must map BASELINE and SCENARIO explicitly, with role/input-hash
identity, rather than infer roles from arbitrary candidate IDs. A baseline-only
job persists its BASELINE point only; duplicated scenario output is not a second
database evaluation. The future result schema must freeze this mapping too.

Still unresolved with Backend: duration integer validation; uppercase strategy
names versus canonical lower-case IDs; horizon currently accepts shorter values
although the underlying engine does not crop its snapshot window; strict validator
profile; exact generated result schema; common-reference hashes; LIVE extension.
No migration or worker is changed by this proposal.

Baseline benchmark is reproducible with
`python scripts/benchmark_scenario_engine_baseline.py --output ../artifacts/scenario-baseline-benchmark.json`
from `ai_services`. It measures the existing canonical demo through the actual
planner at 1/5/7 cloned physical inputs and 100/1000 draws per candidate, records
per-point feasibility and environment, and checks source immutability. It explicitly
does not measure the future Scenario endpoint, stable sampler or Backend worker.
A single local measurement cannot establish a production latency target. Full
Scenario benchmarking remains required after implementation and joint integration.

## Verification and dependency map

After freeze: strict schema/parity tests; transform/property invariants; independent
hand-calculated small scheduling/ranking datasets; exact replay and UUID invariance;
weight-only planner/simulator call-count zero; cancellation/deadline/partial failure;
real FastAPI + Backend worker with frozen input/result validation; all legacy planner
tests; 5 duration and 5 weight points; three clean-schema joint browser runs at one
integrated SHA. Record benchmark points/draws/time/environment without claiming a
production latency target.

Golden cases must cover an analytic rank crossover, unchanged rank, exact tie,
infeasible physical value, missing/zero KPI, mandatory/locked/blocked/skill guards.
Golden expected outputs cannot be generated by the scorer under test. Record manual
arithmetic/reference implementation provenance alongside fixture inputs.

Pending dependencies: Backend acceptance of this contract and implementation SHA;
approved LIVE extension; Frontend production flow/integration SHA. These are not
mockable completion criteria. #54/#55 closure is tracked independently; GitHub reports
both merged as of this proposal's preparation.

## Readiness findings before freeze

The new canonical fixture
`ai_services/tests/fixtures/scenario-maintenance-90-minute-slot.json` and
`test_scenario_engine_baseline_golden.py` exercise existing production components,
without an engine DTO implementation. Ten tests passed: five duration values,
defer infeasibility, missing skill/availability, and independently calculated
weight rank-change/tie/no-change. This is component evidence, not Scenario feature
acceptance. Existing planner/validator regression subset: 20 tests passed.

However, `python scripts/probe_scenario_constraints.py --fail-on-gap` exposes five
missing semantic checks at the exact base. All probe inputs round-trip through
canonical Pydantic schemas; the observed validator verdict is VALID in each case:

| Candidate defect | Required result | Base result |
| --- | --- | --- |
| Omits mandatory maintenance | INVALID with target/coverage evidence | VALID |
| Shortens a 60-minute request to one minute | INVALID with duration evidence | VALID |
| Starts before the request's deferred lower bound | INVALID with window evidence | VALID |
| Omits an immutable locked assignment | INVALID with reservation evidence | VALID |
| Schedules a BLOCKED production operation | INVALID with status evidence | VALID |

Therefore simply calling OperationsValidatorV1 after a transform cannot prove
F1/F3. The proposed strict profile must enforce coverage/uniqueness, actual
duration and earliest/latest bounds, exact retained reservations, and operation
eligibility, in addition to the existing machine/skill/resource checks. It needs
forged-output negative tests as well as valid-schedule tests. The scheduler must
retain a locked maintenance request exactly once instead of allocating it again.
Report infeasibility instead of unblocking an operation or dropping mandatory work.
This is a required implementation gap, not an accepted exception or a passing probe.
