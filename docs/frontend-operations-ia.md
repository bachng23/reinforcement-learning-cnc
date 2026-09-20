# Frontend Operations IA and contract map

Status: first-pass information architecture and fixture-rendering UI skeleton for Operations contract v3 (`schema_version: "3.0"`). This document covers presentation only; it does not define backend persistence or API availability.

## 1. Navigation and route hierarchy

The existing Research Console shell remains the product frame. Operations is a primary sidebar entry and exposes four local tabs:

```text
CNC Research Console
├─ Operations                         /operations
│  ├─ Operations Overview             /operations
│  ├─ Integrated Schedule / Gantt     /operations/schedule
│  ├─ Recommendation Center           /operations/recommendations
│  └─ Agent Control Room              /operations/agents
├─ Experiments                        /experiments        (research contract v2)
├─ Decision Center                    /decisions          (maintenance review workflow)
└─ Users                              /admin              (ADMIN only)
```

The new Recommendation Center is deliberately separate from the existing Decision Center. The former presents v3 multi-agent `RecommendationPackage` and `HumanDecisionRequest`; the latter retains the earlier maintenance recommendation lifecycle.

## 2. Screen IA and light wireframes

### Operations Overview

Primary question: “What is the state of the factory snapshot and what needs attention?”

```text
[Page title / fixture notice / Operations tabs]
[Factory] [Captured at] [Planning window] [Schedule revision]
[ Machine status grid: machine + health + active assignment ]
[ Health alerts and evidence          ][ Cases needing action ]
[ Health risk drivers                 ][ Technician availability ]
[ Active maintenance requests                                ]
[ Contract gap: authoritative shift KPIs are not available   ]
```

### Integrated Schedule / Gantt

Primary question: “What is scheduled now and what would the recommended plan change?”

```text
[Machine filter] [Assignment type filter]
[Current schedule · revision N]
  Production lanes by machine
  Maintenance lanes by machine
  Technician lanes
  Assignment detail table
[Proposed candidate schedule · revision N+1]
  Dashed PROPOSED blocks + same direct contract details
[Manual patch editor placeholder] [What-if placeholder]
```

### Recommendation Center

Primary question: “Why is this plan recommended, how do validated alternatives compare, and what human decision should be prepared?”

```text
[Case / trigger / mode / authoritative status]
[Explanation: reasons / tradeoffs / residual risks / evidence]
[KPI rows] [Recommended candidate] [Alternative 1] [Alternative 2]
[Validation] [Assumptions] [Warnings]
[Approve] [Modify] [Reject] + decision note
[HumanDecisionRequest JSON preview — fixture mode only]
```

### Agent Control Room

Primary question: “Which agents and tools participated, and what public trace/evidence did they produce?”

```text
[Agent node grid: name/status/task/version/last tool/window]
[Tool-call timeline]          [Selected sanitized tool detail]
                              [input_summary / output_summary]
[Structured agent messages and evidence references]
```

Private chain-of-thought, prompts, secrets, solver internals and raw sensor payloads are excluded.

## 3. Required contract fields by screen

### Operations Overview

