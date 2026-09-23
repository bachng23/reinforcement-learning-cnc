# Deterministic Decision Planning Engine v1

`DecisionPlanningService` is a synchronous, side-effect-free facade:

```text
RunDecisionCaseRequest
  -> deterministic scheduler
  -> OperationsValidatorV1
  -> deterministic KPI simulation
  -> normalized objective ranking
  -> RecommendationPackage
```

It neither writes a schedule nor accesses a database. It is a heuristic planner;
CP-SAT, LLM, RL, and HSGS are intentionally outside v1.

From the repository root, execute the canonical vertical slice with:

```bash
uv run --project ai_services python ai_services/scripts/plan_decision_case.py contracts/v3/fixtures/demo-health-alert.json
```

## Scheduling policy

- Pending operations are ordered by job priority, release time, job ID, and operation
  sequence. Every predecessor must finish before its successor begins.
- Eligible machine options use their contract `processing_minutes`. Failed and
  unavailable machines are excluded. Machine and technician intervals are half-open.
- Locked, running, and completed entries from the current schedule are reserved.
  Other committed work is replanned, then compared with the current schedule to
  calculate schedule stability.
- All open/scheduled/in-progress maintenance requests are scheduled. A candidate is
  infeasible if its machine slot, earliest/latest window, technician availability, or
  skill/certification requirements cannot be met. Corrective mandatory work therefore
  cannot be omitted.
- Production priority fills production work before maintenance. Balanced reserves the
  midpoint of a maintenance window before production. Reliability priority schedules
  maintenance first and strongly penalizes machines with observed failure risk.
- The deadline is `solver_timeout_seconds` from `time.monotonic()`. If time expires
  after valid candidates exist, the service returns only those best-known valid
  candidates. If none exists it raises `PLANNING_TIMEOUT`; infeasibility raises
  `NO_FEASIBLE_PLAN`.

## KPI and simulation assumptions

- Makespan, tardiness, on-time rate, utilization, maintenance cost, and schedule
  changes are calculated from the generated schedule, never fixture KPI values.
- Preventive maintenance costs 5 units/minute; corrective maintenance costs 12
  units/minute.
- Every health observation supplies its per-run failure probability. Scheduled
  maintenance on that machine reduces it by 70%. A sampled failure contributes the
  smaller of its probability horizon and schedule makespan as emergency downtime.
- `random.Random` is seeded from `base_seed` plus deterministic schedule identity.
  Thus identical input/config/seed canonically serializes byte-for-byte identically;
  changing the seed affects stochastic KPI estimates, not schedule feasibility.

## Canonical fixture measurement

Measured locally from `contracts/v3/fixtures/demo-health-alert.json` with seed
`20260922`, `100` simulation runs, and a 12-hour horizon. Wall time was 2.947 ms on
the development host; this is an observation, not a latency SLA.

| Strategy | Makespan min | Tardiness min | Failure probability | Expected failures | Emergency downtime min | Maintenance cost | Technician utilization | Schedule changes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RELIABILITY_PRIORITY` | 420 | 0 | 0.09 | 0.09 | 37.8 | 300 | 0.028571 | 7 |
| `PRODUCTION_PRIORITY` | 420 | 0 | 0.14 | 0.14 | 58.8 | 300 | 0.028571 | 1 |
| `BALANCED` | 420 | 0 | 0.14 | 0.14 | 58.8 | 300 | 0.028571 | 7 |

The scorer min-max normalizes metrics across valid candidates, applies
`objective_weights`, and breaks ties by strategy order then candidate ID. Invalid
candidates remain only in `PlanningDiagnostics`; `RecommendationPackage` receives
only candidates whose `OperationsValidatorV1` verdict is `VALID`.