| UI region | Contract/resource | Required fields | Frontend rule / gap |
|---|---|---|---|
| Snapshot context | `FactorySnapshot` | `snapshot_id`, `factory_id`, `captured_at`, `planning_window` | Display as returned; timestamps may be localized for presentation. |
| Machine grid | `Machine` | `machine_id`, `display_name`, `machine_family`, `status` | Unknown status must remain visible, never silently remapped. |
| Health indicator | `HealthSnapshot` | `machine_id`, `observed_at`, `health_index`, `failure_probability_horizon_minutes`, `failure_probability`, `confidence`, `source_model_version`; optional `observed_wear_um`, `rul_distribution` | Join by `machine_id`. Formatting a `[0,1]` value as a percentage is presentation only. Do not predict RUL or health. |
| Active work | `Schedule.assignments[]` | `assignment_id`, `assignment_type`, `status`, `machine_id`, `start_at`, `end_at`, optional entity references | Join to a machine. Do not infer assignment feasibility or job progress. |
| Health alerts | `MachineRiskReport` | `risk_report_id`, `machine_id`, `prediction_horizon_minutes`, optional `expected_rul_minutes`, `failure_probability`, `confidence`, `risk_level`, `recommended_review_window_minutes`, `risk_drivers`, `evidence_refs` | Risk level, probability, contribution and RUL are authoritative AI outputs. |
| Maintenance work | `MaintenanceRequest` | ID, machine, type, action, priority, status, timing, duration, required skills, mandatory | No due-state calculation in the browser. |
| Technician availability | `Technician` | ID, name, `status`, `availability`, `skills` | Show returned status/windows; do not calculate availability from the clock. |
| Cases needing action | `DecisionCaseStatusResponse` + decision-case request/summary | case ID, mode, status, snapshot ID, timestamps, recommendation ID; trigger fields from the initiating request/resource | `DecisionCaseStatusResponse` alone does not contain the trigger. API composition must preserve provenance. |
| Shift KPIs | Not defined in v3 | — | Intentionally omitted. Machine/status counts are not presented as authoritative shift KPIs. |
| Job progress | No progress field in v3 | operation `status` exists | Do not derive percentage progress. Show operation status only when a dedicated view is added. |

### Integrated Schedule / Gantt

| UI region | Contract/resource | Required fields | Frontend rule / gap |
|---|---|---|---|
| Plan header | `Schedule` | `schedule_id`, `factory_id`, `revision`, `planning_window`, `created_at` | Revision is displayed, never incremented locally. |
| Gantt block | `ScheduleAssignment` | ID, type, status, machine, start/end, locked, job/operation/request/technician references | Position/width is a visual mapping of start/end within `planning_window`, not an operational KPI. |
| Production context | `ProductionJob.operations[]` | job ID, priority, operation ID/status, predecessor IDs | Join by IDs. Dependencies are displayed verbatim. |
| Maintenance context | `MaintenanceRequest` | request ID, priority, required skills | Join by `maintenance_request_id`. |
| Risk context | `MachineRiskReport` | machine ID, `risk_level` | Join by machine ID; never infer risk from health fields. |
| Current vs proposed | `FactorySnapshot.current_schedule`, selected `CandidatePlan.schedule` | complete immutable schedules | Highlighting is presentation-only. No local feasibility verdict. |
| Manual edit | `HumanDecisionRequest` (`MODIFY`) | candidate ID, expected plan version/snapshot, complete `modified_schedule` | A patch cannot be committed directly. The modified schedule must be validated by the backend/AI workflow. |
| What-if | Decision trigger `WHAT_IF`, mode `SIMULATION_ONLY` | event/user/scenario/assumptions plus planning config | UI placeholder only until an adapter exists. Simulation must never commit. |

The product spec asks each block to show risk/priority/dependency. These values are not fields on `ScheduleAssignment`; the UI may only show them after explicit ID joins to `MachineRiskReport`, `MaintenanceRequest`/`ProductionJob`, and `Operation.predecessor_operation_ids`.

### Recommendation Center

| UI region | Contract/resource | Required fields | Frontend rule / gap |
|---|---|---|---|
| Case context | `DecisionCaseStatusResponse` | ID, mode, status, snapshot, timestamps, recommendation ID | Status is backend authoritative. Events trigger a refetch; they do not replace the resource. |
| Explanation | `RecommendationPackage.explanation` | `summary`, `primary_reasons`, `tradeoffs`, `residual_risks`, `evidence_refs` | Render structured explanation; do not synthesize a new explanation. |
| Candidate identity | `CandidatePlan` | ID, plan version, strategy, source engine/version, generated time | Recommended ID comes from `RecommendationPackage.recommended_plan_id`; frontend does not rank. |
| KPI comparison | `CandidatePlan.kpis` | every `PlanKPIs` field | Display direct values. No delta, score or winner calculation in frontend. |
| Validation | `CandidatePlan.validation` | verdict, validator version/time, violations, simulation runs, warnings | Only `VALID` candidates may be selectable in a recommendation package. Frontend does not declare feasibility. |
| Candidate context | `assumptions`, `warnings`, `source_agent_run_ids`, `schedule` | fields as returned | Never fill missing assumptions/warnings. |
| Human action | `HumanDecisionRequest` | common case/recommendation/snapshot IDs; approve/modify plan ID + expected version; modify full schedule; reject note | Controls must enforce the discriminated request shape and optimistic concurrency fields. |

### Agent Control Room

| UI region | Contract/resource | Required fields | Frontend rule / gap |
|---|---|---|---|
| Agent node | `AgentDefinition` + `AgentRunTrace` | agent name/role/version, run status, task ID, timestamps, tool/message IDs, output/error ref | Join definitions and runs by `agent_id`. No private reasoning. |
| Tool timeline | `ToolCallTrace` | call/case/run/correlation IDs, tool ID/version, status, start/end, sanitized summaries, evidence refs, error code, retry count | Sort by returned `started_at`; show exact status. |
| Tool detail | `ToolCallTrace` | same as above | `latency_ms` is requested by product IA but is not present in v3. Do not calculate/display an authoritative latency; show “Not supplied by v3”. |
| Communication | `AgentMessage` | from run, destination role, kind, subject, created time, payload, evidence | Payload is structured/public evidence only. |
| Agent duration | `AgentRunTrace.started_at/completed_at` | execution window | The v3 payload has no duration field. Current skeleton shows timestamps, not a computed duration KPI. |
| Live progress | `DecisionEvent` + resource GET | sequence, event type, subject, correlation, payload | Event sequence is backend authoritative. Reconnect with last sequence, then refetch resources. |

## 4. Component contracts in the first pass

| Component | Inputs | Output / interaction |
|---|---|---|
| `MachineStatusGrid` | `machines`, `healthSnapshots`, `assignments` | Read-only joined machine cards. |
| `HealthAlertPanel` | `MachineRiskReport[]` | Read-only risks, drivers and evidence. |
| `ScheduleGantt` | `schedule`, `snapshot`, `riskReports`, optional filters | Presentation-only lanes and detail table. |
| `CandidateComparison` | candidates, recommended ID, selected ID | Emits selected candidate ID; never ranks. |
| `DecisionControls` | case/recommendation/snapshot IDs, candidate, optional modified schedule | Emits a contract-shaped `HumanDecisionRequest`. Fixture page previews it only. |
| `AgentRunGrid` | definitions, runs, tool calls | Read-only agent node grid. |
| `AgentTraceTimeline` | runs, tool calls, messages | Selects a trace locally and renders sanitized detail. |

## 5. Data and integration boundary

- Fixture: `frontend/lib/operations/fixtures.ts`, using contract v3 field names and enum values.
- Types: `frontend/types/operations.ts`, a UI-consumed subset of the canonical Pydantic/JSON Schema contract.
- Source of truth remains `ai_services/domain/operations/contracts.py` and generated `contracts/v3/operations-domain.schema.json`.
- The proposed endpoints in the product spec are not assumed to exist. A later API adapter must normalize actual OpenAPI responses into the same page/component inputs.
- Before real integration, replace handwritten subset types with generated TypeScript when a repository-wide generator is selected.
- Loading, empty, unauthorized, retryable error and stale `409` states belong in the future adapter/page-state layer. The fixture pass labels itself visibly and performs no network mutation.

## 6. Follow-up issue breakdown

1. Generate TypeScript types from the v3 schema and add fixture-vs-schema validation in CI.
2. Agree and publish OpenAPI endpoints/wrappers for snapshot, schedule, case, recommendation, trace and human-decision resources.
3. Add read adapters with loading/empty/error/unauthorized states and SSE sequence/reconnect handling.
4. Add schedule diff and a manual editor that produces a complete `modified_schedule`, then requests validation before commit.
5. Add backend-authoritative shift KPI/job-progress payloads if those cards remain product requirements.
6. Decide whether `ToolCallTrace` should expose authoritative `latency_ms` and whether `AgentRunTrace` should expose duration.
7. Add role/permission gates and real approve/modify/reject mutation handling, including stale snapshot/plan `409` reconciliation.
8. Add responsive/accessibility review, visual regression coverage and end-to-end tests against real services.
